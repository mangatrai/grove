-- Migration 0084: household_pa_preferences — PA agent memory store (CR-PA2b, #165)
-- Flat table, no embedding column (pgvector explicitly descoped — see #165 issue comments,
-- ratified 2026-07-12 and re-confirmed 2026-07-14). `preference` rows are injected in full into
-- every PA loop prompt (buildCaptureContextHeader). `discovered_fact`/`decision_history` rows and
-- the `topic_tag` column are deferred to sub-issue #238 — this migration ships the base schema only.

CREATE TABLE household_pa_preferences (
  id            SERIAL      PRIMARY KEY,
  household_id  TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  category      TEXT        NOT NULL CHECK (category IN ('preference', 'discovered_fact', 'decision_history')),
  fact_text     TEXT        NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'feedback')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX household_pa_preferences_household_category ON household_pa_preferences (household_id, category);
