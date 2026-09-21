/**
 * GH #294 — auto-linked Wallet deposit when a transaction is categorized as
 * Transfers > Cash withdrawal. Uses an isolated test household so results are
 * deterministic and don't bleed into / from other tests that share the seeded household.
 */
import crypto from "node:crypto";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { sqlStmt } from "./pg-stmt.js";

const app = buildApp();

/** bcrypt hash of "ChangeMe123!" */
const HASH = "$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO";

const CASH_WITHDRAWAL = "30000000-0000-0000-0000-000000000163";
const CASH_DEPOSIT = "30000000-0000-0000-0000-000000000170";
const GROCERIES = "30000000-0000-0000-0000-000000000004";

const HOUSEHOLD_ID = crypto.randomUUID();
const OWNER_USER_ID = crypto.randomUUID();
const CHECKING_ACCOUNT_ID = crypto.randomUUID();
const CASH_ACCOUNT_ID = crypto.randomUUID();

// Second household with no cash account, to test the no-op path.
const HOUSEHOLD_NO_CASH_ID = crypto.randomUUID();
const OWNER_NO_CASH_USER_ID = crypto.randomUUID();
const CHECKING_NO_CASH_ACCOUNT_ID = crypto.randomUUID();

let token = "";
let tokenNoCash = "";

function fp(n: number): string {
  return `cash-link-test-${HOUSEHOLD_ID.slice(0, 8)}-${n}`;
}

async function insertWithdrawal(id: string, amount: number, fpNum: number): Promise<void> {
  await sqlStmt(
    `INSERT INTO transaction_canonical
       (id, household_id, account_id, txn_date, amount, direction, merchant, status, fingerprint, created_at)
     VALUES (?, ?, ?, '2026-06-15', ?, 'debit', 'ATM WITHDRAWAL', 'posted', ?, CURRENT_TIMESTAMP)`
  ).run(id, HOUSEHOLD_ID, CHECKING_ACCOUNT_ID, amount, fp(fpNum));
}

async function cashBalance(): Promise<number> {
  const row = await sqlStmt(
    `SELECT amount FROM account_balance_snapshot
     WHERE financial_account_id = ? ORDER BY as_of_date DESC, updated_at DESC LIMIT 1`
  ).get<{ amount: string }>(CASH_ACCOUNT_ID);
  return row ? Number(row.amount) : 0;
}

async function txnRow(id: string): Promise<
  | {
      category_id: string | null;
      transfer_group_id: string | null;
      status: string;
      auto_generated: boolean;
      amount: string;
      account_id: string;
    }
  | undefined
> {
  return sqlStmt(
    `SELECT category_id, transfer_group_id, status, auto_generated, amount, account_id
     FROM transaction_canonical WHERE id = ?`
  ).get(id);
}

