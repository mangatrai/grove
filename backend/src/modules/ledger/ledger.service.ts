import crypto from "node:crypto";

import { isPgUniqueViolation, qAll, qBegin, qExec, qGet } from "../../db/query.js";
import { categoryHasChildren, categoryUsableByHousehold } from "../category/categories.service.js";
import {
  computeTransactionFingerprint,
  normalizeAmountForFingerprint,
  normalizeDescriptionForFingerprint,
  normalizeTxnDateForFingerprint
} from "../canonical/transaction-fingerprint.js";

/** Resolution rows included in ledger `openReviewItems` are only non-resolved statuses. */
export type OpenReviewItemStatus = "open" | "in_review";

/** Parsed `transaction_canonical.classification_meta` JSON from rules at canonicalize time. */
export type ClassificationExplainMeta = {
  source: string;
  ruleId: string | null;
  confidence: number;
  reason: string;
  /** Bank-supplied category from the source file (e.g. Discover "Category" column). Only present when the bank provided it. */
  bankCategory?: string | null;
};

function parseClassificationMetaJson(raw: unknown): ClassificationExplainMeta | null {
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  try {
    const o = JSON.parse(String(raw)) as Record<string, unknown>;
    const source = typeof o.source === "string" ? o.source : "";
    const ruleId = o.ruleId == null ? null : String(o.ruleId);
    const confidence = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? o.confidence : 0;
    const reason = typeof o.reason === "string" ? o.reason : "";
    const bankCategory = typeof o.bankCategory === "string" && o.bankCategory.trim() ? o.bankCategory.trim() : null;
    if (!source && !reason && ruleId == null) {
      return null;
    }
    return { source: source || "unknown", ruleId, confidence, reason, ...(bankCategory ? { bankCategory } : {}) };
  } catch {
    return null;
  }
}

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
  ownerScope: "household" | "person";
  ownerPersonProfileId: string | null;
  /** Rules/builtin/manual classification audit from canonicalize (null if absent or unparseable). */
  classificationMeta: ClassificationExplainMeta | null;
  /** UUID shared by both legs of a confirmed transfer pair; null when not paired. */
  transferGroupId: string | null;
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
  /** Multi-select: explicit category UUIDs (flat `= ANY`, no parent expansion). */
  categoryIds?: string[];
  uncategorizedOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
  /** Restrict to rows linked to one import file via `source_ref = raw:<id>` chain. */
  fileId?: string;
  accountId?: string;
  /** Multi-select account UUIDs. */
  accountIds?: string[];
  /** Full-text search on merchant + memo (`search_document` tsvector + substring fallback). */
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
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string;
  /** Multi-select person profile UUIDs (with `owner_scope = 'person'`). */
  ownerPersonProfileIds?: string[];
  /**
   * Multi-select belongs-to. Values: "household" or person profile UUIDs.
   * When set, takes precedence over ownerScope / ownerPersonProfileId / ownerPersonProfileIds.
   */
  belongsTo?: string[];
  /** When true, return only trashed rows (status = 'trashed'). Default behaviour excludes them. */
  trashOnly?: boolean;
  /** When true, return only rows with a non-null transfer_group_id (confirmed transfer pairs). */
  transferPaired?: boolean;
}

/** Rows that belong in the “Needs review” tab. */
const NEEDS_REVIEW_PREDICATE = `(
  tc.category_id IS NULL
  OR tc.status NOT IN ('posted', 'trashed')
  OR EXISTS (
    SELECT 1 FROM resolution_item ri
    WHERE ri.household_id = tc.household_id
      AND ri.status IN ('open', 'in_review')
      AND (
        (ri.type IN ('reconciliation_mismatch', 'unknown_category', 'transfer_ambiguity') AND ri.target_id = tc.id)
        OR (
          ri.type = 'duplicate_ambiguity'
          AND tc.source_ref IS NOT NULL
          AND tc.source_ref = ('raw:' || ri.target_id)
        )
      )
  )
)`;

