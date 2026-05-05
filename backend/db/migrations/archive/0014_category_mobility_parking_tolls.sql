-- Global default category: Mobility > Parking & Tolls
-- Uses INSERT ... SELECT so the FK on parent_id is satisfied only when the parent already exists.
-- On a fresh database the bootstrap seed (0001_bootstrap.sql) inserts the full taxonomy after
-- migrations run, so this migration is intentionally a no-op there.
INSERT INTO category (id, household_id, parent_id, name, is_default)
SELECT
  '30000000-0000-0000-0000-000000000166',
  NULL,
  '30000000-0000-0000-0000-000000000103',
  'Parking & Tolls',
  1
WHERE EXISTS (
  SELECT 1 FROM category WHERE id = '30000000-0000-0000-0000-000000000103'
)
ON CONFLICT (id) DO NOTHING;
