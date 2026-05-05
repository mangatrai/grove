-- Allow export_job rows to be marked 'expired' when the ZIP file has been
-- purged by the 48-hour auto-cleanup job.
ALTER TABLE export_job DROP CONSTRAINT IF EXISTS export_job_status_check;
ALTER TABLE export_job ADD CONSTRAINT export_job_status_check
  CHECK (status IN ('queued', 'running', 'complete', 'failed', 'expired'));
