CREATE TABLE backup_job (
  id                    TEXT PRIMARY KEY,
  household_id          TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'queued',
  drive_file_id         TEXT,
  drive_file_name       TEXT,
  size_bytes            INTEGER,
  error_text            TEXT,
  triggered_by_user_id  TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX backup_job_household_created ON backup_job (household_id, created_at DESC);
