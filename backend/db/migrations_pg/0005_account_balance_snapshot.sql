-- Manual and (future) import-linked balance snapshots for net-worth / balance sheet v1.
CREATE TABLE account_balance_snapshot (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  financial_account_id TEXT NOT NULL REFERENCES financial_account(id),
  as_of_date DATE NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL CHECK (source IN ('manual', 'import')),
  import_file_id TEXT REFERENCES import_file(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_balance_snapshot_household ON account_balance_snapshot (household_id);

CREATE UNIQUE INDEX uq_account_balance_manual_per_account_date
  ON account_balance_snapshot (financial_account_id, as_of_date)
  WHERE source = 'manual';
