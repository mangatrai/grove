import type { NormalizedRawPayload } from "./types.js";
import { extractPdfText } from "./pdf-text.js";
import { parseAmount } from "./tabular-helpers.js";

type Zone = "none" | "deposits" | "atm" | "other";

/**
 * Bank of America deposit account eStatement PDF (Adv Relationship / checking-style layout).
 * Parses "Deposits and other additions", "ATM and debit card subtractions", and "Other subtractions" tables.
 */
export async function parseBoaEStatementPdf(buffer: Buffer): Promise<NormalizedRawPayload[]> {
  const text = await extractPdfText(buffer);
  return parseBoaEStatementFromText(text);
}

/** pdf-parse output often concatenates headers and dates (no spaces). */
function isBoaColumnHeaderLine(line: string): boolean {
  const compact = line.replace(/\s/g, "");
  return (
    compact === "DateDescriptionAmount" ||
    compact.startsWith("DateDescriptionAm") // rare truncation
  );
}

export function parseBoaEStatementFromText(text: string): NormalizedRawPayload[] {
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

    if (lineTrim === "Withdrawals and other subtractions" || /^Withdrawals and other subtractions - continued/i.test(lineTrim)) {
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

  return out;
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
  const m = line.match(/^(\d{2}\/\d{2}\/\d{2})(.*)$/);
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
    if (/^MANGAT RAI\s+!/.test(next)) {
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
