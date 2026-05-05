CREATE TABLE household_gdrive_config (
  household_id          TEXT PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  service_account_json  TEXT NOT NULL,
  folder_id             TEXT NOT NULL,
  folder_name           TEXT,
  connected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_by_user_id  TEXT NOT NULL REFERENCES app_user(id),
  last_verified_at      TIMESTAMPTZ,
  last_error            TEXT
);
