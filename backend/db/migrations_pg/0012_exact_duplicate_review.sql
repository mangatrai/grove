-- CR-080: Allow exact-duplicate canonical rows (status='duplicate') to coexist with the
-- original posted row by narrowing the fingerprint unique index to non-duplicate/non-trashed rows.
--
-- Before: global unique index on (household_id, fingerprint) — any two rows with the same
--         fingerprint were rejected regardless of status.
-- After : partial unique index only on rows where status NOT IN ('duplicate', 'trashed') —
--         a second import of the same transaction can be stored with status='duplicate' for
--         user review without being silently dropped.

DROP INDEX IF EXISTS uq_transaction_canonical_fingerprint;

CREATE UNIQUE INDEX uq_transaction_canonical_fingerprint
  ON transaction_canonical (household_id, fingerprint)
  WHERE status NOT IN ('duplicate', 'trashed');
