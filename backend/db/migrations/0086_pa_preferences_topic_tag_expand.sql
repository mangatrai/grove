-- Migration 0086: widen topic_tag enum (CR-PA2c, #239, follow-up to #238)
-- Manual testing surfaced a coverage gap: cuisine/food and hobby/interest facts had nowhere to go
-- except 'other'. Adds 'food' and 'interests' to the bounded topic_tag set.

ALTER TABLE household_pa_preferences DROP CONSTRAINT household_pa_preferences_topic_tag_check;
ALTER TABLE household_pa_preferences ADD CONSTRAINT household_pa_preferences_topic_tag_check
  CHECK (topic_tag IS NULL OR topic_tag IN ('travel', 'school', 'health', 'finance', 'gifts', 'household', 'food', 'interests', 'other'));
