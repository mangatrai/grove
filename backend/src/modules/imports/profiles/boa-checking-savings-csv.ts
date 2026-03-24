import { parseAmount, parseCsvWithHeader, sliceBoaTransactionTable } from "./tabular-helpers.js";

export interface NormalizedRawPayload {
  txn_date: string;
  posting_date: string;
  description: string;
  amount: number;
  reference_id?: string;
  source_row: Record<string, string>;
}

/** BoA checking/savings export with leading summary block. */
export function parseBoaCheckingOrSavingsCsv(buffer: Buffer): NormalizedRawPayload[] {
  const sliced = sliceBoaTransactionTable(buffer.toString("utf8"));
  if (!sliced) {
    return [];
  }

  const rows = parseCsvWithHeader(sliced);
  const out: NormalizedRawPayload[] = [];

  for (const row of rows) {
    const date = row["Date"]?.trim() ?? "";
    const description = row["Description"]?.trim() ?? "";
    const rawAmt = row["Amount"]?.trim() ?? "";
    const amount = parseAmount(rawAmt);
    if (!date || !description || amount === null) {
      continue;
    }
    if (description.toLowerCase().includes("beginning balance")) {
      continue;
    }

    out.push({
      txn_date: date,
      posting_date: date,
      description,
      amount,
      source_row: row
    });
  }

  return out;
}
