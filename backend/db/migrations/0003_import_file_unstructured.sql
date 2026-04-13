ALTER TABLE import_file
  ADD COLUMN unstructured_job_id TEXT,
  ADD COLUMN unstructured_input_file_id TEXT,
  ADD COLUMN unstructured_last_poll_at TIMESTAMPTZ;
