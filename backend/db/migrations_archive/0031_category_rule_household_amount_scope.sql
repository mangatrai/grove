-- Household category rules: credit/debit scope (parity with category_rule_global).
ALTER TABLE category_rule ADD COLUMN amount_scope TEXT NOT NULL DEFAULT 'any'
  CHECK (amount_scope IN ('any', 'credit_only', 'debit_only'));
