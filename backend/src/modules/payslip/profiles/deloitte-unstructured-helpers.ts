/**
 * Deloitte-specific extraction for Unstructured table text / HTML (dates, summary strip).
 */
import { load } from "cheerio";

import { normalizeUsDateToIso } from "./ibm-payslip-pdf.js";

function parseMoneyToken(s: string): number | null {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Join `<th>` cell text from partitioned table HTML so period/pay-date fragments
 * (e.g. `Period Period Begin …`, `End Date Paid …`) are visible to regexes.
 */
export function tableHtmlThTextBlob(html: string | undefined): string {
  if (!html?.trim()) {
    return "";
  }
  const $ = load(html);
  return $("th")
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Pay period start/end and pay date from Deloitte header wording.
 * Combines flat partition text with optional `<th>` blob from `text_as_html`.
 */
export function parseDeloitteDates(combinedText: string): {
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payDate: string | null;
} {
  const one = combinedText.replace(/\s+/g, " ");

  let payPeriodStart: string | null = null;
  let payPeriodEnd: string | null = null;
  let payDate: string | null = null;

  const toIso = (raw: string) => normalizeUsDateToIso(raw) ?? raw;

  const endDatePaid = one.match(/\bEnd\s+Date\s+Paid\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i);
  if (endDatePaid) {
    payDate = toIso(endDatePaid[1]!);
  }

  const periodBeginPair = one.match(
    /(?:Period\s+){1,2}Begin\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i
  );
  if (periodBeginPair) {
    payPeriodStart = toIso(periodBeginPair[1]!);
    payPeriodEnd = toIso(periodBeginPair[2]!);
  }

  const flatTriple = one.match(
    /Period\s+Begin\s+Period\s+End\s+[^0-9]*\d+\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i
  );
  if (flatTriple) {
    payPeriodStart = toIso(flatTriple[1]!);
    payPeriodEnd = toIso(flatTriple[2]!);
    if (!payDate) {
      payDate = toIso(flatTriple[3]!);
    }
  }

  return { payPeriodStart, payPeriodEnd, payDate };
}

/**
 * Header summary strip: Total Earnings, Pre-Tax Ded, Tax Deduction, After-Tax Ded, Net Pay (current period amounts).
 * YTD for these buckets is not in this strip; leave YTD null elsewhere.
 */
export function parseDeloitteSummaryDeductions(oneLine: string): {
  preTaxDeductionsCurrent: number | null;
  employeeTaxesCurrent: number | null;
  postTaxDeductionsCurrent: number | null;
} | null {
  const m = oneLine.match(
    /Total\s+Earnings\s+Pre-Tax\s+Ded\s+Tax\s+Deduction\s+After-Tax\s+Ded\s+Net\s+Pay\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i
  );
  if (!m) {
    return null;
  }
  return {
    preTaxDeductionsCurrent: parseMoneyToken(m[2]!),
    employeeTaxesCurrent: parseMoneyToken(m[3]!),
    postTaxDeductionsCurrent: parseMoneyToken(m[4]!)
  };
}
