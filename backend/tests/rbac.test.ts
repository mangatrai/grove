/**
 * RBAC granularity tests — extends the baseline coverage in app.test.ts by testing:
 * - What members CAN do (read access, self-service operations)
 * - Category rule write endpoints that require admin or owner
 * - Admin capabilities vs owner-only restrictions
 */
import crypto from "node:crypto";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

const SEEDED_HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";

/** bcrypt hash of "ChangeMe123!" */
const HASH = "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO";

// Groceries leaf — safe to use as a rule target
const GROCERIES_CATEGORY_ID = "30000000-0000-0000-0000-000000000004";

const ADMIN_USER_ID = "20000000-0000-0000-0000-000000000098";
const ADMIN_EMAIL = "admin-rbac@example.com";

const MEMBER_USER_ID = "20000000-0000-0000-0000-000000000099";
const MEMBER_EMAIL = "member@example.com";

let adminToken = "";
let memberToken = "";

const ruleIdsToCleanup: string[] = [];
const txnIdsToCleanup: string[] = [];

beforeAll(async () => {
  // Ensure admin user exists in the seeded household
  await sqlStmt(
    `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
     VALUES (?, ?, ?, 'admin', ?, 'all', CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET role = 'admin', email = EXCLUDED.email`
  ).run(ADMIN_USER_ID, SEEDED_HOUSEHOLD_ID, ADMIN_EMAIL, HASH);

  // Ensure member user exists
  await sqlStmt(
    `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
     VALUES (?, ?, ?, 'member', ?, 'own', CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET role = 'member', email = EXCLUDED.email`
  ).run(MEMBER_USER_ID, SEEDED_HOUSEHOLD_ID, MEMBER_EMAIL, HASH);

  const adminLogin = await request(app).post("/auth/login").send({
    email: ADMIN_EMAIL,
    password: "ChangeMe123!"
  });
  expect(adminLogin.status).toBe(200);
  adminToken = adminLogin.body.token as string;

  const memberLogin = await request(app).post("/auth/login").send({
    email: MEMBER_EMAIL,
    password: "ChangeMe123!"
  });
  expect(memberLogin.status).toBe(200);
  memberToken = memberLogin.body.token as string;
});

afterAll(async () => {
  for (const id of ruleIdsToCleanup) {
    await sqlStmt(`DELETE FROM category_rule WHERE id = ?`).run(id);
  }
  for (const id of txnIdsToCleanup) {
    await sqlStmt(`DELETE FROM transaction_canonical WHERE id = ?`).run(id);
  }
});

// ─── Member read permissions ──────────────────────────────────────────────────

