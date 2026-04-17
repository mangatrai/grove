-- Performance index audit (April 2026) — see docs/DATABASE_ARCHITECTURE.md
--
-- transaction_canonical had only 2 indexes (fingerprint dedup + GIN full-text search).
-- resolution_item had zero indexes.
-- This migration adds the indexes needed for the hot query paths identified by reading
-- every query in backend/src/modules/ against the migration schema.

-- ── transaction_canonical ────────────────────────────────────────────────────
--
-- Every ledger list, cash summary, budget actuals, and the transfer detection date-window
-- query filters by household_id, then a txn_date range, then status = 'posted'.
-- Without this index every query does a full household partition scan sorted in memory.
CREATE INDEX idx_tc_household_date_status
  ON transaction_canonical (household_id, txn_date DESC, status);

-- Near-duplicate detection during canonical ingest:
--   WHERE household_id=? AND account_id=? AND txn_date=? AND ABS(amount-?)<0.0001
-- Also covers per-account ledger view, payslip deposit match (account + date window).
CREATE INDEX idx_tc_household_account_date
  ON transaction_canonical (household_id, account_id, txn_date DESC);

-- Idempotency guard: on every re-import the ingest checks whether a raw row was already
-- canonicalized via:  WHERE source_ref = ? AND household_id = ?
-- Partial index: source_ref IS NULL for manually-entered transactions — skip those.
CREATE INDEX idx_tc_household_source_ref
  ON transaction_canonical (household_id, source_ref)
  WHERE source_ref IS NOT NULL;

-- Transfer group lookups (resolve both legs, exclude paired transfers from cash flow).
-- Partial index: only rows that are actually in a transfer pair.
CREATE INDEX idx_tc_transfer_group
  ON transaction_canonical (household_id, transfer_group_id)
  WHERE transfer_group_id IS NOT NULL;

-- ── resolution_item ──────────────────────────────────────────────────────────
--
-- Had zero indexes. All queries filter by household_id; most also filter by status and/or type.

-- Dashboard summary (count open items by type), list by status/type, type-filtered queue.
CREATE INDEX idx_ri_household_status_type
  ON resolution_item (household_id, status, type);

-- Per-transaction lookup: finding resolution items for a specific canonical row.
-- Used when closing items after categorisation and when rendering Needs Review detail.
CREATE INDEX idx_ri_household_target
  ON resolution_item (household_id, target_id);

-- ── transaction_raw ──────────────────────────────────────────────────────────
--
-- Canonical ingest reads all raw rows for a session file:
--   SELECT ... FROM transaction_raw WHERE file_id = ? ORDER BY row_index
CREATE INDEX idx_transaction_raw_file_id
  ON transaction_raw (file_id);

-- ── import_session ───────────────────────────────────────────────────────────
--
-- Session listing by household (newest first).
CREATE INDEX idx_import_session_household_started
  ON import_session (household_id, started_at DESC);

-- ── account_balance_snapshot ─────────────────────────────────────────────────
--
-- Balance sheet history query: latest balance per account per household over time.
CREATE INDEX idx_abs_household_account_date
  ON account_balance_snapshot (household_id, financial_account_id, as_of_date DESC);

-- ── financial_account ────────────────────────────────────────────────────────
--
-- Account listing by household (settings page, account picker in ledger/import).
CREATE INDEX idx_financial_account_household
  ON financial_account (household_id);
