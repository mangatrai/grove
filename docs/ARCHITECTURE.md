# Architecture (v1)

## 1. Architecture Goals
- Financial correctness first (especially dedupe and transfer semantics).
- Minimal monthly operational friction.
- Self-hosted, LAN-first, no required external dependencies.
- Modular design so parser rules and institution profiles can evolve safely.

## 2. System Overview

### Core Subsystems
1. **Web App**
   - Import inbox, resolution queue, dashboards, manual edits, settings.
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
   - Secure purge of raw files after extraction success + validation checkpoint.

## 3. Deployment Topology
- Single-node deployment suitable for laptop/NAS/mini-PC.
- Components can run as:
  - one monolith process + background worker, or
  - lightweight service split (API + worker + DB).
- Recommended start: monolith + worker + SQLite (WAL mode).

## 4. Data Flow (Happy Path)
1. User uploads statement/payslip files (batch).
2. Import session created; files checksummed and staged.
3. Parser profile selected per file (auto or user-chosen fallback).
4. Extracted rows normalized into canonical schema.
5. Dedupe fingerprint computed; duplicates blocked or routed to unresolved queue.
6. Classification and transfer matching run with confidence thresholds.
7. Inbox displays summary and unresolved counts.
8. User bulk reviews/fixes and finalizes import.
9. Posted canonical transactions update dashboards and ledger adapter output.
10. Raw files purged per retention policy.

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

