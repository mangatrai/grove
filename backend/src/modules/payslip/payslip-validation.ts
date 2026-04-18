/**
 * Payslip cross-validation utilities.
 *
 * Two responsibilities:
 *  1. `deriveSummaryFromLineItems` — compute summary column updates from current line items.
 *     Used after any line item edit/delete to keep summary columns in sync.
 *  2. `validatePayslipBalance` — check invariants between summary columns and line items,
 *     returning non-blocking warnings surfaced on the detail page and in API responses.
 */
import type { PayslipLineItemRow, PayslipLineItemsGrouped } from "./payslip.types.js";
import type { PayslipSnapshotRow } from "./payslip.service.js";

export type ValidationWarningCode =
  | "EARNINGS_SUM_MISMATCH"
  | "PRE_TAX_SUM_MISMATCH"
  | "TAX_SUM_MISMATCH"
  | "POST_TAX_SUM_MISMATCH"
  | "ARITHMETIC_IMBALANCE";

export type ValidationWarning = {
  code: ValidationWarningCode;
  /** Sum of the relevant line items (null when no items have amounts). */
  lineItemSum: number | null;
  /** Stored summary column value. */
  summaryValue: number | null;
  /** Absolute difference, rounded to cents. */
  delta: number | null;
  message: string;
};

