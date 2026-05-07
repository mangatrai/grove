/**
 * Ledger filter combination tests.
 * Uses an isolated test household so results are deterministic and don't
 * bleed into / from other tests that share the seeded household.
 */
import crypto from "node:crypto";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

/** bcrypt hash of "ChangeMe123!" */
const HASH = "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO";

let token = "";

// Stable IDs generated once per test run
const HOUSEHOLD_ID = crypto.randomUUID();
const OWNER_USER_ID = crypto.randomUUID();
const CHECKING_ACCOUNT_ID = crypto.randomUUID();
const CARD_ACCOUNT_ID = crypto.randomUUID();

// Test transaction IDs — referred to in assertions below
const TXN = {
  jan10_checking_debit_50: crypto.randomUUID(),   // Jan 10, BoA checking, debit $50, posted
  jan20_checking_credit_3000: crypto.randomUUID(), // Jan 20, BoA checking, credit $3000, posted
  feb05_checking_debit_200: crypto.randomUUID(),   // Feb 05, BoA checking, debit $200, posted
  jan15_card_debit_30: crypto.randomUUID(),        // Jan 15, card, debit $30, posted
  jan12_checking_debit_15_trashed: crypto.randomUUID() // Jan 12, BoA checking, debit $15, trashed
};

function fp(n: number): string {
  // Fingerprint scoped to the test run's household prefix to avoid collisions
  return `filter-test-${HOUSEHOLD_ID.slice(0, 8)}-${n}`;
}

/** Finds transaction IDs present in a GET /transactions response body. */
function idsInResult(body: { transactions: Array<{ id: string }> }): Set<string> {
  return new Set(body.transactions.map((t) => t.id));
}

