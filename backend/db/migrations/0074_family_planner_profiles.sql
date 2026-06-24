-- V6 Family Planner: person profile extensions + household help roster
-- GH #135

-- Interests (chips/tags) and freeform sticky note per household member.
-- Applies to all profiles — kids, spouse, nanny, anyone in the household orbit.
ALTER TABLE person_profile
  ADD COLUMN IF NOT EXISTS interests_json TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Unified schedule roster for ALL household help.
-- slot_type = scheduling pattern (regular / one_off / unavailable)
-- service_type = what service (nanny / babysitter / cleaner / activity_teacher / tutor / other)
-- These two dimensions are orthogonal — together with label they give the agent full context.
CREATE TABLE IF NOT EXISTS household_help_availability (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id      TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  person_profile_id TEXT NOT NULL REFERENCES person_profile(id) ON DELETE CASCADE,

  slot_type         TEXT NOT NULL CHECK (slot_type IN ('regular', 'one_off', 'unavailable')),
  service_type      TEXT NOT NULL DEFAULT 'other'
                    CHECK (service_type IN ('nanny', 'babysitter', 'cleaner', 'activity_teacher', 'tutor', 'other')),

  -- regular slots: day_of_week (0=Sun…6=Sat) + optional start_time / end_time
  -- one_off / unavailable: specific_date (YYYY-MM-DD) + optional times
  day_of_week       INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  specific_date     TEXT,
  start_time        TEXT,
  end_time          TEXT,

  label             TEXT,
  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hha_household ON household_help_availability (household_id);
CREATE INDEX IF NOT EXISTS idx_hha_person    ON household_help_availability (person_profile_id);
CREATE INDEX IF NOT EXISTS idx_hha_active    ON household_help_availability (household_id, is_active, slot_type);
