# Database Architecture — Rationale, Index Inventory, and Upgrade Path

## Purpose

This document captures the architectural decision to use PostgreSQL, the reasoning behind it, the current index inventory verified against real query patterns, gaps that were found and fixed (migration `0021`), and the upgrade path if scale ever demands it.

---

## Why PostgreSQL (and not MongoDB or a time-series DB)

### The concern

As `transaction_canonical` and related tables grow over time, will cross-table joins and aggregations become a bottleneck? Would a document store (MongoDB) or a dedicated time-series database be a better fit?

### Data volume reality check

The primary growing table is `transaction_canonical` (one row per ledger entry).

| Scenario | Rows / year | 10-year total |
|---|---|---|
| 1 active household | ~3,000–8,000 | ~80,000 |
| 100 households | ~500,000 | ~5M |
| 10,000 households | ~50M | ~500M |

PostgreSQL handles 500M rows on a well-indexed single node with no drama. The inflection point where you feel pain is north of ~1–5 billion rows with complex cross-household aggregations — a scale this app is unlikely to approach even as a commercially successful self-hosted product.

### Why the data is inherently relational

Every core query in this app is a join:

| Query | Tables involved |
|---|---|
| Ledger list | `transaction_canonical → financial_account → category` |
| Cash summary by category | `transaction_canonical GROUP BY category_id → category (parent rollup)` |
| Budget vs actuals | `transaction_canonical + budget_category → category` |
| Needs Review | `transaction_canonical ← resolution_item` |
| Transfer detection | `transaction_canonical ↔ transaction_canonical` (self-join) |
| Near-duplicate detection | `transaction_canonical ↔ transaction_canonical` (self-join by account/date/amount) |
| Payslip deposit match | `payslip_snapshot → transaction_canonical` (±3-day, 1% tolerance) |
| Balance sheet history | `account_balance_snapshot → financial_account` |

These are textbook relational joins on primary keys and indexed foreign keys. Denormalizing into MongoDB documents would mean embedding category data into every transaction (making category edits a multi-document update nightmare) or doing application-level joins in service code (slower, harder to audit).

### Why ACID matters here

The canonical ingest pipeline does fingerprint dedup, classification, and transfer detection as a single coherent write. Multi-document transactions in MongoDB exist but are heavier, less ergonomic, and add complexity to code that must be correct (the transfer pairing logic is an example of subtle logic that needs transactional guarantees, not just eventual consistency).

### Why MongoDB would be a downgrade

- **Schema flexibility is a liability in finance.** Every row in `transaction_canonical` must have the same shape. Schema enforcement via Postgres constraints + Zod at the API boundary is a feature.
- **Aggregation queries are more painful.** `SELECT SUM(amount), category_id FROM transaction_canonical WHERE household_id=? AND txn_date BETWEEN ? AND ? GROUP BY category_id` in PostgreSQL. In MongoDB this is a multi-stage `$match → $group → $lookup` aggregation pipeline. For financial reporting, SQL is more readable and easier to verify.
- **The hierarchy (parent category rollup) is natural SQL.** MongoDB has no equivalent of a self-referential join resolved in one query.

### Verdict

PostgreSQL is the right choice now and for the foreseeable future for this app's data characteristics: relational, moderate volume, strong ACID requirements, SQL aggregations.

---

## Actual bottlenecks and their PostgreSQL-native fixes

| Bottleneck | Trigger point | Fix (within Postgres) |
|---|---|---|
| Ledger list slow | >100K rows per household | Compound index `(household_id, txn_date DESC, status)` — done in migration `0021` |
| `LIKE '%pattern%'` merchant search | Large row counts | `pg_trgm` extension + GIN trigram index on `merchant`. Note: the `search_document` tsvector column already exists for full-text search via `@@`. |
| Transfer detection self-join | >500K rows | Index on `(household_id, account_id, txn_date)` — done in migration `0021`. Further: narrow the date window (already done: ±2 days) |
| Cash summary / budget aggregations | >1M rows | Materialized view refreshed nightly; or Postgres range partitioning by `(household_id, txn_date)` |
| Very high household count (SaaS) | >10K households | Postgres table partitioning by `household_id` (native, no extension). Citus for distributed Postgres. |

### If time-series volume ever becomes real: TimescaleDB

TimescaleDB is a PostgreSQL extension that adds:
- Automatic time-based chunking (hypertables) — queries touching a date range only scan relevant chunks
- Time-series specific query optimizations (`time_bucket` aggregations)
- Transparent column compression for old data (30–90% size reduction)

It is **transparent**: same SQL, same `postgres` npm client, same application code. Migration path: `CREATE EXTENSION timescaledb`, then `SELECT create_hypertable('transaction_canonical', 'txn_date')`. No application changes.

