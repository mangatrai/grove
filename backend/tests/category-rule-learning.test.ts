import crypto from "node:crypto";

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const SEED_BOA_CHECKING = "40000000-0000-0000-0000-000000000001";

/** Salary leaf category — usable by household (global builtin leaf). */
const SALARY_CATEGORY_ID = "30000000-0000-0000-0000-000000000007";
/** Income parent category — NOT assignable (has children). */
const INCOME_PARENT_CATEGORY_ID = "30000000-0000-0000-0000-000000000001";

const createdRuleIds: string[] = [];

async function loginToken(): Promise<string> {
  const res = await request(app).post("/auth/login").send({
    email: "owner@example.com",
    password: "ChangeMe123!"
  });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function loginMember(): Promise<string> {
  // Ensure member user exists (same stable insert used in app.test.ts)
  await sqlStmt(
    `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
     VALUES (?, ?, ?, 'member', ?, 'own', CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET role = 'member'`
  ).run(
    "20000000-0000-0000-0000-000000000099",
    HOUSEHOLD_ID,
    "member@example.com",
    "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO"
  );
  const res = await request(app).post("/auth/login").send({
    email: "member@example.com",
    password: "ChangeMe123!"
  });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

/**
 * Creates a parsed import session using a two-row generic_tabular CSV.
 * Returns { sessionId, token }.
 */
async function createParsedSession(): Promise<{ sessionId: string; token: string }> {
  const token = await loginToken();

  const sessionRes = await request(app)
    .post("/imports/sessions")
    .set("authorization", `Bearer ${token}`)
    .send({ sourceType: "upload" });
  expect(sessionRes.status).toBe(201);
  const sessionId = sessionRes.body.session.id as string;

  const tag = Date.now();
  const csv = [
    "Date,Description,Amount,Reference",
    `2026-01-15,PAYROLL DIRECT DEPOSIT ${tag},5000.00,ref-1-${tag}`,
    `2026-01-16,AMAZON.COM ${tag},-39.99,ref-2-${tag}`
  ].join("\n");

  const upRes = await request(app)
    .post(`/imports/sessions/${sessionId}/files`)
    .set("authorization", `Bearer ${token}`)
    .attach("files", Buffer.from(csv), "payroll.csv");
  expect(upRes.status).toBe(201);
  const fileId = upRes.body.files[0].id as string;

  const bindRes = await request(app)
    .patch(`/imports/sessions/${sessionId}/files/${fileId}`)
    .set("authorization", `Bearer ${token}`)
    .send({ financialAccountId: SEED_BOA_CHECKING, parserProfileId: "generic_tabular" });
  expect(bindRes.status).toBe(200);

  const parseRes = await request(app)
    .post(`/imports/sessions/${sessionId}/parse`)
    .set("authorization", `Bearer ${token}`)
    .send({
      mapping: {
        date: "Date",
        description: "Description",
        amount: "Amount",
        referenceId: "Reference"
      }
    });
  expect(parseRes.status).toBe(200);

  return { sessionId, token };
}

afterAll(async () => {
  if (createdRuleIds.length > 0) {
    for (const id of createdRuleIds) {
      await sqlStmt(`DELETE FROM category_rule WHERE id = ? AND household_id = ?`).run(id, HOUSEHOLD_ID);
    }
  }
});

// ─── Rule-learning preview ───────────────────────────────────────────────────

describe("POST /categories/rules/rule-learning-preview", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/categories/rules/rule-learning-preview")
      .send({ sessionId: crypto.randomUUID() });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body (non-uuid sessionId)", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/categories/rules/rule-learning-preview")
      .set("authorization", `Bearer ${token}`)
      .send({ sessionId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown sessionId", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/categories/rules/rule-learning-preview")
      .set("authorization", `Bearer ${token}`)
      .send({ sessionId: crypto.randomUUID() });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns classification rows for each raw row after session is parsed", async () => {
    const { sessionId, token } = await createParsedSession();

    const previewRes = await request(app)
      .post("/categories/rules/rule-learning-preview")
      .set("authorization", `Bearer ${token}`)
      .send({ sessionId });

    expect(previewRes.status).toBe(200);
    expect(Array.isArray(previewRes.body.rows)).toBe(true);
    expect(previewRes.body.rows.length).toBe(2);

    const row = previewRes.body.rows[0] as {
      rawId: string;
      fileId: string;
      rowIndex: number;
      txnDate: string;
      amount: number;
      description: string;
      normalizedDescription: string;
      classification: { categoryId: string | null; categoryName: string | null };
    };
    expect(typeof row.rawId).toBe("string");
    expect(typeof row.fileId).toBe("string");
    expect(typeof row.rowIndex).toBe("number");
    expect(typeof row.txnDate).toBe("string");
    expect(typeof row.amount).toBe("number");
    expect(typeof row.description).toBe("string");
    expect(typeof row.normalizedDescription).toBe("string");
    expect(row.classification).toBeDefined();

    // PAYROLL row should be classified as Income>Salary by builtin rules
    // ClassificationResult has { categoryId, ruleId, source, confidence, reason }
    const SALARY_CATEGORY_ID_EXPECTED = "30000000-0000-0000-0000-000000000007";
    const payrollRow = previewRes.body.rows.find((r: { description: string }) =>
      r.description.includes("PAYROLL")
    ) as { classification: { categoryId: string | null; source: string } } | undefined;
    expect(payrollRow).toBeDefined();
    expect(payrollRow?.classification?.categoryId).toBe(SALARY_CATEGORY_ID_EXPECTED);
    expect(payrollRow?.classification?.source).not.toBe("none");
  });

  it("returns 404 when sessionId belongs to a different household", async () => {
    // Create a second household session
    const secondHouseholdId = crypto.randomUUID();
    const secondUserId = crypto.randomUUID();
    const secondEmail = `rl-isolation-${Date.now()}@example.com`;

    await sqlStmt(`INSERT INTO household (id, name) VALUES (?, 'RuleLearning Isolation HH')`).run(
      secondHouseholdId
    );
    await sqlStmt(
      `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope) VALUES (?, ?, ?, 'owner', ?, 'all')`
    ).run(
      secondUserId,
      secondHouseholdId,
      secondEmail,
      "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO"
    );
    await sqlStmt(`UPDATE household SET owner_user_id = ? WHERE id = ?`).run(
      secondUserId,
      secondHouseholdId
    );

    const otherLogin = await request(app).post("/auth/login").send({
      email: secondEmail,
      password: "ChangeMe123!"
    });
    const otherToken = otherLogin.body.token as string;

    const otherSession = await request(app)
      .post("/imports/sessions")
      .set("authorization", `Bearer ${otherToken}`)
      .send({ sourceType: "upload" });
    const otherSessionId = otherSession.body.session.id as string;

    // Owner of the seeded household tries to preview another household's session
    const ownerToken = await loginToken();
    const res = await request(app)
      .post("/categories/rules/rule-learning-preview")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ sessionId: otherSessionId });
    expect(res.status).toBe(404);

    // Cleanup
    await sqlStmt(`DELETE FROM import_session WHERE id = ?`).run(otherSessionId);
    await sqlStmt(`UPDATE household SET owner_user_id = NULL WHERE id = ?`).run(secondHouseholdId);
    await sqlStmt(`DELETE FROM app_user WHERE id = ?`).run(secondUserId);
    await sqlStmt(`DELETE FROM household WHERE id = ?`).run(secondHouseholdId);
  });
});

