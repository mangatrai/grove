-- 0096_transaction_canonical_auto_generated.sql
-- GH #294: marks a transaction_canonical row as system-created (e.g. the Wallet deposit
-- auto-created when a transaction is categorized as Transfers > Cash withdrawal), so the
-- cascade-on-unlink/delete logic can tell it apart from a genuine user entry.
ALTER TABLE transaction_canonical ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT FALSE;
