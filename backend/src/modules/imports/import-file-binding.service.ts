import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";

import {
  findEmployerById,
  employerParserProfileId,
  listHouseholdEmployers,
  payslipBucketInstitutionFromEmployers
} from "../payslip/payslip-employer-resolve.service.js";
import { isParserProfileId } from "./profiles/profile-ids.js";

const PAYSLIP_PARSER_PROFILES = new Set(["ibm_pay_contributions_pdf", "deloitte_payslip_pdf", "adp_payslip_pdf"]);

function parseStatementEndDate(confidenceSummary: string | null): string | null {
  if (!confidenceSummary?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(confidenceSummary) as {
      statementBalances?: {
        asOfEnd?: unknown;
      };
    };
    const raw = parsed.statementBalances?.asOfEnd;
    if (typeof raw !== "string") {
      return null;
    }
    const normalized = raw.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

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

export async function listHouseholdFinancialAccounts(
  householdId: string,
  options?: { includeClosedAccounts?: boolean; memberPersonProfileId?: string | null }
): Promise<
  Array<{
    id: string;
    type: string;
    sub_type: string | null;
    memo: string | null;
    liquidity: string | null;
    linked_account_id: string | null;
    property_id: string | null;
    institution: string;
    account_mask: string | null;
    currency: string;
    owner_scope: "household" | "person";
    owner_person_profile_id: string | null;
    default_parser_profile_id: string | null;
    status: string;
    closed_at: string | null;
    last_uploaded_at: string | null;
    last_statement_end_date: string | null;
  }>
> {
  const includeClosedAccounts = options?.includeClosedAccounts ?? false;
  const statusFilter = includeClosedAccounts ? "" : " AND fa.status = 'active'";
  const memberProfileId = options?.memberPersonProfileId ?? null;
  const memberFilter = memberProfileId
    ? " AND (fa.owner_scope = 'household' OR fa.owner_person_profile_id = ?)"
    : "";
  const accounts = await qAll<{
    id: string;
    type: string;
    sub_type: string | null;
    memo: string | null;
    liquidity: string | null;
    linked_account_id: string | null;
    property_id: string | null;
    institution: string;
    account_mask: string | null;
    currency: string;
    owner_scope: "household" | "person";
    owner_person_profile_id: string | null;
    default_parser_profile_id: string | null;
    status: string;
    closed_at: string | null;
    last_uploaded_at: string | null;
  }>(
    `SELECT fa.id,
            fa.type,
            fa.sub_type,
            fa.memo,
            fa.liquidity,
            fa.linked_account_id,
            fa.property_id,
            fa.institution,
            fa.account_mask,
            fa.currency,
            fa.owner_scope,
            fa.owner_person_profile_id,
            fa.default_parser_profile_id,
            fa.status,
            fa.closed_at::text AS closed_at,
            MAX(f.uploaded_at)::text AS last_uploaded_at
       FROM financial_account fa
       LEFT JOIN import_file f
         ON f.financial_account_id = fa.id
        AND f.status = 'parsed'
      WHERE fa.household_id = ?${statusFilter}${memberFilter}
      GROUP BY fa.id, fa.type, fa.sub_type, fa.memo, fa.liquidity, fa.linked_account_id, fa.property_id,
               fa.institution, fa.account_mask, fa.currency, fa.owner_scope,
               fa.owner_person_profile_id, fa.default_parser_profile_id, fa.status, fa.closed_at
      ORDER BY CASE WHEN fa.type = 'payslip' THEN 0 ELSE 1 END, fa.institution, fa.type`,
    householdId,
    ...(memberProfileId ? [memberProfileId] : [])
  );

  const statementRows = await qAll<{
    financial_account_id: string;
    confidence_summary: string | null;
  }>(
    `SELECT f.financial_account_id, f.confidence_summary
       FROM import_file f
       INNER JOIN financial_account fa ON fa.id = f.financial_account_id
      WHERE fa.household_id = ?
        AND f.status = 'parsed'
      ORDER BY f.uploaded_at DESC`,
    householdId
  );

  // Keep the MAXIMUM statement end date per account (YYYY-MM-DD strings compare correctly).
  // Do NOT break early — a file uploaded later may have an older statement period.
  const lastStatementEndByAccount = new Map<string, string>();
  for (const row of statementRows) {
    const asOfEnd = parseStatementEndDate(row.confidence_summary);
    if (!asOfEnd) continue;
    const existing = lastStatementEndByAccount.get(row.financial_account_id);
    if (!existing || asOfEnd > existing) {
      lastStatementEndByAccount.set(row.financial_account_id, asOfEnd);
    }
  }

  return accounts.map((account) => ({
    ...account,
    last_statement_end_date: lastStatementEndByAccount.get(account.id) ?? null
  }));
}

export async function createHouseholdFinancialAccount(input: {
  householdId: string;
  ownerUserId: string;
  type: string;
  subType?: string | null;
  memo?: string | null;
  liquidity?: string | null;
  institution: string;
  accountMask?: string | null;
  currency?: string;
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string | null;
  defaultParserProfileId?: string | null;
}): Promise<{ id: string }> {
  const ownerScope = input.ownerScope ?? "household";
  const ownerPersonProfileId = ownerScope === "person" ? (input.ownerPersonProfileId ?? null) : null;
  const liquidity = input.liquidity ?? defaultLiquidity(input.type, input.subType ?? null);
  const id = randomUUID();
  await qExec(
    `INSERT INTO financial_account (
       id, household_id, owner_user_id, type, sub_type, memo, liquidity,
       institution, account_mask, currency, created_at,
       owner_scope, owner_person_profile_id, default_parser_profile_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`,
    id,
    input.householdId,
    input.ownerUserId,
    input.type,
    input.subType ?? null,
    input.memo?.trim() || null,
    liquidity,
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
  subType?: string | null;
  memo?: string | null;
  liquidity?: string | null;
  institution: string;
  accountMask?: string | null;
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string | null;
  defaultParserProfileId?: string | null;
  status?: "active" | "closed";
}): Promise<boolean> {
  const ownerScope = input.ownerScope ?? "household";
  const ownerPersonProfileId = ownerScope === "person" ? (input.ownerPersonProfileId ?? null) : null;
  // Explicit null means "clear override, revert to auto". Undefined means "keep existing".
  // Here we always re-derive when null is passed so edits stay consistent.
  const liquidity = input.liquidity ?? defaultLiquidity(input.type, input.subType ?? null);

  const setClauses = [
    "type = ?",
    "sub_type = ?",
    "memo = ?",
    "liquidity = ?",
    "institution = ?",
    "account_mask = ?",
    "owner_scope = ?",
    "owner_person_profile_id = ?",
    "default_parser_profile_id = ?"
  ];
  const params: unknown[] = [
    input.type,
    input.subType ?? null,
    input.memo?.trim() || null,
    liquidity,
    input.institution.trim(),
    input.accountMask ?? null,
    ownerScope,
    ownerPersonProfileId,
    input.defaultParserProfileId ?? null
  ];

  if (input.status !== undefined) {
    setClauses.push("status = ?");
    params.push(input.status);
    if (input.status === "closed") {
      setClauses.push("closed_at = COALESCE(closed_at, NOW())");
    } else {
      setClauses.push("closed_at = NULL");
    }
  }

  params.push(input.accountId, input.householdId);

  const updated = await qGet<{ id: string }>(
    `UPDATE financial_account
        SET ${setClauses.join(", ")}
      WHERE id = ? AND household_id = ?
      RETURNING id`,
    ...params
  );
  return Boolean(updated);
}

/**
 * Compute default liquidity from account type + sub_type.
 * Returns null for liability types (credit_card, loan) and payslip.
 * The user can always override via the explicit liquidity field.
 */
export function defaultLiquidity(
  type: string,
  subType: string | null
): "liquid" | "semi_liquid" | "restricted" | null {
  switch (type) {
    case "checking":
      return "liquid";
    case "savings":
      return subType === "cd" ? "semi_liquid" : "liquid";
    case "investment":
      return subType === "stock_options" ? "restricted" : "semi_liquid";
    case "retirement":
      return "restricted";
    case "health":
      return subType === "hsa" ? "semi_liquid" : "restricted";
    case "education":
      return "restricted";
    case "cash":
      return "liquid";
    default:
      // credit_card, loan, payslip — not classified for liquidity
      return null;
  }
}
