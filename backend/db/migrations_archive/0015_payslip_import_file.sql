-- Link payslip_snapshot to import intake (Epic 3.3 — unified import).
PRAGMA foreign_keys = ON;

ALTER TABLE payslip_snapshot ADD COLUMN import_file_id TEXT REFERENCES import_file(id);

CREATE INDEX IF NOT EXISTS idx_payslip_snapshot_import_file
  ON payslip_snapshot(import_file_id);
