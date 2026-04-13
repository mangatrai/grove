import type { NormalizedRawPayload } from "./types.js";
import type { BoaStatementBalances } from "./boa-checking-savings-csv.js";
import { extractPdfText } from "./pdf-text.js";
import { parseAmount } from "./tabular-helpers.js";

/**
 * Marcus / Goldman Sachs Bank USA Online Savings account statement (STMTCMB100-style PDF).
 */
export async function parseMarcusOnlineSavingsPdf(
  buffer: Buffer
): Promise<{ rows: NormalizedRawPayload[]; statementBalances: BoaStatementBalances | null }> {
  const text = await extractPdfText(buffer);
  return parseMarcusOnlineSavingsFromText(text);
}

/** Convert MM/DD/YYYY → YYYY-MM-DD. Returns original string if not parseable. */
function mmddyyyyToIso(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    return raw.trim();
  }
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/** pdf-parse often emits `DateDescriptionCreditsDebitsBalance` without spaces. */
function isMarcusActivityHeaderLine(line: string): boolean {
  return line.replace(/\s/g, "") === "DateDescriptionCreditsDebitsBalance";
}

export function parseMarcusOnlineSavingsFromText(
  text: string
): { rows: NormalizedRawPayload[]; statementBalances: BoaStatementBalances | null } {
  const idx = text.indexOf("ACCOUNT ACTIVITY");
  if (idx < 0) {
    return { rows: [], statementBalances: null };
  }
  const tail = text.slice(idx);
  const lines = tail.split(/\r?\n/);
  const out: NormalizedRawPayload[] = [];
  let endingBalance: number | null = null;
  let endingBalanceDate: string | null = null;

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

    // Capture ending balance directly — the row has only one monetary value (the balance itself).
    if (/Ending Balance/i.test(line)) {
      const dateM = line.match(/^(\d{2}\/\d{2}\/\d{4})/);
      const amtM = line.match(/\$[\d,]+\.\d{2}/);
      if (dateM && amtM) {
        const parsed = parseAmount(amtM[0]);
        if (parsed !== null) {
          endingBalance = Math.abs(parsed);
          endingBalanceDate = mmddyyyyToIso(dateM[1]!);
        }
      }
      continue;
    }

    const row = parseMarcusActivityLine(line);
    if (row) {
      out.push(row);
    }
  }

  const statementBalances: BoaStatementBalances | null =
    endingBalance !== null && endingBalanceDate
      ? {
          currency: "USD",
          beginning: null,
          ending: endingBalance,
          asOfStart: null,
          asOfEnd: endingBalanceDate,
          source: "ofx_transactions" as BoaStatementBalances["source"]
        }
      : null;

  return { rows: out, statementBalances };
}

function parseMarcusActivityLine(line: string): NormalizedRawPayload | null {
  const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})(.*)$/);
  if (!dateMatch) {
    return null;
  }
  const date = mmddyyyyToIso(dateMatch[1]!);
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

  // Ending Balance is handled by the caller; Beginning Balance has no sign value.
  if (/Beginning Balance/i.test(desc)) {
    return null;
  }

  const amt = parseAmount(firstAmountStr);
  if (amt === null) {
    return null;
  }

  // Savings account sign convention: credit = positive (money arriving), debit = negative.
  // Use description keywords; amounts[0] position alone can't distinguish Credits vs Debits columns.
  let signed: number;
  if (
    /interest paid|deposit|credit|payment from|transfer from|incoming|direct deposit|ach credit|refund/i.test(desc)
  ) {
    signed = Math.abs(amt);
  } else if (
    /withdrawal|debit|payment to|transfer to|ach withdrawal|outgoing|wire out|fee/i.test(desc)
  ) {
    signed = -Math.abs(amt);
  } else {
    // Unknown type — default to debit (conservative for a savings account).
    // If you see deposits incorrectly signed, add the description keyword above.
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
