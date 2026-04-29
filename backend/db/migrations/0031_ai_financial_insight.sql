-- CR-124: AI Financial Health Analysis

ALTER TABLE household
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS combined_gross_income_usd DOUBLE PRECISION;

ALTER TABLE person_profile
  ADD COLUMN IF NOT EXISTS age INTEGER CHECK (age IS NULL OR (age > 0 AND age < 130)),
  ADD COLUMN IF NOT EXISTS sex TEXT CHECK (sex IS NULL OR sex IN ('male', 'female', 'nonbinary', 'prefer_not_to_say')),
  ADD COLUMN IF NOT EXISTS individual_gross_income_usd DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS risk_tolerance TEXT CHECK (risk_tolerance IS NULL OR risk_tolerance IN ('conservative', 'moderate', 'aggressive')),
  ADD COLUMN IF NOT EXISTS financial_goals_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE household_ai_insight (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('household', 'personal')),
  user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_household_ai_insight_lookup
  ON household_ai_insight (household_id, scope, user_id, generated_at DESC);

CREATE TABLE insight_job (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  requested_by_user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('household', 'personal')),
  target_user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  error_text TEXT,
  insight_id TEXT REFERENCES household_ai_insight(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
