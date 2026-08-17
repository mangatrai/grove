import type { BoaStatementBalances } from "./boa-checking-savings-csv.js";
import type { NormalizedRawPayload } from "./types.js";
import { extractPdfText } from "./pdf-text.js";
import { parseAmount } from "./tabular-helpers.js";

/** Citi credit card statement dates are `MM/DD/YY`. */
function mmddyyToIso(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) {
    return null;
  }
  const yy = Number(m[3]);
  const year = yy > 50 ? 1900 + yy : 2000 + yy;
  return `${year}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/**
 * Transaction table rows only have `MM/DD` (no year). Resolve against the billing
 * period so a period spanning a year boundary (e.g. Dec 20 - Jan 19) attributes
 * December transactions to the earlier year.
 */
function resolveTxnYear(month: number, periodStartIso: string | null, periodEndIso: string | null): string {
  if (!periodEndIso) {
    return String(new Date().getFullYear());
  }
  const endYear = Number(periodEndIso.slice(0, 4));
  const endMonth = Number(periodEndIso.slice(5, 7));
  if (!periodStartIso) {
    return String(endYear);
  }
  const startYear = Number(periodStartIso.slice(0, 4));
  if (startYear === endYear) {
    return String(endYear);
  }
  return month > endMonth ? String(startYear) : String(endYear);
}

function mmddToIso(raw: string, periodStartIso: string | null, periodEndIso: string | null): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) {
    return null;
  }
  const month = Number(m[1]);
  const year = resolveTxnYear(month, periodStartIso, periodEndIso);
  return `${year}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

type StatementHeader = {
  periodStartIso: string | null;
  periodEndIso: string | null;
  newBalance: number | null;
  newBalanceDate: string | null;
  previousBalance: number | null;
};

function extractStatementHeader(text: string): StatementHeader {
  let periodStartIso: string | null = null;
  let periodEndIso: string | null = null;

  const periodM = text.match(/Billing Period:\s*(\d{1,2}\/\d{1,2}\/\d{2})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2})/);
  if (periodM) {
    periodStartIso = mmddyyToIso(periodM[1]!);
    periodEndIso = mmddyyToIso(periodM[2]!);
  }

  let newBalance: number | null = null;
  let newBalanceDate: string | null = null;
  const newBalM = text.match(/New balance as of\s*(\d{1,2}\/\d{1,2}\/\d{2}):\s*\$([\d,]+\.\d{2})/);
  if (newBalM) {
    newBalanceDate = mmddyyToIso(newBalM[1]!);
    newBalance = parseAmount(newBalM[2]!);
  }

  let previousBalance: number | null = null;
  const prevBalM = text.match(/Previous balance\s*\$([\d,]+\.\d{2})/);
  if (prevBalM) {
    previousBalance = parseAmount(prevBalM[1]!);
  }

  return { periodStartIso, periodEndIso, newBalance, newBalanceDate, previousBalance };
}

/** Best-effort ending/beginning balance from the "Account Summary" block on page 1. */
export function extractCitiCreditCardBalancesFromText(text: string): BoaStatementBalances | null {
  const header = extractStatementHeader(text);
  const asOfEnd = header.newBalanceDate;
  const asOfStart = header.periodStartIso;

  if (header.newBalance === null && header.previousBalance === null) {
    return null;
  }

  return {
    currency: "USD",
    beginning: header.previousBalance,
    ending: header.newBalance,
    asOfStart: header.previousBalance !== null ? asOfStart : null,
    asOfEnd: header.newBalance !== null ? asOfEnd : null,
    source: "citi_credit_card_pdf"
  };
}

type Zone = "none" | "credit" | "charge";

const CREDIT_ZONE_RE = /^Payments,\s*Credits\s*and\s*Adjustments$/i;
const CHARGE_ZONE_RE = /^(Standard Purchases|Purchases|Cash Advances|Balance Transfers|Other Charges.*|Fees Charged|Interest Charged)$/i;
const END_TABLE_RE = /^\d{4}\s+totals\s+year-to-date$/i;

function splitTrailingAmount(rest: string): { description: string; rawAmount: string; amount: number } | null {
  const m = rest.match(/^(.*?)\s*(-?\$[\d,]+\.\d{2})\s*$/);
  if (!m) {
    return null;
  }
  const amount = parseAmount(m[2]!);
  if (amount === null) {
    return null;
  }
  const description = m[1]!.trim();
  if (!description) {
    return null;
  }
  return { description, rawAmount: m[2]!, amount };
}

function tryParseCitiActivityLine(
  line: string,
  periodStartIso: string | null,
  periodEndIso: string | null,
  zone: Zone
): NormalizedRawPayload | null {
  // Sale Date / Post Date are each `MM/DD` and are printed back-to-back with no
  // separator when both are present; only Post Date is printed for payments/fees.
  const m = line.match(/^(\d{1,2}\/\d{1,2})(\d{1,2}\/\d{1,2})?(.*)$/);
  if (!m) {
    return null;
  }

  const saleDateRaw = m[1]!;
  const postDateRaw = m[2] ?? m[1]!;
  const rest = (m[3] ?? "").trim();

  const split = splitTrailingAmount(rest);
  if (!split) {
    return null;
  }

  const txnDate = mmddToIso(saleDateRaw, periodStartIso, periodEndIso);
  const postingDate = mmddToIso(postDateRaw, periodStartIso, periodEndIso);
  if (!txnDate || !postingDate) {
    return null;
  }

  const isLiteralCredit = split.rawAmount.trim().startsWith("-");
  // Payments/credits always reduce the balance owed (positive in our sign convention).
  // Charge zones (purchases/fees/interest/etc.) increase it (negative) unless the
  // statement explicitly prints a refund/credit with a leading "-" on that line.
  const signed = zone === "credit" || isLiteralCredit ? Math.abs(split.amount) : -Math.abs(split.amount);

  return {
    txn_date: txnDate,
    posting_date: postingDate,
    description: split.description,
    amount: signed,
    source_row: {
      saleDate: saleDateRaw,
      postDate: postDateRaw,
      description: split.description,
      amount: String(signed)
    }
  };
}

export function parseCitiCreditCardPdfFromText(text: string): {
  rows: NormalizedRawPayload[];
  statementBalances: BoaStatementBalances | null;
} {
  const statementBalances = extractCitiCreditCardBalancesFromText(text);
  const header = extractStatementHeader(text);

  const tableHeaderM = /(?:^|\r?\n)ACCOUNT SUMMARY\r?\n/.exec(text);
  if (!tableHeaderM) {
    return { rows: [], statementBalances };
  }

  const lines = text.slice(tableHeaderM.index).split(/\r?\n/);
  const out: NormalizedRawPayload[] = [];
  let zone: Zone = "none";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (END_TABLE_RE.test(line)) {
      break;
    }
    if (CREDIT_ZONE_RE.test(line)) {
      zone = "credit";
      continue;
    }
    if (CHARGE_ZONE_RE.test(line)) {
      zone = "charge";
      continue;
    }
    if (zone === "none") {
      continue;
    }
    const row = tryParseCitiActivityLine(line, header.periodStartIso, header.periodEndIso, zone);
    if (row) {
      out.push(row);
    }
  }

  return { rows: out, statementBalances };
}

/** Citi consumer credit card eStatement PDF (e.g. AAdvantage MileUp Card). */
export async function parseCitiCreditCardPdf(
  buffer: Buffer
): Promise<{ rows: NormalizedRawPayload[]; statementBalances: BoaStatementBalances | null }> {
  const text = await extractPdfText(buffer);
  return parseCitiCreditCardPdfFromText(text);
}
