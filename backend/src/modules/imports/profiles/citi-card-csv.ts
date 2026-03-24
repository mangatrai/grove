import { parseCsvWithHeader, parseAmount } from "./tabular-helpers.js";

export interface NormalizedRawPayload {
  txn_date: string;
  posting_date: string;
  description: string;
  amount: number;
  reference_id?: string;
  source_row: Record<string, string>;
}

function pick(row: Record<string, string>, key: string): string {
  if (row[key] !== undefined) {
    return row[key];
  }
  const lower = key.toLowerCase();
  const found = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return found ? row[found] : "";
}

/**
 * Citi card CSV: Status, Date, Description, Debit, Credit, Member Name.
 * Amount is split across Debit/Credit columns.
 */
export function parseCitiCardCsv(buffer: Buffer): NormalizedRawPayload[] {
  const rows = parseCsvWithHeader(buffer.toString("utf8"));
  const out: NormalizedRawPayload[] = [];

  for (const row of rows) {
    const date = pick(row, "Date").trim();
    const description = pick(row, "Description").trim();
    const debit = pick(row, "Debit").trim();
    const credit = pick(row, "Credit").trim();

    let amount: number | null = null;
    if (debit) {
      const d = parseAmount(debit);
      if (d !== null) {
        amount = -Math.abs(d);
      }
    } else if (credit) {
      amount = parseAmount(credit);
    }

    if (!date || !description || amount === null) {
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
