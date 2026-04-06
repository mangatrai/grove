/**
 * Deloitte "Pay Statement" — layered parsing for messy pdf-parse output (glued labels,
 * zero-width chars, spaced digits, EU amounts). Import binding selects this profile; we
 * do not require "Deloitte" in the text.
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

/** pdf.js / Acrobat sometimes emit these inside "words". */
function stripInvisibleAndCollapseDigitSpaces(text: string): string {
  const noZw = text.replace(/[\u200b-\u200d\ufeff\u00ad]/g, "");
  return noZw.replace(/(\d)\s+(?=\d)/g, "$1");
}

function prepareSquashed(text: string): string {
  const n = normalizePdfExtractText(stripInvisibleAndCollapseDigitSpaces(text)).trim();
  return n.replace(/\s+/g, " ");
}

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

/**
 * Currency tokens in **document order** (so Current vs YTD column order is preserved).
 * US `1,234.56`, plain `1234.56`, EU `1.234,56`.
 */
function firstCurrencyAmountsInOrder(segment: string, max: number): number[] {
  type Hit = { i: number; v: number };
  const hits: Hit[] = [];

  const push = (idx: number, v: number) => {
    if (!Number.isFinite(v) || v < 0.01 || v > 99_999_999.99) {
      return;
    }
    hits.push({ i: idx, v });
  };

  for (const m of segment.matchAll(/\b\d{1,3}(?:\.\d{3})+,\d{2}\b/g)) {
    const t = m[0].replace(/\./g, "").replace(",", ".");
    push(m.index!, Number(t));
  }
  for (const m of segment.matchAll(/-?\$?\s*\d{1,3}(?:,\d{3})+\.\d{2}/g)) {
    push(m.index!, Number(m[0].replace(/[$,\s]/g, "")));
  }
  for (const m of segment.matchAll(/-?\$?\s*\d+\.\d{2}\b/g)) {
    const v = Number(m[0].replace(/[$,\s]/g, ""));
    if (v <= 1) {
      continue;
    }
    if (Number.isInteger(v) && v >= 1900 && v <= 2100) {
      continue;
    }
    push(m.index!, v);
  }

  hits.sort((a, b) => a.i - b.i);
  const out: number[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const key = h.v.toFixed(2);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(h.v);
    if (out.length >= max) {
      break;
    }
  }
  return out;
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

/** Regex: label may be `Gross Pay`, `GrossPay`, optional $, amounts may touch label. */
function parseDeloitteGluedRegexFallback(text: string): ParsedPayslipSummary | null {
  const oneLine = prepareSquashed(text);
  const normalized = normalizePdfExtractText(stripInvisibleAndCollapseDigitSpaces(text)).trim();
  const period = parsePayPeriod(normalized);
  const payDate = parsePayDate(normalized);

  const amt = String.raw`(?:\$|\s)*([\d,]+\.\d{2}|\d{1,3}(?:,\d{3})+\.\d{2})`;
  const grossRe = new RegExp(
    `(?:Gross\\s*Pay|GrossPay|Total\\s*Earnings|Total\\s*Gross|Regular\\s*Pay|Total\\s+Remuneration)\\s*${amt}\\s*${amt}`,
    "i"
  );
  const netRe = new RegExp(
    `(?:Net\\s*Pay|NetPay|Net\\s+Payment|Net\\s+Distribution|Net\\s+Amount|Take[\\s-]*Home(?:\\s+Pay)?)\\s*${amt}(?:\\s*${amt})?`,
    "i"
  );

  let grossPayCurrent: number | null = null;
  let grossPayYtd: number | null = null;
  let netPayCurrent: number | null = null;
  let netPayYtd: number | null = null;

  const gm = oneLine.match(grossRe);
  if (gm) {
    const p = parseMoneyPair(gm[1], gm[2]);
    grossPayCurrent = p.a;
    grossPayYtd = p.b;
  }
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
    rawExtractJson: { parserProfile: "deloitte_payslip_pdf", fallback: "deloitte_glued_regex" }
  };

  return payslipSummaryHasMinimumFields(parsed) ? parsed : null;
}

function pairAfterLabel(squashed: string, label: RegExp): { current: number | null; ytd: number | null } {
  const m = squashed.match(label);
  if (!m || m.index === undefined) {
    return { current: null, ytd: null };
  }
  const tail = squashed.slice(m.index + m[0].length, m.index + m[0].length + 1400);
  const nums = firstCurrencyAmountsInOrder(tail, 8);
  const substantial = nums.filter((n) => n >= 100);
  const pool = substantial.length >= 2 ? substantial : nums.filter((n) => n >= 20);
  if (pool.length >= 2) {
    return { current: pool[0]!, ytd: pool[1]! };
  }
  if (pool.length === 1) {
    return { current: pool[0]!, ytd: null };
  }
  return { current: null, ytd: null };
}

