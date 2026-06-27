-- FIX-196: add 'suggestion' to family_agent_alerts alert_type check constraint
-- The LLM agent emits alertType="suggestion" for coverage/action suggestions,
-- but the original constraint only included the 4 conflict-style types.
ALTER TABLE family_agent_alerts
  DROP CONSTRAINT family_agent_alerts_alert_type_check;

ALTER TABLE family_agent_alerts
  ADD CONSTRAINT family_agent_alerts_alert_type_check
    CHECK (alert_type IN ('conflict', 'travel', 'coverage_gap', 'deadline_approaching', 'suggestion'));
