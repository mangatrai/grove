-- Add `payslip` as a financial_account type for import binding (non-ledger “bucket”; IBM stub v1).
-- Recreate table so CHECK constraint can include the new value (SQLite).

PRAGMA foreign_keys = OFF;

CREATE TABLE financial_account__new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  owner_user_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'loan', 'mortgage', 'investment', 'payslip')),
  institution TEXT NOT NULL,
  account_mask TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (owner_user_id) REFERENCES app_user(id)
);

INSERT INTO financial_account__new SELECT * FROM financial_account;

DROP TABLE financial_account;

ALTER TABLE financial_account__new RENAME TO financial_account;

PRAGMA foreign_keys = ON;
