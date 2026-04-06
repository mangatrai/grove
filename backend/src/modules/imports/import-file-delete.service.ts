import fs from "node:fs";

import type { TransactionSql } from "postgres";

import { qBegin, qGet, sqlBind } from "../../db/query.js";

export type DeleteImportFileFailure =
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "SESSION_FINALIZED"; message: string };

async function txAll<T extends object>(
  tx: TransactionSql<Record<string, unknown>>,
  sqlStr: string,
  ...params: unknown[]
): Promise<T[]> {
  const { text, values } = sqlBind(sqlStr, params);
  const rows = await tx.unsafe(text, values as never[]);
  return Array.from(rows as Iterable<T>);
}

async function txExec(tx: TransactionSql<Record<string, unknown>>, sqlStr: string, ...params: unknown[]): Promise<void> {
  const { text, values } = sqlBind(sqlStr, params);
  await tx.unsafe(text, values as never[]);
}

const deleteResolutionForFileSql = `
  DELETE FROM resolution_item
  WHERE household_id = ?
    AND target_id IN (
      SELECT x.id FROM (
        SELECT tr.id AS id FROM transaction_raw tr WHERE tr.file_id = ?
        UNION
        SELECT tc.id FROM transaction_canonical tc
        WHERE tc.household_id = ?
          AND tc.source_ref IN (
            SELECT 'raw:' || tr.id FROM transaction_raw tr WHERE tr.file_id = ?
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
                SELECT 'raw:' || tr.id FROM transaction_raw tr WHERE tr.file_id = ?
              )
          )
      ) AS x
    )
  RETURNING id
`;

const clearGroupsForFileSql = `
  UPDATE transaction_canonical SET transfer_group_id = NULL
  WHERE household_id = ?
    AND transfer_group_id IS NOT NULL
    AND transfer_group_id IN (
      SELECT DISTINCT tc.transfer_group_id FROM transaction_canonical tc
      WHERE tc.household_id = ?
        AND tc.transfer_group_id IS NOT NULL
        AND tc.source_ref IN (
          SELECT 'raw:' || tr.id FROM transaction_raw tr WHERE tr.file_id = ?
        )
    )
`;

const deleteCanonicalForFileSql = `
  DELETE FROM transaction_canonical
  WHERE household_id = ?
    AND source_ref IN (
      SELECT 'raw:' || tr.id FROM transaction_raw tr WHERE tr.file_id = ?
    )
  RETURNING id
`;

/**
 * Remove one staged import file: ledger rows tied to its `transaction_raw` rows, resolution items,
 * payslip snapshot (if any), then the `import_file` row. Deletes staged bytes on disk when `stored_path` is set.
 * Not allowed when the session is `finalized`.
 */
export async function deleteImportSessionFile(
  sessionId: string,
  fileId: string,
  householdId: string
): Promise<{ ok: true } | DeleteImportFileFailure> {
  const row = await qGet<{
    session_status: string;
    stored_path: string | null;
  }>(
    `SELECT s.status AS session_status, f.stored_path AS stored_path
       FROM import_file f
       INNER JOIN import_session s ON s.id = f.session_id
       WHERE f.id = ? AND f.session_id = ? AND s.household_id = ?`,
    fileId,
    sessionId,
    householdId
  );

  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Import file not found" };
  }

  if (row.session_status === "finalized") {
    return {
      ok: false,
      code: "SESSION_FINALIZED",
      message: "Cannot remove files from a finalized import session"
    };
  }

  await qBegin(async (tx) => {
    await txAll(
      tx,
      deleteResolutionForFileSql,
      householdId,
      fileId,
      householdId,
      fileId,
      householdId,
      householdId,
      fileId
    );

    await txExec(tx, clearGroupsForFileSql, householdId, householdId, fileId);

    await txAll(tx, deleteCanonicalForFileSql, householdId, fileId);

    await txExec(tx, `DELETE FROM transaction_raw WHERE file_id = ?`, fileId);
    await txExec(tx, `DELETE FROM payslip_snapshot WHERE import_file_id = ?`, fileId);
    await txExec(tx, `DELETE FROM import_file WHERE id = ? AND session_id = ?`, fileId, sessionId);
  });

  if (row.stored_path?.trim()) {
    try {
      if (fs.existsSync(row.stored_path)) {
        fs.unlinkSync(row.stored_path);
      }
    } catch {
      // best-effort
    }
  }

  return { ok: true };
}
