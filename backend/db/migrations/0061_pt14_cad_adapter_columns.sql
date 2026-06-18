-- PT-14: rename DCAD-specific columns to generic CAD names to support multiple county adapters
ALTER TABLE property RENAME COLUMN dcad_property_id TO cad_property_id;
ALTER TABLE property RENAME COLUMN dcad_p_account_id TO cad_account_id;
ALTER TABLE property ADD COLUMN IF NOT EXISTS cad_provider TEXT;

DROP INDEX IF EXISTS uq_protest_comp_property_year_dcadid;
ALTER TABLE protest_comp_cad RENAME COLUMN dcad_property_id TO cad_property_id;
CREATE UNIQUE INDEX uq_protest_comp_property_year_cadid
  ON protest_comp_cad (property_id, tax_year, cad_property_id);