describe("member read access", () => {
  it("member can list transactions (GET /transactions)", async () => {
    const res = await request(app)
      .get("/transactions")
      .set("authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transactions)).toBe(true);
  });

  it("member can read cash summary report (GET /reports/cash-summary)", async () => {
    const res = await request(app)
      .get("/reports/cash-summary?preset=rolling_30")
      .set("authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.household).toBeDefined();
  });

  it("member can read budget for a month (GET /budget/:month)", async () => {
    const res = await request(app)
      .get("/budget/2026-01")
      .set("authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
  });

  it("member can list categories (GET /categories)", async () => {
    const res = await request(app)
      .get("/categories")
      .set("authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
  });

  it("member CANNOT read gdrive status (GET /gdrive/status)", async () => {
    const res = await request(app)
      .get("/gdrive/status")
      .set("authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── Member write restrictions on category rules ─────────────────────────────

describe("member category rule restrictions", () => {
  it("member cannot PATCH a category rule", async () => {
    const fakeRuleId = crypto.randomUUID();
    const res = await request(app)
      .patch(`/categories/rules/${fakeRuleId}`)
      .set("authorization", `Bearer ${memberToken}`)
      .send({ enabled: false });
    expect(res.status).toBe(403);
  });

  it("member cannot DELETE a category rule", async () => {
    const fakeRuleId = crypto.randomUUID();
    const res = await request(app)
      .delete(`/categories/rules/${fakeRuleId}`)
      .set("authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });

  it("member cannot use POST /categories/rules/recategorize", async () => {
    const res = await request(app)
      .post("/categories/rules/recategorize")
      .set("authorization", `Bearer ${memberToken}`)
      .send({ mode: "all" });
    expect(res.status).toBe(403);
  });

  it("member cannot use POST /categories/rules/from-ledger", async () => {
    const res = await request(app)
      .post("/categories/rules/from-ledger")
      .set("authorization", `Bearer ${memberToken}`)
      .send({
        transactionId: crypto.randomUUID(),
        categoryId: GROCERIES_CATEGORY_ID,
        matchType: "contains",
        scope: "contains"
      });
    expect(res.status).toBe(403);
  });

  it("member cannot DELETE /categories/rules/household (clear all household rules)", async () => {
    const res = await request(app)
      .delete("/categories/rules/household")
      .set("authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── Member write restrictions on ledger bulk ops ────────────────────────────

describe("member ledger bulk restrictions", () => {
  it("member cannot POST /transactions/bulk-reassign-owner", async () => {
    const res = await request(app)
      .post("/transactions/bulk-reassign-owner")
      .set("authorization", `Bearer ${memberToken}`)
      .send({ transactionIds: [], ownerPersonProfileId: crypto.randomUUID() });
    expect(res.status).toBe(403);
  });
});

// ─── Admin capabilities ───────────────────────────────────────────────────────

describe("admin permissions", () => {
  it("admin can list household members (GET /household/members)", async () => {
    const res = await request(app)
      .get("/household/members")
      .set("authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
  });

  it("admin can read transactions (GET /transactions)", async () => {
    const res = await request(app)
      .get("/transactions")
      .set("authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("admin can read gdrive status (GET /gdrive/status)", async () => {
    const res = await request(app)
      .get("/gdrive/status")
      .set("authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("admin can create a category rule (POST /categories/rules)", async () => {
    const pattern = `rbac-admin-test-${Date.now()}`;
    const res = await request(app)
      .post("/categories/rules")
      .set("authorization", `Bearer ${adminToken}`)
      .send({
        pattern,
        matchType: "contains",
        categoryId: GROCERIES_CATEGORY_ID
      });
    expect(res.status).toBe(201);
    expect(res.body.rule?.id).toBeDefined();
    ruleIdsToCleanup.push(res.body.rule.id as string);
  });

  it("admin can PATCH household settings (PATCH /household/settings)", async () => {
    // Read current value first so we can restore it
    const getRes = await request(app)
      .get("/household/profile")
      .set("authorization", `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    const original = getRes.body.monthlySavingsTargetUsd as number | null;

    const patchRes = await request(app)
      .patch("/household/settings")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ monthlySavingsTargetUsd: 999 });
    expect(patchRes.status).toBe(200);

    // Restore original value
    await request(app)
      .patch("/household/settings")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ monthlySavingsTargetUsd: original ?? null });
  });
});

// ─── Admin owner-only restrictions ───────────────────────────────────────────

describe("admin cannot access owner-only endpoints", () => {
  it("admin cannot prepare a restore from backup (POST /exports/household/import/prepare)", async () => {
    // SEC #186: restore is now prepare+execute; both are requireRole(["owner"]) — admin is blocked
    const res = await request(app)
      .post("/exports/household/import/prepare")
      .set("authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  it("admin cannot execute a restore from backup (POST /exports/household/import/execute)", async () => {
    const res = await request(app)
      .post("/exports/household/import/execute")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ token: "irrelevant-blocked-before-token-check" });
    expect(res.status).toBe(403);
  });

  it("admin cannot preview an export file (POST /exports/preview)", async () => {
    // /exports/preview is requireRole(["owner"]) — admin is blocked regardless of payload
    const res = await request(app)
      .post("/exports/preview")
      .set("authorization", `Bearer ${adminToken}`);
    // 403 from requireRole before multer even reads the body
    expect(res.status).toBe(403);
  });

  it("admin cannot connect Google Drive (POST /gdrive/connect)", async () => {
    const res = await request(app)
      .post("/gdrive/connect")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ code: "fake-code", folderId: "fake-folder" });
    expect(res.status).toBe(403);
  });

  it("admin cannot disconnect Google Drive (DELETE /gdrive/disconnect)", async () => {
    const res = await request(app)
      .delete("/gdrive/disconnect")
      .set("authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });
});
