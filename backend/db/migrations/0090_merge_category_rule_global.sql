-- Migration 0090: merge category_rule_global into category_rule (DEBT #258)
-- Mirrors the nullable-household_id-means-system-default pattern category already uses.
-- household_id IS NULL rows are global/built-in rules, visible to every household.

ALTER TABLE category_rule ALTER COLUMN household_id DROP NOT NULL;
ALTER TABLE category_rule ADD COLUMN rule_key TEXT;

CREATE UNIQUE INDEX category_rule_rule_key_global_unique
  ON category_rule (rule_key)
  WHERE household_id IS NULL;

INSERT INTO category_rule (id, household_id, rule_key, pattern, match_type, category_id, confidence, amount_scope, priority, enabled, created_at, updated_at)
  SELECT id, NULL, rule_key, pattern, match_type, category_id, confidence, amount_scope, priority, enabled, created_at, updated_at
    FROM category_rule_global;

DROP TABLE category_rule_global;
