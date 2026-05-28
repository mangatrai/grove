-- PT-1: Property tax protest assistant — worksheet and CAD comp cache tables

CREATE TABLE protest_worksheet (
  id              TEXT        PRIMARY KEY,
  household_id    TEXT        NOT NULL REFERENCES household(id),
  property_id     TEXT        NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  tax_year        INTEGER     NOT NULL CHECK (tax_year >= 2020 AND tax_year <= 2050),
  status          TEXT        NOT NULL DEFAULT 'not_filed'
                              CHECK (status IN ('not_filed','filed','informal','arb','resolved')),
  hearing_date    DATE,
  conversation_json  JSONB    NOT NULL DEFAULT '[]'::jsonb,
  strategy_json      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_protest_worksheet_property_year
  ON protest_worksheet (property_id, tax_year);

CREATE INDEX idx_protest_worksheet_household
  ON protest_worksheet (household_id);

CREATE TABLE protest_comp_cad (
  id              TEXT        PRIMARY KEY,
  household_id    TEXT        NOT NULL REFERENCES household(id),
  property_id     TEXT        NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  tax_year        INTEGER     NOT NULL,
  dcad_property_id TEXT       NOT NULL,
  address_line1   TEXT,
  city            TEXT,
  assessed_value_usd INTEGER,
  sqft            NUMERIC,
  beds            NUMERIC,
  baths           NUMERIC,
  year_built      INTEGER,
  per_sqft_usd    NUMERIC,
  raw_json        JSONB,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_protest_comp_property_year_dcadid
  ON protest_comp_cad (property_id, tax_year, dcad_property_id);

CREATE INDEX idx_protest_comp_property_year
  ON protest_comp_cad (property_id, tax_year);