const OPEN_REVIEW_ITEMS_SUBQUERY = `(
    SELECT string_agg(ri.id || ':' || ri.type || ':' || ri.status, '|' ORDER BY ri.id)
    FROM resolution_item ri
    WHERE ri.household_id = tc.household_id
      AND ri.status IN ('open', 'in_review')
      AND (
        (ri.type IN ('reconciliation_mismatch', 'unknown_category', 'transfer_ambiguity') AND ri.target_id = tc.id)
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
  if (status === "duplicate") {
    // Exact duplicate row inserted for review — status already explains why it's here.
    set.add("Exact duplicate");
  } else if (status !== "posted") {
    set.add(`Status: ${status}`);
  }
  const types = new Set(openItems.map((i) => i.type));
  for (const t of types) {
    if (t === "duplicate_ambiguity" && status !== "duplicate") {
      // Exact duplicate rows already labelled above; only show near-duplicate for other cases.
      set.add("Open review: near-duplicate");
    } else if (t === "reconciliation_mismatch") {
      set.add("Open review: reconciliation");
    }
  }
  return [...set];
}

async function ledgerFilterClause(householdId: string, filters: LedgerListFilters | undefined): Promise<{
  sql: string;
  params: unknown[];
}> {
  const parts: string[] = [];
  const params: unknown[] = [];

  // Always enforce status scope — default hides trashed rows from every view.
  if (filters?.trashOnly) {
    parts.push("tc.status = 'trashed'");
  } else {
    parts.push("tc.status != 'trashed'");
  }

  if (!filters) {
    return { sql: ` AND ${parts.join(" AND ")}`, params };
  }
  if (filters.needsReviewOnly) {
    parts.push(NEEDS_REVIEW_PREDICATE);
  }
  if (filters.uncategorizedOnly) {
    parts.push("tc.category_id IS NULL");
  } else {
    const allCategoryIds = [...(filters.categoryId ? [filters.categoryId] : []), ...(filters.categoryIds ?? [])];
    const uniqueCategoryIds = [...new Set(allCategoryIds)];
    if (uniqueCategoryIds.length === 1) {
      const cid = uniqueCategoryIds[0]!;
      if (await categoryHasChildren(cid)) {
        parts.push(
          "(tc.category_id = ? OR tc.category_id IN (SELECT id FROM category WHERE parent_id = ? AND (household_id IS NULL OR household_id = ?)))"
        );
        params.push(cid, cid, householdId);
      } else {
        parts.push("tc.category_id = ?");
        params.push(cid);
      }
    } else if (uniqueCategoryIds.length > 1) {
      parts.push(
        "(tc.category_id = ANY(?) OR tc.category_id IN (SELECT id FROM category WHERE parent_id = ANY(?) AND (household_id IS NULL OR household_id = ?)))"
      );
      params.push(uniqueCategoryIds, uniqueCategoryIds, householdId);
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
  if (filters.fileId) {
    parts.push(
      "EXISTS (SELECT 1 FROM transaction_raw trf INNER JOIN import_file ff ON ff.id = trf.file_id WHERE tc.source_ref = ('raw:' || trf.id) AND ff.id = ?)"
    );
    params.push(filters.fileId);
  }
  const allAccountIds = [...(filters.accountId ? [filters.accountId] : []), ...(filters.accountIds ?? [])];
  const uniqueAccountIds = [...new Set(allAccountIds)];
  if (uniqueAccountIds.length === 1) {
    parts.push("tc.account_id = ?");
    params.push(uniqueAccountIds[0]!);
  } else if (uniqueAccountIds.length > 1) {
    parts.push("tc.account_id = ANY(?)");
    params.push(uniqueAccountIds);
  }

  if (filters.belongsTo?.length) {
    const includeHousehold = filters.belongsTo.includes("household");
    const personIds = filters.belongsTo.filter((id) => id !== "household");
    if (includeHousehold && personIds.length > 0) {
      parts.push("(tc.owner_scope = 'household' OR tc.owner_person_profile_id = ANY(?))");
      params.push(personIds);
    } else if (includeHousehold) {
      parts.push("tc.owner_scope = 'household'");
    } else if (personIds.length === 1) {
      parts.push("tc.owner_scope = 'person' AND tc.owner_person_profile_id = ?");
      params.push(personIds[0]!);
    } else if (personIds.length > 1) {
      parts.push("tc.owner_scope = 'person' AND tc.owner_person_profile_id = ANY(?)");
      params.push(personIds);
    }
  } else {
    const allPersonIds = [
      ...(filters.ownerPersonProfileId ? [filters.ownerPersonProfileId] : []),
      ...(filters.ownerPersonProfileIds ?? [])
    ];
    const uniquePersonIds = [...new Set(allPersonIds)];
    if (filters.ownerScope === "household") {
      parts.push("tc.owner_scope = 'household'");
    } else if (uniquePersonIds.length === 1) {
      parts.push("tc.owner_scope = 'person' AND tc.owner_person_profile_id = ?");
      params.push(uniquePersonIds[0]!);
    } else if (uniquePersonIds.length > 1) {
      parts.push("tc.owner_scope = 'person' AND tc.owner_person_profile_id = ANY(?)");
      params.push(uniquePersonIds);
    } else if (filters.ownerScope === "person") {
      parts.push("tc.owner_scope = 'person'");
    }
  }
  if (filters.amountMin !== undefined && Number.isFinite(filters.amountMin)) {
    parts.push("CAST(tc.amount AS DOUBLE PRECISION) >= ?");
    params.push(filters.amountMin);
  }
  if (filters.amountMax !== undefined && Number.isFinite(filters.amountMax)) {
    parts.push("CAST(tc.amount AS DOUBLE PRECISION) <= ?");
    params.push(filters.amountMax);
  }
  if (filters.resolutionTypes && filters.resolutionTypes.length > 0) {
    const ph = filters.resolutionTypes.map(() => "?").join(", ");
    // Exact duplicate rows (status = 'duplicate') are created by fingerprint deduplication and
    // carry no resolution_item — they are surfaced in Needs Review via status alone. When the
    // caller filters by duplicate_ambiguity, include them so the "Duplicate" filter shows both
    // exact duplicates and near-duplicates together.
    const includeExactDuplicates = filters.resolutionTypes.includes("duplicate_ambiguity");
    const exactDupClause = includeExactDuplicates ? "tc.status = 'duplicate' OR " : "";
    parts.push(`(${exactDupClause}EXISTS (
      SELECT 1 FROM resolution_item ri
      WHERE ri.household_id = tc.household_id
        AND ri.status IN ('open', 'in_review')
        AND ri.type IN (${ph})
        AND (
          (ri.type IN ('reconciliation_mismatch', 'unknown_category', 'transfer_ambiguity') AND ri.target_id = tc.id)
          OR (
            ri.type = 'duplicate_ambiguity'
            AND tc.source_ref IS NOT NULL
            AND tc.source_ref = ('raw:' || ri.target_id)
          )
        )
    ))`);
    params.push(...filters.resolutionTypes);
  }
  if (filters.transferPaired) {
    parts.push("tc.transfer_group_id IS NOT NULL");
  }
  if (filters.search !== undefined && filters.search.trim() !== "") {
    const raw = filters.search.trim();
    const needle = raw.toLowerCase();
    parts.push(
      `(tc.search_document @@ plainto_tsquery('english', ?) OR POSITION(? IN LOWER(COALESCE(tc.merchant, '') || ' ' || COALESCE(tc.memo, ''))) > 0)`
    );
    params.push(raw, needle);
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
    owner_scope: "household" | "person";
    owner_person_profile_id: string | null;
    classification_meta?: unknown;
    transfer_group_id?: string | null;
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
    categoryName: r.category_name,
    ownerScope: r.owner_scope,
    ownerPersonProfileId: r.owner_person_profile_id,
    classificationMeta: parseClassificationMetaJson(r.classification_meta),
    transferGroupId: r.transfer_group_id ?? null
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
       c.name AS category_name,
       tc.owner_scope AS owner_scope,
       tc.owner_person_profile_id AS owner_person_profile_id,
       tc.classification_meta AS classification_meta,
       tc.transfer_group_id AS transfer_group_id`;
  if (!includeReviewMeta) {
    return base;
  }
  return `${base}, ${OPEN_REVIEW_ITEMS_SUBQUERY} AS open_review_items_blob, ${IMPORT_SESSION_SUBQUERY} AS import_session_id`;
}

