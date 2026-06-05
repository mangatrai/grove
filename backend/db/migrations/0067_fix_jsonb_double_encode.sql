-- Repair protest_worksheet JSONB columns that were double-encoded as JSON strings.
-- saveCadEvidence, saveManualSoldComps, saveSoldCompsCadCache, and saveArbScript
-- were passing JSON.stringify(...) to JSONB params, causing the postgres driver to
-- store a JSON string value instead of an object/array.
-- Note: excluded_sold_comps_json is TEXT, not JSONB — JSON.stringify is correct there.
-- `(col #>> '{}')::jsonb` extracts the raw string content and re-parses it as JSONB.
-- The WHERE guard (jsonb_typeof = 'string') is a no-op on clean rows.

UPDATE protest_worksheet
SET
  cad_evidence_json      = CASE WHEN jsonb_typeof(cad_evidence_json)      = 'string' THEN (cad_evidence_json      #>> '{}')::jsonb ELSE cad_evidence_json      END,
  manual_sold_comps_json = CASE WHEN jsonb_typeof(manual_sold_comps_json) = 'string' THEN (manual_sold_comps_json #>> '{}')::jsonb ELSE manual_sold_comps_json END,
  sold_comps_cad_json    = CASE WHEN jsonb_typeof(sold_comps_cad_json)    = 'string' THEN (sold_comps_cad_json    #>> '{}')::jsonb ELSE sold_comps_cad_json    END,
  arb_script_json        = CASE WHEN jsonb_typeof(arb_script_json)        = 'string' THEN (arb_script_json        #>> '{}')::jsonb ELSE arb_script_json        END
WHERE
  jsonb_typeof(cad_evidence_json)      = 'string'
  OR jsonb_typeof(manual_sold_comps_json) = 'string'
  OR jsonb_typeof(sold_comps_cad_json)    = 'string'
  OR jsonb_typeof(arb_script_json)        = 'string';
