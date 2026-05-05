ALTER TABLE household_gdrive_config
  ADD COLUMN IF NOT EXISTS backup_frequency_hours INT NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS backup_retention_count INT NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS last_scheduled_backup_at TIMESTAMPTZ;
