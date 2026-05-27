/**
 * Wealthfront savings / investment account CSV parser (CR-076).
 *
 * Columns: Transaction date, Description, Type, Amount
 * Date format: M/D/YYYY (single-digit month/day)
 * Amount sign: positive = deposit/credit, negative = withdrawal — already canonical convention.
 */

import { parseCsvWithHeader, parseAmount, pickCol } from "./tabular-helpers.js";
import type { NormalizedRawPayload } from "./types.js";

/** Convert M/D/YYYY → YYYY-MM-DD. Returns null if not parseable. */
function mdyyyyToIso(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    return null;
  }
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

export function parseWealthfrontInvestmentCsv(buffer: Buffer): NormalizedRawPayload[] {
  const rows = parseCsvWithHeader(buffer.toString("utf8"));
  const out: NormalizedRawPayload[] = [];

  for (const row of rows) {
    const rawDate = pickCol(row, "Transaction date", "Transaction Date", "Date");
    const description = pickCol(row, "Description");
    const rawAmount = pickCol(row, "Amount");

    if (!rawDate || !description || !rawAmount) {
      continue;
    }
    const txnDate = mdyyyyToIso(rawDate);
    if (!txnDate) {
      continue;
    }
    const amount = parseAmount(rawAmount);
    if (amount === null) {
      continue;
    }

    out.push({
      txn_date: txnDate,
      posting_date: txnDate,
      description,
      amount,
      source_row: row
    });
  }

  return out;
}
