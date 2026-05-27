import { parse } from "csv-parse/sync";

/** Strip $ and commas; parse number (handles "1,234.56"). */
export function parseAmount(value: string): number | null {
  const normalized = value.replace(/[$,]/g, "").trim();
  if (!normalized) {
    return null;
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function parseCsvWithHeader(csvText: string): Record<string, string>[] {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true
  }) as Record<string, unknown>[];

  return rows.map((row) => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[String(key)] = value == null ? "" : String(value);
    }
    return normalized;
  });
}

export function countCsvDataLines(csvText: string): number {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line.length > 0);
  if (nonEmpty.length <= 1) {
    return 0;
  }
  // Header line + N data rows
  return nonEmpty.length - 1;
}

/**
 * Look up a column value from a CSV row, trying candidates in order.
 * Tries exact match first, then case-insensitive. Returns "" if none found.
 */
export function pickCol(row: Record<string, string>, ...candidates: string[]): string {
  for (const name of candidates) {
    if (name in row) return row[name]!;
  }
  const entries = Object.entries(row);
  for (const name of candidates) {
    const lower = name.toLowerCase();
    const found = entries.find(([k]) => k.toLowerCase() === lower);
    if (found) return found[1];
  }
  return "";
}

/**
 * BoA checking/savings web export: summary lines first; transaction header is
 * `Date,Description,Amount,Running Bal.` (or similar).
 */
export function sliceBoaTransactionTable(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return lower.startsWith("date,") && lower.includes("description") && lower.includes("amount");
  });
  if (headerIdx < 0) {
    return null;
  }
  return lines.slice(headerIdx).join("\n");
}
