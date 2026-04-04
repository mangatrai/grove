-- Baseline schema: squashed from migrations 0001_init through 0032_category_taxonomy_entertainment_banking.
-- Apply on a fresh SQLite file via scripts/db.mjs (see docs/RUNBOOK.md).
-- Existing databases that already recorded the old migration filenames must reset or use a new DB file.

PRAGMA foreign_keys = ON;

CREATE TABLE household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, monthly_savings_target_usd REAL NULL, salary_deposit_financial_account_id TEXT REFERENCES financial_account(id), employers_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (owner_user_id) REFERENCES app_user(id)
);
CREATE TABLE app_user (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  password_hash TEXT NOT NULL,
  visibility_scope TEXT NOT NULL DEFAULT 'own',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, token_version INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (household_id) REFERENCES household(id)
);
CREATE TABLE import_session (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'watch_folder')),
  status TEXT NOT NULL CHECK (status IN ('created', 'processing', 'review', 'finalized', 'failed')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT,
  FOREIGN KEY (household_id) REFERENCES household(id)
);
CREATE TABLE import_file (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  parser_profile_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'parsed', 'failed')),
  confidence_summary TEXT NOT NULL DEFAULT '{}', stored_path TEXT, file_size INTEGER, mime_type TEXT, uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, financial_account_id TEXT REFERENCES financial_account(id), employer_id TEXT, owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person')), owner_person_profile_id TEXT,
  FOREIGN KEY (session_id) REFERENCES import_session(id)
);
CREATE TABLE transaction_raw (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  extracted_payload_json TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  FOREIGN KEY (file_id) REFERENCES import_file(id)
);
CREATE TABLE category (
  id TEXT PRIMARY KEY,
  household_id TEXT,
  parent_id TEXT,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (parent_id) REFERENCES category(id)
);
CREATE TABLE transaction_canonical (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  user_id TEXT,
  category_id TEXT,
  txn_date TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  merchant TEXT,
  memo TEXT,
  transfer_group_id TEXT,
  fingerprint TEXT NOT NULL,
  source_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'duplicate', 'unresolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, classification_meta TEXT, owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person')), owner_person_profile_id TEXT,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (account_id) REFERENCES financial_account(id),
  FOREIGN KEY (user_id) REFERENCES app_user(id),
  FOREIGN KEY (category_id) REFERENCES category(id)
);
CREATE UNIQUE INDEX uq_transaction_canonical_fingerprint
  ON transaction_canonical (household_id, fingerprint);
CREATE TABLE resolution_item (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('unknown_category', 'duplicate_ambiguity', 'transfer_ambiguity', 'reconciliation_mismatch')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_review', 'resolved')),
  assigned_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (assigned_to) REFERENCES app_user(id)
);
CREATE UNIQUE INDEX uq_import_file_session_checksum
  ON import_file (session_id, checksum);
CREATE TABLE category_rule (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'prefix', 'regex')),
  category_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, amount_scope TEXT NOT NULL DEFAULT 'any'
  CHECK (amount_scope IN ('any', 'credit_only', 'debit_only')),
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (category_id) REFERENCES category(id)
);
CREATE INDEX idx_category_rule_household_priority
  ON category_rule (household_id, enabled, priority, created_at);
CREATE VIRTUAL TABLE ledger_search_fts USING fts5(
  body,
  tokenize = 'porter unicode61'
)
/* ledger_search_fts(body) */;
CREATE TRIGGER tr_transaction_canonical_ai_ledger_search_fts
AFTER INSERT ON transaction_canonical
BEGIN
  INSERT INTO ledger_search_fts(rowid, body) VALUES (
    NEW.rowid,
    coalesce(NEW.merchant, '') || ' ' || coalesce(NEW.memo, '')
  );
END;
CREATE TABLE payslip_snapshot (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_checksum TEXT NOT NULL,
  parser_profile_id TEXT NOT NULL,
  pay_period_start TEXT,
  pay_period_end TEXT,
  pay_date TEXT,
  gross_pay_current NUMERIC,
  gross_pay_ytd NUMERIC,
  employee_taxes_current NUMERIC,
  employee_taxes_ytd NUMERIC,
  pre_tax_deductions_current NUMERIC,
  pre_tax_deductions_ytd NUMERIC,
  post_tax_deductions_current NUMERIC,
  post_tax_deductions_ytd NUMERIC,
  net_pay_current NUMERIC,
  net_pay_ytd NUMERIC,
  hours_or_days_current TEXT,
  raw_extract_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, import_file_id TEXT REFERENCES import_file(id), employer_id TEXT, owner_scope TEXT NOT NULL DEFAULT 'household'
  CHECK (owner_scope IN ('household','person')), owner_person_profile_id TEXT NULL,
  FOREIGN KEY (household_id) REFERENCES household(id)
);
CREATE UNIQUE INDEX uq_payslip_snapshot_household_checksum
  ON payslip_snapshot (household_id, file_checksum);
CREATE INDEX idx_payslip_snapshot_household_created
  ON payslip_snapshot (household_id, created_at DESC);
CREATE TRIGGER tr_transaction_canonical_au_ledger_search_fts
AFTER UPDATE OF merchant, memo ON transaction_canonical
BEGIN
  DELETE FROM ledger_search_fts WHERE rowid = OLD.rowid;
  INSERT INTO ledger_search_fts(rowid, body) VALUES (
    NEW.rowid,
    coalesce(NEW.merchant, '') || ' ' || coalesce(NEW.memo, '')
  );
END;
CREATE TRIGGER tr_transaction_canonical_ad_ledger_search_fts
AFTER DELETE ON transaction_canonical
BEGIN
  DELETE FROM ledger_search_fts WHERE rowid = OLD.rowid;
END;
CREATE INDEX idx_payslip_snapshot_import_file
  ON payslip_snapshot(import_file_id);
CREATE TABLE IF NOT EXISTS "financial_account" (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  owner_user_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'loan', 'mortgage', 'investment', 'payslip')),
  institution TEXT NOT NULL,
  account_mask TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person')), owner_person_profile_id TEXT, default_parser_profile_id TEXT,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (owner_user_id) REFERENCES app_user(id)
);
CREATE TABLE person_profile (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  linked_user_id TEXT UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone_number TEXT,
  avatar_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, salary_deposit_financial_account_id TEXT, employers_json TEXT,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (linked_user_id) REFERENCES app_user(id)
);
CREATE TABLE household_membership (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  person_profile_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('head', 'member')),
  relationship TEXT NOT NULL CHECK (
    relationship IN ('self', 'spouse', 'child', 'dependent', 'other')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (person_profile_id) REFERENCES person_profile(id),
  UNIQUE (household_id, person_profile_id)
);
CREATE TABLE household_custom_institution (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_household_custom_institution_household_lower_name
  ON household_custom_institution(household_id, lower(display_name));
CREATE INDEX idx_household_custom_institution_household
  ON household_custom_institution(household_id);
CREATE INDEX idx_payslip_snapshot_owner_scope
  ON payslip_snapshot (household_id, owner_scope, owner_person_profile_id, created_at DESC);
CREATE TABLE category_rule_global (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL UNIQUE,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'prefix', 'regex')),
  category_id TEXT NOT NULL,
  amount_scope TEXT NOT NULL CHECK (amount_scope IN ('any', 'credit_only', 'debit_only')),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES category(id)
);
CREATE INDEX idx_category_rule_global_enabled_priority
  ON category_rule_global (enabled, priority, datetime(created_at), id);
