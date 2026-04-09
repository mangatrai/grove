import type { ParserProfileId } from "../imports/profiles/profile-ids.js";
import { env } from "../../config/env.js";
import { extractPayslipFromPdf } from "./llm-extract/extract-payslip-llm.js";
import { mapCanonicalExtractToPersist, validateCanonicalForImport } from "./llm-extract/payslip-canonical-map.js";
import type { ParsedPayslipSummary, PayslipHybridColumns } from "./payslip.types.js";
import { DELOITTE_PAYSLIP_PDF_PROFILE_ID, IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID } from "./payslip.types.js";

export type PayslipPdfParseSuccess = {
  ok: true;
  summary: ParsedPayslipSummary;
  hybrid: PayslipHybridColumns;
  usageTokens?: number | null;
};

export type PayslipPdfParseResult =
  | PayslipPdfParseSuccess
  | { ok: false; reason: "unsupported_parser"; parserProfileId: string }
  | { ok: false; reason: "openai_api_not_configured" }
  | { ok: false; reason: "llm_canonical_validation_failed"; detail: string[] }
  | { ok: false; reason: "llm_extraction_failed"; message: string };

export async function parsePayslipPdfByProfile(
  buffer: Buffer,
  parserProfileId: ParserProfileId,
  options?: { pdfPath?: string | null }
): Promise<PayslipPdfParseResult> {
  if (parserProfileId === IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID) {
    if (!env.OPENAI_API_KEY?.trim()) {
      return { ok: false, reason: "openai_api_not_configured" };
    }
    const storedPath = options?.pdfPath?.trim();
    try {
      const { extract, usage } = await extractPayslipFromPdf(
        storedPath ? { pdfPath: storedPath } : { pdfBuffer: buffer }
      );
      const validation = validateCanonicalForImport(extract);
      if (!validation.ok) {
        return { ok: false, reason: "llm_canonical_validation_failed", detail: validation.reasons };
      }
      const { summary, hybrid } = mapCanonicalExtractToPersist(extract, usage?.total_tokens ?? null);
      return { ok: true, summary, hybrid, usageTokens: usage?.total_tokens ?? null };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: "llm_extraction_failed", message };
    }
  }
  if (parserProfileId === DELOITTE_PAYSLIP_PDF_PROFILE_ID) {
    return { ok: false, reason: "unsupported_parser", parserProfileId: DELOITTE_PAYSLIP_PDF_PROFILE_ID };
  }
  if (parserProfileId === "adp_payslip_pdf") {
    return { ok: false, reason: "unsupported_parser", parserProfileId };
  }
  return { ok: false, reason: "unsupported_parser", parserProfileId };
}
