-- Option B hook: household-scoped category rows for the default household only.
-- Global taxonomy (Loans, Travel, Investments, Utilities, etc.) lives in 0001_seed_defaults.sql
-- with household_id NULL and stable UUIDs — no duplicate parents needed here for current product.
-- Future: INSERT deterministic household_id rows for this household when a feature needs
-- install-wide custom groups that must not be global.

SELECT 1 WHERE 0 = 1;
