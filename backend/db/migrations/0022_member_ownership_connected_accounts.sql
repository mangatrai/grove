PRAGMA foreign_keys = ON;

ALTER TABLE financial_account ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person'));
ALTER TABLE financial_account ADD COLUMN owner_person_profile_id TEXT;
ALTER TABLE financial_account ADD COLUMN default_parser_profile_id TEXT;

ALTER TABLE import_file ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person'));
ALTER TABLE import_file ADD COLUMN owner_person_profile_id TEXT;

ALTER TABLE transaction_canonical ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'household' CHECK (owner_scope IN ('household', 'person'));
ALTER TABLE transaction_canonical ADD COLUMN owner_person_profile_id TEXT;
