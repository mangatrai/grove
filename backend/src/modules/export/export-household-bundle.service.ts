import { qAll, qGet } from "../../db/query.js";

/** Portable JSON payload embedded in export ZIP as `household-bundle.json` (v1). */
export async function buildHouseholdExportBundle(householdId: string): Promise<Record<string, unknown>> {
  const household = await qGet(
    `SELECT id, name, owner_user_id, monthly_savings_target_usd, salary_deposit_financial_account_id, employers_json, created_at FROM household WHERE id = ?`,
    householdId
  );
  const users = await qAll(
    `SELECT id, household_id, email, role, visibility_scope, created_at FROM app_user WHERE household_id = ?`,
    householdId
  );
  const accounts = await qAll(
    `SELECT id, household_id, owner_user_id, type, institution, account_mask, currency, created_at FROM financial_account WHERE household_id = ?`,
    householdId
  );
  const categories = await qAll(
    `SELECT id, household_id, parent_id, name, is_default FROM category WHERE household_id IS NULL OR household_id = ? ORDER BY name`,
    householdId
  );
  const rules = await qAll(
    `SELECT id, household_id, pattern, match_type, category_id, confidence, amount_scope, priority, enabled, created_at, updated_at FROM category_rule WHERE household_id = ?`,
    householdId
  );
  const transactions = await qAll(
    `SELECT id, household_id, account_id, user_id, category_id, txn_date, amount, direction, merchant, memo, transfer_group_id, fingerprint, source_ref, status, classification_meta, owner_scope, owner_person_profile_id, created_at
       FROM transaction_canonical WHERE household_id = ? ORDER BY txn_date DESC, id`,
    householdId
  );
  const profiles = await qAll(
    `SELECT id, household_id, linked_user_id, full_name, email, phone_number, avatar_key, salary_deposit_financial_account_id, employers_json, created_at FROM person_profile WHERE household_id = ?`,
    householdId
  );
  const memberships = await qAll(
    `SELECT id, household_id, person_profile_id, role, relationship, created_at FROM household_membership WHERE household_id = ?`,
    householdId
  );

  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    householdId,
    household,
    appUsers: users,
    financialAccounts: accounts,
    categories,
    categoryRulesHousehold: rules,
    transactionCanonical: transactions,
    personProfiles: profiles,
    householdMemberships: memberships
  };
}
