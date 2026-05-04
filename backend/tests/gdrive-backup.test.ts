import fs from "node:fs";
import path from "node:path";

import { GaxiosError } from "gaxios";
import type { GaxiosOptionsPrepared, GaxiosResponse } from "gaxios";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const filesGetMock = vi.hoisted(() => vi.fn());
const filesCreateMock = vi.hoisted(() => vi.fn());
const filesListMock = vi.hoisted(() => vi.fn());
const filesDeleteMock = vi.hoisted(() => vi.fn());

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials(_: unknown) {}
        async getToken(_: string) {
          return {
            tokens: {
              refresh_token: "mock-refresh-token",
              access_token: "mock-access-token",
              expiry_date: Date.now() + 3_600_000
            }
          };
        }
      }
    },
    drive: vi.fn(() => ({
      files: {
        get: (...args: unknown[]) => filesGetMock(...args),
        create: (...args: unknown[]) => filesCreateMock(...args),
        list: (...args: unknown[]) => filesListMock(...args),
        delete: (...args: unknown[]) => filesDeleteMock(...args)
      }
    }))
  }
}));

import { buildApp } from "../src/app.js";
import { resolveDataPath } from "../src/paths.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();
const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const OWNER_EMAIL = "owner@example.com";
const OWNER_PASSWORD = "ChangeMe123!";
const SEEDED_PASSWORD_HASH = "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO";
const ADMIN_ID = "20000000-0000-0000-0000-000000000087";
const ADMIN_EMAIL = "admin-gdrive-api@example.com";
const MEMBER_ID = "20000000-0000-0000-0000-000000000086";
const MEMBER_EMAIL = "member-gdrive-api@example.com";

const STAGING_DIR = resolveDataPath("data/gdrive-backup-staging");

