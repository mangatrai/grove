# MVP Backlog (Epics -> Stories -> Tasks)

## Planning Notes
- Estimation scale: `S` (0.5-1 day), `M` (1-3 days), `L` (3-5 days), `XL` (5+ days).
- Priority: `P0` required for v1, `P1` next.
- Order below reflects execution sequence and dependencies.

---

## Epic 1: Foundation and Project Skeleton (P0)
**Goal:** establish reliable technical baseline and domain model scaffolding.

### Story 1.1 - Project bootstrap
- Tasks:
  - Initialize backend/frontend workspace structure. (M)
  - Configure environment templates and local run scripts. (S)
  - Add baseline lint/test setup. (S)
- Acceptance:
  - Fresh clone runs app and tests locally with one command path.

### Story 1.2 - Core domain schema v1
- Tasks:
  - Create DB schema for household/user/account/import/transactions/resolution. (L)
  - Add migration strategy and seed defaults. (M)
  - Add SQLite migration runner and WAL initialization on startup. (M)
- Acceptance:
  - Migrations apply cleanly and seed data supports smoke test.
  - Backup/restore dry run works by copying DB file + applying pending migrations.

### Story 1.3 - Auth + RBAC baseline
- Tasks:
  - Implement local auth and session handling. (M)
  - Implement role guards for owner/member visibility rules. (M)
- Acceptance:
  - Owner can view all; member limited to own scope.

### Story 1.4 - Local operations scripts baseline
- Tasks:
  - Create setup script to install dependencies and bootstrap local DB/runtime prerequisites. (S)
  - Create schema script to initialize tables and run pending migrations idempotently. (S)
  - Create service lifecycle script to start/stop frontend+backend background services via flags. (M)
- Acceptance:
  - Fresh machine setup succeeds with one setup command path.
  - Schema bootstrap runs cleanly on first and repeated executions.
  - Services can be started and stopped using the same script and flags.

---

## Epic 2: Import Session and File Intake (P0)
**Goal:** ingest batches safely with traceability.

### Story 2.1 - Multi-file upload and session state machine
- Tasks:
  - API endpoint for batch file upload. (M)
  - Import session lifecycle: created -> processing -> review -> finalized. (M)
  - File checksum and provenance persistence. (M)
- Acceptance:
  - Session tracks all uploaded files and statuses.

### Story 2.2 - Input adapters (CSV/Excel first)
- Tasks:
  - Build adapter interface and parser profile registry. (M)
  - Implement CSV parser with configurable mapping. (M)
  - Implement Excel parser for common tabular patterns. (M)
- Acceptance:
  - CSV/Excel files parse into canonical raw records.

---

## Epic 3: PDF Parsing Framework (P0)
**Goal:** support institution-template PDF extraction with confidence scoring.

### Story 3.1 - PDF parser abstraction and profile contract
- Tasks:
  - Define parser profile interface (detect/extract/normalize/confidence). (M)
  - Implement profile auto-detection heuristics. (M)
- Acceptance:
  - Framework can host multiple institution-specific profiles.

### Story 3.2 - First 3 institution profiles
- Tasks:
  - Build and test 3 profile extractors from sample statements:
    - Bank of America checking,
    - Citi credit cards,
    - Chase credit cards. (XL)
  - Add golden fixtures and regression tests. (L)
- Acceptance:
  - Target statements parse with acceptable field completeness.

### Story 3.3 - Payslip profile framework
- Tasks:
  - Implement paystub profile contract and table mappings. (L)
  - Parse gross/net/tax/deduction detail into structured record. (L)
- Acceptance:
  - Payslip ingestion stores line-item totals and details.

---

## Epic 4: Canonicalization and Strict Dedupe (P0)
**Goal:** prevent duplicate posting and preserve correctness.

### Story 4.1 - Canonical transaction mapping
- Tasks:
  - Map parser output to canonical transaction model. (M)
  - Normalize descriptions and date/amount signs. (M)
- Acceptance:
  - Canonical rows generated consistently across input formats.

### Story 4.2 - Fingerprint dedupe engine
- Tasks:
  - Implement deterministic fingerprinting and duplicate checks. (L)
  - Add near-duplicate detection path to unresolved queue. (M)
  - Add idempotency tests for re-imported files. (M)
- Acceptance:
  - Re-uploading same file produces zero duplicate posted rows.

---

## Epic 5: Classification and Transfer Matching (P0)
**Goal:** classify usable data while minimizing false positives.