export async function listCanonicalTransactions(
  householdId: string,
  limit: number,
  offset: number,
  filters?: LedgerListFilters
): Promise<ListCanonicalResult> {
  const xf = await ledgerFilterClause(householdId, filters);
  const includeReview = Boolean(filters?.needsReviewOnly);
  const sel = txSelectSql(includeReview);
  const orderBy = `ORDER BY tc.txn_date DESC, tc.created_at DESC`;
  const countParams = [householdId, ...xf.params];
  const totalRow = await qGet<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM transaction_canonical tc WHERE tc.household_id = ?${xf.sql}`,
    ...countParams
  );
  const total = Number(totalRow?.cnt ?? 0);

  type Row = Parameters<typeof mapRow>[0];
  const rows = await qAll<Row>(
    `SELECT ${sel}
       FROM transaction_canonical tc
       INNER JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
       LEFT JOIN category c ON c.id = tc.category_id
       WHERE tc.household_id = ?${xf.sql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    ...countParams,
    limit,
    offset
  );

  const transactions: CanonicalTransactionRow[] = rows.map((r) => mapRow(r, { includeReviewReasons: includeReview }));

  return { total, limit, offset, transactions };
}

/**
 * Ledger rows whose canonical row links (via `source_ref`) to raw rows from files in this import session.
 */
