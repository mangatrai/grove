import { db } from "../../db/sqlite.js";

export interface ImportSessionFileSummary {
  fileId: string;
  fileName: string;
  status: string;
  rawRowCount: number;
  canonicalRowCount: number;
}

export interface ImportSessionSummary {
  sessionId: string;
  totals: {
    rawRows: number;
    canonicalRows: number;
  };
  files: ImportSessionFileSummary[];
}

/**
 * Per-file raw vs ledger row counts for an import session (Epic 6.1-style summary).
 * Canonical rows are linked via `transaction_canonical.source_ref = 'raw:' || transaction_raw.id`.
 */
export function getImportSessionSummary(
  sessionId: string,
  householdId: string
): ImportSessionSummary | null {
  const session = db
    .prepare(`SELECT id FROM import_session WHERE id = ? AND household_id = ?`)
    .get(sessionId, householdId) as { id: string } | undefined;
  if (!session) {
    return null;
  }

  const fileRows = db
    .prepare(
      `SELECT id, file_name, status FROM import_file WHERE session_id = ? ORDER BY uploaded_at ASC`
    )
    .all(sessionId) as Array<{ id: string; file_name: string; status: string }>;

  const rawCountStmt = db.prepare(
    `SELECT COUNT(*) AS cnt FROM transaction_raw WHERE file_id = ?`
  );
  const canonicalForFileStmt = db.prepare(
    `SELECT COUNT(*) AS cnt
     FROM transaction_canonical tc
     INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
     WHERE tr.file_id = ? AND tc.household_id = ?`
  );

  let totalRaw = 0;
  let totalCanon = 0;

  const files: ImportSessionFileSummary[] = fileRows.map((f) => {
    const rawRow = rawCountStmt.get(f.id) as { cnt: number };
    const rawRowCount = Number(rawRow.cnt);
    const canonRow = canonicalForFileStmt.get(f.id, householdId) as { cnt: number };
    const canonicalRowCount = Number(canonRow.cnt);
    totalRaw += rawRowCount;
    totalCanon += canonicalRowCount;
    return {
      fileId: f.id,
      fileName: f.file_name,
      status: f.status,
      rawRowCount,
      canonicalRowCount
    };
  });

  return {
    sessionId,
    totals: { rawRows: totalRaw, canonicalRows: totalCanon },
    files
  };
}
