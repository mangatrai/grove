# Household Finance Platform - Product Requirements Document (PRD)

## 1) Product Vision
Build a private, self-hosted household finance platform that gives a trustworthy view of:
- monthly net cashflow,
- safe-to-spend (spending power),
- savings trajectory,
- category-level spending,
- yearly trends and comparisons.

The system must support low-friction ingestion of monthly financial statements (especially PDF-first workflows), strong duplicate prevention, and minimal ongoing user maintenance.

## 2) Product Goals and Non-Goals

### Goals (Phase 1)
- Reliable monthly import workflow for checking/savings/credit cards/loans.
- Household-level visibility with role-based access (head of household full visibility).
- Minimal post-import effort via automated parsing + categorization + bulk review.
- Accurate transfer handling (credit card payments, loan payments, internal transfers).
- Clear dashboards for income vs spend vs net cashflow and safe-to-spend.
- Manual entry/edit + batch correction + import undo window.

### Non-Goals (Phase 1)
- Direct bank API integrations.
- Full tax preparation.
- Full investment transaction accounting.
- Receipt image retention.
- Advanced per-user budgeting and child workflows.

## 3) Success Metrics (from discovery)
1. Monthly net cashflow accuracy and confidence.
2. Spending power metric usability (safe-to-spend after savings buffer).
3. Time-to-monthly-close: user can process statement batch quickly with minimal manual fixes.
4. Reduction in uncertainty: user can answer "how much we can safely spend" at any time.

## 4) Primary Users and Access Model

### Users
- Head of household (Owner/Admin): full data visibility and edit rights.
- Spouse (Member): own data visibility by default.
- Future household members (modeled now, feature-enabled later).

### RBAC (Phase 1)
- Owner/Admin:
  - view all household members/accounts/transactions.
  - upload/import/approve/edit/delete (within policy).
- Member:
  - view/edit own transactions/accounts only.
  - upload own statements.
- Read-only role deferred to Phase 2.

## 5) Scope and Data Domains

### In-scope Phase 1
- Account types: checking, savings, credit cards, loans/mortgages (liability tracking).
- Currency: USD only in reporting.
- Investment accounts: balance snapshots only (month-end optional).
- Income types: salary, commissions, rental income, savings interest, dividends (as available from statements/payslips).
- Payslip details: gross, net, taxes withheld, deductions (benefits/401k/ESPP), employer-specific line items.

### Deferred Phase 2+
- INR account ingestion and FX conversion reporting.
- annual tax projection helpers.
- attachment search/indexing.
- approval workflow and full audit trails.

## 6) Core User Jobs-To-Be-Done
1. "I drop monthly statements and payslips, and the system processes them with minimal intervention."
2. "I review unresolved/low-confidence items in one screen, in bulk."
3. "I can clearly see income, expenses, transfers, net cashflow, and safe-to-spend."
4. "I can fix mistakes quickly and undo a bad import safely."
5. "I can compare this week/month/year vs prior periods."

## 7) Functional Requirements

### FR-1: Ingestion
- Accept multi-file uploads and/or watched input directories by user.
- Supported input types (Phase 1): PDF + CSV/Excel (statement import layer normalizes to canonical format).
- Statement parser profiles per institution/template (layout-stable assumption).
- Payslip parser profiles per employer template.
- Password-protected PDF support deferred (India scope later).

### FR-2: Parsing and Normalization
- Extract metadata: institution, account, statement period, opening/closing balance.
- Extract line items: date, posting date (if present), description, amount, debit/credit sign, reference ID.
- Normalize into canonical transaction schema.
- Preserve parser confidence and provenance (file + row hash + parser version).

### FR-3: Deduplication (strict)
- Prevent duplicate transaction insertion across repeated uploads.
- Deterministic fingerprint strategy:
  - account_id + date + amount + normalized_description + statement_period.
- Near-duplicate queue for collisions/ambiguity.
- Never silently merge uncertain records; send to "Needs Resolution."

### FR-4: Categorization
- Standard category set in Phase 1 (minimal config burden).
- Global household categorization rules only (no per-user rule maintenance).
- Auto-categorize by merchant patterns with conservative confidence threshold.
- Unknown category queue in "Needs Resolution."

### FR-5: Transfer Detection
- Detect and mark internal transfers between owned accounts.
- Special handling for:
  - credit card purchase (expense + liability increase),
  - credit card payment (asset decrease + liability decrease, no expense),
  - loan payment split (principal vs interest when data allows).
- Uncertain transfer matches appear in resolution queue.

### FR-6: Review and Correction UX
- Single "Import Inbox" for all processed files and unresolved items.
- Bulk actions: approve selected, categorize selected, mark transfer, assign user.
- Inline edit grid for transaction batch correction.
- "Approve all high-confidence" action.

### FR-7: Manual Entry and Batch Edit
- Add single transaction manually.
- Batch edit selected transactions (category/tag/user/notes).
- Support correction entries and balance adjustments with explicit reason.

### FR-8: Undo and Safety
- Import session rollback allowed until "Finalize Review."
- Optional time-based undo window (e.g., 30 minutes) before final lock.
- Once finalized, changes require explicit correction entries.

### FR-9: Dashboards and Reporting (MVP)
- Household overview:
  - income, expenses, net cashflow,
  - safe-to-spend metric,
  - savings rate,
  - trend vs previous period.