export async function listCanonicalTransactionsForImportSession(
  householdId: string,
  sessionId: string,
  limit: number,
  offset: number,
  filters?: LedgerListFilters
): Promise<ListCanonicalResult | { ok: false; code: "SESSION_NOT_FOUND" }> {
  const session = await qGet(`SELECT 1 FROM import_session WHERE id = ? AND household_id = ?`, sessionId, householdId);
  if (!session) {
    return { ok: false, code: "SESSION_NOT_FOUND" };
  }

  const xf = await ledgerFilterClause(householdId, filters);
  const includeReview = Boolean(filters?.needsReviewOnly);
  const sel = txSelectSql(includeReview);
  const orderBy = `ORDER BY tc.txn_date DESC, tc.created_at DESC`;
  const countParams = [sessionId, householdId, ...xf.params];

  const totalRow = await qGet<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM transaction_canonical tc
       INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE f.session_id = ? AND tc.household_id = ?${xf.sql}`,
    ...countParams
  );
  const total = Number(totalRow?.cnt ?? 0);

  type Row = Parameters<typeof mapRow>[0];
  const rows = await qAll<Row>(
    `SELECT ${sel}
       FROM transaction_canonical tc
       INNER JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
       LEFT JOIN category c ON c.id = tc.category_id
       INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE f.session_id = ? AND tc.household_id = ?${xf.sql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    ...countParams,
    limit,
    offset
  );

  const transactions: CanonicalTransactionRow[] = rows.map((r) => mapRow(r, { includeReviewReasons: includeReview }));

  return { total, limit, offset, sessionId, transactions };
}

/** Response shape for `GET /transactions/aggregate` (CR-177). */
export type LedgerAggregateSummary = {
  count: number;
  net: number;
  inflows: number;
  outflows: number;
  avgAbsolute: number;
  byCategory: Array<{ label: string; value: number; categoryId: string | null }>;
  byMerchant: Array<{ label: string; value: number }>;
  byAccount: Array<{ label: string; value: number; accountId: string }>;
  byMonth: Array<{ label: string; value: number; net: number }>;
  dateFirst: string | null;
  dateLast: string | null;
};

/**
 * Aggregate counts and sums over the full filtered ledger (no pagination).
 * When `importSessionId` is set, the same session scope as `GET /transactions?sessionId=` applies.
 */
