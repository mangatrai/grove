import { db } from "../../db/sqlite.js";

export interface CanonicalTransactionRow {
  id: string;
  txnDate: string;
  amount: number;
  direction: string;
  merchant: string | null;
  memo: string | null;
  status: string;
  accountId: string;
  institution: string;
  accountType: string;
  accountMask: string | null;
  sourceRef: string | null;
  createdAt: string;
}

export interface ListCanonicalResult {
  total: number;
  limit: number;
  offset: number;
  transactions: CanonicalTransactionRow[];
}

export function listCanonicalTransactions(
  householdId: string,
  limit: number,
  offset: number
): ListCanonicalResult {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM transaction_canonical WHERE household_id = ?`)
    .get(householdId) as { cnt: number };
  const total = Number(totalRow.cnt);

  const rows = db
    .prepare(
      `SELECT tc.id AS id,
              tc.txn_date AS txn_date,
              tc.amount AS amount,
              tc.direction AS direction,
              tc.merchant AS merchant,
              tc.memo AS memo,
              tc.status AS status,
              tc.account_id AS account_id,
              fa.institution AS institution,
              fa.type AS account_type,
              fa.account_mask AS account_mask,
              tc.source_ref AS source_ref,
              tc.created_at AS created_at
       FROM transaction_canonical tc
       INNER JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
       WHERE tc.household_id = ?
       ORDER BY tc.txn_date DESC, tc.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(householdId, limit, offset) as Array<{
    id: string;
    txn_date: string;
    amount: number;
    direction: string;
    merchant: string | null;
    memo: string | null;
    status: string;
    account_id: string;
    institution: string;
    account_type: string;
    account_mask: string | null;
    source_ref: string | null;
    created_at: string;
  }>;

  const transactions: CanonicalTransactionRow[] = rows.map((r) => ({
    id: r.id,
    txnDate: r.txn_date,
    amount: r.amount,
    direction: r.direction,
    merchant: r.merchant,
    memo: r.memo,
    status: r.status,
    accountId: r.account_id,
    institution: r.institution,
    accountType: r.account_type,
    accountMask: r.account_mask,
    sourceRef: r.source_ref,
    createdAt: r.created_at
  }));

  return { total, limit, offset, transactions };
}
