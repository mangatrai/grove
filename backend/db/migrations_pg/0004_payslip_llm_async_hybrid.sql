-- Async LLM payslip import (Deloitte → openai_llm_payslip) + hybrid snapshot storage.

ALTER TABLE import_file
  ADD COLUMN payslip_async_provider TEXT,
  ADD COLUMN payslip_async_last_poll_at TIMESTAMPTZ;

COMMENT ON COLUMN import_file.payslip_async_provider IS 'e.g. openai_llm_payslip when queued for background LLM extract';
COMMENT ON COLUMN import_file.payslip_async_last_poll_at IS 'Throttle background reconcile polls (same role as former unstructured_last_poll_at for LLM path)';

ALTER TABLE payslip_snapshot
  ADD COLUMN canonical_extract_json TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN currency TEXT,
  ADD COLUMN employer_display_name TEXT,
  ADD COLUMN employee_display_name TEXT,
  ADD COLUMN employer_ein_or_fein TEXT,
  ADD COLUMN employee_id TEXT,
  ADD COLUMN personnel_number TEXT,
  ADD COLUMN talent_id TEXT,
  ADD COLUMN tax_profile_json TEXT,
  ADD COLUMN payment_summary_json TEXT,
  ADD COLUMN extraction_metadata_json TEXT,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN payslip_snapshot.canonical_extract_json IS 'Full validated LLM payslip JSON (PayslipLlmExtract) when parser uses LLM path';
COMMENT ON COLUMN payslip_snapshot.extraction_metadata_json IS 'Subset: page_count, parser_source, extraction_model, extracted_at';

CREATE INDEX idx_import_file_payslip_async_pending
  ON import_file (session_id, status, payslip_async_provider)
  WHERE status = 'processing' AND payslip_async_provider IS NOT NULL;
