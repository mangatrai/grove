import crypto from "node:crypto";

import { qAll, qBegin, qExec, qGet, sqlBind } from "../../db/query.js";
import { deriveSummaryFromLineItems, validatePayslipBalance } from "./payslip-validation.js";
import type { ValidationWarning } from "./payslip-validation.js";
import type {
  LineItemForInsert,
  ParsedPayslipSummary,
  PayslipHybridColumns,
  PayslipLineItemRow,
  PayslipLineItemSection,
  PayslipLineItemsGrouped
} from "./payslip.types.js";
import { PAYSLIP_LINE_ITEM_SECTIONS } from "./payslip.types.js";

function daysBetween(a: string, b: string): number {
  return Math.abs(
    Math.round(
      (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) /
        86_400_000
    )
  );
}

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

export type PayslipSnapshotRow = {
  id: string;
  householdId: string;
  fileName: string;
  fileChecksum: string;
  parserProfileId: string;
  /** Employer id from user profile `employers_json` when set. */
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
  canonicalExtractJson: Record<string, unknown>;
  currency: string | null;
  employerDisplayName: string | null;
  employeeDisplayName: string | null;
  employerEinOrFein: string | null;
  employeeId: string | null;
  personnelNumber: string | null;
  talentId: string | null;
  taxProfileJson: Record<string, unknown> | null;
  paymentSummaryJson: unknown | null;
  extractionMetadataJson: Record<string, unknown> | null;
  updatedAt: string;
  createdAt: string;
  /** Prior-period values for the same person — populated by list query only (PS-1). */
  prior?: {
    grossPayCurrent: number | null;
    netPayCurrent: number | null;
    employeeTaxesCurrent: number | null;
    preTaxDeductionsCurrent: number | null;
  } | null;
  /** Count of payslips in the same calendar year for the same person — detail query only (PS-4). */
  payPeriodCountYtd?: number;
};

