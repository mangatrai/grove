import crypto from "node:crypto";

import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

/**
 * SEC #189 (scope reduced by owner 2026-07-04): multi-household support is permanently out of
 * scope for this single-family, self-hosted app, so no tenant-isolation middleware/query-helper
 * retrofit was done. This is the one regression test the reduced scope asked for: prove that a
 * user logged into household B cannot read or write household A's resources by direct ID across
 * the main modules (transactions, payslips, accounts, protest). Defense-in-depth against a future
 * auth bug, not a tenant-isolation guarantee.
 */

const app = buildApp();

async function createHouseholdContext(seed: string): Promise<{
  householdId: string;
  ownerUserId: string;
  ownerProfileId: string;
  token: string;
}> {
  const householdId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  const ownerProfileId = crypto.randomUUID();
  const ownerEmail = `sec189-owner-${seed}-${Date.now()}@example.com`;
  const ownerPassword = "ChangeMe123!";
  const ownerPasswordHash = await bcrypt.hash(ownerPassword, 10);

  await sqlStmt(
    `INSERT INTO household (id, name, owner_user_id, employers_json)
     VALUES (?, 'SEC-189 Household', NULL, '[]')`
  ).run(householdId);
  await sqlStmt(
    `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope)
     VALUES (?, ?, ?, 'owner', ?, 'own')`
  ).run(ownerUserId, householdId, ownerEmail, ownerPasswordHash);
  await sqlStmt(`UPDATE household SET owner_user_id = ? WHERE id = ?`).run(ownerUserId, householdId);
  await sqlStmt(
    `INSERT INTO person_profile (id, household_id, linked_user_id, full_name, financial_goals_json)
     VALUES (?, ?, ?, 'SEC-189 Owner', '[]')`
  ).run(ownerProfileId, householdId, ownerUserId);

  const login = await request(app).post("/auth/login").send({ email: ownerEmail, password: ownerPassword });
  expect(login.status).toBe(200);
  return { householdId, ownerUserId, ownerProfileId, token: login.body.token as string };
}

