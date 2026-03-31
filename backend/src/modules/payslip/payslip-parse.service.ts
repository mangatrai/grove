import type { ParserProfileId } from "../imports/profiles/profile-ids.js";
import type { PayslipPdfParseResult as IbmPayslipPdfParseResult } from "./profiles/ibm-payslip-pdf.js";
import { parseIbmPayslipPdf } from "./profiles/ibm-payslip-pdf.js";
import { IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID } from "./payslip.types.js";

export type PayslipPdfParseResult =
  | IbmPayslipPdfParseResult
  | { ok: false; reason: "unsupported_parser"; parserProfileId: string };

export async function parsePayslipPdfByProfile(
  buffer: Buffer,
  parserProfileId: ParserProfileId
): Promise<PayslipPdfParseResult> {
  if (parserProfileId === IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID) {
    return parseIbmPayslipPdf(buffer);
  }
  if (parserProfileId === "adp_payslip_pdf") {
    return { ok: false, reason: "unsupported_parser", parserProfileId };
  }
  return { ok: false, reason: "unsupported_parser", parserProfileId };
}