export async function aggregateCanonicalTransactions(
  householdId: string,
  filters: LedgerListFilters | undefined,
  opts?: { importSessionId?: string }
): Promise<LedgerAggregateSummary> {
  const sessionId = opts?.importSessionId;
  const xf = await ledgerFilterClause(householdId, filters);
  const sessionJoin =
    sessionId != null
      ? ` INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
       INNER JOIN import_file f ON f.id = tr.file_id`
      : "";
  const fromCore = `FROM transaction_canonical tc${sessionJoin}`;
  const whereCore =
    sessionId != null ? `WHERE f.session_id = ? AND tc.household_id = ?${xf.sql}` : `WHERE tc.household_id = ?${xf.sql}`;
  const bp = sessionId != null ? [sessionId, householdId, ...xf.params] : [householdId, ...xf.params];
  const inflowExpr = `CASE WHEN CAST(tc.amount AS NUMERIC) > 0 THEN CAST(tc.amount AS NUMERIC) ELSE 0 END`;
  const outflowExpr = `CASE WHEN CAST(tc.amount AS NUMERIC) < 0 THEN -CAST(tc.amount AS NUMERIC) ELSE 0 END`;

  const headline = await qGet<{
    cnt: string;
    total_inflows: string;
    total_outflows: string;
    date_first: string | null;
    date_last: string | null;
  }>(
    `SELECT
      COUNT(*)::text AS cnt,
      COALESCE(SUM(${inflowExpr}), 0)::text AS total_inflows,
      COALESCE(SUM(${outflowExpr}), 0)::text AS total_outflows,
      MIN(tc.txn_date)::text AS date_first,
      MAX(tc.txn_date)::text AS date_last
    ${fromCore}
    ${whereCore}`,
    ...bp
  );

  const count = Number(headline?.cnt ?? 0);
  const inflows = Number(headline?.total_inflows ?? 0);
  const outflows = Number(headline?.total_outflows ?? 0);
  const net = inflows - outflows;
  const avgAbsolute = count > 0 ? (inflows + outflows) / count : 0;

  const catRows = await qAll<{ cat_id: string | null; cat_name: string | null; outflow_sum: string }>(
    `SELECT
      c.id AS cat_id,
      c.name AS cat_name,
      SUM(${outflowExpr})::text AS outflow_sum
    ${fromCore}
    LEFT JOIN category c ON c.id = tc.category_id
    ${whereCore}
    GROUP BY c.id, c.name
    ORDER BY SUM(${outflowExpr}) DESC
    LIMIT 50`,
    ...bp
  );

  const merchantRows = await qAll<{ merchant_key: string; outflow_sum: string }>(
    `SELECT
      LOWER(REGEXP_REPLACE(TRIM(COALESCE(tc.merchant, tc.memo, 'Unknown')), '\\s+', ' ', 'g')) AS merchant_key,
      SUM(${outflowExpr})::text AS outflow_sum
    ${fromCore}
    ${whereCore}
    GROUP BY merchant_key
    ORDER BY SUM(${outflowExpr}) DESC
    LIMIT 50`,
    ...bp
  );

  const accountRows = await qAll<{ account_id: string; acct_label: string; net_sum: string }>(
    `SELECT
      tc.account_id,
      (fa.institution || ' ' || fa.type || COALESCE(' •' || fa.account_mask, '')) AS acct_label,
      SUM(CAST(tc.amount AS NUMERIC))::text AS net_sum
    ${fromCore}
    LEFT JOIN financial_account fa ON fa.id = tc.account_id
    ${whereCore}
    GROUP BY tc.account_id, fa.institution, fa.type, fa.account_mask
    ORDER BY ABS(SUM(CAST(tc.amount AS NUMERIC))) DESC
    LIMIT 50`,
    ...bp
  );

  const monthRows = await qAll<{ month_label: string; inflow_sum: string; outflow_sum: string }>(
    `SELECT
      TO_CHAR(DATE_TRUNC('month', tc.txn_date::date), 'YYYY-MM') AS month_label,
      SUM(${inflowExpr})::text AS inflow_sum,
      SUM(${outflowExpr})::text AS outflow_sum
    ${fromCore}
    ${whereCore}
    GROUP BY DATE_TRUNC('month', tc.txn_date::date)
    ORDER BY DATE_TRUNC('month', tc.txn_date::date) ASC
    LIMIT 120`,
    ...bp
  );

  return {
    count,
    net,
    inflows,
    outflows,
    avgAbsolute,
    dateFirst: headline?.date_first ?? null,
    dateLast: headline?.date_last ?? null,
    byCategory: catRows.map((r) => ({
      categoryId: r.cat_id ?? null,
      label: r.cat_name ?? "Uncategorized",
      value: Number(r.outflow_sum)
    })),
    byMerchant: merchantRows.map((r) => ({
      label: r.merchant_key,
      value: Number(r.outflow_sum)
    })),
    byAccount: accountRows.map((r) => ({
      accountId: r.account_id,
      label: r.acct_label,
      value: Number(r.net_sum)
    })),
    byMonth: monthRows.map((r) => {
      const inf = Number(r.inflow_sum);
      const out = Number(r.outflow_sum);
      return {
        label: r.month_label,
        value: out,
        net: inf - out
      };
    })
  };
}

export async function updateCanonicalTransactionCategory(
  householdId: string,
  transactionId: string,
  categoryId: string | null,
  ownerScope?: "household" | "person",
  ownerPersonProfileId?: string | null
): Promise<
  | { ok: true; data: { id: string; categoryId: string | null; categoryName: string | null } }
  | { ok: false; code: "NOT_FOUND" | "INVALID_CATEGORY" }
