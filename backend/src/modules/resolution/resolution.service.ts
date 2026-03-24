import { db } from "../../db/sqlite.js";

export interface ResolutionItemRow {
  id: string;
  type: string;
  targetId: string;
  reason: string;
  /** Parsed when `reason` is JSON; otherwise null. */
  reasonDetail: unknown | null;
  status: string;
  createdAt: string;
}

/**
 * Open and in-review items for the household, newest first (Epic 4.2 / Epic 6 precursor).
 */
export function listResolutionItemsForHousehold(householdId: string): ResolutionItemRow[] {
  const rows = db
    .prepare(
      `SELECT id, type, target_id AS targetId, reason, status, created_at AS createdAt
       FROM resolution_item
       WHERE household_id = ?
       ORDER BY datetime(created_at) DESC`
    )
    .all(householdId) as Array<{
    id: string;
    type: string;
    targetId: string;
    reason: string;
    status: string;
    createdAt: string;
  }>;

  return rows.map((r) => {
    let reasonDetail: unknown | null = null;
    try {
      reasonDetail = JSON.parse(r.reason) as unknown;
    } catch {
      reasonDetail = null;
    }
    return {
      id: r.id,
      type: r.type,
      targetId: r.targetId,
      reason: r.reason,
      reasonDetail,
      status: r.status,
      createdAt: r.createdAt
    };
  });
}
