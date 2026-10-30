-- Dev seed: split-deposit payslip (#301) — household-scoped Rippling-style stub (kept off the per-person YTD
-- strip and deltas) whose net pay lands in two accounts, both deposits already linked. Exercises the per-line Bank deposit card (Playwright: payslips.spec.ts).
-- Fictional values only.

INSERT INTO payslip_snapshot (
  id, household_id, file_name, file_checksum, parser_profile_id,
  pay_period_start, pay_period_end, pay_date,
  gross_pay_current, gross_pay_ytd,
  employee_taxes_current, employee_taxes_ytd,
  pre_tax_deductions_current, pre_tax_deductions_ytd,
  post_tax_deductions_current, post_tax_deductions_ytd,
  net_pay_current, net_pay_ytd,
  canonical_extract_json, currency, employer_display_name, payment_summary_json,
  owner_scope, owner_person_profile_id
) VALUES (
  'a0000000-0000-0000-0000-000000000301',
  '10000000-0000-0000-0000-000000000001',
  'acme_split_2026-09-15.pdf', 'dev-alex-split-301', 'rippling_payslip_pdf',
  '2026-09-01', '2026-09-15', '2026-09-15',
  5000.00, 5000.00,
  1282.50, 1282.50,
  0, 0,
  0, 0,
  3717.50, 3717.50,
  '{"version":1,"source":"rippling_pdf_text"}', 'USD', 'Acme Corp',
  '[{"payment_type":"direct_deposit","bank_name":null,"bank_location":null,"account_or_check_number_masked":"...001","amount":3217.5,"currency":"USD","pay_date":"2026-09-15","trace":"000000000000001"},{"payment_type":"direct_deposit","bank_name":null,"bank_location":null,"account_or_check_number_masked":"...002","amount":500,"currency":"USD","pay_date":"2026-09-15","trace":"000000000000002"}]',
  'household', NULL
) ON CONFLICT DO NOTHING;

-- The two bank credits: checking (mask 1001) and savings (mask 2002).
INSERT INTO transaction_canonical (
  id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
  merchant, memo, fingerprint, source_ref, status, classification_meta, owner_scope, owner_person_profile_id
) VALUES
  ('5a000000-0000-4000-8000-000000000301', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', NULL, '30000000-0000-0000-0000-000000000007', '2026-09-15', 3217.50, 'credit', 'ACME CORP PAYROLL', NULL, 'dev-split-301-checking', 'manual:dev-split-301-a', 'posted', '{"source":"manual"}', 'household', NULL),
  ('5a000000-0000-4000-8000-000000000302', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', NULL, '30000000-0000-0000-0000-000000000007', '2026-09-15', 500.00, 'credit', 'ACME CORP PAYROLL', NULL, 'dev-split-301-savings', 'manual:dev-split-301-b', 'posted', '{"source":"manual"}', 'household', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO payslip_deposit_match (payslip_snapshot_id, household_id, transaction_canonical_id) VALUES
  ('a0000000-0000-0000-0000-000000000301', '10000000-0000-0000-0000-000000000001', '5a000000-0000-4000-8000-000000000301'),
  ('a0000000-0000-0000-0000-000000000301', '10000000-0000-0000-0000-000000000001', '5a000000-0000-4000-8000-000000000302')
ON CONFLICT DO NOTHING;
