-- Marcus / Goldman Sachs online savings (Epic 3 PDF import mapping).
INSERT OR IGNORE INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
VALUES
  ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'savings', 'Marcus', '6006', 'USD', CURRENT_TIMESTAMP);