beforeAll(async () => {
  await sqlStmt(`INSERT INTO household (id, name, created_at) VALUES (?, 'Cash Link Test HH', CURRENT_TIMESTAMP)`).run(
    HOUSEHOLD_ID
  );
  await sqlStmt(
    `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
     VALUES (?, ?, ?, 'owner', ?, 'all', CURRENT_TIMESTAMP)`
  ).run(OWNER_USER_ID, HOUSEHOLD_ID, `cash-link-test-${HOUSEHOLD_ID.slice(0, 8)}@example.com`, HASH);
  await sqlStmt(`UPDATE household SET owner_user_id = ? WHERE id = ?`).run(OWNER_USER_ID, HOUSEHOLD_ID);

  await sqlStmt(
    `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, currency, created_at)
     VALUES (?, ?, ?, 'checking', 'Cash Link Bank', 'USD', CURRENT_TIMESTAMP)`
  ).run(CHECKING_ACCOUNT_ID, HOUSEHOLD_ID, OWNER_USER_ID);
  await sqlStmt(
    `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, currency, created_at)
     VALUES (?, ?, ?, 'cash', 'Wallet', 'USD', CURRENT_TIMESTAMP)`
  ).run(CASH_ACCOUNT_ID, HOUSEHOLD_ID, OWNER_USER_ID);

  const loginRes = await request(app).post("/auth/login").send({
    email: `cash-link-test-${HOUSEHOLD_ID.slice(0, 8)}@example.com`,
    password: "ChangeMe123!"
  });
  expect(loginRes.status).toBe(200);
  token = loginRes.body.token as string;

  // Second household: checking account only, no cash/wallet account.
  await sqlStmt(`INSERT INTO household (id, name, created_at) VALUES (?, 'No Cash Test HH', CURRENT_TIMESTAMP)`).run(
    HOUSEHOLD_NO_CASH_ID
  );
  await sqlStmt(
    `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
     VALUES (?, ?, ?, 'owner', ?, 'all', CURRENT_TIMESTAMP)`
  ).run(
    OWNER_NO_CASH_USER_ID,
    HOUSEHOLD_NO_CASH_ID,
    `no-cash-test-${HOUSEHOLD_NO_CASH_ID.slice(0, 8)}@example.com`,
    HASH
  );
  await sqlStmt(`UPDATE household SET owner_user_id = ? WHERE id = ?`).run(OWNER_NO_CASH_USER_ID, HOUSEHOLD_NO_CASH_ID);
  await sqlStmt(
    `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, currency, created_at)
     VALUES (?, ?, ?, 'checking', 'No Cash Bank', 'USD', CURRENT_TIMESTAMP)`
  ).run(CHECKING_NO_CASH_ACCOUNT_ID, HOUSEHOLD_NO_CASH_ID, OWNER_NO_CASH_USER_ID);
  await sqlStmt(
    `INSERT INTO transaction_canonical
       (id, household_id, account_id, txn_date, amount, direction, merchant, status, fingerprint, created_at)
     VALUES (?, ?, ?, '2026-06-15', -60, 'debit', 'ATM WITHDRAWAL', 'posted', ?, CURRENT_TIMESTAMP)`
  ).run(crypto.randomUUID(), HOUSEHOLD_NO_CASH_ID, CHECKING_NO_CASH_ACCOUNT_ID, `no-cash-test-${HOUSEHOLD_NO_CASH_ID.slice(0, 8)}-1`);

  const loginResNoCash = await request(app).post("/auth/login").send({
    email: `no-cash-test-${HOUSEHOLD_NO_CASH_ID.slice(0, 8)}@example.com`,
    password: "ChangeMe123!"
  });
  expect(loginResNoCash.status).toBe(200);
  tokenNoCash = loginResNoCash.body.token as string;
});

afterAll(async () => {
  for (const hh of [HOUSEHOLD_ID, HOUSEHOLD_NO_CASH_ID]) {
    await sqlStmt(`DELETE FROM account_balance_snapshot WHERE household_id = ?`).run(hh);
    await sqlStmt(`DELETE FROM transaction_canonical WHERE household_id = ?`).run(hh);
    await sqlStmt(`DELETE FROM financial_account WHERE household_id = ?`).run(hh);
    await sqlStmt(`UPDATE household SET owner_user_id = NULL WHERE id = ?`).run(hh);
    await sqlStmt(`DELETE FROM app_user WHERE household_id = ?`).run(hh);
    await sqlStmt(`DELETE FROM household WHERE id = ?`).run(hh);
  }
});

