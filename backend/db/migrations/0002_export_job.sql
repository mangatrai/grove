-- Background household data export jobs (ZIP contains manifest.json + household-bundle.json).
CREATE TABLE IF NOT EXISTS export_job (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  storage_path TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (household_id) REFERENCES household(id),
  FOREIGN KEY (requested_by_user_id) REFERENCES app_user(id)
);

CREATE INDEX IF NOT EXISTS idx_export_job_household_created ON export_job (household_id, created_at DESC);
