import type { ParsedPayslipSummary, PayslipHybridColumns } from "../payslip.types.js";
import type { PayslipLlmExtract } from "./payslip-llm.schema.js";

export type CanonicalMapResult = {
  summary: ParsedPayslipSummary;
  hybrid: PayslipHybridColumns;
};

/**
 * Map validated canonical LLM extract into legacy `ParsedPayslipSummary` columns plus hybrid columns.
 * Employee taxes bucket maps from summary tax_deductions_* (IBM/Deloitte both expose taxes in that bucket).
 */
export function mapCanonicalExtractToPersist(extract: PayslipLlmExtract, usageTokens?: number | null): CanonicalMapResult {
  const s = extract.summary;
  const emp = extract.employee;
  const em = extract.source_employer;
  const summary: ParsedPayslipSummary = {
    payPeriodStart: extract.pay_period.start_date,
    payPeriodEnd: extract.pay_period.end_date,
    payDate: extract.pay_period.pay_date,
    hoursOrDaysCurrent:
      extract.employment_context.hours_or_days_worked_current != null
        ? String(extract.employment_context.hours_or_days_worked_current)
        : null,
    grossPayCurrent: s.gross_pay_current,
    grossPayYtd: s.gross_pay_ytd,
    employeeTaxesCurrent: s.tax_deductions_current,
    employeeTaxesYtd: s.tax_deductions_ytd,
    preTaxDeductionsCurrent: s.pre_tax_deductions_current,
    preTaxDeductionsYtd: s.pre_tax_deductions_ytd,
    postTaxDeductionsCurrent: s.post_tax_deductions_current,
    postTaxDeductionsYtd: s.post_tax_deductions_ytd,
    netPayCurrent: s.net_pay_current,
    netPayYtd: s.net_pay_ytd,
    rawExtractJson: {
      parser: "openai_llm_payslip",
      documentType: extract.document_type,
      usageTokens: usageTokens ?? undefined,
      totalEarningsCurrent: s.total_earnings_current,
      totalEarningsYtd: s.total_earnings_ytd,
      taxableEarningsCurrent: s.taxable_earnings_current,
      taxableEarningsYtd: s.taxable_earnings_ytd
    }
  };

  const hybrid: PayslipHybridColumns = {
    canonicalExtractJson: JSON.stringify(extract),
    currency: s.currency,
    employerDisplayName: em.name,
    employeeDisplayName: emp.name,
    employerEinOrFein: em.ein_or_fein,
    employeeId: emp.employee_id,
    personnelNumber: emp.personnel_number,
    talentId: emp.talent_id,
    taxProfileJson: JSON.stringify(extract.tax_profile),
    paymentSummaryJson: JSON.stringify(extract.payment_information),
    extractionMetadataJson: JSON.stringify(extract.document_metadata)
  };

  return { summary, hybrid };
}

export type CanonicalValidation = { ok: true } | { ok: false; reasons: string[] };

/** Light sanity checks before persisting; failures should mark import_file failed, not crash. */
export function validateCanonicalForImport(extract: PayslipLlmExtract): CanonicalValidation {
  const reasons: string[] = [];
  const net = extract.summary.net_pay_current;
  const gross = extract.summary.gross_pay_current;
  if (net == null && gross == null) {
    reasons.push("missing_net_and_gross");
  }
  if (extract.pay_period.pay_date == null && extract.pay_period.end_date == null) {
    reasons.push("missing_pay_date_signals");
  }
  if (net != null && (net < 0 || net > 1_000_000)) {
    reasons.push("net_pay_out_of_range");
  }
  if (gross != null && (gross < 0 || gross > 1_000_000)) {
    reasons.push("gross_pay_out_of_range");
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
