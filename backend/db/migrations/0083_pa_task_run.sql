-- Migration 0083: pa_task_run — BabyAGI-style PA task loop run history (CR-PA2a, #164)
-- Persists each runPATask() invocation: iteration count, findings ledger, compressed history,
-- LLM/Tavily usage, and cost estimate. Operational/ephemeral (see EXPORT_EPHEMERAL_TABLES) —
-- not user data, not restored from backups.

CREATE TABLE pa_task_run (
  id                       TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  household_id             TEXT        NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  goal                     TEXT        NOT NULL,
  origin                   TEXT        NOT NULL DEFAULT 'user'
                             CHECK (origin IN ('user', 'scheduler')),
  status                   TEXT        NOT NULL DEFAULT 'running'
                             CHECK (status IN ('running', 'succeeded', 'failed', 'refused_budget')),
  iterations_used          INT         NOT NULL DEFAULT 0,
  hit_iteration_cap        BOOLEAN     NOT NULL DEFAULT FALSE,
  findings_json            JSONB,
  compressed_history_json  JSONB,
  result_summary           TEXT,
  alert_id                 TEXT,
  prompt_tokens            INT         NOT NULL DEFAULT 0,
  completion_tokens        INT         NOT NULL DEFAULT 0,
  tavily_calls             INT         NOT NULL DEFAULT 0,
  estimated_cost_usd       NUMERIC(8,4),
  loop_model               TEXT,
  synthesis_model          TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at               TIMESTAMPTZ
);

CREATE INDEX pa_task_run_household_created ON pa_task_run (household_id, created_at DESC);
