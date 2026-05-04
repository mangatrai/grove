import { GaxiosError } from "gaxios";
import type { GaxiosOptionsPrepared, GaxiosResponse } from "gaxios";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const filesGetMock = vi.hoisted(() => vi.fn());

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: class {
        constructor() {}
      }
    },
    drive: vi.fn(() => ({
      files: {
        get: (...args: unknown[]) => filesGetMock(...args)
      }
    }))
  }
}));

import { buildApp } from "../src/app.js";
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

const minimalServiceAccountKey = {
  type: "service_account",
  project_id: "test-proj",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----\n",
  client_email: "svc@test-proj.iam.gserviceaccount.com"
};

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
    await sqlStmt("DELETE FROM household_gdrive_config WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM app_user WHERE id IN (?, ?)").run(ADMIN_ID, MEMBER_ID);
  });

  beforeEach(async () => {
    await sqlStmt("DELETE FROM household_gdrive_config WHERE household_id = ?").run(HOUSEHOLD_ID);
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

  it("POST /gdrive/connect returns 400 INVALID_KEY_JSON for invalid JSON string", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({ serviceAccountKeyJson: "not-json-at-all{", folderId: "any" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_KEY_JSON");
  });

  it("POST /gdrive/connect returns 400 INVALID_KEY_FORMAT for wrong key shape", async () => {
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({
        serviceAccountKeyJson: JSON.stringify({ type: "service_account", project_id: "", private_key: "", client_email: "" }),
        folderId: "x"
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_KEY_FORMAT");
  });

  it("POST /gdrive/connect returns 422 when Drive API returns 403", async () => {
    filesGetMock.mockRejectedValueOnce(gaxios403());
    const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${token}`)
      .send({
        serviceAccountKeyJson: JSON.stringify(minimalServiceAccountKey),
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
        serviceAccountKeyJson: JSON.stringify(minimalServiceAccountKey),
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
        serviceAccountKeyJson: JSON.stringify(minimalServiceAccountKey),
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
        serviceAccountKeyJson: JSON.stringify(minimalServiceAccountKey),
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
        serviceAccountKeyJson: JSON.stringify(minimalServiceAccountKey),
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
        serviceAccountKeyJson: JSON.stringify(minimalServiceAccountKey),
        folderId: "folder-member-test"
      });

    const memberToken = await login(MEMBER_EMAIL, OWNER_PASSWORD);
    const del = await request(app).delete("/gdrive/disconnect").set("authorization", `Bearer ${memberToken}`);
    expect(del.status).toBe(403);
  });

  it("admin can GET /gdrive/status after owner connects", async () => {
    const ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        serviceAccountKeyJson: JSON.stringify(minimalServiceAccountKey),
        folderId: "folder-admin-read"
      });

    const adminToken = await login(ADMIN_EMAIL, OWNER_PASSWORD);
    const st = await request(app).get("/gdrive/status").set("authorization", `Bearer ${adminToken}`);
    expect(st.status).toBe(200);
    expect(st.body.connected).toBe(true);
    expect(st.body.folderId).toBe("folder-admin-read");
  });
});
