# Decisions Log (ADR-lite)

## D-001: Base Platform Choice
- Date: 2026-03-23
- Decision: Use `Actual Budget` as the base platform.
- Context: Need modern household UX and budgeting-centric reporting with open-source flexibility.
- Consequence: Avoid rebuilding ledger/reporting core from scratch.

## D-002: Ingestion Strategy
- Date: 2026-03-23
- Decision: Build a custom ingestion pipeline for PDF/CSV/Excel normalization.
- Context: PDF is a primary input, native PDF support in base products is insufficient.
- Consequence: Extra implementation complexity, but critical workflow fit.

## D-003: Privacy and Deployment
- Date: 2026-03-23
- Decision: Self-hosted, LAN-first, air-gapped capable design.
- Context: Financial data sensitivity and user preference.
- Consequence: No dependency on external OCR/AI APIs for core path.

## D-004: Deduplication Policy
- Date: 2026-03-23
- Decision: Strict dedupe by deterministic fingerprint + unresolved queue for ambiguities.
- Context: Duplicate transactions are high-risk and unacceptable.
- Consequence: Conservative posting behavior; possible manual review for edge cases.

## D-005: Review Workflow
- Date: 2026-03-23
- Decision: Single import inbox with bulk actions and resolution queue.
- Context: User rejects per-transaction approval toil.
- Consequence: Requires grid/bulk UX and batched operation support.

## D-006: Transfer Semantics
- Date: 2026-03-23
- Decision: Separate expense recognition from settlement transfer.
- Context: Avoid double-counting credit card and loan payment flows.
- Consequence: Transfer matcher and confidence-based resolution logic required.

## D-007: Data Retention
- Date: 2026-03-23
- Decision: Purge raw PDFs after successful extraction + validation checkpoint.
- Context: Privacy requirements and storage minimization.
- Consequence: Need explicit retention worker and failure-safe behavior.

## D-008: Phase 1 Scope
- Date: 2026-03-23
- Decision: USD-only reporting; India/FX deferred.
- Context: Reduce MVP complexity and time-to-value.
- Consequence: Multi-currency model designed now, enabled later.

## D-009: Build Quality
- Date: 2026-03-23
- Decision: Robustness-first execution (not quick throwaway MVP hacks).
- Context: Financial correctness is critical.
- Consequence: Strong testing and reconciliation gates required before release.

## D-010: Database and Search Strategy
- Date: 2026-03-23
- Decision: Use SQLite (WAL mode) as the system-of-record DB for MVP, with SQLite FTS5 + BM25 for text search.
- Context: Local-first deployment, low user concurrency (2-4 users), air-gapped operation, and portability are higher priority than distributed scale.
- Consequence: Keep repository/search abstractions clean so Postgres or OpenSearch can be added later as optional backends without rewriting domain logic.

## D-011: MVP Defaults for Open Questions
- Date: 2026-03-23
- Decision:
  - Reconciliation mismatches are warn-only in MVP (not finalization-blocking).
  - Category taxonomy starts compact, with modular extension support.
  - First parser profiles prioritized: Bank of America checking, Citi credit cards, Chase credit cards.
  - Low-confidence ownership defaults to household head assignment.
  - Auth remains JWT-only for local deployment.
- Context: Reduce MVP friction while preserving finance correctness and clear operator control.
- Consequence: Faster implementation path with explicit defaults, while keeping extension hooks for stricter policy and richer taxonomy later.

## D-012: Per-Institution Adapters + Single Canonical Ingest Path
- Date: 2026-03-24
- Decision: Split ingestion into (a) **per bank/format adapters** that produce normalized candidate rows, and (b) a **single canonical ingest service** that persists and dedupes. Do not attempt one parser for all institutions. CSV and PDF both use the adapter pattern; differences are isolated in adapter modules with fixture tests.
- Context: Real-world exports (e.g. BoA summary sections, Citi Debit/Credit columns, Chase activity CSV) cannot be mapped reliably by one generic mapping UI alone without high error risk.
  - Consequence: Higher upfront adapter count for top institutions, but lower systemic risk and stable core logic. UX includes per-file **financial account** assignment and profile selection/confirmation before parse.

## D-013: Home = cash dashboard; Import not in primary nav
- Date: 2026-03-24
- Decision: Authenticated **home** route (`/`) is the **cash / KPI dashboard** (same content as former `/dashboard`). **Import** is started only from the header **New import** action — no **Import** item in the primary nav (reduces duplicate entry points). **`/dashboard`** redirects to **`/`** for bookmarks.
- Context: Users should land on decision metrics after login; import is secondary to ongoing cashflow review.
- Consequence: Simpler IA; marketing/sign-in card remains for guests at `/` without the dashboard.

