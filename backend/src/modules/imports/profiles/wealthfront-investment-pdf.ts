/**
 * Wealthfront Cash Account (savings/investment) PDF statement parser.
 *
 * Statement structure:
 *  - Header block: Starting Balance / Ending Balance with dates
 *  - Section II: Account Activity with three subsection types:
 *      A) Date/Method/Status/Amount  → deposits (Received) and withdrawals (Disbursed)
 *      B) Date/Method/Amount         → transfers between Wealthfront and Program Banks (SKIP — internal FDIC sweeps)
 *      C) Date/Interest Period/Amount → interest payments
 *
 * Amounts are already signed in the PDF: deposits positive, withdrawals negative, interest positive.
 * Program-bank transfer rows are internal account rebalancing and carry no cash-flow meaning.
 */

import type { NormalizedRawPayload } from "./types.js";
import type { BoaStatementBalances } from "./boa-checking-savings-csv.js";
import { extractPdfText } from "./pdf-text.js";
import { parseAmount } from "./tabular-helpers.js";

const MONTH_MAP: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12"
};

/** Convert "Month D, YYYY" → YYYY-MM-DD. Returns null if not parseable. */
function longDateToIso(raw: string): string | null {
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) {
    return null;
  }
  const month = MONTH_MAP[m[1]!.toLowerCase()];
  if (!month) {
    return null;
  }
  return `${m[3]}-${month}-${m[2]!.padStart(2, "0")}`;
}

/** Convert M/D/YYYY → YYYY-MM-DD. Returns null if not parseable. */
function shortDateToIso(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    return null;
  }
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

type SectionType = "none" | "activity" | "transfers_skip" | "interest";

/**
 * Detect section header at lines[i].
 * Returns the section type and the number of header lines to advance past, or null if no header here.
 */
function detectHeader(lines: string[], i: number): { section: SectionType; skip: number } | null {
  const l0 = lines[i];
  const l1 = lines[i + 1] ?? "";
  const l2 = lines[i + 2] ?? "";
  const l3 = lines[i + 3] ?? "";

  if (l0 === "Date") {
    if (l1 === "Method" && l2 === "Status" && l3 === "Amount") {
      return { section: "activity", skip: 4 };
    }
    if (l1 === "Interest Period" && l2 === "Amount") {
      return { section: "interest", skip: 3 };
    }
    if (l1 === "Method" && l2 === "Amount") {
      return { section: "transfers_skip", skip: 3 };
    }
  }
  return null;
}

/** True for lines that are footnote markers (single or small integers). */
function isFootnote(line: string): boolean {
  return /^\d{1,2}$/.test(line.trim());
}

export async function parseWealthfrontInvestmentPdf(
  buffer: Buffer
): Promise<{ rows: NormalizedRawPayload[]; statementBalances: BoaStatementBalances | null }> {
  const text = await extractPdfText(buffer);
  return parseWealthfrontFromText(text);
}

export function parseWealthfrontFromText(
  text: string
): { rows: NormalizedRawPayload[]; statementBalances: BoaStatementBalances | null } {
  // --- Ending balance extraction from the header block ---
  let endingBalance: number | null = null;
  let endingBalanceDate: string | null = null;

  const endingBalanceMatch = text.match(/([A-Za-z]+ \d{1,2}, \d{4})\nEnding Balance\n\$([\d,]+\.\d{2})/);
  if (endingBalanceMatch) {
    const parsed = parseAmount(endingBalanceMatch[2]!);
    const iso = longDateToIso(endingBalanceMatch[1]!);
    if (parsed !== null && iso) {
      endingBalance = parsed;
      endingBalanceDate = iso;
    }
  }

  // --- Activity section extraction ---
  const activityIdx = text.indexOf("II. Account Activity");
  if (activityIdx < 0) {
    return {
      rows: [],
      statementBalances:
        endingBalance !== null && endingBalanceDate
          ? { currency: "USD", beginning: null, ending: endingBalance, asOfStart: null, asOfEnd: endingBalanceDate, source: "wealthfront_investment_pdf" }
          : null
    };
  }

  // Stop before the daily balance table — it's dense date+amount rows we don't want
  const stopMarker = "Balance and Interest Rate Details";
  const stopIdx = text.indexOf(stopMarker, activityIdx);
  const activitySlice = stopIdx > 0 ? text.slice(activityIdx, stopIdx) : text.slice(activityIdx);

  const rawLines = activitySlice.split(/\r?\n/);
  // Trim whitespace, keep empty lines as placeholders (they act as row separators in some layouts)
  const lines = rawLines.map((l) => l.trim());

  const out: NormalizedRawPayload[] = [];
  let section: SectionType = "none";
  // Row accumulator: date and description parts collected before we see the amount
  let rowDate: string | null = null;
  let descParts: string[] = [];

  function flushRow(amountLine: string): void {
    if (!rowDate) {
      return;
    }
    const amount = parseAmount(amountLine);
    if (amount === null) {
      rowDate = null;
      descParts = [];
      return;
    }
    const description = buildDescription(section, descParts, amount);
    out.push({
      txn_date: rowDate,
      posting_date: rowDate,
      description,
      amount,
      source_row: { date: rowDate, description, amount: amountLine }
    });
    rowDate = null;
    descParts = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Hard stop on daily balance table
    if (line === stopMarker || line.startsWith("Disclosures")) {
      break;
    }

    // Section header detection
    const header = detectHeader(lines, i);
    if (header !== null) {
      rowDate = null;
      descParts = [];
      section = header.section;
      i += header.skip;
      continue;
    }

    // Skip lines that aren't meaningful in skip/none sections
    if (section === "transfers_skip" || section === "none") {
      i++;
      continue;
    }

    // Skip blank lines, footnote markers, "Total" summary lines
    if (!line || isFootnote(line) || line === "Total") {
      if (line === "Total") {
        rowDate = null;
        descParts = [];
      }
      i++;
      continue;
    }

    // Date line → start a new row
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line)) {
      const iso = shortDateToIso(line);
      if (iso) {
        rowDate = iso;
        descParts = [];
      }
      i++;
      continue;
    }

    // Amount line → flush the row
    if (/^-?\$[\d,]+\.\d{2}$/.test(line)) {
      flushRow(line);
      i++;
      continue;
    }

    // Description part (method, status, period description…)
    if (rowDate && line !== "Received" && line !== "Disbursed" && line !== "Status") {
      descParts.push(line);
    }
    i++;
  }

  const statementBalances: BoaStatementBalances | null =
    endingBalance !== null && endingBalanceDate
      ? {
          currency: "USD",
          beginning: null,
          ending: endingBalance,
          asOfStart: null,
          asOfEnd: endingBalanceDate,
          source: "wealthfront_investment_pdf"
        }
      : null;

  return { rows: out, statementBalances };
}

function buildDescription(section: SectionType, parts: string[], amount: number): string {
  if (section === "interest") {
    const period = parts.join(" ").trim();
    return period ? `Interest - ${period}` : "Interest Payment";
  }
  // activity section: parts = [method]
  const method = parts.join(" ").trim() || "Wealthfront";
  const direction = amount >= 0 ? "Deposit" : "Withdrawal";
  return `${method} ${direction}`;
}
