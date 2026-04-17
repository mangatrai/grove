# Architecture (v1)

## 1. Architecture Goals
- Financial correctness first (especially dedupe and transfer semantics).
- Minimal monthly operational friction.
- Self-hosted, LAN-first, no required external dependencies.
- Modular design so parser rules and institution profiles can evolve safely.

## 2. System Overview

### Ingestion layering (adapters vs canonical persistence)

Bank and card exports are not uniform: CSVs differ in headers, debit/credit splits, summary sections, and encodings; PDFs differ by layout. A single “global” parser for all institutions does not scale and risks silent mis-mapping.

**Layers:**

1. **Intake (session + files)**  
   Multi-file upload, checksums, staged storage, import session lifecycle (already in place).

2. **Per-source adapters (institution × format × product type)**  
   Examples: BoA checking CSV (skip summary block), Citi card CSV (Debit/Credit → signed amount), Chase card CSV, BoA/Citi/Chase PDF profiles.  
   - **Input:** raw file bytes + metadata (filename, MIME, user-selected or auto-detected **profile**), and the **target `financial_account_id`** (which account this file belongs to).  
   - **Output:** rows in a **stable normalized interchange** (e.g. posting date, amount signed, description, optional reference, provenance pointer to raw row/line).  
   Adapters own quirks; they do **not** write business invariants (dedupe fingerprints, transfer rules) — they produce clean candidate rows.

3. **Canonical ingest service (single write path)**  
   One module receives **only** normalized rows + account/household context, writes `transaction_raw` (and later `transaction_canonical`), applies dedupe/classification policies.  
   This keeps correctness logic in one place as new bank adapters are added.

4. **UX: Import Transactions**  
   Flow: user uploads CSV/PDF → **per file**, map to a **household financial account** (and optionally confirm/chosen profile) → **parse** (to `transaction_raw`) → **canonicalize** (to `transaction_canonical`, dedupe, classification, resolution items) → review grid → session **finalize**.  
   **Run import** in the UI chains parse + canonicalize. Ledger rows appear **at canonicalize**, not at finalize; **undo-import** (while session is `review`) removes canonical rows tied to that session’s raw rows. User-facing detail: [`USER_GUIDE.md`](USER_GUIDE.md) § Importing statements.  
   Auto-detect can suggest profile + mapping; user confirmation remains the safety gate for low confidence.

**Shared building blocks:** date/amount parsing helpers, CSV “find header row” / section skipping utilities, reusable tests on **fixtures per institution** (redacted exports).

### Staged uploads on disk (`data/imports/<sessionId>/`)
Uploads are stored as files so the system can **re-read bytes** for parsing and future **re-parse**. Keeping them is valuable for:
- **Re-parse** after parser/profile changes (same file, improved extraction).
- **Audit / dispute** — tie posted numbers back to the exact source export.
- **Recovery** — restore **SQLite + `data/imports`** from backup when both are included.

Operators may still want to **reclaim disk space** after they trust extracted rows. That is **not** silent: planned **Story 2.4** (MVP backlog) adds an **operator cleanup script** (dry-run, confirmation, scope) that removes files and keeps DB pointers consistent.

### Core Subsystems
1. **Web App**
   - **Home (`/`)** = cash dashboard when authenticated; **Import** via header **New import** only (no Import nav item); Import Transactions flow (upload, per-file account mapping, profile selection), resolution queue, ledger, manual edits. See `frontend/README.md` and `docs/archive/DECISIONS_LOG.md` D-013.
2. **Ingestion API**
   - Multi-file upload and import session management.
3. **Parser Engine**
   - Institution-specific profiles for PDF/CSV/Excel extraction.
4. **Normalization and Dedupe**
   - Canonical transaction mapping + strict fingerprinting.
5. **Classification Engine**
   - Category assignment + transfer detection + confidence scoring.
6. **Review Workflow**
   - Bulk approve/edit/assign actions; unresolved item lifecycle.
7. **Ledger Adapter**
   - Integration bridge into Actual Budget-compatible data flow.
8. **Data Store**
   - Canonical relational store for transaction lifecycle and provenance.
9. **Retention Worker**
   - Secure purge of raw files after extraction success + validation checkpoint; **MVP plan:** explicit operator script for staged-import cleanup (see backlog Story 2.4), not only automatic purge.

