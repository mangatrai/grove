-- 0095_category_transfers_cash_deposit.sql
-- GH #294: new global default category Transfers > Cash deposit — the inflow counterpart
-- to Transfers > Cash withdrawal (...163), used for the auto-created Wallet-side leg when a
-- checking-account transaction is categorized as Cash withdrawal.
-- Uses INSERT ... SELECT so the FK on parent_id is satisfied only when the parent already exists.
-- On a fresh database the bootstrap seed (0001_bootstrap.sql) inserts the full taxonomy after
-- migrations run, so this migration is intentionally a no-op there.
INSERT INTO category (id, household_id, parent_id, name, is_default)
SELECT
  '30000000-0000-0000-0000-000000000170',
  NULL,
  '30000000-0000-0000-0000-000000000112',
  'Cash deposit',
  1
WHERE EXISTS (
  SELECT 1 FROM category WHERE id = '30000000-0000-0000-0000-000000000112'
)
ON CONFLICT (id) DO NOTHING;
