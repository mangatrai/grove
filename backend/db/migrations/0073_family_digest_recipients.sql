-- Add recipients tracking to digest log
ALTER TABLE family_digest_log ADD COLUMN recipients_json TEXT;
