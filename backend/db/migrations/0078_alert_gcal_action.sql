-- Migration 0078: GCal write-back action fields on family_agent_alerts
ALTER TABLE family_agent_alerts
  ADD COLUMN IF NOT EXISTS action_type TEXT CHECK (action_type IN ('create_gcal_event')),
  ADD COLUMN IF NOT EXISTS action_payload JSONB;
