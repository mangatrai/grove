-- Epic 3.3+: link payslip snapshot / import file to household employer (UUID in employers_json).
PRAGMA foreign_keys = ON;

ALTER TABLE payslip_snapshot ADD COLUMN employer_id TEXT;
ALTER TABLE import_file ADD COLUMN employer_id TEXT;
