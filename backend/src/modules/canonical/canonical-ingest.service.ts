import crypto from "node:crypto";

import { db } from "../../db/sqlite.js";
import type { NormalizedRawPayload } from "../imports/profiles/types.js";

export interface CanonicalizeOutcome {
  inserted: number;
  duplicates: number;
  skipped: number;
}

export type CanonicalizeFailure =
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "NO_RAW_ROWS"; message: string };

function pad2(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

/** Normalize dates like MM/DD/YY and MM/DD/YYYY to YYYY-MM-DD for stable fingerprints. */
export function normalizeTxnDateForFingerprint(raw: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    return t.slice(0, 10);
  }
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = parseInt(m[3]!, 10);
    if (y < 100) {
      y += y <= 50 ? 2000 : 1900;
    }
    return `${y}-${pad2(m[1]!)}-${pad2(m[2]!)}`;
  }
  return t;
}

export function normalizeDescriptionForFingerprint(description: string): string {
  return description
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .slice(0, 200);
}

export function computeTransactionFingerprint(input: {
  householdId: string;
  accountId: string;
  txnDate: string;
  amount: number;
  normalizedDescription: string;
}): string {
  const rounded = Math.round(input.amount * 100) / 100;
  const payload = `${input.householdId}|${input.accountId}|${input.txnDate}|${rounded}|${input.normalizedDescription}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

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

/**
 * Map `transaction_raw` rows for a session into `transaction_canonical` with strict fingerprint dedupe
 * (`uq_transaction_canonical_fingerprint` on household_id + fingerprint).
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
  const insertStmt = db.prepare(
    `INSERT INTO transaction_canonical (
       id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
       merchant, memo, transfer_group_id, fingerprint, source_ref, status
     ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, 'posted')`
  );

  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;

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
    const fingerprint = computeTransactionFingerprint({
      householdId,
      accountId,
      txnDate: normDate,
      amount,
      normalizedDescription: normDesc
    });

    if (existsStmt.get(householdId, fingerprint)) {
      duplicates += 1;
      continue;
    }

    const direction = amount >= 0 ? "credit" : "debit";
    const desc = parsed.description.trim();
    const merchant = desc.length > 120 ? desc.slice(0, 120) : desc;
    const memo = desc.length > 120 ? desc : null;

    try {
      insertStmt.run(
        crypto.randomUUID(),
        householdId,
        accountId,
        normDate,
        amount,
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

  return { ok: true, data: { inserted, duplicates, skipped } };
}
