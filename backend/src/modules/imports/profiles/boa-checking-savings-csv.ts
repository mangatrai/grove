import { countCsvDataLines, parseAmount, parseCsvWithHeader, sliceBoaTransactionTable } from "./tabular-helpers.js";

/** Statement-period balances from BoA web export summary block (above transaction table). */
export type BoaStatementBalances = {
  currency: "USD";
  beginning: number | null;
  ending: number | null;
  /** ISO date (YYYY-MM-DD) for beginning balance "as of" when parsed. */
  asOfStart: string | null;
  /** ISO date for ending balance "as of" when parsed. */
  asOfEnd: string | null;
  source: "boa_checking_csv" | "boa_savings_csv" | "boa_estatement_pdf";
};

function mmddyyyyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    return null;
  }
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/**
 * Parses "Beginning balance as of …" / "Ending balance as of …" lines in the CSV preamble
 * (lines before `Date,Description,Amount,...`).
 */
export function parseBoaCsvStatementBalances(
  fullText: string,
  source: BoaStatementBalances["source"]
): BoaStatementBalances | null {
  const lines = fullText.split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return lower.startsWith("date,") && lower.includes("description") && lower.includes("amount");
  });
  if (headerIdx < 0) {
    return null;
  }
  let beginning: number | null = null;
  let ending: number | null = null;
  let asOfStart: string | null = null;
  let asOfEnd: string | null = null;

  for (const line of lines.slice(0, headerIdx)) {
    const lower = line.toLowerCase();
    if (!lower.includes("balance")) {
      continue;
    }
    const dateM = line.match(/as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const amounts = line.match(/\d{1,3}(?:,\d{3})*\.\d{2}/g);
    const amt = amounts?.length ? parseAmount(amounts[amounts.length - 1]!) : null;
    const iso = dateM ? mmddyyyyToIso(dateM[1]!) : null;
    if (lower.includes("beginning balance")) {
      if (amt !== null) {
        beginning = amt;
      }
      if (iso) {
        asOfStart = iso;
      }
    }
    if (lower.includes("ending balance")) {
      if (amt !== null) {
        ending = amt;
      }
      if (iso) {
        asOfEnd = iso;
      }
    }
  }

  if (beginning === null && ending === null) {
    return null;
  }
  return { currency: "USD", beginning, ending, asOfStart, asOfEnd, source };
}

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
  return parseBoaCheckingOrSavingsCsvDetailed(buffer).rows;
}

export interface BoaCsvDiagnostics {
  dataLineCount: number;
  csvParsedRows: number;
  fallbackParsedRows: number;
  droppedMissingFields: number;
  droppedInvalidAmount: number;
  droppedBeginningBalance: number;
  droppedLikelyMalformedCsvRows: number;
}

