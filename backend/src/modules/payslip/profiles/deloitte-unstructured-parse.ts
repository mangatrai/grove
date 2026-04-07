/**
 * Deloitte Pay Statement from Unstructured Platform partition output (Jobs download JSON).
 *
 * Primary: Table `metadata.text_as_html` (row/cell structure). Fallback: Table `text`.
 * When `text_as_html` is missing, plain `Table.text` still works for totals, but the summary
 * header line contains a column label `Net Pay` before the true `NET PAY $… $…` totals row.
 * Net extraction therefore prefers the totals line (`NET PAY` + `$` or last `NET PAY` match).
 */
import { load } from "cheerio";

import type { ParsedPayslipSummary } from "../payslip.types.js";
import {
  normalizePdfExtractText,
  parsePayDate,
  parsePayPeriod,
  payslipSummaryHasMinimumFields
} from "./ibm-payslip-pdf.js";
import {
  parseDeloitteDates,
  parseDeloitteSummaryDeductions,
  tableHtmlThTextBlob
} from "./deloitte-unstructured-helpers.js";

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
  const nums = [...tail.matchAll(/\$?\s*([\d,]+\.\d{2})/g)]
    .map((x) => parseMoneyToken(x[1]!))
    .filter((x): x is number => x !== null);
  if (nums.length >= 2) {
    return { current: nums[0]!, ytd: nums[1]! };
  }
  return null;
}

/**
 * Prefer the true totals row: Deloitte uses `NET PAY $current $ytd`. The summary strip uses
 * `Net Pay` as a column header with different numbers after it — match last `NET PAY` or
 * a row that includes `NET PAY` immediately followed by `$`.
 */
function netPayPairFromRowTexts(rowTexts: string[]): { current: number; ytd: number } | null {
  const netRows = rowTexts.filter((t) => /\bNET\s+PAY\b/i.test(t));
  const withDollar = netRows.filter((t) => /\bNET\s+PAY\s*\$/i.test(t));
  const ordered = withDollar.length > 0 ? withDollar : netRows;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const t = ordered[i]!;
    const p = twoMoneyValuesAfterLabel(t, /\bNET\s+PAY\b/i);
    if (p) {
      return p;
    }
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
  const rowTexts = $("tr")
    .toArray()
    .map((tr) => $(tr).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);

  let grossPair: { current: number; ytd: number } | null = null;
  for (const t of rowTexts) {
    if (/TOTAL\s+GROSS/i.test(t)) {
      grossPair = twoMoneyValuesAfterLabel(t, /TOTAL\s+GROSS/i);
      if (grossPair) {
        break;
      }
    }
  }
  const netPair = netPayPairFromRowTexts(rowTexts);

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

/**
 * Plain `Table.text` contains two `NET PAY` phrases: a summary `Net Pay` column and the
 * `NET PAY $… $…` line — use {@link netPayPairFromRowTexts} on single-line “rows” derived
 * from the whole blob by splitting would be fragile; instead scan for last `NET PAY` match.
 */
function extractNetPayPairFromPlainText(one: string): { current: number; ytd: number } | null {
  const re = /\bNET\s+PAY\b/gi;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(one)) !== null) {
    last = m;
  }
  if (!last) {
    return null;
  }
  const sliceFrom = one.slice(last.index!);
  return twoMoneyValuesAfterLabel(sliceFrom, /^\s*NET\s+PAY\b/i);
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
  const net = extractNetPayPairFromPlainText(one);
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
  const thBlob = tableHtmlThTextBlob(html);
  const dateCtx = [ctx, thBlob].filter(Boolean).join("\n");
  const deloitteDates = parseDeloitteDates(dateCtx);
  const ibmPeriod = parsePayPeriod(ctx);
  const payPeriodStart = deloitteDates.payPeriodStart ?? ibmPeriod.start;
  const payPeriodEnd = deloitteDates.payPeriodEnd ?? ibmPeriod.end;
  const payDate = deloitteDates.payDate ?? parsePayDate(ctx);

  const oneLine = plain.replace(/\s+/g, " ");
  const summaryDed = parseDeloitteSummaryDeductions(oneLine);

  const parsed: ParsedPayslipSummary = {
    payPeriodStart,
    payPeriodEnd,
    payDate,
    hoursOrDaysCurrent: null,
    grossPayCurrent: totals.grossCurrent,
    grossPayYtd: totals.grossYtd,
    employeeTaxesCurrent: summaryDed?.employeeTaxesCurrent ?? null,
    employeeTaxesYtd: null,
    preTaxDeductionsCurrent: summaryDed?.preTaxDeductionsCurrent ?? null,
    preTaxDeductionsYtd: null,
    postTaxDeductionsCurrent: summaryDed?.postTaxDeductionsCurrent ?? null,
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
