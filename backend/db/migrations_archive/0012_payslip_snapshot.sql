-- Epic 3.3a: payslip snapshot (IBM-style summary block); not merged into transaction_canonical.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payslip_snapshot (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_checksum TEXT NOT NULL,
  parser_profile_id TEXT NOT NULL,
  pay_period_start TEXT,
  pay_period_end TEXT,
  pay_date TEXT,
  gross_pay_current NUMERIC,
  gross_pay_ytd NUMERIC,
  employee_taxes_current NUMERIC,
  employee_taxes_ytd NUMERIC,
  pre_tax_deductions_current NUMERIC,
  pre_tax_deductions_ytd NUMERIC,
  post_tax_deductions_current NUMERIC,
  post_tax_deductions_ytd NUMERIC,
  net_pay_current NUMERIC,
  net_pay_ytd NUMERIC,
  hours_or_days_current TEXT,
  raw_extract_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES household(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payslip_snapshot_household_checksum
  ON payslip_snapshot (household_id, file_checksum);

CREATE INDEX IF NOT EXISTS idx_payslip_snapshot_household_created
  ON payslip_snapshot (household_id, created_at DESC);
