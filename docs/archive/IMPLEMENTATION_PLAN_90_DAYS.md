# Implementation Plan (90 Days)

**Repo status:** For what is actually built vs this plan, use **`docs/CHECKPOINT.md`** (✅ / 🟡 / ⬜) and **`docs/MVP_BACKLOG.md`**.

## Planning Assumptions
- Primary strategy: `Actual Budget` as base + custom ingestion and review layer.
- Deployment target: self-hosted, LAN-only, can run on-demand on laptop.
- Core risk to solve early: reliable PDF ingestion and strict dedupe.
- Build quality preference: robustness over quick hacks.
- Persistence strategy: SQLite (WAL) as system of record for MVP.
- Search strategy: SQLite FTS5 + BM25 for free-text merchant/memo search.

## Phase 0 (Week 1-2): Foundation and Architecture Lock

### Objectives
- Confirm base platform and integration boundaries.
- Freeze canonical transaction schema.
- Establish parser profile framework.

### Deliverables
- Architecture decision record (ADR): "Actual + custom ingestion".
- Canonical schema v1 for accounts/import sessions/transactions/payslips.
- Import fingerprint and dedupe spec.
- Security baseline (local-only, no external OCR/API dependency).
- SQL migration runner and baseline backup/restore runbook.
- Operator scripts:
  - initial setup script (dependencies + local DB bootstrap),
  - schema initialization script,
  - service lifecycle script (start/stop frontend+backend via flag),
  - DB cleanup/reset script scoped by environment mode.

### Acceptance Criteria
- Team/user agrees on data contract from parser -> canonical store -> base importer.
- At least 2 synthetic statement fixtures parsed into canonical format.
- Dedupe strategy documented with test cases.
- SQLite DB file migration/restore path validated on a second machine simulation.
- New machine setup can be completed via one setup command path.
- Schema/table bootstrap can be run idempotently via one schema command path.
- Frontend and backend can be started/stopped through one lifecycle script with flags.
- DB cleanup/reset is available and mode-scoped (`TEST` vs `PROD`).

## Phase 1 (Week 3-6): Ingestion MVP (Statements + Basic Review)

### Objectives
- End-to-end import for CSV/Excel and PDF (template-driven) for selected institutions.
- Strict duplicate prevention.
- Single-screen review with bulk operations.

### Ingestion architecture (explicit)
- **Adapters** (per institution × format × product type where needed): isolate CSV/PDF quirks; output a **normalized interchange** (rows with signed amounts, dates, description, provenance).
- **Canonical ingest service**: single path from normalized rows → DB (`transaction_raw` / later canonical); dedupe and classification consume this path only.
- **Import Transactions UX**: upload files → **map each file to a household financial account** → confirm or select parser profile → extract → review → finalize. Auto-suggest is allowed; silent full-auto for arbitrary files is not a goal for v1.

### Features
- Multi-file upload intake.
- Parser engine with institution profile abstraction and **adapter registry** (CSV + PDF).
- Per-file **account binding** (which `financial_account` the statement belongs to) before extraction.
- Canonical transaction creation + provenance (one service boundary).
- "Needs Resolution" queue for unknown category/duplicate/transfer ambiguity.
- Bulk approve/categorize/assign user/edit.
- Import session finalize and rollback before finalize.
- Initial parser profile priority: Bank of America checking, Citi credit cards, Chase credit cards.

### Acceptance Criteria
- Re-uploading same file does not duplicate data.
- 100+ transaction statement batch can be reviewed in one grid flow.
- Unknown and low-confidence items routed to resolution queue.
- Finalized sessions lock and appear in reporting source.

## Phase 2 (Week 7-10): Household Finance Semantics + Dashboards

### Objectives
- Deliver decision-grade dashboarding aligned to user priorities.
- Correctly model transfer/liability flows.

### Features
- Household/member access rules (Owner all visibility, Member own scope).
- Low-confidence ownership default assignment to household head.
- Transfer matcher for:
  - credit card payment,
  - loan payment,
  - internal account transfers.
- Dashboard cards:
  - income,
  - expenses,
  - net cashflow,
  - spending power,
  - savings rate.
- Comparative views: prior week/month/year.
- Drill-down from chart to transactions.

### Acceptance Criteria
- Credit card purchase vs payment shows no double expense count.
- Dashboard loads within 2-3 seconds for expected data volume.
- User can answer "how much can we safely spend this month?" from UI.
- Reconciliation mismatches surface as warn-only alerts in MVP finalize flow.

## Phase 3 (Week 11-13): Payslip Granularity + Hardening

### Objectives
- Add detailed payslip ingestion and robust correction flow.
- Improve reliability, observability, backup posture.

### Features
- Payslip parser profiles for known employer templates.
- Mapping to gross/net/tax/deductions detail table.
- Monthly reconciliation helper (balance variance checks).
- Backup and restore workflow with encryption.
- Retention worker to purge raw PDFs post-extraction.

### Acceptance Criteria
- Payslip line items captured with mapped categories.
- Reconciliation screen flags variance and supports correction workflow.
- Raw file deletion policy verifiably enforced after successful extraction.

## Quality Gates (All Phases)
- Unit tests for parser profile extractors.
- Integration tests for dedupe idempotency.
- Regression fixtures for known statement templates.
- Manual UAT checklist for monthly close workflow.

## Operations Automation Track (Cross-Phase)

### Goal
Standardize local operations so setup, schema bootstrap, and service control are deterministic and repeatable.

### Required Scripts
1. **Setup script**
   - Installs project libraries and local runtime dependencies.
   - Initializes SQLite DB location and required directories.
2. **Schema script**
   - Applies initial schema creation (and pending migrations) idempotently.
   - Supports seed execution for smoke-test data.
3. **Service lifecycle script**
   - Starts frontend + backend as background processes.
   - Stops running services using a `--stop` (or equivalent) flag.
   - Supports status check output for operator clarity.
4. **DB cleanup/reset script**
   - Deletes only DB artifacts for the active mode.
   - Requires explicit confirmation flag to avoid accidental deletion.
5. **Mode-based DB segregation**
   - Support `MODE=TEST|PROD` in local env config.
   - Resolve mode-specific DB files without code changes.

### Suggested Script Contract
- `scripts/setup.(sh|ts)` -> setup/install/bootstrap.
- `scripts/db.(sh|ts) --init` -> schema + migrations (+ optional seed).
- `scripts/db-cleanup.(sh|ts) --yes` -> delete mode-specific DB artifacts.
- `scripts/services.(sh|ts) --start|--stop|--status` -> frontend/backend process lifecycle.

## UAT Scenarios
1. Upload 10 mixed files (PDF+CSV) across two users.
2. Re-upload one duplicate file intentionally.
3. Resolve 15 ambiguous items in batch.
4. Finalize import and verify dashboard metrics.
5. Process one credit card cycle (purchase then payment) and confirm no double expense.

## Release Strategy
- Internal alpha after Phase 1.
- Household beta after Phase 2.
- Stable v1 after Phase 3 with backup/recovery drill passed.

## Backlog Prioritization (Post-v1)
1. INR account and FX conversion reporting.
2. Exports (CSV/PDF/Excel) and scheduled reports.
3. Audit logs for transaction edits.
4. Search enhancements.
5. Tags customization and richer category hierarchy UX.

