-- Bootstrap seed: default household, owner, global category taxonomy, and built-in `category_rule_global` rows.
-- Merged former `0001_seed_defaults.sql` + `0002_seed_category_rule_global.sql` (single `schema_seeds` file for new installs).
-- Stable UUIDs align with historical migrations (Income/Taxes/Transfers, insurance, utilities, taxonomy expansions).
-- New installs: run migrations first, then `--seed` (`ON CONFLICT DO NOTHING` on seed rows). Re-seed: `db:cleanup` + `db:seed` when appropriate.

INSERT INTO household (id, name, created_at)
VALUES ('10000000-0000-0000-0000-000000000001', 'Default Household', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;

-- Default password: ChangeMe123! — force_password_change=true ensures the owner is prompted to change it on first login.
-- IMPORTANT: change this password before exposing the instance to the internet.
INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, force_password_change, created_at)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'owner@example.com',
    'owner',
    '$2a$10$Tg2KSaLf8qB4az.7LdyCvuQclHikol6qgE2ZWMJt5/chBWCfMO6eO',
    'all',
    true,
    CURRENT_TIMESTAMP
  ) ON CONFLICT DO NOTHING;

UPDATE household
SET owner_user_id = '20000000-0000-0000-0000-000000000001'
WHERE id = '10000000-0000-0000-0000-000000000001';

-- Top-level parents (roll-up groups only; no parent_id)
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000001', NULL, NULL, 'Income', 1),
  ('30000000-0000-0000-0000-000000000101', NULL, NULL, 'Shopping', 1),
  ('30000000-0000-0000-0000-000000000102', NULL, NULL, 'Home', 1),
  ('30000000-0000-0000-0000-000000000103', NULL, NULL, 'Mobility', 1),
  ('30000000-0000-0000-0000-000000000104', NULL, NULL, 'Borrowing', 1),
  ('30000000-0000-0000-0000-000000000105', NULL, NULL, 'Investments', 1),
  ('30000000-0000-0000-0000-000000000106', NULL, NULL, 'Healthcare', 1),
  ('30000000-0000-0000-0000-000000000107', NULL, NULL, 'Food', 1),
  ('30000000-0000-0000-0000-000000000108', NULL, NULL, 'Insurance', 1),
  ('30000000-0000-0000-0000-000000000109', NULL, NULL, 'Education', 1),
  ('30000000-0000-0000-0000-000000000110', NULL, NULL, 'Giving', 1),
  ('30000000-0000-0000-0000-000000000111', NULL, NULL, 'Taxes', 1),
  ('30000000-0000-0000-0000-000000000112', NULL, NULL, 'Transfers', 1),
  ('30000000-0000-0000-0000-000000000117', NULL, NULL, 'Utilities', 1),
  ('30000000-0000-0000-0000-000000000133', NULL, NULL, 'Loans', 1),
  ('30000000-0000-0000-0000-000000000134', NULL, NULL, 'Travel', 1),
  ('30000000-0000-0000-0000-000000000152', NULL, NULL, 'Entertainment', 1),
  ('30000000-0000-0000-0000-000000000153', NULL, NULL, 'Banking', 1) ON CONFLICT DO NOTHING;

-- Income leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000007', NULL, '30000000-0000-0000-0000-000000000001', 'Salary', 1),
  ('30000000-0000-0000-0000-000000000010', NULL, '30000000-0000-0000-0000-000000000001', 'Rental income', 1),
  ('30000000-0000-0000-0000-000000000011', NULL, '30000000-0000-0000-0000-000000000001', 'Interest', 1),
  ('30000000-0000-0000-0000-000000000012', NULL, '30000000-0000-0000-0000-000000000001', 'Dividends', 1),
  ('30000000-0000-0000-0000-000000000013', NULL, '30000000-0000-0000-0000-000000000001', 'Refunds', 1),
  ('30000000-0000-0000-0000-000000000151', NULL, '30000000-0000-0000-0000-000000000001', 'Reimbursements', 1) ON CONFLICT DO NOTHING;

-- Borrowing leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000006', NULL, '30000000-0000-0000-0000-000000000104', 'Credit card payments', 1),
  ('30000000-0000-0000-0000-000000000121', NULL, '30000000-0000-0000-0000-000000000104', 'Loan payments', 1),
  ('30000000-0000-0000-0000-000000000122', NULL, '30000000-0000-0000-0000-000000000104', 'Personal lending', 1) ON CONFLICT DO NOTHING;

-- Education leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000123', NULL, '30000000-0000-0000-0000-000000000109', 'Activities', 1),
  ('30000000-0000-0000-0000-000000000135', NULL, '30000000-0000-0000-0000-000000000109', 'Camps', 1),
  ('30000000-0000-0000-0000-000000000027', NULL, '30000000-0000-0000-0000-000000000109', 'Tuition', 1),
  ('30000000-0000-0000-0000-000000000028', NULL, '30000000-0000-0000-0000-000000000109', 'Childcare', 1) ON CONFLICT DO NOTHING;

