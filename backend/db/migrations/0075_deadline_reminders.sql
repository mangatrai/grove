-- Migration 0075: deadline_reminders — track when 30/7/1-day reminder emails were sent per deadline.
-- Columns are NULL until the cron fires and sends the corresponding reminder.
-- Indexed to speed up the daily reminder scan (deadlines with unsent reminders only).
ALTER TABLE family_events
  ADD COLUMN reminder_30d_sent_at TIMESTAMPTZ,
  ADD COLUMN reminder_7d_sent_at  TIMESTAMPTZ,
  ADD COLUMN reminder_1d_sent_at  TIMESTAMPTZ;

CREATE INDEX family_events_deadline_pending
  ON family_events (household_id, due_date)
  WHERE is_active = TRUE AND record_type = 'deadline' AND due_date IS NOT NULL;
