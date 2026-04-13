-- Global default category: Shopping > Software (subscriptions, SaaS, AI tools, etc.)
INSERT INTO category (id, household_id, parent_id, name, is_default)
VALUES (
  '30000000-0000-0000-0000-000000000165',
  NULL,
  '30000000-0000-0000-0000-000000000101',
  'Software',
  1
)
ON CONFLICT (id) DO NOTHING;