// ─── Create rule from ledger transaction ─────────────────────────────────────

describe("POST /categories/rules/from-ledger", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post("/categories/rules/from-ledger").send({
      transactionId: crypto.randomUUID(),
      categoryId: SALARY_CATEGORY_ID,
      matchType: "contains",
      scope: "contains"
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for member role", async () => {
    const memberToken = await loginMember();
    const res = await request(app)
      .post("/categories/rules/from-ledger")
      .set("authorization", `Bearer ${memberToken}`)
      .send({
        transactionId: crypto.randomUUID(),
        categoryId: SALARY_CATEGORY_ID,
        matchType: "contains",
        scope: "contains"
      });
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown transactionId", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/categories/rules/from-ledger")
      .set("authorization", `Bearer ${token}`)
      .send({
        transactionId: crypto.randomUUID(),
        categoryId: SALARY_CATEGORY_ID,
        matchType: "contains",
        scope: "contains"
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns 400 when categoryId is a parent (non-leaf) category", async () => {
    const token = await loginToken();

    // Create a manual transaction to reference
    const txnRes = await request(app)
      .post("/transactions")
      .set("authorization", `Bearer ${token}`)
      .send({
        accountId: SEED_BOA_CHECKING,
        txnDate: "2026-01-10",
        amount: -22.5,
        merchant: `FromLedgerParentCat-${Date.now()}`
      });
    expect(txnRes.status).toBe(201);
    const txnId = txnRes.body.id as string;

    try {
      const ruleRes = await request(app)
        .post("/categories/rules/from-ledger")
        .set("authorization", `Bearer ${token}`)
        .send({
          transactionId: txnId,
          categoryId: INCOME_PARENT_CATEGORY_ID, // parent category — not assignable
          matchType: "contains",
          scope: "contains"
        });
      expect(ruleRes.status).toBe(400);
      expect(ruleRes.body.code).toBe("INVALID_CATEGORY");
    } finally {
      await sqlStmt(`DELETE FROM transaction_canonical WHERE id = ?`).run(txnId);
    }
  });

  it("creates a household rule derived from the transaction merchant", async () => {
    const token = await loginToken();
    const merchant = `WholeFoodsFromLedger-${Date.now()}`;

    const txnRes = await request(app)
      .post("/transactions")
      .set("authorization", `Bearer ${token}`)
      .send({
        accountId: SEED_BOA_CHECKING,
        txnDate: "2026-01-11",
        amount: -87.3,
        merchant
      });
    expect(txnRes.status).toBe(201);
    const txnId = txnRes.body.id as string;

    try {
      const ruleRes = await request(app)
        .post("/categories/rules/from-ledger")
        .set("authorization", `Bearer ${token}`)
        .send({
          transactionId: txnId,
          categoryId: SALARY_CATEGORY_ID,
          matchType: "contains",
          scope: "contains"
        });
      expect(ruleRes.status).toBe(201);
      expect(ruleRes.body.rule).toBeDefined();
      expect(typeof ruleRes.body.rule.id).toBe("string");
      expect(ruleRes.body.rule.categoryId).toBe(SALARY_CATEGORY_ID);
      expect(ruleRes.body.rule.matchType).toBe("contains");
      // The pattern is derived from the merchant (normalized)
      expect(typeof ruleRes.body.rule.pattern).toBe("string");
      expect(ruleRes.body.rule.pattern.length).toBeGreaterThan(0);

      createdRuleIds.push(ruleRes.body.rule.id as string);
    } finally {
      await sqlStmt(`DELETE FROM transaction_canonical WHERE id = ?`).run(txnId);
    }
  });
});
