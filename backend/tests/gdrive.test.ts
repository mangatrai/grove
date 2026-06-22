import { PassThrough } from "node:stream";

import archiver from "archiver";
import { GaxiosError } from "gaxios";
import type { GaxiosOptionsPrepared, GaxiosResponse } from "gaxios";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const filesGetMock = vi.hoisted(() => vi.fn());

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials(_: unknown) {}
        generateAuthUrl() {
          return "https://accounts.google.com/mock-oauth-url";
        }
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
        get: (...args: unknown[]) => filesGetMock(...args)
      }
    }))
  }
}));

/** Build an in-memory .hfb ZIP stream with a minimal manifest.json. */
function makeHfbStream(): PassThrough {
  const pass = new PassThrough();
  const archive = archiver("zip");
  archive.pipe(pass);
  const manifest = JSON.stringify({
    exportVersion: 3,
    exportedAt: "2026-05-04T00:00:00.000Z",
    householdId: "10000000-0000-0000-0000-000000000001",
    scope: "household",
    format: "split-json",
    tables: {
      household: { file: "household.json", rows: 1 },
      app_user: { file: "app_user.json", rows: 2 }
    }
  });
  archive.append(manifest, { name: "manifest.json" });
  archive.append("[]", { name: "household.json" });
  archive.append("[]", { name: "app_user.json" });
  void archive.finalize();
  return pass;
}

import { buildApp } from "../src/app.js";
import { encodeGDriveOAuthState } from "../src/modules/gdrive/gdrive.service.js";
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
const OWNER_USER_ID = "20000000-0000-0000-0000-000000000001";

