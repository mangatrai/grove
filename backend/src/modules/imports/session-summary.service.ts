import { db } from "../../db/sqlite.js";

export interface ImportSessionFileSummary {
  fileId: string;
  fileName: string;
  status: string;
  /** Rows in `transaction_raw` for this file (parsed lines). */
  rawRowCount: number;
  /** Posted ledger rows linked from this file’s raw rows (`source_ref = 'raw:' || transaction_raw.id`). */
  canonicalRowCount: number;
  /**
   * `resolution_item` rows (`type = duplicate_ambiguity`) whose `target_id` is a `transaction_raw.id` from this file.
   * Matches near-duplicate ingest behavior (one item per flagged raw row).
   */
  nearDuplicatesFlagged: number;
  /**
   * Open or in-review resolution items for this file: near-duplicate on raw, or category/transfer/reconciliation on
   * canonical rows sourced from this file’s raw rows.
   */
  openItemsNeedingReview: number;
  /**
   * Parsed raw rows that did not become ledger rows and are not counted as near-duplicate flags — typically exact
   * fingerprint duplicates or skipped/invalid lines during canonicalize.
   */
  notPostedExactDuplicateOrSkipped: number;
}

export interface ImportSessionSummary {
  sessionId: string;
  totals: {
    rawRows: number;
    canonicalRows: number;
    nearDuplicatesFlagged: number;
    openItemsNeedingReview: number;
    notPostedExactDuplicateOrSkipped: number;
  };
  files: ImportSessionFileSummary[];
}

function toCountMap(rows: Array<{ file_id: string; cnt: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.file_id, Number(r.cnt));
  }
  return m;
}

/**
 * Per-file import outcomes for a session (Epic 6): parsed vs posted, near-duplicate flags, open review load, and
 * remaining unposted (exact duplicate or skipped). Uses grouped queries (no N+1 per file).
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

  const fileIds = fileRows.map((f) => f.id);
  if (fileIds.length === 0) {
    return {
      sessionId,
      totals: {
        rawRows: 0,
        canonicalRows: 0,
        nearDuplicatesFlagged: 0,
        openItemsNeedingReview: 0,
        notPostedExactDuplicateOrSkipped: 0
      },
      files: []
    };
  }

  const placeholders = fileIds.map(() => "?").join(", ");

  const rawByFile = toCountMap(
    db
      .prepare(
        `SELECT file_id, COUNT(*) AS cnt
         FROM transaction_raw
         WHERE file_id IN (${placeholders})
         GROUP BY file_id`
      )
      .all(...fileIds) as Array<{ file_id: string; cnt: number }>
  );

  const canonicalByFile = toCountMap(
    db
      .prepare(
        `SELECT tr.file_id AS file_id, COUNT(*) AS cnt
         FROM transaction_canonical tc
         INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
         WHERE tc.household_id = ? AND tr.file_id IN (${placeholders})
         GROUP BY tr.file_id`
      )
      .all(householdId, ...fileIds) as Array<{ file_id: string; cnt: number }>
  );

  const nearDupByFile = toCountMap(
    db
      .prepare(
        `SELECT tr.file_id AS file_id, COUNT(*) AS cnt
         FROM resolution_item ri
         INNER JOIN transaction_raw tr ON ri.target_id = tr.id
         WHERE ri.household_id = ?
           AND ri.type = 'duplicate_ambiguity'
           AND tr.file_id IN (${placeholders})
         GROUP BY tr.file_id`
      )
      .all(householdId, ...fileIds) as Array<{ file_id: string; cnt: number }>
  );

  const openNearByFile = toCountMap(
    db
      .prepare(
        `SELECT tr.file_id AS file_id, COUNT(*) AS cnt
         FROM resolution_item ri
         INNER JOIN transaction_raw tr ON ri.target_id = tr.id
         WHERE ri.household_id = ?
           AND ri.type = 'duplicate_ambiguity'
           AND ri.status IN ('open', 'in_review')
           AND tr.file_id IN (${placeholders})
         GROUP BY tr.file_id`
      )
      .all(householdId, ...fileIds) as Array<{ file_id: string; cnt: number }>
  );

  const openCanonicalByFile = toCountMap(
    db
      .prepare(
        `SELECT tr.file_id AS file_id, COUNT(DISTINCT ri.id) AS cnt
         FROM resolution_item ri
         INNER JOIN transaction_canonical tc ON ri.target_id = tc.id
         INNER JOIN transaction_raw tr ON tc.source_ref = ('raw:' || tr.id)
         WHERE ri.household_id = ?
           AND ri.type IN ('unknown_category', 'transfer_ambiguity', 'reconciliation_mismatch')
           AND ri.status IN ('open', 'in_review')
           AND tr.file_id IN (${placeholders})
         GROUP BY tr.file_id`
      )
      .all(householdId, ...fileIds) as Array<{ file_id: string; cnt: number }>
  );

  let totalRaw = 0;
  let totalCanon = 0;
  let totalNear = 0;
  let totalOpenReview = 0;
  let totalExactOrSkip = 0;

  const files: ImportSessionFileSummary[] = fileRows.map((f) => {
    const rawRowCount = rawByFile.get(f.id) ?? 0;
    const canonicalRowCount = canonicalByFile.get(f.id) ?? 0;
    const nearDuplicatesFlagged = nearDupByFile.get(f.id) ?? 0;
    const openItemsNeedingReview =
      (openNearByFile.get(f.id) ?? 0) + (openCanonicalByFile.get(f.id) ?? 0);
    const notPostedExactDuplicateOrSkipped = Math.max(
      0,
      rawRowCount - canonicalRowCount - nearDuplicatesFlagged
    );

    totalRaw += rawRowCount;
    totalCanon += canonicalRowCount;
    totalNear += nearDuplicatesFlagged;
    totalOpenReview += openItemsNeedingReview;
    totalExactOrSkip += notPostedExactDuplicateOrSkipped;

    return {
      fileId: f.id,
      fileName: f.file_name,
      status: f.status,
      rawRowCount,
      canonicalRowCount,
      nearDuplicatesFlagged,
      openItemsNeedingReview,
      notPostedExactDuplicateOrSkipped
    };
  });

  return {
    sessionId,
    totals: {
      rawRows: totalRaw,
      canonicalRows: totalCanon,
      nearDuplicatesFlagged: totalNear,
      openItemsNeedingReview: totalOpenReview,
      notPostedExactDuplicateOrSkipped: totalExactOrSkip
    },
    files
  };
}
