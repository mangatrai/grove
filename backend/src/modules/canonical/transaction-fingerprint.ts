import crypto from "node:crypto";

/**
 * Deterministic transaction fingerprint for dedupe (Epic 4.2).
 *
 * Contract:
 * - Same logical transaction (same household, account, calendar date, signed amount to cents, same normalized description)
 *   MUST yield the same fingerprint.
 * - Amounts are normalized to **two decimal places** (cents) before hashing to avoid float noise.
 * - Descriptions are lowercased, whitespace-collapsed, non-alphanumeric stripped, truncated to 200 chars.
 */

function pad2(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

/** Round to cents for stable equality and hashing. */
export function normalizeAmountForFingerprint(amount: number): number {
  if (!Number.isFinite(amount)) {
    return NaN;
  }
  return Math.round(amount * 100) / 100;
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
  const rounded = normalizeAmountForFingerprint(input.amount);
  const payload = `${input.householdId}|${input.accountId}|${input.txnDate}|${rounded}|${input.normalizedDescription}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