describe("SEC #189: cross-household access regression", () => {
  let householdA: Awaited<ReturnType<typeof createHouseholdContext>>;
  let householdB: Awaited<ReturnType<typeof createHouseholdContext>>;
  let accountId: string;
  let txnId: string;
  let payslipId: string;
  let propertyId: string;

  beforeAll(async () => {
    householdA = await createHouseholdContext("a");
    householdB = await createHouseholdContext("b");

    accountId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO financial_account (id, household_id, type, institution, owner_scope)
       VALUES (?, ?, 'checking', 'SEC-189 Test Bank', 'household')`
    ).run(accountId, householdA.householdId);

    const defaultCategory = (await sqlStmt(
      `SELECT id FROM category WHERE household_id IS NULL ORDER BY id LIMIT 1`
    ).get()) as { id: string };
    txnId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO transaction_canonical (
         id, household_id, account_id, source_ref, txn_date, amount, direction, merchant, category_id, status, fingerprint
       ) VALUES (?, ?, ?, ?, '2030-01-20', 25.50, 'debit', 'SEC-189 Coffee', ?, 'posted', ?)`
    ).run(txnId, householdA.householdId, accountId, `sec189-seed:a`, defaultCategory.id, crypto.randomUUID());

    payslipId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO payslip_snapshot (
         id, household_id, file_name, file_checksum, parser_profile_id, pay_date,
         owner_scope, owner_person_profile_id
       ) VALUES (?, ?, 'sec189-test.pdf', ?, 'manual', '2030-01-15', 'person', ?)`
    ).run(payslipId, householdA.householdId, crypto.randomUUID(), householdA.ownerProfileId);

    propertyId = crypto.randomUUID();
    await sqlStmt(
      `INSERT INTO property (id, household_id, address_line1, city, state, zip, property_use)
       VALUES (?, ?, '123 SEC-189 Test St', 'Testville', 'TX', '75001', 'primary')`
    ).run(propertyId, householdA.householdId);
  });

  describe("sanity: household A can access its own resources", () => {
    it("GET /transactions/:id/open-review", async () => {
      const res = await request(app)
        .get(`/transactions/${txnId}/open-review`)
        .set("authorization", `Bearer ${householdA.token}`);
      expect(res.status).toBe(200);
    });

    it("GET /payslips/:id", async () => {
      const res = await request(app)
        .get(`/payslips/${payslipId}`)
        .set("authorization", `Bearer ${householdA.token}`);
      expect(res.status).toBe(200);
    });

    it("GET /api/protest/:propertyId/worksheet", async () => {
      const res = await request(app)
        .get(`/api/protest/${propertyId}/worksheet?year=2026`)
        .set("authorization", `Bearer ${householdA.token}`);
      expect(res.status).toBe(200);
    });

    it("GET /imports/accounts includes the account", async () => {
      const res = await request(app).get("/imports/accounts").set("authorization", `Bearer ${householdA.token}`);
      expect(res.status).toBe(200);
      const ids = (res.body.accounts as { id: string }[]).map((a) => a.id);
      expect(ids).toContain(accountId);
    });
  });

  describe("household B cannot read or write household A's resources by direct ID", () => {
    it("GET /transactions/:id/open-review -> 404", async () => {
      const res = await request(app)
        .get(`/transactions/${txnId}/open-review`)
        .set("authorization", `Bearer ${householdB.token}`);
      expect(res.status).toBe(404);
    });

    it("PATCH /transactions/:id -> 404", async () => {
      const res = await request(app)
        .patch(`/transactions/${txnId}`)
        .set("authorization", `Bearer ${householdB.token}`)
        .send({ memo: "SEC-189 hostile edit" });
      expect(res.status).toBe(404);
    });

    it("DELETE /transactions/:id -> 404", async () => {
      const res = await request(app)
        .delete(`/transactions/${txnId}`)
        .set("authorization", `Bearer ${householdB.token}`);
      expect(res.status).toBe(404);
    });

    it("GET /payslips/:id -> 404", async () => {
      const res = await request(app)
        .get(`/payslips/${payslipId}`)
        .set("authorization", `Bearer ${householdB.token}`);
      expect(res.status).toBe(404);
    });

    it("PATCH /payslips/:id -> 404", async () => {
      const res = await request(app)
        .patch(`/payslips/${payslipId}`)
        .set("authorization", `Bearer ${householdB.token}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it("DELETE /payslips/:id -> 404", async () => {
      const res = await request(app)
        .delete(`/payslips/${payslipId}`)
        .set("authorization", `Bearer ${householdB.token}`);
      expect(res.status).toBe(404);
    });

    it("PATCH /imports/accounts/:accountId -> 404", async () => {
      const res = await request(app)
        .patch(`/imports/accounts/${accountId}`)
        .set("authorization", `Bearer ${householdB.token}`)
        .send({ type: "checking", institution: "SEC-189 hostile edit" });
      expect(res.status).toBe(404);
    });

    it("GET /imports/accounts does not include household A's account", async () => {
      const res = await request(app).get("/imports/accounts").set("authorization", `Bearer ${householdB.token}`);
      expect(res.status).toBe(200);
      const ids = (res.body.accounts as { id: string }[]).map((a) => a.id);
      expect(ids).not.toContain(accountId);
    });

    it("GET /api/protest/:propertyId/worksheet -> 404", async () => {
      const res = await request(app)
        .get(`/api/protest/${propertyId}/worksheet?year=2026`)
        .set("authorization", `Bearer ${householdB.token}`);
      expect(res.status).toBe(404);
    });

    it("PATCH /api/protest/:propertyId/worksheet -> 404", async () => {
      const res = await request(app)
        .patch(`/api/protest/${propertyId}/worksheet`)
        .set("authorization", `Bearer ${householdB.token}`)
        .send({ year: 2026 });
      expect(res.status).toBe(404);
    });
  });
});