> {
  if (categoryId !== null && !(await categoryUsableByHousehold(categoryId, householdId))) {
    return { ok: false, code: "INVALID_CATEGORY" };
  }

  const exists = await qGet<{
    owner_scope: "household" | "person";
    owner_person_profile_id: string | null;
  }>(
    `SELECT owner_scope AS owner_scope, owner_person_profile_id AS owner_person_profile_id
       FROM transaction_canonical
       WHERE id = ? AND household_id = ?`,
    transactionId,
    householdId
  );
  if (!exists) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const nextOwnerScope = ownerScope ?? exists.owner_scope;
  const nextOwnerPersonProfileId =
    nextOwnerScope === "person" ? (ownerPersonProfileId ?? exists.owner_person_profile_id ?? null) : null;
  await qExec(
    `UPDATE transaction_canonical
     SET category_id = ?, owner_scope = ?, owner_person_profile_id = ?
     WHERE id = ? AND household_id = ?`,
    categoryId,
    nextOwnerScope,
    nextOwnerPersonProfileId,
    transactionId,
    householdId
  );

  if (categoryId !== null) {
    await qExec(
      `UPDATE resolution_item SET status = 'resolved'
       WHERE household_id = ? AND type = 'unknown_category' AND target_id = ? AND status != 'resolved'`,
      householdId,
      transactionId
    );
  }

  const row = await qGet<{ id: string; category_id: string | null; category_name: string | null }>(
    `SELECT tc.id AS id, tc.category_id AS category_id, c.name AS category_name
       FROM transaction_canonical tc
       LEFT JOIN category c ON c.id = tc.category_id
       WHERE tc.id = ? AND tc.household_id = ?`,
    transactionId,
    householdId
  );

  return {
    ok: true,
    data: {
      id: row!.id,
      categoryId: row!.category_id,
      categoryName: row!.category_name
    }
  };
}

export async function updateCanonicalTransactionMemo(
  householdId: string,
  transactionId: string,
  memo: string | null
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" }> {
  const exists = await qGet<{ id: string }>(
    `SELECT id FROM transaction_canonical WHERE id = ? AND household_id = ?`,
    transactionId,
    householdId
  );
  if (!exists) {
    return { ok: false, code: "NOT_FOUND" };
  }
  await qExec(
    `UPDATE transaction_canonical SET memo = ? WHERE id = ? AND household_id = ?`,
    memo,
    transactionId,
    householdId
  );
  return { ok: true };
}

/**
 * Set the same category on a batch of transactions. Skips rows not found in the household.
 * Also closes any lingering unknown_category resolution items for backward compatibility.
 */
export async function bulkUpdateCategory(
  householdId: string,
  transactionIds: string[],
  categoryId: string
): Promise<{ updated: number; skipped: number }> {
  if (!(await categoryUsableByHousehold(categoryId, householdId))) {
    return { updated: 0, skipped: transactionIds.length };
  }
  let updated = 0;
  let skipped = 0;
  for (const id of transactionIds) {
    const result = await updateCanonicalTransactionCategory(householdId, id, categoryId);
    if (result.ok) {
      updated++;
    } else {
      skipped++;
    }
  }
  return { updated, skipped };
}

export type CreateManualTransactionResult =
  | { ok: true; id: string; amount: number }
  | {
      ok: false;
      code: "INVALID_ACCOUNT" | "INVALID_CATEGORY" | "INVALID_AMOUNT" | "DUPLICATE_FINGERPRINT";
    };

/**
 * Insert a single posted canonical row from the UI (manual entry). Uses the same fingerprint contract as import.
 * When `categoryId` is null the row appears in Needs Review via category_id IS NULL.
 */
export async function createManualCanonicalTransaction(
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
): Promise<CreateManualTransactionResult> {
  const rounded = normalizeAmountForFingerprint(input.amount);
  if (!Number.isFinite(rounded) || rounded === 0) {
    return { ok: false, code: "INVALID_AMOUNT" };
  }

  const accountOk = await qGet(`SELECT 1 FROM financial_account WHERE id = ? AND household_id = ?`, input.accountId, householdId);
  if (!accountOk) {
    return { ok: false, code: "INVALID_ACCOUNT" };
  }

  if (input.categoryId !== null && !(await categoryUsableByHousehold(input.categoryId, householdId))) {
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

  try {
    await qBegin(async (tx) => {
      await tx.unsafe(
        `INSERT INTO transaction_canonical (
       id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
       merchant, memo, transfer_group_id, fingerprint, source_ref, status, classification_meta
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, 'posted', $13)`,
        [
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
        ] as never[]
      );
      // Uncategorized manual entries appear in Needs Review via category_id IS NULL.
    });
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      return { ok: false, code: "DUPLICATE_FINGERPRINT" };
    }
    throw err;
  }

  return { ok: true, id, amount: rounded };
}