function parseJsonRecord(s: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (s == null || String(s).trim() === "") {
    return fallback;
  }
  try {
    return JSON.parse(String(s)) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function parseJsonUnknown(s: unknown): unknown {
  if (s == null || String(s).trim() === "") {
    return null;
  }
  try {
    return JSON.parse(String(s)) as unknown;
  } catch {
    return null;
  }
}

function rowToSnapshot(r: Record<string, unknown>): PayslipSnapshotRow {
  return {
    id: String(r.id),
    householdId: String(r.household_id),
    fileName: String(r.file_name),
    fileChecksum: String(r.file_checksum),
    parserProfileId: String(r.parser_profile_id),
    employerId: r.employer_id == null ? null : String(r.employer_id),
    ownerScope: String(r.owner_scope) === "person" ? "person" : "household",
    ownerPersonProfileId: r.owner_person_profile_id == null ? null : String(r.owner_person_profile_id),
    importFileId: r.import_file_id == null ? null : String(r.import_file_id),
    payPeriodStart: r.pay_period_start == null ? null : String(r.pay_period_start),
    payPeriodEnd: r.pay_period_end == null ? null : String(r.pay_period_end),
    payDate: r.pay_date == null ? null : String(r.pay_date),
    grossPayCurrent: r.gross_pay_current == null ? null : Number(r.gross_pay_current),
    grossPayYtd: r.gross_pay_ytd == null ? null : Number(r.gross_pay_ytd),
    employeeTaxesCurrent: r.employee_taxes_current == null ? null : Number(r.employee_taxes_current),
    employeeTaxesYtd: r.employee_taxes_ytd == null ? null : Number(r.employee_taxes_ytd),
    preTaxDeductionsCurrent:
      r.pre_tax_deductions_current == null ? null : Number(r.pre_tax_deductions_current),
    preTaxDeductionsYtd: r.pre_tax_deductions_ytd == null ? null : Number(r.pre_tax_deductions_ytd),
    postTaxDeductionsCurrent:
      r.post_tax_deductions_current == null ? null : Number(r.post_tax_deductions_current),
    postTaxDeductionsYtd: r.post_tax_deductions_ytd == null ? null : Number(r.post_tax_deductions_ytd),
    netPayCurrent: r.net_pay_current == null ? null : Number(r.net_pay_current),
    netPayYtd: r.net_pay_ytd == null ? null : Number(r.net_pay_ytd),
    hoursOrDaysCurrent: r.hours_or_days_current == null ? null : String(r.hours_or_days_current),
    hoursOrDaysYtd: r.hours_or_days_ytd == null ? null : String(r.hours_or_days_ytd),
    taxableEarningsCurrent: r.taxable_earnings_current == null ? null : Number(r.taxable_earnings_current),
    taxableEarningsYtd: r.taxable_earnings_ytd == null ? null : Number(r.taxable_earnings_ytd),
    otherInformationCurrent: r.other_information_current == null ? null : Number(r.other_information_current),
    otherInformationYtd: r.other_information_ytd == null ? null : Number(r.other_information_ytd),
    employmentRate: r.employment_rate == null ? null : Number(r.employment_rate),
    employmentRateType: r.employment_rate_type == null ? null : String(r.employment_rate_type),
    rawExtractJson: parseJsonRecord(r.raw_extract_json, {}),
    canonicalExtractJson: parseJsonRecord(r.canonical_extract_json, {}),
    currency: r.currency == null ? null : String(r.currency),
    employerDisplayName: r.employer_display_name == null ? null : String(r.employer_display_name),
    employeeDisplayName: r.employee_display_name == null ? null : String(r.employee_display_name),
    employerEinOrFein: r.employer_ein_or_fein == null ? null : String(r.employer_ein_or_fein),
    employeeId: r.employee_id == null ? null : String(r.employee_id),
    personnelNumber: r.personnel_number == null ? null : String(r.personnel_number),
    talentId: r.talent_id == null ? null : String(r.talent_id),
    taxProfileJson:
      r.tax_profile_json == null || String(r.tax_profile_json).trim() === ""
        ? null
        : parseJsonRecord(r.tax_profile_json, {}),
    paymentSummaryJson:
      r.payment_summary_json == null || String(r.payment_summary_json).trim() === "" ? null : parseJsonUnknown(r.payment_summary_json),
    extractionMetadataJson:
      r.extraction_metadata_json == null || String(r.extraction_metadata_json).trim() === ""
        ? null
        : parseJsonRecord(r.extraction_metadata_json, {}),
    updatedAt: String(r.updated_at ?? r.created_at),
    createdAt: String(r.created_at),
    prior: 'prior_gross' in r
      ? {
          grossPayCurrent: r.prior_gross == null ? null : Number(r.prior_gross),
          netPayCurrent: r.prior_net == null ? null : Number(r.prior_net),
          employeeTaxesCurrent: r.prior_taxes == null ? null : Number(r.prior_taxes),
          preTaxDeductionsCurrent: r.prior_pre_tax == null ? null : Number(r.prior_pre_tax),
        }
      : undefined,
    payPeriodCountYtd: 'pay_period_count_ytd' in r && r.pay_period_count_ytd != null
      ? Number(r.pay_period_count_ytd)
      : undefined,
  };
}

function rowToLineItem(r: Record<string, unknown>): PayslipLineItemRow {
  return {
    id: String(r.id),
    payslipSnapshotId: String(r.payslip_snapshot_id),
    householdId: String(r.household_id),
    section: String(r.section) as PayslipLineItemSection,
    sortOrder: Number(r.sort_order),
    name: r.name == null ? null : String(r.name),
    authority: r.authority == null ? null : String(r.authority),
    description: r.description == null ? null : String(r.description),
    dateStart: r.date_start == null ? null : String(r.date_start),
    dateEnd: r.date_end == null ? null : String(r.date_end),
    dateRaw: r.date_raw == null ? null : String(r.date_raw),
    hoursOrDaysCurrent: r.hours_or_days_current == null ? null : Number(r.hours_or_days_current),
    hoursOrDaysYtd: r.hours_or_days_ytd == null ? null : Number(r.hours_or_days_ytd),
    rate: r.rate == null ? null : Number(r.rate),
    amountCurrent: r.amount_current == null ? null : Number(r.amount_current),
    amountYtd: r.amount_ytd == null ? null : Number(r.amount_ytd),
    rawSection: r.raw_section == null ? null : String(r.raw_section),
    createdAt: String(r.created_at)
  };
}

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function findPayslipByHouseholdChecksum(
  householdId: string,
  fileChecksum: string
): Promise<PayslipSnapshotRow | null> {
  const row = await qGet<Record<string, unknown>>(
    `SELECT * FROM payslip_snapshot WHERE household_id = ? AND file_checksum = ?`,
    householdId,
    fileChecksum
  );
  return row ? rowToSnapshot(row) : null;
}

/** Synthetic checksum so manual rows never collide with PDF file hashes. */
export function syntheticManualPayslipChecksum(): string {
  const token = crypto.randomUUID();
  return sha256Hex(Buffer.from(`manual:${token}`, "utf8"));
}

const MANUAL_FILE_NAME = "Manual entry";

/** Insert a user-typed payslip row: same snapshot shape as PDF upload, unique synthetic checksum. */
export async function insertManualPayslipSnapshot(
  householdId: string,
  input: {
    parserProfileId: string;
    employerId: string | null;
    employerDisplayName: string | null;
    ownerScope: "household" | "person";
    ownerPersonProfileId: string | null;
    summary: Omit<ParsedPayslipSummary, "rawExtractJson">;
    lineItems?: LineItemForInsert[];
  }
): Promise<{ ok: true; snapshot: PayslipSnapshotRow }> {
  const checksum = syntheticManualPayslipChecksum();
  const parsed: ParsedPayslipSummary = {
    ...input.summary,
    rawExtractJson: {
      source: "manual",
      createdAt: new Date().toISOString()
    }
  };
  const hybrid: PayslipHybridColumns = {
    canonicalExtractJson: JSON.stringify({ version: 1, source: "manual" }),
    currency: "USD",
    employerDisplayName: input.employerDisplayName,
    employeeDisplayName: null,
    employerEinOrFein: null,
    employeeId: null,
    personnelNumber: null,
    talentId: null,
    taxProfileJson: null,
    paymentSummaryJson: null,
    extractionMetadataJson: JSON.stringify({ source: "manual", createdAt: new Date().toISOString() }),
    employmentRate: null,
    employmentRateType: null
  };

  const result = await insertPayslipSnapshot(
    householdId,
    MANUAL_FILE_NAME,
    checksum,
    input.parserProfileId,
    parsed,
    null,
    input.employerId,
    input.ownerScope,
    input.ownerPersonProfileId,
    hybrid,
    input.lineItems ?? []
  );

  if (!result.ok) {
    throw new Error("unexpected duplicate checksum for manual payslip");
  }
  return result;
}

export async function insertPayslipSnapshot(
  householdId: string,
  fileName: string,
  fileChecksum: string,
  parserProfileId: string,
  parsed: ParsedPayslipSummary,
  importFileId?: string | null,
  employerId?: string | null,
  ownerScope?: "household" | "person",
  ownerPersonProfileId?: string | null,
  hybrid?: PayslipHybridColumns | null,
  lineItems?: LineItemForInsert[]
): Promise<
  | { ok: true; snapshot: PayslipSnapshotRow }
  | { ok: false; code: "DUPLICATE_PAYSLIP"; existing: PayslipSnapshotRow }
> {
  const existing = await findPayslipByHouseholdChecksum(householdId, fileChecksum);
  if (existing) {
    return { ok: false, code: "DUPLICATE_PAYSLIP", existing };
  }

  const id = crypto.randomUUID();
  const rawJson = JSON.stringify(parsed.rawExtractJson ?? {});
  const scope = ownerScope ?? "household";
  const h = hybrid ?? null;
  const items = lineItems ?? [];

  return qBegin(async (tx) => {
    const { text: insertText, values: insertValues } = sqlBind(
      `INSERT INTO payslip_snapshot (
        id, household_id, file_name, file_checksum, parser_profile_id, import_file_id, employer_id,
        owner_scope, owner_person_profile_id,
        pay_period_start, pay_period_end, pay_date,
        gross_pay_current, gross_pay_ytd,
        employee_taxes_current, employee_taxes_ytd,
        pre_tax_deductions_current, pre_tax_deductions_ytd,
        post_tax_deductions_current, post_tax_deductions_ytd,
        net_pay_current, net_pay_ytd,
        hours_or_days_current, hours_or_days_ytd,
        taxable_earnings_current, taxable_earnings_ytd,
        other_information_current, other_information_ytd,
        raw_extract_json,
        canonical_extract_json, currency,
        employer_display_name, employee_display_name, employer_ein_or_fein,
        employee_id, personnel_number, talent_id,
        tax_profile_json, payment_summary_json, extraction_metadata_json,
        employment_rate, employment_rate_type,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?,
        NOW()
      )`,
      [
        id,
        householdId,
        fileName,
        fileChecksum,
        parserProfileId,
        importFileId ?? null,
        employerId ?? null,
        scope,
        scope === "person" ? (ownerPersonProfileId ?? null) : null,
        parsed.payPeriodStart,
        parsed.payPeriodEnd,
        parsed.payDate,
        parsed.grossPayCurrent,
        parsed.grossPayYtd,
        parsed.employeeTaxesCurrent,
        parsed.employeeTaxesYtd,
        parsed.preTaxDeductionsCurrent,
        parsed.preTaxDeductionsYtd,
        parsed.postTaxDeductionsCurrent,
        parsed.postTaxDeductionsYtd,
        parsed.netPayCurrent,
        parsed.netPayYtd,
        parsed.hoursOrDaysCurrent,
        parsed.hoursOrDaysYtd ?? null,
        parsed.taxableEarningsCurrent ?? null,
        parsed.taxableEarningsYtd ?? null,
        parsed.otherInformationCurrent ?? null,
        parsed.otherInformationYtd ?? null,
        rawJson,
        h?.canonicalExtractJson ?? "{}",
        h?.currency ?? null,
        h?.employerDisplayName ?? null,
        h?.employeeDisplayName ?? null,
        h?.employerEinOrFein ?? null,
        h?.employeeId ?? null,
        h?.personnelNumber ?? null,
        h?.talentId ?? null,
        h?.taxProfileJson ?? null,
        h?.paymentSummaryJson ?? null,
        h?.extractionMetadataJson ?? null,
        h?.employmentRate ?? null,
        h?.employmentRateType ?? null
      ]
    );
    await tx.unsafe(insertText, insertValues as never[]);

    // Insert line items in same transaction; ON DELETE CASCADE handles cleanup on snapshot delete
    for (const [idx, item] of items.entries()) {
      const lineItemId = crypto.randomUUID();
      const { text: liText, values: liValues } = sqlBind(
        `INSERT INTO payslip_line_item (
          id, payslip_snapshot_id, household_id, section, sort_order,
          name, authority, description,
          date_start, date_end, date_raw,
          hours_or_days_current, hours_or_days_ytd,
          rate, amount_current, amount_ytd, raw_section
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?
        )`,
        [
          lineItemId,
          id,
          householdId,
          item.section,
          idx,
          item.name,
          item.authority,
          item.description,
          item.dateStart,
          item.dateEnd,
          item.dateRaw,
          item.hoursOrDaysCurrent,
          item.hoursOrDaysYtd,
          item.rate,
          item.amountCurrent,
          item.amountYtd,
          item.rawSection
        ]
      );
      await tx.unsafe(liText, liValues as never[]);
    }

    const rows = await tx.unsafe(`SELECT * FROM payslip_snapshot WHERE id = $1`, [id]);
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error("payslip_snapshot insert missing row");
    }
    return { ok: true as const, snapshot: rowToSnapshot(row) };
  });
}

/** Group raw DB rows (already mapped) into the grouped shape. */
function groupLineItemRows(rows: Record<string, unknown>[]): PayslipLineItemsGrouped {
  const grouped = Object.fromEntries(
    PAYSLIP_LINE_ITEM_SECTIONS.map((s) => [s, [] as PayslipLineItemRow[]])
  ) as PayslipLineItemsGrouped;
  for (const r of rows) {
    const section = String(r.section) as PayslipLineItemSection;
    if (section in grouped) {
      grouped[section].push(rowToLineItem(r));
    }
  }
  return grouped;
}

/**
 * Query all line items for a payslip, grouped by section.
 * Returns an empty array for sections with no rows (never undefined).
 */
export async function getPayslipLineItems(
  payslipSnapshotId: string,
  householdId: string
): Promise<PayslipLineItemsGrouped> {
  const rows = await qAll<Record<string, unknown>>(
    `SELECT * FROM payslip_line_item
     WHERE payslip_snapshot_id = ? AND household_id = ?
     ORDER BY section, sort_order`,
    payslipSnapshotId,
    householdId
  );
  return groupLineItemRows(rows);
}

export async function listPayslipSnapshots(
  householdId: string,
  opts: {
    limit: number;
    offset: number;
    ownerScope?: "household" | "person";
    ownerPersonProfileId?: string | null;
  }
): Promise<{ total: number; items: PayslipSnapshotRow[] }> {
  const where: string[] = ["household_id = ?"];
  const params: unknown[] = [householdId];
  if (opts.ownerScope === "household") {
    where.push("owner_scope = 'household'");
  } else if (opts.ownerScope === "person" && opts.ownerPersonProfileId) {
    where.push("owner_scope = 'person' AND owner_person_profile_id = ?");
    params.push(opts.ownerPersonProfileId);
  }

  const totalRow = await qGet<{ c: string | number }>(
    `SELECT COUNT(*)::int AS c FROM payslip_snapshot WHERE ${where.join(" AND ")}`,
    ...params
  );
  const total = Number(totalRow?.c) || 0;
  const rows = await qAll<Record<string, unknown>>(
    `WITH ranked AS (
       SELECT *,
         LAG(gross_pay_current)          OVER w AS prior_gross,
         LAG(net_pay_current)            OVER w AS prior_net,
         LAG(employee_taxes_current)     OVER w AS prior_taxes,
         LAG(pre_tax_deductions_current) OVER w AS prior_pre_tax
       FROM payslip_snapshot
       WHERE ${where.join(" AND ")}
       WINDOW w AS (
         PARTITION BY owner_person_profile_id
         ORDER BY COALESCE(pay_period_end, pay_date, created_at::text) ASC NULLS LAST, id ASC
       )
     )
     SELECT * FROM ranked
     ORDER BY pay_period_end DESC NULLS LAST, pay_period_start DESC NULLS LAST, created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    ...params,
    opts.limit,
    opts.offset
  );
  return { total, items: rows.map((r) => rowToSnapshot(r)) };
}

export async function getPayslipSnapshotForHousehold(
  householdId: string,
  id: string
): Promise<PayslipSnapshotRow | null> {
  const row = await qGet<Record<string, unknown>>(
    `SELECT s.*,
       (SELECT COUNT(*)::int
        FROM payslip_snapshot s2
        WHERE s2.household_id = s.household_id
          AND s2.owner_person_profile_id IS NOT DISTINCT FROM s.owner_person_profile_id
          AND EXTRACT(year FROM COALESCE(s2.pay_period_end::date, s2.pay_date::date, s2.created_at::date))
            = EXTRACT(year FROM COALESCE(s.pay_period_end::date, s.pay_date::date, s.created_at::date))
       ) AS pay_period_count_ytd
     FROM payslip_snapshot s
     WHERE s.id = ? AND s.household_id = ?`,
    id,
    householdId
  );
  return row ? rowToSnapshot(row) : null;
}

/** Partial update for manual correction (summary columns + audit in raw_extract_json). */
export type PayslipSnapshotPatchInput = {
  payPeriodStart?: string | null;
  payPeriodEnd?: string | null;
  payDate?: string | null;
  grossPayCurrent?: number | null;
  grossPayYtd?: number | null;
  employeeTaxesCurrent?: number | null;
  employeeTaxesYtd?: number | null;
  preTaxDeductionsCurrent?: number | null;
  preTaxDeductionsYtd?: number | null;
  postTaxDeductionsCurrent?: number | null;
  postTaxDeductionsYtd?: number | null;
  netPayCurrent?: number | null;
  netPayYtd?: number | null;
  hoursOrDaysCurrent?: string | null;
  hoursOrDaysYtd?: string | null;
  taxableEarningsCurrent?: number | null;
  taxableEarningsYtd?: number | null;
  otherInformationCurrent?: number | null;
  otherInformationYtd?: number | null;
  employmentRate?: number | null;
  employmentRateType?: string | null;
};

/**
 * Find bank transactions that likely represent the net pay deposit for a payslip.
 *
 * Uses `payDate` as the anchor when set, otherwise `payPeriodEnd`. Looks for posted
 * credit transactions within ±7 days of that anchor (±10 when anchored on period end
 * only) whose amount is within 1% (or $0.50, whichever is larger) of `netPayCurrent`.
 * If the payslip is person-scoped and that person has a salary deposit account
 * configured, the search is restricted to that account; otherwise all household
 * accounts are searched.
 *
 * Returns up to 5 candidates, closest amount match first.
 */
export async function findMatchedDeposits(
  householdId: string,
  payDate: string | null,
  netPayCurrent: number | null,
  ownerPersonProfileId: string | null,
  payPeriodEnd?: string | null
): Promise<MatchedDeposit[]> {
  const effectiveDate = payDate ?? payPeriodEnd ?? null;
  if (!effectiveDate || netPayCurrent == null) {
    return [];
  }
  const windowDays = payDate != null ? 7 : 10;

  let salaryAccountId: string | null = null;
  if (ownerPersonProfileId) {
    const profile = await qGet<{ salaryDepositFinancialAccountId: string | null }>(
      `SELECT salary_deposit_financial_account_id AS "salaryDepositFinancialAccountId"
         FROM person_profile
        WHERE id = ? AND household_id = ?
        LIMIT 1`,
      ownerPersonProfileId,
      householdId
    );
    salaryAccountId = profile?.salaryDepositFinancialAccountId ?? null;
  }

  const accountFilter = salaryAccountId ? ` AND tc.account_id = ?` : "";
  const accountParam: unknown[] = salaryAccountId ? [salaryAccountId] : [];

  const datePredicate =
    windowDays === 7
      ? `tc.txn_date::date BETWEEN ?::date - INTERVAL '7 days' AND ?::date + INTERVAL '7 days'`
      : `tc.txn_date::date BETWEEN ?::date - INTERVAL '10 days' AND ?::date + INTERVAL '10 days'`;

  type DepositRow = {
    id: string;
    txn_date: string;
    amount: string | number;
    direction: string;
    merchant: string | null;
    memo: string | null;
    account_id: string;
    institution: string;
    account_type: string;
    account_mask: string | null;
  };

  const rows = await qAll<DepositRow>(
    `SELECT tc.id, tc.txn_date, tc.amount, tc.direction, tc.merchant, tc.memo,
            tc.account_id, fa.institution, fa.type AS account_type, fa.account_mask
       FROM transaction_canonical tc
       JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
      WHERE tc.household_id = ?
        AND tc.direction = 'credit'
        AND tc.status = 'posted'
        AND ${datePredicate}
        AND ABS(CAST(tc.amount AS DOUBLE PRECISION) - ?) <= GREATEST(ABS(?) * 0.01, 0.50)${accountFilter}
      ORDER BY ABS(CAST(tc.amount AS DOUBLE PRECISION) - ?) ASC, tc.txn_date ASC
      LIMIT 5`,
    householdId,
    effectiveDate,
    effectiveDate,
    netPayCurrent,
    netPayCurrent,
    ...accountParam,
    netPayCurrent
  );

  return rows.map((r) => ({
    id: String(r.id),
    txnDate: String(r.txn_date),
    amount: Number(r.amount),
    direction: String(r.direction),
    merchant: r.merchant == null ? null : String(r.merchant),
    memo: r.memo == null ? null : String(r.memo),
    accountId: String(r.account_id),
    institution: String(r.institution),
    accountType: String(r.account_type),
    accountMask: r.account_mask == null ? null : String(r.account_mask),
    dateDelta: daysBetween(effectiveDate, String(r.txn_date)),
    amountDelta: Math.abs(Number(r.amount) - netPayCurrent)
  }));
}

export async function patchPayslipSnapshotForHousehold(
  householdId: string,
  id: string,
  patch: PayslipSnapshotPatchInput
): Promise<PayslipSnapshotRow | null> {
  const existing = await getPayslipSnapshotForHousehold(householdId, id);
  if (!existing) {
    return null;
  }
  const raw = {
    ...existing.rawExtractJson,
    manualEdit: true,
    manualEditedAt: new Date().toISOString()
  };

  const sets: string[] = [];
  const params: unknown[] = [];

  function addCol(column: string, val: unknown | undefined) {
    if (val === undefined) {
      return;
    }
    sets.push(`${column} = ?`);
    params.push(val);
  }

  addCol("pay_period_start", patch.payPeriodStart);
  addCol("pay_period_end", patch.payPeriodEnd);
  addCol("pay_date", patch.payDate);
  addCol("gross_pay_current", patch.grossPayCurrent);
  addCol("gross_pay_ytd", patch.grossPayYtd);
  addCol("employee_taxes_current", patch.employeeTaxesCurrent);
  addCol("employee_taxes_ytd", patch.employeeTaxesYtd);
  addCol("pre_tax_deductions_current", patch.preTaxDeductionsCurrent);
  addCol("pre_tax_deductions_ytd", patch.preTaxDeductionsYtd);
  addCol("post_tax_deductions_current", patch.postTaxDeductionsCurrent);
  addCol("post_tax_deductions_ytd", patch.postTaxDeductionsYtd);
  addCol("net_pay_current", patch.netPayCurrent);
  addCol("net_pay_ytd", patch.netPayYtd);
  addCol("hours_or_days_current", patch.hoursOrDaysCurrent);
  addCol("hours_or_days_ytd", patch.hoursOrDaysYtd);
  addCol("taxable_earnings_current", patch.taxableEarningsCurrent);
  addCol("taxable_earnings_ytd", patch.taxableEarningsYtd);
  addCol("other_information_current", patch.otherInformationCurrent);
  addCol("other_information_ytd", patch.otherInformationYtd);
  addCol("employment_rate", patch.employmentRate);
  addCol("employment_rate_type", patch.employmentRateType);

  sets.push("raw_extract_json = ?");
  params.push(JSON.stringify(raw));
  sets.push("updated_at = NOW()");
  params.push(id, householdId);

  await qExec(
    `UPDATE payslip_snapshot SET ${sets.join(", ")} WHERE id = ? AND household_id = ?`,
    ...params
  );
  return getPayslipSnapshotForHousehold(householdId, id);
}

/**
 * Hard-delete a payslip snapshot and its associated import_file rows.
 * Line items are automatically removed via ON DELETE CASCADE on payslip_line_item.
 *
 * If `restrictToOwnerPersonProfileId` is provided (member role), only payslips
 * whose `owner_person_profile_id` matches are deleted — members cannot delete
 * payslips belonging to other household members.
 */
export async function deletePayslipSnapshotForHousehold(
  householdId: string,
  id: string,
  restrictToOwnerPersonProfileId?: string | null
): Promise<"deleted" | "not_found" | "forbidden"> {
  const existing = await qGet<{ id: string; owner_person_profile_id: string | null }>(
    `SELECT id, owner_person_profile_id FROM payslip_snapshot WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  if (!existing) {
    return "not_found";
  }
  if (restrictToOwnerPersonProfileId != null) {
    if (existing.owner_person_profile_id !== restrictToOwnerPersonProfileId) {
      return "forbidden";
    }
  }
  // Clear the reference from import_file rows (keep the import file row for audit; just clear the payslip linkage).
  await qExec(
    `UPDATE import_file SET confidence_summary = confidence_summary WHERE session_id IN (
       SELECT session_id FROM import_file WHERE id IN (
         SELECT import_file_id FROM payslip_snapshot WHERE id = ? AND household_id = ?
       )
     )`,
    id,
    householdId
  );
  await qExec(
    `DELETE FROM payslip_snapshot WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  return "deleted";
}

// ---------------------------------------------------------------------------
// Line item CRUD (CR-117)
// ---------------------------------------------------------------------------

export type LineItemPatchInput = {
  name?: string | null;
  authority?: string | null;
  amountCurrent?: number | null;
  amountYtd?: number | null;
  hoursOrDaysCurrent?: number | null;
  hoursOrDaysYtd?: number | null;
  rate?: number | null;
};

export type LineItemMutationResult =
  | {
      ok: true;
      snapshot: PayslipSnapshotRow;
      lineItems: PayslipLineItemsGrouped;
      validationWarnings: ValidationWarning[];
    }
  | { ok: false; code: "NOT_FOUND" };

/**
 * Apply derived line-item sums to payslip_snapshot inside an open transaction.
 * Only updates columns for which deriveSummaryFromLineItems returns a value.
 */
async function applyDerivedSummary(
  tx: { unsafe(sql: string, params?: unknown[]): Promise<unknown[]> },
  householdId: string,
  payslipId: string,
  lineItems: PayslipLineItemsGrouped
): Promise<void> {
  const derived = deriveSummaryFromLineItems(lineItems);
  const sets: string[] = [];
  const params: unknown[] = [];

  function col(column: string, val: unknown) {
    sets.push(`${column} = ?`);
    params.push(val);
  }

  if ("grossPayCurrent" in derived) col("gross_pay_current", derived.grossPayCurrent);
  if ("grossPayYtd" in derived) col("gross_pay_ytd", derived.grossPayYtd);
  if ("preTaxDeductionsCurrent" in derived) col("pre_tax_deductions_current", derived.preTaxDeductionsCurrent);
  if ("preTaxDeductionsYtd" in derived) col("pre_tax_deductions_ytd", derived.preTaxDeductionsYtd);
  if ("employeeTaxesCurrent" in derived) col("employee_taxes_current", derived.employeeTaxesCurrent);
  if ("employeeTaxesYtd" in derived) col("employee_taxes_ytd", derived.employeeTaxesYtd);
  if ("postTaxDeductionsCurrent" in derived) col("post_tax_deductions_current", derived.postTaxDeductionsCurrent);
  if ("postTaxDeductionsYtd" in derived) col("post_tax_deductions_ytd", derived.postTaxDeductionsYtd);
  if ("otherInformationCurrent" in derived) col("other_information_current", derived.otherInformationCurrent);
  if ("otherInformationYtd" in derived) col("other_information_ytd", derived.otherInformationYtd);
  if ("taxableEarningsCurrent" in derived) col("taxable_earnings_current", derived.taxableEarningsCurrent);
  if ("taxableEarningsYtd" in derived) col("taxable_earnings_ytd", derived.taxableEarningsYtd);

  if (sets.length === 0) {
    return;
  }

  sets.push("updated_at = NOW()");
  params.push(payslipId, householdId);

  const { text, values } = sqlBind(
    `UPDATE payslip_snapshot SET ${sets.join(", ")} WHERE id = ? AND household_id = ?`,
    params
  );
  await tx.unsafe(text, values as never[]);
}

/** Edit a line item. Cascades: re-sums affected sections and updates snapshot columns. */
export async function patchPayslipLineItem(
  householdId: string,
  payslipId: string,
  itemId: string,
  patch: LineItemPatchInput
): Promise<LineItemMutationResult> {
  return qBegin(async (tx) => {
    // Verify item belongs to this household + payslip
    const check = await tx.unsafe(
      `SELECT pli.id FROM payslip_line_item pli
         JOIN payslip_snapshot ps ON ps.id = pli.payslip_snapshot_id
        WHERE pli.id = $1 AND ps.id = $2 AND ps.household_id = $3
        LIMIT 1`,
      [itemId, payslipId, householdId]
    );
    if (!(check as unknown[]).length) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }

    // Build the UPDATE for the line item
    const sets: string[] = [];
    const params: unknown[] = [];

    function addCol(column: string, val: unknown) {
      sets.push(`${column} = ?`);
      params.push(val);
    }

    if ("name" in patch) addCol("name", patch.name);
    if ("authority" in patch) addCol("authority", patch.authority);
    if ("amountCurrent" in patch) addCol("amount_current", patch.amountCurrent);
    if ("amountYtd" in patch) addCol("amount_ytd", patch.amountYtd);
    if ("hoursOrDaysCurrent" in patch) addCol("hours_or_days_current", patch.hoursOrDaysCurrent);
    if ("hoursOrDaysYtd" in patch) addCol("hours_or_days_ytd", patch.hoursOrDaysYtd);
    if ("rate" in patch) addCol("rate", patch.rate);

    if (sets.length > 0) {
      params.push(itemId);
      const { text, values } = sqlBind(
        `UPDATE payslip_line_item SET ${sets.join(", ")} WHERE id = ?`,
        params
      );
      await tx.unsafe(text, values as never[]);
    }

    // Re-fetch all line items and cascade to summary
    const allRows = (await tx.unsafe(
      `SELECT * FROM payslip_line_item WHERE payslip_snapshot_id = $1 AND household_id = $2 ORDER BY section, sort_order`,
      [payslipId, householdId]
    )) as Record<string, unknown>[];
    const grouped = groupLineItemRows(allRows);

    await applyDerivedSummary(tx, householdId, payslipId, grouped);

    const snapRows = (await tx.unsafe(
      `SELECT * FROM payslip_snapshot WHERE id = $1 AND household_id = $2`,
      [payslipId, householdId]
    )) as Record<string, unknown>[];
    const snapshot = rowToSnapshot(snapRows[0]!);

    return {
      ok: true as const,
      snapshot,
      lineItems: grouped,
      validationWarnings: validatePayslipBalance(snapshot, grouped)
    };
  });
}

/** Delete a line item. Cascades: re-sums remaining items in the same section and updates snapshot. */
export async function deletePayslipLineItem(
  householdId: string,
  payslipId: string,
  itemId: string
): Promise<LineItemMutationResult> {
  return qBegin(async (tx) => {
    const check = await tx.unsafe(
      `SELECT pli.id FROM payslip_line_item pli
         JOIN payslip_snapshot ps ON ps.id = pli.payslip_snapshot_id
        WHERE pli.id = $1 AND ps.id = $2 AND ps.household_id = $3
        LIMIT 1`,
      [itemId, payslipId, householdId]
    );
    if (!(check as unknown[]).length) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }

    await tx.unsafe(`DELETE FROM payslip_line_item WHERE id = $1`, [itemId]);

    const allRows = (await tx.unsafe(
      `SELECT * FROM payslip_line_item WHERE payslip_snapshot_id = $1 AND household_id = $2 ORDER BY section, sort_order`,
      [payslipId, householdId]
    )) as Record<string, unknown>[];
    const grouped = groupLineItemRows(allRows);

    await applyDerivedSummary(tx, householdId, payslipId, grouped);

    const snapRows = (await tx.unsafe(
      `SELECT * FROM payslip_snapshot WHERE id = $1 AND household_id = $2`,
      [payslipId, householdId]
    )) as Record<string, unknown>[];
    const snapshot = rowToSnapshot(snapRows[0]!);

    return {
      ok: true as const,
      snapshot,
      lineItems: grouped,
      validationWarnings: validatePayslipBalance(snapshot, grouped)
    };
  });
}

/**
 * Add a single line item to an existing payslip. Cascades summary like edit/delete.
 * sort_order is assigned as max(sort_order)+1 within the section.
 */
export async function addPayslipLineItem(
  householdId: string,
  payslipId: string,
  item: Omit<LineItemForInsert, "sortOrder">
): Promise<LineItemMutationResult> {
  return qBegin(async (tx) => {
    // Verify payslip belongs to household
    const check = await tx.unsafe(
      `SELECT id FROM payslip_snapshot WHERE id = $1 AND household_id = $2 LIMIT 1`,
      [payslipId, householdId]
    );
    if (!(check as unknown[]).length) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }

    // Determine sort_order
    const maxRows = (await tx.unsafe(
      `SELECT COALESCE(MAX(sort_order), -1) AS m FROM payslip_line_item WHERE payslip_snapshot_id = $1 AND section = $2`,
      [payslipId, item.section]
    )) as Array<{ m: number }>;
    const sortOrder = Number(maxRows[0]?.m ?? -1) + 1;

    const newId = crypto.randomUUID();
    const { text, values } = sqlBind(
      `INSERT INTO payslip_line_item (
        id, payslip_snapshot_id, household_id, section, sort_order,
        name, authority, description,
        date_start, date_end, date_raw,
        hours_or_days_current, hours_or_days_ytd,
        rate, amount_current, amount_ytd, raw_section
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId, payslipId, householdId, item.section, sortOrder,
        item.name, item.authority, item.description,
        item.dateStart, item.dateEnd, item.dateRaw,
        item.hoursOrDaysCurrent, item.hoursOrDaysYtd,
        item.rate, item.amountCurrent, item.amountYtd, item.rawSection
      ]
    );
    await tx.unsafe(text, values as never[]);

    const allRows = (await tx.unsafe(
      `SELECT * FROM payslip_line_item WHERE payslip_snapshot_id = $1 AND household_id = $2 ORDER BY section, sort_order`,
      [payslipId, householdId]
    )) as Record<string, unknown>[];
    const grouped = groupLineItemRows(allRows);

    await applyDerivedSummary(tx, householdId, payslipId, grouped);

    const snapRows = (await tx.unsafe(
      `SELECT * FROM payslip_snapshot WHERE id = $1 AND household_id = $2`,
      [payslipId, householdId]
    )) as Record<string, unknown>[];
    const snapshot = rowToSnapshot(snapRows[0]!);

    return {
      ok: true as const,
      snapshot,
      lineItems: grouped,
      validationWarnings: validatePayslipBalance(snapshot, grouped)
    };
  });
}

