-- Normalize seeded account_mask values to last-four digits so the import UI can show ****1234.
-- INSERT OR IGNORE in seeds does not update existing rows; this migration fixes legacy placeholders.
UPDATE financial_account SET account_mask = '1001' WHERE id = '40000000-0000-0000-0000-000000000001';
UPDATE financial_account SET account_mask = '2002' WHERE id = '40000000-0000-0000-0000-000000000002';
UPDATE financial_account SET account_mask = '3003' WHERE id = '40000000-0000-0000-0000-000000000003';
UPDATE financial_account SET account_mask = '4004' WHERE id = '40000000-0000-0000-0000-000000000004';
UPDATE financial_account SET account_mask = '5005' WHERE id = '40000000-0000-0000-0000-000000000005';
UPDATE financial_account SET account_mask = '6006' WHERE id = '40000000-0000-0000-0000-000000000006';
