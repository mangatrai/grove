-- CR-133: Replace service account JSON with OAuth2 user tokens (personal Drive quota).
ALTER TABLE household_gdrive_config
  ADD COLUMN IF NOT EXISTS oauth2_refresh_token TEXT;

ALTER TABLE household_gdrive_config
  DROP COLUMN IF EXISTS service_account_json;
