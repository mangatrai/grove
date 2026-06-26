-- Migration 0070: GCal calendar selection per user
-- Stores which calendar IDs a user has selected for the family planner agent to use.
-- Stored as a JSON array of calendar ID strings (e.g. '["primary","work@group.calendar.google.com"]').
-- NULL = no preference saved yet; agent falls back to all accessible calendars.

ALTER TABLE oauth_integrations
  ADD COLUMN IF NOT EXISTS selected_calendar_ids TEXT,
  ADD COLUMN IF NOT EXISTS calendars_fetched_at TIMESTAMPTZ;
