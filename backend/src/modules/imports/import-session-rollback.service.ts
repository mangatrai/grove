import { db } from "../../db/sqlite.js";

export type RollbackImportSessionFailure =
  | { ok: false; code: "NOT_FOUND"; message: string }
  | {
      ok: false;
      code: "SESSION_NOT_REVIEW";
      message: string;
      currentStatus: string;
    };

/**
 * Remove ledger rows created from this import session (`source_ref = raw:<transaction_raw.id>`),
 * clear related transfer groups, and delete resolution items tied to those raw rows, session canonical rows,
 * or partner rows in the same transfer_group_id. Only allowed while session status is `review` (Epic 6.3).
 * Parsed `transaction_raw` rows remain so the user can run **canonicalize** again.
 */
export function rollbackImportSessionLedger(
  sessionId: string,
  householdId: string
):
  | { ok: true; data: { deletedCanonicalRows: number; deletedResolutionItems: number } }
  | RollbackImportSessionFailure {
  const row = db
    .prepare(`SELECT id, status FROM import_session WHERE id = ? AND household_id = ?`)
    .get(sessionId, householdId) as { id: string; status: string } | undefined;

  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
  }

  if (row.status !== "review") {
    return {
      ok: false,
      code: "SESSION_NOT_REVIEW",
      message: "Undo import is only available while the session is in review (before finalize).",
      currentStatus: row.status
    };
  }

  /** `?` order: outer household, then each branch (see `.run()` below). */
  const deleteResolutionSql = `
    DELETE FROM resolution_item
    WHERE household_id = ?
      AND target_id IN (
        SELECT x.id FROM (
          SELECT tr.id AS id FROM transaction_raw tr
          INNER JOIN import_file f ON f.id = tr.file_id
          WHERE f.session_id = ?
          UNION
          SELECT tc.id FROM transaction_canonical tc
          WHERE tc.household_id = ?
            AND tc.source_ref IN (
              SELECT 'raw:' || tr.id FROM transaction_raw tr
              INNER JOIN import_file f ON f.id = tr.file_id
              WHERE f.session_id = ?
            )
          UNION
          SELECT tc2.id FROM transaction_canonical tc2
          WHERE tc2.household_id = ?
            AND tc2.transfer_group_id IS NOT NULL
            AND tc2.transfer_group_id IN (
              SELECT DISTINCT tc3.transfer_group_id FROM transaction_canonical tc3
              WHERE tc3.household_id = ?
                AND tc3.transfer_group_id IS NOT NULL
                AND tc3.source_ref IN (
                  SELECT 'raw:' || tr.id FROM transaction_raw tr
                  INNER JOIN import_file f ON f.id = tr.file_id
                  WHERE f.session_id = ?
                )
            )
        ) AS x
      )
  `;

  const clearGroupsSql = `
    UPDATE transaction_canonical SET transfer_group_id = NULL
    WHERE household_id = ?
      AND transfer_group_id IS NOT NULL
      AND transfer_group_id IN (
        SELECT DISTINCT tc.transfer_group_id FROM transaction_canonical tc
        WHERE tc.household_id = ?
          AND tc.transfer_group_id IS NOT NULL
          AND tc.source_ref IN (
            SELECT 'raw:' || tr.id FROM transaction_raw tr
            INNER JOIN import_file f ON f.id = tr.file_id
            WHERE f.session_id = ?
          )
      )
  `;

  const deleteCanonicalSql = `
    DELETE FROM transaction_canonical
    WHERE household_id = ?
      AND source_ref IN (
        SELECT 'raw:' || tr.id FROM transaction_raw tr
        INNER JOIN import_file f ON f.id = tr.file_id
        WHERE f.session_id = ?
      )
  `;

  const run = db.transaction(() => {
    const delRes = db.prepare(deleteResolutionSql).run(
      householdId,
      sessionId,
      householdId,
      sessionId,
      householdId,
      householdId,
      sessionId
    );

    const deletedResolutionItems = delRes.changes;

    db.prepare(clearGroupsSql).run(householdId, householdId, sessionId);

    const delCanon = db.prepare(deleteCanonicalSql).run(householdId, sessionId);

    const deletedCanonicalRows = delCanon.changes;

    return { deletedCanonicalRows, deletedResolutionItems };
  });

  return { ok: true, data: run() };
}
