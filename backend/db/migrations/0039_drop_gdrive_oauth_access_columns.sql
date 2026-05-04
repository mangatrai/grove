-- CR-133 follow-up: refresh token alone is sufficient; google-auth-library refreshes access tokens in-process.
ALTER TABLE household_gdrive_config
  DROP COLUMN IF EXISTS oauth2_access_token,
  DROP COLUMN IF EXISTS oauth2_access_token_expires_at;
