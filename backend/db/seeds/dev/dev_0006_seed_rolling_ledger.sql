-- dev_0006_seed_rolling_ledger.sql
--
-- Rolling transactions for dashboard arrow testing. Dates are computed relative
-- to CURRENT_DATE so the seed never goes stale — run db:reset:dev in any month
-- and you get data for that month.
--
-- Covers: M0 (current), M-1 through M-5 (6-month trend + MoM arrow guard),
--         and M-12 (same month last year, for YoY arrows).
-- Min 3 txns per account per month so the count < 3 guard passes.
--
-- Arrow expectations after this seed:
--   BoA Checking   (checking)    : MoM ↑ gold    | YoY ↑ gold
--   BoA Credit Card (credit_card): MoM ↑ terra    | YoY ↓ forest
--   Citi Credit Card (credit_card): MoM ↓ forest  | YoY ↑ terra

INSERT INTO transaction_canonical (
  id, household_id, account_id, user_id, category_id,
  txn_date, amount, direction, merchant, memo, fingerprint,
  source_ref, status, classification_meta, owner_scope, owner_person_profile_id
)
SELECT
  gen_random_uuid(),
  '10000000-0000-0000-0000-000000000001'::uuid,
  account_id::uuid,
  NULL::uuid,
  NULL::uuid,
  (date_trunc('month', CURRENT_DATE) - (m_offset * INTERVAL '1 month'))::date
    + (day_offset * INTERVAL '1 day'),
  amount,
  'debit',
  merchant,
  NULL,
  md5('dev-rolling-v1-' || account_id || '-' || m_offset::text || '-' || day_offset::text),
  'manual:dev-rolling',
  'posted',
  '{"source":"manual"}'::jsonb,
  'household',
  NULL::uuid
