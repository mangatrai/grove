-- Migration 0040: add transfer_excluded flag to transaction_canonical
-- Allows users to permanently exclude a transaction from future transfer detection.
-- Set when user dismisses a transfer_ambiguity item as "Not a transfer".
-- Prevents the same canonical row from re-surfacing as a transfer candidate on every import.

ALTER TABLE transaction_canonical
  ADD COLUMN IF NOT EXISTS transfer_excluded BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index: only indexes excluded rows (sparse — most rows will be FALSE).
CREATE INDEX IF NOT EXISTS idx_tc_transfer_excluded
  ON transaction_canonical (household_id)
  WHERE transfer_excluded = TRUE;
