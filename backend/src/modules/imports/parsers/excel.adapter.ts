import * as XLSX from "xlsx";

import type { ParserOptions, TabularParserAdapter } from "./types.js";

export const excelAdapter: TabularParserAdapter = {
  name: "excel",
  parse(buffer: Buffer, options?: ParserOptions): Record<string, string>[] {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = options?.sheetName ?? workbook.SheetNames[0];
    if (!sheetName) {
      return [];
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return [];
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: ""
    });

    return rows.map((row) => {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[String(key)] = value == null ? "" : String(value);
      }
      return normalized;
    });
  }
};

