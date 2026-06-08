-- Store the DCAD-sourced assessed value for the subject property.
-- Updated each time saveCadSubjectIds runs (refresh-comps / backfill).
-- Used as a fallback when no CAD evidence PDF is uploaded, more current than Redfin's taxCurrent.
ALTER TABLE property ADD COLUMN IF NOT EXISTS cad_assessed_value_usd BIGINT;
