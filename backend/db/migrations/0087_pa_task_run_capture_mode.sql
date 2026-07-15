-- Migration 0087: pa_task_run.capture_mode (GH #230)
-- Distinguishes one-shot Quick Capture asks from BabyAGI research-loop runs so both can be
-- surfaced in the Run History UI. Every existing row came from the research-loop write path
-- (one-shot asks weren't persisted before this change), so backfill accordingly.

ALTER TABLE pa_task_run ADD COLUMN capture_mode TEXT CHECK (capture_mode IN ('one_shot', 'research_loop'));
UPDATE pa_task_run SET capture_mode = 'research_loop' WHERE capture_mode IS NULL;