function sumColumn(rows: PayslipLineItemRow[], key: "amountCurrent" | "amountYtd"): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const v = r[key];
    if (v != null && Number.isFinite(v)) {
      total += v;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

/**
 * Compute which payslip_snapshot columns should be updated based on the current line items.
 *
 * Mapping:
 *   earnings                               → gross_pay_current / _ytd
 *   pre_tax_deductions                     → pre_tax_deductions_current / _ytd
 *   tax_deductions                         → employee_taxes_current / _ytd
 *   post_tax_deductions + other_deductions → post_tax_deductions_current / _ytd (combined)
 *   other_information                      → other_information_current / _ytd
 *   taxable_earnings                       → taxable_earnings_current / _ytd
 *
 * Only sections with ≥1 row produce an update. Sections with 0 rows return `undefined`
 * (meaning "leave the existing summary value unchanged").
 *
 * net_pay is intentionally excluded — it is the stated bank-deposit anchor and must not
 * be auto-derived from the arithmetic formula (that would break matchedDeposits logic).
 */
export function deriveSummaryFromLineItems(lineItems: PayslipLineItemsGrouped): Partial<{
  grossPayCurrent: number | null;
  grossPayYtd: number | null;
  preTaxDeductionsCurrent: number | null;
  preTaxDeductionsYtd: number | null;
  employeeTaxesCurrent: number | null;
  employeeTaxesYtd: number | null;
  postTaxDeductionsCurrent: number | null;
  postTaxDeductionsYtd: number | null;
  otherInformationCurrent: number | null;
  otherInformationYtd: number | null;
  taxableEarningsCurrent: number | null;
  taxableEarningsYtd: number | null;
}> {
  const result: ReturnType<typeof deriveSummaryFromLineItems> = {};

  const earningsRows = lineItems.earnings ?? [];
  if (earningsRows.length > 0) {
    result.grossPayCurrent = sumColumn(earningsRows, "amountCurrent");
    result.grossPayYtd = sumColumn(earningsRows, "amountYtd");
  }

  const preTaxRows = lineItems.pre_tax_deductions ?? [];
  if (preTaxRows.length > 0) {
    result.preTaxDeductionsCurrent = sumColumn(preTaxRows, "amountCurrent");
    result.preTaxDeductionsYtd = sumColumn(preTaxRows, "amountYtd");
  }

  const taxRows = lineItems.tax_deductions ?? [];
  if (taxRows.length > 0) {
    result.employeeTaxesCurrent = sumColumn(taxRows, "amountCurrent");
    result.employeeTaxesYtd = sumColumn(taxRows, "amountYtd");
  }

  // post_tax_deductions + other_deductions are semantically the same (e.g. Deloitte OTHER DEDUCTION(S))
  const postTaxRows = [...(lineItems.post_tax_deductions ?? []), ...(lineItems.other_deductions ?? [])];
  if (postTaxRows.length > 0) {
    result.postTaxDeductionsCurrent = sumColumn(postTaxRows, "amountCurrent");
    result.postTaxDeductionsYtd = sumColumn(postTaxRows, "amountYtd");
  }

  const otherInfoRows = lineItems.other_information ?? [];
  if (otherInfoRows.length > 0) {
    result.otherInformationCurrent = sumColumn(otherInfoRows, "amountCurrent");
    result.otherInformationYtd = sumColumn(otherInfoRows, "amountYtd");
  }

  const taxableRows = lineItems.taxable_earnings ?? [];
  if (taxableRows.length > 0) {
    result.taxableEarningsCurrent = sumColumn(taxableRows, "amountCurrent");
    result.taxableEarningsYtd = sumColumn(taxableRows, "amountYtd");
  }

  return result;
}

/**
 * Cross-check summary columns against line item sums.
 *
 * Checks (only run when line items for that section exist):
 *   EARNINGS_SUM_MISMATCH   — sum(earnings.amountCurrent) vs grossPayCurrent       (tolerance $0.01)
 *   PRE_TAX_SUM_MISMATCH    — sum(pre_tax.amountCurrent) vs preTaxDeductionsCurrent (tolerance $0.01)
 *   TAX_SUM_MISMATCH        — sum(tax.amountCurrent) vs employeeTaxesCurrent        (tolerance $0.01)
 *   POST_TAX_SUM_MISMATCH   — sum(post_tax+other.amountCurrent) vs postTaxDeductionsCurrent ($0.01)
 *   ARITHMETIC_IMBALANCE    — gross − pre − taxes − post vs netPayCurrent           (tolerance $1.00)
 *
 * Returns an empty array when everything balances.
 */
export function validatePayslipBalance(
  snapshot: PayslipSnapshotRow,
  lineItems: PayslipLineItemsGrouped
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  function check(
    code: ValidationWarningCode,
    lineItemSum: number | null,
    summaryValue: number | null,
    tolerance: number,
    label: string
  ) {
    if (lineItemSum == null || summaryValue == null) {
      return;
    }
    const delta = Math.round(Math.abs(lineItemSum - summaryValue) * 100) / 100;
    if (delta > tolerance) {
      warnings.push({
        code,
        lineItemSum,
        summaryValue,
        delta,
        message: `${label} items sum to $${lineItemSum.toFixed(2)} but summary shows $${summaryValue.toFixed(2)} (diff $${delta.toFixed(2)})`
      });
    }
  }

  const earningsRows = lineItems.earnings ?? [];
  if (earningsRows.length > 0) {
    check("EARNINGS_SUM_MISMATCH", sumColumn(earningsRows, "amountCurrent"), snapshot.grossPayCurrent, 0.01, "Earnings");
  }

  const preTaxRows = lineItems.pre_tax_deductions ?? [];
  if (preTaxRows.length > 0) {
    check(
      "PRE_TAX_SUM_MISMATCH",
      sumColumn(preTaxRows, "amountCurrent"),
      snapshot.preTaxDeductionsCurrent,
      0.01,
      "Pre-tax deductions"
    );
  }

  const taxRows = lineItems.tax_deductions ?? [];
  if (taxRows.length > 0) {
    check("TAX_SUM_MISMATCH", sumColumn(taxRows, "amountCurrent"), snapshot.employeeTaxesCurrent, 0.01, "Tax deductions");
  }

  const postTaxRows = [...(lineItems.post_tax_deductions ?? []), ...(lineItems.other_deductions ?? [])];
  if (postTaxRows.length > 0) {
    check(
      "POST_TAX_SUM_MISMATCH",
      sumColumn(postTaxRows, "amountCurrent"),
      snapshot.postTaxDeductionsCurrent,
      0.01,
      "Post-tax deductions"
    );
  }

  // Arithmetic invariant: gross − pre − taxes − post ≈ net
  const gross = snapshot.grossPayCurrent;
  const pre = snapshot.preTaxDeductionsCurrent ?? 0;
  const taxes = snapshot.employeeTaxesCurrent ?? 0;
  const post = snapshot.postTaxDeductionsCurrent ?? 0;
  const net = snapshot.netPayCurrent;
  if (gross != null && net != null) {
    const implied = Math.round((gross - pre - taxes - post) * 100) / 100;
    const delta = Math.round(Math.abs(implied - net) * 100) / 100;
    if (delta > 1.0) {
      warnings.push({
        code: "ARITHMETIC_IMBALANCE",
        lineItemSum: implied,
        summaryValue: net,
        delta,
        message: `Arithmetic check: gross ($${gross.toFixed(2)}) − deductions = $${implied.toFixed(2)}, but Net Pay is $${net.toFixed(2)} (diff $${delta.toFixed(2)})`
      });
    }
  }

  return warnings;
}
