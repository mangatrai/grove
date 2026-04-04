-- Taxonomy refresh: split Home/Utilities, rename parents, new leaves, remap FKs, remove old Utilities leaf.

PRAGMA foreign_keys = ON;

-- New top-level Utilities parent + leaves (replaces single leaf ...003).
INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000117', NULL, NULL, 'Utilities', 1),
  ('30000000-0000-0000-0000-000000000118', NULL, '30000000-0000-0000-0000-000000000117', 'Energy', 1),
  ('30000000-0000-0000-0000-000000000119', NULL, '30000000-0000-0000-0000-000000000117', 'Water trash and sewage', 1),
  ('30000000-0000-0000-0000-000000000120', NULL, '30000000-0000-0000-0000-000000000117', 'Mobile phone', 1);

-- Home leaves (under ...102).
INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000034', NULL, '30000000-0000-0000-0000-000000000102', 'Furniture', 1),
  ('30000000-0000-0000-0000-000000000035', NULL, '30000000-0000-0000-0000-000000000102', 'Maintenance and repairs', 1),
  ('30000000-0000-0000-0000-000000000036', NULL, '30000000-0000-0000-0000-000000000102', 'Home improvement', 1);

-- Borrowing leaves.
INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000121', NULL, '30000000-0000-0000-0000-000000000104', 'Loan payments', 1),
  ('30000000-0000-0000-0000-000000000122', NULL, '30000000-0000-0000-0000-000000000104', 'Personal lending', 1);

-- Education, Food, Healthcare, Investments, Mobility, Taxes.
INSERT OR IGNORE INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000123', NULL, '30000000-0000-0000-0000-000000000109', 'Activities and camps', 1),
  ('30000000-0000-0000-0000-000000000124', NULL, '30000000-0000-0000-0000-000000000107', 'Snacks', 1),
  ('30000000-0000-0000-0000-000000000125', NULL, '30000000-0000-0000-0000-000000000106', 'Wellness', 1),
  ('30000000-0000-0000-0000-000000000126', NULL, '30000000-0000-0000-0000-000000000105', '529 plan', 1),
  ('30000000-0000-0000-0000-000000000127', NULL, '30000000-0000-0000-0000-000000000105', 'Real estate', 1),
  ('30000000-0000-0000-0000-000000000128', NULL, '30000000-0000-0000-0000-000000000105', 'Crypto', 1),
  ('30000000-0000-0000-0000-000000000129', NULL, '30000000-0000-0000-0000-000000000103', 'Auto maintenance', 1),
  ('30000000-0000-0000-0000-000000000130', NULL, '30000000-0000-0000-0000-000000000111', 'State income tax', 1),
  ('30000000-0000-0000-0000-000000000131', NULL, '30000000-0000-0000-0000-000000000111', 'Federal tax refund', 1),
  ('30000000-0000-0000-0000-000000000132', NULL, '30000000-0000-0000-0000-000000000111', 'State tax refund', 1);

-- Parent renames (top-level and leaves).
UPDATE category SET name = 'Home' WHERE id = '30000000-0000-0000-0000-000000000102';
UPDATE category SET name = 'Borrowing' WHERE id = '30000000-0000-0000-0000-000000000104';
UPDATE category SET name = 'Food' WHERE id = '30000000-0000-0000-0000-000000000107';
UPDATE category SET name = 'Education' WHERE id = '30000000-0000-0000-0000-000000000109';
UPDATE category SET name = 'Giving' WHERE id = '30000000-0000-0000-0000-000000000110';
UPDATE category SET name = 'Tuition' WHERE id = '30000000-0000-0000-0000-000000000027';
UPDATE category SET name = 'Coffee' WHERE id = '30000000-0000-0000-0000-000000000024';
UPDATE category SET name = 'Fitness' WHERE id = '30000000-0000-0000-0000-000000000022';
UPDATE category SET name = 'Transit and fuel' WHERE id = '30000000-0000-0000-0000-000000000005';
UPDATE category SET name = 'Credit card payments' WHERE id = '30000000-0000-0000-0000-000000000006';
UPDATE category SET name = 'Federal income tax' WHERE id = '30000000-0000-0000-0000-000000000113';

-- Remap transactions off old Utilities leaf (best-effort by merchant/memo).
UPDATE transaction_canonical SET category_id = '30000000-0000-0000-0000-000000000120'
WHERE category_id = '30000000-0000-0000-0000-000000000003'
  AND (
    lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%verizon%'
    OR lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%at&t%'
    OR lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%at & t%'
    OR lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '% t-mobile%'
    OR lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%tmobile%'
  );

UPDATE transaction_canonical SET category_id = '30000000-0000-0000-0000-000000000119'
WHERE category_id = '30000000-0000-0000-0000-000000000003'
  AND (
    lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%water%'
    OR lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%sewer%'
    OR lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%trash%'
  );

UPDATE transaction_canonical SET category_id = '30000000-0000-0000-0000-000000000118'
WHERE category_id = '30000000-0000-0000-0000-000000000003';

-- Household rules that targeted old Utilities leaf.
UPDATE category_rule SET category_id = '30000000-0000-0000-0000-000000000118'
WHERE category_id = '30000000-0000-0000-0000-000000000003';

-- Global built-in rules: utilities → granular leaves.
UPDATE category_rule_global SET category_id = '30000000-0000-0000-0000-000000000118'
WHERE category_id = '30000000-0000-0000-0000-000000000003'
  AND rule_key IN (
    'utilities_0_electric',
    'utilities_2_utilities',
    'utilities_3_utility',
    'utilities_4_comcast',
    'utilities_8_internet',
    'utilities_10_gas_bill',
    'utilities_11_duke_energy'
  );

UPDATE category_rule_global SET category_id = '30000000-0000-0000-0000-000000000119'
WHERE category_id = '30000000-0000-0000-0000-000000000003'
  AND rule_key IN ('utilities_1_water_bill', 'utilities_9_sewer');

UPDATE category_rule_global SET category_id = '30000000-0000-0000-0000-000000000120'
WHERE category_id = '30000000-0000-0000-0000-000000000003'
  AND rule_key IN ('utilities_5_verizon', 'utilities_6_at_t', 'utilities_7_att');

-- Loan-related patterns → Loan payments (was Credit card payments bucket).
UPDATE category_rule_global SET category_id = '30000000-0000-0000-0000-000000000121'
WHERE rule_key IN (
  'debt_2_loan_pmt',
  'debt_3_loan_payment',
  'debt_4_auto_loan',
  'debt_5_student_loan',
  'debt_6_lending_club'
);

UPDATE category_rule_global SET category_id = '30000000-0000-0000-0000-000000000118'
WHERE category_id = '30000000-0000-0000-0000-000000000003';

-- Optional: split historical Fitness & wellness into Wellness when obvious.
UPDATE transaction_canonical SET category_id = '30000000-0000-0000-0000-000000000125'
WHERE category_id = '30000000-0000-0000-0000-000000000022'
  AND (
    lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%meditation%'
    OR lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%headspace%'
    OR lower(coalesce(merchant, '') || ' ' || coalesce(memo, '')) LIKE '%calm.com%'
  );

-- Remove obsolete Utilities leaf (no longer referenced).
DELETE FROM category WHERE id = '30000000-0000-0000-0000-000000000003';
