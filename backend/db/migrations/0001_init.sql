PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES app_user(id)
);

CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  password_hash TEXT NOT NULL,
  visibility_scope TEXT NOT NULL DEFAULT 'own',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id)
);

CREATE TABLE IF NOT EXISTS financial_account (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  owner_user_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'loan', 'mortgage', 'investment')),
  institution TEXT NOT NULL,
  account_mask TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (owner_user_id) REFERENCES app_user(id)
);

CREATE TABLE IF NOT EXISTS import_session (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'watch_folder')),
  status TEXT NOT NULL CHECK (status IN ('created', 'processing', 'review', 'finalized', 'failed')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT,
  FOREIGN KEY (household_id) REFERENCES household(id)
);

CREATE TABLE IF NOT EXISTS import_file (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  parser_profile_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'parsed', 'failed')),
  confidence_summary TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (session_id) REFERENCES import_session(id)
);

CREATE TABLE IF NOT EXISTS transaction_raw (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  extracted_payload_json TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  FOREIGN KEY (file_id) REFERENCES import_file(id)
);

CREATE TABLE IF NOT EXISTS category (
  id TEXT PRIMARY KEY,
  household_id TEXT,
  parent_id TEXT,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (parent_id) REFERENCES category(id)
);

CREATE TABLE IF NOT EXISTS transaction_canonical (
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (account_id) REFERENCES financial_account(id),
  FOREIGN KEY (user_id) REFERENCES app_user(id),
  FOREIGN KEY (category_id) REFERENCES category(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_canonical_fingerprint
  ON transaction_canonical (household_id, fingerprint);

CREATE TABLE IF NOT EXISTS resolution_item (
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
