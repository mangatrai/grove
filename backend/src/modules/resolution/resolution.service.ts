import { qAll, qExec, qGet } from "../../db/query.js";
import { categoryUsableByHousehold } from "../category/categories.service.js";

interface ResolutionReasonDetail {
  kind?: string;
  message?: string;
  existingCanonicalId?: string;
  rawId?: string;
}

interface RawPreview {
  txnDate: string | null;
  amount: number | null;
  description: string | null;
  referenceId: string | null;
}

interface ClassificationAiMeta {
  suggestedCategoryId?: string | null;
  confidence?: number;
  suggestedNewCategoryName?: string | null;
  reason?: string;
  model?: string;
  autoApplied?: boolean;
}

interface ClassificationExplainability {
  source?: "household" | "builtin" | "none" | "db" | "default";
  ruleId?: string | null;
  confidence?: number;
  reason?: string;
  /** Present when OpenAI returned a suggestion; stored on `transaction_canonical.classification_meta`. */
  ai?: ClassificationAiMeta | null;
}

export interface ResolutionItemRow {
  id: string;
  type: string;
  targetId: string;
  reason: string;
  /** Parsed when `reason` is JSON; otherwise null. */
  reasonDetail: ResolutionReasonDetail | null;
  status: ResolutionStatus;
  createdAt: string;
  /** Optional import context for triage links and previews. */
  context: {
    sessionId: string | null;
    fileId: string | null;
    fileName: string | null;
    raw: RawPreview | null;
    classification: ClassificationExplainability | null;
  };
}

export type ResolutionStatus = "open" | "in_review" | "resolved";

export type UpdateResolutionFailure =
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "INVALID_TRANSITION"; message: string; from: ResolutionStatus; to: ResolutionStatus };

/**
 * Resolution items for the household, newest first (Epic 4.2 / Epic 6 precursor).
 */
export type ResolutionItemTypeFilter =
  | "unknown_category"
  | "duplicate_ambiguity"
  | "transfer_ambiguity"
  | "reconciliation_mismatch"
  | "all";

/**
 * Open resolution items per type (for dashboard / nav badges).
 */
export async function countOpenResolutionItemsByType(householdId: string): Promise<Record<string, number>> {
  const rows = await qAll<{ type: string; cnt: string }>(
    `SELECT type, COUNT(*)::text AS cnt
       FROM resolution_item
       WHERE household_id = ? AND status = 'open'
       GROUP BY type`,
    householdId
  );
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.type] = Number(r.cnt);
  }
  return out;
}

/**
 * Open duplicate_ambiguity items with no ledger row linking `source_ref = 'raw:' || target_id`
 * (near-duplicate skipped at ingest — invisible on Transactions → Needs review). See DOC-005.
 */
export async function countOpenDuplicateAmbiguityNotOnLedger(householdId: string): Promise<number> {
  const row = await qGet<{ c: string }>(
    `SELECT COUNT(*)::text AS c
       FROM resolution_item ri
       WHERE ri.household_id = ?
         AND ri.type = 'duplicate_ambiguity'
         AND ri.status IN ('open', 'in_review')
         AND NOT EXISTS (
           SELECT 1 FROM transaction_canonical tc
           WHERE tc.household_id = ri.household_id
             AND tc.source_ref IS NOT NULL
             AND tc.source_ref = ('raw:' || ri.target_id)
         )`,
    householdId
  );
  return row ? Number(row.c) || 0 : 0;
}

type ResolutionDbListRow = {
  id: string;
  type: string;
  targetId: string;
  reason: string;
  status: ResolutionStatus;
  createdAt: string;
};

