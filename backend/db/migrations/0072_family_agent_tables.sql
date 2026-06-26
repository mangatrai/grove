-- Migration 0072: Family agent alerts + digest log + GCal delta sync timestamp

-- ── 1. gcal_last_synced_at on oauth_integrations ──────────────────────────
-- Stores the timestamp of the last GCal event fetch per connected user.
-- Daily runs pass updatedMin=gcal_last_synced_at to only pull changed events.
-- Full fetches (Sunday/Monday digest) do not use this filter.

ALTER TABLE oauth_integrations
  ADD COLUMN IF NOT EXISTS gcal_last_synced_at TIMESTAMPTZ;

-- ── 2. family_agent_alerts ─────────────────────────────────────────────────
-- Agent writes one row per detected conflict. Owner reviews in Agent tab.
-- copy_paste_text is a pre-written message the owner can copy and send manually.

CREATE TABLE family_agent_alerts (
  id                  TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id        TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_type          TEXT        NOT NULL DEFAULT 'conflict'
                        CHECK (alert_type IN ('conflict', 'travel', 'coverage_gap', 'deadline_approaching')),
  reason              TEXT        NOT NULL,
  affected_date       TEXT,
  copy_paste_text     TEXT,
  recipient_hint      TEXT,
  is_resolved         BOOLEAN     NOT NULL DEFAULT FALSE,
  resolved_at         TIMESTAMPTZ,
  resolved_by_user_id TEXT        REFERENCES app_user(id) ON DELETE SET NULL,
  source_digest_id    TEXT
);

CREATE INDEX family_agent_alerts_household ON family_agent_alerts (household_id, is_resolved, detected_at DESC);

-- ── 3. family_digest_log ──────────────────────────────────────────────────
-- One row per agent run. Digest sub-types: sunday_preview, monday_digest,
-- daily_delta, manual. Status: sent (email went out), skipped (no conflict on
-- daily delta), error (run failed).

CREATE TABLE family_digest_log (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id    TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  run_type        TEXT        NOT NULL
                    CHECK (run_type IN ('sunday_preview', 'monday_digest', 'daily_delta', 'manual')),
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT        NOT NULL
                    CHECK (status IN ('sent', 'skipped', 'error')),
  skip_reason     TEXT,
  alerts_created  INT         NOT NULL DEFAULT 0,
  emails_sent     INT         NOT NULL DEFAULT 0,
  error_message   TEXT,
  subject_line    TEXT,
  summary_text    TEXT
);

CREATE INDEX family_digest_log_household ON family_digest_log (household_id, run_at DESC);
