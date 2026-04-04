-- Prevent duplicate file content within the same import session (strict dedupe at intake).
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_file_session_checksum
  ON import_file (session_id, checksum);