## 3. Deployment Topology
- Single-node deployment suitable for laptop/NAS/mini-PC.
- Components can run as:
  - one monolith process + background worker, or
  - lightweight service split (API + worker + DB).
- Recommended start: monolith + worker + SQLite (WAL mode).

## 4. Data Flow (Happy Path)
1. User uploads statement/payslip files (batch).
2. Import session created; files checksummed and staged.
3. User maps each file to a target **financial account** (and confirms or selects parser profile when needed).
4. Per-file **adapter** runs on **parse**; outputs rows persisted as **`transaction_raw`**.
5. **Canonical ingest** (**canonicalize**) maps raw rows to **`transaction_canonical`** (posted ledger rows), single write path.
6. Dedupe fingerprint computed. **Exact duplicates** (fingerprint or FITID matches an existing posted row) are inserted with `status = 'duplicate'` and a `resolution_item(duplicate_ambiguity)` — surfaced in Needs Review for user decision (keep → posted, or trash). Nothing is silently dropped. **Near-duplicates** (same amount, compatible description) get a `resolution_item` but no canonical row.
7. Classification and transfer matching run with confidence thresholds.
8. Inbox / Transactions **Needs review** shows unresolved counts and row-level context.
9. User bulk reviews/fixes categories and resolution statuses; optional **undo-import** while session is `review` rolls back that session’s canonical inserts.
10. User **finalizes** the import session (terminal session state); ledger rows are already live from step 5.
11. Posted canonical transactions update dashboards and ledger adapter output.
12. Staged raw files purged per retention policy after successful canonicalize (see USER_GUIDE).

### Planned balance sheet / net worth (product backlog)

The **Net Worth** page (assets vs liabilities, time-slice snapshots, manual balance edits) is shipped — see [`API_BALANCE_SHEET.md`](API_BALANCE_SHEET.md). Statement-level **beginning/ending balances** from BoA CSV/PDF are stored in `import_file.confidence_summary.statementBalances` after parse and also persisted to `account_balance_snapshot` as `source = import`.

### Ledger surface (shipped)

- **Inline memo edit** (CR-107): hover-reveal pencil on any row; separate annotation field, not in the fingerprint.
- **Single/bulk delete** via Trash: soft-delete → Trash tab → permanent delete (`POST /ledger/bulk-delete`, `DELETE /ledger/:id`).
- **Bulk recategorize**: available on both the Needs Review tab (for unknown-category resolution items) and the All (Ledger) tab for any posted rows (CR-113). Reuses `POST /ledger/bulk-category`.

## 5. Key Domain Model (Conceptual)
- `Household`
- `User` (role + visibility scope)
- `FinancialAccount` (asset/liability categories)
- `ImportSession` and `ImportFile`
- `TransactionRaw` (parser output)
- `TransactionCanonical` (normalized, deduped, classifiable)
- `ResolutionItem` (unknown/duplicate/transfer mismatch)
- `Category` and `Rule`
- `PaystubRecord`
- `BalanceSnapshot`

## 6. Dedupe Design

### Fingerprint
`fingerprint = SHA256(household_id + account_id + txn_date + rounded_amount + normalized_description)`

For OFX/QFX imports: **FITID** (`reference_id`) is checked first (stronger dedup key than fingerprint when available).

### Rules (CR-080 behaviour)
- **Exact fingerprint or FITID match in DB** → insert canonical with `status = 'duplicate'`; create `resolution_item(duplicate_ambiguity, kind: 'exact_duplicate')`. Appears in Needs Review.
  - User resolves → canonical promoted to `status = 'posted'` (fresh fingerprint assigned so dedup key stays on original).
  - User trashes → `status = 'trashed'`.
- **Near-match** (same account/date/amount, compatible description) → `resolution_item(duplicate_ambiguity, kind: 'near_duplicate')` only; no canonical row inserted.
- **Idempotency guard** — early `source_ref` check skips any raw row that already has a canonical, so repeated `canonicalize` calls on the same session are safe.
- **In-session dedup** (same fingerprint or FITID seen earlier in the same run) — silent skip; covers duplicate rows within a single file.

