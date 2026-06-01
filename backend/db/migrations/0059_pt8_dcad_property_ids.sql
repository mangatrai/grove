-- PT-8: Store subject property's DCAD IDs for account-specific API calls
-- (value history, taxable breakdown, protest/appeal status)
ALTER TABLE property ADD COLUMN IF NOT EXISTS dcad_property_id TEXT;
ALTER TABLE property ADD COLUMN IF NOT EXISTS dcad_p_account_id BIGINT;