function gaxios403(): GaxiosError {
  const config = { url: "https://www.googleapis.com/drive/v3/files" } as GaxiosOptionsPrepared;
  const response = {
    status: 403,
    statusText: "Forbidden",
    config,
    data: {},
    headers: new Headers()
  } as unknown as GaxiosResponse;
  return new GaxiosError("Forbidden", config, response);
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post("/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function pollBackupComplete(jobId: string, token: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const st = await request(app).get(`/gdrive/backup/${jobId}`).set("authorization", `Bearer ${token}`);
    expect(st.status).toBe(200);
    const status = st.body.status as string;
    if (status === "complete" || status === "failed") {
      return st.body as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("backup job did not finish in time");
}

describe("gdrive backup API", () => {
  beforeAll(async () => {
    await sqlStmt(
      `INSERT INTO app_user
       (id, household_id, email, role, password_hash, visibility_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         household_id = EXCLUDED.household_id,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash,
         visibility_scope = EXCLUDED.visibility_scope`
    ).run(ADMIN_ID, HOUSEHOLD_ID, ADMIN_EMAIL, "admin", SEEDED_PASSWORD_HASH, "all");

    await sqlStmt(
      `INSERT INTO app_user
       (id, household_id, email, role, password_hash, visibility_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         household_id = EXCLUDED.household_id,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash,
         visibility_scope = EXCLUDED.visibility_scope`
    ).run(MEMBER_ID, HOUSEHOLD_ID, MEMBER_EMAIL, "member", SEEDED_PASSWORD_HASH, "own");
  });

  afterAll(async () => {
    await sqlStmt("DELETE FROM backup_job WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM household_gdrive_config WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM app_user WHERE id IN (?, ?)").run(ADMIN_ID, MEMBER_ID);
    try {
      if (fs.existsSync(STAGING_DIR)) {
        for (const name of fs.readdirSync(STAGING_DIR)) {
          if (name.endsWith(".hfb")) {
            fs.unlinkSync(path.join(STAGING_DIR, name));
          }
        }
      }
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    await sqlStmt("DELETE FROM backup_job WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM household_gdrive_config WHERE household_id = ?").run(HOUSEHOLD_ID);
    filesGetMock.mockReset();
    filesCreateMock.mockReset();
    filesListMock.mockReset();
    filesDeleteMock.mockReset();
    filesListMock.mockResolvedValue({ data: { files: [] } });
    filesDeleteMock.mockResolvedValue({});
    filesGetMock.mockResolvedValue({
      data: {
        id: "folder-mock",
        name: "Mock Folder",
        mimeType: "application/vnd.google-apps.folder"
      }
    });
    filesCreateMock.mockResolvedValue({
      data: {
        id: "file-abc",
        name: "hf-backup-2026-05-03T00-00-00.hfb"
      }
    });
  });

  it("POST /gdrive/backup returns 401 without token", async () => {
    const res = await request(app).post("/gdrive/backup");
    expect(res.status).toBe(401);
  });

  it("POST /gdrive/backup returns 409 GDRIVE_NOT_CONFIGURED when Drive is not connected", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).post("/gdrive/backup").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GDRIVE_NOT_CONFIGURED");
  });

  it("POST /gdrive/backup returns 403 for admin and member", async () => {
    const adminTok = await login(ADMIN_EMAIL, OWNER_PASSWORD);
    const adminPost = await request(app).post("/gdrive/backup").set("authorization", `Bearer ${adminTok}`);
    expect(adminPost.status).toBe(403);

    const memberTok = await login(MEMBER_EMAIL, OWNER_PASSWORD);
    const memberPost = await request(app).post("/gdrive/backup").set("authorization", `Bearer ${memberTok}`);
    expect(memberPost.status).toBe(403);
  });

  it("GET /gdrive/backup/:jobId returns 404 for unknown jobId", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .get("/gdrive/backup/00000000-0000-0000-0000-000000000099")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("BACKUP_JOB_NOT_FOUND");
  });

  it(
    "full success: owner connects, backup completes, staging file removed, admin can read status",
    { timeout: 120_000 },
    async () => {
      const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
      await request(app)
        .post("/gdrive/connect")
        .set("authorization", `Bearer ${ownerToken}`)
        .send({
          code: "test-oauth-code",
          folderId: "folder-backup-ok"
        });
      expect(filesGetMock).toHaveBeenCalled();

      const start = await request(app).post("/gdrive/backup").set("authorization", `Bearer ${ownerToken}`);
      expect(start.status).toBe(202);
      const jobId = start.body.jobId as string;
      expect(jobId).toBeTruthy();

      const tempPath = path.join(STAGING_DIR, `${jobId}.hfb`);
      const body = await pollBackupComplete(jobId, ownerToken);
      expect(body.status).toBe("complete");
      expect(body.driveFileId).toBe("file-abc");
      expect(body.driveFileName).toBe("hf-backup-2026-05-03T00-00-00.hfb");
      expect(Number(body.sizeBytes)).toBeGreaterThan(0);
      expect(fs.existsSync(tempPath)).toBe(false);

      const adminTok = await login(ADMIN_EMAIL, OWNER_PASSWORD);
      const adminGet = await request(app).get(`/gdrive/backup/${jobId}`).set("authorization", `Bearer ${adminTok}`);
      expect(adminGet.status).toBe(200);
      expect(adminGet.body.status).toBe("complete");
      expect(adminGet.body.driveFileId).toBe("file-abc");
    }
  );

  it(
    "Drive 403: job fails with permission message, staging file removed",
    { timeout: 120_000 },
    async () => {
      filesCreateMock.mockRejectedValueOnce(gaxios403());
      const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
      await request(app)
        .post("/gdrive/connect")
        .set("authorization", `Bearer ${ownerToken}`)
        .send({
          code: "test-oauth-code",
          folderId: "folder-backup-fail"
        });

      const start = await request(app).post("/gdrive/backup").set("authorization", `Bearer ${ownerToken}`);
      expect(start.status).toBe(202);
      const jobId = start.body.jobId as string;
      const tempPath = path.join(STAGING_DIR, `${jobId}.hfb`);

      const body = await pollBackupComplete(jobId, ownerToken);
      expect(body.status).toBe("failed");
      expect(String(body.errorText)).toContain("Permission denied");
      expect(fs.existsSync(tempPath)).toBe(false);
    }
  );
});
