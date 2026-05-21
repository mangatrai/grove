import type { PayslipLineItemRow, PayslipSnapshotDetail } from "./types";

export const TAX_BENCHMARK_PCT = 20;

function isFederalTaxLine(item: PayslipLineItemRow): boolean {
  return (item.name ?? "").toLowerCase().includes("federal");
}

function federalTaxYtd(ps: PayslipSnapshotDetail): number | null {
  const rows = ps.lineItems?.tax_deductions ?? [];
  const fed = rows.find(isFederalTaxLine);
  return fed?.amountYtd ?? null;
}

/** Pre-tax deductions as % of gross for this pay period. */
export function computeSavingsRate(ps: PayslipSnapshotDetail): number | null {
  const gross = ps.grossPayCurrent;
  const preTax = ps.preTaxDeductionsCurrent;
  if (gross == null || gross === 0 || preTax == null) return null;
  return (preTax / gross) * 100;
}

/** Pre-tax deductions as % of gross YTD. */
export function computeSavingsRateYtd(ps: PayslipSnapshotDetail): number | null {
  const gross = ps.grossPayYtd;
  const preTax = ps.preTaxDeductionsYtd;
  if (gross == null || gross === 0 || preTax == null) return null;
  return (preTax / gross) * 100;
}

/**
 * Annualised federal withholding rate from YTD federal tax line item.
 * Formula: (fedYtd / grossYtd) * (26 / payPeriodCount) * 100
 */
export function computeFederalRateAnnualised(
  ps: PayslipSnapshotDetail,
  payPeriodCount: number
): number | null {
  const grossYtd = ps.grossPayYtd;
  const fedYtd = federalTaxYtd(ps);
  if (
    grossYtd == null ||
    grossYtd === 0 ||
    fedYtd == null ||
    payPeriodCount <= 0
  ) {
    return null;
  }
  return (fedYtd / grossYtd) * (26 / payPeriodCount) * 100;
}

export function isTaxRateLow(rate: number | null): boolean {
  return rate !== null && rate < TAX_BENCHMARK_PCT;
}
