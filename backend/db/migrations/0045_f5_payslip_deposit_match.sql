-- 0045_f5_payslip_deposit_match.sql
-- F-5: join table for confirmed net-pay deposit links on payslip_snapshot (1-to-N)
-- Column types are TEXT to match payslip_snapshot / household / transaction_canonical (0001_baseline).

CREATE TABLE IF NOT EXISTS payslip_deposit_match (
  id                       TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  payslip_snapshot_id      TEXT         NOT NULL REFERENCES payslip_snapshot(id)         ON DELETE CASCADE,
  household_id             TEXT         NOT NULL REFERENCES household(id)                ON DELETE CASCADE,
  transaction_canonical_id TEXT         NOT NULL REFERENCES transaction_canonical(id)    ON DELETE CASCADE,
  confirmed_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE (payslip_snapshot_id, transaction_canonical_id)
);

CREATE INDEX IF NOT EXISTS payslip_deposit_match_payslip_idx
  ON payslip_deposit_match (payslip_snapshot_id);
