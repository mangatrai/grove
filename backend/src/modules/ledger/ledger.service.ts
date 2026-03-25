import { db } from "../../db/sqlite.js";
import { categoryHasChildren, categoryUsableByHousehold } from "../category/categories.service.js";

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
  categoryId: string | null;
  categoryName: string | null;
}

export interface ListCanonicalResult {
  total: number;
  limit: number;
  offset: number;
  /** Present when the list is scoped to one import session. */
  sessionId?: string;
  transactions: CanonicalTransactionRow[];
}

/** Optional filters for ledger lists (category drill-down, date window, uncategorized, account). */
export interface LedgerListFilters {
  categoryId?: string;
  uncategorizedOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
}

function ledgerFilterClause(householdId: string, filters: LedgerListFilters | undefined): {
  sql: string;
  params: unknown[];
} {
  if (!filters) {
    return { sql: "", params: [] };
  }
  const parts: string[] = [];
  const params: unknown[] = [];
  if (filters.uncategorizedOnly) {
    parts.push("tc.category_id IS NULL");
  } else if (filters.categoryId) {
    const cid = filters.categoryId;
    if (categoryHasChildren(cid)) {
      parts.push(
        "(tc.category_id = ? OR tc.category_id IN (SELECT id FROM category WHERE parent_id = ? AND (household_id IS NULL OR household_id = ?)))"
      );
      params.push(cid, cid, householdId);
    } else {
      parts.push("tc.category_id = ?");
      params.push(cid);
    }
  }
  if (filters.dateFrom) {
    parts.push("tc.txn_date >= ?");
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    parts.push("tc.txn_date <= ?");
    params.push(filters.dateTo);
  }
  if (filters.accountId) {
    parts.push("tc.account_id = ?");
    params.push(filters.accountId);
  }
  if (parts.length === 0) {
    return { sql: "", params: [] };
  }
  return { sql: ` AND ${parts.join(" AND ")}`, params };
}

function mapRow(r: {
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
  category_id: string | null;
  category_name: string | null;
}): CanonicalTransactionRow {
  return {
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
    createdAt: r.created_at,
    categoryId: r.category_id,
    categoryName: r.category_name
  };
}

const txSelect = `
       tc.id AS id,
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
       tc.created_at AS created_at,
       tc.category_id AS category_id,
       c.name AS category_name`;

export function listCanonicalTransactions(
  householdId: string,
  limit: number,
  offset: number,
  filters?: LedgerListFilters
): ListCanonicalResult {
  const xf = ledgerFilterClause(householdId, filters);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM transaction_canonical tc WHERE tc.household_id = ?${xf.sql}`)
    .get(householdId, ...xf.params) as { cnt: number };
  const total = Number(totalRow.cnt);

  const rows = db
    .prepare(
      `SELECT ${txSelect}
       FROM transaction_canonical tc
       INNER JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
       LEFT JOIN category c ON c.id = tc.category_id
       WHERE tc.household_id = ?${xf.sql}
       ORDER BY tc.txn_date DESC, tc.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(householdId, ...xf.params, limit, offset) as Array<{
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
    category_id: string | null;
    category_name: string | null;
  }>;

  const transactions: CanonicalTransactionRow[] = rows.map(mapRow);

  return { total, limit, offset, transactions };
}

/**
 * Ledger rows whose canonical row links (via `source_ref`) to raw rows from files in this import session.
 */
export function listCanonicalTransactionsForImportSession(
  householdId: string,
  sessionId: string,
  limit: number,
  offset: number,
  filters?: LedgerListFilters
): ListCanonicalResult | { ok: false; code: "SESSION_NOT_FOUND" } {
  const session = db
    .prepare(`SELECT 1 FROM import_session WHERE id = ? AND household_id = ?`)
    .get(sessionId, householdId);
  if (!session) {
    return { ok: false, code: "SESSION_NOT_FOUND" };
  }

  const xf = ledgerFilterClause(householdId, filters);

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM transaction_canonical tc
       INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE f.session_id = ? AND tc.household_id = ?${xf.sql}`
    )
    .get(sessionId, householdId, ...xf.params) as { cnt: number };
  const total = Number(totalRow.cnt);

  const rows = db
    .prepare(
      `SELECT ${txSelect}
       FROM transaction_canonical tc
       INNER JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
       LEFT JOIN category c ON c.id = tc.category_id
       INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE f.session_id = ? AND tc.household_id = ?${xf.sql}
       ORDER BY tc.txn_date DESC, tc.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(sessionId, householdId, ...xf.params, limit, offset) as Array<{
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
    category_id: string | null;
    category_name: string | null;
  }>;

  const transactions: CanonicalTransactionRow[] = rows.map(mapRow);

  return { total, limit, offset, sessionId, transactions };
}

export function updateCanonicalTransactionCategory(
  householdId: string,
  transactionId: string,
  categoryId: string | null
):
  | { ok: true; data: { id: string; categoryId: string | null; categoryName: string | null } }
  | { ok: false; code: "NOT_FOUND" | "INVALID_CATEGORY" } {
  if (categoryId !== null && !categoryUsableByHousehold(categoryId, householdId)) {
    return { ok: false, code: "INVALID_CATEGORY" };
  }

  const exists = db
    .prepare(`SELECT 1 FROM transaction_canonical WHERE id = ? AND household_id = ?`)
    .get(transactionId, householdId);
  if (!exists) {
    return { ok: false, code: "NOT_FOUND" };
  }

  db.prepare(`UPDATE transaction_canonical SET category_id = ? WHERE id = ? AND household_id = ?`).run(
    categoryId,
    transactionId,
    householdId
  );

  if (categoryId !== null) {
    db.prepare(
      `UPDATE resolution_item SET status = 'resolved'
       WHERE household_id = ? AND type = 'unknown_category' AND target_id = ? AND status != 'resolved'`
    ).run(householdId, transactionId);
  }

  const row = db
    .prepare(
      `SELECT tc.id AS id, tc.category_id AS category_id, c.name AS category_name
       FROM transaction_canonical tc
       LEFT JOIN category c ON c.id = tc.category_id
       WHERE tc.id = ? AND tc.household_id = ?`
    )
    .get(transactionId, householdId) as { id: string; category_id: string | null; category_name: string | null };

  return {
    ok: true,
    data: {
      id: row.id,
      categoryId: row.category_id,
      categoryName: row.category_name
    }
  };
}
