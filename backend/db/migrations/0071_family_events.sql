-- Migration 0071: family_events — unified table for Events and Deadlines
-- record_type distinguishes events (activities, appointments) from deadlines.
-- source tracks where the record came from: GCal agent sync, Tavily research, or manual entry.
-- Both Events and Deadlines sub-pages are filtered views of this single table.

CREATE TABLE family_events (
  id                TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id      TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  record_type       TEXT        NOT NULL CHECK (record_type IN ('event', 'deadline')),
  source            TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('gcal', 'tavily', 'manual')),
  title             TEXT        NOT NULL,
  description       TEXT,
  -- Events use start_at / end_at; deadlines use due_date (ISO YYYY-MM-DD text)
  start_at          TIMESTAMPTZ,
  end_at            TIMESTAMPTZ,
  due_date          TEXT,
  location          TEXT,
  is_recurring      BOOLEAN     NOT NULL DEFAULT FALSE,
  recurrence_rule   TEXT,
  all_day           BOOLEAN     NOT NULL DEFAULT FALSE,
  -- JSON array of app_user IDs involved (optional)
  assignee_ids      TEXT,
  -- GCal source metadata
  gcal_event_id     TEXT,
  gcal_calendar_id  TEXT,
  -- Soft delete
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX family_events_household_type ON family_events (household_id, record_type) WHERE is_active = TRUE;
CREATE INDEX family_events_gcal_event_id ON family_events (gcal_event_id) WHERE gcal_event_id IS NOT NULL;
