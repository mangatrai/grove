import crypto from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";
import type { ParsedPayslipSummary, PayslipHybridColumns } from "./payslip.types.js";

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
  hybrid?: PayslipHybridColumns | null
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

  await qExec(
    `INSERT INTO payslip_snapshot (
      id, household_id, file_name, file_checksum, parser_profile_id, import_file_id, employer_id,
      owner_scope, owner_person_profile_id,
      pay_period_start, pay_period_end, pay_date,
      gross_pay_current, gross_pay_ytd,
      employee_taxes_current, employee_taxes_ytd,
      pre_tax_deductions_current, pre_tax_deductions_ytd,
      post_tax_deductions_current, post_tax_deductions_ytd,
      net_pay_current, net_pay_ytd,
      hours_or_days_current, raw_extract_json,
      canonical_extract_json, currency,
      employer_display_name, employee_display_name, employer_ein_or_fein,
      employee_id, personnel_number, talent_id,
      tax_profile_json, payment_summary_json, extraction_metadata_json,
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
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()
    )`,
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
    h?.extractionMetadataJson ?? null
  );

  const row = await qGet<Record<string, unknown>>(`SELECT * FROM payslip_snapshot WHERE id = ?`, id);
  if (!row) {
    throw new Error("payslip_snapshot insert missing row");
  }
  return { ok: true, snapshot: rowToSnapshot(row) };
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
    `SELECT * FROM payslip_snapshot
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC
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
    `SELECT * FROM payslip_snapshot WHERE id = ? AND household_id = ?`,
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
};

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
