/** IBM Pay and Contributions–style summary; v1 is Current + YTD columns only. */
export type ParsedPayslipSummary = {
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payDate: string | null;
  hoursOrDaysCurrent: string | null;
  /** YTD hours or days worked (mirrors hoursOrDaysCurrent type). */
  hoursOrDaysYtd: string | null;
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
  /** Taxable earnings section total (e.g. IBM or Deloitte TAXABLE EARNINGS FED). */
  taxableEarningsCurrent: number | null;
  taxableEarningsYtd: number | null;
  /** Other Information section total (employer HSA, ESPP Discount, imputed income, etc.). */
  otherInformationCurrent: number | null;
  otherInformationYtd: number | null;
  /** Parser diagnostics / raw line hits (stored in DB for debugging). */
  rawExtractJson: Record<string, unknown>;
};

export const IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID = "ibm_pay_contributions_pdf" as const;
export const DELOITTE_PAYSLIP_PDF_PROFILE_ID = "deloitte_payslip_pdf" as const;

/** All payslip profiles that use async LLM extraction (queued, not inline). */
export const LLM_PAYSLIP_PROFILE_IDS = [
  IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID,
  DELOITTE_PAYSLIP_PDF_PROFILE_ID
] as const;

/** Optional LLM hybrid columns; used when inserting from `llm_payslip` pipeline. */
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
  /** Annual salary, biweekly pay, or hourly rate from employment_context.rate. */
  employmentRate: number | null;
  /** Rate type: "annual", "biweekly", "hourly", etc. */
  employmentRateType: string | null;
};

/** Canonical section names matching line_items keys in PayslipLlmExtract. */
export type PayslipLineItemSection =
  | "earnings"
  | "pre_tax_deductions"
  | "post_tax_deductions"
  | "tax_deductions"
  | "other_deductions"
  | "other_information"
  | "taxable_earnings";

export const PAYSLIP_LINE_ITEM_SECTIONS: PayslipLineItemSection[] = [
  "earnings",
  "pre_tax_deductions",
  "post_tax_deductions",
  "tax_deductions",
  "other_deductions",
  "other_information",
  "taxable_earnings"
];

/** A single row from the payslip_line_item table. */
export type PayslipLineItemRow = {
  id: string;
  payslipSnapshotId: string;
  householdId: string;
  section: PayslipLineItemSection;
  sortOrder: number;
  name: string | null;
  authority: string | null;
  description: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  dateRaw: string | null;
  hoursOrDaysCurrent: number | null;
  hoursOrDaysYtd: number | null;
  rate: number | null;
  amountCurrent: number | null;
  amountYtd: number | null;
  rawSection: string | null;
  createdAt: string;
};

/** Line items grouped by section — returned from GET /payslips/:id. */
export type PayslipLineItemsGrouped = Record<PayslipLineItemSection, PayslipLineItemRow[]>;

/** Shape passed from mapper → service insert (no DB-assigned fields). */
export type LineItemForInsert = Omit<PayslipLineItemRow, "id" | "payslipSnapshotId" | "householdId" | "createdAt">;
