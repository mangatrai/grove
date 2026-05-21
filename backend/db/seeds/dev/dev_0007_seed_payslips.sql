-- Dev payslip seed (generated 2026-05-21)
-- 6 bi-weekly IBM payslips for Alex Owner (person-scoped, Texas, no state tax)
-- 3 monthly Deloitte payslips for Sam Spouse (person-scoped, California)
-- Designed to exercise person filters, pills, PS-3/PS-4 signals, and line-item display.

-- ─── Alex Owner · IBM · Bi-weekly · Texas ─────────────────────────────────────
-- Gross $9,940/check · 18.5% federal (on track) · 6% 401k · HSA · Medical/Dental

INSERT INTO payslip_snapshot (
  id, household_id, file_name, file_checksum, parser_profile_id,
  pay_period_start, pay_period_end, pay_date,
  gross_pay_current, gross_pay_ytd,
  employee_taxes_current, employee_taxes_ytd,
  pre_tax_deductions_current, pre_tax_deductions_ytd,
  post_tax_deductions_current, post_tax_deductions_ytd,
  net_pay_current, net_pay_ytd,
  employment_rate_type,
  owner_scope, owner_person_profile_id
) VALUES
  -- P1: Jan 1–15
  ('a0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'ibm_2026-01-15.pdf', 'dev-alex-ps-001', 'ibm_pay_contributions_pdf',
   '2026-01-01', '2026-01-15', '2026-01-17',
   9940.00, 9940.00,
   2600.31, 2600.31,
   1150.23, 1150.23,
   10.60, 10.60,
   6178.86, 6178.86,
   'annual', 'person', '70000000-0000-0000-0000-000000000001'),

  -- P2: Jan 16–31
  ('a0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   'ibm_2026-01-31.pdf', 'dev-alex-ps-002', 'ibm_pay_contributions_pdf',
   '2026-01-16', '2026-01-31', '2026-01-31',
   9940.00, 19880.00,
   2600.31, 5200.62,
   1150.23, 2300.46,
   10.60, 21.20,
   6178.86, 12357.72,
   'annual', 'person', '70000000-0000-0000-0000-000000000001'),

  -- P3: Feb 1–14
  ('a0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   'ibm_2026-02-14.pdf', 'dev-alex-ps-003', 'ibm_pay_contributions_pdf',
   '2026-02-01', '2026-02-14', '2026-02-14',
   9940.00, 29820.00,
   2600.31, 7800.93,
   1150.23, 3450.69,
   10.60, 31.80,
   6178.86, 18536.58,
   'annual', 'person', '70000000-0000-0000-0000-000000000001'),

  -- P4: Feb 15–28
  ('a0000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000001',
   'ibm_2026-02-28.pdf', 'dev-alex-ps-004', 'ibm_pay_contributions_pdf',
   '2026-02-15', '2026-02-28', '2026-02-28',
   9940.00, 39760.00,
   2600.31, 10401.24,
   1150.23, 4600.92,
   10.60, 42.40,
   6178.86, 24715.44,
   'annual', 'person', '70000000-0000-0000-0000-000000000001'),

  -- P5: Mar 1–15
  ('a0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001',
   'ibm_2026-03-15.pdf', 'dev-alex-ps-005', 'ibm_pay_contributions_pdf',
   '2026-03-01', '2026-03-15', '2026-03-15',
   9940.00, 49700.00,
   2600.31, 13001.55,
   1150.23, 5751.15,
   10.60, 53.00,
   6178.86, 30894.30,
   'annual', 'person', '70000000-0000-0000-0000-000000000001'),

  -- P6: Mar 16–31
  ('a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001',
   'ibm_2026-03-31.pdf', 'dev-alex-ps-006', 'ibm_pay_contributions_pdf',
   '2026-03-16', '2026-03-31', '2026-03-31',
   9940.00, 59640.00,
   2600.31, 15601.86,
   1150.23, 6901.38,
   10.60, 63.60,
   6178.86, 37073.16,
   'annual', 'person', '70000000-0000-0000-0000-000000000001');

-- ─── Alex Owner line items (P6 only — most recent, richest detail) ─────────────
-- Include all sections so the redesigned line-item table has something to show.

