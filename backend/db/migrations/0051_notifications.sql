CREATE TABLE IF NOT EXISTS notification (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  action_url   TEXT,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_household_user
  ON notification(household_id, user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preference (
  id                TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  enabled_email     BOOLEAN NOT NULL DEFAULT TRUE,
  enabled_inapp     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(user_id, notification_type)
);

ALTER TABLE household
  ADD COLUMN IF NOT EXISTS large_txn_threshold_usd NUMERIC(12,2);
