import type { BoaStatementBalances } from "./boa-checking-savings-csv.js";
import type { NormalizedRawPayload } from "./types.js";
import { parseAmount } from "./tabular-helpers.js";

const MONTH_MAP: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04",
  jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDateToIso(s: string): string | null {
  const t = s.trim();
  // MM/DD/YYYY or MM/DD/YY
  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const y = slash[3]!.length === 2
      ? (Number(slash[3]) > 50 ? `19${slash[3]}` : `20${slash[3]}`)
      : slash[3]!;
    return `${y}-${slash[1]!.padStart(2, "0")}-${slash[2]!.padStart(2, "0")}`;
  }
  // "April 21, 2026" or "April 21 2026"
  const text = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (text) {
    const mm = MONTH_MAP[text[1]!.toLowerCase()];
    if (mm) return `${text[3]}-${mm}-${text[2]!.padStart(2, "0")}`;
  }
  return null;
}

// Matches a date in either MM/DD/YYYY or "Month DD, YYYY" format
const DATE_PAT = String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})`;
const AMT_PAT = String.raw`(\d{1,3}(?:,\d{3})*\.\d{2})`;
const BEG_RE = new RegExp(
  String.raw`Beginning\s+balance(?:\s+as\s+of|\s+on)?\s+${DATE_PAT}[^\d]*${AMT_PAT}`, "i"
);
const END_RE = new RegExp(
  String.raw`Ending\s+balance(?:\s+as\s+of|\s+on)?\s+${DATE_PAT}[^\d]*${AMT_PAT}`, "i"
);

/**
 * Best-effort beginning/ending balance from BoA deposit eStatement PDF text (summary area).
 * Handles both MM/DD/YYYY and "Month DD, YYYY" date formats.
 */
export function extractBoaEStatementBalancesFromText(text: string): BoaStatementBalances | null {
  const norm = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  let beginning: number | null = null;
  let ending: number | null = null;
  let asOfStart: string | null = null;
  let asOfEnd: string | null = null;

  const beg = norm.match(BEG_RE);
  if (beg) {
    asOfStart = parseDateToIso(beg[1]!);
    beginning = parseAmount(beg[2]!);
  }
  const end = norm.match(END_RE);
  if (end) {
    asOfEnd = parseDateToIso(end[1]!);
    ending = parseAmount(end[2]!);
  }

  if (beginning === null && ending === null) {
    return null;
  }
  return {
    currency: "USD",
    beginning,
    ending,
    asOfStart,
    asOfEnd,
    source: "boa_estatement_pdf"
  };
}

type Zone = "none" | "deposits" | "atm" | "other" | "withdrawals";


/** pdf-parse output often concatenates headers and dates (no spaces). */
function isBoaColumnHeaderLine(line: string): boolean {
  const compact = line.replace(/\s/g, "");
  return (
    compact === "DateDescriptionAmount" ||
    compact.startsWith("DateDescriptionAm") // rare truncation
  );
}

export function parseBoaEStatementFromTextDetailed(text: string): {
  rows: NormalizedRawPayload[];
  statementBalances: BoaStatementBalances | null;
} {
  const statementBalances = extractBoaEStatementBalancesFromText(text);
  const lines = text.split(/\r?\n/);
  const out: NormalizedRawPayload[] = [];
  let zone: Zone = "none";
  let pendingHeader = false;

  let i = 0;
  while (i < lines.length) {
    const lineTrim = lines[i].trim();

    if (lineTrim === "Deposits and other additions") {
      zone = "deposits";
      pendingHeader = true;
      i++;
      continue;
    }
    if (zone === "deposits" && /^Deposits and other additions - continued/i.test(lineTrim)) {
      pendingHeader = true;
      i++;
      continue;
    }
    if (zone === "deposits" && pendingHeader && isBoaColumnHeaderLine(lineTrim)) {
      pendingHeader = false;
      i++;
      continue;
    }
    if (zone === "deposits" && /^Total deposits and other additions/i.test(lineTrim)) {
      zone = "none";
      pendingHeader = false;
      i++;
      continue;
    }

    if (lineTrim === "ATM and debit card subtractions") {
      zone = "atm";
      pendingHeader = true;
      i++;
      continue;
    }
    if (zone === "atm" && /^ATM and debit card subtractions - continued/i.test(lineTrim)) {
      pendingHeader = true;
      i++;
      continue;
    }
    if (zone === "atm" && pendingHeader && isBoaColumnHeaderLine(lineTrim)) {
      pendingHeader = false;
      i++;
      continue;
    }
    if (zone === "atm" && /^Total ATM and debit card subtractions/i.test(lineTrim)) {
      zone = "none";
      pendingHeader = false;
      i++;
      continue;
    }

    if (lineTrim === "Other subtractions") {
      zone = "other";
      pendingHeader = true;
      i++;
      continue;
    }
    if (zone === "other" && /^Other subtractions - continued/i.test(lineTrim)) {
      pendingHeader = true;
      i++;
      continue;
    }
    if (zone === "other" && pendingHeader && isBoaColumnHeaderLine(lineTrim)) {
      pendingHeader = false;
      i++;
      continue;
    }
    if (zone === "other" && /^Total other subtractions/i.test(lineTrim)) {
      zone = "none";
      pendingHeader = false;
      i++;
      continue;
    }

    // "Withdrawals and other subtractions" is a zone on its own for accounts that
    // don't break it into ATM / Other subsections (e.g. Adv Relationship Banking).
    // On accounts that DO have subsections, "ATM and debit card subtractions" and
    // "Other subtractions" checks above fire first and override this zone.
    if (lineTrim === "Withdrawals and other subtractions") {
      zone = "withdrawals";
      pendingHeader = true;
      i++;
      continue;
    }
    if (zone === "withdrawals" && /^Withdrawals and other subtractions - continued/i.test(lineTrim)) {
      pendingHeader = true;
      i++;
      continue;
    }
    if (zone === "withdrawals" && pendingHeader && isBoaColumnHeaderLine(lineTrim)) {
      pendingHeader = false;
      i++;
      continue;
    }
    if (zone === "withdrawals" && /^Total\s+withdrawals\s+and\s+other\s+subtractions/i.test(lineTrim)) {
      zone = "none";
      pendingHeader = false;
      i++;
      continue;
    }

    if (zone !== "none" && !pendingHeader) {
      const consumed = tryConsumeBoaTransaction(lines, i);
      if (consumed) {
        out.push(consumed.payload);
        i = consumed.nextIdx;
        continue;
      }
    }

    i++;
  }

  return { rows: out, statementBalances };
}

export function parseBoaEStatementFromText(text: string): NormalizedRawPayload[] {
  return parseBoaEStatementFromTextDetailed(text).rows;
}

function splitTrailingAmount(rest: string): { description: string; amount: number } | null {
  const m = rest.match(/^(.*?)(-?\$?\d{1,3}(?:,\d{3})*\.\d{2})\s*$/);
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
  return { description, amount };
}

function tryConsumeBoaTransaction(
  lines: string[],
  startIdx: number
): { payload: NormalizedRawPayload; nextIdx: number } | null {
  const line = lines[startIdx].trimEnd();
  const m = line.match(/^(\d{2}\/\d{2}\/\d{2,4})(.*)$/);
  if (!m) {
    return null;
  }

  const date = m[1]!;
  let rest = (m[2] ?? "").trimEnd();

  const sameLine = splitTrailingAmount(rest);
  if (sameLine) {
    return {
      payload: {
        txn_date: date,
        posting_date: date,
        description: sameLine.description,
        amount: sameLine.amount,
        source_row: { date, description: sameLine.description, amount: String(sameLine.amount) }
      },
      nextIdx: startIdx + 1
    };
  }

  let desc = rest;
  let j = startIdx + 1;
  while (j < lines.length) {
    const next = lines[j].trim();
    if (/^\d{2}\/\d{2}\/\d{2}/.test(next)) {
      break;
    }
    if (/^Total\s+/i.test(next)) {
      break;
    }
    if (isBoaColumnHeaderLine(next)) {
      break;
    }
    if (/^--\s*\d+\s+of\s+\d+\s+--/.test(next)) {
      j++;
      continue;
    }
    if (/^Page \d+ of \d+$/i.test(next)) {
      j++;
      continue;
    }
    // BoA PDFs print the account holder's name (all-caps) followed by "!" as a
    // section marker — this line is a header artifact, not part of the description.
    if (/^[A-Z][A-Z\s]{2,30}[A-Z]\s+!/.test(next)) {
      break;
    }
    if (/^\s*(-?\$?\d{1,3}(?:,\d{3})*\.\d{2})\s*$/.test(next)) {
      const amount = parseAmount(next.trim());
      if (amount === null) {
        return null;
      }
      return {
        payload: {
          txn_date: date,
          posting_date: date,
          description: desc.trim(),
          amount,
          source_row: { date, description: desc.trim(), amount: String(amount) }
        },
        nextIdx: j + 1
      };
    }
    desc += " " + next.trim();
    j++;
  }

  return null;
}
