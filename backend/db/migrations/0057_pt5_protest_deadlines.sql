ALTER TABLE protest_worksheet
  ADD COLUMN IF NOT EXISTS filing_deadline DATE,
  ADD COLUMN IF NOT EXISTS cad_portal_url TEXT;
