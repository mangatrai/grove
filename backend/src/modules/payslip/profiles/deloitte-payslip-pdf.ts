/**
 * Deloitte "Pay Statement" PDFs — v1 reuses IBM SuccessFactors-style Current/YTD summary parsing
 * when extractable text matches the same line layout. Image-only PDFs return empty_pdf_text / no_summary_fields.
 */
import { extractPdfText } from "../../imports/profiles/pdf-text.js";
import {
  normalizePdfExtractText,
  parseIbmPayslipFromText
} from "./ibm-payslip-pdf.js";
import type { PayslipPdfParseResult } from "./ibm-payslip-pdf.js";

export function parseDeloittePayslipFromText(text: string): ParsedPayslipSummary | null {
  const normalized = normalizePdfExtractText(text).trim();
  if (!normalized) {
    return null;
  }
  const ibm = parseIbmPayslipFromText(normalized);
  if (!ibm) {
    return null;
  }
  const hasDeloitte = /\bdeloitte\b/i.test(normalized);
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
  const summary = parseDeloittePayslipFromText(normalized);
  if (!summary) {
    return { ok: false, reason: "no_summary_fields" };
  }
  return { ok: true, summary };
}
