-- Migration 0068: Unified protest_comp table
-- Replaces protest_comp_cad and 4 JSONB blobs in protest_worksheet.
-- Adds richer CAD value columns to property table.

-- ── 1. Create unified protest_comp table ───────────────────────────────────────

CREATE TABLE protest_comp (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  property_id TEXT NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2020 AND 2050),

  -- Where this comp was initially sourced from
  source TEXT NOT NULL DEFAULT 'dcad_search',
  -- 'dcad_search'   — DCAD search API (equity comps, nearby properties)
  -- 'redfin'        — Realty/Redfin API (sold comps)
  -- 'manual'        — user-entered
  -- 'cad_evidence'  — parsed from uploaded CAD evidence PDF

  -- Address
  address_line1 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,

  -- Physical specs (DCAD improvement/features preferred; Redfin as fallback)
  sqft NUMERIC,
  beds NUMERIC,
  baths NUMERIC,
  year_built INTEGER,
  lot_sqft NUMERIC,
  has_pool BOOLEAN,

  -- DCAD identity (populated from search; needed for improvement/features/appeal calls)
  cad_property_id TEXT,    -- pid (stable across years)
  cad_account_id BIGINT,   -- pAccountId for current tax year

  -- DCAD assessed values (from search result for current year)
  cad_land_value_usd INTEGER,
  cad_improvement_value_usd INTEGER,
  cad_market_value_usd INTEGER,
  cad_assessed_value_usd INTEGER,    -- appraisedValue
  cad_per_sqft_assessed NUMERIC,     -- cad_assessed_value_usd / sqft
  cad_deed_date DATE,                -- deedDt from search result row (no extra API call)
  cad_enriched_at TIMESTAMPTZ,

  -- Market evidence data (Redfin or manual; null for DCAD-only comps)
  sold_price_usd INTEGER,
  list_price_usd INTEGER,
  sold_date DATE,
  price_per_sqft NUMERIC,            -- sold_price_usd / sqft

  -- User annotation
  notes TEXT,
  excluded BOOLEAN NOT NULL DEFAULT FALSE,

  -- Raw payloads
  raw_dcad_json JSONB,    -- DCAD search result row
  raw_realty_json JSONB,  -- Realty API comp object

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique by cad_property_id when known (DCAD-enriched rows)
CREATE UNIQUE INDEX protest_comp_by_cad_pid
  ON protest_comp (property_id, tax_year, cad_property_id)
  WHERE cad_property_id IS NOT NULL;

-- Unique by source+address before DCAD enrichment assigns a cad_property_id
CREATE UNIQUE INDEX protest_comp_by_source_addr
  ON protest_comp (property_id, tax_year, source, address_line1)
  WHERE cad_property_id IS NULL;

CREATE INDEX protest_comp_prop_year_idx ON protest_comp (property_id, tax_year);
CREATE INDEX protest_comp_household_idx ON protest_comp (household_id);

-- ── 2. Drop the old protest_comp_cad table (v5 only, not in production) ────────

DROP TABLE IF EXISTS protest_comp_cad;

-- ── 3. Expand property table with richer DCAD value columns ───────────────────

ALTER TABLE property
  -- 7 owner value fields from /valuehistory current year (land/improvement split matters for protest)
  ADD COLUMN IF NOT EXISTS cad_land_value_usd BIGINT,             -- ownerLandValue
  ADD COLUMN IF NOT EXISTS cad_improvement_value_usd BIGINT,      -- ownerImprovementValue
  ADD COLUMN IF NOT EXISTS cad_market_value_usd BIGINT,           -- ownerMarketValue (land+improvement)
  ADD COLUMN IF NOT EXISTS cad_appraised_value_usd BIGINT,        -- ownerAppraisedValue (before homestead cap)
  ADD COLUMN IF NOT EXISTS cad_su_exclusion_value_usd BIGINT,     -- ownerSUExclusionValue (special use)
  ADD COLUMN IF NOT EXISTS cad_tax_limitation_value_usd BIGINT,   -- ownerTaxLimitationValue (homestead cap savings)
  ADD COLUMN IF NOT EXISTS cad_net_appraised_value_usd BIGINT,    -- ownerNetAppraisedValue (what is actually taxed)
  -- Full history + taxable breakdown as JSONB (DCAD API responses)
  ADD COLUMN IF NOT EXISTS cad_value_history_json JSONB,          -- all years from /valuehistory
  ADD COLUMN IF NOT EXISTS cad_taxable_json JSONB,                -- taxing units from /taxable
  -- Improvement details for subject property
  ADD COLUMN IF NOT EXISTS cad_sqft INTEGER,
  ADD COLUMN IF NOT EXISTS cad_beds NUMERIC,
  ADD COLUMN IF NOT EXISTS cad_baths NUMERIC,
  ADD COLUMN IF NOT EXISTS cad_has_pool BOOLEAN,
  ADD COLUMN IF NOT EXISTS cad_enriched_at TIMESTAMPTZ,
  -- Appraisal Notice PDF (from /shownoticelink)
  ADD COLUMN IF NOT EXISTS cad_appraisal_notice_s3id TEXT,
  ADD COLUMN IF NOT EXISTS cad_appraisal_notice_fetched_at TIMESTAMPTZ;

-- Note: existing cad_assessed_value_usd (added in 0067) is kept for backward compat;
-- cad_appraised_value_usd is the canonical going forward.

-- ── 4. Update protest_worksheet: drop JSONB blobs, add appeal_json ─────────────

ALTER TABLE protest_worksheet
  DROP COLUMN IF EXISTS sold_comps_cad_json,
  DROP COLUMN IF EXISTS sold_comps_notes_json,
  DROP COLUMN IF EXISTS excluded_sold_comps_json,
  DROP COLUMN IF EXISTS manual_sold_comps_json,
  ADD COLUMN IF NOT EXISTS appeal_json JSONB;