async function buildResolutionItemRow(r: ResolutionDbListRow, householdId: string): Promise<ResolutionItemRow> {
  let reasonDetail: ResolutionReasonDetail | null = null;
  try {
    reasonDetail = JSON.parse(r.reason) as ResolutionReasonDetail;
  } catch {
    reasonDetail = null;
  }

  let rawPreview: RawPreview | null = null;
  let classification: ClassificationExplainability | null = null;
  let sessionId: string | null = null;
  let fileId: string | null = null;
  let fileName: string | null = null;

  if (r.type === "unknown_category") {
    const u = await qGet<{
      sessionId: string;
      fileId: string;
      fileName: string;
      payloadJson: string;
      classificationMeta: string | null;
    }>(
      `SELECT
         f.session_id AS "sessionId",
         f.id AS "fileId",
         f.file_name AS "fileName",
         tr.extracted_payload_json AS "payloadJson",
         tc.classification_meta AS "classificationMeta"
       FROM transaction_canonical tc
       INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE tc.id = ? AND tc.household_id = ?`,
      r.targetId,
      householdId
    );
    if (u) {
      sessionId = u.sessionId;
      fileId = u.fileId;
      fileName = u.fileName;
      try {
        const parsed = JSON.parse(u.payloadJson) as Partial<{
          txn_date: string;
          amount: number;
          description: string;
          reference_id: string;
        }>;
        rawPreview = {
          txnDate: typeof parsed.txn_date === "string" ? parsed.txn_date : null,
          amount: typeof parsed.amount === "number" ? parsed.amount : null,
          description: typeof parsed.description === "string" ? parsed.description : null,
          referenceId: typeof parsed.reference_id === "string" ? parsed.reference_id : null
        };
      } catch {
        rawPreview = null;
      }
      if (u.classificationMeta) {
        try {
          classification = JSON.parse(u.classificationMeta) as ClassificationExplainability;
        } catch {
          classification = null;
        }
      }
    } else {
      const co = await qGet<{
        merchant: string | null;
        memo: string | null;
        amount: number;
        txn_date: string;
        classificationMeta: string | null;
      }>(
        `SELECT merchant, memo, amount, txn_date, classification_meta AS "classificationMeta"
       FROM transaction_canonical
       WHERE id = ? AND household_id = ?`,
        r.targetId,
        householdId
      );
      if (co) {
        const desc = (co.merchant || co.memo || "").trim() || null;
        rawPreview = {
          txnDate: co.txn_date,
          amount: co.amount,
          description: desc,
          referenceId: null
        };
        if (co.classificationMeta) {
          try {
            classification = JSON.parse(co.classificationMeta) as ClassificationExplainability;
          } catch {
            classification = null;
          }
        }
      }
    }
  } else {
    const rawId = reasonDetail?.rawId || r.targetId;
    const rawCtx = await qGet<{
      fileId: string;
      payloadJson: string;
      fileName: string;
      sessionId: string;
    }>(
      `SELECT tr.file_id AS "fileId", tr.extracted_payload_json AS "payloadJson", f.file_name AS "fileName", f.session_id AS "sessionId"
       FROM transaction_raw tr
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE tr.id = ?`,
      rawId
    );

    if (rawCtx) {
      sessionId = rawCtx.sessionId;
      fileId = rawCtx.fileId;
      fileName = rawCtx.fileName;
      try {
        const parsed = JSON.parse(rawCtx.payloadJson) as Partial<{
          txn_date: string;
          amount: number;
          description: string;
          reference_id: string;
        }>;
        rawPreview = {
          txnDate: typeof parsed.txn_date === "string" ? parsed.txn_date : null,
          amount: typeof parsed.amount === "number" ? parsed.amount : null,
          description: typeof parsed.description === "string" ? parsed.description : null,
          referenceId: typeof parsed.reference_id === "string" ? parsed.reference_id : null
        };
      } catch {
        rawPreview = null;
      }
    }
    const co = await qGet<{
      merchant: string | null;
      memo: string | null;
      amount: number;
      txn_date: string;
      classificationMeta: string | null;
    }>(
      `SELECT merchant, memo, amount, txn_date, classification_meta AS "classificationMeta"
       FROM transaction_canonical
       WHERE id = ? AND household_id = ?`,
      r.targetId,
      householdId
    );
    if (co?.classificationMeta) {
      try {
        classification = JSON.parse(co.classificationMeta) as ClassificationExplainability;
      } catch {
        classification = null;
      }
    }
  }

  return {
    id: r.id,
    type: r.type,
    targetId: r.targetId,
    reason: r.reason,
    reasonDetail,
    status: r.status,
    createdAt: r.createdAt,
    context: {
      sessionId,
      fileId,
      fileName,
      raw: rawPreview,
      classification
    }
  };
}