- Category spend breakdown and drill-down to transactions.
- Time windows: weekly, monthly, YTD, yearly, custom range.
- Comparative views: current vs prior week/month/year.

### FR-9b: Search (MVP baseline)
- Provide free-text search on merchant/memo/normalized description.
- Search ranking uses BM25 over local index data (SQLite FTS5).
- Support structured filters with search results:
  - amount range,
  - account,
  - date window,
  - status.

### FR-10: Household and Assignment
- Assign accounts/statements/transactions to a household member.
- Owner sees all; members see own by default.
- Family-level consolidated dashboards.

### FR-11: Privacy and Retention
- Air-gapped capable operation (no external calls required for core ingestion).
- Raw PDFs purged after successful extraction + validation checkpoint.
- Parsed canonical records retained.

### FR-12: Reconciliation Policy (MVP)
- Reconciliation mismatches are warn-only in MVP.
- Finalization is allowed with visible warning and reason capture.
- Policy can be tightened to block mode in future release.

## 8) Derived Metrics Definitions

### Monthly Net Cashflow
Net Cashflow = Total Income - Total Expenses (excluding transfers and balance moves)

### Savings Rate
Savings Rate = (Income - Expenses) / Income

### Spending Power (Safe-to-Spend)
Safe-to-Spend = (Expected Income - Committed Expenses - Planned Savings Buffer) - Realized/Committed Discretionary Spend

For first release, simplify to:
Safe-to-Spend (current month) = Income MTD - Expense MTD - Monthly Minimum Savings Target

### Net Worth Trend (Phase 1 basic)
Net Worth = Assets - Liabilities
Monthly trend from account balances and loan liabilities.

## 9) Recommended Product Strategy
Use a hybrid approach:
1. Base product: Actual Budget for budgeting/reporting UI and account semantics.
2. Custom ingestion layer:
  - PDF/CSV/Excel parser and canonicalizer,
  - strict dedupe + import inbox + resolution queue,
  - exporter/importer bridge into base system.

Rationale:
- avoids rebuilding dashboards/ledger core,
- addresses key gap (PDF ingestion),
- keeps workload focused on differentiator.

## 10) High-Level System Architecture

### Components
- UI Layer: mobile-friendly web app + desktop web.
- Ingestion Service:
  - file intake (upload/watch folder),
  - parser engine (institution templates),
  - canonical transaction store.
- Classification Service:
  - category assignment,
  - transfer matcher,
  - confidence scoring.
- Review Workflow:
  - inbox, bulk actions, resolution queues.
- Ledger/Finance Core:
  - base system (Actual) as reporting/budget engine.
- Data Store:
  - relational DB for canonical records + provenance + user/household model.
- Retention Worker:
  - secure purge of raw files post-processing.

## 11) Suggested Data Model (MVP)
- household(id, name, owner_user_id, created_at)
- user(id, household_id, role, visibility_scope, ...)
- financial_account(id, household_id, owner_user_id, type, institution, mask, currency)
- import_session(id, household_id, source_type, started_at, status, finalized_at)
- import_file(id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
- transaction_raw(id, file_id, row_index, extracted_payload_json, confidence)
- transaction_canonical(id, household_id, account_id, txn_date, amount, direction, merchant, memo, category_id, user_id, transfer_group_id, fingerprint, source_ref, status)
- category(id, household_id nullable, parent_id nullable, name, is_default)
- rule(id, household_id, rule_type, pattern, action, confidence_threshold, active)
- resolution_item(id, household_id, type, target_id, reason, status, assigned_to)
- balance_snapshot(id, account_id, snapshot_date, balance, source)
- paystub_record(id, user_id, pay_date, gross, net, tax_total, deduction_total, detail_json, source_file_ref)

## 12) UX Flows (MVP)
1. Upload files -> parser runs -> dedupe/classify -> inbox summary.
2. Review unresolved items in grid -> bulk fix -> finalize import.
3. Dashboard updates immediately after finalize.
4. Optional rollback while session is unfinalized.

## 13) NFRs
- Dashboard load target: <= 2-3 seconds for typical household dataset.
- Import SLA target: 20-30 seconds per statement acceptable.
- Reliability: idempotent imports, deterministic dedupe.
- Security: encrypted backups, local-first deployment, no required external services.
- Operability: can run on laptop on-demand, not 24x7 dependent.

## 14) Risks and Mitigations

### Risk: PDF parser drift per institution
- Mitigation: parser profiles + template tests + fallback manual mapping UI.

### Risk: Duplicate or missing transactions
- Mitigation: strict fingerprints + unresolved queue + reconciliation checks.

### Risk: Wrong transfer detection
- Mitigation: confidence threshold + review queue + reversible decision before finalize.

### Risk: Category noise
- Mitigation: conservative default categorization + bulk correction UX.

### Risk: Over-complex feature creep
- Mitigation: phase gates and explicit MVP freeze.

## 15) MVP Exit Criteria
- User can ingest monthly household files with <10 minutes review effort.
- No duplicate transactions on repeated file upload.
- Correct treatment of credit card purchase vs payment flow.
- Dashboard clearly shows income, expenses, net cashflow, safe-to-spend.
- User can batch-correct and finalize without per-row manual toil.

## 16) Future Phases
- Phase 2: INR handling + FX conversion, tax summary/high-level projections, exports, notifications, audit trail.
- Phase 3: advanced search, deeper investment analytics, custom categories/tags UX maturity, configurable user-level budgets.

