import crypto from "node:crypto";

import { db } from "../../db/sqlite.js";
import { categoryHasChildren, categoryUsableByHousehold } from "../category/categories.service.js";
import {
  computeTransactionFingerprint,
  normalizeAmountForFingerprint,
  normalizeDescriptionForFingerprint,
  normalizeTxnDateForFingerprint
} from "../canonical/transaction-fingerprint.js";

/** Resolution rows included in ledger `openReviewItems` are only non-resolved statuses. */
export type OpenReviewItemStatus = "open" | "in_review";

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
  /** Populated when listing with `needsReviewOnly` — why the row appears under Needs review. */
  reviewReasons?: string[];
  /** Open resolution items for this row (same link rules as the review queue); for bulk `/resolution/*` and per-row PATCH. */
  openReviewItems?: { id: string; type: string; status: OpenReviewItemStatus }[];
  /** Import session when this row is tied to `raw:` source_ref. */
  importSessionId?: string | null;
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
  /** Full-text search on merchant + memo via FTS5 (`ledger_search_fts`), BM25-ranked when non-empty. */
  search?: string;
  amountMin?: number;
  amountMax?: number;
  /**
   * PRD §13 — rows that need attention: uncategorized, open resolution on this row (canonical or raw-linked duplicate),
   * or non-posted canonical status.
   */
  needsReviewOnly?: boolean;
  /**
   * When set with `needsReviewOnly`, keep rows that have at least one open/in_review resolution item
   * whose `type` is in this list (same predicate family as `GET /resolution` type filter).
   */
  resolutionTypes?: string[];
}

/** Rows that belong in the “Needs review” tab (PRD §13). */
const NEEDS_REVIEW_PREDICATE = `(
  tc.category_id IS NULL
  OR tc.status != 'posted'
  OR EXISTS (
    SELECT 1 FROM resolution_item ri
    WHERE ri.household_id = tc.household_id
      AND ri.status IN ('open', 'in_review')
      AND (
        (ri.type IN ('unknown_category', 'transfer_ambiguity', 'reconciliation_mismatch') AND ri.target_id = tc.id)
        OR (
          ri.type = 'duplicate_ambiguity'
          AND tc.source_ref IS NOT NULL
          AND tc.source_ref = ('raw:' || ri.target_id)
        )
      )
  )
)`;

const OPEN_REVIEW_ITEMS_SUBQUERY = `(
    SELECT group_concat(ri.id || ':' || ri.type || ':' || ri.status, '|')
    FROM resolution_item ri
    WHERE ri.household_id = tc.household_id
      AND ri.status IN ('open', 'in_review')
      AND (
        (ri.type IN ('unknown_category', 'transfer_ambiguity', 'reconciliation_mismatch') AND ri.target_id = tc.id)
        OR (
          ri.type = 'duplicate_ambiguity'
          AND tc.source_ref IS NOT NULL
          AND tc.source_ref = ('raw:' || ri.target_id)
        )
      )
  )`;

const IMPORT_SESSION_SUBQUERY = `(
    SELECT f2.session_id
    FROM transaction_raw tr2
    INNER JOIN import_file f2 ON f2.id = tr2.file_id
    WHERE tc.source_ref = ('raw:' || tr2.id)
    LIMIT 1
  )`;

const OPEN_REVIEW_ITEM_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([^:]+):(open|in_review)$/i;

function parseOpenReviewItems(blob: string | null | undefined): { id: string; type: string; status: OpenReviewItemStatus }[] {
  if (!blob?.trim()) {
    return [];
  }
  const out: { id: string; type: string; status: OpenReviewItemStatus }[] = [];
  for (const part of blob.split("|")) {
    const m = part.match(OPEN_REVIEW_ITEM_RE);
    if (m) {
      const st = m[3].toLowerCase() as OpenReviewItemStatus;
      if (st === "open" || st === "in_review") {
        out.push({ id: m[1], type: m[2], status: st });
      }
      continue;
    }
    const idx = part.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const id = part.slice(0, idx);
    const type = part.slice(idx + 1);
    if (id && type) {
      out.push({ id, type, status: "open" });
    }
  }
  return out;
}

function buildReviewReasons(
  categoryId: string | null,
  status: string,
  openItems: { id: string; type: string; status?: OpenReviewItemStatus }[]
): string[] {
  const set = new Set<string>();
  if (categoryId === null) {
    set.add("Uncategorized");
  }
  if (status !== "posted") {
    set.add(`Status: ${status}`);
  }
  const types = new Set(openItems.map((i) => i.type));
  for (const t of types) {
    if (t === "unknown_category") {
      set.add("Open review: category");
    } else if (t === "duplicate_ambiguity") {
      set.add("Open review: duplicate / near-duplicate");
    } else if (t === "transfer_ambiguity") {
      set.add("Open review: transfer");
    } else if (t === "reconciliation_mismatch") {
      set.add("Open review: reconciliation");
    }
  }
  if (categoryId !== null && [...types].some((t) => t !== "unknown_category")) {
    set.add("Category already set — still here for other open review items");
  }
  return [...set];
}

