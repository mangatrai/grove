-- Migration 0076: three targeted fixes for V6 family module
-- 1. Allow age=0 on person_profile (infants are zero years old)
-- 2. Add 'employee' to household_membership.relationship (for nannies, cleaners, etc.)
-- 3. Change day_of_week INTEGER → days_of_week TEXT on household_help_availability
--    so a single schedule slot can cover multiple days (e.g. "1,3,5" = Mon/Wed/Fri)

-- 1. Widen person_profile age constraint to allow 0
ALTER TABLE person_profile DROP CONSTRAINT IF EXISTS person_profile_age_check;
ALTER TABLE person_profile
  ADD CONSTRAINT person_profile_age_check
  CHECK (age IS NULL OR (age >= 0 AND age < 130));

-- 2. Widen household_membership relationship enum to include 'employee'
ALTER TABLE household_membership DROP CONSTRAINT IF EXISTS household_membership_relationship_check;
ALTER TABLE household_membership
  ADD CONSTRAINT household_membership_relationship_check
  CHECK (relationship IN ('self', 'spouse', 'child', 'dependent', 'employee', 'other'));

-- 3. Migrate day_of_week INTEGER → days_of_week TEXT
--    Existing single-day rows get converted: 1 → '1', NULL stays NULL
ALTER TABLE household_help_availability ADD COLUMN days_of_week TEXT;
UPDATE household_help_availability
  SET days_of_week = day_of_week::text
  WHERE day_of_week IS NOT NULL;
ALTER TABLE household_help_availability DROP COLUMN day_of_week;
