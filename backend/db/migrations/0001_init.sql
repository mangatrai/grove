CREATE TABLE household (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_user (
  id UUID PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES household(id),
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  password_hash TEXT NOT NULL,
  visibility_scope TEXT NOT NULL DEFAULT 'own',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE household
ADD CONSTRAINT household_owner_fk FOREIGN KEY (owner_user_id) REFERENCES app_user(id);

CREATE TABLE financial_account (
  id UUID PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES household(id),
  owner_user_id UUID REFERENCES app_user(id),
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'loan', 'mortgage', 'investment')),
  institution TEXT NOT NULL,
  account_mask TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE import_session (
  id UUID PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES household(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'watch_folder')),
  status TEXT NOT NULL CHECK (status IN ('created', 'processing', 'review', 'finalized', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);

CREATE TABLE import_file (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES import_session(id),
  file_name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  parser_profile_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'parsed', 'failed')),
  confidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE transaction_raw (
  id UUID PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES import_file(id),
  row_index INT NOT NULL,
  extracted_payload_json JSONB NOT NULL,
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE category (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES household(id),
  parent_id UUID REFERENCES category(id),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE transaction_canonical (
  id UUID PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES household(id),
  account_id UUID NOT NULL REFERENCES financial_account(id),
  user_id UUID REFERENCES app_user(id),
  category_id UUID REFERENCES category(id),
  txn_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  merchant TEXT,
  memo TEXT,
  transfer_group_id UUID,
  fingerprint TEXT NOT NULL,
  source_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'duplicate', 'unresolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_transaction_canonical_fingerprint
ON transaction_canonical(household_id, fingerprint);

CREATE TABLE resolution_item (
  id UUID PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES household(id),
  type TEXT NOT NULL CHECK (type IN ('unknown_category', 'duplicate_ambiguity', 'transfer_ambiguity', 'reconciliation_mismatch')),
  target_id UUID NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_review', 'resolved')),
  assigned_to UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