INSERT INTO payslip_line_item (
  id, payslip_snapshot_id, household_id, section, sort_order,
  name, authority, amount_current, amount_ytd
) VALUES
  -- Earnings
  ('c0000000-0000-0000-0001-000000000001', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'earnings', 0,
   'Regular Salary', NULL, 9590.00, 57540.00),
  ('c0000000-0000-0000-0001-000000000002', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'earnings', 1,
   'Vacation Pay', NULL, 350.00, 2100.00),

  -- Pre-tax deductions
  ('c0000000-0000-0000-0001-000000000010', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 0,
   '401(k) Pre-Tax', NULL, 596.40, 3578.40),
  ('c0000000-0000-0000-0001-000000000011', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 1,
   'HSA Employee', NULL, 208.33, 1249.98),
  ('c0000000-0000-0000-0001-000000000012', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 2,
   'Medical Premium', NULL, 312.50, 1875.00),
  ('c0000000-0000-0000-0001-000000000013', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 3,
   'Dental Premium', NULL, 25.00, 150.00),
  ('c0000000-0000-0000-0001-000000000014', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 4,
   'Vision Premium', NULL, 8.00, 48.00),

  -- Tax deductions
  ('c0000000-0000-0000-0001-000000000020', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 0,
   'TX Withholding Tax', 'Federal', 1839.90, 11039.40),
  ('c0000000-0000-0000-0001-000000000021', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 1,
   'TX EE Social Security Tax', 'Federal', 616.28, 3697.68),
  ('c0000000-0000-0000-0001-000000000022', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 2,
   'TX EE Medicare Tax', 'Federal', 144.13, 864.78),

  -- Post-tax deductions
  ('c0000000-0000-0000-0001-000000000030', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'post_tax_deductions', 0,
   'Group Life Insurance', NULL, 8.50, 51.00),
  ('c0000000-0000-0000-0001-000000000031', 'a0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001', 'post_tax_deductions', 1,
   'AD&D Insurance', NULL, 2.10, 12.60);

-- Also seed P5 line items for sparkline / prior-period comparison to work
INSERT INTO payslip_line_item (
  id, payslip_snapshot_id, household_id, section, sort_order,
  name, authority, amount_current, amount_ytd
) VALUES
  ('c0000000-0000-0000-0005-000000000001', 'a0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001', 'earnings', 0,
   'Regular Salary', NULL, 9590.00, 47950.00),
  ('c0000000-0000-0000-0005-000000000002', 'a0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001', 'earnings', 1,
   'Vacation Pay', NULL, 350.00, 1750.00),
  ('c0000000-0000-0000-0005-000000000010', 'a0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 0,
   '401(k) Pre-Tax', NULL, 596.40, 2982.00),
  ('c0000000-0000-0000-0005-000000000011', 'a0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 1,
   'HSA Employee', NULL, 208.33, 1041.65),
  ('c0000000-0000-0000-0005-000000000012', 'a0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 2,
   'Medical Premium', NULL, 312.50, 1562.50),
  ('c0000000-0000-0000-0005-000000000020', 'a0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 0,
   'TX Withholding Tax', 'Federal', 1839.90, 9199.50),
  ('c0000000-0000-0000-0005-000000000021', 'a0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 1,
   'TX EE Social Security Tax', 'Federal', 616.28, 3081.40),
  ('c0000000-0000-0000-0005-000000000022', 'a0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 2,
   'TX EE Medicare Tax', 'Federal', 144.13, 720.65);


-- ─── Sam Spouse · Deloitte · Monthly · California ─────────────────────────────
-- Gross $5,833.33/check · 16% federal (below average — PS-4 triggers) · CA state tax