// ---------------------------------------------------------------------------
// Trash / restore / hard-delete
// ---------------------------------------------------------------------------

async function closeResolutionItemsForCanonical(householdId: string, canonicalId: string): Promise<void> {
  // Close items where target_id is the canonical id directly (reconciliation_mismatch).
  await qExec(
    `UPDATE resolution_item SET status = 'resolved'
     WHERE household_id = ? AND target_id = ? AND status != 'resolved'`,
    householdId,
    canonicalId
  );
  // Close duplicate_ambiguity items linked via source_ref = 'raw:' || target_id.
  await qExec(
    `UPDATE resolution_item SET status = 'resolved'
     WHERE household_id = ? AND type = 'duplicate_ambiguity' AND status != 'resolved'
       AND EXISTS (
         SELECT 1 FROM transaction_canonical tc
         WHERE tc.id = ? AND tc.source_ref = ('raw:' || resolution_item.target_id)
       )`,
    householdId,
    canonicalId
  );
}

export async function trashTransaction(
  householdId: string,
  id: string
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "ALREADY_TRASHED" }> {
  const row = await qGet<{ status: string }>(
    `SELECT status FROM transaction_canonical WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status === "trashed") return { ok: false, code: "ALREADY_TRASHED" };
  await qExec(
    `UPDATE transaction_canonical SET status = 'trashed' WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  await closeResolutionItemsForCanonical(householdId, id);
  return { ok: true };
}

export async function restoreTransaction(
  householdId: string,
  id: string
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "NOT_TRASHED" }> {
  const row = await qGet<{ status: string }>(
    `SELECT status FROM transaction_canonical WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status !== "trashed") return { ok: false, code: "NOT_TRASHED" };
  await qExec(
    `UPDATE transaction_canonical SET status = 'posted' WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  return { ok: true };
}

export async function hardDeleteTransaction(
  householdId: string,
  id: string
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "NOT_TRASHED" }> {
  const row = await qGet<{ status: string }>(
    `SELECT status FROM transaction_canonical WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status !== "trashed") return { ok: false, code: "NOT_TRASHED" };
  await closeResolutionItemsForCanonical(householdId, id);
  await qExec(
    `DELETE FROM transaction_canonical WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  return { ok: true };
}

export async function bulkTrashTransactions(
  householdId: string,
  ids: string[]
): Promise<{ trashed: number; skipped: number }> {
  let trashed = 0;
  let skipped = 0;
  for (const id of ids) {
    const r = await trashTransaction(householdId, id);
    if (r.ok) trashed++; else skipped++;
  }
  return { trashed, skipped };
}

export async function bulkRestoreTransactions(
  householdId: string,
  ids: string[]
): Promise<{ restored: number; skipped: number }> {
  let restored = 0;
  let skipped = 0;
  for (const id of ids) {
    const r = await restoreTransaction(householdId, id);
    if (r.ok) restored++; else skipped++;
  }
  return { restored, skipped };
}

export async function bulkHardDeleteTransactions(
  householdId: string,
  ids: string[]
): Promise<{ deleted: number; skipped: number }> {
  let deleted = 0;
  let skipped = 0;
  for (const id of ids) {
    const r = await hardDeleteTransaction(householdId, id);
    if (r.ok) deleted++; else skipped++;
  }
  return { deleted, skipped };
}

export async function bulkReassignOwner(
  householdId: string,
  fromPersonProfileId: string,
  toPersonProfileId: string
): Promise<{ updated: number }> {
  await qExec(
    `UPDATE transaction_canonical
     SET owner_person_profile_id = ?
     WHERE household_id = ? AND owner_scope = 'person' AND owner_person_profile_id = ?`,
    toPersonProfileId,
    householdId,
    fromPersonProfileId
  );
  const row = await qGet<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM transaction_canonical
     WHERE household_id = ? AND owner_scope = 'person' AND owner_person_profile_id = ?`,
    householdId,
    toPersonProfileId
  );
  return { updated: Number(row?.cnt ?? 0) };
}

export type UpdateManualAmountResult =
  | { ok: true; oldAmount: number; newAmount: number; accountId: string; txnDate: string }
  | { ok: false; code: "NOT_FOUND" | "NOT_MANUAL" | "INVALID_AMOUNT" };

export async function updateManualTransactionAmount(
  householdId: string,
  id: string,
  rawAmount: number
): Promise<UpdateManualAmountResult> {
  const rounded = normalizeAmountForFingerprint(rawAmount);
  if (!Number.isFinite(rounded) || rounded === 0) {
    return { ok: false, code: "INVALID_AMOUNT" };
  }

  const row = await qGet<{ amount: string; source_ref: string; account_id: string; txn_date: string }>(
    `SELECT amount, source_ref, account_id, txn_date
     FROM transaction_canonical
     WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (!row.source_ref.startsWith("manual:")) {
    return { ok: false, code: "NOT_MANUAL" };
  }

  const direction = rounded >= 0 ? "credit" : "debit";
  await qExec(
    `UPDATE transaction_canonical SET amount = ?, direction = ? WHERE id = ? AND household_id = ?`,
    rounded,
    direction,
    id,
    householdId
  );

  return {
    ok: true,
    oldAmount: Number(row.amount),
    newAmount: rounded,
    accountId: row.account_id,
    txnDate: String(row.txn_date).slice(0, 10)
  };
}

// ---------------------------------------------------------------------------
// Transfer pair / unpair (TM-2)
// ---------------------------------------------------------------------------

export type PairTransactionsResult =
  | { ok: true; transferGroupId: string }
  | { ok: false; code: "NOT_FOUND" | "SAME_ID" | "SAME_ACCOUNT" | "ALREADY_PAIRED" | "AMOUNT_MISMATCH" | "DIRECTION_MISMATCH"; message: string };

export async function pairTransactions(
  householdId: string,
  id1: string,
  id2: string
): Promise<PairTransactionsResult> {
  if (id1 === id2) {
    return { ok: false, code: "SAME_ID", message: "Cannot pair a transaction with itself" };
  }

  type TxSnap = { amount: string; direction: string; account_id: string; transfer_group_id: string | null; status: string };
  const [t1, t2] = await Promise.all([
    qGet<TxSnap>(
      `SELECT amount, direction, account_id, transfer_group_id, status FROM transaction_canonical WHERE id = ? AND household_id = ?`,
      id1, householdId
    ),
    qGet<TxSnap>(
      `SELECT amount, direction, account_id, transfer_group_id, status FROM transaction_canonical WHERE id = ? AND household_id = ?`,
      id2, householdId
    )
  ]);

  if (!t1 || !t2) return { ok: false, code: "NOT_FOUND", message: "One or both transactions not found" };
  if (t1.status !== "posted" || t2.status !== "posted") {
    return { ok: false, code: "NOT_FOUND", message: "Both transactions must be posted" };
  }
  if (t1.account_id === t2.account_id) {
    return { ok: false, code: "SAME_ACCOUNT", message: "Transactions must be on different accounts" };
  }
  if (t1.transfer_group_id || t2.transfer_group_id) {
    return { ok: false, code: "ALREADY_PAIRED", message: "One or both transactions are already part of a transfer pair" };
  }
  if (Math.abs(Math.abs(Number(t1.amount)) - Math.abs(Number(t2.amount))) > 0.01) {
    return { ok: false, code: "AMOUNT_MISMATCH", message: "Transaction amounts do not match" };
  }
  if (t1.direction === t2.direction) {
    return { ok: false, code: "DIRECTION_MISMATCH", message: "Transactions must have opposite directions (one debit, one credit)" };
  }

  const transferGroupId = crypto.randomUUID();
  await qExec(
    `UPDATE transaction_canonical SET transfer_group_id = ? WHERE id = ANY(?) AND household_id = ?`,
    transferGroupId, [id1, id2], householdId
  );

  return { ok: true, transferGroupId };
}

export type UnpairTransactionsResult =
  | { ok: true; unlinked: number }
  | { ok: false; code: "NOT_FOUND" };

export async function unpairTransactions(
  householdId: string,
  groupId: string
): Promise<UnpairTransactionsResult> {
  const check = await qGet<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM transaction_canonical WHERE transfer_group_id = ? AND household_id = ?`,
    groupId, householdId
  );
  if (!check || Number(check.cnt) === 0) {
    return { ok: false, code: "NOT_FOUND" };
  }
  await qExec(
    `UPDATE transaction_canonical SET transfer_group_id = NULL WHERE transfer_group_id = ? AND household_id = ?`,
    groupId, householdId
  );
  return { ok: true, unlinked: Number(check.cnt) };
}
