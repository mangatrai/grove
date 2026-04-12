import crypto from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const ACCOUNT_ID = "40000000-0000-0000-0000-000000000001"; // BOA Checking (dev seed)

// Leaf categories from bootstrap seed (stable UUIDs)
const CAT_DINING = "30000000-0000-0000-0000-000000000023"; // Dining out → Food
const CAT_COFFEE = "30000000-0000-0000-0000-000000000024"; // Coffee → Food

async function login(): Promise<string> {
  const res = await request(app)
    .post("/auth/login")
    .send({ email: "owner@example.com", password: "ChangeMe123!" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

/** Insert a posted debit into transaction_canonical (debit = negative amount, canonical convention). */
async function insertDebit(opts: {
  id?: string;
  txnDate: string;
  amount: number; // pass as positive — negated here before insert
  categoryId: string;
  memo?: string;
}) {
  const id = opts.id ?? crypto.randomUUID();
  const fp = crypto.createHash("sha256").update(id).digest("hex");
  await sqlStmt(
    `INSERT INTO transaction_canonical
       (id, household_id, account_id, txn_date, amount, direction, memo, fingerprint, status, category_id, owner_scope)
     VALUES (?, ?, ?, ?, ?, 'debit', ?, ?, 'posted', ?, 'household')
     ON CONFLICT DO NOTHING`
  ).run(id, HOUSEHOLD_ID, ACCOUNT_ID, opts.txnDate, -(opts.amount), opts.memo ?? "test", fp, opts.categoryId);
  return id;
}

/** Delete test transactions inserted by these tests to keep the DB clean. */
const insertedIds: string[] = [];
afterEach(async () => {
  if (insertedIds.length) {
    for (const id of insertedIds) {
      await sqlStmt(`DELETE FROM transaction_canonical WHERE id = ?`).run(id);
    }
    insertedIds.length = 0;
  }
  // Clean up budget rows created during tests
  await sqlStmt(
    `DELETE FROM budget_category WHERE household_id = ? AND month LIKE '2099-%'`
  ).run(HOUSEHOLD_ID);
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe("budget auth guard", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/budget/2026-03");
    expect(res.status).toBe(401);
  });
});

// ── Month format validation ───────────────────────────────────────────────────

describe("budget month format validation", () => {
  it("rejects invalid month on GET /:month", async () => {
    const token = await login();
    const res = await request(app)
      .get("/budget/not-a-month")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("rejects invalid month on PUT /:month", async () => {
    const token = await login();
    const res = await request(app)
      .put("/budget/2026-3")
      .set("authorization", `Bearer ${token}`)
      .send({ entries: [] });
    expect(res.status).toBe(400);
  });

  it("rejects invalid month on GET /suggest", async () => {
    const token = await login();
    const res = await request(app)
      .get("/budget/suggest?month=March")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

// ── GET /budget/suggest ───────────────────────────────────────────────────────

describe("GET /budget/suggest", () => {
  it("returns empty suggestions when no debit data exists in 24-month window", async () => {
    const token = await login();
    // Use a far-future month so no real data is in the window
    const res = await request(app)
      .get("/budget/suggest?month=2099-06")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.month).toBe("2099-06");
    expect(res.body.dataAsOf).toBeNull();
    expect(res.body.suggestions).toEqual([]);
  });

  it("returns positive suggestedAmount despite debits stored as negative", async () => {
    const token = await login();
    // Insert debits in 2099-02 so they are in the 24-month window of 2099-03
    const id1 = await insertDebit({ txnDate: "2099-02-10", amount: 45.50, categoryId: CAT_DINING });
    const id2 = await insertDebit({ txnDate: "2099-02-15", amount: 12.00, categoryId: CAT_COFFEE });
    const id3 = await insertDebit({ txnDate: "2099-02-20", amount: 30.00, categoryId: CAT_DINING });
    insertedIds.push(id1, id2, id3);

    const res = await request(app)
      .get("/budget/suggest?month=2099-03")
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.dataAsOf).toBe("2099-02");

    const suggestions: Array<{
      categoryId: string;
      categoryName: string;
      suggestedAmount: number;
      lastMonthActual: number;
    }> = res.body.suggestions;

    expect(suggestions.length).toBeGreaterThanOrEqual(2);

    // All suggested amounts must be positive (the key invariant after the sign fix)
    for (const s of suggestions) {
      expect(s.suggestedAmount).toBeGreaterThan(0);
      expect(s.lastMonthActual).toBeGreaterThanOrEqual(0);
    }

    const dining = suggestions.find((s) => s.categoryId === CAT_DINING);
    expect(dining).toBeDefined();
    expect(dining!.categoryName).toBe("Dining out");
    // 45.50 + 30.00 = 75.50 in anchor month → last_month basis
    expect(dining!.suggestedAmount).toBeCloseTo(75.5, 1);
    expect(dining!.lastMonthActual).toBeCloseTo(75.5, 1);

    const coffee = suggestions.find((s) => s.categoryId === CAT_COFFEE);
    expect(coffee).toBeDefined();
    expect(coffee!.suggestedAmount).toBeCloseTo(12.0, 1);
  });

  it("dynamic anchor uses most recent data month, not calendar month-1", async () => {
    const token = await login();
    // Insert data in 2099-01 only — well before calendar 2099-03
    const id1 = await insertDebit({ txnDate: "2099-01-05", amount: 60.00, categoryId: CAT_DINING });
    insertedIds.push(id1);

    // Suggest for 2099-03 — anchor should find 2099-01, not fail
    const res = await request(app)
      .get("/budget/suggest?month=2099-03")
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.dataAsOf).toBe("2099-01");
    expect(res.body.suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it("only returns categories that exist in the category table (LEFT JOIN guard)", async () => {
    // Full simulation of dangling category_id (post-restore state) is not achievable in a
    // FK-enforced test DB — Postgres rejects UPDATE ... SET category_id = <non-existent-uuid>.
    // The guard is implemented as LEFT JOIN + .filter(r => r.category_name != null) in
    // budget.service.ts. We verify the positive case: valid categories appear in suggestions.
    const token = await login();
    const id1 = await insertDebit({ txnDate: "2099-02-10", amount: 25.00, categoryId: CAT_COFFEE });
    insertedIds.push(id1);

    const res = await request(app)
      .get("/budget/suggest?month=2099-03")
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const catIds = (res.body.suggestions as Array<{ categoryId: string; categoryName: string }>)
      .map((s) => s.categoryId);
    expect(catIds).toContain(CAT_COFFEE);
    // Every returned row must have a non-empty categoryName (LEFT JOIN filter proof)
    for (const s of res.body.suggestions) {
      expect(typeof s.categoryName).toBe("string");
      expect(s.categoryName.length).toBeGreaterThan(0);
    }
  });
});

// ── PUT + GET /budget/:month ──────────────────────────────────────────────────

describe("PUT /budget/:month and GET /budget/:month", () => {
  it("saves a budget and returns exists=true with correct structure", async () => {
    const token = await login();
    const month = "2099-05";

    const putRes = await request(app)
      .put(`/budget/${month}`)
      .set("authorization", `Bearer ${token}`)
      .send({
        entries: [
          { categoryId: CAT_DINING, amount: 300 },
          { categoryId: CAT_COFFEE, amount: 80 }
        ]
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.exists).toBe(true);
    expect(putRes.body.month).toBe(month);
    expect(putRes.body.summary.totalBudgeted).toBeCloseTo(380, 1);
    expect(Array.isArray(putRes.body.categories)).toBe(true);
    expect(putRes.body.categories.length).toBe(2);

    const dining = putRes.body.categories.find((c: { categoryId: string }) => c.categoryId === CAT_DINING);
    expect(dining).toBeDefined();
    expect(dining.budgeted).toBeCloseTo(300, 1);
    expect(dining.categoryName).toBe("Dining out");
  });

  it("replaces existing budget on second PUT", async () => {
    const token = await login();
    const month = "2099-05";

    await request(app)
      .put(`/budget/${month}`)
      .set("authorization", `Bearer ${token}`)
      .send({ entries: [{ categoryId: CAT_DINING, amount: 300 }] });

    const putRes2 = await request(app)
      .put(`/budget/${month}`)
      .set("authorization", `Bearer ${token}`)
      .send({ entries: [{ categoryId: CAT_COFFEE, amount: 50 }] });

    expect(putRes2.status).toBe(200);
    expect(putRes2.body.categories.length).toBe(1);
    expect(putRes2.body.categories[0].categoryId).toBe(CAT_COFFEE);
    // Dining should be gone
    const dining = putRes2.body.categories.find((c: { categoryId: string }) => c.categoryId === CAT_DINING);
    expect(dining).toBeUndefined();
  });

  it("clearing a budget (empty entries) sets exists=false", async () => {
    const token = await login();
    const month = "2099-05";

    await request(app)
      .put(`/budget/${month}`)
      .set("authorization", `Bearer ${token}`)
      .send({ entries: [{ categoryId: CAT_DINING, amount: 200 }] });

    const clearRes = await request(app)
      .put(`/budget/${month}`)
      .set("authorization", `Bearer ${token}`)
      .send({ entries: [] });

    expect(clearRes.status).toBe(200);
    expect(clearRes.body.exists).toBe(false);
  });

  it("GET /:month returns exists=false when no budget set", async () => {
    const token = await login();
    const res = await request(app)
      .get("/budget/2099-07")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.summary.totalBudgeted).toBe(0);
  });

  it("actuals: spent is positive magnitude even though debits are stored negative", async () => {
    const token = await login();
    const month = "2099-05";

    // Save a budget for dining
    await request(app)
      .put(`/budget/${month}`)
      .set("authorization", `Bearer ${token}`)
      .send({ entries: [{ categoryId: CAT_DINING, amount: 300 }] });

    // Insert debit transactions in that month (negative amounts = canonical)
    const id1 = await insertDebit({ txnDate: "2099-05-10", amount: 45.00, categoryId: CAT_DINING });
    const id2 = await insertDebit({ txnDate: "2099-05-20", amount: 55.00, categoryId: CAT_DINING });
    insertedIds.push(id1, id2);

    const getRes = await request(app)
      .get(`/budget/${month}`)
      .set("authorization", `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    const dining = getRes.body.categories.find((c: { categoryId: string }) => c.categoryId === CAT_DINING);
    expect(dining).toBeDefined();
    expect(dining.spent).toBeCloseTo(100.0, 1);       // positive magnitude
    expect(dining.budgeted).toBeCloseTo(300.0, 1);
    expect(dining.remaining).toBeCloseTo(200.0, 1);
    expect(dining.percentUsed).toBeCloseTo(33.3, 0);

    // summary totals must also be correct
    expect(getRes.body.summary.totalSpent).toBeCloseTo(100.0, 1);
  });

  it("unbudgeted spend tracked in summary.unbudgetedSpend", async () => {
    const token = await login();
    const month = "2099-05";

    // Budget only dining; insert coffee debit (unbudgeted)
    await request(app)
      .put(`/budget/${month}`)
      .set("authorization", `Bearer ${token}`)
      .send({ entries: [{ categoryId: CAT_DINING, amount: 200 }] });

    const unbudgetedId = await insertDebit({ txnDate: "2099-05-05", amount: 15.00, categoryId: CAT_COFFEE });
    insertedIds.push(unbudgetedId);

    const getRes = await request(app)
      .get(`/budget/${month}`)
      .set("authorization", `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.summary.unbudgetedSpend).toBeCloseTo(15.0, 1);
  });
});

// ── GET /budget/months ────────────────────────────────────────────────────────

describe("GET /budget/months", () => {
  it("lists months with budgets, newest first", async () => {
    const token = await login();

    await request(app)
      .put("/budget/2099-05")
      .set("authorization", `Bearer ${token}`)
      .send({ entries: [{ categoryId: CAT_DINING, amount: 100 }] });

    await request(app)
      .put("/budget/2099-04")
      .set("authorization", `Bearer ${token}`)
      .send({ entries: [{ categoryId: CAT_COFFEE, amount: 50 }] });

    const res = await request(app)
      .get("/budget/months")
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const months = res.body.months as Array<{ month: string; totalBudgeted: number }>;
    const testMonths = months.filter((m) => m.month.startsWith("2099-"));
    expect(testMonths.length).toBeGreaterThanOrEqual(2);
    // Newest first
    const idx05 = testMonths.findIndex((m) => m.month === "2099-05");
    const idx04 = testMonths.findIndex((m) => m.month === "2099-04");
    expect(idx05).toBeLessThan(idx04);
    expect(testMonths.find((m) => m.month === "2099-05")!.totalBudgeted).toBeCloseTo(100, 1);
  });
});
