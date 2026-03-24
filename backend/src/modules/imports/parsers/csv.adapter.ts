import { parse } from "csv-parse/sync";

import type { ParserOptions, TabularParserAdapter } from "./types.js";

export const csvAdapter: TabularParserAdapter = {
  name: "csv",
  parse(buffer: Buffer, _options?: ParserOptions): Record<string, string>[] {
    const text = buffer.toString("utf8");
    const rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, unknown>[];

    return rows.map((row) => {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[String(key)] = value == null ? "" : String(value);
      }
      return normalized;
    });
  }
};