/**
 * Fetch all confirmed deposit matches for a payslip from payslip_deposit_match.
 * Returns them as MatchedDeposit[] with dateDelta/amountDelta computed against payDate
 * (fallback: payPeriodEnd). Returns [] if no confirmed matches exist.
 */
export async function getConfirmedDeposits(
  householdId: string,
  payslipId: string,
  payDate: string | null,
  netPayCurrent: number | null,
  payPeriodEnd?: string | null
): Promise<MatchedDeposit[]> {
  const effectiveDate = payDate ?? payPeriodEnd ?? null;
  const dateDeltaForRow = (txnDate: string): number => {
    if (!effectiveDate) {
      return 0;
    }
    return daysBetween(effectiveDate, txnDate);
  };
  const amountDeltaForRow = (amt: number): number =>
    netPayCurrent != null ? Math.abs(amt - netPayCurrent) : 0;

  type DepositRow = {
    id: string;
    txn_date: string;
    amount: string | number;
    direction: string;
    merchant: string | null;
    memo: string | null;
    account_id: string;
    institution: string;
    account_type: string;
    account_mask: string | null;
  };

  const rows = await qAll<DepositRow>(
    `SELECT tc.id, tc.txn_date, tc.amount, tc.direction, tc.merchant, tc.memo,
            tc.account_id, fa.institution, fa.type AS account_type, fa.account_mask
       FROM payslip_deposit_match pdm
       JOIN transaction_canonical tc ON tc.id = pdm.transaction_canonical_id
       JOIN financial_account fa ON fa.id = tc.account_id
                                 AND fa.household_id = tc.household_id
      WHERE pdm.payslip_snapshot_id = ?
        AND pdm.household_id = ?
      ORDER BY tc.txn_date ASC`,
    payslipId,
    householdId
  );

  return rows.map((r) => ({
    id: String(r.id),
    txnDate: String(r.txn_date),
    amount: Number(r.amount),
    direction: String(r.direction),
    merchant: r.merchant == null ? null : String(r.merchant),
    memo: r.memo == null ? null : String(r.memo),
    accountId: String(r.account_id),
    institution: String(r.institution),
    accountType: String(r.account_type),
    accountMask: r.account_mask == null ? null : String(r.account_mask),
    dateDelta: dateDeltaForRow(String(r.txn_date)),
    amountDelta: amountDeltaForRow(Number(r.amount))
  }));
}

