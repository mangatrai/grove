-- 0097_payslip_deposit_match_auto_link.sql
-- GH #301 step 5: deposit auto-link with dismiss.
--   link_source  — 'manual' (user linked it) or 'auto' (the auto-linker linked it). Existing rows are manual.
--   dismissed_at — tombstone: the user removed an auto link. The row stays so the auto-linker never re-adds
--                  that payslip/transaction pair; confirmed-link reads filter dismissed_at IS NULL.
ALTER TABLE payslip_deposit_match ADD COLUMN IF NOT EXISTS link_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE payslip_deposit_match ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ NULL;
ALTER TABLE payslip_deposit_match ADD CONSTRAINT payslip_deposit_match_link_source_check
  CHECK (link_source IN ('manual', 'auto'));
