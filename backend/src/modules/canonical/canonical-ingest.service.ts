import crypto from "node:crypto";

import { db } from "../../db/sqlite.js";
import { deleteStagingFilesForSession } from "../imports/import-session.service.js";
import type { NormalizedRawPayload } from "../imports/profiles/types.js";
import {
  computeTransactionFingerprint,
  descriptionsCompatibleForNearDuplicate,
  normalizeAmountForFingerprint,
  normalizeDescriptionForFingerprint,
  normalizeTxnDateForFingerprint
} from "./transaction-fingerprint.js";

export interface CanonicalizeOutcome {
  inserted: number;
  duplicates: number;
  skipped: number;
  /** Same account/date/amount as an existing row but different fingerprint; routed to resolution queue. */
  nearDuplicates: number;
}

export type CanonicalizeFailure =
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "NO_RAW_ROWS"; message: string };

export {
  computeTransactionFingerprint,
  normalizeAmountForFingerprint,
  normalizeDescriptionForFingerprint,
  normalizeTxnDateForFingerprint
} from "./transaction-fingerprint.js";

type RawPayloadWithAccount = NormalizedRawPayload & { financial_account_id: string };

function isRawPayload(value: unknown): value is RawPayloadWithAccount {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.txn_date === "string" &&
    typeof v.description === "string" &&
    typeof v.amount === "number" &&
    Number.isFinite(v.amount) &&
    typeof v.financial_account_id === "string" &&
    v.financial_account_id.length > 0
  );
}

function existingDescriptionFingerprint(merchant: string | null, memo: string | null): string {
  const s = (merchant || memo || "").trim();
  return normalizeDescriptionForFingerprint(s);
}

/**
 * Map `transaction_raw` rows for a session into `transaction_canonical` with strict fingerprint dedupe
 * (`uq_transaction_canonical_fingerprint` on household_id + fingerprint).
 * Near-duplicate rows (same account/date/amount, compatible description text, different fingerprint) are
 * skipped and recorded in `resolution_item` (type `duplicate_ambiguity`).
 */
export function canonicalizeImportSession(
  sessionId: string,
  householdId: string
): { ok: true; data: CanonicalizeOutcome } | CanonicalizeFailure {
  const session = db
    .prepare(`SELECT id FROM import_session WHERE id = ? AND household_id = ?`)
    .get(sessionId, householdId) as { id: string } | undefined;
  if (!session) {
    return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
  }

  const rawRows = db
    .prepare(
      `SELECT tr.id AS raw_id, tr.extracted_payload_json AS payload_json
       FROM transaction_raw tr
       INNER JOIN import_file f ON f.id = tr.file_id
       WHERE f.session_id = ?`
    )
    .all(sessionId) as Array<{ raw_id: string; payload_json: string }>;

  if (rawRows.length === 0) {
    return { ok: false, code: "NO_RAW_ROWS", message: "No transaction_raw rows for this session; run parse first" };
  }

  const accountOkStmt = db.prepare(
    `SELECT 1 FROM financial_account WHERE id = ? AND household_id = ?`
  );
  const existsStmt = db.prepare(
    `SELECT 1 FROM transaction_canonical WHERE household_id = ? AND fingerprint = ?`
  );
  const nearStmt = db.prepare(
    `SELECT id, fingerprint, merchant, memo, amount
     FROM transaction_canonical
     WHERE household_id = ? AND account_id = ? AND txn_date = ?
       AND ABS(CAST(amount AS REAL) - ?) < 0.0001
       AND fingerprint != ?`
  );
  const insertResolutionStmt = db.prepare(
    `INSERT INTO resolution_item (id, household_id, type, target_id, reason, status)
     VALUES (?, ?, 'duplicate_ambiguity', ?, ?, 'open')`
  );
  const insertStmt = db.prepare(
    `INSERT INTO transaction_canonical (
       id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
       merchant, memo, transfer_group_id, fingerprint, source_ref, status
     ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
  );

  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;
  let nearDuplicates = 0;

  for (const row of rawRows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json) as unknown;
    } catch {
      skipped += 1;
      continue;
    }

    if (!isRawPayload(parsed)) {
      skipped += 1;
      continue;
    }

    const accountId = parsed.financial_account_id;
    if (!accountOkStmt.get(accountId, householdId)) {
      skipped += 1;
      continue;
    }

    const normDate = normalizeTxnDateForFingerprint(parsed.txn_date);
    const normDesc = normalizeDescriptionForFingerprint(parsed.description);
    const amount = parsed.amount;
    const rounded = normalizeAmountForFingerprint(amount);
    if (!Number.isFinite(rounded)) {
      skipped += 1;
      continue;
    }

    const fingerprint = computeTransactionFingerprint({
      householdId,
      accountId,
      txnDate: normDate,
      amount: rounded,
      normalizedDescription: normDesc
    });

    if (existsStmt.get(householdId, fingerprint)) {
      duplicates += 1;
      continue;
    }

    const nearCandidates = nearStmt.all(
      householdId,
      accountId,
      normDate,
      rounded,
      fingerprint
    ) as Array<{
      id: string;
      fingerprint: string;
      merchant: string | null;
      memo: string | null;
      amount: number;
    }>;

    let isNear = false;
    for (const c of nearCandidates) {
      const existingNorm = existingDescriptionFingerprint(c.merchant, c.memo);
      if (descriptionsCompatibleForNearDuplicate(normDesc, existingNorm)) {
        isNear = true;
        insertResolutionStmt.run(
          crypto.randomUUID(),
          householdId,
          row.raw_id,
          JSON.stringify({
            kind: "near_duplicate",
            existingCanonicalId: c.id,
            rawId: row.raw_id,
            message:
              "Same account, date, and amount as an existing ledger row with a similar but non-identical description fingerprint."
          })
        );
        break;
      }
    }

    if (isNear) {
      nearDuplicates += 1;
      continue;
    }

    const direction = rounded >= 0 ? "credit" : "debit";
    const desc = parsed.description.trim();
    const merchant = desc.length > 120 ? desc.slice(0, 120) : desc;
    const memo = desc.length > 120 ? desc : null;

    try {
      insertStmt.run(
        crypto.randomUUID(),
        householdId,
        accountId,
        normDate,
        rounded,
        direction,
        merchant,
        memo,
        fingerprint,
        `raw:${row.raw_id}`
      );
      inserted += 1;
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "SQLITE_CONSTRAINT_UNIQUE" || code.includes("SQLITE_CONSTRAINT")) {
        duplicates += 1;
      } else {
        throw err;
      }
    }
  }

  deleteStagingFilesForSession(sessionId);

  return { ok: true, data: { inserted, duplicates, skipped, nearDuplicates } };
}