### Schema note
`uq_transaction_canonical_fingerprint` is a **partial unique index** (`WHERE status NOT IN ('duplicate', 'trashed')`). This allows a `duplicate`-status row to coexist with the original `posted` row without violating uniqueness. Migration: `0012_exact_duplicate_review.sql`.

### Idempotency summary
- Re-running canonicalize on an already-canonicalized session → all rows caught by the idempotency guard (returns `duplicates = N`, no new DB rows).
- Re-importing the same file in a new session → each row from the previous import is detected as an exact duplicate and inserted for user review.

## 7. Transfer Detection Strategy

### Match Inputs
- amount, date proximity window, account ownership graph, known payment descriptors.

### Matching Outputs
- `transfer_confirmed`
- `transfer_suspected`
- `not_transfer`

### Special Cases
- Credit card purchase: expense + liability increase.
- Credit card payment: asset decrease + liability decrease, no expense.
- Loan payment: split principal/interest when line-item detail exists; else unresolved with helper defaults.

## 8. Categorization Strategy
- Start with compact global category taxonomy (modular/extensible).
- Conservative merchant-rule mapping with confidence score.
- Unknown categories go to unresolved queue.
- Bulk apply category corrections from inbox grid.

**Implementation detail:** DB rules, default keyword rules, dedupe, and transfer detection are summarized in **`docs/IMPORT_CLASSIFICATION.md`** (the `/categories/rules` UI is only custom DB rules).

## 9. Reconciliation Strategy (MVP)
- Validate statement opening/closing balance where available.
- Compute delta from imported canonical postings.
- If mismatch:
  - warn with severity and suspected causes,
  - allow correction workflow,
  - optionally block finalization based on future policy setting.

## 10. Security and Privacy
- Local auth and RBAC.
- Encryption for backups and local persisted secrets.
- No mandatory external API calls.
- Raw statement files removed post-successful extraction checkpoint.
- Provenance retained for auditability of parsed values.

## 11. Performance Targets
- Dashboard renders in <= 2-3s for expected dataset size.
- Import processing in ~20-30s per statement acceptable.
- Batch operations operate on selected rows without per-item reflow bottlenecks.

## 12. Failure Handling
- Parser failure => mark file failed; keep session open.
- Partial session issues => unresolved queue, not silent drop.
- Worker crash mid-import => resumable via session state machine.

## 13. Technology Direction (Pragmatic)
- Backend: TypeScript/Node.js.
- DB: SQLite in WAL mode (MVP system of record).
- Search: SQLite FTS5 virtual tables with BM25 ranking for merchant/memo text search, combined with indexed numeric/date filters.
- UI: React/Next.js (or equivalent modern web stack).
- PDF extraction: local parser libraries only.
- Queue/worker: lightweight DB-backed job queue for simplicity.

## 14. Testing Strategy
- Unit tests for parser profile extractors.
- Golden-file regression tests for each institution template.
- Integration tests for idempotent import and dedupe.
- Scenario tests for credit-card-flow non-double-counting.
- UAT script for monthly close workflow.

## 15. Open Architecture Questions
1. Search abstraction shape for future optional OpenSearch read-model indexing.
2. Reconciliation policy escalation path (when/if to move from warn-only to soft-block).
3. Async canonicalize: for large imports, `POST /imports/sessions/:id/canonicalize` could return a `202 { jobId }` and run in the background (same process poller or separate worker), with the client polling `GET /imports/sessions/:id/canonicalize/status`. Tracked: GitHub [#12](https://github.com/mangatrai/household-finance-app/issues/12).

## 16. Database tooling reference

| Script / path | Role |
|----------------|------|
| [`scripts/db-pg.mjs`](../scripts/db-pg.mjs) | Apply `migrations` + optional `seeds` |
| [`scripts/preset-pg-test.mjs`](../scripts/preset-pg-test.mjs) | Reset `public` schema for tests |
| [`scripts/db.sh`](../scripts/db.sh) | Wraps `db-pg.mjs` |
| [`scripts/prep-test-db.sh`](../scripts/prep-test-db.sh) | Preset + clean import staging dirs |
| [`docker-compose.yml`](../docker-compose.yml) | Local Postgres 18 on host port **5433** |

Full env var reference: [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md). Operator Q&A and Postgres connection shape: [`RUNBOOK.md`](RUNBOOK.md) §11.

