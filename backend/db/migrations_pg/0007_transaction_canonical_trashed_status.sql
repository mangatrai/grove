-- CR-070: Add 'trashed' to transaction_canonical status check constraint.
-- Trashed rows are soft-deleted: excluded from all reports and ledger views,
-- visible only in the Trash tab, restorable or permanently deletable.

ALTER TABLE transaction_canonical
  DROP CONSTRAINT IF EXISTS transaction_canonical_status_check;

ALTER TABLE transaction_canonical
  ADD CONSTRAINT transaction_canonical_status_check
  CHECK (status IN ('pending', 'posted', 'duplicate', 'unresolved', 'trashed'));
