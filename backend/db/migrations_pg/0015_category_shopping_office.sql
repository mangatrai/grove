-- Global default category: Shopping > Office
INSERT INTO category (id, household_id, parent_id, name, is_default)
VALUES (
  '30000000-0000-0000-0000-000000000167',
  NULL,
  '30000000-0000-0000-0000-000000000101',
  'Office',
  1
)
ON CONFLICT (id) DO NOTHING;
