-- Migration 0089: fold family_occasion_settings into household_pa_preferences (DEBT #259)
-- family_occasion_settings was a single-boolean-per-household toggle table; household_pa_preferences
-- already exists for exactly this shape of small per-household fact/setting. Stored as
-- category='settings', topic_tag='occasion_nudges', fact_text='true'|'false'.

ALTER TABLE household_pa_preferences DROP CONSTRAINT household_pa_preferences_category_check;
ALTER TABLE household_pa_preferences ADD CONSTRAINT household_pa_preferences_category_check
  CHECK (category IN ('preference', 'discovered_fact', 'decision_history', 'settings'));

ALTER TABLE household_pa_preferences DROP CONSTRAINT household_pa_preferences_topic_tag_check;
ALTER TABLE household_pa_preferences ADD CONSTRAINT household_pa_preferences_topic_tag_check
  CHECK (topic_tag IS NULL OR topic_tag IN ('travel', 'school', 'health', 'finance', 'gifts', 'household', 'food', 'interests', 'other', 'occasion_nudges'));

CREATE UNIQUE INDEX household_pa_preferences_settings_unique
  ON household_pa_preferences (household_id, topic_tag)
  WHERE category = 'settings';

INSERT INTO household_pa_preferences (household_id, category, topic_tag, fact_text, source, updated_at)
  SELECT household_id, 'settings', 'occasion_nudges', enabled::text, 'manual', updated_at
    FROM family_occasion_settings;

DROP TABLE family_occasion_settings;
