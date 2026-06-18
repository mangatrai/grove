-- PT-11: store CAD-assessed values for Redfin sold comps (§41.43 support)
ALTER TABLE protest_worksheet
  ADD COLUMN IF NOT EXISTS sold_comps_cad_json JSONB NOT NULL DEFAULT '{}'::jsonb;
