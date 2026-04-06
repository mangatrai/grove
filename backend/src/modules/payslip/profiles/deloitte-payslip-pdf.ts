/**
 * Deloitte "Pay Statement" PDFs — v1 uses IBM SuccessFactors-style Current/YTD summary parsing
 * when extractable text matches the same line layout. When PDF text is noisy or labels differ
 * (e.g. "Net Payment"), we retry collapsed text and a Deloitte-branded regex fallback.
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

function parseMoneyPair(s1: string | undefined, s2: string | undefined): { a: number | null; b: number | null } {
  const toN = (s: string | undefined) => {
    if (!s?.trim()) {
      return null;
    }
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return { a: toN(s1), b: toN(s2) };
}

/**
 * When IBM line-based heuristics fail (odd line breaks, labels), scan squashed text for
 * Current/YTD pairs after common Deloitte-style headings.
 */
function parseDeloitteRegexFallback(text: string): ParsedPayslipSummary | null {
  const normalized = normalizePdfExtractText(text).trim();
  if (!normalized) {
    return null;
  }
  if (!/\bdeloitte\b/i.test(normalized)) {
    return null;
  }
  const oneLine = normalized.replace(/\s+/g, " ");
  const period = parsePayPeriod(normalized);
  const payDate = parsePayDate(normalized);

  let grossPayCurrent: number | null = null;
  let grossPayYtd: number | null = null;
  let netPayCurrent: number | null = null;
  let netPayYtd: number | null = null;

  const grossRe =
    /(?:Gross\s+Pay|Total\s+Earnings|Total\s+Gross|Regular\s+Pay|Total\s+Remuneration)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i;
  const gm = oneLine.match(grossRe);
  if (gm) {
    const p = parseMoneyPair(gm[1], gm[2]);
    grossPayCurrent = p.a;
    grossPayYtd = p.b;
  }

  const netRe =
    /(?:Net\s+Pay|Net\s+Payment|Net\s+Distribution|Net\s+Amount|Take[\s-]*Home(?:\s+Pay)?)\s+([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2}))?/i;
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
      detectedDeloitteKeyword: true,
      fallback: "deloitte_regex_squashed"
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

function mergeDeloitteRegexIntoIbm(base: ParsedPayslipSummary, reg: ParsedPayslipSummary): ParsedPayslipSummary {
  const out = { ...base };
  if (out.grossPayCurrent === null && out.grossPayYtd === null && (reg.grossPayCurrent !== null || reg.grossPayYtd !== null)) {
    out.grossPayCurrent = reg.grossPayCurrent;
    out.grossPayYtd = reg.grossPayYtd;
  }
  if (out.netPayCurrent === null && out.netPayYtd === null && (reg.netPayCurrent !== null || reg.netPayYtd !== null)) {
    out.netPayCurrent = reg.netPayCurrent;
    out.netPayYtd = reg.netPayYtd;
  }
  if (out.payPeriodStart === null && out.payPeriodEnd === null && reg.payPeriodStart && reg.payPeriodEnd) {
    out.payPeriodStart = reg.payPeriodStart;
    out.payPeriodEnd = reg.payPeriodEnd;
  }
  if (out.payDate === null && reg.payDate) {
    out.payDate = reg.payDate;
  }
  out.rawExtractJson = {
    ...(out.rawExtractJson ?? {}),
    deloitteRegexSupplement: true
  };
  return out;
}

export function parseDeloittePayslipFromText(text: string): ParsedPayslipSummary | null {
  const normalized = normalizePdfExtractText(text).trim();
  if (!normalized) {
    return null;
  }

  let ibm = parseIbmPayslipFromText(normalized);
  if (!ibm) {
    ibm = tryIbmPayslipVariants(text);
  }
  const hasDeloitte = /\bdeloitte\b/i.test(normalized);
  const reg = hasDeloitte ? parseDeloitteRegexFallback(text) : null;

  if (!ibm) {
    ibm = reg;
  } else if (hasDeloitte && reg) {
    ibm = mergeDeloitteRegexIntoIbm(ibm, reg);
  }

  if (!ibm) {
    return null;
  }

  return {
    ...ibm,
    rawExtractJson: {
      ...ibm.rawExtractJson,
      parserProfile: "deloitte_payslip_pdf",
      detectedDeloitteKeyword: hasDeloitte
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
  /** Pass raw extract so IBM retry variants can reshape line breaks; empty check above still applies. */
  const summary = parseDeloittePayslipFromText(text);
  if (!summary) {
    return { ok: false, reason: "no_summary_fields" };
  }
  return { ok: true, summary };
}
