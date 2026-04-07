/**
 * Deloitte Pay Statement from Unstructured Platform partition output (Jobs download JSON).
 * Primary: Table `metadata.text_as_html` (row/cell structure). Fallback: Table `text`.
 */
import { load } from "cheerio";

import type { ParsedPayslipSummary } from "../payslip.types.js";
import { normalizePdfExtractText, parsePayDate, parsePayPeriod, payslipSummaryHasMinimumFields } from "./ibm-payslip-pdf.js";

export type UnstructuredPartitionElement = {
  type?: string;
  text?: string;
  metadata?: {
    text_as_html?: string;
    page_number?: number;
    filename?: string;
    [key: string]: unknown;
  };
};

function parseMoneyToken(s: string): number | null {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Two currency values after a label (handles `NET PAY$4,370.18$13,173.41` and spaced variants). */
function twoMoneyValuesAfterLabel(rowText: string, labelRe: RegExp): { current: number; ytd: number } | null {
  const m = rowText.match(labelRe);
  if (!m) {
    return null;
  }
  const tail = rowText.slice(m.index! + m[0].length);
  const nums = [...tail.matchAll(/\$?\s*([\d,]+\.\d{2})/g)].map((x) => parseMoneyToken(x[1]!)).filter((x): x is number => x !== null);
  if (nums.length >= 2) {
    return { current: nums[0]!, ytd: nums[1]! };
  }
  return null;
}

function extractTotalsFromHtml(html: string): {
  grossCurrent: number;
  grossYtd: number;
  netCurrent: number;
  netYtd: number;
} | null {
  const $ = load(html);
  let grossPair: { current: number; ytd: number } | null = null;
  let netPair: { current: number; ytd: number } | null = null;
  for (const tr of $("tr").toArray()) {
    const t = $(tr).text().replace(/\s+/g, " ").trim();
    if (!grossPair && /TOTAL\s+GROSS/i.test(t)) {
      grossPair = twoMoneyValuesAfterLabel(t, /TOTAL\s+GROSS/i);
    }
    if (!netPair && /NET\s+PAY/i.test(t)) {
      netPair = twoMoneyValuesAfterLabel(t, /NET\s+PAY/i);
    }
  }
  if (!grossPair || !netPair) {
    return null;
  }
  return {
    grossCurrent: grossPair.current,
    grossYtd: grossPair.ytd,
    netCurrent: netPair.current,
    netYtd: netPair.ytd
  };
}

/** Fallback when HTML is missing: same anchors on flattened table text. */
function extractTotalsFromPlainText(text: string): {
  grossCurrent: number;
  grossYtd: number;
  netCurrent: number;
  netYtd: number;
} | null {
  const one = text.replace(/\s+/g, " ");
  const gross = twoMoneyValuesAfterLabel(one, /TOTAL\s+GROSS/i);
  const net = twoMoneyValuesAfterLabel(one, /NET\s+PAY/i);
  if (!gross || !net) {
    return null;
  }
  return {
    grossCurrent: gross.current,
    grossYtd: gross.ytd,
    netCurrent: net.current,
    netYtd: net.ytd
  };
}

/**
 * Concatenate element texts for date/period heuristics (IBM helpers expect US-style blobs).
 */
function contextTextFromElements(elements: UnstructuredPartitionElement[]): string {
  const parts = elements.map((e) => (typeof e.text === "string" ? e.text : "")).filter(Boolean);
  return normalizePdfExtractText(parts.join("\n")).trim();
}

/**
 * Parse Deloitte payslip summary from Unstructured partition elements (array of element dicts).
 */
export function parseDeloittePayslipFromUnstructuredElements(
  elements: UnstructuredPartitionElement[]
): ParsedPayslipSummary | null {
  if (!Array.isArray(elements) || elements.length === 0) {
    return null;
  }

  const table = elements.find((e) => e.type === "Table" && (e.metadata?.text_as_html || e.text));
  const html = table?.metadata?.text_as_html?.trim();
  const plain = typeof table?.text === "string" ? table.text.trim() : "";

  let totals = html ? extractTotalsFromHtml(html) : null;
  if (!totals && plain) {
    totals = extractTotalsFromPlainText(plain);
  }

  if (!totals) {
    return null;
  }

  const ctx = contextTextFromElements(elements);
  const period = parsePayPeriod(ctx);
  const payDate = parsePayDate(ctx);

  const parsed: ParsedPayslipSummary = {
    payPeriodStart: period.start,
    payPeriodEnd: period.end,
    payDate,
    hoursOrDaysCurrent: null,
    grossPayCurrent: totals.grossCurrent,
    grossPayYtd: totals.grossYtd,
    employeeTaxesCurrent: null,
    employeeTaxesYtd: null,
    preTaxDeductionsCurrent: null,
    preTaxDeductionsYtd: null,
    postTaxDeductionsCurrent: null,
    postTaxDeductionsYtd: null,
    netPayCurrent: totals.netCurrent,
    netPayYtd: totals.netYtd,
    rawExtractJson: {
      parserProfile: "deloitte_payslip_pdf",
      unstructuredSource: "table",
      usedTextAsHtml: Boolean(html)
    }
  };

  return payslipSummaryHasMinimumFields(parsed) ? parsed : null;
}
