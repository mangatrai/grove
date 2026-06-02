ALTER TABLE protest_worksheet
  ADD COLUMN IF NOT EXISTS cad_evidence_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cad_evidence_filename  TEXT,
  ADD COLUMN IF NOT EXISTS sold_comps_notes_json  JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE protest_comp_cad
  ADD COLUMN IF NOT EXISTS notes TEXT;
