-- SQLite mirror of PG 0005_account_balance_snapshot.sql (local / test tooling).
CREATE TABLE IF NOT EXISTS account_balance_snapshot (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  financial_account_id TEXT NOT NULL REFERENCES financial_account(id),
  as_of_date TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL CHECK (source IN ('manual', 'import')),
  import_file_id TEXT REFERENCES import_file(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_account_balance_snapshot_household ON account_balance_snapshot (household_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_balance_manual_per_account_date
  ON account_balance_snapshot (financial_account_id, as_of_date)
  WHERE source = 'manual';
