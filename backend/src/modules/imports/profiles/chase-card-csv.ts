import { parseCsvWithHeader, parseAmount } from "./tabular-helpers.js";

export interface NormalizedRawPayload {
  txn_date: string;
  posting_date: string;
  description: string;
  amount: number;
  reference_id?: string;
  source_row: Record<string, string>;
}

/** Chase credit card Activity CSV: header row 1, signed Amount column. */
export function parseChaseCardCsv(buffer: Buffer): NormalizedRawPayload[] {
  const rows = parseCsvWithHeader(buffer.toString("utf8"));
  const out: NormalizedRawPayload[] = [];

  for (const row of rows) {
    const txnDate = row["Transaction Date"]?.trim() ?? "";
    const postDate = row["Post Date"]?.trim() ?? "";
    const description = row["Description"]?.trim() ?? "";
    const rawAmount = row["Amount"]?.trim() ?? "";
    const amount = parseAmount(rawAmount);
    if (!txnDate || !description || amount === null) {
      continue;
    }
    out.push({
      txn_date: txnDate,
      posting_date: postDate,
      description,
      amount,
      source_row: row
    });
  }

  return out;
}
