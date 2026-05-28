-- dev_0008_seed_properties.sql
-- Dev seed: 2 fictional properties + value snapshots + protest data
-- All addresses, values, and identifiers are invented for testing only — no real data.

-- ─── Properties ──────────────────────────────────────────────────────────────
-- Insert properties first; mortgage account below references property_id.

INSERT INTO property (
  id, household_id,
  address_line1, city, state, zip, country, property_use,
  purchase_price, purchase_date, monthly_rent, property_notes,
  api_provider, api_property_id, api_listing_id,
  valuation_detail_json, valuation_fetched_at,
  created_at, updated_at
) VALUES
(
  'a0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '100 Demo Oak Dr', 'Flower Mound', 'TX', '75028', 'US', 'primary',
  340000, '2018-06-15', NULL, 'Primary residence. Corner lot.',
  'redfin', 'TX-DEMO-001', 'LISTING-TX-001',
  '{
    "county": "Denton",
    "subject": { "beds": 4, "baths": 3, "sqFt": 2800, "yearBuilt": 2005, "stories": 2, "propertyType": "Single Family Residential" },
    "estimate": { "value": 480000, "lowValue": 460000, "highValue": 500000, "updateDate": "2026-05-01" },
    "taxCurrent": { "assessedValue": 385000, "taxesDue": 9200 },
    "taxHistory": [
      { "year": 2025, "assessedValue": 385000, "taxesDue": 9200 },
      { "year": 2024, "assessedValue": 375000, "taxesDue": 8900 },
      { "year": 2023, "assessedValue": 360000, "taxesDue": 8500 },
      { "year": 2022, "assessedValue": 320000, "taxesDue": 7600 }
    ]
  }'::jsonb,
  '2026-05-01 00:00:00+00',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'a0000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '200 Demo Maple Ave', 'Memphis', 'TN', '38112', 'US', 'rental',
  120000, '2020-03-10', 1500, 'Rental property. Long-term lease.',
  'redfin', 'TN-DEMO-002', 'LISTING-TN-002',
  '{
    "county": "Shelby",
    "subject": { "beds": 3, "baths": 2, "sqFt": 1600, "yearBuilt": 1972, "stories": 1, "propertyType": "Single Family Residential" },
    "estimate": { "value": 180000, "lowValue": 165000, "highValue": 195000, "updateDate": "2026-05-01" },
    "taxCurrent": { "assessedValue": 145000, "taxesDue": 2100 },
    "taxHistory": [
      { "year": 2025, "assessedValue": 145000, "taxesDue": 2100 },
      { "year": 2024, "assessedValue": 140000, "taxesDue": 2050 },
      { "year": 2023, "assessedValue": 132000, "taxesDue": 1950 },
      { "year": 2022, "assessedValue": 125000, "taxesDue": 1850 }
    ]
  }'::jsonb,
  '2026-05-01 00:00:00+00',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;

-- ─── Mortgage account linked to TX primary home ───────────────────────────────
-- NOTE: ID was bumped to ...0011 — ...0006 collides with dev_0003 Marcus savings account.

INSERT INTO financial_account (id, household_id, owner_user_id, type, sub_type, institution, account_mask, currency, property_id, created_at)
VALUES (
  '40000000-0000-0000-0000-000000000011',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'loan', 'mortgage_primary', 'Acme Bank', '9001', 'USD',
  'a0000000-0000-0000-0000-000000000001',
  CURRENT_TIMESTAMP
) ON CONFLICT DO NOTHING;

-- ─── Mortgage balance snapshots — feeds equity chart ─────────────────────────
-- Fictional balances for a $340k home purchased 2018, ~7 years into a 30-yr loan.

INSERT INTO account_balance_snapshot (id, household_id, financial_account_id, as_of_date, amount, currency, source, created_at, updated_at)
VALUES
  ('e0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', '2025-10-01', 258000, 'USD', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', '2025-11-01', 257500, 'USD', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', '2025-12-01', 257000, 'USD', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', '2026-01-01', 256500, 'USD', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', '2026-02-01', 256000, 'USD', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', '2026-03-01', 255500, 'USD', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', '2026-04-01', 255000, 'USD', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', '2026-05-01', 254500, 'USD', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- ─── Property value snapshots (8 months — feeds the AVM sparkline) ────────────

INSERT INTO property_value_snapshot (id, household_id, property_id, as_of_date, market_value_usd, source, api_provider, created_at)
VALUES
  -- TX primary home: gradual appreciation
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2025-10-01', 455000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2025-11-01', 460000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2025-12-01', 462000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2026-01-01', 465000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2026-02-01', 470000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2026-03-01', 475000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2026-04-01', 478000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2026-05-01', 480000, 'api', 'redfin', CURRENT_TIMESTAMP),
  -- TN rental: stable with slight dip then recovery
  ('b0000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '2025-10-01', 172000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '2025-11-01', 175000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '2025-12-01', 174000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '2026-01-01', 176000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '2026-02-01', 178000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '2026-03-01', 179000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '2026-04-01', 180000, 'api', 'redfin', CURRENT_TIMESTAMP),
  ('b0000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '2026-05-01', 180000, 'api', 'redfin', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- ─── TX property: protest worksheet + DCAD comparable comps ──────────────────
-- Comps are all assessed below 385k (subject) — supports an overassessment argument.

INSERT INTO protest_worksheet (id, household_id, property_id, tax_year, status, conversation_json, strategy_json, created_at, updated_at)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  2026, 'not_filed',
  '[]'::jsonb,
  NULL,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT DO NOTHING;

INSERT INTO protest_comp_cad (
  id, household_id, property_id, tax_year,
  dcad_property_id, address_line1, city,
  assessed_value_usd, sqft, beds, baths, year_built, per_sqft_usd,
  raw_json, fetched_at
) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 2026,
   'DCAD-DEMO-101', '101 Demo Oak Dr', 'Flower Mound', 370000, 2750, 4, 3, 2005, 134.55, '{"source":"dev-seed"}'::jsonb, CURRENT_TIMESTAMP),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 2026,
   'DCAD-DEMO-102', '102 Demo Oak Dr', 'Flower Mound', 365000, 2710, 4, 2, 2004, 134.69, '{"source":"dev-seed"}'::jsonb, CURRENT_TIMESTAMP),
  ('d0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 2026,
   'DCAD-DEMO-103', '103 Demo Oak Dr', 'Flower Mound', 378000, 2820, 4, 3, 2006, 134.04, '{"source":"dev-seed"}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
