/** IBM Pay and Contributions–style summary; v1 is Current + YTD columns only. */
export type ParsedPayslipSummary = {
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payDate: string | null;
  hoursOrDaysCurrent: string | null;
  grossPayCurrent: number | null;
  grossPayYtd: number | null;
  employeeTaxesCurrent: number | null;
  employeeTaxesYtd: number | null;
  preTaxDeductionsCurrent: number | null;
  preTaxDeductionsYtd: number | null;
  postTaxDeductionsCurrent: number | null;
  postTaxDeductionsYtd: number | null;
  netPayCurrent: number | null;
  netPayYtd: number | null;
  /** Parser diagnostics / raw line hits (stored in DB for debugging). */
  rawExtractJson: Record<string, unknown>;
};

export const IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID = "ibm_pay_contributions_pdf" as const;
export const DELOITTE_PAYSLIP_PDF_PROFILE_ID = "deloitte_payslip_pdf" as const;

/** Optional LLM hybrid columns; used when inserting from `openai_llm_payslip` pipeline. */
export type PayslipHybridColumns = {
  canonicalExtractJson: string;
  currency: string | null;
  employerDisplayName: string | null;
  employeeDisplayName: string | null;
  employerEinOrFein: string | null;
  employeeId: string | null;
  personnelNumber: string | null;
  talentId: string | null;
  taxProfileJson: string | null;
  paymentSummaryJson: string | null;
  extractionMetadataJson: string | null;
};
