-- RE-1: Add user-editable property metadata fields
ALTER TABLE property ADD COLUMN IF NOT EXISTS purchase_price  INTEGER;
ALTER TABLE property ADD COLUMN IF NOT EXISTS purchase_date   DATE;
ALTER TABLE property ADD COLUMN IF NOT EXISTS monthly_rent    INTEGER;
ALTER TABLE property ADD COLUMN IF NOT EXISTS property_notes  TEXT;
