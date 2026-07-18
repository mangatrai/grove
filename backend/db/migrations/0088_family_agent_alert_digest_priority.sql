-- Migration 0088: family_agent_alerts.digest_priority (GH #250)
-- Email-ingest-sourced alerts need a priority signal so digest composition can show urgent
-- items (payment_due/deadline/high-urgency) inline in full and count-only nudge the rest.
-- Existing rows default to 'normal' since priority wasn't tracked before this change.

ALTER TABLE family_agent_alerts
  ADD COLUMN digest_priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (digest_priority IN ('urgent', 'normal'));
