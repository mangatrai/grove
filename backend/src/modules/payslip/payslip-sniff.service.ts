import { log } from "../../logger.js";
import { extractPdfText } from "../imports/profiles/pdf-text.js";
import { normalizePdfExtractText } from "./profiles/ibm-payslip-pdf.js";
import { DELOITTE_PAYSLIP_PDF_PROFILE_ID, IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID } from "./payslip.types.js";
import { listHouseholdEmployers } from "./payslip-employer-resolve.service.js";

export type SniffHints = {
  ibmSignals: string[];
  adpSignals: string[];
  deloitteSignals: string[];
};

/** Light keyword signals in extracted PDF text (first pages). */
export function detectPayslipSignals(normalizedText: string): SniffHints {
  const t = normalizedText.slice(0, 120_000);
  const ibmSignals: string[] = [];
  const adpSignals: string[] = [];
  const deloitteSignals: string[] = [];

  if (/\bdeloitte\b/i.test(t)) {
    deloitteSignals.push("deloitte_brand");
  }
  if (/\bpay\s+statement\b/i.test(t) && /\bdeloitte\b/i.test(t)) {
    deloitteSignals.push("deloitte_pay_statement");
  }
  if (/\bsuccessfactors\b/i.test(t)) {
    ibmSignals.push("successfactors");
  }
  if (/\bpay\s+and\s+contributions\b/i.test(t)) {
    ibmSignals.push("pay_and_contributions");
  }
  if (/\bibm\b/i.test(t) && /pay|contributions|payslip|earnings/i.test(t)) {
    ibmSignals.push("ibm_pay_context");
  }
  if (/\bregular\s+pay\b/i.test(t) && /\bytd\b/i.test(t)) {
    ibmSignals.push("regular_pay_ytd");
  }

  if (/\badp\b/i.test(t)) {
    adpSignals.push("adp");
  }
  if (/workforce\s*now|myadp|adp\.com/i.test(t)) {
    adpSignals.push("adp_portal");
  }

  return { ibmSignals, adpSignals, deloitteSignals };
}

export type SniffSuggestion = {
  suggestedParserProfileId: string;
  confidence: "high" | "low";
  hints: SniffHints;
  suggestedEmployerId: string | null;
  note: string | null;
};

/**
 * Suggest parser + employer from PDF text + household employer list.
 * Does not persist; optional step before upload or import binding.
 */
export async function suggestPayslipFromText(
  householdId: string,
  userId: string,
  normalizedText: string
): Promise<SniffSuggestion> {
  const hints = detectPayslipSignals(normalizedText);
  const employers = await listHouseholdEmployers(householdId, userId);

  let suggestedParserProfileId: string = IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
  let confidence: "high" | "low" = "low";
  let note: string | null = null;

  const adpScore = hints.adpSignals.length;
  const ibmScore = hints.ibmSignals.length;
  const deloitteScore = hints.deloitteSignals.length;

  if (adpScore > 0 && adpScore >= ibmScore && adpScore >= deloitteScore) {
    suggestedParserProfileId = "adp_payslip_pdf";
    if (adpScore >= 1) {
      confidence = "high";
    }
    note =
      "Text looks like ADP; full ADP parsing is not implemented yet — choose IBM if this is actually an IBM/SuccessFactors PDF, or wait for ADP support.";
  } else if (deloitteScore >= 2 && deloitteScore >= ibmScore) {
    suggestedParserProfileId = DELOITTE_PAYSLIP_PDF_PROFILE_ID;
    confidence = "high";
  } else if (deloitteScore >= 1 && ibmScore === 0 && adpScore === 0) {
    suggestedParserProfileId = DELOITTE_PAYSLIP_PDF_PROFILE_ID;
    confidence = "low";
    note = "Deloitte keyword found; confirm employer parser is set to Deloitte Pay Statement if parse fails.";
  } else if (ibmScore > 0) {
    suggestedParserProfileId = IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
    confidence = ibmScore >= 2 ? "high" : "low";
  }

  let suggestedEmployerId: string | null = null;
  const matching = employers.filter((e) => {
    const pid = e.parserProfileId?.trim() || IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID;
    return pid === suggestedParserProfileId;
  });
  if (matching.length === 1) {
    suggestedEmployerId = matching[0]!.id;
  } else if (matching.length > 1) {
    note =
      note ??
      "Multiple employers use this parser — pick the employer when uploading or binding the import file.";
  }

  return {
    suggestedParserProfileId,
    confidence,
    hints,
    suggestedEmployerId,
    note
  };
}

export async function sniffPayslipPdfBuffer(
  householdId: string,
  userId: string,
  buffer: Buffer
): Promise<
  | { ok: true; normalizedText: string; suggestion: SniffSuggestion }
  | { ok: false; reason: "empty_pdf_text" | "pdf_read_error" }
> {
  let text: string;
  try {
    text = await extractPdfText(buffer);
  } catch (err) {
    log.warn("payslip sniff: PDF read failed", { householdId, err });
    return { ok: false, reason: "pdf_read_error" };
  }
  const normalizedText = normalizePdfExtractText(text).trim();
  if (!normalizedText) {
    return { ok: false, reason: "empty_pdf_text" };
  }
  return {
    ok: true,
    normalizedText,
    suggestion: await suggestPayslipFromText(householdId, userId, normalizedText)
  };
}
