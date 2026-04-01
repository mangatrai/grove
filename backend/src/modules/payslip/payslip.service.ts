import crypto from "node:crypto";

import { db } from "../../db/sqlite.js";
import type { ParsedPayslipSummary } from "./payslip.types.js";

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
  createdAt: string;
};

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
    rawExtractJson: JSON.parse(String(r.raw_extract_json ?? "{}")) as Record<string, unknown>,
    createdAt: String(r.created_at)
  };
}

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function findPayslipByHouseholdChecksum(
  householdId: string,
  fileChecksum: string
): PayslipSnapshotRow | null {
  const row = db
    .prepare(
      `SELECT * FROM payslip_snapshot WHERE household_id = ? AND file_checksum = ?`
    )
    .get(householdId, fileChecksum) as Record<string, unknown> | undefined;
  return row ? rowToSnapshot(row) : null;
}

export function insertPayslipSnapshot(
  householdId: string,
  fileName: string,
  fileChecksum: string,
  parserProfileId: string,
  parsed: ParsedPayslipSummary,
  importFileId?: string | null,
  employerId?: string | null,
  ownerScope?: "household" | "person",
  ownerPersonProfileId?: string | null
):
  | { ok: true; snapshot: PayslipSnapshotRow }
  | { ok: false; code: "DUPLICATE_PAYSLIP"; existing: PayslipSnapshotRow } {
  const existing = findPayslipByHouseholdChecksum(householdId, fileChecksum);
  if (existing) {
    return { ok: false, code: "DUPLICATE_PAYSLIP", existing };
  }

  const id = crypto.randomUUID();
  const rawJson = JSON.stringify(parsed.rawExtractJson ?? {});

  db.prepare(
    `INSERT INTO payslip_snapshot (
      id, household_id, file_name, file_checksum, parser_profile_id, import_file_id, employer_id,
      owner_scope, owner_person_profile_id,
      pay_period_start, pay_period_end, pay_date,
      gross_pay_current, gross_pay_ytd,
      employee_taxes_current, employee_taxes_ytd,
      pre_tax_deductions_current, pre_tax_deductions_ytd,
      post_tax_deductions_current, post_tax_deductions_ytd,
      net_pay_current, net_pay_ytd,
      hours_or_days_current, raw_extract_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?
    )`
  ).run(
    id,
    householdId,
    fileName,
    fileChecksum,
    parserProfileId,
    importFileId ?? null,
    employerId ?? null,
    ownerScope ?? "household",
    ownerScope === "person" ? (ownerPersonProfileId ?? null) : null,
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
    rawJson
  );

  const row = db.prepare(`SELECT * FROM payslip_snapshot WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
  return { ok: true, snapshot: rowToSnapshot(row) };
}

export function listPayslipSnapshots(
  householdId: string,
  opts: {
    limit: number;
    offset: number;
    ownerScope?: "household" | "person";
    ownerPersonProfileId?: string | null;
  }
): { total: number; items: PayslipSnapshotRow[] } {
  const where: string[] = ["household_id = ?"];
  const params: Array<string | number | null> = [householdId];
  if (opts.ownerScope === "household") {
    where.push("owner_scope = 'household'");
  } else if (opts.ownerScope === "person" && opts.ownerPersonProfileId) {
    where.push("owner_scope = 'person' AND owner_person_profile_id = ?");
    params.push(opts.ownerPersonProfileId);
  }

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM payslip_snapshot WHERE ${where.join(" AND ")}`)
    .get(...params) as { c: number };
  const total = Number(totalRow.c) || 0;
  const rows = db
    .prepare(
      `SELECT * FROM payslip_snapshot
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, opts.limit, opts.offset) as Record<string, unknown>[];
  return { total, items: rows.map((r) => rowToSnapshot(r)) };
}

export function getPayslipSnapshotForHousehold(
  householdId: string,
  id: string
): PayslipSnapshotRow | null {
  const row = db
    .prepare(`SELECT * FROM payslip_snapshot WHERE id = ? AND household_id = ?`)
    .get(id, householdId) as Record<string, unknown> | undefined;
  return row ? rowToSnapshot(row) : null;
}
