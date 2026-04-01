PRAGMA foreign_keys = ON;

ALTER TABLE payslip_snapshot ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'household'
  CHECK (owner_scope IN ('household','person'));
ALTER TABLE payslip_snapshot ADD COLUMN owner_person_profile_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_payslip_snapshot_owner_scope
  ON payslip_snapshot (household_id, owner_scope, owner_person_profile_id, created_at DESC);

-- Backfill ownership from import_file where available.
UPDATE payslip_snapshot
SET
  owner_scope = COALESCE(
    (SELECT f.owner_scope FROM import_file f WHERE f.id = payslip_snapshot.import_file_id),
    owner_scope,
    'household'
  ),
  owner_person_profile_id = COALESCE(
    (SELECT f.owner_person_profile_id FROM import_file f WHERE f.id = payslip_snapshot.import_file_id),
    owner_person_profile_id
  )
WHERE import_file_id IS NOT NULL;

