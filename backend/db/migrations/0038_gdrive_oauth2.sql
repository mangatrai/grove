-- CR-133: Replace service account JSON with OAuth2 user tokens (personal Drive quota).
ALTER TABLE household_gdrive_config
  ADD COLUMN IF NOT EXISTS oauth2_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS oauth2_access_token TEXT,
  ADD COLUMN IF NOT EXISTS oauth2_access_token_expires_at TIMESTAMPTZ;

ALTER TABLE household_gdrive_config
  DROP COLUMN IF EXISTS service_account_json;