function parseDeloitteLabelScanFallback(text: string): ParsedPayslipSummary | null {
  const normalized = normalizePdfExtractText(stripInvisibleAndCollapseDigitSpaces(text)).trim();
  if (!normalized) {
    return null;
  }
  const squashed = prepareSquashed(text);
  const period = parsePayPeriod(normalized);
  const payDate = parsePayDate(normalized);

  const grossLabels = [
    /\bGross\s*Pay\b/i,
    /\bGrossPay\b/i,
    /\bTotal\s+Earnings\b/i,
    /\bTotal\s*Earnings\b/i,
    /\bTotal\s+Gross\b/i,
    /\bTotal\s+Remuneration\b/i,
    /\bRegular\s+Pay\b/i
  ];
  const netLabels = [
    /\bNet\s*Pay\b/i,
    /\bNetPay\b/i,
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
    rawExtractJson: { parserProfile: "deloitte_payslip_pdf", fallback: "deloitte_label_scan" }
  };

  return payslipSummaryHasMinimumFields(parsed) ? parsed : null;
}

/**
 * If the summary strip exists but labels are unrecognizable, take the **largest** plausible
 * currency values in the doc as gross (max) and net (second-highest among remaining).
 * Last resort — only when nothing else produced minimum fields.
 */
function parseDeloitteLargestAmountsHeuristic(text: string): ParsedPayslipSummary | null {
  const normalized = normalizePdfExtractText(stripInvisibleAndCollapseDigitSpaces(text)).trim();
  if (normalized.length < 30) {
    return null;
  }
  const squashed = prepareSquashed(text);
  if (!/\b(?:pay|statement|earnings|deduction|tax|ytd|current)\b/i.test(squashed)) {
    return null;
  }
  const all = firstCurrencyAmountsInOrder(squashed, 40).filter((n) => n >= 50 && n <= 50_000_000);
  if (all.length < 2) {
    return null;
  }
  const sorted = [...new Set(all)].sort((a, b) => b - a);
  const gross = sorted[0]!;
  const netCandidate = sorted.find((n) => n < gross && n >= 100) ?? sorted[1]!;
  const period = parsePayPeriod(normalized);
  const payDate = parsePayDate(normalized);

  const parsed: ParsedPayslipSummary = {
    payPeriodStart: period.start,
    payPeriodEnd: period.end,
    payDate,
    hoursOrDaysCurrent: null,
    grossPayCurrent: gross,
    grossPayYtd: null,
    employeeTaxesCurrent: null,
    employeeTaxesYtd: null,
    preTaxDeductionsCurrent: null,
    preTaxDeductionsYtd: null,
    postTaxDeductionsCurrent: null,
    postTaxDeductionsYtd: null,
    netPayCurrent: netCandidate,
    netPayYtd: null,
    rawExtractJson: {
      parserProfile: "deloitte_payslip_pdf",
      fallback: "deloitte_largest_amount_heuristic",
      warning: "Coarse heuristic; verify amounts in Payslips UI"
    }
  };

  return payslipSummaryHasMinimumFields(parsed) ? parsed : null;
}

function tryIbmPayslipVariants(text: string): ParsedPayslipSummary | null {
  const cleaned = stripInvisibleAndCollapseDigitSpaces(text);
  const normalized = normalizePdfExtractText(cleaned).trim();
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
  const cleaned = stripInvisibleAndCollapseDigitSpaces(text);
  const normalized = normalizePdfExtractText(cleaned).trim();
  if (!normalized) {
    return null;
  }

  let merged: ParsedPayslipSummary | null = parseIbmPayslipFromText(normalized);
  if (!merged) {
    merged = tryIbmPayslipVariants(text);
  }
  merged = mergePayslipSummariesPreferFirst(merged, parseDeloitteGluedRegexFallback(text));
  merged = mergePayslipSummariesPreferFirst(merged, parseDeloitteLabelScanFallback(text));

  if (!merged || !payslipSummaryHasMinimumFields(merged)) {
    merged = mergePayslipSummariesPreferFirst(merged, parseDeloitteLargestAmountsHeuristic(text));
  }

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
  const cleaned = stripInvisibleAndCollapseDigitSpaces(text);
  const normalized = normalizePdfExtractText(cleaned).trim();
  if (!normalized) {
    return { ok: false, reason: "empty_pdf_text" };
  }
  const summary = parseDeloittePayslipFromText(text);
  if (!summary) {
    return { ok: false, reason: "no_summary_fields" };
  }
  return { ok: true, summary };
}
