-- Add market_value_usd column to protest_comp_cad so DCAD market values are stored
-- and surfaced in the evidence tables on the protest page.
ALTER TABLE protest_comp_cad ADD COLUMN IF NOT EXISTS market_value_usd NUMERIC;