-- Food leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000023', NULL, '30000000-0000-0000-0000-000000000107', 'Dining out', 1),
  ('30000000-0000-0000-0000-000000000024', NULL, '30000000-0000-0000-0000-000000000107', 'Coffee', 1),
  ('30000000-0000-0000-0000-000000000124', NULL, '30000000-0000-0000-0000-000000000107', 'Snacks', 1) ON CONFLICT DO NOTHING;

-- Giving leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000029', NULL, '30000000-0000-0000-0000-000000000110', 'Charity', 1),
  ('30000000-0000-0000-0000-000000000030', NULL, '30000000-0000-0000-0000-000000000110', 'Gifts', 1) ON CONFLICT DO NOTHING;

-- Healthcare leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000020', NULL, '30000000-0000-0000-0000-000000000106', 'Medical', 1),
  ('30000000-0000-0000-0000-000000000021', NULL, '30000000-0000-0000-0000-000000000106', 'Pharmacy', 1),
  ('30000000-0000-0000-0000-000000000022', NULL, '30000000-0000-0000-0000-000000000106', 'Fitness', 1),
  ('30000000-0000-0000-0000-000000000125', NULL, '30000000-0000-0000-0000-000000000106', 'Wellness', 1),
  ('30000000-0000-0000-0000-000000000162', NULL, '30000000-0000-0000-0000-000000000106', 'Dental', 1) ON CONFLICT DO NOTHING;

-- Home leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000002', NULL, '30000000-0000-0000-0000-000000000102', 'Housing', 1),
  ('30000000-0000-0000-0000-000000000034', NULL, '30000000-0000-0000-0000-000000000102', 'Furniture', 1),
  ('30000000-0000-0000-0000-000000000035', NULL, '30000000-0000-0000-0000-000000000102', 'Maintenance', 1),
  ('30000000-0000-0000-0000-000000000036', NULL, '30000000-0000-0000-0000-000000000102', 'Home improvement', 1),
  ('30000000-0000-0000-0000-000000000136', NULL, '30000000-0000-0000-0000-000000000102', 'Appliances', 1),
  ('30000000-0000-0000-0000-000000000146', NULL, '30000000-0000-0000-0000-000000000102', 'HOA Fees', 1) ON CONFLICT DO NOTHING;

-- Insurance leaves (short display names)
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000025', NULL, '30000000-0000-0000-0000-000000000108', 'Home', 1),
  ('30000000-0000-0000-0000-000000000026', NULL, '30000000-0000-0000-0000-000000000108', 'Auto', 1),
  ('30000000-0000-0000-0000-000000000031', NULL, '30000000-0000-0000-0000-000000000108', 'Health', 1),
  ('30000000-0000-0000-0000-000000000032', NULL, '30000000-0000-0000-0000-000000000108', 'Life', 1),
  ('30000000-0000-0000-0000-000000000033', NULL, '30000000-0000-0000-0000-000000000108', 'Other', 1) ON CONFLICT DO NOTHING;

-- Investments leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000009', NULL, '30000000-0000-0000-0000-000000000105', 'Stocks', 1),
  ('30000000-0000-0000-0000-000000000126', NULL, '30000000-0000-0000-0000-000000000105', '529 plan', 1),
  ('30000000-0000-0000-0000-000000000127', NULL, '30000000-0000-0000-0000-000000000105', 'Real estate', 1),
  ('30000000-0000-0000-0000-000000000128', NULL, '30000000-0000-0000-0000-000000000105', 'Crypto', 1),
  ('30000000-0000-0000-0000-000000000147', NULL, '30000000-0000-0000-0000-000000000105', 'IRA', 1) ON CONFLICT DO NOTHING;

-- Loans leaves (dedicated group; ids are new — no legacy global rules point here yet)
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000137', NULL, '30000000-0000-0000-0000-000000000133', 'Auto', 1),
  ('30000000-0000-0000-0000-000000000138', NULL, '30000000-0000-0000-0000-000000000133', 'Heloc', 1),
  ('30000000-0000-0000-0000-000000000139', NULL, '30000000-0000-0000-0000-000000000133', 'Home', 1),
  ('30000000-0000-0000-0000-000000000140', NULL, '30000000-0000-0000-0000-000000000133', 'Personal', 1) ON CONFLICT DO NOTHING;

-- Mobility leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000005', NULL, '30000000-0000-0000-0000-000000000103', 'Public Transit', 1),
  ('30000000-0000-0000-0000-000000000129', NULL, '30000000-0000-0000-0000-000000000103', 'Auto Maintenance', 1),
  ('30000000-0000-0000-0000-000000000141', NULL, '30000000-0000-0000-0000-000000000103', 'Taxi', 1),
  ('30000000-0000-0000-0000-000000000154', NULL, '30000000-0000-0000-0000-000000000103', 'Fuel', 1),
  ('30000000-0000-0000-0000-000000000155', NULL, '30000000-0000-0000-0000-000000000103', 'EV Charging', 1),
  ('30000000-0000-0000-0000-000000000166', NULL, '30000000-0000-0000-0000-000000000103', 'Parking & Tolls', 1) ON CONFLICT DO NOTHING;

