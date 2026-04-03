import crypto from "node:crypto";

import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { db } from "../src/db/sqlite.js";

const app = buildApp();
const SEED_BOA_CHECKING = "40000000-0000-0000-0000-000000000001";
const GROCERIES_ID = "30000000-0000-0000-0000-000000000004";
/** Built-in rules target Energy under Utilities for generic utility debit patterns. */
const UTILITIES_ENERGY_ID = "30000000-0000-0000-0000-000000000118";
const PARENT_INCOME_ID = "30000000-0000-0000-0000-000000000001";

async function loginAndGetToken(): Promise<string> {
  const response = await request(app).post("/auth/login").send({
    email: "owner@example.com",
    password: "ChangeMe123!"
  });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

async function createSessionWithCsv(token: string, csv: string): Promise<string> {
  const sessionRes = await request(app).post("/imports/sessions").set("authorization", `Bearer ${token}`).send({
    sourceType: "upload"
  });
  expect(sessionRes.status).toBe(201);
  const sessionId = sessionRes.body.session.id as string;

  const uploadRes = await request(app)
    .post(`/imports/sessions/${sessionId}/files`)
    .set("authorization", `Bearer ${token}`)
    .attach("files", Buffer.from(csv), "rules-test.csv");
  expect(uploadRes.status).toBe(201);
  const fileId = uploadRes.body.files[0].id as string;

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
  return sessionId;
}

describe("category rules API and classification explainability", () => {
  it("supports list/create/update (enable-disable) category rules", async () => {
    const token = await loginAndGetToken();

    const createRes = await request(app).post("/categories/rules").set("authorization", `Bearer ${token}`).send({
      pattern: "whole foods",
      matchType: "contains",
      categoryId: GROCERIES_ID,
      confidence: 0.9,
      priority: 10,
      enabled: true
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.rule.enabled).toBe(true);
    const ruleId = createRes.body.rule.id as string;

    const listRes = await request(app).get("/categories/rules").set("authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.builtinRules)).toBe(true);
    expect(listRes.body.builtinRules.length).toBeGreaterThan(0);
    expect(listRes.body.rules.some((r: { id: string }) => r.id === ruleId)).toBe(true);

    const disableRes = await request(app)
      .patch(`/categories/rules/${ruleId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ enabled: false, confidence: 0.65 });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.rule.enabled).toBe(false);
    expect(disableRes.body.rule.confidence).toBe(0.65);
  });

  it("rejects unusable category in rule create (parent category)", async () => {
    const token = await loginAndGetToken();
    const createRes = await request(app).post("/categories/rules").set("authorization", `Bearer ${token}`).send({
      pattern: "salary",
      matchType: "contains",
      categoryId: PARENT_INCOME_ID
    });
    expect(createRes.status).toBe(400);
    expect(createRes.body.code).toBe("INVALID_CATEGORY");
  });

  it("uses DB rule precedence before defaults during canonicalize", async () => {
    const token = await loginAndGetToken();
    const household = db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };
    const ruleId = crypto.randomUUID();
    const patternToken = `dbpri${Date.now()}`;
    db.prepare(
      `INSERT INTO category_rule
         (id, household_id, pattern, match_type, category_id, confidence, priority, enabled, created_at, updated_at)
       VALUES (?, ?, ?, 'contains', ?, 0.99, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(ruleId, household.household_id, patternToken, UTILITIES_ENERGY_ID);

    const txnDate = new Date(Date.UTC(2026, 4, 1 + (Date.now() % 300))).toISOString().slice(0, 10);
    const sessionId = await createSessionWithCsv(
      token,
      [
        "Date,Description,Amount,Reference",
        `${txnDate},${patternToken} store,-5.00,db-priority-${Date.now()}`
      ].join("\n")
    );

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);

    const row = db
      .prepare(
        `SELECT tc.category_id AS categoryId, tc.classification_meta AS classificationMeta
         FROM transaction_canonical tc
         INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
         INNER JOIN import_file f ON tr.file_id = f.id
         WHERE f.session_id = ?
         LIMIT 1`
      )
      .get(sessionId) as { categoryId: string | null; classificationMeta: string | null } | undefined;
    expect(row?.categoryId).toBe(UTILITIES_ENERGY_ID);
    expect(row?.classificationMeta).toBeTruthy();
    const meta = JSON.parse(row!.classificationMeta!) as { source?: string; ruleId?: string; confidence?: number };
    expect(meta.source).toBe("household");
    expect(meta.ruleId).toBe(ruleId);
    expect(meta.confidence).toBeCloseTo(0.99);
  });

  it("returns explainability metadata for unknown category queue items when available", async () => {
    const token = await loginAndGetToken();
    const sessionId = await createSessionWithCsv(
      token,
      ["Date,Description,Amount,Reference", "2026-03-02,MYSTERY UNSORTED CHARGE,-31.44,unknown-1"].join("\n")
    );

    const canRes = await request(app)
      .post(`/imports/sessions/${sessionId}/canonicalize`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(canRes.status).toBe(200);

    const queueRes = await request(app)
      .get("/resolution?status=all&type=unknown_category")
      .set("authorization", `Bearer ${token}`);
    expect(queueRes.status).toBe(200);
    const row = (
      queueRes.body.items as Array<{
        targetId: string;
        context?: { raw?: { description?: string | null }; classification?: { source?: string } };
      }>
    ).find((x) => x.context?.raw?.description?.includes("MYSTERY UNSORTED CHARGE"));
    expect(row).toBeTruthy();
    expect(row?.context?.classification?.source).toBe("none");
  });

  it("creates multiple rules from comma-separated patterns", async () => {
    const token = await loginAndGetToken();
    const createRes = await request(app).post("/categories/rules").set("authorization", `Bearer ${token}`).send({
      patterns: "alphaunique1, betaunique2",
      matchType: "contains",
      categoryId: GROCERIES_ID,
      priority: 200
    });
    expect(createRes.status).toBe(201);
    expect(Array.isArray(createRes.body.rules)).toBe(true);
    expect(createRes.body.rules.length).toBe(2);
  });

  it("classifies a test description via POST /categories/rules/test", async () => {
    const token = await loginAndGetToken();
    const testRes = await request(app).post("/categories/rules/test").set("authorization", `Bearer ${token}`).send({
      description: "WHOLE FOODS MARKET",
      signedAmount: -12.34
    });
    expect(testRes.status).toBe(200);
    expect(testRes.body.normalizedDescription).toContain("whole");
    expect(testRes.body.classification.source).toBe("builtin");
  });

  it("rejects household-scoped category for built-in rule (BUILTIN_REQUIRES_GLOBAL_LEAF)", async () => {
    const token = await loginAndGetToken();
    const household = db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };
    const customLeafId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO category (id, household_id, parent_id, name, is_default)
       VALUES (?, ?, '30000000-0000-0000-0000-000000000107', 'API test household leaf', 0)`
    ).run(customLeafId, household.household_id);
    try {
      const createRes = await request(app).post("/categories/rules/builtin").set("authorization", `Bearer ${token}`).send({
        ruleKey: `hh_cat_${Date.now()}`,
        pattern: `hh_cat_pat_${Date.now()}`,
        matchType: "contains",
        categoryId: customLeafId,
        amountScope: "debit_only"
      });
      expect(createRes.status).toBe(400);
      expect(createRes.body.code).toBe("BUILTIN_REQUIRES_GLOBAL_LEAF");
      expect(String(createRes.body.message)).toContain("household");
    } finally {
      db.prepare(`DELETE FROM category WHERE id = ?`).run(customLeafId);
    }
  });

  it("allows owner to create and delete a global built-in rule", async () => {
    const token = await loginAndGetToken();
    const key = `api_test_${Date.now()}`;
    const createRes = await request(app).post("/categories/rules/builtin").set("authorization", `Bearer ${token}`).send({
      ruleKey: key,
      pattern: key,
      matchType: "contains",
      categoryId: GROCERIES_ID,
      amountScope: "debit_only",
      priority: 9999,
      confidence: 0.75,
      enabled: true
    });
    expect(createRes.status).toBe(201);
    const id = createRes.body.rule.id as string;

    const delRes = await request(app).delete(`/categories/rules/builtin/${id}`).set("authorization", `Bearer ${token}`);
    expect(delRes.status).toBe(204);
  });

  it("POST /categories/rules/bulk creates via categoryPath and reports row errors", async () => {
    const token = await loginAndGetToken();
    const t = Date.now();
    const res = await request(app).post("/categories/rules/bulk").set("authorization", `Bearer ${token}`).send({
      rules: [
        { pattern: `bulk_path_ok_${t}`, matchType: "contains", categoryPath: "Shopping > Groceries" },
        { pattern: "x", matchType: "contains", categoryPath: "Shopping > Groceries" }
      ]
    });
    expect(res.status).toBe(200);
    expect(res.body.created.length).toBe(1);
    expect(res.body.errors.length).toBe(1);
    expect(res.body.errors[0].index).toBe(1);
  });

  it("POST /categories/rules/builtin/bulk rejects household-only leaf with BUILTIN_REQUIRES_GLOBAL_LEAF", async () => {
    const token = await loginAndGetToken();
    const household = db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    };
    const customLeafId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO category (id, household_id, parent_id, name, is_default)
       VALUES (?, ?, '30000000-0000-0000-0000-000000000107', 'Bulk builtin hh leaf', 0)`
    ).run(customLeafId, household.household_id);
    try {
      const res = await request(app).post("/categories/rules/builtin/bulk").set("authorization", `Bearer ${token}`).send({
        rules: [
          {
            pattern: `bulk_builtin_ok_${Date.now()}`,
            matchType: "contains",
            categoryId: GROCERIES_ID,
            amountScope: "debit_only"
          },
          {
            pattern: `bulk_builtin_bad_${Date.now()}`,
            matchType: "contains",
            categoryId: customLeafId,
            amountScope: "debit_only"
          }
        ]
      });
      expect(res.status).toBe(200);
      expect(res.body.created.length).toBe(1);
      expect(res.body.errors.length).toBe(1);
      expect(res.body.errors[0].code).toBe("BUILTIN_REQUIRES_GLOBAL_LEAF");
    } finally {
      db.prepare(`DELETE FROM category WHERE id = ?`).run(customLeafId);
    }
  });

  it("blocks member from creating global built-in rules", async () => {
    db.prepare(
      `INSERT OR REPLACE INTO app_user
       (id, household_id, email, role, password_hash, visibility_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(
      "20000000-0000-0000-0000-000000000099",
      "10000000-0000-0000-0000-000000000001",
      "member@example.com",
      "member",
      "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO",
      "own"
    );
    const login = await request(app).post("/auth/login").send({
      email: "member@example.com",
      password: "ChangeMe123!"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const bulkRes = await request(app).post("/categories/rules/builtin/bulk").set("authorization", `Bearer ${token}`).send({
      rules: [{ pattern: "member_bulk_fail", matchType: "contains", categoryId: GROCERIES_ID, amountScope: "any" }]
    });
    expect(bulkRes.status).toBe(403);
    const createRes = await request(app).post("/categories/rules/builtin").set("authorization", `Bearer ${token}`).send({
      ruleKey: "member_should_fail",
      pattern: "member_should_fail",
      matchType: "contains",
      categoryId: GROCERIES_ID,
      amountScope: "debit_only"
    });
    expect(createRes.status).toBe(403);
  });
});
