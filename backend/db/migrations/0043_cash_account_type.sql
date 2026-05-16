-- 0043_cash_account_type.sql
-- F-11: Add 'cash' account type for Cash On Hand tracking.
-- Widens the type CHECK constraint to include 'cash'.

ALTER TABLE financial_account DROP CONSTRAINT financial_account_type_check;
ALTER TABLE financial_account ADD CONSTRAINT financial_account_type_check
  CHECK (type IN (
    'checking', 'savings', 'credit_card', 'loan',
    'investment', 'retirement', 'payslip', 'health', 'education', 'cash'
  ));
