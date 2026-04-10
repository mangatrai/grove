-- SQLite mirror of PG 0006_account_balance_import_unique.sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_balance_import_per_account_date
  ON account_balance_snapshot (financial_account_id, as_of_date)
  WHERE source = 'import';