This is the right "if things get serious" move — not a database migration.

### The decision ladder

```
Now:          Postgres + correct indexes (migration 0021)
Near term:    pg_trgm for merchant text search if LIKE becomes slow
Medium term:  Materialized views for cash summary / budget aggregations
Long term:    Postgres table partitioning by household_id
Further out:  TimescaleDB extension (same client, same SQL)
Nuclear:      Citus / distributed Postgres
Never:        MongoDB (wrong data shape for this domain)
```

---

## Index inventory — verified against actual query patterns

All indexes verified by reading migrations `0001`–`0020` and cross-referencing against query code in `backend/src/modules/`.

### `transaction_canonical` — the hot table

| Index | Columns | Type | Covers |
|---|---|---|---|
| `uq_transaction_canonical_fingerprint` | `(household_id, fingerprint)` WHERE `status NOT IN ('duplicate','trashed')` | Unique partial | Dedup during canonicalize |
| `idx_transaction_canonical_search` | `(search_document)` | GIN | Full-text search via `@@` operator |
| `idx_tc_household_date_status` ✨ | `(household_id, txn_date DESC, status)` | B-tree | **Ledger list, cash summary, budget actuals, transfer detection date window** |
| `idx_tc_household_account_date` ✨ | `(household_id, account_id, txn_date DESC)` | B-tree | **Near-duplicate detection, per-account queries, payslip deposit match** |
| `idx_tc_household_source_ref` ✨ | `(household_id, source_ref)` WHERE `source_ref IS NOT NULL` | Partial B-tree | **Idempotency guard in canonical ingest** |
| `idx_tc_transfer_group` ✨ | `(household_id, transfer_group_id)` WHERE `transfer_group_id IS NOT NULL` | Partial B-tree | **Transfer group lookups** |

✨ = added in migration `0021` (were missing before).

**Gap that remains (deferred):** `(account_id, reference_id)` for `WHERE account_id=? AND reference_id=?` during ingest. Only relevant for bank adapters that emit reference IDs (BoA checks). Low priority; add when a second reference-ID adapter ships.

### `resolution_item` — had zero indexes before `0021`

| Index | Columns | Covers |
|---|---|---|
| `idx_ri_household_status_type` ✨ | `(household_id, status, type)` | Count by type (dashboard summary), list by status/type |
| `idx_ri_household_target` ✨ | `(household_id, target_id)` | Per-transaction resolution lookup, close-by-target updates |

### `transaction_raw`

| Index | Columns | Covers |
|---|---|---|
| `idx_transaction_raw_file_id` ✨ | `(file_id)` | Canonical ingest: join raw rows by file |

### `import_session`

| Index | Columns | Covers |
|---|---|---|
| `idx_import_session_household_started` ✨ | `(household_id, started_at DESC)` | Session listing by household, newest first |

### `account_balance_snapshot`

| Index | Columns | Covers |
|---|---|---|
| `idx_account_balance_snapshot_household` | `(household_id)` | Household-scoped queries (already existed) |
| `idx_abs_household_account_date` ✨ | `(household_id, financial_account_id, as_of_date DESC)` | Balance sheet history per account |

### `financial_account`

| Index | Columns | Covers |
|---|---|---|
| `idx_financial_account_household` ✨ | `(household_id)` | Account listing by household |

### Well-indexed tables (no gaps found)

| Table | Notes |
|---|---|
| `category_rule` | `(household_id, enabled, priority, created_at)` — correct for rule lookup order |
| `category_rule_global` | `(enabled, priority, created_at, id)` — correct |
| `payslip_snapshot` | Four indexes including owner-scoped listing — correct |
| `budget_category` | `(household_id, month)` — correct for monthly budget reads |
| `import_file` | Unique on `(session_id, checksum)` — serves as the session file lookup too (leading column) |
| `household_custom_institution` | Two indexes — correct |

---

## Migration reference

- **`0001_baseline.sql`** — full schema + initial indexes
- **`0012_exact_duplicate_review.sql`** — narrowed fingerprint unique index to partial (excludes `duplicate`/`trashed`)
- **`0021_performance_indexes.sql`** — adds 9 missing indexes identified in this audit (April 2026)

---

## When to revisit this document

- When a new table with >10K rows/household is added
- When a new query pattern appears that scans `transaction_canonical` on a column not in the index inventory above
- When a planned feature (FR-13 AI health, FR-15 staff timesheet) introduces new aggregation patterns
- If `EXPLAIN ANALYZE` on the ledger list or cash summary starts showing seq scans on `transaction_canonical`