### Story 5.1 - Category taxonomy and baseline rule engine
- Tasks:
  - Seed compact household category taxonomy with modular extension path. (S)
  - Add conservative merchant-pattern rules with confidence. (M)
- Acceptance:
  - Known merchants auto-categorize; unknowns route to unresolved.

### Story 5.2 - Transfer matcher
- Tasks:
  - Implement amount/date/account-graph matching logic. (L)
  - Handle credit card payment and loan payment patterns. (L)
  - Add scenario tests for no double expense counting. (M)
- Acceptance:
  - Credit-card purchase/payment cycle behaves correctly in reports.

---

## Epic 6: Import Inbox and Resolution UX (P0)
**Goal:** minimize manual effort with bulk review.

### Story 6.1 - Inbox summary view
- Tasks:
  - Build session summary UI (parsed/duplicate/unresolved counts). (M)
  - Add file-level status drill-down. (M)
- Acceptance:
  - User sees processing outcome in a single place.

### Story 6.2 - Resolution grid with bulk actions
- Tasks:
  - Grid for unresolved and low-confidence transactions. (L)
  - Bulk edit category/user/transfer flags. (L)
  - Approve selected and approve all high-confidence actions. (M)
  - Default low-confidence ownership assignment to household head during bulk resolve. (S)
- Acceptance:
  - User can resolve large batch without per-row modal workflow.

### Story 6.3 - Undo before finalize
- Tasks:
  - Session rollback API and UI affordance. (M)
  - Finalize lock semantics. (S)
- Acceptance:
  - User can undo before finalize; finalized session becomes immutable.

---

## Epic 7: Dashboards and Core Reporting (P0)
**Goal:** deliver core decision metrics from imported data.

### Story 7.1 - KPI cards
- Tasks:
  - Implement income, expenses, net cashflow, savings rate cards. (M)
  - Implement safe-to-spend with configurable monthly savings target. (M)
- Acceptance:
  - Core KPIs visible by household with period selector.

### Story 7.2 - Category and trend reporting
- Tasks:
  - Build spend-by-category chart with drill-down. (M)
  - Add prior week/month/year comparisons. (M)
  - Add weekly/monthly/YTD/yearly/custom filters. (M)
- Acceptance:
  - User can compare periods and inspect underlying transactions.

---

## Epic 8: Reconciliation and Operational Safety (P0)
**Goal:** increase trust in monthly close.

### Story 8.1 - Statement balance checks
- Tasks:
  - Parse opening/closing balances where available. (M)
  - Reconciliation panel with mismatch diagnostics. (M)
- Acceptance:
  - User sees variance and suggested causes before finalize (warn-only in MVP).

### Story 8.3 - Search foundation (SQLite FTS5)
- Tasks:
  - Add FTS5 virtual table for merchant/memo/normalized description search fields. (M)
  - Implement BM25-ranked search API with amount/date/account filters. (M)
  - Add migration and reindex workflow for FTS maintenance. (S)
- Acceptance:
  - User can run free-text merchant/memo search with ranked results and structured filters.

### Story 8.2 - Retention and backup
- Tasks:
  - Implement raw file purge worker after checkpoint. (M)
  - Implement encrypted backup/restore workflow. (L)
- Acceptance:
  - Raw PDFs purged by policy; backups can be restored in test.

---

## Epic 9: Hardening and Release Readiness (P0)
**Goal:** production confidence for household usage.

### Story 9.1 - Test hardening
- Tasks:
  - Add integration tests across import lifecycle. (L)
  - Add performance smoke tests for expected batch size. (M)
- Acceptance:
  - Test suite catches dedupe/transfer regressions.

### Story 9.2 - UAT and release checklist
- Tasks:
  - Execute monthly-close UAT scenarios from plan doc. (M)
  - Fix critical defects and record release notes. (M)
- Acceptance:
  - All P0 acceptance criteria pass before v1 tag.

---

## P1 Backlog (After MVP)
- INR + FX conversion reporting.
- Exports (CSV/PDF/Excel).
- Scheduled report notifications.
- Audit trail for edits.
- Advanced search and richer tagging customization.

---

## Dependency Graph (Simplified)
1. Epic 1 -> Epics 2/3/4
2. Epics 2+3 feed Epic 4
3. Epic 4 feeds Epics 5+6
4. Epic 6 + posted data feed Epic 7
5. Epic 8 can begin after Epic 2 baseline
6. Epic 9 spans all prior epics

## Suggested First Sprint (2 weeks)
- Epic 1 complete.
- Epic 2 Story 2.1 + 2.2.
- Epic 4 Story 4.1.
- Skeleton UI for import session list.

