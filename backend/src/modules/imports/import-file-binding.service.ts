import { randomUUID } from "node:crypto";

import { db } from "../../db/sqlite.js";

import { findEmployerById, employerParserProfileId } from "../payslip/payslip-employer-resolve.service.js";
import { isParserProfileId } from "./profiles/profile-ids.js";

const PAYSLIP_PARSER_PROFILES = new Set(["ibm_pay_contributions_pdf", "adp_payslip_pdf"]);

const PAYSLIP_PLACEHOLDER_INSTITUTION = "Employer payslip (IBM) — placeholder";

/**
 * Ensures the signed-in user has a `payslip` bucket row for import binding (IBM v1).
 * Idempotent — seed may already have inserted one; dev DBs created before migration **0016** get a row on first Import load.
 */
export function ensurePayslipImportPlaceholderAccount(householdId: string, ownerUserId: string): void {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM financial_account
       WHERE household_id = ? AND owner_user_id = ? AND type = 'payslip' LIMIT 1`
    )
    .get(householdId, ownerUserId) as { ok: number } | undefined;
  if (row) {
    return;
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
     VALUES (?, ?, ?, 'payslip', ?, NULL, 'USD', CURRENT_TIMESTAMP)`
  ).run(id, householdId, ownerUserId, PAYSLIP_PLACEHOLDER_INSTITUTION);
}

export type BindingErrorCode =
  | "NOT_FOUND"
  | "INVALID_ACCOUNT"
  | "INVALID_PROFILE"
  | "INVALID_EMPLOYER"
  | "EMPLOYER_PARSER_MISMATCH";

export interface BindingFailure {
  ok: false;
  code: BindingErrorCode;
  message: string;
}

export interface BindingSuccess {
  ok: true;
}

function accountBelongsToHousehold(accountId: string, householdId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM financial_account WHERE id = ? AND household_id = ?`)
    .get(accountId, householdId);
  return Boolean(row);
}

export function updateImportFileBinding(
  sessionId: string,
  fileId: string,
  householdId: string,
  userId: string,
  input: {
    financialAccountId: string;
    parserProfileId: string;
    employerId?: string | null;
    ownerScope?: "household" | "person";
    ownerPersonProfileId?: string | null;
  }
): BindingSuccess | BindingFailure {
  const session = db
    .prepare(`SELECT id FROM import_session WHERE id = ? AND household_id = ?`)
    .get(sessionId, householdId);
  if (!session) {
    return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
  }

  const file = db
    .prepare(`SELECT id FROM import_file WHERE id = ? AND session_id = ?`)
    .get(fileId, sessionId) as { id: string } | undefined;
  if (!file) {
    return { ok: false, code: "NOT_FOUND", message: "Import file not found" };
  }

  if (!accountBelongsToHousehold(input.financialAccountId, householdId)) {
    return { ok: false, code: "INVALID_ACCOUNT", message: "Financial account not found for household" };
  }

  if (!isParserProfileId(input.parserProfileId)) {
    return { ok: false, code: "INVALID_PROFILE", message: "Unknown parser profile id" };
  }

  const profile = input.parserProfileId;
  const employerId = input.employerId === undefined ? null : input.employerId;
  const ownerScope = input.ownerScope ?? "household";
  const ownerPersonProfileId = ownerScope === "person" ? (input.ownerPersonProfileId ?? null) : null;

  if (ownerScope === "person") {
    const ownerOk = db
      .prepare(
        `SELECT 1 FROM person_profile
         WHERE id = ? AND household_id = ?
         LIMIT 1`
      )
      .get(ownerPersonProfileId, householdId);
    if (!ownerOk) {
      return { ok: false, code: "NOT_FOUND", message: "Owner person profile not found for household" };
    }
  }

  if (employerId) {
    const emp = findEmployerById(householdId, employerId, userId);
    if (!emp) {
      return { ok: false, code: "INVALID_EMPLOYER", message: "Employer not found in household settings" };
    }
    if (PAYSLIP_PARSER_PROFILES.has(profile)) {
      const want = employerParserProfileId(emp);
      if (want !== profile) {
        return {
          ok: false,
          code: "EMPLOYER_PARSER_MISMATCH",
          message: `Employer is configured for ${want}; selected format is ${profile}`
        };
      }
    }
  }

  db.prepare(
    `UPDATE import_file
     SET financial_account_id = ?, parser_profile_id = ?, employer_id = ?, owner_scope = ?, owner_person_profile_id = ?
     WHERE id = ?`
  ).run(input.financialAccountId, profile, employerId ?? null, ownerScope, ownerPersonProfileId, fileId);

  return { ok: true };
}

export function listHouseholdFinancialAccounts(householdId: string): Array<{
  id: string;
  type: string;
  institution: string;
  account_mask: string | null;
  currency: string;
  owner_scope: "household" | "person";
  owner_person_profile_id: string | null;
  default_parser_profile_id: string | null;
}> {
  return db
    .prepare(
      `SELECT id, type, institution, account_mask, currency, owner_scope, owner_person_profile_id, default_parser_profile_id
       FROM financial_account
       WHERE household_id = ?
       ORDER BY CASE WHEN type = 'payslip' THEN 0 ELSE 1 END, institution, type`
    )
    .all(householdId) as Array<{
    id: string;
    type: string;
    institution: string;
    account_mask: string | null;
    currency: string;
    owner_scope: "household" | "person";
    owner_person_profile_id: string | null;
    default_parser_profile_id: string | null;
  }>;
}

export function createHouseholdFinancialAccount(input: {
  householdId: string;
  ownerUserId: string;
  type: string;
  institution: string;
  accountMask?: string | null;
  currency?: string;
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string | null;
  defaultParserProfileId?: string | null;
}): { id: string } {
  const ownerScope = input.ownerScope ?? "household";
  const ownerPersonProfileId = ownerScope === "person" ? (input.ownerPersonProfileId ?? null) : null;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO financial_account (
       id, household_id, owner_user_id, type, institution, account_mask, currency, created_at,
       owner_scope, owner_person_profile_id, default_parser_profile_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`
  ).run(
    id,
    input.householdId,
    input.ownerUserId,
    input.type,
    input.institution.trim(),
    input.accountMask ?? null,
    input.currency ?? "USD",
    ownerScope,
    ownerPersonProfileId,
    input.defaultParserProfileId ?? null
  );
  return { id };
}

export function updateHouseholdFinancialAccount(input: {
  accountId: string;
  householdId: string;
  type: string;
  institution: string;
  accountMask?: string | null;
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string | null;
  defaultParserProfileId?: string | null;
}): boolean {
  const ownerScope = input.ownerScope ?? "household";
  const ownerPersonProfileId = ownerScope === "person" ? (input.ownerPersonProfileId ?? null) : null;
  const out = db
    .prepare(
      `UPDATE financial_account
       SET type = ?, institution = ?, account_mask = ?, owner_scope = ?, owner_person_profile_id = ?, default_parser_profile_id = ?
       WHERE id = ? AND household_id = ?`
    )
    .run(
      input.type,
      input.institution.trim(),
      input.accountMask ?? null,
      ownerScope,
      ownerPersonProfileId,
      input.defaultParserProfileId ?? null,
      input.accountId,
      input.householdId
    );
  return out.changes > 0;
}
