-- Income / payslip onboarding (household): optional salary deposit account + employer stubs (JSON).
PRAGMA foreign_keys = ON;

ALTER TABLE household ADD COLUMN salary_deposit_financial_account_id TEXT REFERENCES financial_account(id);
ALTER TABLE household ADD COLUMN employers_json TEXT NOT NULL DEFAULT '[]';
