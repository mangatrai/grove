-- Squashed baseline: complete Postgres schema as of v2 (migrations 0001–0039 merged).
-- Previous per-feature migration files are archived in backend/db/migrations/archive/.
--
-- Fresh install:  apply this file, then backend/db/seeds/0001_bootstrap.sql.
-- Existing DB:    schema_migrations already records '0001_baseline.sql' by filename →
--                 the migration runner skips this file; schema is unchanged.
--
-- What was deliberately dropped from the migration history:
--   • 0003 unstructured_* columns on import_file — confirmed dead (zero code references)
--   • 0013/0014/0015 category INSERT rows — already present in 0001_bootstrap.sql
--   • 0039 DROP COLUMN oauth2_access_token* — those columns were never added; pure no-op
--   • 0032 index — folded into insight_job table definition below
-- gen_random_uuid() is built-in since Postgres 13; no pgcrypto extension needed.

-- ─── Circular-FK bootstrap ────────────────────────────────────────────────────
-- household ↔ app_user and household ↔ financial_account are mutually referencing.
-- Create both sides first with the forward FK omitted, then wire with ALTER TABLE.

CREATE TABLE household (
  id                                  TEXT             PRIMARY KEY,
  name                                TEXT             NOT NULL,
  owner_user_id                       TEXT,            -- FK added below (after app_user)
  created_at                          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  monthly_savings_target_usd          DOUBLE PRECISION,
  salary_deposit_financial_account_id TEXT,            -- FK added below (after financial_account)
  employers_json                      TEXT             NOT NULL DEFAULT '[]',
  city                                TEXT,
  state                               TEXT,
  combined_gross_income_usd           DOUBLE PRECISION
);

CREATE TABLE app_user (
  id                    TEXT        PRIMARY KEY,
  household_id          TEXT        NOT NULL REFERENCES household(id),
  email                 TEXT        NOT NULL UNIQUE,
  role                  TEXT        NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  password_hash         TEXT        NOT NULL,
  visibility_scope      TEXT        NOT NULL DEFAULT 'own',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_version         INTEGER     NOT NULL DEFAULT 0,
  force_password_change BOOLEAN     NOT NULL DEFAULT false
);

ALTER TABLE household
  ADD CONSTRAINT fk_household_owner
  FOREIGN KEY (owner_user_id) REFERENCES app_user(id);

CREATE TABLE financial_account (
  id                        TEXT        PRIMARY KEY,
  household_id              TEXT        NOT NULL REFERENCES household(id),
  owner_user_id             TEXT        REFERENCES app_user(id),
  type                      TEXT        NOT NULL CHECK (type IN (
    'checking', 'savings', 'credit_card', 'loan', 'mortgage',
    'investment', 'retirement', 'payslip'
  )),
  institution               TEXT        NOT NULL,
  account_mask              TEXT,
  currency                  TEXT        NOT NULL DEFAULT 'USD',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_scope               TEXT        NOT NULL DEFAULT 'household'
                              CHECK (owner_scope IN ('household', 'person')),
  owner_person_profile_id   TEXT,
  default_parser_profile_id TEXT
);

CREATE INDEX idx_financial_account_household ON financial_account (household_id);

ALTER TABLE household
  ADD CONSTRAINT fk_household_salary_account
  FOREIGN KEY (salary_deposit_financial_account_id) REFERENCES financial_account(id);

-- ─── Import pipeline ──────────────────────────────────────────────────────────

CREATE TABLE import_session (
  id                 TEXT        PRIMARY KEY,
  household_id       TEXT        NOT NULL REFERENCES household(id),
  source_type        TEXT        NOT NULL CHECK (source_type IN ('upload', 'watch_folder')),
  status             TEXT        NOT NULL CHECK (status IN ('created', 'processing', 'review', 'finalized', 'failed')),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at       TIMESTAMPTZ,
  created_by_user_id TEXT        REFERENCES app_user(id),
  stats_json         JSONB
);

CREATE INDEX idx_import_session_household_started
  ON import_session (household_id, started_at DESC);