describe("categorizing as Cash withdrawal auto-links a Wallet deposit", () => {
  it("creates a linked deposit and increases the cash balance", async () => {
    const withdrawalId = crypto.randomUUID();
    await insertWithdrawal(withdrawalId, -100, 1);

    const res = await request(app)
      .patch(`/transactions/${withdrawalId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ categoryId: CASH_WITHDRAWAL });
    expect(res.status).toBe(200);

    const withdrawal = await txnRow(withdrawalId);
    expect(withdrawal?.category_id).toBe(CASH_WITHDRAWAL);
    expect(withdrawal?.transfer_group_id).toBeTruthy();

    const deposit = await sqlStmt(
      `SELECT id, category_id, amount, auto_generated, account_id FROM transaction_canonical
       WHERE household_id = ? AND transfer_group_id = ? AND id != ?`
    ).get<{ id: string; category_id: string; amount: string; auto_generated: boolean; account_id: string }>(
      HOUSEHOLD_ID,
      withdrawal!.transfer_group_id,
      withdrawalId
    );
    expect(deposit).toBeTruthy();
    expect(deposit!.category_id).toBe(CASH_DEPOSIT);
    expect(Number(deposit!.amount)).toBe(100);
    expect(deposit!.auto_generated).toBe(true);
    expect(deposit!.account_id).toBe(CASH_ACCOUNT_ID);

    expect(await cashBalance()).toBe(100);
  });

  it("does not create a link when the household has no cash account, but still sets the category", async () => {
    const [row] = await sqlStmt(
      `SELECT id FROM transaction_canonical WHERE household_id = ? LIMIT 1`
    ).all<{ id: string }>(HOUSEHOLD_NO_CASH_ID);

    const res = await request(app)
      .patch(`/transactions/${row.id}`)
      .set("authorization", `Bearer ${tokenNoCash}`)
      .send({ categoryId: CASH_WITHDRAWAL });
    expect(res.status).toBe(200);

    const updated = await txnRow(row.id);
    expect(updated?.category_id).toBe(CASH_WITHDRAWAL);
    expect(updated?.transfer_group_id).toBeNull();
  });

  it("blocks recategorizing away without confirmUnlink, and cascades when confirmed", async () => {
    const withdrawalId = crypto.randomUUID();
    await insertWithdrawal(withdrawalId, -50, 2);

    const linkRes = await request(app)
      .patch(`/transactions/${withdrawalId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ categoryId: CASH_WITHDRAWAL });
    expect(linkRes.status).toBe(200);
    expect(await cashBalance()).toBe(150); // 100 from the first test + 50 here

    const blocked = await request(app)
      .patch(`/transactions/${withdrawalId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ categoryId: GROCERIES });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("HAS_LINKED_WALLET_TXN");
    expect(blocked.body.linkedAmount).toBe(50);
    const linkedId = blocked.body.linkedTransactionId as string;

    const confirmed = await request(app)
      .patch(`/transactions/${withdrawalId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ categoryId: GROCERIES, confirmUnlink: true });
    expect(confirmed.status).toBe(200);

    const withdrawal = await txnRow(withdrawalId);
    expect(withdrawal?.category_id).toBe(GROCERIES);
    expect(withdrawal?.transfer_group_id).toBeNull();

    const depositGone = await txnRow(linkedId);
    expect(depositGone).toBeUndefined();

    expect(await cashBalance()).toBe(100); // reversed back to the first test's balance
  });

  it("blocks trashing a linked withdrawal without confirmUnlink, cascades trash+restore with it", async () => {
    const withdrawalId = crypto.randomUUID();
    await insertWithdrawal(withdrawalId, -30, 3);
    await request(app)
      .patch(`/transactions/${withdrawalId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ categoryId: CASH_WITHDRAWAL });

    const withdrawal = await txnRow(withdrawalId);
    const linked = await sqlStmt(
      `SELECT id FROM transaction_canonical WHERE household_id = ? AND transfer_group_id = ? AND id != ?`
    ).get<{ id: string }>(HOUSEHOLD_ID, withdrawal!.transfer_group_id, withdrawalId);
    const linkedId = linked!.id;

    const blocked = await request(app)
      .patch(`/transactions/${withdrawalId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "trashed" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("HAS_LINKED_WALLET_TXN");

    const trashed = await request(app)
      .patch(`/transactions/${withdrawalId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "trashed", confirmUnlink: true });
    expect(trashed.status).toBe(200);

    expect((await txnRow(withdrawalId))?.status).toBe("trashed");
    expect((await txnRow(linkedId))?.status).toBe("trashed");

    const restored = await request(app)
      .patch(`/transactions/${withdrawalId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ status: "posted" });
    expect(restored.status).toBe(200);

    expect((await txnRow(withdrawalId))?.status).toBe("posted");
    expect((await txnRow(linkedId))?.status).toBe("posted");
  });
});