/**
 * Add a confirmed deposit link. Idempotent — if the link already exists, returns
 * the snapshot without error. Validates that the transaction belongs to this household
 * before inserting.
 *
 * Returns null if payslipId not found, or if canonicalId not found in this household.
 */
export async function addConfirmedDeposit(
  householdId: string,
  payslipId: string,
  canonicalId: string
): Promise<PayslipSnapshotRow | null> {
  const payslip = await qGet<{ id: string }>(
    `SELECT id FROM payslip_snapshot WHERE id = ? AND household_id = ? LIMIT 1`,
    payslipId,
    householdId
  );
  if (!payslip) {
    return null;
  }

  const txn = await qGet<{ id: string }>(
    `SELECT id FROM transaction_canonical WHERE id = ? AND household_id = ? LIMIT 1`,
    canonicalId,
    householdId
  );
  if (!txn) {
    return null;
  }

  await qExec(
    `INSERT INTO payslip_deposit_match
       (payslip_snapshot_id, household_id, transaction_canonical_id)
     VALUES (?, ?, ?)
     ON CONFLICT (payslip_snapshot_id, transaction_canonical_id) DO NOTHING`,
    payslipId,
    householdId,
    canonicalId
  );

  return getPayslipSnapshotForHousehold(householdId, payslipId);
}

/**
 * Remove one confirmed deposit link. If the link does not exist, this is a no-op
 * (returns the snapshot without error).
 *
 * Returns null if payslipId not found.
 */
export async function removeConfirmedDeposit(
  householdId: string,
  payslipId: string,
  canonicalId: string
): Promise<PayslipSnapshotRow | null> {
  const payslip = await qGet<{ id: string }>(
    `SELECT id FROM payslip_snapshot WHERE id = ? AND household_id = ? LIMIT 1`,
    payslipId,
    householdId
  );
  if (!payslip) {
    return null;
  }

  await qExec(
    `DELETE FROM payslip_deposit_match
      WHERE payslip_snapshot_id = ?
        AND household_id = ?
        AND transaction_canonical_id = ?`,
    payslipId,
    householdId,
    canonicalId
  );

  return getPayslipSnapshotForHousehold(householdId, payslipId);
}

export type { ValidationWarning };
