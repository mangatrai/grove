/**
 * Discover card activity CSV parser (CR-076).
 *
 * Columns: Trans. Date, Post Date, Description, Amount, Category
 * Date format: MM/DD/YYYY
 * Amount sign: positive = charge (debit), negative = payment/credit.
 * We negate amounts so charges become negative (canonical convention: debit = negative).
 */

import { parseCsvWithHeader, parseAmount, pickCol } from "./tabular-helpers.js";
import type { NormalizedRawPayload } from "./types.js";

/** Convert MM/DD/YYYY → YYYY-MM-DD. Returns null if not parseable. */
function mmddyyyyToIso(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    return null;
  }
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

export function parseDiscoverCardCsv(buffer: Buffer): NormalizedRawPayload[] {
  const rows = parseCsvWithHeader(buffer.toString("utf8"));
  const out: NormalizedRawPayload[] = [];

  for (const row of rows) {
    const rawTxnDate = pickCol(row, "Trans. Date", "Transaction Date", "Date");
    const rawPostDate = pickCol(row, "Post Date", "Posted Date", "Posting Date");
    const description = pickCol(row, "Description");
    const rawAmount = pickCol(row, "Amount");
    const category = pickCol(row, "Category");

    if (!rawTxnDate || !description || !rawAmount) {
      continue;
    }
    const txnDate = mmddyyyyToIso(rawTxnDate);
    if (!txnDate) {
      continue;
    }
    const parsed = parseAmount(rawAmount);
    if (parsed === null) {
      continue;
    }
    // Discover: positive = charge (money leaving) → store as negative.
    const amount = -parsed;

    const source_row: Record<string, string> = { ...row };
    if (category) {
      source_row["Category"] = category;
    }
    out.push({
      txn_date: txnDate,
      posting_date: mmddyyyyToIso(rawPostDate) ?? txnDate,
      description,
      amount,
      source_row
    });
  }

  return out;
}
