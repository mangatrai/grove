-- 0046_d2_realty_valuation.sql
-- D-2: Real estate auto-valuation — extend property table with Redfin IDs and
-- compact valuation detail JSON (AVM estimate, comps, tax history).
--
-- property.api_property_id already exists (F-2 / 0041). We add:
--   api_listing_id         — Redfin listing_id (enables 1-credit /detailsbyid calls)
--   valuation_detail_json  — compact JSONB: estimate, comps, tax history, last-sold
--   valuation_fetched_at   — timestamp of last successful API fetch

ALTER TABLE property ADD COLUMN IF NOT EXISTS api_listing_id       TEXT;
ALTER TABLE property ADD COLUMN IF NOT EXISTS valuation_detail_json JSONB;
ALTER TABLE property ADD COLUMN IF NOT EXISTS valuation_fetched_at  TIMESTAMPTZ;
