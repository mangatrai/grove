import type { TransactionSql } from "postgres";

import { qBegin, qGet, sqlBind } from "../../db/query.js";

export type RollbackImportSessionFailure =
  | { ok: false; code: "NOT_FOUND"; message: string };

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

/**
 * Remove ledger rows created from this import session (`source_ref = raw:<transaction_raw.id>`),
 * clear related transfer groups, and delete resolution items tied to those raw rows, session canonical rows,
 * or partner rows in the same transfer_group_id regardless of session status.
 * Parsed `transaction_raw` rows remain so the user can run **canonicalize** again.
 */
export async function rollbackImportSessionLedger(
  sessionId: string,
  householdId: string
): Promise<
  | { ok: true; data: { deletedCanonicalRows: number; deletedResolutionItems: number } }
  | RollbackImportSessionFailure
> {
  const row = await qGet<{ id: string }>(
    `SELECT id FROM import_session WHERE id = ? AND household_id = ?`,
    sessionId,
    householdId
  );

  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
  }

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
    RETURNING id
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
    RETURNING id
  `;

  const data = await qBegin(async (tx) => {
    const delRes = await txAll<{ id: string }>(
      tx,
      deleteResolutionSql,
      householdId,
      sessionId,
      householdId,
      sessionId,
      householdId,
      householdId,
      sessionId
    );
    const deletedResolutionItems = delRes.length;

    await txExec(tx, clearGroupsSql, householdId, householdId, sessionId);

    const delCanon = await txAll<{ id: string }>(tx, deleteCanonicalSql, householdId, sessionId);
    const deletedCanonicalRows = delCanon.length;

    return { deletedCanonicalRows, deletedResolutionItems };
  });

  return { ok: true, data };
}
