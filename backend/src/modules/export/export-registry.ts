export type ExportRow = Record<string, unknown>;

export type MemberScopeFilter = (profileId: string) => { sql: string; params: unknown[] };

export type ExportRegistryEntry = {
  tableKey: string;
  tableName: string;
  restoreOrder: number;
  householdIdColumn: string;
  memberScopeInclude: boolean;
  memberScopeFilter?: MemberScopeFilter;
  onExport?: (rows: ExportRow[]) => ExportRow[];
  onRestore?: (row: ExportRow) => ExportRow;
  skipInsert?: boolean;
  parentFirst?: boolean;
};

export const EXPORT_REGISTRY: ExportRegistryEntry[] = [
  {
    tableKey: "app_user",
    tableName: "app_user",
    restoreOrder: 1,
    householdIdColumn: "household_id",
    memberScopeInclude: false,
    onRestore: (row) => ({
      ...row,
      token_version: (Number(row.token_version ?? 0) || 0) + 1
    })
  },
  {
    tableKey: "household",
    tableName: "household",
    restoreOrder: 2,
    householdIdColumn: "id",
    memberScopeInclude: false,
    onRestore: (row) => ({
      ...row,
      owner_user_id: null,
      salary_deposit_financial_account_id: null
    }),
    skipInsert: true
  },
  {
    tableKey: "household_custom_institution",
    tableName: "household_custom_institution",
    restoreOrder: 3,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  // property must precede financial_account (financial_account.property_id → property ON DELETE SET NULL)
  {
    tableKey: "property",
    tableName: "property",
    restoreOrder: 4,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  {
    tableKey: "financial_account",
    tableName: "financial_account",
    restoreOrder: 5,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
    memberScopeFilter: (profileId) => ({ sql: "owner_person_profile_id = ?", params: [profileId] })
  },
  {
    tableKey: "property_value_snapshot",
    tableName: "property_value_snapshot",
    restoreOrder: 6,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  {
    tableKey: "category",
    tableName: "category",
    restoreOrder: 7,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
    parentFirst: true
  },
  {
    tableKey: "person_profile",
    tableName: "person_profile",
    restoreOrder: 8,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
    memberScopeFilter: (profileId) => ({ sql: "id = ?", params: [profileId] }),
    // F-9: DOB is encrypted with an instance-derived key; strip from .hfb exports.
    // Re-enter date of birth after restore (the source key won't match in another instance).
    onExport: (rows) => rows.map(({ date_of_birth_encrypted: _dob, ...rest }) => rest)
  },
  {
    tableKey: "household_membership",
    tableName: "household_membership",
    restoreOrder: 9,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  {
    tableKey: "category_rule",
    tableName: "category_rule",
    restoreOrder: 10,
    householdIdColumn: "household_id",
    memberScopeInclude: true
  },
  {
    tableKey: "budget_category",
    tableName: "budget_category",
    restoreOrder: 11,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  {
    tableKey: "transaction_canonical",
    tableName: "transaction_canonical",
    restoreOrder: 12,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
    memberScopeFilter: (profileId) => ({ sql: "owner_person_profile_id = ?", params: [profileId] }),
    onExport: (rows) =>
      rows.map((row) => {
        const next = { ...row };
        delete next.search_document;
        return next;
      })
  },
  {
    tableKey: "account_balance_snapshot",
    tableName: "account_balance_snapshot",
    restoreOrder: 13,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
    memberScopeFilter: (profileId) => ({
      sql: "financial_account_id IN (SELECT id FROM financial_account WHERE household_id = account_balance_snapshot.household_id AND owner_person_profile_id = ?)",
      params: [profileId]
    }),
    onRestore: (row) => ({
      ...row,
      import_file_id: null
    })
  },
  {
    tableKey: "payslip_snapshot",
    tableName: "payslip_snapshot",
    restoreOrder: 14,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
    memberScopeFilter: (profileId) => ({ sql: "owner_person_profile_id = ?", params: [profileId] }),
    onRestore: (row) => ({
      ...row,
      import_file_id: null
    })
  },
  {
    tableKey: "payslip_line_item",
    tableName: "payslip_line_item",
    restoreOrder: 15,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
    memberScopeFilter: (profileId) => ({
      sql: "payslip_snapshot_id IN (SELECT id FROM payslip_snapshot WHERE household_id = payslip_line_item.household_id AND owner_person_profile_id = ?)",
      params: [profileId]
    })
  },
  // payslip_deposit_match refs both payslip_snapshot (14) and transaction_canonical (12)
  {
    tableKey: "payslip_deposit_match",
    tableName: "payslip_deposit_match",
    restoreOrder: 16,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
    memberScopeFilter: (profileId) => ({
      sql: "payslip_snapshot_id IN (SELECT id FROM payslip_snapshot WHERE household_id = payslip_deposit_match.household_id AND owner_person_profile_id = ?)",
      params: [profileId]
    })
  },
  {
    tableKey: "recurring_merchant_override",
    tableName: "recurring_merchant_override",
    restoreOrder: 17,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  {
    tableKey: "resolution_item",
    tableName: "resolution_item",
    restoreOrder: 18,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  {
    tableKey: "household_ai_insight",
    tableName: "household_ai_insight",
    restoreOrder: 19,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  {
    tableKey: "year_summary_cache",
    tableName: "year_summary_cache",
    restoreOrder: 20,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  {
    tableKey: "espp_batch",
    tableName: "espp_batch",
    restoreOrder: 21,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
  },
  {
    tableKey: "espp_sale",
    tableName: "espp_sale",
    restoreOrder: 22,
    householdIdColumn: "household_id",
    memberScopeInclude: true,
  },
  {
    tableKey: "protest_worksheet",
    tableName: "protest_worksheet",
    restoreOrder: 23,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  },
  {
    tableKey: "protest_comp_cad",
    tableName: "protest_comp_cad",
    restoreOrder: 24,
    householdIdColumn: "household_id",
    memberScopeInclude: false
  }
];

export const EXPORT_EPHEMERAL_TABLES: string[] = [
  "import_session",
  "import_file",
  "transaction_raw",
  "import_job",
  "export_job",
  "insight_job",
  "password_reset_token",
  "backup_job",
  // Infrastructure — not user data
  "schema_migrations",
  // Seeded global data — restored from seeds, not from backups
  "category_rule_global",
  // GCP service account private key — never include in .hfb backups
  "household_gdrive_config",
  // Notification rows are transient UI state — not restored from backups
  "notification",
  "notification_preference",
  "protest_document_chunks"
];
