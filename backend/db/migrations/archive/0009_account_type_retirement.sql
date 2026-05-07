-- CR-075: Add 'retirement' as a first-class account type.
-- 401K, IRA, pension accounts are distinct from generic 'investment' accounts.

ALTER TABLE financial_account
  DROP CONSTRAINT financial_account_type_check,
  ADD CONSTRAINT financial_account_type_check
    CHECK (type IN ('checking','savings','credit_card','loan','mortgage','investment','retirement','payslip'));
