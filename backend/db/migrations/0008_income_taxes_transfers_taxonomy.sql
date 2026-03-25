-- Income leaves + top-level Taxes/Transfers (Epic 5.3 taxonomy expansion). Idempotent.
-- Income parent must exist before child inserts: seeds run after migrations, so ensure it here too.
INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000001', NULL, NULL, 'Income', 1);

-- Income children
INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000007', NULL, '30000000-0000-0000-0000-000000000001', 'Salary', 1),
  ('30000000-0000-0000-0000-000000000011', NULL, '30000000-0000-0000-0000-000000000001', 'Interest', 1),
  ('30000000-0000-0000-0000-000000000012', NULL, '30000000-0000-0000-0000-000000000001', 'Dividends', 1),
  ('30000000-0000-0000-0000-000000000013', NULL, '30000000-0000-0000-0000-000000000001', 'Refunds', 1);

-- Re-parent existing Rental income (was under Investments -> now under Income).
UPDATE category
SET parent_id = '30000000-0000-0000-0000-000000000001'
WHERE id = '30000000-0000-0000-0000-000000000010';

-- Taxes and Transfers top-level parents
INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000111', NULL, NULL, 'Taxes', 1),
  ('30000000-0000-0000-0000-000000000112', NULL, NULL, 'Transfers', 1);

-- Taxes leaves
INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000113', NULL, '30000000-0000-0000-0000-000000000111', 'Tax payments', 1),
  ('30000000-0000-0000-0000-000000000114', NULL, '30000000-0000-0000-0000-000000000111', 'Sales tax', 1);

-- Transfers leaves
INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000115', NULL, '30000000-0000-0000-0000-000000000112', 'Transfers in', 1),
  ('30000000-0000-0000-0000-000000000116', NULL, '30000000-0000-0000-0000-000000000112', 'Transfers out', 1);

