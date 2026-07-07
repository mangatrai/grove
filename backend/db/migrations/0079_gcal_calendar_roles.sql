-- Migration 0079: GCal per-calendar role (FIX #212 — calendar provenance)
-- Stores a JSON object mapping calendar ID -> role ("work" | "school" | "activities" | "other")
-- so the family agent can distinguish a school calendar's events (informational — a school
-- closure does not mean a parent is unavailable) from an actual parent commitment.
-- NULL = no roles saved yet; agent falls back to a name-based heuristic per calendar.

ALTER TABLE oauth_integrations
  ADD COLUMN IF NOT EXISTS calendar_roles TEXT;
