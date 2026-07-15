export type PriorPayslipValues = {
  grossPayCurrent: number | null;
  netPayCurrent: number | null;
  employeeTaxesCurrent: number | null;
  preTaxDeductionsCurrent: number | null;
};

export type ValidationWarningCode =
  | "EARNINGS_SUM_MISMATCH"
  | "PRE_TAX_SUM_MISMATCH"
  | "TAX_SUM_MISMATCH"
  | "POST_TAX_SUM_MISMATCH"
  | "ARITHMETIC_IMBALANCE";

export type ValidationWarning = {
  code: ValidationWarningCode;
  lineItemSum: number | null;
  summaryValue: number | null;
  delta: number | null;
  message: string;
};

export type MatchedDeposit = {
  id: string;
  txnDate: string;
  amount: number;
  direction: string;
  merchant: string | null;
  memo: string | null;
  accountId: string;
  institution: string;
  accountType: string;
  accountMask: string | null;
  dateDelta: number;
  amountDelta: number;
};

export type PayslipLineItemSection =
  | "earnings"
  | "pre_tax_deductions"
  | "post_tax_deductions"
  | "tax_deductions"
  | "other_deductions"
  | "other_information"
  | "taxable_earnings";

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

export type PayslipLineItemsGrouped = Record<PayslipLineItemSection, PayslipLineItemRow[]>;

/** Mirrors `PayslipSnapshotRow` from the API (list + detail). */
export type PayslipSnapshotDetail = {
  id: string;
  householdId: string;
  fileName: string;
  fileChecksum: string;
  parserProfileId: string;
  employerId: string | null;
  ownerScope: "household" | "person";
  ownerPersonProfileId: string | null;
  importFileId: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payDate: string | null;
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
  hoursOrDaysCurrent: string | null;
  hoursOrDaysYtd: string | null;
  taxableEarningsCurrent: number | null;
  taxableEarningsYtd: number | null;
  otherInformationCurrent: number | null;
  otherInformationYtd: number | null;
  employmentRate: number | null;
  employmentRateType: string | null;
  rawExtractJson: Record<string, unknown>;
  createdAt: string;
  /** Explicitly confirmed deposit transactions from payslip_deposit_match join table (F-5). */
  confirmedDeposits: MatchedDeposit[];
  /** Dynamic search candidates — only populated when confirmedDeposits is empty (F-5). */
  suggestedDeposits: MatchedDeposit[];
  /** Individual line items grouped by section — only present on GET /payslips/:id */
  lineItems?: PayslipLineItemsGrouped;
  /** Cross-validation warnings between line item sums and summary columns (CR-117) */
  validationWarnings?: ValidationWarning[];
  /** Prior-period values for the same person — present on list responses (PS-1). */
  prior?: PriorPayslipValues | null;
  /** Number of payslips in the same calendar year for this person — present on detail response (PS-4). */
  payPeriodCountYtd?: number;
  /** Federal income tax YTD ÷ gross YTD (decimal ratio). Null for snapshots before migration 0048. */
  effectiveFederalRateYtd: number | null;
  /** All employee taxes YTD ÷ gross YTD (decimal ratio). Null for snapshots before migration 0048. */
  effectiveTotalTaxRateYtd: number | null;
};

export const SECTION_LABELS: Record<PayslipLineItemSection, string> = {
  earnings: "Earnings",
  pre_tax_deductions: "Pre-Tax Deductions",
  post_tax_deductions: "Post-Tax Deductions",
  tax_deductions: "Tax Deductions",
  other_deductions: "Other Deductions",
  other_information: "Other Information",
  taxable_earnings: "Taxable Earnings"
};
