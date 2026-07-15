-- Migration 0080: family agent alert feedback loop (FIX #208)
-- Captures whether a resolved alert was actually useful, so future runs can calibrate which
-- categories to keep surfacing vs. avoid. NULL = resolved without a disposition (legacy/neutral).

ALTER TABLE family_agent_alerts
  ADD COLUMN IF NOT EXISTS resolution_kind TEXT
    CHECK (resolution_kind IN ('useful', 'not_relevant', 'already_knew'));
