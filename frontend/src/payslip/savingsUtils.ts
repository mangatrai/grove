import type { PayslipLineItemRow, PayslipSnapshotDetail } from "./types";

function isFederalTaxLine(item: PayslipLineItemRow): boolean {
  const name = (item.name ?? "").toLowerCase();
  const authority = (item.authority ?? "").toLowerCase();
  // "Federal Income Tax", "Federal Withholding", etc. — name contains "federal"
  // IBM-style: "TX Withholding Tax" with authority="Federal" — name doesn't say federal but authority does
  // Must NOT match SS / Medicare which also carry authority="Federal" — those never contain "withholding" or "income"
  return (
    name.includes("federal") ||
    (authority === "federal" && (name.includes("withholding") || name.includes("income")))
  );
}

function federalTaxYtd(ps: PayslipSnapshotDetail): number | null {
  const rows = ps.lineItems?.tax_deductions ?? [];
  const fed = rows.find(isFederalTaxLine);
  return fed?.amountYtd ?? null;
}

function federalTaxCurrent(ps: PayslipSnapshotDetail): number | null {
  const rows = ps.lineItems?.tax_deductions ?? [];
  const fed = rows.find(isFederalTaxLine);
  return fed?.amountCurrent ?? null;
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

/** Federal tax YTD as % of gross YTD — direct, no annualisation. */
export function computeFederalRateYtd(ps: PayslipSnapshotDetail): number | null {
  // Prefer stored rate (PS-5 Phase 1); fall back to runtime line-item scan for older snapshots.
  if (ps.effectiveFederalRateYtd != null) return ps.effectiveFederalRateYtd * 100;
  const grossYtd = ps.grossPayYtd;
  const fedYtd = federalTaxYtd(ps);
  if (grossYtd == null || grossYtd === 0 || fedYtd == null) return null;
  return (fedYtd / grossYtd) * 100;
}

/** Federal tax this period as % of gross this period. */
export function computeFederalRateCurrent(ps: PayslipSnapshotDetail): number | null {
  const gross = ps.grossPayCurrent;
  const fed = federalTaxCurrent(ps);
  if (gross == null || gross === 0 || fed == null) return null;
  return (fed / gross) * 100;
}

/** All employee taxes YTD as % of gross YTD. */
export function computeTotalTaxRateYtd(ps: PayslipSnapshotDetail): number | null {
  // Prefer stored rate (PS-5 Phase 1); fall back to aggregate column for older snapshots.
  if (ps.effectiveTotalTaxRateYtd != null) return ps.effectiveTotalTaxRateYtd * 100;
  const grossYtd = ps.grossPayYtd;
  const taxYtd = ps.employeeTaxesYtd;
  if (grossYtd == null || grossYtd === 0 || taxYtd == null) return null;
  return (taxYtd / grossYtd) * 100;
}

/** All employee taxes this period as % of gross this period. */
export function computeTotalTaxRateCurrent(ps: PayslipSnapshotDetail): number | null {
  const gross = ps.grossPayCurrent;
  const tax = ps.employeeTaxesCurrent;
  if (gross == null || gross === 0 || tax == null) return null;
  return (tax / gross) * 100;
}
