-- Migration 0082: occasion-nudge settings toggle (#223)
-- Per-household on/off switch for birthday/holiday lead-time nudges.

CREATE TABLE family_occasion_settings (
  household_id  TEXT        NOT NULL PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
