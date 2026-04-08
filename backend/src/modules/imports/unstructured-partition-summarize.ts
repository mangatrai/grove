/**
 * Lightweight stats for Unstructured job download JSON (avoid logging full partition / base64).
 */
import { load } from "cheerio";

import type { UnstructuredPartitionElement } from "../payslip/profiles/deloitte-unstructured-parse.js";

export function normalizePartitionElements(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === "object" && "elements" in data && Array.isArray((data as { elements: unknown }).elements)) {
    return (data as { elements: unknown[] }).elements;
  }
  return [];
}

/** Safe to log and store in `confidence_summary` — no binary / image payloads. */
export function summarizePartitionForDiagnostics(data: unknown): {
  elementCount: number;
  typeCounts: Record<string, number>;
  tableFound: boolean;
  tableTextLen: number;
  tableTextAsHtmlLen: number;
  wrapperKeys: string[] | null;
} {
  const elements = normalizePartitionElements(data) as UnstructuredPartitionElement[];
  const typeCounts: Record<string, number> = {};
  for (const el of elements) {
    const t = typeof el?.type === "string" ? el.type : "(no type)";
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }
  const table = elements.find((e) => e?.type === "Table");
  const html = table?.metadata && typeof table.metadata === "object" && "text_as_html" in table.metadata;
  const htmlStr = html && typeof (table!.metadata as { text_as_html?: unknown }).text_as_html === "string"
    ? (table!.metadata as { text_as_html: string }).text_as_html
    : "";
  const plain = typeof table?.text === "string" ? table.text : "";
  const wrapperKeys =
    data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data as object).slice(0, 20) : null;
  return {
    elementCount: elements.length,
    typeCounts,
    tableFound: Boolean(table),
    tableTextLen: plain.length,
    tableTextAsHtmlLen: htmlStr.length,
    wrapperKeys
  };
}

/** Why Deloitte totals extraction might fail — log on parse miss. */
export function deloitteTableAnchorDiagnostics(data: unknown): {
  plainHasTotalGross: boolean;
  plainNetPayMatches: number;
  htmlTrCount: number | null;
  htmlRowsWithTotalGross: number;
  htmlRowsWithNetPay: number;
} {
  const elements = normalizePartitionElements(data) as UnstructuredPartitionElement[];
  const table = elements.find((e) => e?.type === "Table");
  const plain = typeof table?.text === "string" ? table.text : "";
  const html =
    table?.metadata && typeof table.metadata === "object" && "text_as_html" in table.metadata
      ? String((table.metadata as { text_as_html?: unknown }).text_as_html ?? "")
      : "";

  let htmlTrCount: number | null = null;
  let htmlRowsWithTotalGross = 0;
  let htmlRowsWithNetPay = 0;
  if (html.trim()) {
    const $ = load(html);
    htmlTrCount = $("tr").length;
    for (const tr of $("tr").toArray()) {
      const t = $(tr).text().replace(/\s+/g, " ");
      if (/TOTAL\s+GROSS/i.test(t)) {
        htmlRowsWithTotalGross += 1;
      }
      if (/\bNET\s+PAY\b/i.test(t)) {
        htmlRowsWithNetPay += 1;
      }
    }
  }

  return {
    plainHasTotalGross: /TOTAL\s+GROSS/i.test(plain),
    plainNetPayMatches: [...plain.matchAll(/\bNET\s+PAY\b/gi)].length,
    htmlTrCount,
    htmlRowsWithTotalGross,
    htmlRowsWithNetPay
  };
}