-- Shopping leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000004', NULL, '30000000-0000-0000-0000-000000000101', 'Groceries', 1),
  ('30000000-0000-0000-0000-000000000008', NULL, '30000000-0000-0000-0000-000000000101', 'Clothing', 1),
  ('30000000-0000-0000-0000-000000000142', NULL, '30000000-0000-0000-0000-000000000101', 'Electronic', 1),
  ('30000000-0000-0000-0000-000000000148', NULL, '30000000-0000-0000-0000-000000000101', 'General merchandise', 1),
  ('30000000-0000-0000-0000-000000000159', NULL, '30000000-0000-0000-0000-000000000101', 'Personal care', 1),
  ('30000000-0000-0000-0000-000000000165', NULL, '30000000-0000-0000-0000-000000000101', 'Software', 1),
  ('30000000-0000-0000-0000-000000000167', NULL, '30000000-0000-0000-0000-000000000101', 'Office', 1) ON CONFLICT DO NOTHING;

-- Taxes leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000113', NULL, '30000000-0000-0000-0000-000000000111', 'Federal income tax', 1),
  ('30000000-0000-0000-0000-000000000114', NULL, '30000000-0000-0000-0000-000000000111', 'Sales tax', 1),
  ('30000000-0000-0000-0000-000000000130', NULL, '30000000-0000-0000-0000-000000000111', 'State income tax', 1),
  ('30000000-0000-0000-0000-000000000131', NULL, '30000000-0000-0000-0000-000000000111', 'Federal tax refund', 1),
  ('30000000-0000-0000-0000-000000000132', NULL, '30000000-0000-0000-0000-000000000111', 'State tax refund', 1),
  ('30000000-0000-0000-0000-000000000149', NULL, '30000000-0000-0000-0000-000000000111', 'Property tax', 1),
  ('30000000-0000-0000-0000-000000000150', NULL, '30000000-0000-0000-0000-000000000111', 'Tax prep', 1) ON CONFLICT DO NOTHING;

-- Transfers leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000115', NULL, '30000000-0000-0000-0000-000000000112', 'Transfers in', 1),
  ('30000000-0000-0000-0000-000000000116', NULL, '30000000-0000-0000-0000-000000000112', 'Transfers out', 1),
  ('30000000-0000-0000-0000-000000000163', NULL, '30000000-0000-0000-0000-000000000112', 'Cash withdrawal', 1) ON CONFLICT DO NOTHING;

-- Travel leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000143', NULL, '30000000-0000-0000-0000-000000000134', 'Airfare', 1),
  ('30000000-0000-0000-0000-000000000144', NULL, '30000000-0000-0000-0000-000000000134', 'Car Rental', 1),
  ('30000000-0000-0000-0000-000000000145', NULL, '30000000-0000-0000-0000-000000000134', 'Hotel', 1),
  ('30000000-0000-0000-0000-000000000157', NULL, '30000000-0000-0000-0000-000000000134', 'Travel documents', 1),
  ('30000000-0000-0000-0000-000000000158', NULL, '30000000-0000-0000-0000-000000000134', 'Cruise', 1),
  ('30000000-0000-0000-0000-000000000168', NULL, '30000000-0000-0000-0000-000000000134', 'Train', 1),
  ('30000000-0000-0000-0000-000000000169', NULL, '30000000-0000-0000-0000-000000000134', 'Attractions', 1) ON CONFLICT DO NOTHING;

-- Entertainment leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000160', NULL, '30000000-0000-0000-0000-000000000152', 'Streaming', 1),
  ('30000000-0000-0000-0000-000000000161', NULL, '30000000-0000-0000-0000-000000000152', 'Movies', 1) ON CONFLICT DO NOTHING;

-- Banking leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000164', NULL, '30000000-0000-0000-0000-000000000153', 'Fees', 1) ON CONFLICT DO NOTHING;

-- Utilities leaves
INSERT INTO category (id, household_id, parent_id, name, is_default) VALUES
  ('30000000-0000-0000-0000-000000000118', NULL, '30000000-0000-0000-0000-000000000117', 'Energy', 1),
  ('30000000-0000-0000-0000-000000000119', NULL, '30000000-0000-0000-0000-000000000117', 'City Water', 1),
  ('30000000-0000-0000-0000-000000000120', NULL, '30000000-0000-0000-0000-000000000117', 'Mobile phone', 1),
  ('30000000-0000-0000-0000-000000000156', NULL, '30000000-0000-0000-0000-000000000117', 'Internet', 1) ON CONFLICT DO NOTHING;

