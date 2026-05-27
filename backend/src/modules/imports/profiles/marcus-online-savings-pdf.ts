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
  const compact = line.replace(/\s/g, "").toLowerCase();
  return compact.startsWith("datedescription") && compact.includes("balance");
}

export function parseMarcusOnlineSavingsFromText(
  text: string
): { rows: NormalizedRawPayload[]; statementBalances: BoaStatementBalances | null } {

  // --- Pre-scan full text for SUMMARY block ---
  // The summary (Beginning Balance, Ending Balance, Statement Period) appears
  // before ACCOUNT ACTIVITY and does not have date prefixes on its lines.
  let summaryBeginning: number | null = null;
  let summaryEnding: number | null = null;
  let summaryPeriodStart: string | null = null;
  let summaryPeriodEnd: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^Beginning Balance/i.test(line)) {
      const amtM = line.match(/\$[\d,]+\.\d{2}/);
      if (amtM) {
        const parsed = parseAmount(amtM[0]);
        if (parsed !== null) summaryBeginning = Math.abs(parsed);
      }
    }
    if (/^Ending Balance/i.test(line)) {
      const amtM = line.match(/\$[\d,]+\.\d{2}/);
      if (amtM) {
        const parsed = parseAmount(amtM[0]);
        if (parsed !== null) summaryEnding = Math.abs(parsed);
      }
    }
    if (/^Statement Period/i.test(line)) {
      const dates = line.match(/(\d{2}\/\d{2}\/\d{4})/g);
      if (dates && dates.length >= 2) {
        summaryPeriodStart = mmddyyyyToIso(dates[0]!);
        summaryPeriodEnd = mmddyyyyToIso(dates[1]!);
      }
    }
  }

  // --- Activity table parsing ---
  const activityM = /\bACCOUNT ACTIVITY\b/i.exec(text);
  const idx = activityM ? activityM.index : -1;
  if (idx < 0) {
    return { rows: [], statementBalances: buildStatementBalances(summaryBeginning, summaryEnding, summaryPeriodStart, summaryPeriodEnd) };
  }

  const tail = text.slice(idx);
  const lines = tail.split(/\r?\n/);
  const out: NormalizedRawPayload[] = [];

  // Table-level ending balance (date-prefixed row inside the activity table).
  let tableEndingBalance: number | null = null;
  let tableEndingBalanceDate: string | null = null;

  let inTable = false;
  // Accumulated date line waiting for a continuation line that carries the amounts.
  // pdf-parse interleaves wrapped description text with the adjacent amount columns,
  // so an ACH deposit whose description wraps produces:
  //   "03/23/2026 ACH Deposit Internet transfer from BANK OF AMERICA, N.A. DDA"  ← no amounts
  //   "$3,000.00 $3,476.38"                                                       ← amounts only
  //   "account ****************3560"                                               ← extra desc
  // We save the date line, then join it with the first continuation line that
  // carries ≥2 amounts to produce the combined line parseMarcusActivityLine expects.
  let pendingLine: string | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!inTable) {
      if (isMarcusActivityHeaderLine(line)) {
        inTable = true;
      }
      continue;
    }

    if (line.startsWith("Streamline your savings") || line.startsWith("-- ")) {
      pendingLine = null;
      break;
    }

    // Ending Balance row inside the table (may or may not have a date prefix).
    if (/Ending Balance/i.test(line)) {
      const dateM = line.match(/^(\d{2}\/\d{2}\/\d{4})/);
      const amtM = line.match(/\$[\d,]+\.\d{2}/);
      if (amtM) {
        const parsed = parseAmount(amtM[0]);
        if (parsed !== null) {
          tableEndingBalance = Math.abs(parsed);
          if (dateM) tableEndingBalanceDate = mmddyyyyToIso(dateM[1]!);
        }
      }
      pendingLine = null;
      continue;
    }

    const hasDate = /^\d{2}\/\d{2}\/\d{4}/.test(line);
    const amountCount = (line.match(/\$[\d,]+\.\d{2}/g) ?? []).length;

    if (hasDate) {
      // Discard any pending that never resolved (malformed row).
      pendingLine = null;

      if (amountCount >= 2) {
        // Self-contained line (e.g. "03/31/2026 Interest Paid $4.60 $8,480.98").
        const row = parseMarcusActivityLine(line);
        if (row) out.push(row);
      } else {
        // Description wraps onto the next line — save and wait for amounts.
        pendingLine = line;
      }
    } else if (pendingLine !== null) {
      if (amountCount >= 2) {
        // Amounts arrived on the continuation line — join and parse as one.
        const combined = `${pendingLine} ${line.trim()}`;
        const row = parseMarcusActivityLine(combined);
        if (row) out.push(row);
        pendingLine = null;
      } else if (amountCount === 0) {
        // Extra description text (e.g., "account ****************3560") —
        // append to the description portion and keep waiting for amounts.
        pendingLine = `${pendingLine} ${line.trim()}`;
      }
      // 1 amount: unusual edge case — keep accumulating.
    }
  }

  // Prefer table-extracted ending balance; fall back to summary block.
  const endingBalance = tableEndingBalance ?? summaryEnding;
  const endingBalanceDate = tableEndingBalanceDate ?? summaryPeriodEnd;

  return {
    rows: out,
    statementBalances: buildStatementBalances(summaryBeginning, endingBalance, summaryPeriodStart, endingBalanceDate)
  };
}

function buildStatementBalances(
  beginning: number | null,
  ending: number | null,
  periodStart: string | null,
  periodEnd: string | null
): BoaStatementBalances | null {
  if (ending === null || !periodEnd) return null;
  return {
    currency: "USD",
    beginning,
    ending,
    asOfStart: periodStart,
    asOfEnd: periodEnd,
    source: "marcus_online_savings_pdf" as const
  };
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

  // Ending Balance is handled by the caller; Beginning Balance has no transaction value.
  if (/Beginning Balance/i.test(desc)) {
    return null;
  }

  const amt = parseAmount(firstAmountStr);
  if (amt === null) {
    return null;
  }

  // Savings account sign convention: credits positive, debits negative.
  // Determined from description keywords; column position alone is unreliable after pdf-parse.
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
