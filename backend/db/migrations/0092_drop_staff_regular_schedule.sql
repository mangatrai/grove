-- Drop staff_profile.regular_schedule_json: superseded by household_help_availability
-- (slot_type='regular'), the schedule table family-agent.service.ts already reads.
ALTER TABLE staff_profile DROP COLUMN regular_schedule_json;
