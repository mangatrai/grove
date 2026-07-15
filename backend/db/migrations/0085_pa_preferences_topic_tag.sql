-- Migration 0085: topic_tag for household_pa_preferences (CR-PA2b, #238)
-- Sub-issue of #165. Adds a bounded topic_tag enum to discovered_fact/decision_history rows so the
-- PA loop can filter via a search_memory tool instead of full-inclusion (preference rows stay
-- full-included and always have topic_tag = NULL). Also extends source to allow notes_extraction,
-- the LLM-assisted "suggest from notes" write path.

ALTER TABLE household_pa_preferences ADD COLUMN topic_tag TEXT;

ALTER TABLE household_pa_preferences ADD CONSTRAINT household_pa_preferences_topic_tag_check
  CHECK (topic_tag IS NULL OR topic_tag IN ('travel', 'school', 'health', 'finance', 'gifts', 'household', 'other'));

ALTER TABLE household_pa_preferences DROP CONSTRAINT household_pa_preferences_source_check;
ALTER TABLE household_pa_preferences ADD CONSTRAINT household_pa_preferences_source_check
  CHECK (source IN ('manual', 'feedback', 'notes_extraction'));

CREATE INDEX household_pa_preferences_topic_tag ON household_pa_preferences (household_id, category, topic_tag);
