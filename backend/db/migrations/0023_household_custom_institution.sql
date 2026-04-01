-- Household-scoped custom institution names (supplement curated US list in app).
CREATE TABLE IF NOT EXISTS household_custom_institution (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_household_custom_institution_household_lower_name
  ON household_custom_institution(household_id, lower(display_name));

CREATE INDEX IF NOT EXISTS idx_household_custom_institution_household
  ON household_custom_institution(household_id);