CREATE TABLE import_file (
  id                         TEXT        PRIMARY KEY,
  session_id                 TEXT        NOT NULL REFERENCES import_session(id),
  file_name                  TEXT        NOT NULL,
  checksum                   TEXT        NOT NULL,
  parser_profile_id          TEXT,
  status                     TEXT        NOT NULL CHECK (status IN ('queued', 'processing', 'parsed', 'failed')),
  confidence_summary         TEXT        NOT NULL DEFAULT '{}',
  stored_path                TEXT,
  file_size                  INTEGER,
  mime_type                  TEXT,
  uploaded_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  financial_account_id       TEXT        REFERENCES financial_account(id),
  employer_id                TEXT,
  owner_scope                TEXT        NOT NULL DEFAULT 'household'
                               CHECK (owner_scope IN ('household', 'person')),
  owner_person_profile_id    TEXT,
  payslip_async_provider     TEXT,
  payslip_async_last_poll_at TIMESTAMPTZ
);

COMMENT ON COLUMN import_file.payslip_async_provider
  IS 'e.g. openai_llm_payslip when queued for background LLM extract';
COMMENT ON COLUMN import_file.payslip_async_last_poll_at
  IS 'Throttle background reconcile polls (same role as former unstructured_last_poll_at for LLM path)';

CREATE UNIQUE INDEX uq_import_file_session_checksum
  ON import_file (session_id, checksum);

CREATE INDEX idx_import_file_payslip_async_pending
  ON import_file (session_id, status, payslip_async_provider)
  WHERE status = 'processing' AND payslip_async_provider IS NOT NULL;

CREATE TABLE transaction_raw (
  id                     TEXT    PRIMARY KEY,
  file_id                TEXT    NOT NULL REFERENCES import_file(id),
  row_index              INTEGER NOT NULL,
  extracted_payload_json TEXT    NOT NULL,
  confidence             REAL    NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX idx_transaction_raw_file_id ON transaction_raw (file_id);

-- ─── Category taxonomy ────────────────────────────────────────────────────────

CREATE TABLE category (
  id                 TEXT    PRIMARY KEY,
  household_id       TEXT    REFERENCES household(id),
  parent_id          TEXT    REFERENCES category(id),
  name               TEXT    NOT NULL,
  is_default         INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_by_user_id TEXT    REFERENCES app_user(id)
);

CREATE TABLE category_rule (
  id           TEXT        PRIMARY KEY,
  household_id TEXT        NOT NULL REFERENCES household(id),
  pattern      TEXT        NOT NULL,
  match_type   TEXT        NOT NULL CHECK (match_type IN ('contains', 'prefix', 'regex')),
  category_id  TEXT        NOT NULL REFERENCES category(id),
  confidence   REAL        NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  priority     INTEGER     NOT NULL DEFAULT 100,
  enabled      INTEGER     NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount_scope TEXT        NOT NULL DEFAULT 'any'
                 CHECK (amount_scope IN ('any', 'credit_only', 'debit_only'))
);

CREATE INDEX idx_category_rule_household_priority
  ON category_rule (household_id, enabled, priority, created_at);

CREATE TABLE category_rule_global (
  id           TEXT        PRIMARY KEY,
  rule_key     TEXT        NOT NULL UNIQUE,
  pattern      TEXT        NOT NULL,
  match_type   TEXT        NOT NULL CHECK (match_type IN ('contains', 'prefix', 'regex')),
  category_id  TEXT        NOT NULL REFERENCES category(id),
  amount_scope TEXT        NOT NULL CHECK (amount_scope IN ('any', 'credit_only', 'debit_only')),
  confidence   REAL        NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
  priority     INTEGER     NOT NULL DEFAULT 100,
  enabled      INTEGER     NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_category_rule_global_enabled_priority
  ON category_rule_global (enabled, priority, created_at, id);

-- ─── Ledger ───────────────────────────────────────────────────────────────────

CREATE TABLE transaction_canonical (
  id                      TEXT        PRIMARY KEY,
  household_id            TEXT        NOT NULL REFERENCES household(id),
  account_id              TEXT        NOT NULL REFERENCES financial_account(id),
  user_id                 TEXT        REFERENCES app_user(id),
  category_id             TEXT        REFERENCES category(id),
  txn_date                TEXT        NOT NULL,
  amount                  NUMERIC     NOT NULL,
  direction               TEXT        NOT NULL CHECK (direction IN ('debit', 'credit')),
  merchant                TEXT,
  memo                    TEXT,
  transfer_group_id       TEXT,
  fingerprint             TEXT        NOT NULL,
  reference_id            TEXT,
  source_ref              TEXT,
  status                  TEXT        NOT NULL CHECK (status IN (
    'pending', 'posted', 'duplicate', 'unresolved', 'trashed'
  )),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  classification_meta     TEXT,
  owner_scope             TEXT        NOT NULL DEFAULT 'household'
                            CHECK (owner_scope IN ('household', 'person')),
  owner_person_profile_id TEXT,
  search_document         tsvector    GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(merchant, '') || ' ' || coalesce(memo, ''))
  ) STORED
);

