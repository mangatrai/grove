-- ESPP-2: qualifying vs disqualifying disposition tracking (closes #285)
-- espp_offering_period: one row per household + offering start date (Jan 1 / Jul 1),
--   FMV manually entered from IRS Form 3922 Box 3 (grant-date FMV).
-- espp_batch.offering_date: derived from purchase_date (start of the semiannual offering).
-- espp_sale.disposition_type: classified from offering_date/purchase_date/sale_date.

CREATE TABLE IF NOT EXISTS espp_offering_period (
  id             TEXT PRIMARY KEY,
  household_id   TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  offering_date  TEXT NOT NULL,                    -- ISO YYYY-MM-DD, always 01-01 or 07-01
  fmv_per_share  NUMERIC(12,4),                     -- FMV at beginning of offering period (Form 3922 Box 3); NULL until entered
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(household_id, offering_date)
);

ALTER TABLE espp_batch ADD COLUMN IF NOT EXISTS offering_date TEXT;
ALTER TABLE espp_sale  ADD COLUMN IF NOT EXISTS disposition_type TEXT CHECK (disposition_type IN ('qualifying', 'disqualifying'));
ALTER TABLE espp_sale  ALTER COLUMN ordinary_income DROP NOT NULL;
ALTER TABLE espp_sale  ALTER COLUMN cap_gain_loss    DROP NOT NULL;

-- Backfill offering_date: semiannual offering periods start Jan 1 / Jul 1 (pure date math, no external dependency)
UPDATE espp_batch SET offering_date =
  CASE WHEN EXTRACT(MONTH FROM purchase_date::date) >= 7
       THEN EXTRACT(YEAR FROM purchase_date::date) || '-07-01'
       ELSE EXTRACT(YEAR FROM purchase_date::date) || '-01-01'
  END
WHERE offering_date IS NULL;

ALTER TABLE espp_batch ALTER COLUMN offering_date SET NOT NULL;

-- Seed one espp_offering_period row (fmv NULL) per distinct offering_date already in use
INSERT INTO espp_offering_period (id, household_id, offering_date, created_at, updated_at)
SELECT gen_random_uuid()::text, d.household_id, d.offering_date, NOW(), NOW()
FROM (SELECT DISTINCT household_id, offering_date FROM espp_batch) d
ON CONFLICT (household_id, offering_date) DO NOTHING;

-- Classify existing sales. Disqualifying-disposition sales keep their already-correct
-- ordinary_income/cap_gain_loss. Qualifying-disposition sales get nulled out — they
-- recompute automatically once the household enters that offering period's FMV.
UPDATE espp_sale s
SET disposition_type = CASE
  WHEN s.sale_date::date >= (b.offering_date::date + interval '2 years')
   AND s.sale_date::date >= (b.purchase_date::date + interval '1 year')
  THEN 'qualifying' ELSE 'disqualifying' END
FROM espp_batch b
WHERE s.batch_id = b.id;

UPDATE espp_sale SET ordinary_income = NULL, cap_gain_loss = NULL WHERE disposition_type = 'qualifying';

CREATE INDEX IF NOT EXISTS idx_espp_offering_period_household
  ON espp_offering_period(household_id, offering_date DESC);
