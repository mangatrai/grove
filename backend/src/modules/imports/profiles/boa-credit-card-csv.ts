import { parseCsvWithHeader, parseAmount } from "./tabular-helpers.js";

export interface NormalizedRawPayload {
  txn_date: string;
  posting_date: string;
  description: string;
  amount: number;
  reference_id?: string;
  source_row: Record<string, string>;
}

/** BoA credit card CSV: Posted Date, Reference Number, Payee, Address, Amount */
export function parseBoaCreditCardCsv(buffer: Buffer): NormalizedRawPayload[] {
  const rows = parseCsvWithHeader(buffer.toString("utf8"));
  const out: NormalizedRawPayload[] = [];

  for (const row of rows) {
    const posted = row["Posted Date"]?.trim() ?? "";
    const payee = row["Payee"]?.trim() ?? "";
    const ref = row["Reference Number"]?.trim() ?? "";
    const rawAmt = row["Amount"]?.trim() ?? "";
    const amount = parseAmount(rawAmt);
    if (!posted || !payee || amount === null) {
      continue;
    }
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
