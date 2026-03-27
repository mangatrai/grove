# Project Context (Single Source of Truth)

## Project
Household Finance App (private, self-hosted, air-gapped capable).

## Problem Statement
User needs a trustworthy and low-maintenance system to understand:
- monthly net cashflow,
- safe-to-spend,
- savings trajectory,
- household income vs expenses,
- category-level spend and period-over-period comparisons.

Current pain: no reliable process, uncertainty around true financial position.

## Top Priorities (Ranked)
1. Monthly net cashflow
2. Spending power / safe-to-spend
3. Savings rate
4. Spend by category
5. Net worth trend
6. Debt payoff pace

## Operating Constraints
- Self-hosted only, LAN-first.
- No data egress; should work in air-gapped mode.
- Raw PDFs should be deleted after successful extraction/validation.
- Robustness over speed-to-hack; avoid trial-and-error in finance logic.

## Household and Access Requirements
- Initial users: owner + spouse.
- Owner/head-of-household sees all data.
- Spouse sees own data by default.
- RBAC needed (Owner/Admin/Member now; more later).
- Child/dependent modeling needed in data model, features can be deferred.

## Financial Scope
- Phase 1 account types: checking, savings, credit cards, loans/mortgages.
- Investment accounts: balance snapshots only for now.
- Currency: USD reporting only in Phase 1.
- India account and FX handling deferred to Phase 2.

## Ingestion Reality
- User expects PDF-heavy workflow (statements and payslips).
- Also wants CSV/Excel processing.
- Layouts are generally consistent per institution.
- Text-selectable PDFs (not primarily scanned images).
- Batch upload and low-manual-review workflow is mandatory.

## Behavioral Requirements
- Strict duplicate prevention (high confidence, conservative behavior).
- Unresolved queue for unknown categories/transfer conflicts/duplicate ambiguity.
- Bulk review and bulk edit in single screen.
- Manual entry + batch edits are required.
- Import undo before finalize is required.

## Accounting Semantics Locked
- Credit card purchase:
  - expense recognized at purchase,
  - liability increases.
- Credit card payment:
  - checking decreases,
  - liability decreases,
  - no additional expense recognized.

## Product Strategy Locked
- Base platform: Actual Budget.
- Build custom ingestion/review pipeline for PDF/CSV/Excel normalization, strict dedupe, and bulk resolution UX.
- MVP persistence/search baseline: SQLite (WAL) + SQLite FTS5 BM25 search.
- Ingestion architecture: **per-institution/format adapters** → **normalized interchange** → **single canonical ingest path** (dedupe/classification); Import UX maps **each file to a financial account** before extraction.

## Current Artifacts
- `docs/FINANCE_APP_PRD.md`
- `docs/IMPLEMENTATION_PLAN_90_DAYS.md`
- `docs/BASE_PLATFORM_DECISION.md`
- `docs/REQUIREMENTS_TRACEABILITY.md`
- `docs/CHANGE_HISTORY.md` — rolling CR / UX / fix log and PRD deviations

## Build status (rolling)
Shipped vs planned work is tracked in **`docs/CHECKPOINT.md`** with a clear **progress legend** (✅ / 🟡 / ⬜). Epics and stories in **`docs/MVP_BACKLOG.md`** use the same markers where updated. **`docs/CHANGE_HISTORY.md`** records CR/UX/FIX/DOC entries with stable IDs. Treat **CHECKPOINT + CHANGE_HISTORY** as the source of truth for “where we are” and **why** recent choices were made.

**Recent shipped slices (summary):** DB classification rules + **`/categories/rules`** UI (**CR-010**), transfer matcher **env** tuning (**CR-011**), cash-summary **KPI comparisons** + dashboard deltas, resolution **unknown_category** workflow, ledger drill-downs — details in **`CHANGE_HISTORY.md`** (2026-03-25–27 blocks).

**Change history:** User-driven tweaks, UX passes, engineering fixes, and **PRD/backlog deviations** are logged in **`docs/CHANGE_HISTORY.md`** (CR- / UX- / FIX- / PRD- prefixes). **`docs/DECISIONS_LOG.md`** holds ADR-lite decisions (e.g. D-015, D-016) that point to that file when needed.

## Immediate Next Build Focus
1. Architecture and interfaces finalization.
2. MVP backlog execution (epics/stories/tasks).
3. First parser profile set locked for implementation:
   - Bank of America checking
   - Citi credit cards
   - Chase credit cards

