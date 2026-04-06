/**
 * Deloitte "Pay Statement" PDFs — layered parsing:
 * 1) IBM SuccessFactors-style line heuristics (often matches Deloitte US layout)
 * 2) Tight regex on squashed text (optional $, common headings)
 * 3) Loose scan: find "Gross Pay" / "Net Pay" (etc.) then read next dollar tokens
 *
 * We do **not** require the word "Deloitte" in extractable text — many PDFs only show it
 * in a logo, use "Pay Statement" alone, or garble the brand in pdf-parse output. The
 * import binding already selected the Deloitte profile.
 */
import { extractPdfText } from "../../imports/profiles/pdf-text.js";
import type { ParsedPayslipSummary } from "../payslip.types.js";
import {
  normalizePdfExtractText,
  parseIbmPayslipFromText,
  parsePayDate,
  parsePayPeriod,
  payslipSummaryHasMinimumFields
} from "./ibm-payslip-pdf.js";
import type { PayslipPdfParseResult } from "./ibm-payslip-pdf.js";

const MONEY_TOKEN = /-?\$?\s*[\d,]+\.\d{2}/g;

function parseMoneyPair(s1: string | undefined, s2: string | undefined): { a: number | null; b: number | null } {
  const toN = (s: string | undefined) => {
    if (!s?.trim()) {
      return null;
    }
    const n = Number(s.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return { a: toN(s1), b: toN(s2) };
}

function mergePayslipSummariesPreferFirst(
  a: ParsedPayslipSummary | null,
  b: ParsedPayslipSummary | null
): ParsedPayslipSummary | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return {
    payPeriodStart: a.payPeriodStart ?? b.payPeriodStart,
    payPeriodEnd: a.payPeriodEnd ?? b.payPeriodEnd,
    payDate: a.payDate ?? b.payDate,
    hoursOrDaysCurrent: a.hoursOrDaysCurrent ?? b.hoursOrDaysCurrent,
    grossPayCurrent: a.grossPayCurrent ?? b.grossPayCurrent,
    grossPayYtd: a.grossPayYtd ?? b.grossPayYtd,
    employeeTaxesCurrent: a.employeeTaxesCurrent ?? b.employeeTaxesCurrent,
    employeeTaxesYtd: a.employeeTaxesYtd ?? b.employeeTaxesYtd,
    preTaxDeductionsCurrent: a.preTaxDeductionsCurrent ?? b.preTaxDeductionsCurrent,
    preTaxDeductionsYtd: a.preTaxDeductionsYtd ?? b.preTaxDeductionsYtd,
    postTaxDeductionsCurrent: a.postTaxDeductionsCurrent ?? b.postTaxDeductionsCurrent,
    postTaxDeductionsYtd: a.postTaxDeductionsYtd ?? b.postTaxDeductionsYtd,
    netPayCurrent: a.netPayCurrent ?? b.netPayCurrent,
    netPayYtd: a.netPayYtd ?? b.netPayYtd,
    rawExtractJson: {
      ...(typeof b.rawExtractJson === "object" && b.rawExtractJson !== null ? b.rawExtractJson : {}),
      ...(typeof a.rawExtractJson === "object" && a.rawExtractJson !== null ? a.rawExtractJson : {}),
      deloitteLayerMerge: true
    }
  };
}

/**
 * Regex on one squashed line — optional $ before amounts (common in PDF text).
 */
function parseDeloitteRegexFallback(text: string): ParsedPayslipSummary | null {
  const normalized = normalizePdfExtractText(text).trim();
  if (!normalized) {
    return null;
  }
  const oneLine = normalized.replace(/\s+/g, " ");

  const period = parsePayPeriod(normalized);
  const payDate = parsePayDate(normalized);

  let grossPayCurrent: number | null = null;
  let grossPayYtd: number | null = null;
  let netPayCurrent: number | null = null;
  let netPayYtd: number | null = null;

  const amt = String.raw`(?:\$|\s)*([\d,]+\.\d{2})`;
  const grossRe = new RegExp(
    `(?:Gross\\s+Pay|Total\\s+Earnings|Total\\s+Gross|Regular\\s+Pay|Total\\s+Remuneration)\\s+${amt}\\s+${amt}`,
    "i"
  );
  const gm = oneLine.match(grossRe);
  if (gm) {
    const p = parseMoneyPair(gm[1], gm[2]);
    grossPayCurrent = p.a;
    grossPayYtd = p.b;
  }

  const netRe = new RegExp(
    `(?:Net\\s+Pay|Net\\s+Payment|Net\\s+Distribution|Net\\s+Amount|Take[\\s-]*Home(?:\\s+Pay)?)\\s+${amt}(?:\\s+${amt})?`,
    "i"
  );
  const nm = oneLine.match(netRe);
  if (nm) {
    const p = parseMoneyPair(nm[1], nm[2]);
    netPayCurrent = p.a;
    netPayYtd = p.b;
  }

  const parsed: ParsedPayslipSummary = {
    payPeriodStart: period.start,
    payPeriodEnd: period.end,
    payDate,
    hoursOrDaysCurrent: null,
    grossPayCurrent,
    grossPayYtd,
    employeeTaxesCurrent: null,
    employeeTaxesYtd: null,
    preTaxDeductionsCurrent: null,
    preTaxDeductionsYtd: null,
    postTaxDeductionsCurrent: null,
    postTaxDeductionsYtd: null,
    netPayCurrent,
    netPayYtd,
    rawExtractJson: {
      parserProfile: "deloitte_payslip_pdf",
      fallback: "deloitte_regex_squashed"
    }
  };

  if (!payslipSummaryHasMinimumFields(parsed)) {
    return null;
  }
  return parsed;
}

/**
 * After squashing, find a label and take the first one or two decimal money tokens that follow.
 * Handles "$5,000.00" and spaced columns from noisy extracts.
 */
function pairAfterLabel(squashed: string, label: RegExp): { current: number | null; ytd: number | null } {
  const m = squashed.match(label);
  if (!m || m.index === undefined) {
    return { current: null, ytd: null };
  }
  const tail = squashed.slice(m.index + m[0].length, m.index + m[0].length + 220);
  const raw = tail.match(MONEY_TOKEN);
  if (!raw || raw.length === 0) {
    return { current: null, ytd: null };
  }
  const toN = (s: string) => {
    const n = Number(s.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const current = toN(raw[0]!);
  const ytd = raw.length >= 2 ? toN(raw[1]!) : null;
  return { current, ytd };
}

function parseDeloitteLabelScanFallback(text: string): ParsedPayslipSummary | null {
  const normalized = normalizePdfExtractText(text).trim();
  if (!normalized) {
    return null;
  }
  const squashed = normalized.replace(/\s+/g, " ");
  const period = parsePayPeriod(normalized);
  const payDate = parsePayDate(normalized);

  const grossLabels = [
    /\bGross\s+Pay\b/i,
    /\bTotal\s+Earnings\b/i,
    /\bTotal\s+Gross\b/i,
    /\bTotal\s+Remuneration\b/i,
    /\bRegular\s+Pay\b/i
  ];
  const netLabels = [
    /\bNet\s+Pay\b/i,
    /\bNet\s+Payment\b/i,
    /\bNet\s+Distribution\b/i,
    /\bNet\s+Amount\b/i
  ];

  let grossPayCurrent: number | null = null;
  let grossPayYtd: number | null = null;
  for (const re of grossLabels) {
    const p = pairAfterLabel(squashed, re);
    if (p.current !== null || p.ytd !== null) {
      grossPayCurrent = p.current;
      grossPayYtd = p.ytd;
      break;
    }
  }

  let netPayCurrent: number | null = null;
  let netPayYtd: number | null = null;
  for (const re of netLabels) {
    const p = pairAfterLabel(squashed, re);
    if (p.current !== null || p.ytd !== null) {
      netPayCurrent = p.current;
      netPayYtd = p.ytd;
      break;
    }
  }

  const parsed: ParsedPayslipSummary = {
    payPeriodStart: period.start,
    payPeriodEnd: period.end,
    payDate,
    hoursOrDaysCurrent: null,
    grossPayCurrent,
    grossPayYtd,
    employeeTaxesCurrent: null,
    employeeTaxesYtd: null,
    preTaxDeductionsCurrent: null,
    preTaxDeductionsYtd: null,
    postTaxDeductionsCurrent: null,
    postTaxDeductionsYtd: null,
    netPayCurrent,
    netPayYtd,
    rawExtractJson: {
      parserProfile: "deloitte_payslip_pdf",
      fallback: "deloitte_label_scan"
    }
  };

  if (!payslipSummaryHasMinimumFields(parsed)) {
    return null;
  }
  return parsed;
}

/** Try IBM parse on raw text, then on whitespace-collapsed variants (common PDF extract noise). */
function tryIbmPayslipVariants(text: string): ParsedPayslipSummary | null {
  const normalized = normalizePdfExtractText(text).trim();
  if (!normalized) {
    return null;
  }
  const attempts = [
    normalized,
    normalized.replace(/\s+/g, " "),
    normalized.replace(/\r?\n+/g, " ").replace(/\s+/g, " ")
  ];
  for (const chunk of attempts) {
    const r = parseIbmPayslipFromText(chunk);
    if (r) {
      return r;
    }
  }
  return null;
}

export function parseDeloittePayslipFromText(text: string): ParsedPayslipSummary | null {
  const normalized = normalizePdfExtractText(text).trim();
  if (!normalized) {
    return null;
  }

  let merged: ParsedPayslipSummary | null = parseIbmPayslipFromText(normalized);
  if (!merged) {
    merged = tryIbmPayslipVariants(text);
  }
  merged = mergePayslipSummariesPreferFirst(merged, parseDeloitteRegexFallback(text));
  merged = mergePayslipSummariesPreferFirst(merged, parseDeloitteLabelScanFallback(text));

  if (!merged || !payslipSummaryHasMinimumFields(merged)) {
    return null;
  }

  const hasDeloitteBrand = /\bdeloitte\b/i.test(normalized);
  return {
    ...merged,
    rawExtractJson: {
      ...merged.rawExtractJson,
      parserProfile: "deloitte_payslip_pdf",
      detectedDeloitteKeyword: hasDeloitteBrand
    }
  };
}

export async function parseDeloittePayslipPdf(buffer: Buffer): Promise<PayslipPdfParseResult> {
  let text: string;
  try {
    text = await extractPdfText(buffer);
  } catch {
    return { ok: false, reason: "pdf_read_error" };
  }
  const normalized = normalizePdfExtractText(text).trim();
  if (!normalized) {
    return { ok: false, reason: "empty_pdf_text" };
  }
  const summary = parseDeloittePayslipFromText(text);
  if (!summary) {
    return { ok: false, reason: "no_summary_fields" };
  }
  return { ok: true, summary };
}
