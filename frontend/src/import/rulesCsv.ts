/** CSV columns for classification rules export/import (stable order). */
export const RULES_CSV_HEADERS = [
  "origin",
  "id",
  "rule_key",
  "pattern",
  "match_type",
  "amount_scope",
  "category_id",
  "category_path",
  "priority",
  "confidence",
  "enabled"
] as const;

export type RulesCsvHeader = (typeof RULES_CSV_HEADERS)[number];

export type CategoryRowLike = {
  id: string;
  name: string;
  parentId: string | null;
};

export function categoryPathForCsv(cat: CategoryRowLike, all: CategoryRowLike[]): string {
  if (!cat.parentId) {
    return cat.name;
  }
  const p = all.find((x) => x.id === cat.parentId);
  return p ? `${p.name} > ${cat.name}` : cat.name;
}

export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildRulesCsvLines(
  rows: Array<Record<RulesCsvHeader, string>>
): string {
  const headerLine = RULES_CSV_HEADERS.join(",");
  const body = rows.map((r) => RULES_CSV_HEADERS.map((h) => escapeCsvField(r[h] ?? "")).join(","));
  return [headerLine, ...body].join("\n") + "\n";
}

/** Parse CSV (RFC 4180-style quoted fields). Returns rows as header → value maps. */
export function parseRulesCsv(text: string): {
  rows: Array<Partial<Record<RulesCsvHeader, string>> & Record<string, string>>;
  error?: string;
} {
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\r") {
        /* ignore */
      } else if (c === "\n") {
        row.push(field);
        lines.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  row.push(field);
  if (field.length > 0 || row.length > 1 || (row.length === 1 && row[0] !== "")) {
    lines.push(row);
  }

  if (lines.length === 0) {
    return { rows: [], error: "Empty file" };
  }

  const rawHeader = lines[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const headerMap = new Map<string, number>();
  rawHeader.forEach((h, idx) => headerMap.set(h, idx));

  const missing = RULES_CSV_HEADERS.filter((h) => !headerMap.has(h));
  if (missing.length > 0) {
    return { rows: [], error: `Missing columns: ${missing.join(", ")}` };
  }

  const rows: Array<Partial<Record<RulesCsvHeader, string>> & Record<string, string>> = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r]!;
    const rec: Record<string, string> = {};
    for (const h of RULES_CSV_HEADERS) {
      const idx = headerMap.get(h);
      rec[h] = idx !== undefined ? (cells[idx] ?? "").trim() : "";
    }
    if (RULES_CSV_HEADERS.every((h) => !(rec[h] ?? "").length) && cells.every((c) => !c.trim())) {
      continue;
    }
    rows.push(rec as Partial<Record<RulesCsvHeader, string>> & Record<string, string>);
  }

  return { rows };
}
