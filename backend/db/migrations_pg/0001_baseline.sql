-- PostgreSQL baseline (semantic parity with SQLite migrations/0001_baseline.sql).
-- Tables ordered for foreign keys. Full-text search: generated tsvector on transaction_canonical (no FTS5).

CREATE TABLE household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  monthly_savings_target_usd DOUBLE PRECISION,
  salary_deposit_financial_account_id TEXT,
  employers_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE app_user (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  password_hash TEXT NOT NULL,
  visibility_scope TEXT NOT NULL DEFAULT 'own',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_version INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE household
  ADD CONSTRAINT fk_household_owner FOREIGN KEY (owner_user_id) REFERENCES app_user(id);

CREATE TABLE financial_account (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  owner_user_id TEXT REFERENCES app_user(id),
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'loan', 'mortgage', 'investment', 'payslip')),
  institution TEXT NOT NULL,
  account_mask TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person')),
  owner_person_profile_id TEXT,
  default_parser_profile_id TEXT
);

ALTER TABLE household
  ADD CONSTRAINT fk_household_salary_account FOREIGN KEY (salary_deposit_financial_account_id) REFERENCES financial_account(id);

CREATE TABLE import_session (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'watch_folder')),
  status TEXT NOT NULL CHECK (status IN ('created', 'processing', 'review', 'finalized', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);

CREATE TABLE import_file (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES import_session(id),
  file_name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  parser_profile_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'parsed', 'failed')),
  confidence_summary TEXT NOT NULL DEFAULT '{}',
  stored_path TEXT,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  financial_account_id TEXT REFERENCES financial_account(id),
  employer_id TEXT,
  owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person')),
  owner_person_profile_id TEXT
);

CREATE UNIQUE INDEX uq_import_file_session_checksum ON import_file (session_id, checksum);

CREATE TABLE transaction_raw (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES import_file(id),
  row_index INTEGER NOT NULL,
  extracted_payload_json TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE category (
  id TEXT PRIMARY KEY,
  household_id TEXT REFERENCES household(id),
  parent_id TEXT REFERENCES category(id),
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);

CREATE TABLE transaction_canonical (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  account_id TEXT NOT NULL REFERENCES financial_account(id),
  user_id TEXT REFERENCES app_user(id),
  category_id TEXT REFERENCES category(id),
  txn_date TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  merchant TEXT,
  memo TEXT,
  transfer_group_id TEXT,
  fingerprint TEXT NOT NULL,
  source_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'duplicate', 'unresolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  classification_meta TEXT,
  owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person')),
  owner_person_profile_id TEXT,
  search_document tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(merchant, '') || ' ' || coalesce(memo, ''))
  ) STORED
);

CREATE UNIQUE INDEX uq_transaction_canonical_fingerprint ON transaction_canonical (household_id, fingerprint);
CREATE INDEX idx_transaction_canonical_search ON transaction_canonical USING GIN (search_document);

CREATE TABLE resolution_item (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  type TEXT NOT NULL CHECK (type IN ('unknown_category', 'duplicate_ambiguity', 'transfer_ambiguity', 'reconciliation_mismatch')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_review', 'resolved')),
  assigned_to TEXT REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE category_rule (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'prefix', 'regex')),
  category_id TEXT NOT NULL REFERENCES category(id),
  confidence REAL NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount_scope TEXT NOT NULL DEFAULT 'any' CHECK (amount_scope IN ('any', 'credit_only', 'debit_only'))
);

CREATE INDEX idx_category_rule_household_priority ON category_rule (household_id, enabled, priority, created_at);

CREATE TABLE payslip_snapshot (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  import_file_id TEXT REFERENCES import_file(id),
  employer_id TEXT,
  owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person')),
  owner_person_profile_id TEXT
);

CREATE UNIQUE INDEX uq_payslip_snapshot_household_checksum ON payslip_snapshot (household_id, file_checksum);
CREATE INDEX idx_payslip_snapshot_household_created ON payslip_snapshot (household_id, created_at DESC);
CREATE INDEX idx_payslip_snapshot_import_file ON payslip_snapshot (import_file_id);
CREATE INDEX idx_payslip_snapshot_owner_scope ON payslip_snapshot (household_id, owner_scope, owner_person_profile_id, created_at DESC);

CREATE TABLE person_profile (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  linked_user_id TEXT UNIQUE REFERENCES app_user(id),
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone_number TEXT,
  avatar_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  salary_deposit_financial_account_id TEXT,
  employers_json TEXT
);

CREATE TABLE household_membership (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  person_profile_id TEXT NOT NULL REFERENCES person_profile(id),
  role TEXT NOT NULL CHECK (role IN ('head', 'member')),
  relationship TEXT NOT NULL CHECK (relationship IN ('self', 'spouse', 'child', 'dependent', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, person_profile_id)
);

CREATE TABLE household_custom_institution (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_household_custom_institution_household_lower_name
  ON household_custom_institution (household_id, lower(display_name));
CREATE INDEX idx_household_custom_institution_household ON household_custom_institution (household_id);

CREATE TABLE category_rule_global (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL UNIQUE,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'prefix', 'regex')),
  category_id TEXT NOT NULL REFERENCES category(id),
  amount_scope TEXT NOT NULL CHECK (amount_scope IN ('any', 'credit_only', 'debit_only')),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_category_rule_global_enabled_priority ON category_rule_global (enabled, priority, created_at, id);
