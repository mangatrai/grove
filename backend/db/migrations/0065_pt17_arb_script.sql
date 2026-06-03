-- PT-17: ARB oral script storage
ALTER TABLE protest_worksheet
  ADD COLUMN IF NOT EXISTS arb_script_json JSONB;