-- Partial unique: duplicate/trashed rows may share a fingerprint with the original posted row.
CREATE UNIQUE INDEX uq_transaction_canonical_fingerprint
  ON transaction_canonical (household_id, fingerprint)
  WHERE status NOT IN ('duplicate', 'trashed');

-- Partial unique: OFX/QFX/QBO FITID dedup per account; NULL rows excluded.
CREATE UNIQUE INDEX idx_canonical_acct_ref
  ON transaction_canonical (account_id, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE INDEX idx_transaction_canonical_search
  ON transaction_canonical USING GIN (search_document);

-- Performance indexes (ledger list, cash summary, budget actuals, transfer detection)
CREATE INDEX idx_tc_household_date_status
  ON transaction_canonical (household_id, txn_date DESC, status);

CREATE INDEX idx_tc_household_account_date
  ON transaction_canonical (household_id, account_id, txn_date DESC);

CREATE INDEX idx_tc_household_source_ref
  ON transaction_canonical (household_id, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE INDEX idx_tc_transfer_group
  ON transaction_canonical (household_id, transfer_group_id)
  WHERE transfer_group_id IS NOT NULL;

CREATE TABLE resolution_item (
  id           TEXT        PRIMARY KEY,
  household_id TEXT        NOT NULL REFERENCES household(id),
  type         TEXT        NOT NULL CHECK (type IN (
    'unknown_category', 'duplicate_ambiguity', 'transfer_ambiguity', 'reconciliation_mismatch'
  )),
  target_id    TEXT        NOT NULL,
  reason       TEXT        NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('open', 'in_review', 'resolved')),
  assigned_to  TEXT        REFERENCES app_user(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ri_household_status_type ON resolution_item (household_id, status, type);
CREATE INDEX idx_ri_household_target      ON resolution_item (household_id, target_id);

-- ─── Payslips ─────────────────────────────────────────────────────────────────

CREATE TABLE payslip_snapshot (
  id                          TEXT        PRIMARY KEY,
  household_id                TEXT        NOT NULL REFERENCES household(id),
  file_name                   TEXT        NOT NULL,
  file_checksum               TEXT        NOT NULL,
  parser_profile_id           TEXT        NOT NULL,
  pay_period_start            TEXT,
  pay_period_end              TEXT,
  pay_date                    TEXT,
  gross_pay_current           NUMERIC,
  gross_pay_ytd               NUMERIC,
  employee_taxes_current      NUMERIC,
  employee_taxes_ytd          NUMERIC,
  pre_tax_deductions_current  NUMERIC,
  pre_tax_deductions_ytd      NUMERIC,
  post_tax_deductions_current NUMERIC,
  post_tax_deductions_ytd     NUMERIC,
  net_pay_current             NUMERIC,
  net_pay_ytd                 NUMERIC,
  hours_or_days_current       TEXT,
  raw_extract_json            TEXT        NOT NULL DEFAULT '{}',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  import_file_id              TEXT        REFERENCES import_file(id),
  employer_id                 TEXT,
  owner_scope                 TEXT        NOT NULL DEFAULT 'household'
                                CHECK (owner_scope IN ('household', 'person')),
  owner_person_profile_id     TEXT,
  -- LLM async extraction fields
  canonical_extract_json      TEXT        NOT NULL DEFAULT '{}',
  currency                    TEXT,
  employer_display_name       TEXT,
  employee_display_name       TEXT,
  employer_ein_or_fein        TEXT,
  employee_id                 TEXT,
  personnel_number            TEXT,
  talent_id                   TEXT,
  tax_profile_json            TEXT,
  payment_summary_json        TEXT,
  extraction_metadata_json    TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Rich line-item extraction fields
  taxable_earnings_current    NUMERIC,
  taxable_earnings_ytd        NUMERIC,
  other_information_current   NUMERIC,
  other_information_ytd       NUMERIC,
  hours_or_days_ytd           TEXT,
  employment_rate             NUMERIC,
  employment_rate_type        TEXT
);

COMMENT ON COLUMN payslip_snapshot.canonical_extract_json
  IS 'Full validated LLM payslip JSON (PayslipLlmExtract) when parser uses LLM path';
COMMENT ON COLUMN payslip_snapshot.extraction_metadata_json
  IS 'Subset: page_count, parser_source, extraction_model, extracted_at';
COMMENT ON COLUMN payslip_snapshot.taxable_earnings_current
  IS 'Taxable earnings section total — current period (e.g. IBM or Deloitte TAXABLE EARNINGS FED)';
COMMENT ON COLUMN payslip_snapshot.taxable_earnings_ytd
  IS 'Taxable earnings section total — YTD';
COMMENT ON COLUMN payslip_snapshot.other_information_current
  IS 'Other Information section total — current (employer HSA, ESPP Discount, imputed income, etc.)';
COMMENT ON COLUMN payslip_snapshot.other_information_ytd
  IS 'Other Information section total — YTD';
COMMENT ON COLUMN payslip_snapshot.hours_or_days_ytd
  IS 'YTD hours or days worked; TEXT to match hours_or_days_current type';
COMMENT ON COLUMN payslip_snapshot.employment_rate
  IS 'Base salary or hourly rate from employment_context.rate';
COMMENT ON COLUMN payslip_snapshot.employment_rate_type
  IS 'Rate type: annual, biweekly, hourly, etc.';

CREATE UNIQUE INDEX uq_payslip_snapshot_household_checksum
  ON payslip_snapshot (household_id, file_checksum);
CREATE INDEX idx_payslip_snapshot_household_created
  ON payslip_snapshot (household_id, created_at DESC);
CREATE INDEX idx_payslip_snapshot_import_file
  ON payslip_snapshot (import_file_id);
CREATE INDEX idx_payslip_snapshot_owner_scope
  ON payslip_snapshot (household_id, owner_scope, owner_person_profile_id, created_at DESC);

CREATE TABLE payslip_line_item (
  id                    TEXT        NOT NULL PRIMARY KEY,
  payslip_snapshot_id   TEXT        NOT NULL REFERENCES payslip_snapshot(id) ON DELETE CASCADE,
  household_id          TEXT        NOT NULL REFERENCES household(id),
  section               TEXT        NOT NULL CHECK (section IN (
    'earnings', 'pre_tax_deductions', 'post_tax_deductions',
    'tax_deductions', 'other_deductions', 'other_information', 'taxable_earnings'
  )),
  sort_order            INTEGER     NOT NULL DEFAULT 0,
  name                  TEXT,
  authority             TEXT,
  description           TEXT,
  date_start            TEXT,
  date_end              TEXT,
  date_raw              TEXT,
  hours_or_days_current NUMERIC,
  hours_or_days_ytd     NUMERIC,
  rate                  NUMERIC,
  amount_current        NUMERIC,
  amount_ytd            NUMERIC,
  raw_section           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  payslip_line_item
  IS 'Individual line-item rows from payslip sections (earnings, deductions, taxes, etc.)';
COMMENT ON COLUMN payslip_line_item.section
  IS 'Canonical section name — one of the 7 line_items keys in PayslipLlmExtract';
COMMENT ON COLUMN payslip_line_item.sort_order
  IS 'Original array index in the LLM extract — preserves PDF row order for UI display';
COMMENT ON COLUMN payslip_line_item.raw_section
  IS 'Visible section header from the PDF (e.g. "PRE-TAX DEDUCTION(S)") for display and debugging';

CREATE INDEX idx_payslip_line_item_snapshot
  ON payslip_line_item (payslip_snapshot_id, section, sort_order);
CREATE INDEX idx_payslip_line_item_household
  ON payslip_line_item (household_id, section);

-- ─── Household members & institutions ────────────────────────────────────────

CREATE TABLE person_profile (
  id                                  TEXT             PRIMARY KEY,
  household_id                        TEXT             NOT NULL REFERENCES household(id),
  linked_user_id                      TEXT             UNIQUE REFERENCES app_user(id),
  full_name                           TEXT             NOT NULL DEFAULT '',
  email                               TEXT,
  phone_number                        TEXT,
  avatar_key                          TEXT,
  created_at                          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  salary_deposit_financial_account_id TEXT,
  employers_json                      TEXT,
  -- AI health profile fields
  age                                 INTEGER          CHECK (age IS NULL OR (age > 0 AND age < 130)),
  sex                                 TEXT             CHECK (sex IS NULL OR sex IN (
    'male', 'female', 'nonbinary', 'prefer_not_to_say'
  )),
  individual_gross_income_usd         DOUBLE PRECISION,
  risk_tolerance                      TEXT             CHECK (risk_tolerance IS NULL OR risk_tolerance IN (
    'conservative', 'moderate', 'aggressive'
  )),
  financial_goals_json                TEXT             NOT NULL DEFAULT '[]'
);

CREATE TABLE household_membership (
  id                TEXT        PRIMARY KEY,
  household_id      TEXT        NOT NULL REFERENCES household(id),
  person_profile_id TEXT        NOT NULL REFERENCES person_profile(id),
  role              TEXT        NOT NULL CHECK (role IN ('head', 'member')),
  relationship      TEXT        NOT NULL CHECK (relationship IN (
    'self', 'spouse', 'child', 'dependent', 'other'
  )),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, person_profile_id)
);

CREATE TABLE household_custom_institution (
  id                 TEXT        PRIMARY KEY NOT NULL,
  household_id       TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  display_name       TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id TEXT        REFERENCES app_user(id)
);

CREATE UNIQUE INDEX uq_household_custom_institution_household_lower_name
  ON household_custom_institution (household_id, lower(display_name));
CREATE INDEX idx_household_custom_institution_household
  ON household_custom_institution (household_id);

-- ─── Export / Import jobs ─────────────────────────────────────────────────────

CREATE TABLE export_job (
  id                   TEXT        PRIMARY KEY,
  household_id         TEXT        NOT NULL REFERENCES household(id),
  requested_by_user_id TEXT        NOT NULL REFERENCES app_user(id),
  status               TEXT        NOT NULL CHECK (status IN (
    'queued', 'running', 'complete', 'failed', 'expired'
  )),
  storage_path         TEXT,
  error_text           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,
  person_profile_id    TEXT        REFERENCES person_profile(id)
);

CREATE INDEX idx_export_job_household_created
  ON export_job (household_id, created_at DESC);

CREATE TABLE import_job (
  id                   TEXT        PRIMARY KEY,
  household_id         TEXT        NOT NULL REFERENCES household(id),
  requested_by_user_id TEXT        NOT NULL REFERENCES app_user(id),
  status               TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  storage_path         TEXT,
  error_text           TEXT,
  stats_json           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX idx_import_job_household_created
  ON import_job (household_id, created_at DESC);

-- ─── Balance sheet ────────────────────────────────────────────────────────────

CREATE TABLE account_balance_snapshot (
  id                   TEXT        PRIMARY KEY,
  household_id         TEXT        NOT NULL REFERENCES household(id),
  financial_account_id TEXT        NOT NULL REFERENCES financial_account(id),
  as_of_date           DATE        NOT NULL,
  amount               NUMERIC     NOT NULL,
  currency             TEXT        NOT NULL DEFAULT 'USD',
  source               TEXT        NOT NULL CHECK (source IN ('manual', 'import')),
  import_file_id       TEXT        REFERENCES import_file(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_balance_snapshot_household
  ON account_balance_snapshot (household_id);
CREATE UNIQUE INDEX uq_account_balance_manual_per_account_date
  ON account_balance_snapshot (financial_account_id, as_of_date)
  WHERE source = 'manual';
CREATE UNIQUE INDEX uq_account_balance_import_per_account_date
  ON account_balance_snapshot (financial_account_id, as_of_date)
  WHERE source = 'import';
CREATE INDEX idx_abs_household_account_date
  ON account_balance_snapshot (household_id, financial_account_id, as_of_date DESC);

-- ─── Budgets ──────────────────────────────────────────────────────────────────

CREATE TABLE budget_category (
  id           TEXT          PRIMARY KEY,
  household_id TEXT          NOT NULL REFERENCES household(id),
  category_id  TEXT          NOT NULL REFERENCES category(id),
  month        TEXT          NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, category_id, month)
);

CREATE INDEX idx_budget_category_household_month
  ON budget_category (household_id, month);

-- ─── Recurring merchants ──────────────────────────────────────────────────────

CREATE TABLE recurring_merchant_override (
  id                   TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id         TEXT          NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  merchant_key         TEXT          NOT NULL,
  display_name         TEXT,
  verdict              TEXT          NOT NULL CHECK (verdict IN ('confirmed', 'dismissed')),
  amount_anchor        NUMERIC(12,2),
  amount_tolerance_pct NUMERIC(5,2)  NOT NULL DEFAULT 15.00,
  tagged_by_user_id    TEXT          REFERENCES app_user(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, merchant_key)
);

-- ─── AI financial health ──────────────────────────────────────────────────────

CREATE TABLE household_ai_insight (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id   TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  scope          TEXT        NOT NULL CHECK (scope IN ('household', 'personal')),
  user_id        TEXT        REFERENCES app_user(id) ON DELETE SET NULL,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider       TEXT        NOT NULL,
  model          TEXT        NOT NULL,
  prompt_version TEXT        NOT NULL,
  payload_json   JSONB       NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_household_ai_insight_lookup
  ON household_ai_insight (household_id, scope, user_id, generated_at DESC);

CREATE TABLE insight_job (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id         TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  requested_by_user_id TEXT        REFERENCES app_user(id) ON DELETE SET NULL,
  scope                TEXT        NOT NULL CHECK (scope IN ('household', 'personal')),
  target_user_id       TEXT        REFERENCES app_user(id) ON DELETE SET NULL,
  status               TEXT        NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  error_text           TEXT,
  insight_id           TEXT        REFERENCES household_ai_insight(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX idx_insight_job_household_id ON insight_job (household_id);

-- ─── Auth / security ──────────────────────────────────────────────────────────

CREATE TABLE password_reset_token (
  id         TEXT        PRIMARY KEY,
  user_id    TEXT        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prt_user ON password_reset_token (user_id);

-- ─── Google Drive backup ──────────────────────────────────────────────────────

CREATE TABLE household_gdrive_config (
  household_id             TEXT        PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  folder_id                TEXT        NOT NULL,
  folder_name              TEXT,
  connected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_by_user_id     TEXT        REFERENCES app_user(id) ON DELETE SET NULL,
  last_verified_at         TIMESTAMPTZ,
  last_error               TEXT,
  backup_frequency_hours   INT         NOT NULL DEFAULT 24,
  backup_retention_count   INT         NOT NULL DEFAULT 7,
  last_scheduled_backup_at TIMESTAMPTZ,
  oauth2_refresh_token     TEXT
);

CREATE TABLE backup_job (
  id                   TEXT        PRIMARY KEY,
  household_id         TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  status               TEXT        NOT NULL DEFAULT 'queued',
  drive_file_id        TEXT,
  drive_file_name      TEXT,
  size_bytes           INTEGER,
  error_text           TEXT,
  triggered_by_user_id TEXT        REFERENCES app_user(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX backup_job_household_created
  ON backup_job (household_id, created_at DESC);