INSERT INTO payslip_snapshot (
  id, household_id, file_name, file_checksum, parser_profile_id,
  pay_period_start, pay_period_end, pay_date,
  gross_pay_current, gross_pay_ytd,
  employee_taxes_current, employee_taxes_ytd,
  pre_tax_deductions_current, pre_tax_deductions_ytd,
  post_tax_deductions_current, post_tax_deductions_ytd,
  net_pay_current, net_pay_ytd,
  employment_rate_type,
  owner_scope, owner_person_profile_id
) VALUES
  -- S1: January
  ('b0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'deloitte_2026-01-31.pdf', 'dev-sam-ps-001', 'deloitte_payslip_pdf',
   '2026-01-01', '2026-01-31', '2026-01-31',
   5833.33, 5833.33,
   1723.75, 1723.75,
   547.00, 547.00,
   0.00, 0.00,
   3562.58, 3562.58,
   'annual', 'person', '70000000-0000-0000-0000-000000000002'),

  -- S2: February
  ('b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   'deloitte_2026-02-28.pdf', 'dev-sam-ps-002', 'deloitte_payslip_pdf',
   '2026-02-01', '2026-02-28', '2026-02-28',
   5833.33, 11666.66,
   1723.75, 3447.50,
   547.00, 1094.00,
   0.00, 0.00,
   3562.58, 7125.16,
   'annual', 'person', '70000000-0000-0000-0000-000000000002'),

  -- S3: March
  ('b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   'deloitte_2026-03-31.pdf', 'dev-sam-ps-003', 'deloitte_payslip_pdf',
   '2026-03-01', '2026-03-31', '2026-03-31',
   5833.33, 17499.99,
   1723.75, 5171.25,
   547.00, 1641.00,
   0.00, 0.00,
   3562.58, 10687.74,
   'annual', 'person', '70000000-0000-0000-0000-000000000002');

-- ─── Sam Spouse line items (S3 — most recent) ─────────────────────────────────

INSERT INTO payslip_line_item (
  id, payslip_snapshot_id, household_id, section, sort_order,
  name, authority, amount_current, amount_ytd
) VALUES
  -- Earnings
  ('d0000000-0000-0000-0003-000000000001', 'b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'earnings', 0,
   'Regular Salary', NULL, 5833.33, 17499.99),

  -- Pre-tax deductions
  ('d0000000-0000-0000-0003-000000000010', 'b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 0,
   '401(k) Traditional', NULL, 350.00, 1050.00),
  ('d0000000-0000-0000-0003-000000000011', 'b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 1,
   'Medical Premium', NULL, 175.00, 525.00),
  ('d0000000-0000-0000-0003-000000000012', 'b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 2,
   'Dental Premium', NULL, 22.00, 66.00),

  -- Tax deductions
  ('d0000000-0000-0000-0003-000000000020', 'b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 0,
   'Federal Income Tax', 'Federal', 933.33, 2799.99),
  ('d0000000-0000-0000-0003-000000000021', 'b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 1,
   'Social Security Tax', 'Federal', 361.67, 1085.01),
  ('d0000000-0000-0000-0003-000000000022', 'b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 2,
   'Medicare Tax', 'Federal', 84.58, 253.74),
  ('d0000000-0000-0000-0003-000000000023', 'b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 3,
   'CA State Income Tax', 'State', 291.67, 875.01),
  ('d0000000-0000-0000-0003-000000000024', 'b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 4,
   'CA State Disability Insurance', 'State', 52.50, 157.50);

-- S2 line items (for prior-period delta signal)
INSERT INTO payslip_line_item (
  id, payslip_snapshot_id, household_id, section, sort_order,
  name, authority, amount_current, amount_ytd
) VALUES
  ('d0000000-0000-0000-0002-000000000001', 'b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'earnings', 0,
   'Regular Salary', NULL, 5833.33, 11666.66),
  ('d0000000-0000-0000-0002-000000000010', 'b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 0,
   '401(k) Traditional', NULL, 350.00, 700.00),
  ('d0000000-0000-0000-0002-000000000011', 'b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'pre_tax_deductions', 1,
   'Medical Premium', NULL, 175.00, 350.00),
  ('d0000000-0000-0000-0002-000000000020', 'b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 0,
   'Federal Income Tax', 'Federal', 933.33, 1866.66),
  ('d0000000-0000-0000-0002-000000000021', 'b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 1,
   'Social Security Tax', 'Federal', 361.67, 723.34),
  ('d0000000-0000-0000-0002-000000000022', 'b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 2,
   'Medicare Tax', 'Federal', 84.58, 169.16),
  ('d0000000-0000-0000-0002-000000000023', 'b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 3,
   'CA State Income Tax', 'State', 291.67, 583.34),
  ('d0000000-0000-0000-0002-000000000024', 'b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'tax_deductions', 4,
   'CA State Disability Insurance', 'State', 52.50, 105.00);