export function parseBoaCheckingOrSavingsCsvDetailed(
  buffer: Buffer,
  statementSource: "boa_checking_csv" | "boa_savings_csv" = "boa_checking_csv"
): { rows: NormalizedRawPayload[]; diagnostics: BoaCsvDiagnostics; statementBalances: BoaStatementBalances | null } {
  const fullText = buffer.toString("utf8");
  const statementBalances = parseBoaCsvStatementBalances(fullText, statementSource);
  const sliced = sliceBoaTransactionTable(fullText);
  if (!sliced) {
    return {
      rows: [],
      diagnostics: {
        dataLineCount: 0,
        csvParsedRows: 0,
        fallbackParsedRows: 0,
        droppedMissingFields: 0,
        droppedInvalidAmount: 0,
        droppedBeginningBalance: 0,
        droppedLikelyMalformedCsvRows: 0
      },
      statementBalances
    };
  }

  /** Strict RFC CSV row count (BoA often breaks RFC with nested quotes in Zelle lines; see tail parser below). */
  const strictCsvRows = parseCsvWithHeader(sliced);
  const lines = sliced.split(/\r?\n/);
  const out: NormalizedRawPayload[] = [];
  let droppedMissingFields = 0;
  let droppedInvalidAmount = 0;
  let droppedBeginningBalance = 0;
  const seen = new Set<string>();

  function pushPayload(date: string, description: string, amount: number, sourceRow: Record<string, string>): void {
    const key = `${date}::${description}::${amount.toFixed(2)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({
      txn_date: date,
      posting_date: date,
      description,
      amount,
      source_row: sourceRow
    });
  }

  // Primary path: parse each line from the right (amount + running balance). Handles quoted amounts and
  // BoA/Zelle rows that are not valid RFC CSV for csv-parse.
  let tailParsedRows = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const rawLine = lines[i]?.trim();
    if (!rawLine) {
      continue;
    }
    const parsed = parseBoaLineFromTail(rawLine);
    if (!parsed) {
      continue;
    }
    const { date, description, amount, sourceRow } = parsed;
    if (!date || !description) {
      droppedMissingFields += 1;
      continue;
    }
    if (description.toLowerCase().includes("beginning balance")) {
      droppedBeginningBalance += 1;
      continue;
    }
    if (amount === null) {
      droppedInvalidAmount += 1;
      continue;
    }
    const before = out.length;
    pushPayload(date, description, amount, sourceRow);
    if (out.length > before) {
      tailParsedRows += 1;
    }
  }

  const dataLineCount = countCsvDataLines(sliced);
  return {
    rows: out,
    diagnostics: {
      dataLineCount,
      csvParsedRows: strictCsvRows.length,
      fallbackParsedRows: tailParsedRows,
      droppedMissingFields,
      droppedInvalidAmount,
      droppedBeginningBalance,
      droppedLikelyMalformedCsvRows: Math.max(0, dataLineCount - strictCsvRows.length)
    },
    statementBalances
  };
}

/** Normalize description field when it is a single quoted CSV field. */
function normalizeBoaDescriptionField(raw: string): string {
  let d = raw.trim();
  if (d.startsWith('"') && d.endsWith('"') && d.length >= 2) {
    d = d.slice(1, -1).replace(/""/g, '"');
  }
  return d;
}

/**
 * BoA checking export: `Date,Description,Amount,Running Bal.` — amounts are often quoted; description may contain
 * commas, nested quotes (Zelle), or backslashes (IBM). Parse from the tail so we do not rely on RFC CSV.
 */
export function parseBoaLineFromTail(
  line: string
): { date: string; description: string; amount: number | null; sourceRow: Record<string, string> } | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const dateMatch = trimmed.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (!dateMatch) {
    return null;
  }
  const date = dateMatch[1];
  const afterDate = trimmed.slice(dateMatch[0].length);
  if (!afterDate.startsWith(",")) {
    return null;
  }
  const rest = afterDate.slice(1);

  // Typical: ... ,"-6,070.14","38,609.16"
  const twoTail = /,\s*"?(-?[0-9,]+\.[0-9]{2})"?\s*,\s*"?(-?[0-9,]+\.[0-9]{2})"?\s*$/;
  const m2 = rest.match(twoTail);
  if (m2) {
    const rawAmt = m2[1];
    const rawBal = m2[2];
    const amount = parseAmount(rawAmt);
    const description = normalizeBoaDescriptionField(rest.slice(0, rest.length - m2[0].length));
    if (!description) {
      return null;
    }
    return {
      date,
      description,
      amount,
      sourceRow: {
        Date: date,
        Description: description,
        Amount: rawAmt,
        "Running Bal.": rawBal
      }
    };
  }

  // Beginning balance row: empty amount column, e.g. `desc,,"44,679.30"`
  const emptyAmtBal = /,\s*,\s*"?(-?[0-9,]+\.[0-9]{2})"?\s*$/;
  const m0 = rest.match(emptyAmtBal);
  if (m0) {
    const rawBal = m0[1];
    const description = normalizeBoaDescriptionField(rest.slice(0, rest.length - m0[0].length));
    const amount = parseAmount(rawBal);
    return {
      date,
      description,
      amount,
      sourceRow: {
        Date: date,
        Description: description,
        Amount: "",
        "Running Bal.": rawBal
      }
    };
  }

  // Legacy fallback: unquoted tail (rare)
  return parseBoaLooseLine(trimmed);
}

function parseBoaLooseLine(
  line: string
): { date: string; description: string; amount: number | null; sourceRow: Record<string, string> } | null {
  const withBal = line.match(
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),(.*),(\(?-?\$?[\d,]+\.\d{2}\)?),(\(?-?\$?[\d,]+\.\d{2}\)?)\s*$/
  );
  const withoutBal = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}),(.*),(\(?-?\$?[\d,]+\.\d{2}\)?)\s*$/);
  const m = withBal ?? withoutBal;
  if (!m) {
    return null;
  }
  const date = m[1]?.trim() ?? "";
  const description = m[2]?.trim() ?? "";
  const rawAmount = m[3]?.trim() ?? "";
  const amount = parseAmount(rawAmount);
  if (!date || !description) {
    return null;
  }
  const sourceRow: Record<string, string> = {
    Date: date,
    Description: description,
    Amount: rawAmount
  };
  if (withBal && m[4]) {
    sourceRow["Running Bal."] = m[4].trim();
  }
  return { date, description, amount, sourceRow };
}