## D-014: Category management surface + taxonomy depth (proposed direction)
- Date: 2026-03-24
- Status: **Partial (2025-03-25)** — ledger-first picker + inline create shipped; taxonomy expanded (**`0008`**, Income leaves, Taxes/Transfers); **`/categories`** still present. See **`docs/CHANGE_HISTORY.md`** (CR-001, CR-002, UX-002, UX-003).
- Direction:
  - **Primary UX:** Manage categories **from the ledger** (and anywhere else transactions are categorized): show **parent** in the control; **hover or nested menu** for **child** leaves; **add category / subcategory** inline (no separate screen required for the common case).
  - **Secondary:** Keep a **minimal** or **advanced** `/categories` route only if needed (bulk rename, cleanup), or remove it once inline parity exists.
  - **Taxonomy:** Expand defaults beyond the current tree: **Transfers** (aligned with **Story 5.2** transfer matcher), **tax payments**, **Income** children (e.g. salary, interest, dividends, refunds), and any other household-standard buckets agreed in **`docs/MVP_BACKLOG.md`** / a future **`CATEGORY_TAXONOMY`** appendix.
- Context: A full-page category list duplicates mental model vs picking a category on a row; the current seed still omits several real-world buckets.
- Consequence: Next chunk of work is **UI-heavy** (accessible flyout + create flows) plus **data** (migrations, rules, reporting roll-up). Update **`docs/CHECKPOINT.md`** when this ships or is rejected.

## D-015: Ledger category trigger — single line vs “Parent › Child”
- Date: 2025-03-25
- Status: **Accepted**
- Decision: On the **Ledger** table, the category control shows **only the name of the assigned category** (one line), whether the user picked a **parent group** or a **leaf**. **Visual differentiation** (muted + gray accent vs strong + blue accent) replaces a second line of text.
- Context: User feedback — stacked parent/child made rows too tall; optional backlog wording had suggested “Parent › Child” display.
- Consequence: Deviates from the optional display note in **Story 5.3**; documented as **PRD-001** in **`docs/CHANGE_HISTORY.md`**. Full path could return later via tooltip or drill-down only.

## D-016: Ledger table — omit Status column
- Date: 2025-03-25
- Status: **Accepted**
- Decision: **Transactions** ledger view does **not** show a **Status** column (posted/pending/etc. still available via API if needed elsewhere).
- Context: User preference — not useful in this view; saves horizontal space.
- Consequence: PRD/backlog screens that assumed a status column on the ledger are **out of date**; update wireframes if referenced.

## D-017: Safe-to-spend and savings rate — windowed cash summary vs PRD §8 MTD shortcut
- Date: 2026-03-27
- Status: **Accepted**
- Decision: Implement **safe-to-spend** and **savings rate** on **`GET /reports/cash-summary`** using **posted inflows/outflows** for the **selected preset window**, with **safe-to-spend** = **net − prorated monthly savings target** (calendar days ÷ ~30.437). **Savings rate** uses **(inflows − outflows) ÷ inflows** with **two-decimal** ratio rounding before display. **Household** stores **`monthly_savings_target_usd`** (migration **`0010`**).
- Context: PRD §8 “first release” line describes **current-month MTD** only; the product ships **one API** for rolling 30/90, calendar month, and YTD.
- Consequence: PRD §8 now includes **MVP shipped formulas**; deviation and rationale in **`docs/CHANGE_HISTORY.md`** **PRD-002**. If DB lacks **`0010`**, API degrades gracefully (**FIX-003**). Home KPI definitions use **(i)** tooltips (**UX-005**).

## D-018: External PFM inspiration — UX patterns vs feature parity
- Date: 2026-03-28
- Status: **Accepted**
- Decision: Treat **consumer cloud PFM** products (e.g. Quicken Simplifi, Rocket Money, Mint/Credit Karma) as **reference for positioning, copy tone, and sectioning patterns** only — **not** as a feature backlog. We **do not** target bank-linking-first onboarding, subscription-cancellation heroes, social-proof metrics, or SaaS pricing models. We **do** align with **clear jobs-to-be-done** (cash visibility, categories, confidence), **trust messaging** adapted to **local/self-hosted** (D-003), and **honest** language: **safe-to-spend** and period KPIs are not “projected cash flow” parity until such models exist.
- Context: Competitive sites are **marketing-heavy**; our constraints (import pipeline, dedupe, air-gap) differ by design.
- Consequence: Ongoing UX/copy improvements **may** cite **`docs/PFM_COMPETITIVE_UX_REFERENCE.md`**; major IA changes continue to be logged in **`docs/CHANGE_HISTORY.md`**. No obligation to match commercial feature matrices.

