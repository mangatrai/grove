import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { GaxiosError } from "gaxios";
import type { GaxiosOptionsPrepared, GaxiosResponse } from "gaxios";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const filesGetMock = vi.hoisted(() => vi.fn());
const filesListMock = vi.hoisted(() => vi.fn());
const filesCreateMock = vi.hoisted(() => vi.fn());

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
        list: (...args: unknown[]) => filesListMock(...args),
        create: (...args: unknown[]) => filesCreateMock(...args)
      }
    }))
  }
}));

import { buildApp } from "../src/app.js";
import { buildHfbFile } from "../src/modules/export/export-job.service.js";
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
const IMPORTS_RESTORE_DIR = resolveDataPath("data/imports-restore");

let hfbFixtureBuffer: Buffer;

function gaxios404(): GaxiosError {
  const config = { url: "https://www.googleapis.com/drive/v3/files/x" } as GaxiosOptionsPrepared;
  const response = {
    status: 404,
    statusText: "Not Found",
    config,
    data: {},
    headers: new Headers()
  } as unknown as GaxiosResponse;
  return new GaxiosError("Not Found", config, response);
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post("/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

function installDriveMocksForConnectAndDownload(): void {
  filesGetMock.mockImplementation((params: unknown) => {
    const p = params as { alt?: string };
    if (p.alt === "media") {
      return Promise.resolve({ data: Readable.from(hfbFixtureBuffer) });
    }
    return Promise.resolve({
      data: {
        id: "folder-mock",
        name: "Mock Folder",
        mimeType: "application/vnd.google-apps.folder"
      }
    });
  });
}

describe("gdrive restore API (CR-131)", () => {
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

    const tmpHfb = path.join(os.tmpdir(), `gdrive-restore-fixture-${Date.now()}.hfb`);
    await buildHfbFile(HOUSEHOLD_ID, null, tmpHfb);
    hfbFixtureBuffer = fs.readFileSync(tmpHfb);
    fs.unlinkSync(tmpHfb);
  });

  afterAll(async () => {
    await sqlStmt("DELETE FROM import_job WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM backup_job WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM app_user WHERE id IN (?, ?)").run(ADMIN_ID, MEMBER_ID);
    try {
      for (const dir of [STAGING_DIR, IMPORTS_RESTORE_DIR]) {
        if (fs.existsSync(dir)) {
          for (const name of fs.readdirSync(dir)) {
            if (name.endsWith(".hfb")) {
              fs.unlinkSync(path.join(dir, name));
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    await sqlStmt("DELETE FROM import_job WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM backup_job WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").run(HOUSEHOLD_ID);
    filesGetMock.mockReset();
    filesListMock.mockReset();
    filesCreateMock.mockReset();
    filesListMock.mockResolvedValue({ data: { files: [] } });
    filesCreateMock.mockImplementation((req: unknown) => {
      const body = (req as { requestBody?: { mimeType?: string; name?: string } }).requestBody;
      if (body?.mimeType === "application/vnd.google-apps.folder") {
        return Promise.resolve({
          data: { id: "drive-env-subfolder", name: body.name ?? "TEST" }
        });
      }
      return Promise.resolve({ data: { id: "file-created", name: body?.name ?? "file" } });
    });
    installDriveMocksForConnectAndDownload();
  });

  it("GET /gdrive/backups returns 401 without token", async () => {
    const res = await request(app).get("/gdrive/backups");
    expect(res.status).toBe(401);
  });

  it("GET /gdrive/backups returns 409 GDRIVE_NOT_CONFIGURED when Drive is not connected", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gdrive/backups").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GDRIVE_NOT_CONFIGURED");
  });

  it("GET /gdrive/backups returns 403 for member", async () => {
    const token = await login(MEMBER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gdrive/backups").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("GET /gdrive/backups returns 200 with files after owner connects", async () => {
    const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        code: "test-oauth-code",
        folderId: "folder-list-ok"
      });

    filesListMock.mockResolvedValue({
      data: {
        files: [
          {
            id: "f1",
            name: "hf-backup-a.hfb",
            size: "2048",
            createdTime: "2026-01-02T12:00:00.000Z"
          },
          {
            id: "f2",
            name: "hf-backup-b.hfb",
            size: "4096",
            createdTime: "2026-01-03T12:00:00.000Z"
          }
        ]
      }
    });

    const res = await request(app).get("/gdrive/backups").set("authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.files)).toBe(true);
    expect(res.body.files).toHaveLength(2);
    expect(res.body.files[0].fileId).toBe("f1");
    expect(res.body.files[0].fileName).toBe("hf-backup-a.hfb");
    expect(res.body.files[0].sizeBytes).toBe(2048);
  });

  it("GET /gdrive/backups returns 200 for admin after owner connects", async () => {
    const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        code: "test-oauth-code",
        folderId: "folder-admin-list"
      });

    filesListMock.mockResolvedValue({
      data: {
        files: [{ id: "x1", name: "one.hfb", size: "100", createdTime: "2026-02-01T00:00:00.000Z" }]
      }
    });

    const adminTok = await login(ADMIN_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gdrive/backups").set("authorization", `Bearer ${adminTok}`);
    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(1);
  });

  it("POST /gdrive/restore returns 401 without token", async () => {
    const res = await request(app).post("/gdrive/restore").send({ fileId: "abc" });
    expect(res.status).toBe(401);
  });

  it("POST /gdrive/restore returns 409 GDRIVE_NOT_CONFIGURED when not connected", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gdrive/restore")
      .set("authorization", `Bearer ${token}`)
      .send({ fileId: "abc" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GDRIVE_NOT_CONFIGURED");
  });

  it("POST /gdrive/restore returns 403 for admin and member", async () => {
    const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        code: "test-oauth-code",
        folderId: "folder-restore-role"
      });

    const adminTok = await login(ADMIN_EMAIL, OWNER_PASSWORD);
    const adminPost = await request(app)
      .post("/gdrive/restore")
      .set("authorization", `Bearer ${adminTok}`)
      .send({ fileId: "abc" });
    expect(adminPost.status).toBe(403);

    const memberTok = await login(MEMBER_EMAIL, OWNER_PASSWORD);
    const memberPost = await request(app)
      .post("/gdrive/restore")
      .set("authorization", `Bearer ${memberTok}`)
      .send({ fileId: "abc" });
    expect(memberPost.status).toBe(403);
  });

  it("POST /gdrive/restore returns 502 when Drive download fails", async () => {
    const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        code: "test-oauth-code",
        folderId: "folder-dl-fail"
      });

    filesGetMock.mockImplementation((params: unknown) => {
      const p = params as { alt?: string };
      if (p.alt === "media") {
        return Promise.reject(gaxios404());
      }
      return Promise.resolve({
        data: {
          id: "folder-mock",
          name: "Mock Folder",
          mimeType: "application/vnd.google-apps.folder"
        }
      });
    });

    const res = await request(app)
      .post("/gdrive/restore")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ fileId: "missing-file" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("DRIVE_DOWNLOAD_FAILED");
    expect(String(res.body.message)).toContain("not found");
  });

  it(
    "full success: owner connects, restore from Drive stream, 202 then import complete with stats",
    { timeout: 120_000 },
    async () => {
      await sqlStmt(
        `UPDATE payslip_snapshot SET import_file_id = NULL WHERE household_id = ? AND import_file_id IS NOT NULL`
      ).run(HOUSEHOLD_ID);

      const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
      await request(app)
        .post("/gdrive/connect")
        .set("authorization", `Bearer ${ownerToken}`)
        .send({
          code: "test-oauth-code",
          folderId: "folder-restore-ok"
        });

      installDriveMocksForConnectAndDownload();

      const start = await request(app)
        .post("/gdrive/restore")
        .set("authorization", `Bearer ${ownerToken}`)
        .send({ fileId: "drive-file-1" });
      expect(start.status).toBe(202);
      const jobId = start.body.jobId as string;
      expect(jobId).toBeTruthy();

      let importToken = ownerToken;
      let terminal = "";
      let lastStats: Record<string, number> | null = null;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
        const poll = await request(app)
          .get(`/exports/import/${jobId}`)
          .set("authorization", `Bearer ${importToken}`);
        if (poll.status === 401) {
          const relogin = await request(app).post("/auth/login").send({
            email: OWNER_EMAIL,
            password: OWNER_PASSWORD
          });
          expect(relogin.status).toBe(200);
          importToken = relogin.body.token as string;
          continue;
        }
        expect(poll.status).toBe(200);
        terminal = poll.body.status as string;
        if (poll.body.stats) {
          lastStats = poll.body.stats as Record<string, number>;
        }
        if (terminal === "complete" || terminal === "failed") break;
      }
      expect(terminal).toBe("complete");
      expect(lastStats).toBeTruthy();
      expect(typeof lastStats).toBe("object");
    }
  );
});
