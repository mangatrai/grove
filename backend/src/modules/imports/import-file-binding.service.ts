import { db } from "../../db/sqlite.js";

import { isParserProfileId } from "./profiles/profile-ids.js";

export type BindingErrorCode =
  | "NOT_FOUND"
  | "INVALID_ACCOUNT"
  | "INVALID_PROFILE";

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
  input: { financialAccountId: string; parserProfileId: string }
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

  db.prepare(
    `UPDATE import_file
     SET financial_account_id = ?, parser_profile_id = ?
     WHERE id = ?`
  ).run(input.financialAccountId, profile, fileId);

  return { ok: true };
}

export function listHouseholdFinancialAccounts(householdId: string): Array<{
  id: string;
  type: string;
  institution: string;
  account_mask: string | null;
  currency: string;
}> {
  return db
    .prepare(
      `SELECT id, type, institution, account_mask, currency
       FROM financial_account
       WHERE household_id = ?
       ORDER BY institution, type`
    )
    .all(householdId) as Array<{
    id: string;
    type: string;
    institution: string;
    account_mask: string | null;
    currency: string;
  }>;
}