-- Migrations may have created the same ids with older labels; INSERT OR IGNORE skips them — force product copy.
UPDATE category SET name = 'Home' WHERE id = '30000000-0000-0000-0000-000000000102';
UPDATE category SET name = 'Borrowing' WHERE id = '30000000-0000-0000-0000-000000000104';
UPDATE category SET name = 'Food' WHERE id = '30000000-0000-0000-0000-000000000107';
UPDATE category SET name = 'Insurance' WHERE id = '30000000-0000-0000-0000-000000000108';
UPDATE category SET name = 'Education' WHERE id = '30000000-0000-0000-0000-000000000109';
UPDATE category SET name = 'Giving' WHERE id = '30000000-0000-0000-0000-000000000110';
UPDATE category SET name = 'Coffee' WHERE id = '30000000-0000-0000-0000-000000000024';
UPDATE category SET name = 'Fitness' WHERE id = '30000000-0000-0000-0000-000000000022';
UPDATE category SET name = 'Tuition' WHERE id = '30000000-0000-0000-0000-000000000027';
UPDATE category SET name = 'Public Transit' WHERE id = '30000000-0000-0000-0000-000000000005';
UPDATE category SET name = 'Credit card payments' WHERE id = '30000000-0000-0000-0000-000000000006';
UPDATE category SET name = 'Maintenance' WHERE id = '30000000-0000-0000-0000-000000000035';
UPDATE category SET name = 'Federal income tax' WHERE id = '30000000-0000-0000-0000-000000000113';
UPDATE category SET name = 'Activities' WHERE id = '30000000-0000-0000-0000-000000000123';
UPDATE category SET name = 'Auto Maintenance' WHERE id = '30000000-0000-0000-0000-000000000129';
UPDATE category SET name = 'Home' WHERE id = '30000000-0000-0000-0000-000000000025' AND parent_id = '30000000-0000-0000-0000-000000000108';
UPDATE category SET name = 'Auto' WHERE id = '30000000-0000-0000-0000-000000000026' AND parent_id = '30000000-0000-0000-0000-000000000108';
UPDATE category SET name = 'Health' WHERE id = '30000000-0000-0000-0000-000000000031';
UPDATE category SET name = 'Life' WHERE id = '30000000-0000-0000-0000-000000000032';
UPDATE category SET name = 'Other' WHERE id = '30000000-0000-0000-0000-000000000033';
UPDATE category SET name = 'City Water' WHERE id = '30000000-0000-0000-0000-000000000119';
-- Built-in global category rules (generated by backend/scripts/gen-0026-migration.mjs).
-- Runs in same file after category inserts so category_id FKs resolve.

INSERT INTO category_rule_global
  (id, rule_key, pattern, match_type, category_id, amount_scope, confidence, priority, enabled)
