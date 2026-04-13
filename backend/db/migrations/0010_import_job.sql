-- CR-078: import_job table for async household restore from ZIP backup
CREATE TABLE import_job (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  requested_by_user_id TEXT NOT NULL REFERENCES app_user(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  storage_path TEXT,
  error_text TEXT,
  stats_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_import_job_household_created
  ON import_job (household_id, created_at DESC);
