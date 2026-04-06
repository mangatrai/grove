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
6. Dedupe fingerprint computed; duplicates blocked or routed to **`resolution_item`** queue.
7. Classification and transfer matching run with confidence thresholds.
8. Inbox / Transactions **Needs review** shows unresolved counts and row-level context.
9. User bulk reviews/fixes categories and resolution statuses; optional **undo-import** while session is `review` rolls back that session’s canonical inserts.
10. User **finalizes** the import session (terminal session state); ledger rows are already live from step 5.
11. Posted canonical transactions update dashboards and ledger adapter output.
12. Staged raw files purged per retention policy after successful canonicalize (see USER_GUIDE).

### Planned ledger surface (product backlog)

Editable **memo/description**, **delete** / **bulk delete**, and **bulk recategorize** outside the unknown-category resolution flow are **not implemented**; requirements live in [`USER_GUIDE.md`](USER_GUIDE.md) § Ledger edits (planned).

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

## 6. Dedupe Design (Strict)

### Fingerprint Candidate
`fingerprint = hash(account_id, txn_date, amount, normalized_description, statement_period)`

### Rules
- Exact fingerprint match in posted set => auto mark duplicate.
- Near-match (date/window or description variance) => unresolved queue.
- Never auto-post ambiguous near-duplicates.

### Idempotency
- Reprocessing same file yields zero net new posted transactions.
- Import sessions and file checksums tracked for replay safety.

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
1. Migration path trigger criteria from SQLite to PostgreSQL (dataset size, write contention, or query latency thresholds).
2. Search abstraction shape for future optional OpenSearch read-model indexing.
3. Reconciliation policy escalation path (when/if to move from warn-only to soft-block).
4. First parser-profile institution set lock for implementation: Bank of America checking, Citi credit cards, Chase credit cards.

