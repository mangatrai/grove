import type { ParsedPayslipSummary, PayslipHybridColumns, LineItemForInsert, PayslipLineItemSection } from "../payslip.types.js";
import { PAYSLIP_LINE_ITEM_SECTIONS } from "../payslip.types.js";
import type { PayslipLlmExtract, PayslipLineItem } from "./payslip-llm.schema.js";

export type CanonicalMapResult = {
  summary: ParsedPayslipSummary;
  hybrid: PayslipHybridColumns;
  lineItems: LineItemForInsert[];
};

/** Deloitte biweekly default when the model does not report hours on the stub. */
const DEFAULT_DELOITTE_BIWEEKLY_HOURS = 80;

function sumLineItemColumn(items: PayslipLineItem[], key: "amount_current" | "amount_ytd"): number | null {
  let sum = 0;
  let any = false;
  for (const row of items) {
    const v = row[key];
    if (v != null && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

function isOtherDeductionPostTaxRow(row: PayslipLineItem): boolean {
  if (/OTHER\s+DEDUCTION/i.test(row.raw_section ?? "")) {
    return true;
  }
  const label = `${row.name ?? ""} ${row.description ?? ""}`.trim();
  return /\bother\s+deduction/i.test(label);
}

function sumOtherDeductionsMarkedAsPostTax(
  items: PayslipLineItem[],
  key: "amount_current" | "amount_ytd"
): number | null {
  const likelyPostTaxRows = items.filter((row) => isOtherDeductionPostTaxRow(row));
  return sumLineItemColumn(likelyPostTaxRows, key);
}

/** Warn-only when gross - pre - tax - post differs materially from net (rounding / employer layout). */
function approxNetSanityNote(
  s: PayslipLlmExtract["summary"],
  employeeTaxesCurrent: number | null,
  postTaxCurrent: number | null
): Record<string, unknown> {
  const gross = s.gross_pay_current;
  const pre = s.pre_tax_deductions_current ?? 0;
  const net = s.net_pay_current;
  if (gross == null || net == null) {
    return {};
  }
  const implied = gross - pre - (employeeTaxesCurrent ?? 0) - (postTaxCurrent ?? 0);
  const delta = Math.abs(implied - net);
  if (delta <= 1) {
    return {};
  }
  return {
    bucketArithmeticCheck: {
      impliedNetFromBuckets: Math.round(implied * 100) / 100,
      statedNet: net,
      delta: Math.round(delta * 100) / 100
    }
  };
}

/**
 * Flatten all seven line_items sections from the LLM extract into a flat array
 * suitable for bulk insert into payslip_line_item.
 * sort_order is the original array index within each section (preserves PDF row order).
 */
function flattenLineItems(lineItemsFromExtract: PayslipLlmExtract["line_items"]): LineItemForInsert[] {
  const out: LineItemForInsert[] = [];
  for (const section of PAYSLIP_LINE_ITEM_SECTIONS) {
    const rows = lineItemsFromExtract[section as keyof typeof lineItemsFromExtract];
    rows.forEach((row: PayslipLineItem, idx: number) => {
      out.push({
        section: section as PayslipLineItemSection,
        sortOrder: idx,
        name: row.name ?? null,
        authority: row.authority ?? null,
        description: row.description ?? null,
        dateStart: row.dates?.start_date ?? null,
        dateEnd: row.dates?.end_date ?? null,
        dateRaw: row.dates?.raw ?? null,
        hoursOrDaysCurrent: row.hours_or_days?.current ?? null,
        hoursOrDaysYtd: row.hours_or_days?.ytd ?? null,
        rate: row.rate ?? null,
        amountCurrent: row.amount_current ?? null,
        amountYtd: row.amount_ytd ?? null,
        rawSection: row.raw_section ?? null
      });
    });
  }
  return out;
}

/**
 * Map validated canonical LLM extract into legacy `ParsedPayslipSummary` columns plus hybrid columns.
 * Employee taxes: summary tax_deductions_* or sum of `line_items.tax_deductions`.
 * Pre-tax / post-tax: summary fields or sums of `line_items.pre_tax_deductions` / `line_items.post_tax_deductions` only
 * (do not map `other_deductions` into post-tax — Deloitte OTHER DEDUCTION(S) belongs in post_tax line items per prompt).
 * Hours default to 80 when absent (biweekly Deloitte assumption).
 */
export function mapCanonicalExtractToPersist(extract: PayslipLlmExtract, usageTokens?: number | null): CanonicalMapResult {
  const s = extract.summary;
  const emp = extract.employee;
  const em = extract.source_employer;
  const preTaxLines = extract.line_items.pre_tax_deductions;
  const preTaxSumCurrent = sumLineItemColumn(preTaxLines, "amount_current");
  const preTaxSumYtd = sumLineItemColumn(preTaxLines, "amount_ytd");
  const taxLines = extract.line_items.tax_deductions;
  const taxSumCurrent = sumLineItemColumn(taxLines, "amount_current");
  const taxSumYtd = sumLineItemColumn(taxLines, "amount_ytd");
  const postTaxLines = extract.line_items.post_tax_deductions;
  const postTaxSumCurrent = sumLineItemColumn(postTaxLines, "amount_current");
  const postTaxSumYtd = sumLineItemColumn(postTaxLines, "amount_ytd");
  const otherDeductionLines = extract.line_items.other_deductions;
  const otherAsPostTaxSumCurrent = sumOtherDeductionsMarkedAsPostTax(otherDeductionLines, "amount_current");
  const otherAsPostTaxSumYtd = sumOtherDeductionsMarkedAsPostTax(otherDeductionLines, "amount_ytd");

  let preTaxCurrent = s.pre_tax_deductions_current;
  let preTaxYtd = s.pre_tax_deductions_ytd;
  const preFromLines: { current?: boolean; ytd?: boolean } = {};
  if (preTaxCurrent == null && preTaxSumCurrent != null) {
    preTaxCurrent = preTaxSumCurrent;
    preFromLines.current = true;
  }
  if (preTaxYtd == null && preTaxSumYtd != null) {
    preTaxYtd = preTaxSumYtd;
    preFromLines.ytd = true;
  }

  let employeeTaxesCurrent = s.tax_deductions_current;
  let employeeTaxesYtd = s.tax_deductions_ytd;
  const taxFromLines: { current?: boolean; ytd?: boolean } = {};
  if (employeeTaxesCurrent == null && taxSumCurrent != null) {
    employeeTaxesCurrent = taxSumCurrent;
    taxFromLines.current = true;
  }
  if (employeeTaxesYtd == null && taxSumYtd != null) {
    employeeTaxesYtd = taxSumYtd;
    taxFromLines.ytd = true;
  }

  let postTaxCurrent = s.post_tax_deductions_current;
  let postTaxYtd = s.post_tax_deductions_ytd;
  const postFromLines: { current?: boolean; ytd?: boolean } = {};
  if (postTaxCurrent == null && postTaxSumCurrent != null) {
    postTaxCurrent = postTaxSumCurrent;
    postFromLines.current = true;
  }
  if (postTaxYtd == null && postTaxSumYtd != null) {
    postTaxYtd = postTaxSumYtd;
    postFromLines.ytd = true;
  }
  const postFromOtherDeductionRows: { current?: boolean; ytd?: boolean } = {};
  if (postTaxCurrent == null && otherAsPostTaxSumCurrent != null) {
    postTaxCurrent = otherAsPostTaxSumCurrent;
    postFromOtherDeductionRows.current = true;
  }
  if (postTaxYtd == null && otherAsPostTaxSumYtd != null) {
    postTaxYtd = otherAsPostTaxSumYtd;
    postFromOtherDeductionRows.ytd = true;
  }

  let hoursOrDaysCurrent: string | null =
    extract.employment_context.hours_or_days_worked_current != null
      ? String(extract.employment_context.hours_or_days_worked_current)
      : null;
  let hoursDefaultedBiweekly80 = false;
  if (hoursOrDaysCurrent == null) {
    hoursOrDaysCurrent = String(DEFAULT_DELOITTE_BIWEEKLY_HOURS);
    hoursDefaultedBiweekly80 = true;
  }

  const hoursOrDaysYtd: string | null =
    extract.employment_context.hours_or_days_worked_ytd != null
      ? String(extract.employment_context.hours_or_days_worked_ytd)
      : null;

  const summary: ParsedPayslipSummary = {
    payPeriodStart: extract.pay_period.start_date,
    payPeriodEnd: extract.pay_period.end_date,
    payDate: extract.pay_period.pay_date,
    hoursOrDaysCurrent,
    hoursOrDaysYtd,
    grossPayCurrent: s.gross_pay_current,
    grossPayYtd: s.gross_pay_ytd,
    employeeTaxesCurrent,
    employeeTaxesYtd,
    preTaxDeductionsCurrent: preTaxCurrent,
    preTaxDeductionsYtd: preTaxYtd,
    postTaxDeductionsCurrent: postTaxCurrent,
    postTaxDeductionsYtd: postTaxYtd,
    netPayCurrent: s.net_pay_current,
    netPayYtd: s.net_pay_ytd,
    taxableEarningsCurrent: s.taxable_earnings_current,
    taxableEarningsYtd: s.taxable_earnings_ytd,
    otherInformationCurrent: s.other_information_current,
    otherInformationYtd: s.other_information_ytd,
    rawExtractJson: {
      parser: "openai_llm_payslip",
      documentType: extract.document_type,
      usageTokens: usageTokens ?? undefined,
      totalEarningsCurrent: s.total_earnings_current,
      totalEarningsYtd: s.total_earnings_ytd,
      taxableEarningsCurrent: s.taxable_earnings_current,
      taxableEarningsYtd: s.taxable_earnings_ytd,
      ...(hoursDefaultedBiweekly80 ? { hoursDefaultBiweekly80: true } : {}),
      ...(Object.keys(preFromLines).length > 0 ? { preTaxFilledFromLineItems: preFromLines } : {}),
      ...(Object.keys(taxFromLines).length > 0 ? { taxDeductionsFilledFromLineItems: taxFromLines } : {}),
      ...(Object.keys(postFromLines).length > 0 ? { postTaxFilledFromLineItems: postFromLines } : {}),
      ...(Object.keys(postFromOtherDeductionRows).length > 0
        ? { postTaxFilledFromOtherDeductionRows: postFromOtherDeductionRows }
        : {}),
      ...approxNetSanityNote(s, employeeTaxesCurrent, postTaxCurrent)
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
    extractionMetadataJson: JSON.stringify(extract.document_metadata),
    employmentRate: extract.employment_context.rate,
    employmentRateType: extract.employment_context.rate_type
  };

  return { summary, hybrid, lineItems: flattenLineItems(extract.line_items) };
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
