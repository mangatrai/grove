-- PS-5 Phase 1: store federal and total tax rates at import time (CR-207)
-- Eliminates brittle runtime line-item scanning in TaxSufficiencyAlert.
ALTER TABLE payslip_snapshot
  ADD COLUMN effective_federal_rate_ytd NUMERIC,
  ADD COLUMN effective_total_tax_rate_ytd NUMERIC;

COMMENT ON COLUMN payslip_snapshot.effective_federal_rate_ytd IS
  'Federal income tax YTD ÷ gross YTD (decimal ratio, e.g. 0.22). Computed at import; null for snapshots imported before migration 0048.';
COMMENT ON COLUMN payslip_snapshot.effective_total_tax_rate_ytd IS
  'All employee taxes YTD ÷ gross YTD (decimal ratio). Computed at import; null for snapshots imported before migration 0048.';