/** FTS5 MATCH: whitespace tokens, escape `"` as `""`, AND across tokens. */
function buildFtsMatchQuery(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return '""';
  }
  return tokens
    .map((t) => {
      const escaped = t.replace(/"/g, '""');
      return `"${escaped}"`;
    })
    .join(" AND ");
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
  if (filters.needsReviewOnly) {
    parts.push(NEEDS_REVIEW_PREDICATE);
  }
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
  if (filters.amountMin !== undefined && Number.isFinite(filters.amountMin)) {
    parts.push("CAST(tc.amount AS REAL) >= ?");
    params.push(filters.amountMin);
  }
  if (filters.amountMax !== undefined && Number.isFinite(filters.amountMax)) {
    parts.push("CAST(tc.amount AS REAL) <= ?");
    params.push(filters.amountMax);
  }
  if (filters.resolutionTypes && filters.resolutionTypes.length > 0) {
    const ph = filters.resolutionTypes.map(() => "?").join(", ");
    parts.push(`EXISTS (
      SELECT 1 FROM resolution_item ri
      WHERE ri.household_id = tc.household_id
        AND ri.status IN ('open', 'in_review')
        AND ri.type IN (${ph})
        AND (
          (ri.type IN ('unknown_category', 'transfer_ambiguity', 'reconciliation_mismatch') AND ri.target_id = tc.id)
          OR (
            ri.type = 'duplicate_ambiguity'
            AND tc.source_ref IS NOT NULL
            AND tc.source_ref = ('raw:' || ri.target_id)
          )
        )
    )`);
    params.push(...filters.resolutionTypes);
  }
  if (filters.search !== undefined && filters.search.trim() !== "") {
    const needle = filters.search.trim().toLowerCase();
    const ftsMatch = buildFtsMatchQuery(filters.search.trim());
    parts.push(
      `(instr(lower(coalesce(tc.merchant, '') || ' ' || coalesce(tc.memo, '')), ?) > 0 OR EXISTS (SELECT 1 FROM ledger_search_fts WHERE ledger_search_fts.rowid = tc.rowid AND ledger_search_fts MATCH ?))`
    );
    params.push(needle, ftsMatch);
  }
  if (parts.length === 0) {
    return { sql: "", params: [] };
  }
  return { sql: ` AND ${parts.join(" AND ")}`, params };
}

