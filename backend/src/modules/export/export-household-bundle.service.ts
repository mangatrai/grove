import { qAll, qGet } from "../../db/query.js";

export type TableExport = {
  /** Logical table key used in manifest.tables and import lookup. */
  key: string;
  /** File name inside the ZIP. */
  fileName: string;
  rows: Record<string, unknown>[];
};

/** Query all household tables and return them as individual table exports (exportVersion 3). */
export async function queryAllExportTables(householdId: string): Promise<TableExport[]> {
  const household = await qGet(
    `SELECT id, name, owner_user_id, monthly_savings_target_usd, salary_deposit_financial_account_id, employers_json, created_at
     FROM household WHERE id = ?`,
    householdId
  );

  const users = await qAll(
    `SELECT id, household_id, email, role, password_hash, token_version, visibility_scope, created_at
     FROM app_user WHERE household_id = ?`,
    householdId
  );

  const accounts = await qAll(
    `SELECT id, household_id, owner_user_id, type, institution, account_mask, currency,
            owner_scope, owner_person_profile_id, default_parser_profile_id, created_at
     FROM financial_account WHERE household_id = ?`,
    householdId
  );

  const categories = await qAll(
    `SELECT id, household_id, parent_id, name, is_default
     FROM category WHERE household_id = ?
     ORDER BY name`,
    householdId
  );

  const rules = await qAll(
    `SELECT id, household_id, pattern, match_type, category_id, confidence, amount_scope, priority, enabled, created_at, updated_at
     FROM category_rule WHERE household_id = ?`,
    householdId
  );

  const transactions = await qAll(
    `SELECT id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
            merchant, memo, transfer_group_id, fingerprint, source_ref, reference_id,
            status, classification_meta, owner_scope, owner_person_profile_id, created_at
     FROM transaction_canonical WHERE household_id = ?
     ORDER BY txn_date DESC, id`,
    householdId
  );

  const profiles = await qAll(
    `SELECT id, household_id, linked_user_id, full_name, email, phone_number, avatar_key,
            salary_deposit_financial_account_id, employers_json, created_at
     FROM person_profile WHERE household_id = ?`,
    householdId
  );

  const memberships = await qAll(
    `SELECT id, household_id, person_profile_id, role, relationship, created_at
     FROM household_membership WHERE household_id = ?`,
    householdId
  );

  const balanceSnapshots = await qAll(
    `SELECT id, household_id, financial_account_id, as_of_date, amount, currency,
            source, import_file_id, created_at, updated_at
     FROM account_balance_snapshot WHERE household_id = ?
     ORDER BY as_of_date DESC, id`,
    householdId
  );

  const payslips = await qAll(
    `SELECT id, household_id, file_name, file_checksum, parser_profile_id,
            pay_period_start, pay_period_end, pay_date,
            gross_pay_current, gross_pay_ytd,
            employee_taxes_current, employee_taxes_ytd,
            pre_tax_deductions_current, pre_tax_deductions_ytd,
            post_tax_deductions_current, post_tax_deductions_ytd,
            net_pay_current, net_pay_ytd, hours_or_days_current,
            raw_extract_json, created_at, employer_id,
            owner_scope, owner_person_profile_id
     FROM payslip_snapshot WHERE household_id = ?
     ORDER BY pay_date DESC, id`,
    householdId
  );

  const customInstitutions = await qAll(
    `SELECT id, household_id, display_name, created_at
     FROM household_custom_institution WHERE household_id = ?`,
    householdId
  );

  return [
    { key: "household",           fileName: "household.json",          rows: household ? [household] : [] },
    { key: "users",               fileName: "users.json",              rows: users },
    { key: "accounts",            fileName: "accounts.json",           rows: accounts },
    { key: "categories",          fileName: "categories.json",         rows: categories },
    { key: "category_rules",      fileName: "category_rules.json",     rows: rules },
    { key: "transactions",        fileName: "transactions.json",       rows: transactions },
    { key: "person_profiles",     fileName: "person_profiles.json",    rows: profiles },
    { key: "memberships",         fileName: "memberships.json",        rows: memberships },
    { key: "balance_snapshots",   fileName: "balance_snapshots.json",  rows: balanceSnapshots },
    { key: "payslips",            fileName: "payslips.json",           rows: payslips },
    { key: "custom_institutions", fileName: "custom_institutions.json", rows: customInstitutions },
  ];
}
