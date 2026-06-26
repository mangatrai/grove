-- Migration 0069: Unified oauth_integrations table
-- Replaces household_gdrive_config (household-scoped Drive) with a single table that handles
-- both Google Drive (household-scoped, user_id IS NULL) and Google Calendar (user-scoped,
-- user_id IS NOT NULL, one row per parent). Partial unique indexes enforce one-per-scope
-- because standard UNIQUE constraints treat NULLs as distinct (allowing duplicates).

-- ── 1. Create oauth_integrations ──────────────────────────────────────────────

CREATE TABLE oauth_integrations (
  id                        TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  provider                  TEXT        NOT NULL CHECK (provider IN ('google_drive', 'google_calendar')),
  household_id              TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  -- NULL  = household-scoped (Drive: one shared integration per household)
  -- non-NULL = user-scoped (Calendar: one integration per parent account)
  user_id                   TEXT        REFERENCES app_user(id) ON DELETE CASCADE,
  provider_email            TEXT,
  -- Refresh token persists indefinitely (Google consent screen published to Production).
  -- Access token cached to avoid an extra round-trip on every API call.
  refresh_token             TEXT,
  access_token              TEXT,
  access_token_expiry       TIMESTAMPTZ,
  needs_reauth              BOOLEAN     NOT NULL DEFAULT FALSE,
  last_error                TEXT,
  connected_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_by_user_id      TEXT        REFERENCES app_user(id) ON DELETE SET NULL,
  last_verified_at          TIMESTAMPTZ,
  -- Drive-specific columns (NULL for google_calendar rows)
  folder_id                 TEXT,
  folder_name               TEXT,
  backup_frequency_hours    INT,
  backup_retention_count    INT,
  last_scheduled_backup_at  TIMESTAMPTZ
);

-- One Drive integration per household (user_id is NULL for Drive rows)
CREATE UNIQUE INDEX oauth_integrations_drive_household
  ON oauth_integrations (household_id, provider)
  WHERE user_id IS NULL;

-- One Calendar integration per user
CREATE UNIQUE INDEX oauth_integrations_calendar_user
  ON oauth_integrations (user_id, provider)
  WHERE user_id IS NOT NULL;

-- ── 2. Migrate existing Drive data ────────────────────────────────────────────

INSERT INTO oauth_integrations (
  id,
  provider,
  household_id,
  user_id,
  refresh_token,
  needs_reauth,
  connected_at,
  connected_by_user_id,
  last_verified_at,
  last_error,
  folder_id,
  folder_name,
  backup_frequency_hours,
  backup_retention_count,
  last_scheduled_backup_at
)
SELECT
  gen_random_uuid()::text,
  'google_drive',
  household_id,
  NULL,
  oauth2_refresh_token,
  needs_reauth,
  connected_at,
  connected_by_user_id,
  last_verified_at,
  last_error,
  folder_id,
  folder_name,
  backup_frequency_hours,
  backup_retention_count,
  last_scheduled_backup_at
FROM household_gdrive_config;

-- ── 3. Drop old table ─────────────────────────────────────────────────────────

DROP TABLE household_gdrive_config;