function gaxios403(): GaxiosError {
  const config = { url: "https://www.googleapis.com/drive/v3/files/x" } as GaxiosOptionsPrepared;
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

describe("gdrive API", () => {
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
    await sqlStmt("DELETE FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM app_user WHERE id IN (?, ?)").run(ADMIN_ID, MEMBER_ID);
  });

  beforeEach(async () => {
    await sqlStmt("DELETE FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").run(HOUSEHOLD_ID);
    filesGetMock.mockReset();
    filesGetMock.mockResolvedValue({
      data: {
        id: "folder-mock",
        name: "Mock Folder",
        mimeType: "application/vnd.google-apps.folder"
      }
    });
  });

  it("GET /gdrive/status returns 401 without token", async () => {
    const res = await request(app).get("/gdrive/status");
    expect(res.status).toBe(401);
  });

  it("GET /gdrive/status returns 200 not connected for owner", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gdrive/status").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it("GET /gdrive/status returns 200 not connected for admin", async () => {
    const token = await login(ADMIN_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gdrive/status").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });

  it("GET /gdrive/status returns 403 for member", async () => {
    const token = await login(MEMBER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gdrive/status").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("GET /gdrive/oauth/url returns 400 when folderId is missing", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).get("/gdrive/oauth/url").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("GET /gdrive/oauth/url returns 200 with url for owner", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .get("/gdrive/oauth/url")
      .query({ folderId: "my-folder-id" })
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://accounts.google.com/mock-oauth-url");
  });

  it("POST /gdrive/connect returns 400 when code is missing", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({ folderId: "any" });
    expect(res.status).toBe(400);
  });

  it("POST /gdrive/connect returns 422 when Drive API returns 403 on folder verify", async () => {
    filesGetMock.mockRejectedValueOnce(gaxios403());
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({
        code: "test-oauth-code",
        folderId: "folder-id-1"
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("DRIVE_CONNECTION_FAILED");
    expect(String(res.body.message)).toContain("Permission denied");
  });

  it("POST /gdrive/connect succeeds then GET status and DELETE disconnect", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const connect = await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({
        code: "test-oauth-code",
        folderId: "folder-id-2"
      });
    expect(connect.status).toBe(200);
    expect(connect.body.connected).toBe(true);

    const st = await request(app).get("/gdrive/status").set("authorization", `Bearer ${token}`);
    expect(st.status).toBe(200);
    expect(st.body.connected).toBe(true);
    expect(st.body.folderId).toBe("folder-id-2");
    expect(st.body.backupFrequencyHours).toBe(24);
    expect(st.body.backupRetentionCount).toBe(7);

    const del = await request(app).delete("/gdrive/disconnect").set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ connected: false });

    const after = await request(app).get("/gdrive/status").set("authorization", `Bearer ${token}`);
    expect(after.body.connected).toBe(false);
  });

  it("PATCH /gdrive/settings returns 409 GDRIVE_NOT_CONFIGURED when Drive is not connected", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const patch = await request(app)
      .patch("/gdrive/settings")
      .set("authorization", `Bearer ${token}`)
      .send({ backupFrequencyHours: 24, backupRetentionCount: 7 });
    expect(patch.status).toBe(409);
    expect(patch.body.code).toBe("GDRIVE_NOT_CONFIGURED");
  });

  it("PATCH /gdrive/settings and GET /gdrive/backups/history after connect", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({
        code: "test-oauth-code",
        folderId: "folder-settings-hist"
      });

    const patch = await request(app)
      .patch("/gdrive/settings")
      .set("authorization", `Bearer ${token}`)
      .send({ backupFrequencyHours: 48, backupRetentionCount: 14 });
    expect(patch.status).toBe(200);
    expect(patch.body.backupFrequencyHours).toBe(48);
    expect(patch.body.backupRetentionCount).toBe(14);

    const hist = await request(app).get("/gdrive/backups/history").set("authorization", `Bearer ${token}`);
    expect(hist.status).toBe(200);
    expect(Array.isArray(hist.body.jobs)).toBe(true);
  });

  it("DELETE /gdrive/disconnect is idempotent when not configured", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app).delete("/gdrive/disconnect").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it("POST /gdrive/connect and DELETE /gdrive/disconnect return 403 for admin", async () => {
    const adminToken = await login(ADMIN_EMAIL, OWNER_PASSWORD);
    const post = await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${adminToken}`)
      .send({
        code: "c",
        folderId: "f"
      });
    expect(post.status).toBe(403);

    const del = await request(app).delete("/gdrive/disconnect").set("authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(403);
  });

  it("POST /gdrive/connect returns 403 for member", async () => {
    const token = await login(MEMBER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({
        code: "c",
        folderId: "f"
      });
    expect(res.status).toBe(403);
  });

  it("DELETE /gdrive/disconnect returns 403 for member", async () => {
    const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        code: "test-oauth-code",
        folderId: "folder-member-test"
      });

    const memberToken = await login(MEMBER_EMAIL, OWNER_PASSWORD);
    const del = await request(app).delete("/gdrive/disconnect").set("authorization", `Bearer ${memberToken}`);
    expect(del.status).toBe(403);
  });

  it("GET /gdrive/oauth/callback exchanges code and returns meta-refresh redirect to settings (no JWT)", async () => {
    const state = encodeGDriveOAuthState({
      householdId: HOUSEHOLD_ID,
      userId: OWNER_USER_ID,
      folderId: "folder-callback-ok"
    });
    const res = await request(app).get("/gdrive/oauth/callback").query({ code: "google-code", state });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(String(res.text)).toContain("gdrive=connected");
    expect(String(res.text)).toMatch(/localhost:3000\/settings/);

    const row = await sqlStmt("SELECT refresh_token, folder_id FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").get(
      HOUSEHOLD_ID
    );
    // Token is encrypted at rest — the stored value must not be the raw plaintext.
    expect(row?.refresh_token).not.toBe("mock-refresh-token");
    expect(row?.refresh_token).toBeTruthy(); // non-empty / non-null
    expect(row?.folder_id).toBe("folder-callback-ok");
    await sqlStmt("DELETE FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").run(HOUSEHOLD_ID);
  });

  it("admin can GET /gdrive/status after owner connects", async () => {
    const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        code: "test-oauth-code",
        folderId: "folder-admin-read"
      });

    const adminToken = await login(ADMIN_EMAIL, OWNER_PASSWORD);
    const st = await request(app).get("/gdrive/status").set("authorization", `Bearer ${adminToken}`);
    expect(st.status).toBe(200);
    expect(st.body.connected).toBe(true);
    expect(st.body.folderId).toBe("folder-admin-read");
  });

  it("POST /gdrive/backups/:fileId/preview returns 409 when Drive not connected", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gdrive/backups/some-file-id/preview")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GDRIVE_NOT_CONFIGURED");
  });

  it("POST /gdrive/backups/:fileId/preview returns 403 for non-owner", async () => {
    const token = await login(ADMIN_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gdrive/backups/some-file-id/preview")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("POST /gdrive/backups/:fileId/preview returns manifest preview on success", async () => {
    // Connect drive first
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({ code: "test-oauth-code", folderId: "folder-preview-ok" });

    // Mock the media download to return a valid .hfb stream
    filesGetMock.mockImplementationOnce((_params: unknown, opts: { responseType?: string } | undefined) => {
      if (opts?.responseType === "stream") {
        return Promise.resolve({ data: makeHfbStream() });
      }
      return Promise.resolve({ data: { id: "folder-preview-ok", name: "Mock", mimeType: "application/vnd.google-apps.folder" } });
    });

    const res = await request(app)
      .post("/gdrive/backups/file-abc/preview")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.exportVersion).toBe(3);
    expect(res.body.scope).toBe("household");
    expect(res.body.tables).toHaveProperty("household");
    expect(res.body.tables).toHaveProperty("app_user");
    expect(typeof res.body.totalRows).toBe("number");
  });

  it("POST /gdrive/backups/:fileId/preview returns 404 when Drive file not found", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({ code: "test-oauth-code", folderId: "folder-preview-404" });

    const config404 = { url: "https://www.googleapis.com/drive/v3/files/missing" } as GaxiosOptionsPrepared;
    const response404 = {
      status: 404,
      statusText: "Not Found",
      config: config404,
      data: {},
      headers: new Headers()
    } as unknown as GaxiosResponse;
    filesGetMock.mockImplementationOnce((_params: unknown, opts: { responseType?: string } | undefined) => {
      if (opts?.responseType === "stream") {
        return Promise.reject(new GaxiosError("Not Found", config404, response404));
      }
      return Promise.resolve({ data: { id: "folder-preview-404", name: "Mock", mimeType: "application/vnd.google-apps.folder" } });
    });

    const res = await request(app)
      .post("/gdrive/backups/missing-file/preview")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("DRIVE_FILE_NOT_FOUND");
  });
});