VALUES
  ('b0010000-0000-4000-8000-000000000001', 'income_refunds_refund', 'refund', 'contains', '30000000-0000-0000-0000-000000000013', 'credit_only', 0.7, 100, 1),
  ('b0010000-0000-4000-8000-000000000002', 'income_rental_rental_income', 'rental income', 'contains', '30000000-0000-0000-0000-000000000010', 'credit_only', 0.7, 110, 1),
  ('b0010000-0000-4000-8000-000000000003', 'income_interest_interest', 'interest', 'contains', '30000000-0000-0000-0000-000000000011', 'credit_only', 0.7, 120, 1),
  ('b0010000-0000-4000-8000-000000000004', 'income_interest_int_pymt', 'int pymt', 'contains', '30000000-0000-0000-0000-000000000011', 'credit_only', 0.7, 120, 1),
  ('b0010000-0000-4000-8000-000000000005', 'income_interest_int_payment', 'int payment', 'contains', '30000000-0000-0000-0000-000000000011', 'credit_only', 0.7, 120, 1),
  ('b0010000-0000-4000-8000-000000000006', 'income_dividends_dividend', 'dividend', 'contains', '30000000-0000-0000-0000-000000000012', 'credit_only', 0.7, 130, 1),
  ('b0010000-0000-4000-8000-000000000007', 'income_salary_payroll', 'payroll', 'contains', '30000000-0000-0000-0000-000000000007', 'credit_only', 0.7, 140, 1),
  ('b0010000-0000-4000-8000-000000000008', 'income_salary_direct_dep', 'direct dep', 'contains', '30000000-0000-0000-0000-000000000007', 'credit_only', 0.7, 140, 1),
  ('b0010000-0000-4000-8000-000000000009', 'income_salary_salary', 'salary', 'contains', '30000000-0000-0000-0000-000000000007', 'credit_only', 0.7, 140, 1),
  ('b0010000-0000-4000-8000-000000000010', 'income_salary_pay_check', 'pay check', 'contains', '30000000-0000-0000-0000-000000000007', 'credit_only', 0.7, 140, 1),
  ('b0010000-0000-4000-8000-000000000011', 'income_salary_paycheck', 'paycheck', 'contains', '30000000-0000-0000-0000-000000000007', 'credit_only', 0.7, 140, 1),
  ('b0010000-0000-4000-8000-000000000012', 'income_salary_commission', 'commission', 'contains', '30000000-0000-0000-0000-000000000007', 'credit_only', 0.7, 140, 1),
  ('b0010000-0000-4000-8000-000000000013', 'housing_0_mortgage', 'mortgage', 'contains', '30000000-0000-0000-0000-000000000002', 'debit_only', 0.7, 200, 1),
  ('b0010000-0000-4000-8000-000000000014', 'housing_1_mtg', 'mtg', 'contains', '30000000-0000-0000-0000-000000000002', 'debit_only', 0.7, 200, 1),
  ('b0010000-0000-4000-8000-000000000015', 'housing_2_rent', 'rent', 'contains', '30000000-0000-0000-0000-000000000002', 'debit_only', 0.7, 200, 1),
  ('b0010000-0000-4000-8000-000000000017', 'housing_4_hoa', 'hoa', 'contains', '30000000-0000-0000-0000-000000000002', 'debit_only', 0.7, 200, 1),
  ('b0010000-0000-4000-8000-000000000018', 'housing_5_landlord', 'landlord', 'contains', '30000000-0000-0000-0000-000000000002', 'debit_only', 0.7, 200, 1),
  ('b0010000-0000-4000-8000-000000000019', 'housing_6_lease', 'lease', 'contains', '30000000-0000-0000-0000-000000000002', 'debit_only', 0.7, 200, 1),
  ('b0010000-0000-4000-8000-000000000020', 'energy_0_electric', 'electric', 'contains', '30000000-0000-0000-0000-000000000118', 'debit_only', 0.7, 210, 1),
  ('b0010000-0000-4000-8000-000000000021', 'energy_1_utilities', 'utilities', 'contains', '30000000-0000-0000-0000-000000000118', 'debit_only', 0.7, 210, 1),
  ('b0010000-0000-4000-8000-000000000022', 'energy_2_utility', 'utility', 'contains', '30000000-0000-0000-0000-000000000118', 'debit_only', 0.7, 210, 1),
  ('b0010000-0000-4000-8000-000000000023', 'energy_3_internet', 'internet', 'contains', '30000000-0000-0000-0000-000000000118', 'debit_only', 0.7, 210, 1),
  ('b0010000-0000-4000-8000-000000000024', 'energy_4_gas_bill', 'gas bill', 'contains', '30000000-0000-0000-0000-000000000118', 'debit_only', 0.7, 210, 1),
  ('b0010000-0000-4000-8000-000000000025', 'energy_5_duke_energy', 'duke energy', 'contains', '30000000-0000-0000-0000-000000000118', 'debit_only', 0.7, 210, 1),
  ('b0010000-0000-4000-8000-000000000026', 'energy_6_comcast', 'comcast', 'contains', '30000000-0000-0000-0000-000000000118', 'debit_only', 0.7, 210, 1),
  ('b0010000-0000-4000-8000-000000000027', 'water_0_water_bill', 'water bill', 'contains', '30000000-0000-0000-0000-000000000119', 'debit_only', 0.7, 211, 1),
  ('b0010000-0000-4000-8000-000000000028', 'water_1_sewer', 'sewer', 'contains', '30000000-0000-0000-0000-000000000119', 'debit_only', 0.7, 211, 1),
  ('b0010000-0000-4000-8000-000000000029', 'water_2_trash', 'trash', 'contains', '30000000-0000-0000-0000-000000000119', 'debit_only', 0.7, 211, 1),
  ('b0010000-0000-4000-8000-000000000030', 'mobile_0_verizon', 'verizon', 'contains', '30000000-0000-0000-0000-000000000120', 'debit_only', 0.7, 212, 1),
  ('b0010000-0000-4000-8000-000000000031', 'mobile_1_at_t', 'at&t', 'contains', '30000000-0000-0000-0000-000000000120', 'debit_only', 0.7, 212, 1),
  ('b0010000-0000-4000-8000-000000000032', 'mobile_2_att', 'att', 'contains', '30000000-0000-0000-0000-000000000120', 'debit_only', 0.7, 212, 1),
  ('b0010000-0000-4000-8000-000000000033', 'mobile_3_t_mobile', 't-mobile', 'contains', '30000000-0000-0000-0000-000000000120', 'debit_only', 0.7, 212, 1),
  ('b0010000-0000-4000-8000-000000000034', 'mobile_4_tmobile', 'tmobile', 'contains', '30000000-0000-0000-0000-000000000120', 'debit_only', 0.7, 212, 1),
  ('b0010000-0000-4000-8000-000000000035', 'dining_0_restaurant', 'restaurant', 'contains', '30000000-0000-0000-0000-000000000023', 'debit_only', 0.7, 220, 1),
  ('b0010000-0000-4000-8000-000000000036', 'dining_1_grubhub', 'grubhub', 'contains', '30000000-0000-0000-0000-000000000023', 'any', 0.7, 220, 1),
  ('b0010000-0000-4000-8000-000000000037', 'dining_2_doordash', 'doordash', 'contains', '30000000-0000-0000-0000-000000000023', 'any', 0.7, 220, 1),
  ('b0010000-0000-4000-8000-000000000038', 'dining_3_uber_eats', 'uber eats', 'contains', '30000000-0000-0000-0000-000000000023', 'any', 0.7, 220, 1),
  ('b0010000-0000-4000-8000-000000000039', 'dining_4_chipotle', 'chipotle', 'contains', '30000000-0000-0000-0000-000000000023', 'any', 0.7, 220, 1),
  ('b0010000-0000-4000-8000-000000000040', 'dining_5_taco_bell', 'taco bell', 'contains', '30000000-0000-0000-0000-000000000023', 'any', 0.7, 220, 1),
  ('b0010000-0000-4000-8000-000000000041', 'dining_6_mcdonald', 'mcdonald', 'contains', '30000000-0000-0000-0000-000000000023', 'any', 0.7, 220, 1),
  ('b0010000-0000-4000-8000-000000000042', 'dining_7_panera', 'panera', 'contains', '30000000-0000-0000-0000-000000000023', 'any', 0.7, 220, 1),
  ('b0010000-0000-4000-8000-000000000043', 'dining_8_panda_express', 'panda express', 'contains', '30000000-0000-0000-0000-000000000023', 'any', 0.7, 220, 1),
  ('b0010000-0000-4000-8000-000000000044', 'coffee_0_starbucks', 'starbucks', 'contains', '30000000-0000-0000-0000-000000000024', 'any', 0.7, 230, 1),
  ('b0010000-0000-4000-8000-000000000045', 'coffee_1_dunkin', 'dunkin', 'contains', '30000000-0000-0000-0000-000000000024', 'any', 0.7, 230, 1),
  ('b0010000-0000-4000-8000-000000000046', 'coffee_2_dutch_bro', 'dutch bro', 'contains', '30000000-0000-0000-0000-000000000024', 'any', 0.7, 230, 1),
  ('b0010000-0000-4000-8000-000000000047', 'coffee_3_coffee', 'coffee', 'contains', '30000000-0000-0000-0000-000000000024', 'debit_only', 0.7, 230, 1),
  ('b0010000-0000-4000-8000-000000000048', 'snacks_0_chips', 'chips', 'contains', '30000000-0000-0000-0000-000000000124', 'debit_only', 0.7, 231, 1),
  ('b0010000-0000-4000-8000-000000000049', 'snacks_1_candy_bar', 'candy bar', 'contains', '30000000-0000-0000-0000-000000000124', 'debit_only', 0.7, 231, 1),
  ('b0010000-0000-4000-8000-000000000050', 'snacks_2_vending', 'vending', 'contains', '30000000-0000-0000-0000-000000000124', 'debit_only', 0.7, 231, 1),
  ('b0010000-0000-4000-8000-000000000051', 'snacks_3_snack', 'snack', 'contains', '30000000-0000-0000-0000-000000000124', 'debit_only', 0.7, 231, 1),
  ('b0010000-0000-4000-8000-000000000052', 'groceries_0_whole_foods', 'whole foods', 'contains', '30000000-0000-0000-0000-000000000004', 'any', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000053', 'groceries_1_trader_joe', 'trader joe', 'contains', '30000000-0000-0000-0000-000000000004', 'any', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000054', 'groceries_2_kroger', 'kroger', 'contains', '30000000-0000-0000-0000-000000000004', 'any', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000055', 'groceries_3_safeway', 'safeway', 'contains', '30000000-0000-0000-0000-000000000004', 'any', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000056', 'groceries_4_aldi', 'aldi', 'contains', '30000000-0000-0000-0000-000000000004', 'any', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000057', 'groceries_5_grocery', 'grocery', 'contains', '30000000-0000-0000-0000-000000000004', 'debit_only', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000058', 'groceries_6_groceries', 'groceries', 'contains', '30000000-0000-0000-0000-000000000004', 'debit_only', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000059', 'groceries_7_walmart', 'walmart', 'contains', '30000000-0000-0000-0000-000000000004', 'any', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000060', 'groceries_8_costco', 'costco', 'contains', '30000000-0000-0000-0000-000000000004', 'any', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000061', 'groceries_9_target', 'target', 'contains', '30000000-0000-0000-0000-000000000004', 'any', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000062', 'groceries_10_publix', 'publix', 'contains', '30000000-0000-0000-0000-000000000004', 'any', 0.7, 240, 1),
  ('b0010000-0000-4000-8000-000000000063', 'transit_0_uber', 'uber', 'contains', '30000000-0000-0000-0000-000000000005', 'any', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000064', 'transit_1_lyft', 'lyft', 'contains', '30000000-0000-0000-0000-000000000005', 'any', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000065', 'transit_2_shell', 'shell', 'contains', '30000000-0000-0000-0000-000000000005', 'any', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000066', 'transit_3_exxon', 'exxon', 'contains', '30000000-0000-0000-0000-000000000005', 'any', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000067', 'transit_4_chevron', 'chevron', 'contains', '30000000-0000-0000-0000-000000000005', 'any', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000068', 'transit_5_bp', 'bp', 'contains', '30000000-0000-0000-0000-000000000005', 'any', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000069', 'transit_6_parking', 'parking', 'contains', '30000000-0000-0000-0000-000000000005', 'any', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000070', 'transit_7_metro', 'metro', 'contains', '30000000-0000-0000-0000-000000000005', 'debit_only', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000071', 'transit_8_transit', 'transit', 'contains', '30000000-0000-0000-0000-000000000005', 'debit_only', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000072', 'transit_9_toll', 'toll', 'contains', '30000000-0000-0000-0000-000000000005', 'any', 0.7, 250, 1),
  ('b0010000-0000-4000-8000-000000000073', 'auto_maint_0_auto_repair', 'auto repair', 'contains', '30000000-0000-0000-0000-000000000129', 'debit_only', 0.7, 251, 1),
  ('b0010000-0000-4000-8000-000000000074', 'auto_maint_1_firestone', 'firestone', 'contains', '30000000-0000-0000-0000-000000000129', 'debit_only', 0.7, 251, 1),
  ('b0010000-0000-4000-8000-000000000075', 'auto_maint_2_pep_boys', 'pep boys', 'contains', '30000000-0000-0000-0000-000000000129', 'debit_only', 0.7, 251, 1),
  ('b0010000-0000-4000-8000-000000000076', 'auto_maint_3_autozone', 'autozone', 'contains', '30000000-0000-0000-0000-000000000129', 'debit_only', 0.7, 251, 1),
  ('b0010000-0000-4000-8000-000000000077', 'auto_maint_4_o_reilly', 'o''reilly', 'contains', '30000000-0000-0000-0000-000000000129', 'debit_only', 0.7, 251, 1),
  ('b0010000-0000-4000-8000-000000000078', 'auto_maint_5_dealership', 'dealership', 'contains', '30000000-0000-0000-0000-000000000129', 'debit_only', 0.7, 251, 1),
  ('b0010000-0000-4000-8000-000000000079', 'auto_maint_6_jiffy_lube', 'jiffy lube', 'contains', '30000000-0000-0000-0000-000000000129', 'debit_only', 0.7, 251, 1),
  ('b0010000-0000-4000-8000-000000000080', 'auto_maint_7_tire', 'tire', 'contains', '30000000-0000-0000-0000-000000000129', 'debit_only', 0.7, 251, 1),
  ('b0010000-0000-4000-8000-000000000081', 'cc_0_card_payment', 'card payment', 'contains', '30000000-0000-0000-0000-000000000006', 'debit_only', 0.7, 260, 1),
  ('b0010000-0000-4000-8000-000000000082', 'cc_1_credit_card', 'credit card', 'contains', '30000000-0000-0000-0000-000000000006', 'debit_only', 0.7, 260, 1),
  ('b0010000-0000-4000-8000-000000000083', 'loan_0_loan_pmt', 'loan pmt', 'contains', '30000000-0000-0000-0000-000000000121', 'debit_only', 0.7, 261, 1),
  ('b0010000-0000-4000-8000-000000000084', 'loan_1_loan_payment', 'loan payment', 'contains', '30000000-0000-0000-0000-000000000121', 'debit_only', 0.7, 261, 1),
  ('b0010000-0000-4000-8000-000000000085', 'loan_2_auto_loan', 'auto loan', 'contains', '30000000-0000-0000-0000-000000000121', 'debit_only', 0.7, 261, 1),
  ('b0010000-0000-4000-8000-000000000086', 'loan_3_student_loan', 'student loan', 'contains', '30000000-0000-0000-0000-000000000121', 'debit_only', 0.7, 261, 1),
  ('b0010000-0000-4000-8000-000000000087', 'loan_4_lending_club', 'lending club', 'contains', '30000000-0000-0000-0000-000000000121', 'debit_only', 0.7, 261, 1),
  ('b0010000-0000-4000-8000-000000000088', 'medical_0_hospital', 'hospital', 'contains', '30000000-0000-0000-0000-000000000020', 'debit_only', 0.7, 270, 1),
  ('b0010000-0000-4000-8000-000000000089', 'medical_1_physician', 'physician', 'contains', '30000000-0000-0000-0000-000000000020', 'debit_only', 0.7, 270, 1),
  ('b0010000-0000-4000-8000-000000000090', 'medical_2_doctor', 'doctor', 'contains', '30000000-0000-0000-0000-000000000020', 'debit_only', 0.7, 270, 1),
  ('b0010000-0000-4000-8000-000000000091', 'medical_3_urgent_care', 'urgent care', 'contains', '30000000-0000-0000-0000-000000000020', 'debit_only', 0.7, 270, 1),
  ('b0010000-0000-4000-8000-000000000092', 'medical_4_medical', 'medical', 'contains', '30000000-0000-0000-0000-000000000020', 'debit_only', 0.7, 270, 1),
  ('b0010000-0000-4000-8000-000000000093', 'medical_5_lab_corp', 'lab corp', 'contains', '30000000-0000-0000-0000-000000000020', 'debit_only', 0.7, 270, 1),
  ('b0010000-0000-4000-8000-000000000094', 'medical_6_quest_diag', 'quest diag', 'contains', '30000000-0000-0000-0000-000000000020', 'debit_only', 0.7, 270, 1),
  ('b0010000-0000-4000-8000-000000000095', 'pharmacy_0_cvs', 'cvs', 'contains', '30000000-0000-0000-0000-000000000021', 'debit_only', 0.7, 280, 1),
  ('b0010000-0000-4000-8000-000000000096', 'pharmacy_1_cvs_', 'cvs#', 'contains', '30000000-0000-0000-0000-000000000021', 'debit_only', 0.7, 280, 1),
  ('b0010000-0000-4000-8000-000000000097', 'pharmacy_2_walgreens', 'walgreens', 'contains', '30000000-0000-0000-0000-000000000021', 'debit_only', 0.7, 280, 1),
  ('b0010000-0000-4000-8000-000000000098', 'pharmacy_3_pharmacy', 'pharmacy', 'contains', '30000000-0000-0000-0000-000000000021', 'debit_only', 0.7, 280, 1),
  ('b0010000-0000-4000-8000-000000000099', 'pharmacy_4_rite_aid', 'rite aid', 'contains', '30000000-0000-0000-0000-000000000021', 'debit_only', 0.7, 280, 1),
  ('b0010000-0000-4000-8000-000000000100', 'fitness_0_gym', 'gym', 'contains', '30000000-0000-0000-0000-000000000022', 'debit_only', 0.7, 285, 1),
  ('b0010000-0000-4000-8000-000000000101', 'fitness_1_planet_fitness', 'planet fitness', 'contains', '30000000-0000-0000-0000-000000000022', 'debit_only', 0.7, 285, 1),
  ('b0010000-0000-4000-8000-000000000102', 'fitness_2_ymca', 'ymca', 'contains', '30000000-0000-0000-0000-000000000022', 'debit_only', 0.7, 285, 1),
  ('b0010000-0000-4000-8000-000000000103', 'fitness_3_crossfit', 'crossfit', 'contains', '30000000-0000-0000-0000-000000000022', 'debit_only', 0.7, 285, 1),
  ('b0010000-0000-4000-8000-000000000104', 'wellness_0_meditation', 'meditation', 'contains', '30000000-0000-0000-0000-000000000125', 'debit_only', 0.7, 286, 1),
  ('b0010000-0000-4000-8000-000000000105', 'wellness_1_headspace', 'headspace', 'contains', '30000000-0000-0000-0000-000000000125', 'debit_only', 0.7, 286, 1),
  ('b0010000-0000-4000-8000-000000000106', 'wellness_2_calm_com', 'calm.com', 'contains', '30000000-0000-0000-0000-000000000125', 'debit_only', 0.7, 286, 1),
  ('b0010000-0000-4000-8000-000000000107', 'wellness_3_wellness_spa', 'wellness spa', 'contains', '30000000-0000-0000-0000-000000000125', 'debit_only', 0.7, 286, 1),
  ('b0010000-0000-4000-8000-000000000108', 'fed_tax_0_irs', 'irs', 'contains', '30000000-0000-0000-0000-000000000113', 'debit_only', 0.7, 290, 1),
  ('b0010000-0000-4000-8000-000000000109', 'fed_tax_1_federal_tax', 'federal tax', 'contains', '30000000-0000-0000-0000-000000000113', 'debit_only', 0.7, 290, 1),
  ('b0010000-0000-4000-8000-000000000110', 'fed_tax_2_us_treasury_tax', 'us treasury tax', 'contains', '30000000-0000-0000-0000-000000000113', 'debit_only', 0.7, 290, 1),
  ('b0010000-0000-4000-8000-000000000111', 'state_tax_0_state_tax', 'state tax', 'contains', '30000000-0000-0000-0000-000000000130', 'debit_only', 0.7, 291, 1),
  ('b0010000-0000-4000-8000-000000000112', 'state_tax_1_franchise_tax', 'franchise tax', 'contains', '30000000-0000-0000-0000-000000000130', 'debit_only', 0.7, 291, 1),
  ('b0010000-0000-4000-8000-000000000113', 'state_tax_2_ftb', 'ftb', 'contains', '30000000-0000-0000-0000-000000000130', 'debit_only', 0.7, 291, 1),
  ('b0010000-0000-4000-8000-000000000114', 'sales_tax_0', 'sales tax', 'contains', '30000000-0000-0000-0000-000000000114', 'debit_only', 0.7, 292, 1),
  ('b0010000-0000-4000-8000-000000000115', 'fed_refund_0_irs_treas', 'irs treas', 'contains', '30000000-0000-0000-0000-000000000131', 'credit_only', 0.7, 293, 1),
  ('b0010000-0000-4000-8000-000000000116', 'fed_refund_1_federal_refund', 'federal refund', 'contains', '30000000-0000-0000-0000-000000000131', 'credit_only', 0.7, 293, 1),
  ('b0010000-0000-4000-8000-000000000117', 'fed_refund_2_tax_refund_irs', 'tax refund irs', 'contains', '30000000-0000-0000-0000-000000000131', 'credit_only', 0.7, 293, 1),
  ('b0010000-0000-4000-8000-000000000118', 'state_refund_0_state_refund', 'state refund', 'contains', '30000000-0000-0000-0000-000000000132', 'credit_only', 0.7, 294, 1),
  ('b0010000-0000-4000-8000-000000000119', 'state_refund_1_tax_refund_state', 'tax refund state', 'contains', '30000000-0000-0000-0000-000000000132', 'credit_only', 0.7, 294, 1) ON CONFLICT DO NOTHING;

-- Former 0003_seed_default_household_categories.sql (Option B): reserved for household-scoped install defaults; currently unused.