beforeAll(async () => {
  // Create isolated household
  await sqlStmt(`INSERT INTO household (id, name, created_at) VALUES (?, 'Ledger Filter Test HH', CURRENT_TIMESTAMP)`).run(HOUSEHOLD_ID);

  await sqlStmt(
    `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
     VALUES (?, ?, ?, 'owner', ?, 'all', CURRENT_TIMESTAMP)`
  ).run(OWNER_USER_ID, HOUSEHOLD_ID, `filter-test-${HOUSEHOLD_ID.slice(0, 8)}@example.com`, HASH);

  await sqlStmt(`UPDATE household SET owner_user_id = ? WHERE id = ?`).run(OWNER_USER_ID, HOUSEHOLD_ID);

  // Create two accounts: checking and credit card
  await sqlStmt(
    `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, currency, created_at)
     VALUES (?, ?, ?, 'checking', 'Filter Bank', 'USD', CURRENT_TIMESTAMP)`
  ).run(CHECKING_ACCOUNT_ID, HOUSEHOLD_ID, OWNER_USER_ID);

  await sqlStmt(
    `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, currency, created_at)
     VALUES (?, ?, ?, 'credit_card', 'Filter Card', 'USD', CURRENT_TIMESTAMP)`
  ).run(CARD_ACCOUNT_ID, HOUSEHOLD_ID, OWNER_USER_ID);

  // Insert test transactions directly via SQL
  const insertTxn = (id: string, accountId: string, txnDate: string, amount: number, direction: string, status: string, fpNum: number) =>
    sqlStmt(
      `INSERT INTO transaction_canonical
         (id, household_id, account_id, txn_date, amount, direction, merchant, status, fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(id, HOUSEHOLD_ID, accountId, txnDate, amount, direction, `FilterMerchant${fpNum}`, status, fp(fpNum));

  await insertTxn(TXN.jan10_checking_debit_50,          CHECKING_ACCOUNT_ID, "2026-01-10",  50,   "debit",  "posted",  1);
  await insertTxn(TXN.jan20_checking_credit_3000,        CHECKING_ACCOUNT_ID, "2026-01-20",  3000, "credit", "posted",  2);
  await insertTxn(TXN.feb05_checking_debit_200,          CHECKING_ACCOUNT_ID, "2026-02-05",  200,  "debit",  "posted",  3);
  await insertTxn(TXN.jan15_card_debit_30,               CARD_ACCOUNT_ID,     "2026-01-15",  30,   "debit",  "posted",  4);
  await insertTxn(TXN.jan12_checking_debit_15_trashed,   CHECKING_ACCOUNT_ID, "2026-01-12",  15,   "debit",  "trashed", 5);

  const loginRes = await request(app).post("/auth/login").send({
    email: `filter-test-${HOUSEHOLD_ID.slice(0, 8)}@example.com`,
    password: "ChangeMe123!"
  });
  expect(loginRes.status).toBe(200);
  token = loginRes.body.token as string;
});

afterAll(async () => {
  // Clean up in FK-safe order
  await sqlStmt(`DELETE FROM transaction_canonical WHERE household_id = ?`).run(HOUSEHOLD_ID);
  await sqlStmt(`DELETE FROM financial_account WHERE household_id = ?`).run(HOUSEHOLD_ID);
  await sqlStmt(`UPDATE household SET owner_user_id = NULL WHERE id = ?`).run(HOUSEHOLD_ID);
  await sqlStmt(`DELETE FROM app_user WHERE household_id = ?`).run(HOUSEHOLD_ID);
  await sqlStmt(`DELETE FROM household WHERE id = ?`).run(HOUSEHOLD_ID);
});

// ─── Date range filters ───────────────────────────────────────────────────────

describe("ledger dateFrom filter", () => {
  it("returns only transactions on or after dateFrom", async () => {
    const res = await request(app)
      .get("/transactions?dateFrom=2026-01-20&limit=200")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan20_checking_credit_3000)).toBe(true);  // Jan 20 = boundary, included
    expect(ids.has(TXN.feb05_checking_debit_200)).toBe(true);    // Feb 05 > Jan 20, included
    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(false);    // Jan 10 < Jan 20, excluded
    expect(ids.has(TXN.jan15_card_debit_30)).toBe(false);        // Jan 15 < Jan 20, excluded
    expect(ids.has(TXN.jan12_checking_debit_15_trashed)).toBe(false); // trashed, always excluded
  });
});

describe("ledger dateTo filter", () => {
  it("returns only transactions on or before dateTo", async () => {
    const res = await request(app)
      .get("/transactions?dateTo=2026-01-15&limit=200")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(true);     // Jan 10 <= Jan 15, included
    expect(ids.has(TXN.jan15_card_debit_30)).toBe(true);          // Jan 15 = boundary, included
    expect(ids.has(TXN.jan20_checking_credit_3000)).toBe(false);  // Jan 20 > Jan 15, excluded
    expect(ids.has(TXN.feb05_checking_debit_200)).toBe(false);    // Feb 05 > Jan 15, excluded
  });
});

describe("ledger dateFrom + dateTo combined", () => {
  it("returns only transactions within the inclusive date window", async () => {
    const res = await request(app)
      .get("/transactions?dateFrom=2026-01-15&dateTo=2026-01-20&limit=200")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan15_card_debit_30)).toBe(true);          // Jan 15, in range
    expect(ids.has(TXN.jan20_checking_credit_3000)).toBe(true);   // Jan 20, in range
    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(false);     // Jan 10, before range
    expect(ids.has(TXN.feb05_checking_debit_200)).toBe(false);    // Feb 05, after range
  });
});

// ─── Account filter ───────────────────────────────────────────────────────────

describe("ledger accountId filter", () => {
  it("returns only transactions for the specified checking account", async () => {
    const res = await request(app)
      .get(`/transactions?accountId=${CHECKING_ACCOUNT_ID}&limit=200`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(true);
    expect(ids.has(TXN.jan20_checking_credit_3000)).toBe(true);
    expect(ids.has(TXN.feb05_checking_debit_200)).toBe(true);
    expect(ids.has(TXN.jan15_card_debit_30)).toBe(false);  // different account
  });

  it("returns only transactions for the specified card account", async () => {
    const res = await request(app)
      .get(`/transactions?accountId=${CARD_ACCOUNT_ID}&limit=200`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan15_card_debit_30)).toBe(true);
    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(false);
    expect(ids.has(TXN.jan20_checking_credit_3000)).toBe(false);
  });
});

// ─── Amount filters ───────────────────────────────────────────────────────────

describe("ledger amountMin filter", () => {
  it("excludes transactions below the minimum amount", async () => {
    const res = await request(app)
      .get("/transactions?amountMin=100&limit=200")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan20_checking_credit_3000)).toBe(true);  // 3000 >= 100
    expect(ids.has(TXN.feb05_checking_debit_200)).toBe(true);    // 200 >= 100
    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(false);    // 50 < 100
    expect(ids.has(TXN.jan15_card_debit_30)).toBe(false);        // 30 < 100
  });
});

describe("ledger amountMax filter", () => {
  it("excludes transactions above the maximum amount", async () => {
    const res = await request(app)
      .get("/transactions?amountMax=50&limit=200")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(true);     // 50 <= 50
    expect(ids.has(TXN.jan15_card_debit_30)).toBe(true);         // 30 <= 50
    expect(ids.has(TXN.feb05_checking_debit_200)).toBe(false);   // 200 > 50
    expect(ids.has(TXN.jan20_checking_credit_3000)).toBe(false); // 3000 > 50
  });
});

describe("ledger amountMin + amountMax combined", () => {
  it("returns only transactions within the amount band", async () => {
    const res = await request(app)
      .get("/transactions?amountMin=25&amountMax=60&limit=200")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(true);     // 25 <= 50 <= 60
    expect(ids.has(TXN.jan15_card_debit_30)).toBe(true);         // 25 <= 30 <= 60
    expect(ids.has(TXN.feb05_checking_debit_200)).toBe(false);   // 200 > 60
    expect(ids.has(TXN.jan20_checking_credit_3000)).toBe(false); // 3000 > 60
  });
});

// ─── trashOnly filter ─────────────────────────────────────────────────────────

describe("ledger trashOnly filter", () => {
  it("returns only trashed rows when trashOnly=true", async () => {
    const res = await request(app)
      .get("/transactions?trashOnly=true&limit=200")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan12_checking_debit_15_trashed)).toBe(true);
    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(false);
    expect(ids.has(TXN.jan15_card_debit_30)).toBe(false);
  });

  it("excludes trashed rows from default (non-trashOnly) query", async () => {
    const res = await request(app)
      .get("/transactions?limit=200")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan12_checking_debit_15_trashed)).toBe(false);
  });
});

// ─── Combined filters ─────────────────────────────────────────────────────────

describe("combined accountId + dateFrom filter", () => {
  it("narrows results to one account within the date window", async () => {
    const res = await request(app)
      .get(`/transactions?accountId=${CHECKING_ACCOUNT_ID}&dateFrom=2026-01-15&limit=200`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = idsInResult(res.body);

    expect(ids.has(TXN.jan20_checking_credit_3000)).toBe(true);   // checking, Jan 20 >= Jan 15
    expect(ids.has(TXN.feb05_checking_debit_200)).toBe(true);     // checking, Feb 05 >= Jan 15
    expect(ids.has(TXN.jan10_checking_debit_50)).toBe(false);     // checking but Jan 10 < Jan 15
    expect(ids.has(TXN.jan15_card_debit_30)).toBe(false);         // wrong account (card)
  });
});

// ─── Input validation errors ─────────────────────────────────────────────────

describe("ledger query validation errors", () => {
  it("returns 400 when both categoryId and uncategorizedOnly are set", async () => {
    const res = await request(app)
      .get(`/transactions?categoryId=${crypto.randomUUID()}&uncategorizedOnly=true`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("returns 400 when resolutionType is set without needsReview=true", async () => {
    const res = await request(app)
      .get("/transactions?resolutionType=unknown_category")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
