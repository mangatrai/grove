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
  /** Parse/canonical diagnostics copied from `import_file.confidence_summary` when available. */
  diagnostics?: {
    parser?: Record<string, unknown>;
    canonicalize?: Record<string, unknown>;
  };
  /** Statement-balance check when parser rows include running balance (warn-only diagnostics). */
  reconciliation: {
    available: boolean;
    status: "ok" | "mismatch" | "insufficient_data";
    openingBalance: number | null;
    closingBalance: number | null;
    expectedClosingBalance: number | null;
    netActivity: number | null;
    variance: number | null;
    note: string;
  };
}

export interface ImportSessionSummary {
  sessionId: string;
  totals: {
    rawRows: number;
    canonicalRows: number;
    nearDuplicatesFlagged: number;
    openItemsNeedingReview: number;
    notPostedExactDuplicateOrSkipped: number;
    reconciliationAvailableFiles: number;
    reconciliationMismatchedFiles: number;
  };
  files: ImportSessionFileSummary[];
}

type RawPayloadWithBalance = {
  amount?: number;
  source_row?: Record<string, string | number | null | undefined>;
};

function parseBalanceValue(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const hasParens = /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/[()$,\s]/g, "").trim();
  if (!cleaned) {
    return null;
  }
  const n = Number(hasParens ? `-${cleaned}` : cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractBalanceFromSourceRow(
  sourceRow: Record<string, string | number | null | undefined> | undefined
): number | null {
  if (!sourceRow) {
    return null;
  }
  for (const [key, value] of Object.entries(sourceRow)) {
    if (!/balance/i.test(key)) {
      continue;
    }
    const parsed = parseBalanceValue(typeof value === "number" ? String(value) : value ?? undefined);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function reconciliationForFile(fileId: string): ImportSessionFileSummary["reconciliation"] {
  const rows = db
    .prepare(
      `SELECT row_index, extracted_payload_json
       FROM transaction_raw
       WHERE file_id = ?
       ORDER BY row_index ASC`
    )
    .all(fileId) as Array<{ row_index: number; extracted_payload_json: string }>;

  if (rows.length === 0) {
    return {
      available: false,
      status: "insufficient_data",
      openingBalance: null,
      closingBalance: null,
      expectedClosingBalance: null,
      netActivity: null,
      variance: null,
      note: "No parsed transaction rows for reconciliation."
    };
  }

  let firstBalance: number | null = null;
  let firstAmount: number | null = null;
  let lastBalance: number | null = null;
  let rawNet = 0;

  for (const row of rows) {
    let payload: RawPayloadWithBalance | null = null;
    try {
      payload = JSON.parse(row.extracted_payload_json) as RawPayloadWithBalance;
    } catch {
      payload = null;
    }
    if (!payload) {
      continue;
    }
    const amount = typeof payload.amount === "number" && Number.isFinite(payload.amount) ? payload.amount : null;
    if (amount !== null) {
      rawNet += amount;
    }
    const bal = extractBalanceFromSourceRow(payload.source_row);
    if (bal === null) {
      continue;
    }
    if (firstBalance === null) {
      firstBalance = bal;
      firstAmount = amount;
    }
    lastBalance = bal;
  }

  if (firstBalance === null || lastBalance === null || firstAmount === null) {
    return {
      available: false,
      status: "insufficient_data",
      openingBalance: null,
      closingBalance: null,
      expectedClosingBalance: null,
      netActivity: roundMoney(rawNet),
      variance: null,
      note: "Running balance not available in parsed rows for this file profile."
    };
  }

  const openingBalance = roundMoney(firstBalance - firstAmount);
  const netActivity = roundMoney(rawNet);
  const expectedClosingBalance = roundMoney(openingBalance + netActivity);
  const closingBalance = roundMoney(lastBalance);
  const variance = roundMoney(closingBalance - expectedClosingBalance);
  const status = Math.abs(variance) <= 0.01 ? "ok" : "mismatch";

  return {
    available: true,
    status,
    openingBalance,
    closingBalance,
    expectedClosingBalance,
    netActivity,
    variance,
    note:
      status === "ok"
        ? "Statement running balance check passed."
        : "Statement running balance mismatch detected; review missing/extra lines or date window."
  };
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
      `SELECT id, file_name, status, confidence_summary FROM import_file WHERE session_id = ? ORDER BY uploaded_at ASC`
    )
    .all(sessionId) as Array<{ id: string; file_name: string; status: string; confidence_summary: string | null }>;

  const fileIds = fileRows.map((f) => f.id);
  if (fileIds.length === 0) {
    return {
      sessionId,
      totals: {
        rawRows: 0,
        canonicalRows: 0,
        nearDuplicatesFlagged: 0,
        openItemsNeedingReview: 0,
        notPostedExactDuplicateOrSkipped: 0,
        reconciliationAvailableFiles: 0,
        reconciliationMismatchedFiles: 0
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
  let totalReconAvailable = 0;
  let totalReconMismatch = 0;

  const files: ImportSessionFileSummary[] = fileRows.map((f) => {
    let diagnostics: ImportSessionFileSummary["diagnostics"] | undefined;
    if (f.confidence_summary) {
      try {
        const parsed = JSON.parse(f.confidence_summary) as Record<string, unknown>;
        const parser = parsed && typeof parsed === "object" ? (parsed["parserDiagnostics"] as Record<string, unknown> | undefined) : undefined;
        const canonicalize =
          parsed && typeof parsed === "object"
            ? (parsed["canonicalize"] as Record<string, unknown> | undefined)
            : undefined;
        if (parser || canonicalize) {
          diagnostics = { parser, canonicalize };
        }
      } catch {
        diagnostics = undefined;
      }
    }
    const rawRowCount = rawByFile.get(f.id) ?? 0;
    const canonicalRowCount = canonicalByFile.get(f.id) ?? 0;
    const nearDuplicatesFlagged = nearDupByFile.get(f.id) ?? 0;
    const openItemsNeedingReview =
      (openNearByFile.get(f.id) ?? 0) + (openCanonicalByFile.get(f.id) ?? 0);
    const notPostedExactDuplicateOrSkipped = Math.max(
      0,
      rawRowCount - canonicalRowCount - nearDuplicatesFlagged
    );
    const reconciliation = reconciliationForFile(f.id);

    totalRaw += rawRowCount;
    totalCanon += canonicalRowCount;
    totalNear += nearDuplicatesFlagged;
    totalOpenReview += openItemsNeedingReview;
    totalExactOrSkip += notPostedExactDuplicateOrSkipped;
    if (reconciliation.available) {
      totalReconAvailable += 1;
      if (reconciliation.status === "mismatch") {
        totalReconMismatch += 1;
      }
    }

    return {
      fileId: f.id,
      fileName: f.file_name,
      status: f.status,
      rawRowCount,
      canonicalRowCount,
      nearDuplicatesFlagged,
      openItemsNeedingReview,
      notPostedExactDuplicateOrSkipped,
      reconciliation,
      diagnostics
    };
  });

  return {
    sessionId,
    totals: {
      rawRows: totalRaw,
      canonicalRows: totalCanon,
      nearDuplicatesFlagged: totalNear,
      openItemsNeedingReview: totalOpenReview,
      notPostedExactDuplicateOrSkipped: totalExactOrSkip,
      reconciliationAvailableFiles: totalReconAvailable,
      reconciliationMismatchedFiles: totalReconMismatch
    },
    files
  };
}
