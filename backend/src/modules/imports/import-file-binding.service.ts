import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";

import {
  findEmployerById,
  employerParserProfileId,
  listHouseholdEmployers,
  payslipBucketInstitutionFromEmployers
} from "../payslip/payslip-employer-resolve.service.js";
import { isParserProfileId } from "./profiles/profile-ids.js";

const PAYSLIP_PARSER_PROFILES = new Set(["ibm_pay_contributions_pdf", "adp_payslip_pdf"]);

/**
 * Ensures one `payslip` bucket row for import binding; `institution` follows Profile → Employer Setup.
 * Updates the label when employers change (e.g. after PATCH /household/profile or GET /imports/accounts).
 */
/** Creates or updates the single `payslip`-type account used to bind payslip PDF imports (not a bank account). */
export async function ensurePayslipImportBucketAccount(householdId: string, ownerUserId: string): Promise<void> {
  const employers = await listHouseholdEmployers(householdId, ownerUserId);
  const institution = payslipBucketInstitutionFromEmployers(employers);
  const existing = await qGet<{ id: string }>(
    `SELECT id FROM financial_account
       WHERE household_id = ? AND owner_user_id = ? AND type = 'payslip' LIMIT 1`,
    householdId,
    ownerUserId
  );
  if (existing) {
    await qExec(`UPDATE financial_account SET institution = ? WHERE id = ? AND household_id = ?`, institution, existing.id, householdId);
    return;
  }
  const id = randomUUID();
  await qExec(
    `INSERT INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
     VALUES (?, ?, ?, 'payslip', ?, NULL, 'USD', CURRENT_TIMESTAMP)`,
    id,
    householdId,
    ownerUserId,
    institution
  );
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

async function accountBelongsToHousehold(accountId: string, householdId: string): Promise<boolean> {
  const row = await qGet<{ ok: number }>(
    `SELECT 1 AS ok FROM financial_account WHERE id = ? AND household_id = ?`,
    accountId,
    householdId
  );
  return Boolean(row);
}

export async function updateImportFileBinding(
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
): Promise<BindingSuccess | BindingFailure> {
  const session = await qGet<{ id: string }>(
    `SELECT id FROM import_session WHERE id = ? AND household_id = ?`,
    sessionId,
    householdId
  );
  if (!session) {
    return { ok: false, code: "NOT_FOUND", message: "Import session not found" };
  }

  const file = await qGet<{ id: string }>(
    `SELECT id FROM import_file WHERE id = ? AND session_id = ?`,
    fileId,
    sessionId
  );
  if (!file) {
    return { ok: false, code: "NOT_FOUND", message: "Import file not found" };
  }

  if (!(await accountBelongsToHousehold(input.financialAccountId, householdId))) {
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
    const ownerOk = await qGet<{ ok: number }>(
      `SELECT 1 AS ok FROM person_profile
         WHERE id = ? AND household_id = ?
         LIMIT 1`,
      ownerPersonProfileId,
      householdId
    );
    if (!ownerOk) {
      return { ok: false, code: "NOT_FOUND", message: "Owner person profile not found for household" };
    }
  }

  if (employerId) {
    const emp = await findEmployerById(householdId, employerId, userId);
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

  await qExec(
    `UPDATE import_file
     SET financial_account_id = ?, parser_profile_id = ?, employer_id = ?, owner_scope = ?, owner_person_profile_id = ?
     WHERE id = ?`,
    input.financialAccountId,
    profile,
    employerId ?? null,
    ownerScope,
    ownerPersonProfileId,
    fileId
  );

  return { ok: true };
}

export async function listHouseholdFinancialAccounts(householdId: string): Promise<
  Array<{
    id: string;
    type: string;
    institution: string;
    account_mask: string | null;
    currency: string;
    owner_scope: "household" | "person";
    owner_person_profile_id: string | null;
    default_parser_profile_id: string | null;
  }>
> {
  return qAll(
    `SELECT id, type, institution, account_mask, currency, owner_scope, owner_person_profile_id, default_parser_profile_id
       FROM financial_account
       WHERE household_id = ?
       ORDER BY CASE WHEN type = 'payslip' THEN 0 ELSE 1 END, institution, type`,
    householdId
  );
}

export async function createHouseholdFinancialAccount(input: {
  householdId: string;
  ownerUserId: string;
  type: string;
  institution: string;
  accountMask?: string | null;
  currency?: string;
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string | null;
  defaultParserProfileId?: string | null;
}): Promise<{ id: string }> {
  const ownerScope = input.ownerScope ?? "household";
  const ownerPersonProfileId = ownerScope === "person" ? (input.ownerPersonProfileId ?? null) : null;
  const id = randomUUID();
  await qExec(
    `INSERT INTO financial_account (
       id, household_id, owner_user_id, type, institution, account_mask, currency, created_at,
       owner_scope, owner_person_profile_id, default_parser_profile_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`,
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

export async function updateHouseholdFinancialAccount(input: {
  accountId: string;
  householdId: string;
  type: string;
  institution: string;
  accountMask?: string | null;
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string | null;
  defaultParserProfileId?: string | null;
}): Promise<boolean> {
  const ownerScope = input.ownerScope ?? "household";
  const ownerPersonProfileId = ownerScope === "person" ? (input.ownerPersonProfileId ?? null) : null;
  const updated = await qGet<{ id: string }>(
    `UPDATE financial_account
       SET type = ?, institution = ?, account_mask = ?, owner_scope = ?, owner_person_profile_id = ?, default_parser_profile_id = ?
       WHERE id = ? AND household_id = ?
       RETURNING id`,
    input.type,
    input.institution.trim(),
    input.accountMask ?? null,
    ownerScope,
    ownerPersonProfileId,
    input.defaultParserProfileId ?? null,
    input.accountId,
    input.householdId
  );
  return Boolean(updated);
}
