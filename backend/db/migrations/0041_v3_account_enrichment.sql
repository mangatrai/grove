-- 0041_v3_account_enrichment.sql
-- F-1: Account enrichment — sub_type, memo, liquidity, linked_account_id
-- F-2: Property entity — property table + property_value_snapshot (time-series)
--
-- Execution order matters:
--   1. Add new columns to financial_account (sub_type needed before data migration)
--   2. Create property and property_value_snapshot tables
--   3. Wire FK constraints (after both tables exist)
--   4. Migrate existing 'mortgage' rows → type='loan', sub_type='mortgage_primary'
--   5. Widen type CHECK (drop old, add new without 'mortgage')

-- ─── 1. New columns on financial_account ─────────────────────────────────────

ALTER TABLE financial_account ADD COLUMN sub_type TEXT;
ALTER TABLE financial_account ADD COLUMN memo TEXT;
ALTER TABLE financial_account ADD COLUMN liquidity TEXT
  CHECK (liquidity IN ('liquid', 'semi_liquid', 'restricted'));
ALTER TABLE financial_account ADD COLUMN linked_account_id TEXT;
ALTER TABLE financial_account ADD COLUMN property_id TEXT;

-- ─── 2. Property tables ───────────────────────────────────────────────────────

CREATE TABLE property (
  id              TEXT        PRIMARY KEY,
  household_id    TEXT        NOT NULL REFERENCES household(id),
  address_line1   TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  country         TEXT        NOT NULL DEFAULT 'US',
  property_use    TEXT        CHECK (property_use IN ('primary', 'rental', 'vacation')),
  api_provider    TEXT,
  api_property_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_property_household ON property (household_id);

CREATE TABLE property_value_snapshot (
  id               TEXT        PRIMARY KEY,
  household_id     TEXT        NOT NULL REFERENCES household(id),
  property_id      TEXT        NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  as_of_date       DATE        NOT NULL,
  market_value_usd NUMERIC     NOT NULL CHECK (market_value_usd >= 0),
  source           TEXT        NOT NULL CHECK (source IN ('manual', 'api')),
  api_provider     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pvs_property_date ON property_value_snapshot (property_id, as_of_date DESC);
CREATE UNIQUE INDEX uq_pvs_property_date ON property_value_snapshot (property_id, as_of_date);

-- ─── 3. FK constraints ────────────────────────────────────────────────────────

ALTER TABLE financial_account
  ADD CONSTRAINT fk_fa_linked_account
  FOREIGN KEY (linked_account_id) REFERENCES financial_account(id) ON DELETE SET NULL;

ALTER TABLE financial_account
  ADD CONSTRAINT fk_fa_property
  FOREIGN KEY (property_id) REFERENCES property(id) ON DELETE SET NULL;

-- ─── 4. Migrate existing 'mortgage' accounts ──────────────────────────────────

UPDATE financial_account
  SET type = 'loan', sub_type = 'mortgage_primary'
  WHERE type = 'mortgage';

-- ─── 5. Widen type CHECK (drop inline constraint, add new without 'mortgage') ─

ALTER TABLE financial_account DROP CONSTRAINT financial_account_type_check;
ALTER TABLE financial_account ADD CONSTRAINT financial_account_type_check
  CHECK (type IN (
    'checking', 'savings', 'credit_card', 'loan',
    'investment', 'retirement', 'payslip', 'health', 'education'
  ));
