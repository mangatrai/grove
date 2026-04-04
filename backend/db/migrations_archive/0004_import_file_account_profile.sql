-- Per-file target account (Epic 2.3). `parser_profile_id` already exists on import_file from schema v1.
ALTER TABLE import_file ADD COLUMN financial_account_id TEXT REFERENCES financial_account(id);