function mapRow(
  r: {
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
    open_review_items_blob?: string | null;
    import_session_id?: string | null;
  },
  opts?: { includeReviewReasons?: boolean }
): CanonicalTransactionRow {
  const row: CanonicalTransactionRow = {
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
  if (opts?.includeReviewReasons) {
    const openItems = parseOpenReviewItems(r.open_review_items_blob ?? null);
    row.openReviewItems = openItems;
    row.reviewReasons = buildReviewReasons(r.category_id, r.status, openItems);
    row.importSessionId = r.import_session_id ?? null;
  }
  return row;
}

function txSelectSql(includeReviewMeta: boolean): string {
  const base = `
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
  if (!includeReviewMeta) {
    return base;
  }
  return `${base}, ${OPEN_REVIEW_ITEMS_SUBQUERY} AS open_review_items_blob, ${IMPORT_SESSION_SUBQUERY} AS import_session_id`;
}

export function listCanonicalTransactions(
  householdId: string,
  limit: number,
  offset: number,
  filters?: LedgerListFilters
): ListCanonicalResult {
  const xf = ledgerFilterClause(householdId, filters);
  const includeReview = Boolean(filters?.needsReviewOnly);
  const sel = txSelectSql(includeReview);
  const orderBy = `ORDER BY tc.txn_date DESC, tc.created_at DESC`;
  const countParams = [householdId, ...xf.params];
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM transaction_canonical tc WHERE tc.household_id = ?${xf.sql}`)
    .get(...countParams) as { cnt: number };
  const total = Number(totalRow.cnt);

  const rows = db
    .prepare(
      `SELECT ${sel}
       FROM transaction_canonical tc
       INNER JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
       LEFT JOIN category c ON c.id = tc.category_id
       WHERE tc.household_id = ?${xf.sql}
       ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(...countParams, limit, offset) as Array<{
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
    open_review_items_blob?: string | null;
    import_session_id?: string | null;
  }>;

  const transactions: CanonicalTransactionRow[] = rows.map((r) => mapRow(r, { includeReviewReasons: includeReview }));

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
  const includeReview = Boolean(filters?.needsReviewOnly);
  const sel = txSelectSql(includeReview);
  const orderBy = `ORDER BY tc.txn_date DESC, tc.created_at DESC`;
  const countParams = [sessionId, householdId, ...xf.params];

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM transaction_canonical tc
       INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE f.session_id = ? AND tc.household_id = ?${xf.sql}`
    )
    .get(...countParams) as { cnt: number };
  const total = Number(totalRow.cnt);

  const rows = db
    .prepare(
      `SELECT ${sel}
       FROM transaction_canonical tc
       INNER JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
       LEFT JOIN category c ON c.id = tc.category_id
       INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE f.session_id = ? AND tc.household_id = ?${xf.sql}
       ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(...countParams, limit, offset) as Array<{
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
    open_review_items_blob?: string | null;
    import_session_id?: string | null;
  }>;

  const transactions: CanonicalTransactionRow[] = rows.map((r) => mapRow(r, { includeReviewReasons: includeReview }));

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

export type CreateManualTransactionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code: "INVALID_ACCOUNT" | "INVALID_CATEGORY" | "INVALID_AMOUNT" | "DUPLICATE_FINGERPRINT";
    };

/**
 * Insert a single posted canonical row from the UI (manual entry). Uses the same fingerprint contract as import.
 * When `categoryId` is null, creates an `unknown_category` resolution item (same attention path as ingest).
 */
export function createManualCanonicalTransaction(
  householdId: string,
  userId: string,
  input: {
    accountId: string;
    txnDate: string;
    amount: number;
    merchant: string;
    memo: string | null;
    categoryId: string | null;
  }
): CreateManualTransactionResult {
  const rounded = normalizeAmountForFingerprint(input.amount);
  if (!Number.isFinite(rounded) || rounded === 0) {
    return { ok: false, code: "INVALID_AMOUNT" };
  }

  const accountOk = db
    .prepare(`SELECT 1 FROM financial_account WHERE id = ? AND household_id = ?`)
    .get(input.accountId, householdId);
  if (!accountOk) {
    return { ok: false, code: "INVALID_ACCOUNT" };
  }

  if (input.categoryId !== null && !categoryUsableByHousehold(input.categoryId, householdId)) {
    return { ok: false, code: "INVALID_CATEGORY" };
  }

  const normDate = normalizeTxnDateForFingerprint(input.txnDate);
  const merchant = input.merchant.trim() || "Manual entry";
  const memo = input.memo?.trim() ? input.memo.trim() : null;
  const descForPrint = memo ? `${merchant} ${memo}` : merchant;
  const fingerprint = computeTransactionFingerprint({
    householdId,
    accountId: input.accountId,
    txnDate: normDate,
    amount: rounded,
    normalizedDescription: normalizeDescriptionForFingerprint(descForPrint)
  });

  const direction = rounded >= 0 ? "credit" : "debit";
  const merchantCol = merchant.length > 120 ? merchant.slice(0, 120) : merchant;
  const memoCol = merchant.length > 120 ? merchant.slice(120) : memo ?? null;

  const id = crypto.randomUUID();
  const sourceRef = `manual:${crypto.randomUUID()}`;
  const classificationMeta = JSON.stringify({ source: "manual" });

  const insertTx = db.prepare(
    `INSERT INTO transaction_canonical (
       id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
       merchant, memo, transfer_group_id, fingerprint, source_ref, status, classification_meta
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted', ?)`
  );

  const insertUnknown = db.prepare(
    `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
     VALUES (?, ?, 'unknown_category', ?, ?, 'open')`
  );

  try {
    db.transaction(() => {
      insertTx.run(
        id,
        householdId,
        input.accountId,
        userId,
        input.categoryId,
        normDate,
        rounded,
        direction,
        merchantCol,
        memoCol,
        fingerprint,
        sourceRef,
        classificationMeta
      );
      if (input.categoryId === null) {
        insertUnknown.run(
          crypto.randomUUID(),
          householdId,
          id,
          JSON.stringify({
            kind: "unknown_category",
            message: "Manual entry — assign a category from Transactions or the review queue.",
            classification: { source: "manual" as const }
          })
        );
      }
    })();
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code.includes("SQLITE_CONSTRAINT")) {
      return { ok: false, code: "DUPLICATE_FINGERPRINT" };
    }
    throw err;
  }

  return { ok: true, id };
}
