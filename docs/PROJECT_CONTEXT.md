# Project Context (Single Source of Truth)

*Product roadmap / “PRODUCT_CONTEXT” handoffs: this file — there is no separate `PRODUCT_CONTEXT.md`.*

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
- `docs/PFM_COMPETITIVE_UX_REFERENCE.md` — **non-competitive** analysis of **consumer PFM** positioning (Simplifi, Rocket Money, Mint) — **patterns** we may borrow vs **features** we reject; see **`docs/DECISIONS_LOG.md`** **D-018**

## Competitive / UX reference (external)

Commercial PFMs optimize for **cloud subscriptions, bank aggregation, and broad feature sets**. This project **does not** chase parity with those products; see **`docs/PFM_COMPETITIVE_UX_REFERENCE.md`** for:

- What **Quicken Simplifi** emphasizes (forward-looking narrative, bundled “plan + reports + goals”) and how that maps to our **dashboard + cash summary + Epic 11** hub — without promising **bank linking** or **investment depth** we do not ship.
- What **Rocket Money** emphasizes (subscriptions, spending automation, social proof) — **subscription management as hero** is **misaligned** with our **import-first** MVP; **supportive copy** and **spending clarity** are still relevant.
- **Mint’s** transition to **Credit Karma** — reminder that **data portability** and **clear communication when IA changes** matter; reinforces our **SQLite / self-hosted** ownership story (**D-003**, **D-010**).

**Decision:** We borrow **clarity, sectioning, and trust framing**; we **do not** copy business models, aggregate connectivity claims, or features that require external services. **D-018**.

## Build status (rolling)
Shipped vs planned work is tracked in **`docs/CHECKPOINT.md`** with a clear **progress legend** (✅ / 🟡 / ⬜). Epics and stories in **`docs/MVP_BACKLOG.md`** use the same markers where updated. **`docs/CHANGE_HISTORY.md`** records CR/UX/FIX/DOC entries with stable IDs. Treat **CHECKPOINT + CHANGE_HISTORY** as the source of truth for “where we are” and **why** recent choices were made.

**Recent shipped slices (summary):** **Settings / profile:** **`GET/PATCH /household/profile`** (**CR-039**); salary deposit + employers are **person-owned** on **`person_profile`** (**migrations `0019`–`0020`**); **`PATCH /household/settings`** is **monthly savings only** (**CR-040**). **Payslips:** **`GET/POST /payslips`**, IBM **SuccessFactors**-style parser (**FIX-006**, **FIX-007**), **`/payslips`** UI (**CR-026**, **UX-008**, **FIX-008**), employer **`employer_id`** (**`0018`**, **CR-037**). **Epic 11.2** transactions hub (**CR-013**) + **11.5** (**CR-014**, **CR-018**): **`/transactions`** tabs (**All \| Needs review**), expand-row **`GET /transactions/:id/open-review`**, bulk + per-item **`PATCH /resolution/:id`**. **`/resolution`** → **`/transactions?needsReview=true`** (**CR-018**). **Epic 6 (partial):** session summary + **Outcomes by file** (**CR-019**). **Needs review** bulk category UX (**CR-025**). Shell + Settings (**UX-007**); cash-summary + savings target (**CR-012**, **PRD-002**); DB rules + **`/categories/rules`** (**CR-010**). **IA:** **Transactions → Needs review** (**DOC-005** / **CR-018**). Details: **`CHANGE_HISTORY.md`**.

**Change history:** User-driven tweaks, UX passes, engineering fixes, and **PRD/backlog deviations** are logged in **`docs/CHANGE_HISTORY.md`** (CR- / UX- / FIX- / DOC- / PRD- prefixes). **`docs/DECISIONS_LOG.md`** holds ADR-lite decisions (e.g. D-015, D-016) that point to that file when needed.

## Immediate Next Build Focus
1. **Unified Import + payslip:** **Baseline shipped** (**CR-028**, **`0015`**, **UX-009**, **CR-031**): import session + **`ibm_pay_contributions_pdf`**, **`payslip_snapshot.import_file_id`**, **`GET /payslips/:id`**, **`/payslips/:payslipId`** UI, payslip-only canonicalize, filename heuristic, workspace copy. **Income data** lives on **`person_profile`** — read **`GET /household/settings`**, write **`PATCH /household/profile`** (**CR-040**; **`docs/API_HOUSEHOLD_PROFILE.md`**). **Next:** stronger salary-account hints from profile, optional PDF-text sniff, **optional UI:** show **`avatarKey`** in **`AppTopBar`**. See **`docs/CHECKPOINT.md`** (also **Handoff — next session**) and **`docs/PAYSLIP_V1.md`**.
2. **Epic 5.2** — **post-MVP / backlog:** transfer matcher tuning waits on **real-world** bank data (**`MVP_BACKLOG`** Story **5.2**).
3. **Epic 7** — cash summary gaps (safe-to-spend narrative; category deltas shipped **CR-029**).
4. **Epic 11** — duplicate/transfer depth vs queue; **DOC-005** near-duplicate **`source_ref`** edge cases.
5. **Epic 6.2** — bulk ledger edits if still in scope.
6. **Ingestion:** parser profiles (BoA, Citi, Chase) baseline — parallel to (1) where separate files.

