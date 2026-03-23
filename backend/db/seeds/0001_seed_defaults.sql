INSERT INTO household (id, name, created_at)
VALUES ('10000000-0000-0000-0000-000000000001', 'Default Household', NOW());

INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, created_at)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'owner@example.com',
    'owner',
    '$2a$10$8fZGtw5FhyyMTOx2qNhA9umW6h6jb4NwwBqYXBrQ2XbS2J4Jr9NHG',
    'all',
    NOW()
  );

UPDATE household
SET owner_user_id = '20000000-0000-0000-0000-000000000001'
WHERE id = '10000000-0000-0000-0000-000000000001';

INSERT INTO category (id, household_id, parent_id, name, is_default)
VALUES
  ('30000000-0000-0000-0000-000000000001', NULL, NULL, 'Income', TRUE),
  ('30000000-0000-0000-0000-000000000002', NULL, NULL, 'Housing', TRUE),
  ('30000000-0000-0000-0000-000000000003', NULL, NULL, 'Utilities', TRUE),
  ('30000000-0000-0000-0000-000000000004', NULL, NULL, 'Groceries', TRUE),
  ('30000000-0000-0000-0000-000000000005', NULL, NULL, 'Transport', TRUE),
  ('30000000-0000-0000-0000-000000000006', NULL, NULL, 'Debt Payments', TRUE);
