ALTER TABLE protest_worksheet
  ADD COLUMN IF NOT EXISTS manual_sold_comps_json JSONB NOT NULL DEFAULT '[]'::jsonb;