/**
 * Open / in_review resolution items tied to one canonical transaction (same link rules as ledger `openReviewItems`).
 */
export async function listOpenResolutionItemsForCanonicalTransaction(
  householdId: string,
  canonicalTransactionId: string
): Promise<{ ok: true; items: ResolutionItemRow[] } | { ok: false; code: "NOT_FOUND" }> {
  const exists = await qGet(
    `SELECT 1 FROM transaction_canonical WHERE id = ? AND household_id = ?`,
    canonicalTransactionId,
    householdId
  );
  if (!exists) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const rows = await qAll<ResolutionDbListRow>(
    `SELECT ri.id AS id, ri.type AS type, ri.target_id AS "targetId", ri.reason AS reason, ri.status AS status, ri.created_at AS "createdAt"
       FROM resolution_item ri
       WHERE ri.household_id = ?
         AND ri.status IN ('open', 'in_review')
         AND (
           (ri.type IN ('unknown_category', 'transfer_ambiguity', 'reconciliation_mismatch') AND ri.target_id = ?)
           OR (
             ri.type = 'duplicate_ambiguity'
             AND EXISTS (
               SELECT 1 FROM transaction_canonical tc
               WHERE tc.id = ? AND tc.household_id = ri.household_id
                 AND tc.source_ref IS NOT NULL
                 AND tc.source_ref = ('raw:' || ri.target_id)
             )
           )
         )
       ORDER BY ri.created_at DESC`,
    householdId,
    canonicalTransactionId,
    canonicalTransactionId
  );

  const items: ResolutionItemRow[] = [];
  for (const r of rows) {
    items.push(await buildResolutionItemRow(r, householdId));
  }
  return { ok: true, items };
}

export async function listResolutionItemsForHousehold(
  householdId: string,
  status: ResolutionStatus | "all" = "all",
  itemType: ResolutionItemTypeFilter = "all"
): Promise<ResolutionItemRow[]> {
  const typePart = itemType === "all" ? "" : " AND type = ?";
  const listSql =
    status === "all"
      ? `SELECT id, type, target_id AS "targetId", reason, status, created_at AS "createdAt"
         FROM resolution_item
         WHERE household_id = ?${typePart}
         ORDER BY created_at DESC`
      : `SELECT id, type, target_id AS "targetId", reason, status, created_at AS "createdAt"
         FROM resolution_item
         WHERE household_id = ? AND status = ?${typePart}
         ORDER BY created_at DESC`;

  const params: unknown[] =
    status === "all"
      ? itemType === "all"
        ? [householdId]
        : [householdId, itemType]
      : itemType === "all"
        ? [householdId, status]
        : [householdId, status, itemType];

  const rows = await qAll<ResolutionDbListRow>(listSql, ...params);

  const items: ResolutionItemRow[] = [];
  for (const r of rows) {
    items.push(await buildResolutionItemRow(r, householdId));
  }
  return items;
}

function canTransition(from: ResolutionStatus, to: ResolutionStatus): boolean {
  if (from === to) {
    return true;
  }
  if (from === "open") {
    return to === "in_review" || to === "resolved";
  }
  if (from === "in_review") {
    return to === "open" || to === "resolved";
  }
  return to === "open";
}

