-- CR-074: Add reference_id to transaction_canonical for FITID-based deduplication.
-- OFX/QFX/QBO files carry a FITID (reference_id) per transaction that is a stronger
-- dedup key than the fingerprint alone (fingerprint depends on description normalisation).
-- A partial unique index prevents duplicate FITID imports per account without affecting
-- non-OFX rows (where reference_id is NULL).

ALTER TABLE transaction_canonical ADD COLUMN reference_id TEXT;

CREATE UNIQUE INDEX idx_canonical_acct_ref
  ON transaction_canonical(account_id, reference_id)
  WHERE reference_id IS NOT NULL;