FROM (VALUES
  -- ================================================================
  -- BoA Checking (checking, asset)
  -- M0 total $1,480 | M-1..M-5 ~$1,300 | M-12 $1,170
  -- MoM delta: +13.8% → ↑ gold   YoY delta: +26.5% → ↑ gold
  -- ================================================================
  -- M0
  (0::int, 4::int,  '40000000-0000-0000-0000-000000000001', -1250.00::numeric, 'LANDLORD RENT PAYMENT'),
  (0,      10,      '40000000-0000-0000-0000-000000000001', -150.00,           'PGE ELECTRIC BILL'),
  (0,      17,      '40000000-0000-0000-0000-000000000001', -80.00,            'COMCAST INTERNET'),
  -- M-1
  (1,  4,  '40000000-0000-0000-0000-000000000001', -1100.00, 'LANDLORD RENT PAYMENT'),
  (1,  10, '40000000-0000-0000-0000-000000000001', -120.00,  'PGE ELECTRIC BILL'),
  (1,  17, '40000000-0000-0000-0000-000000000001', -80.00,   'COMCAST INTERNET'),
  -- M-2
  (2,  4,  '40000000-0000-0000-0000-000000000001', -1100.00, 'LANDLORD RENT PAYMENT'),
  (2,  10, '40000000-0000-0000-0000-000000000001', -125.00,  'PGE ELECTRIC BILL'),
  (2,  17, '40000000-0000-0000-0000-000000000001', -80.00,   'COMCAST INTERNET'),
  -- M-3
  (3,  4,  '40000000-0000-0000-0000-000000000001', -1100.00, 'LANDLORD RENT PAYMENT'),
  (3,  10, '40000000-0000-0000-0000-000000000001', -130.00,  'PGE ELECTRIC BILL'),
  (3,  17, '40000000-0000-0000-0000-000000000001', -80.00,   'COMCAST INTERNET'),
  -- M-4
  (4,  4,  '40000000-0000-0000-0000-000000000001', -1100.00, 'LANDLORD RENT PAYMENT'),
  (4,  10, '40000000-0000-0000-0000-000000000001', -128.00,  'PGE ELECTRIC BILL'),
  (4,  17, '40000000-0000-0000-0000-000000000001', -80.00,   'COMCAST INTERNET'),
  -- M-5
  (5,  4,  '40000000-0000-0000-0000-000000000001', -1100.00, 'LANDLORD RENT PAYMENT'),
  (5,  10, '40000000-0000-0000-0000-000000000001', -122.00,  'PGE ELECTRIC BILL'),
  (5,  17, '40000000-0000-0000-0000-000000000001', -80.00,   'COMCAST INTERNET'),
  -- M-12 (same month last year)
  (12, 4,  '40000000-0000-0000-0000-000000000001', -1000.00, 'LANDLORD RENT PAYMENT'),
  (12, 10, '40000000-0000-0000-0000-000000000001', -100.00,  'PGE ELECTRIC BILL'),
  (12, 17, '40000000-0000-0000-0000-000000000001', -70.00,   'COMCAST INTERNET'),

  -- ================================================================
  -- BoA Credit Card (credit_card, liability)
  -- M0 total $1,200 | M-1..M-5 ~$900 | M-12 $2,000
  -- MoM delta: +33.3% → ↑ terracotta   YoY delta: -40% → ↓ forest
  -- ================================================================
  -- M0
  (0,  5,  '40000000-0000-0000-0000-000000000003', -800.00,  'AMAZON MARKETPLACE'),
  (0,  11, '40000000-0000-0000-0000-000000000003', -250.00,  'WHOLE FOODS MARKET'),
  (0,  18, '40000000-0000-0000-0000-000000000003', -150.00,  'SHELL OIL GAS'),
  -- M-1
  (1,  5,  '40000000-0000-0000-0000-000000000003', -600.00,  'AMAZON MARKETPLACE'),
  (1,  11, '40000000-0000-0000-0000-000000000003', -180.00,  'WHOLE FOODS MARKET'),
  (1,  18, '40000000-0000-0000-0000-000000000003', -120.00,  'SHELL OIL GAS'),
  -- M-2
  (2,  5,  '40000000-0000-0000-0000-000000000003', -650.00,  'AMAZON MARKETPLACE'),
  (2,  11, '40000000-0000-0000-0000-000000000003', -190.00,  'WHOLE FOODS MARKET'),
  (2,  18, '40000000-0000-0000-0000-000000000003', -130.00,  'SHELL OIL GAS'),
  -- M-3
  (3,  5,  '40000000-0000-0000-0000-000000000003', -680.00,  'AMAZON MARKETPLACE'),
  (3,  11, '40000000-0000-0000-0000-000000000003', -200.00,  'WHOLE FOODS MARKET'),
  (3,  18, '40000000-0000-0000-0000-000000000003', -140.00,  'SHELL OIL GAS'),
  -- M-4
  (4,  5,  '40000000-0000-0000-0000-000000000003', -700.00,  'AMAZON MARKETPLACE'),
  (4,  11, '40000000-0000-0000-0000-000000000003', -195.00,  'WHOLE FOODS MARKET'),
  (4,  18, '40000000-0000-0000-0000-000000000003', -135.00,  'SHELL OIL GAS'),
  -- M-5
  (5,  5,  '40000000-0000-0000-0000-000000000003', -720.00,  'AMAZON MARKETPLACE'),
  (5,  11, '40000000-0000-0000-0000-000000000003', -210.00,  'WHOLE FOODS MARKET'),
  (5,  18, '40000000-0000-0000-0000-000000000003', -145.00,  'SHELL OIL GAS'),
  -- M-12 (same month last year)
  (12, 5,  '40000000-0000-0000-0000-000000000003', -1500.00, 'AMAZON MARKETPLACE'),
  (12, 11, '40000000-0000-0000-0000-000000000003', -300.00,  'WHOLE FOODS MARKET'),
  (12, 18, '40000000-0000-0000-0000-000000000003', -200.00,  'SHELL OIL GAS'),

  -- ================================================================
  -- Citi Credit Card (credit_card, liability)
  -- M0 total $580 | M-1..M-5 ~$850 | M-12 $440
  -- MoM delta: -31.8% → ↓ forest   YoY delta: +31.8% → ↑ terracotta
  -- ================================================================
  -- M0
  (0,  6,  '40000000-0000-0000-0000-000000000004', -350.00,  'TARGET STORES'),
  (0,  12, '40000000-0000-0000-0000-000000000004', -150.00,  'COSTCO WHOLESALE'),
  (0,  19, '40000000-0000-0000-0000-000000000004', -80.00,   'APPLE SERVICES'),
  -- M-1
  (1,  6,  '40000000-0000-0000-0000-000000000004', -550.00,  'TARGET STORES'),
  (1,  12, '40000000-0000-0000-0000-000000000004', -210.00,  'COSTCO WHOLESALE'),
  (1,  19, '40000000-0000-0000-0000-000000000004', -90.00,   'APPLE SERVICES'),
  -- M-2
  (2,  6,  '40000000-0000-0000-0000-000000000004', -500.00,  'TARGET STORES'),
  (2,  12, '40000000-0000-0000-0000-000000000004', -195.00,  'COSTCO WHOLESALE'),
  (2,  19, '40000000-0000-0000-0000-000000000004', -85.00,   'APPLE SERVICES'),
  -- M-3
  (3,  6,  '40000000-0000-0000-0000-000000000004', -520.00,  'TARGET STORES'),
  (3,  12, '40000000-0000-0000-0000-000000000004', -200.00,  'COSTCO WHOLESALE'),
  (3,  19, '40000000-0000-0000-0000-000000000004', -88.00,   'APPLE SERVICES'),
  -- M-4
  (4,  6,  '40000000-0000-0000-0000-000000000004', -530.00,  'TARGET STORES'),
  (4,  12, '40000000-0000-0000-0000-000000000004', -205.00,  'COSTCO WHOLESALE'),
  (4,  19, '40000000-0000-0000-0000-000000000004', -90.00,   'APPLE SERVICES'),
  -- M-5
  (5,  6,  '40000000-0000-0000-0000-000000000004', -510.00,  'TARGET STORES'),
  (5,  12, '40000000-0000-0000-0000-000000000004', -198.00,  'COSTCO WHOLESALE'),
  (5,  19, '40000000-0000-0000-0000-000000000004', -87.00,   'APPLE SERVICES'),
  -- M-12 (same month last year)
  (12, 6,  '40000000-0000-0000-0000-000000000004', -280.00,  'TARGET STORES'),
  (12, 12, '40000000-0000-0000-0000-000000000004', -110.00,  'COSTCO WHOLESALE'),
  (12, 19, '40000000-0000-0000-0000-000000000004', -50.00,   'APPLE SERVICES')
) AS t(m_offset, day_offset, account_id, amount, merchant);
