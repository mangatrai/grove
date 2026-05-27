-- ESPP-1: ESPP Equity Tracker — purchase batches and sale history
-- espp_batch: one row per IBM ESPP purchase date (upserted on re-import)
-- espp_sale:  time-series, one row per lot disposal

CREATE TABLE IF NOT EXISTS espp_batch (
  id                       TEXT PRIMARY KEY,
  household_id             TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  purchase_date            TEXT NOT NULL,                    -- ISO YYYY-MM-DD
  shares_granted           NUMERIC(12,6) NOT NULL,           -- Allocated (from PDF)
  fmv_per_share            NUMERIC(12,4),                    -- Purchase FMV (PDF only; NULL if CSV-only import)
  cost_basis_per_share     NUMERIC(12,4) NOT NULL,           -- 85% of FMV
  discount_per_share       NUMERIC(12,4),                    -- fmv − cost_basis (NULL if fmv unknown)
  shares_transferred       NUMERIC(12,6) NOT NULL DEFAULT 0, -- Distributed to broker (CSV or PDF)
  payslip_id               TEXT REFERENCES payslip_snapshot(id) ON DELETE SET NULL,
  espp_discount_payslip    NUMERIC(12,2),                    -- IBM authoritative discount (from payslip line item)
  espp_salary_deduction    NUMERIC(12,2),
  espp_other_deduction     NUMERIC(12,2),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(household_id, purchase_date)
);

CREATE TABLE IF NOT EXISTS espp_sale (
  id                       TEXT PRIMARY KEY,
  batch_id                 TEXT NOT NULL REFERENCES espp_batch(id) ON DELETE CASCADE,
  household_id             TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  sale_date                TEXT NOT NULL,                    -- ISO YYYY-MM-DD
  shares_sold              NUMERIC(12,6) NOT NULL,
  sale_price_per_share     NUMERIC(12,4) NOT NULL,
  proceeds                 NUMERIC(12,2) NOT NULL,           -- shares_sold × sale_price
  ordinary_income          NUMERIC(12,2) NOT NULL,           -- discount_per_share × shares_sold
  cap_gain_loss            NUMERIC(12,2) NOT NULL,           -- (sale_price − fmv_per_share) × shares_sold
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_espp_batch_household_date
  ON espp_batch(household_id, purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_espp_sale_batch
  ON espp_sale(batch_id, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_espp_sale_household
  ON espp_sale(household_id, sale_date DESC);
