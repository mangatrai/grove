import { db } from "../../db/sqlite.js";
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
  };
}

export type ResolutionStatus = "open" | "in_review" | "resolved";

export type UpdateResolutionFailure =
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "INVALID_TRANSITION"; message: string; from: ResolutionStatus; to: ResolutionStatus };

/**
 * Resolution items for the household, newest first (Epic 4.2 / Epic 6 precursor).
 */
export function listResolutionItemsForHousehold(
  householdId: string,
  status: ResolutionStatus | "all" = "all"
): ResolutionItemRow[] {
  const listSql =
    status === "all"
      ? `SELECT id, type, target_id AS targetId, reason, status, created_at AS createdAt
         FROM resolution_item
         WHERE household_id = ?
         ORDER BY datetime(created_at) DESC`
      : `SELECT id, type, target_id AS targetId, reason, status, created_at AS createdAt
         FROM resolution_item
         WHERE household_id = ? AND status = ?
         ORDER BY datetime(created_at) DESC`;

  const rows = db
    .prepare(listSql)
    .all(...(status === "all" ? [householdId] : [householdId, status])) as Array<{
    id: string;
    type: string;
    targetId: string;
    reason: string;
    status: ResolutionStatus;
    createdAt: string;
  }>;

  const rawContextStmt = db.prepare(
    `SELECT tr.file_id AS fileId, tr.extracted_payload_json AS payloadJson, f.file_name AS fileName, f.session_id AS sessionId
     FROM transaction_raw tr
     INNER JOIN import_file f ON f.id = tr.file_id
     WHERE tr.id = ?`
  );

  const unknownCanonStmt = db.prepare(
    `SELECT f.session_id AS sessionId, f.id AS fileId, f.file_name AS fileName, tr.extracted_payload_json AS payloadJson
     FROM transaction_canonical tc
     INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
     INNER JOIN import_file f ON f.id = tr.file_id
     WHERE tc.id = ? AND tc.household_id = ?`
  );

  const canonTxnStmt = db.prepare(
    `SELECT merchant, memo, amount, txn_date FROM transaction_canonical WHERE id = ? AND household_id = ?`
  );

  return rows.map((r) => {
    let reasonDetail: ResolutionReasonDetail | null = null;
    try {
      reasonDetail = JSON.parse(r.reason) as ResolutionReasonDetail;
    } catch {
      reasonDetail = null;
    }

    let rawPreview: RawPreview | null = null;
    let sessionId: string | null = null;
    let fileId: string | null = null;
    let fileName: string | null = null;

    if (r.type === "unknown_category") {
      const u = unknownCanonStmt.get(r.targetId, householdId) as
        | { sessionId: string; fileId: string; fileName: string; payloadJson: string }
        | undefined;
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
      } else {
        const co = canonTxnStmt.get(r.targetId, householdId) as
          | { merchant: string | null; memo: string | null; amount: number; txn_date: string }
          | undefined;
        if (co) {
          const desc = (co.merchant || co.memo || "").trim() || null;
          rawPreview = {
            txnDate: co.txn_date,
            amount: co.amount,
            description: desc,
            referenceId: null
          };
        }
      }
    } else {
      const rawId = reasonDetail?.rawId || r.targetId;
      const rawCtx = rawContextStmt.get(rawId) as
        | { fileId: string; payloadJson: string; fileName: string; sessionId: string }
        | undefined;

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
        raw: rawPreview
      }
    };
  });
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

export function updateResolutionStatusForHousehold(
  householdId: string,
  itemId: string,
  nextStatus: ResolutionStatus
): { ok: true; data: { id: string; status: ResolutionStatus } } | UpdateResolutionFailure {
  const row = db
    .prepare(`SELECT id, status FROM resolution_item WHERE id = ? AND household_id = ?`)
    .get(itemId, householdId) as { id: string; status: ResolutionStatus } | undefined;
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

  db.prepare(`UPDATE resolution_item SET status = ? WHERE id = ?`).run(nextStatus, itemId);
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
export function bulkUpdateResolutionStatusForHousehold(
  householdId: string,
  itemIds: string[],
  nextStatus: ResolutionStatus
): { updated: BulkUpdateResolutionRow[]; errors: BulkUpdateResolutionError[] } {
  const updated: BulkUpdateResolutionRow[] = [];
  const errors: BulkUpdateResolutionError[] = [];

  const select = db.prepare(
    `SELECT id, status FROM resolution_item WHERE id = ? AND household_id = ?`
  );
  const runUpdate = db.prepare(`UPDATE resolution_item SET status = ? WHERE id = ?`);

  for (const itemId of itemIds) {
    const row = select.get(itemId, householdId) as { id: string; status: ResolutionStatus } | undefined;
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
      runUpdate.run(nextStatus, itemId);
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
export function bulkApplyCategoryToUnknownItems(
  householdId: string,
  itemIds: string[],
  categoryId: string
): { ok: false; code: "INVALID_CATEGORY" } | { ok: true; updated: { id: string }[]; errors: BulkApplyCategoryError[] } {
  if (!categoryUsableByHousehold(categoryId, householdId)) {
    return { ok: false, code: "INVALID_CATEGORY" };
  }

  const updated: { id: string }[] = [];
  const errors: BulkApplyCategoryError[] = [];

  const selectItem = db.prepare(
    `SELECT id, type, target_id AS targetId FROM resolution_item WHERE id = ? AND household_id = ?`
  );
  const updateTxn = db.prepare(
    `UPDATE transaction_canonical SET category_id = ? WHERE id = ? AND household_id = ?`
  );
  const resolveItem = db.prepare(`UPDATE resolution_item SET status = 'resolved' WHERE id = ? AND household_id = ?`);

  for (const itemId of itemIds) {
    const row = selectItem.get(itemId, householdId) as
      | { id: string; type: string; targetId: string }
      | undefined;
    if (!row) {
      errors.push({ id: itemId, code: "NOT_FOUND", message: "Resolution item not found" });
      continue;
    }
    if (row.type !== "unknown_category") {
      errors.push({ id: itemId, code: "WRONG_TYPE", message: "Item is not unknown_category" });
      continue;
    }
    const info = updateTxn.run(categoryId, row.targetId, householdId);
    if (info.changes === 0) {
      errors.push({ id: itemId, code: "NOT_FOUND", message: "Linked transaction not found" });
      continue;
    }
    resolveItem.run(itemId, householdId);
    updated.push({ id: itemId });
  }

  return { ok: true, updated, errors };
}
