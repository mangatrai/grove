-- Insurance parent rename + additional default leaves (Epic: rules-first taxonomy).

UPDATE category
SET name = 'Insurance'
WHERE id = '30000000-0000-0000-0000-000000000108'
  AND name = 'Insurance & protection';

INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000031', NULL, '30000000-0000-0000-0000-000000000108', 'Health insurance', 1),
  ('30000000-0000-0000-0000-000000000032', NULL, '30000000-0000-0000-0000-000000000108', 'Life insurance', 1),
  ('30000000-0000-0000-0000-000000000033', NULL, '30000000-0000-0000-0000-000000000108', 'Other insurance', 1);
