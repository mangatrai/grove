import { parseCsvWithHeader, parseAmount } from "./tabular-helpers.js";
import type { NormalizedRawPayload } from "./types.js";

/** Convert MM/DD/YYYY → YYYY-MM-DD. Returns original string if not parseable. */
function mmddyyyyToIso(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    return raw.trim();
  }
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/**
 * BoA credit card online activity CSV.
 * Columns: Posted Date, Reference Number, Payee, Address, Amount
 * Amount sign convention: positive = credit/refund, negative = charge (debit).
 */
export function parseBoaCreditCardCsv(buffer: Buffer): NormalizedRawPayload[] {
  const rows = parseCsvWithHeader(buffer.toString("utf8"));
  const out: NormalizedRawPayload[] = [];

  for (const row of rows) {
    const rawPosted = row["Posted Date"]?.trim() ?? "";
    const payee = row["Payee"]?.trim() ?? "";
    const ref = row["Reference Number"]?.trim() ?? "";
    const rawAmt = row["Amount"]?.trim() ?? "";
    const amount = parseAmount(rawAmt);
    if (!rawPosted || !payee || amount === null) {
      continue;
    }
    const posted = mmddyyyyToIso(rawPosted);
    out.push({
      txn_date: posted,
      posting_date: posted,
      description: payee,
      amount,
      reference_id: ref || undefined,
      source_row: row
    });
  }

  return out;
}
