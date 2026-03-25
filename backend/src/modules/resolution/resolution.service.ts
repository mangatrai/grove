import { db } from "../../db/sqlite.js";

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

  return rows.map((r) => {
    let reasonDetail: ResolutionReasonDetail | null = null;
    try {
      reasonDetail = JSON.parse(r.reason) as ResolutionReasonDetail;
    } catch {
      reasonDetail = null;
    }

    // Most current items use rawId in reasonDetail for near-duplicate queue records.
    const rawId = reasonDetail?.rawId || r.targetId;
    const rawCtx = rawContextStmt.get(rawId) as
      | { fileId: string; payloadJson: string; fileName: string; sessionId: string }
      | undefined;

    let rawPreview: RawPreview | null = null;
    if (rawCtx) {
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

    return {
      id: r.id,
      type: r.type,
      targetId: r.targetId,
      reason: r.reason,
      reasonDetail,
      status: r.status,
      createdAt: r.createdAt,
      context: {
        sessionId: rawCtx?.sessionId ?? null,
        fileId: rawCtx?.fileId ?? null,
        fileName: rawCtx?.fileName ?? null,
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
