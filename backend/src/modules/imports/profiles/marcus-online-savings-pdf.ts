import type { NormalizedRawPayload } from "./types.js";
import { extractPdfText } from "./pdf-text.js";
import { parseAmount } from "./tabular-helpers.js";

/**
 * Marcus / Goldman Sachs Bank USA Online Savings account statement (STMTCMB100-style PDF).
 */
export async function parseMarcusOnlineSavingsPdf(buffer: Buffer): Promise<NormalizedRawPayload[]> {
  const text = await extractPdfText(buffer);
  return parseMarcusOnlineSavingsFromText(text);
}

/** pdf-parse often emits `DateDescriptionCreditsDebitsBalance` without spaces. */
function isMarcusActivityHeaderLine(line: string): boolean {
  return line.replace(/\s/g, "") === "DateDescriptionCreditsDebitsBalance";
}

export function parseMarcusOnlineSavingsFromText(text: string): NormalizedRawPayload[] {
  const idx = text.indexOf("ACCOUNT ACTIVITY");
  if (idx < 0) {
    return [];
  }
  const tail = text.slice(idx);
  const lines = tail.split(/\r?\n/);
  const out: NormalizedRawPayload[] = [];

  let inTable = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!inTable) {
      if (isMarcusActivityHeaderLine(line)) {
        inTable = true;
      }
      continue;
    }

    if (line.startsWith("Streamline your savings") || line.startsWith("-- ")) {
      break;
    }

    const row = parseMarcusActivityLine(line);
    if (row) {
      out.push(row);
    }
  }

  return out;
}

function parseMarcusActivityLine(line: string): NormalizedRawPayload | null {
  const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})(.*)$/);
  if (!dateMatch) {
    return null;
  }
  const date = dateMatch[1]!;
  const rest = dateMatch[2] ?? "";

  const moneyRe = /\$[\d,]+\.\d{2}/g;
  const amounts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = moneyRe.exec(rest)) !== null) {
    amounts.push(m[0]);
  }

  if (amounts.length < 2) {
    return null;
  }

  const balanceStr = amounts[amounts.length - 1]!;
  const firstAmountStr = amounts[0]!;
  const firstIdx = rest.indexOf(firstAmountStr);
  if (firstIdx < 0) {
    return null;
  }
  const desc = rest.slice(0, firstIdx).trim();

  if (/Beginning Balance|Ending Balance/i.test(desc)) {
    return null;
  }

  const amt = parseAmount(firstAmountStr);
  if (amt === null) {
    return null;
  }

  let signed: number;
  if (/interest paid|deposit|credit|payment from|transfer from/i.test(desc)) {
    signed = Math.abs(amt);
  } else if (/withdrawal|debit|payment to|transfer to|ACH Withdrawal/i.test(desc)) {
    signed = -Math.abs(amt);
  } else {
    signed = -Math.abs(amt);
  }

  return {
    txn_date: date,
    posting_date: date,
    description: desc,
    amount: signed,
    source_row: {
      date,
      description: desc,
      amount: String(signed),
      balance: balanceStr
    }
  };
}
