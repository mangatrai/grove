import path from "node:path";

import { csvAdapter } from "./csv.adapter.js";
import { excelAdapter } from "./excel.adapter.js";
import type { TabularParserAdapter } from "./types.js";

function extensionOf(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

export function resolveParserAdapter(fileName: string): TabularParserAdapter | null {
  const ext = extensionOf(fileName);
  if (ext === ".csv") {
    return csvAdapter;
  }
  if (ext === ".xlsx" || ext === ".xls") {
    return excelAdapter;
  }
  return null;
}

