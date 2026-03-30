-- Placeholder “payslip bucket” for import binding (IBM profile v1). Scoped to seed owner; multi-employer onboarding later.
INSERT OR IGNORE INTO financial_account (id, household_id, owner_user_id, type, institution, account_mask, currency, created_at)
VALUES
  (
    '40000000-0000-0000-0000-000000000010',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'payslip',
    'Employer payslip (IBM) — placeholder',
    NULL,
    'USD',
    CURRENT_TIMESTAMP
  );
