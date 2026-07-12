import type { ParsedPayslipSummary, PayslipHybridColumns, LineItemForInsert, PayslipLineItemSection } from "../payslip.types.js";
import { PAYSLIP_LINE_ITEM_SECTIONS } from "../payslip.types.js";
import type { PayslipLlmExtract, PayslipLineItem } from "./payslip-llm.schema.js";
import { LLM_PAYSLIP_PROVIDER } from "./payslip-async.constants.js";

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
 *
 * Defensive guard: hoursOrDaysCurrent/YTD are nulled out for all non-earnings sections.
 * Smaller models (e.g. gpt-4.1-mini) occasionally place dollar amounts into the hours_or_days
 * field for deduction rows. Deductions never have meaningful hours values, so we prevent those
 * contaminated values from reaching the DB regardless of model quality.
 */
function flattenLineItems(lineItemsFromExtract: PayslipLlmExtract["line_items"]): LineItemForInsert[] {
  const out: LineItemForInsert[] = [];
  for (const section of PAYSLIP_LINE_ITEM_SECTIONS) {
    const isEarnings = section === "earnings";
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
        hoursOrDaysCurrent: isEarnings ? (row.hours_or_days?.current ?? null) : null,
        hoursOrDaysYtd: isEarnings ? (row.hours_or_days?.ytd ?? null) : null,
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
 * Map validated canonical LLM extract into `ParsedPayslipSummary` columns plus hybrid columns.
 *
 * Pre-tax deductions: when line items exist their sum is preferred over the LLM section-header
 * total, which can be incomplete (e.g. Deloitte pre_tax_deductions_ytd only captures 401k in the
 * header while Flex Spending rows are correctly extracted as individual line items).
 *
 * Post-tax deductions: `other_deductions` line items are always combined with `post_tax_deductions`
 * line items. Payslips like Deloitte place "OTHER DEDUCTION(S)" in a separate PDF section that is
 * semantically post-tax. Combined line item sums are preferred over the LLM summary value.
 *
 * IBM pay date: falls back to payment_information[0].pay_date when pay_period.pay_date is null
 * (IBM does not print a top-level pay date; it appears only in the Payment Information block).
 *
 * Hours: default to 80 when absent (biweekly Deloitte assumption).
 */
export function mapCanonicalExtractToPersist(extract: PayslipLlmExtract, usageTokens?: number | null): CanonicalMapResult {
  const s = extract.summary;
  const emp = extract.employee;
  const em = extract.source_employer;

  // ---- Pre-tax deductions ----
  const preTaxLines = extract.line_items.pre_tax_deductions;
  const preTaxSumCurrent = sumLineItemColumn(preTaxLines, "amount_current");
  const preTaxSumYtd = sumLineItemColumn(preTaxLines, "amount_ytd");

  const preFromLines: { current?: boolean; ytd?: boolean } = {};
  let preTaxCurrent: number | null;
  let preTaxYtd: number | null;
  if (preTaxLines.length > 0) {
    // Prefer line item sums — they capture every row even when the PDF section header total is
    // incomplete (e.g. Deloitte: 401k-only header total vs. three separate Flex Spending rows).
    if (preTaxSumCurrent != null) {
      preTaxCurrent = preTaxSumCurrent;
      preFromLines.current = true;
    } else {
      preTaxCurrent = s.pre_tax_deductions_current;
    }
    if (preTaxSumYtd != null) {
      preTaxYtd = preTaxSumYtd;
      preFromLines.ytd = true;
    } else {
      preTaxYtd = s.pre_tax_deductions_ytd;
    }
  } else {
    preTaxCurrent = s.pre_tax_deductions_current;
    preTaxYtd = s.pre_tax_deductions_ytd;
  }

  // ---- Employee taxes ----
  // Same rule as pre-tax: when line items exist their sum is preferred over the LLM summary value.
  // LLMs occasionally misread the tax section total from the PDF header while extracting individual
  // rows correctly (observed with gpt-4.1: summary ytd=$6409.41 but line items sum to $6909.02).
  const taxLines = extract.line_items.tax_deductions;
  const taxSumCurrent = sumLineItemColumn(taxLines, "amount_current");
  const taxSumYtd = sumLineItemColumn(taxLines, "amount_ytd");

  let employeeTaxesCurrent = s.tax_deductions_current;
  let employeeTaxesYtd = s.tax_deductions_ytd;
  const taxFromLines: { current?: boolean; ytd?: boolean } = {};
  if (taxLines.length > 0) {
    if (taxSumCurrent != null) {
      employeeTaxesCurrent = taxSumCurrent;
      taxFromLines.current = true;
    }
    if (taxSumYtd != null) {
      employeeTaxesYtd = taxSumYtd;
      taxFromLines.ytd = true;
    }
  } else {
    if (employeeTaxesCurrent == null && taxSumCurrent != null) {
      employeeTaxesCurrent = taxSumCurrent;
      taxFromLines.current = true;
    }
    if (employeeTaxesYtd == null && taxSumYtd != null) {
      employeeTaxesYtd = taxSumYtd;
      taxFromLines.ytd = true;
    }
  }

  // ---- Post-tax deductions ----
  // Always combine post_tax_deductions + other_deductions: both represent post-tax amounts.
  // Deloitte places Tax Advance / Award Received / Imp Inc Core Life / Imp Inc Core LTD under
  // "OTHER DEDUCTION(S)" which is a distinct PDF section but semantically identical to post-tax.
  // Combined line item sums are preferred over the LLM summary header value for the same reason
  // as pre-tax: individual rows are extracted accurately even when the header total is stale.
  const postTaxLines = extract.line_items.post_tax_deductions;
  const otherDeductionLines = extract.line_items.other_deductions;
  const allPostTaxLines = [...postTaxLines, ...otherDeductionLines];
  const allPostTaxSumCurrent = sumLineItemColumn(allPostTaxLines, "amount_current");
  const allPostTaxSumYtd = sumLineItemColumn(allPostTaxLines, "amount_ytd");

  const postFromLines: { current?: boolean; ytd?: boolean } = {};
  let postTaxCurrent: number | null;
  let postTaxYtd: number | null;
  if (allPostTaxLines.length > 0) {
    // Prefer combined line item sums (captures both sections)
    if (allPostTaxSumCurrent != null) {
      postTaxCurrent = allPostTaxSumCurrent;
      postFromLines.current = true;
    } else {
      postTaxCurrent = s.post_tax_deductions_current;
    }
    if (allPostTaxSumYtd != null) {
      postTaxYtd = allPostTaxSumYtd;
      postFromLines.ytd = true;
    } else {
      postTaxYtd = s.post_tax_deductions_ytd;
    }
  } else {
    postTaxCurrent = s.post_tax_deductions_current;
    postTaxYtd = s.post_tax_deductions_ytd;
  }

  // ---- Hours ----
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

  // ---- Pay date ----
  // Fall back to payment_information[0].pay_date when pay_period.pay_date is null.
  // IBM does not print a standalone pay date on the stub — it appears only in the
  // Payment Information section alongside the direct-deposit amount.
  const payDate =
    extract.pay_period.pay_date ??
    extract.payment_information.find((p) => p.pay_date != null)?.pay_date ??
    null;

  const summary: ParsedPayslipSummary = {
    payPeriodStart: extract.pay_period.start_date,
    payPeriodEnd: extract.pay_period.end_date,
    payDate,
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
      parser: LLM_PAYSLIP_PROVIDER,
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
      // Flag when other_deductions were folded into the post-tax total (diagnostic)
      ...(otherDeductionLines.length > 0 ? { otherDeductionsFoldedIntoPostTax: true } : {}),
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