export async function updateResolutionStatusForHousehold(
  householdId: string,
  itemId: string,
  nextStatus: ResolutionStatus
): Promise<{ ok: true; data: { id: string; status: ResolutionStatus } } | UpdateResolutionFailure> {
  const row = await qGet<{ id: string; status: ResolutionStatus }>(
    `SELECT id, status FROM resolution_item WHERE id = ? AND household_id = ?`,
    itemId,
    householdId
  );
  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Resolution item not found" };
  }

  if (!canTransition(row.status, nextStatus)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: "Invalid resolution status transition",
      from: row.status,
      to: nextStatus
    };
  }

  await qExec(`UPDATE resolution_item SET status = ? WHERE id = ?`, nextStatus, itemId);
  return { ok: true, data: { id: itemId, status: nextStatus } };
}

export interface BulkUpdateResolutionRow {
  id: string;
  status: ResolutionStatus;
}

export interface BulkUpdateResolutionError {
  id: string;
  code: "NOT_FOUND" | "INVALID_TRANSITION";
  message: string;
  from?: ResolutionStatus;
  to?: ResolutionStatus;
}

/**
 * Apply the same target status to many items (best-effort). Skips invalid transitions and missing rows.
 */
export async function bulkUpdateResolutionStatusForHousehold(
  householdId: string,
  itemIds: string[],
  nextStatus: ResolutionStatus
): Promise<{ updated: BulkUpdateResolutionRow[]; errors: BulkUpdateResolutionError[] }> {
  const updated: BulkUpdateResolutionRow[] = [];
  const errors: BulkUpdateResolutionError[] = [];

  for (const itemId of itemIds) {
    const row = await qGet<{ id: string; status: ResolutionStatus }>(
      `SELECT id, status FROM resolution_item WHERE id = ? AND household_id = ?`,
      itemId,
      householdId
    );
    if (!row) {
      errors.push({ id: itemId, code: "NOT_FOUND", message: "Resolution item not found" });
      continue;
    }
    if (!canTransition(row.status, nextStatus)) {
      errors.push({
        id: itemId,
        code: "INVALID_TRANSITION",
        message: "Invalid resolution status transition",
        from: row.status,
        to: nextStatus
      });
      continue;
    }
    if (row.status !== nextStatus) {
      await qExec(`UPDATE resolution_item SET status = ? WHERE id = ?`, nextStatus, itemId);
    }
    updated.push({ id: itemId, status: nextStatus });
  }

  return { updated, errors };
}

export interface BulkApplyCategoryError {
  id: string;
  code: "NOT_FOUND" | "WRONG_TYPE";
  message: string;
}

/**
 * Set category on posted transactions for `unknown_category` items and mark those items resolved.
 */
export async function bulkApplyCategoryToUnknownItems(
  householdId: string,
  itemIds: string[],
  categoryId: string
): Promise<
  { ok: false; code: "INVALID_CATEGORY" } | { ok: true; updated: { id: string }[]; errors: BulkApplyCategoryError[] }
> {
  if (!(await categoryUsableByHousehold(categoryId, householdId))) {
    return { ok: false, code: "INVALID_CATEGORY" };
  }

  const updated: { id: string }[] = [];
  const errors: BulkApplyCategoryError[] = [];

  for (const itemId of itemIds) {
    const row = await qGet<{ id: string; type: string; targetId: string }>(
      `SELECT id, type, target_id AS "targetId" FROM resolution_item WHERE id = ? AND household_id = ?`,
      itemId,
      householdId
    );
    if (!row) {
      errors.push({ id: itemId, code: "NOT_FOUND", message: "Resolution item not found" });
      continue;
    }
    if (row.type !== "unknown_category") {
      errors.push({ id: itemId, code: "WRONG_TYPE", message: "Item is not unknown_category" });
      continue;
    }
    const touched = await qGet<{ id: string }>(
      `UPDATE transaction_canonical SET category_id = ? WHERE id = ? AND household_id = ? RETURNING id`,
      categoryId,
      row.targetId,
      householdId
    );
    if (!touched) {
      errors.push({ id: itemId, code: "NOT_FOUND", message: "Linked transaction not found" });
      continue;
    }
    await qExec(`UPDATE resolution_item SET status = 'resolved' WHERE id = ? AND household_id = ?`, itemId, householdId);
    updated.push({ id: itemId });
  }

  return { ok: true, updated, errors };
}
