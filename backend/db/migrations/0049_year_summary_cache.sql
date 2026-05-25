-- F-7: Year-End Wrapped — cache table for computed year summary + LLM narrative
CREATE TABLE IF NOT EXISTS year_summary_cache (
  id             BIGSERIAL PRIMARY KEY,
  household_id   TEXT        NOT NULL,
  year           INTEGER     NOT NULL,
  data_json      TEXT        NOT NULL,
  narrative_json TEXT        NOT NULL,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_hash      TEXT        NOT NULL,
  UNIQUE(household_id, year)
);

CREATE INDEX IF NOT EXISTS idx_year_summary_cache_household ON year_summary_cache(household_id);
