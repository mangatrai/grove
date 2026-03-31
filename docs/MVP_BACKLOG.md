# MVP Backlog (Epics -> Stories -> Tasks)

## Planning Notes
- Estimation scale: `S` (0.5-1 day), `M` (1-3 days), `L` (3-5 days), `XL` (5+ days).
- Priority: `P0` required for v1, `P1` next.
- Order below reflects execution sequence and dependencies.

**Checkpoint (repo vs this doc):** See **`docs/CHECKPOINT.md`** for what is implemented today, how to run, file map, and suggested next steps. **User-driven tweaks and PRD deviations:** **`docs/CHANGE_HISTORY.md`**. Update those files when you ship meaningful chunks.

**Progress legend:** ✅ Done · 🟡 Partial · ⬜ Not started (epic/story lines below use this where helpful).

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
  - Create DB cleanup script to reset DB files safely for active mode only. (S)
  - Add mode-based DB segregation (`MODE=TEST|PROD`) for same-machine dev/prod usage. (S)
- Acceptance:
  - Fresh machine setup succeeds with one setup command path.
  - Schema bootstrap runs cleanly on first and repeated executions.
  - Services can be started and stopped using the same script and flags.
  - DB cleanup requires explicit confirmation and only affects active mode DB files.

---

## Epic 2: Import Session and File Intake (P0)
**Goal:** ingest batches safely with traceability.

### Story 2.1 - Multi-file upload and session state machine
**UI note (2025):** Sessions in **`review`** (after parse) **do not** accept new uploads per state machine. The Import UI explains this and offers **“Start another import session”** instead of a dead file picker. A future **in-session transaction review** screen is Epic 6; until then, **ledger** + **new session** is the intended flow.

- Tasks:
  - API endpoint for batch file upload. (M)
  - Import session lifecycle: created -> processing -> review -> finalized. (M)
  - File checksum and provenance persistence. (M)
  - Dedicated service layer + state machine module (no ad-hoc transitions in routes). (M)
  - API contract doc (`docs/API_IMPORT_SESSIONS.md`) and error codes. (S)
  - DB constraint: unique `(session_id, checksum)`; duplicate upload rejected in-session. (S)
- Acceptance:
  - Session tracks all uploaded files and statuses.
  - Cross-household access returns 404; invalid transitions return 409 with `from`/`to`.
  - Integration tests cover happy path, negative paths, and duplicate checksum behavior.

### Story 2.2 - Input adapters (CSV/Excel first)
- Tasks:
  - Build adapter interface and parser profile registry. (M)
  - Implement CSV parser with configurable mapping. (M)
  - Implement Excel parser for common tabular patterns. (M)
  - Refactor toward **normalized interchange** output consumed by a single canonical ingest service (not ad-hoc writes scattered in routes). (M)
- Acceptance:
  - CSV/Excel files parse into normalized rows suitable for `transaction_raw` / downstream canonical mapping.

### Story 2.3 - Import Transactions: per-file account binding + profile selection
- Tasks:
  - Data model/API: attach `financial_account_id` (and optional `parser_profile_id`) per `import_file` before extraction. (M)
  - UI: Import Transactions menu — upload → list files → **map each file to an account** → choose/confirm profile → run extraction. (L)
  - Backend validation: file cannot be parsed until account is set (or explicit “unknown account” resolution path). (S)
- Acceptance:
  - User can assign each uploaded statement to the correct household account before rows are ingested.
  - Clear extension point for new bank adapters without changing dedupe/canonical core.

### Story 2.4 - Import staging cleanup (operator script)
**Status:** baseline script + runbook — `scripts/purge-import-staging.mjs`, `npm run import:purge`, `docs/IMPORT_STAGING_PURGE.md`.

**Runtime behavior (product default):** After a successful **`POST /imports/sessions/:id/canonicalize`**, the backend **deletes** staged bytes under `data/imports/<sessionId>/` and clears **`import_file.stored_path`**. Staging is **temporary** during upload → parse → canonicalize; it is **not** retained for re-parse in normal operation.

**Goal of this story (operators / edge cases):** Provide a **safe, explicit** script for disk + DB pointer cleanup when something **did not** complete the happy path (abandoned session, parse failed, canonicalize never ran, legacy folders, restore mismatch), and for **manual** reclaim without touching ledger rows.

- Tasks:
  - Add **`scripts/`** (or `npm run`) entry: purge import artifacts with **dry-run** default, **explicit confirmation** for destructive mode, and configurable scope (e.g. single `sessionId`, older than N days, or entire `data/imports` except reserved paths like `custom/` if present).
  - On purge: delete session directories and/or files; **update `import_file.stored_path`** (e.g. `NULL`) for affected rows so the DB does not point at missing files.
  - **Test hygiene:** `scripts/prep-test-db.sh` + Vitest **`globalSetup`** teardown (`backend/tests/global-setup.ts`) run `scripts/clean-import-session-dirs.mjs` so **`data/imports/<uuid>/`** from integration tests does not accumulate between runs (`custom/` preserved).
  - Document usage in `README` or `docs/` (when to run, backup warning). (S)
- Acceptance:
  - Dry-run prints what would be deleted without deleting.
  - Confirmed run removes targeted files and leaves DB metadata consistent (`stored_path` cleared or file row policy documented).
  - No silent deletion: always requires explicit flag or typed confirmation.

---

## Epic 3: PDF Parsing Framework (P0)
**Goal:** support institution-template PDF extraction with confidence scoring.

**Planning note (prioritization):** Adding **more banks/institution adapters** (BoA vs Chase vs Citi, etc.) can be **deprioritized** until the **import + ledger UI** feels polished — new profiles are mostly incremental once the framework and UX are stable. **Richer extraction from statements you already support** (e.g. last-four / account hints, metadata for matching or onboarding) is a **different** slice of work than “more institutions” and may be scheduled alongside **Epic 6** (inbox / resolution) when review-before-post matters.

**Note (account onboarding from PDFs — not a separate epic yet):** statements often include last-four, name, and product
lines. A future story could use extracted text to suggest or pre-fill `financial_account` (masks, labels) during first
import; overlaps Epic 6 (inbox / resolution UX) for review before posting.

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
**Design reference:** `docs/PAYSLIP_V1.md` (bank ledger vs payslip separation, v1 summary-only scope, storage, phased UI).

**Priority:** **Epic 4.2** baseline is **done**; start **3.3a** when you schedule payslip work (otherwise **Epic 6** resolution actions or **UI polish** first).

**3.3a — v1 (summary strip only):**
- Tasks:
  - **IBM-style** profile: extract **first summary block** from `pdf-parse` text (Current + YTD): hours/days, gross, post-tax deductions, employee taxes, pre-tax deductions, net pay; store **pay period** / pay date.
  - **Dedicated payslip snapshot** storage (JSON or narrow columns), keyed by **household + period** (+ file reference); **do not** post into `transaction_canonical` by default (avoid double-count with bank net pay).
  - Golden tests on agreed fixtures (e.g. commission + regular paycheck PDFs).
- Acceptance:
  - Parsed summary matches manual spot-check on fixtures; duplicate period policy documented.

**3.3b+ — later:**
- Line-item earnings/deductions/tax grids; additional employers; payslip-specific **screens and dashboards**; optional link to bank deposit for reconciliation.


---

## Epic 4: Canonicalization and Strict Dedupe (P0)
**Goal:** prevent duplicate posting and preserve correctness.

### Story 4.1 - Canonical transaction mapping
- Tasks:
  - Implement **canonical ingest service** input contract: normalized rows from any adapter + target account context. (M)
  - Map parser output to canonical transaction model. (M)
  - Normalize descriptions and date/amount signs. (M)
- Acceptance:
  - Canonical rows generated consistently across input formats.
  - Adding a new bank adapter does not require changing dedupe/fingerprint rules beyond normalized field contract.

### Story 4.2 - Fingerprint dedupe engine
**Status:** **Baseline delivered** (engine + API + tests + minimal product surface). Follow-on **Epic 6** work adds queue UX (status bulk, filters, context, **`unknown_category` bulk category** via **`/resolution/bulk-apply-category`**).

**Delivered:**
- **`transaction-fingerprint.ts`** — deterministic `normalizeAmountForFingerprint`, date/description normalization, `computeTransactionFingerprint`.
- **Canonical ingest** — exact duplicate via fingerprint + unique index; **near-duplicate** → insert **`resolution_item`** (`type: duplicate_ambiguity`), row not posted; response includes **`nearDuplicates`** (see `docs/API_IMPORT_SESSIONS.md`).
- **Import UI** — shows **`nearDuplicates`** after canonicalize.
- **Tests** — unit tests on fingerprint helpers; integration: idempotent second canonicalize; near-duplicate scenario (e.g. Starbucks lines).

**Deferred / next:**
- Bulk near-duplicate triage beyond **status** (e.g. category rules) when Epic 5 exists; session rollback / undo (Epic 6.3).

- Tasks (original backlog; baseline above covers most):
  - Implement deterministic fingerprinting and duplicate checks. (L) ✅
  - Add near-duplicate detection path to unresolved queue. (M) ✅ (`resolution_item` + `GET /resolution`)
  - Add idempotency tests for re-imported files. (M) ✅
- Acceptance:
  - Re-uploading same file produces zero duplicate posted rows. ✅

---

## Epic 5: Classification and Transfer Matching (P0)
**Goal:** classify usable data while minimizing false positives.

### Story 5.1 - Category taxonomy and baseline rule engine
**Partial (2026-03-27):** Default taxonomy is **hierarchical** (global parent + leaf rows; migrations **`0006`**, **`0007`**, **`0008`** — **`0008`** adds Income **leaves**, **Taxes** / **Transfers** groups + leaves; **`0009`** adds **`category_rule`** + **`classification_meta`** on **`transaction_canonical`**; see **`docs/CHANGE_HISTORY.md`**). **`category-rules.ts`** merges **DB rules** (priority order) then static defaults. **Canonical ingest** sets **`category_id`** and explainability metadata when rules match. **`GET /categories`** lists global + household categories (includes **`parentId`**). **Ledger** **`PATCH /transactions/:id`**. **`GET/POST/PATCH /categories/rules`** — **`docs/API_CATEGORIES.md`**. **UI:** **`/categories/rules`** (manage rules; link from **`/categories`**). **`unknown_category`** on **`/resolution`** with type filter + inline category + **`POST /resolution/bulk-apply-category`** (multi-select + apply category) + classification summary. **Still not:** full confidence product UX polish.

- Tasks:
  - Seed compact household category taxonomy with modular extension path. (S) ✅ (hierarchical; ongoing expansion — see **5.3** + checkpoint)
  - Add conservative merchant-pattern rules with confidence. (M) ✅ (keyword baseline; confidence deferred)
- Acceptance:
  - Known merchants auto-categorize; unknowns route to unresolved.

### Story 5.3 - Category hierarchy (parent / subcategory)
**Status: 🟡 Partial (2025-03-25).** **Depends on:** Story 5.1 baseline. **Schema:** `category.parent_id` (`0001_init` + **`0006`** + **`0007`** + **`0008_income_taxes_transfers_taxonomy`**).

**Goal:** Support a **tree** of categories so users think in groups (e.g. **Shopping** → Groceries, Clothing; **Loan** → Primary mortgage, Personal loan, Auto; **Investment** → Stocks, Rental income) while keeping posting and rules predictable.

**Scope:**
- **Seed:** Replace/extend default seed so global defaults include **parent rows** and **child rows** (`parent_id` set). Document the canonical tree in `docs/API_CATEGORIES.md` or a short `docs/CATEGORY_TAXONOMY.md` appendix. Keep depth policy explicit (e.g. **two levels** for MVP: parent + leaf only; no arbitrary depth unless you expand later).
- **Household CRUD:** Allow the household to **add** categories and subcategories (household-scoped rows with `household_id` set, `parent_id` pointing at a category usable by that household — global parent or household parent). **API:** `POST /categories` (and optionally `PATCH`/`DELETE` with guardrails: no delete if referenced by `transaction_canonical` or define reassign policy). Validate: no cycles, parent exists, depth within policy.
- **Ledger UX:** Category picker shows **grouped hierarchy** (expand parent → pick leaf). Posted rows still store a single **`category_id`** (typically a **leaf**; if you allow assigning a parent, define whether reports treat it as “whole group” — default MVP: **assign leaf only**).
- **Rules:** `category-rules.ts` continues to map to **`category_id`** (usually leaf IDs). Optional stretch: rule targets a **parent** and assigns first matching child — defer unless needed.
- **Reporting (coordination with Epic 7.2):** Define whether **`/reports/cash-summary`** `byCategory` rolls up **children into parent** totals (recommended for charts) while ledger stays leaf-accurate. Implement in a follow-on task once hierarchy seed + CRUD exist.

**Delivered (2025-03-25):**
- Hierarchical seed + **idempotent** migrations through **`0008`**; expanded groups (healthcare, food & dining, insurance, education, giving, **Income** leaves, **Taxes**, **Transfers**, etc.).
- Backend: household **`POST`/`PATCH`/`DELETE /categories`** with `parentId` validation and depth checks (`MAX_DEPTH`).
- Frontend: **`/categories`** — grouped table, **Source** column, add **parent** vs **subcategory** form.
- Ledger: **`LedgerCategoryPicker`** — portal **dialog** (backdrop, fixed position), **three columns** (groups / subcategories / new category), **`POST /categories`** inline; trigger shows **one line** (selected category name) with **parent vs leaf** styling — see **`docs/CHANGE_HISTORY.md` UX-003**, **`docs/DECISIONS_LOG.md` D-015**. **Status column removed** from ledger (**D-016**).

**Remaining / product direction:**
- **Ledger-first parity:** **D-014** **Accepted** — **Transactions** = primary categorization; **`/categories`** + **`/categories/rules`** stay as secondary taxonomy + automation surfaces (**`docs/DECISIONS_LOG.md`**, **DOC-008**).
- **Reporting:** Hierarchical roll-up in **`byCategory`** and drill-down labels (coord. Epic 7.2).

- Tasks:
  - Hierarchical seed data + migration strategy for existing DBs (idempotent inserts or new migration). (M) ✅ through **0008**
  - Backend: create/update/delete household categories with `parentId` validation and cycle/depth checks. (M) ✅
  - Frontend: settings or modal flow — “Add category” / “Add subcategory under…”. (M) ✅ (`/categories`) + **ledger inline** ✅
  - Ledger: hierarchical picker + inline add; table display **single-line** category name (deviation from optional “Parent › Child” noted in **CHANGE_HISTORY** PRD-001). (S) 🟡
  - Tests: API + at least one integration path for household subcategory. (S) ✅
- Acceptance:
  - Fresh seed shows an agreed parent/child taxonomy; users can add household-only categories and subcategories.
  - Ledger assignment picks a valid leaf (or documented parent policy); invalid `parent_id` rejected with a clear error.
  - No circular references; depth policy enforced.

### Story 5.2 - Transfer matcher
**Priority: post-MVP (backlog).** A **conservative baseline** matcher ships today (**`canonical-ingest.service.ts`**, **`TRANSFER_*`**, **CR-016**, **CR-030**): pairs transfer legs → **`transfer_group_id`** when score thresholds are met; else **`transfer_ambiguity`** (including **`low_pair_score`**). Further **memo/institution coverage** and tuning are **deferred** until validation against **real bank exports** (avoid overfitting fixtures). **`cash-summary`** excludes transfer-linked rows (**CR-004**, **CR-006**).

- Tasks:
  - Implement amount/date/account-graph matching logic. (L) 🟡 baseline
  - Handle credit card payment and loan payment patterns. (L) ⬜ *deferred post-MVP*
  - Add scenario tests for no double expense counting. (M) 🟡 partial
- Acceptance:
  - Credit-card purchase/payment cycle behaves correctly in reports.

---

## Epic 6: Import Inbox and Resolution UX (P0)
**Goal:** minimize manual effort with bulk review.

**Baseline delivered (2025):** **`GET /resolution`** (with **`?status=`** filter) lists **`resolution_item`** with **import context** (file, raw preview, ledger link). **`PATCH /resolution/:id`** and **`POST /resolution/bulk`** update status with the same transition rules (`docs/API_RESOLUTION.md`). **Review queue** at **`/resolution`** — per-row and **bulk** status actions. **Import workspace** — **Epic 6.1-style handoff:** posted vs exact duplicates vs near-duplicates, CTA to review queue when needed; ledger empty-state guidance when session filter shows no rows.

**Not** delivered: **transfer** bulk edits (Story 6.2 stretch), bulk “approve” semantics beyond status. **Delivered (6.3):** **`POST .../undo-import`** before finalize (**`docs/API_IMPORT_SESSIONS.md`**). **Delivered:** **`unknown_category` bulk category** — **`POST /resolution/bulk-apply-category`**; primary review UI on **Transactions → Needs review** (**CR-014**, **CR-018**). **Delivered (2026-03-29, CR-019):** **file-level** outcomes on import workspace — **`GET /imports/sessions/:id/summary`** per-file **`nearDuplicatesFlagged`**, **`openItemsNeedingReview`**, **`notPostedExactDuplicateOrSkipped`**, CTAs to ledger / Needs review.

### Story 6.1 - Inbox summary view
**Status: 🟡 Partial (2026-03-29).** Session summary + **Outcomes by file** cards (**CR-019**). **Remaining:** richer session inbox (e.g. raw row preview per file without leaving workspace) if desired.

- Tasks:
  - Build session summary UI (parsed/duplicate/unresolved counts). (M)
  - Add file-level status drill-down. (M)
- Acceptance:
  - User sees processing outcome in a single place.

### Story 6.2 - Resolution grid with bulk actions
**Partial (2026-03-27):** Resolution **grid** + **bulk status** (**In review / Resolve / Reopen**) via **`POST /resolution/bulk`**. **Delivered:** **bulk category** for **`unknown_category`** rows — **`POST /resolution/bulk-apply-category`** (`ids`, `categoryId`); Review queue: checkboxes, select all, category dropdown + **Apply category to selected** (`docs/API_RESOLUTION.md`). **Remaining:** bulk user/transfer assignment, approve-all-high-confidence.

- Tasks:
  - Grid for unresolved and low-confidence transactions. (L)
  - Bulk edit category/user/transfer flags. (L)
  - Approve selected and approve all high-confidence actions. (M)
  - Default low-confidence ownership assignment to household head during bulk resolve. (S)
- Acceptance:
  - User can resolve large batch without per-row modal workflow.

### Story 6.3 - Undo before finalize
**Status: 🟡 Partial (2026-03-27).** **`POST /imports/sessions/:sessionId/undo-import`** + Import workspace **Remove posted transactions** while **`review`**; **`finalized`** rejected (**409**). Parsed **`transaction_raw`** kept for re-canonicalize. See **`docs/API_IMPORT_SESSIONS.md`**.

- Tasks:
  - Session rollback API and UI affordance. (M) 🟡
  - Finalize lock semantics. (S) 🟡 (immutable via state machine; undo only in `review`)
- Acceptance:
  - User can undo before finalize; finalized session becomes immutable.

---

## Epic 7: Dashboards and Core Reporting (P0)
**Goal:** deliver core decision metrics from imported data.

### Story 7.1 - KPI cards
**Status: 🟡 Partial (2026-03-27).** **`GET /reports/cash-summary`** + UI on authenticated **`/`** (home; **`/dashboard`** redirects). Period presets: **calendar month**, **YTD**, **rolling 30 / 90**; KPIs **inflows / outflows / net**; **`spendingPower`** — **savings rate**, **safe-to-spend** when **`monthly_savings_target_usd`** set (**`GET/PATCH /household/settings`**, migration **`0010`**); formulas vs PRD §8 shortcut documented as **`PRD-002`** + PRD **§8 MVP shipped formulas**; unmigrated DB: **`FIX-003`**. Optional **account** filter; **by-account** breakdown; **6-month** trend; **`categoryBreakdown`** + charts (**`docs/API_CASH_SUMMARY.md`**, **`docs/API_HOUSEHOLD.md`**). **Transfer-linked rows** excluded (**CR-004**). **Dashboard:** KPI **(i)** tooltips (**UX-005**), **monthly savings target** as a **slider** with live **safe-to-spend** preview (**UX-006**), `unknown_category` banner, drill-down to ledger. **Not** delivered: forecast-based safe-to-spend, non-cash “committed expense” modeling.

- Tasks:
  - Implement income, expenses, net cashflow, savings rate cards. (M) 🟡
  - Implement safe-to-spend with configurable monthly savings target. (M) 🟡 (cash-basis; household PATCH)
- Acceptance:
  - Core KPIs visible by household with period selector.

### Planning note — Household profile & expectations
**PRD §13 Phase D** and **Epic 11** Story **11.4** own the **Settings** route and **Household** tab plan. **Salary / employers** are API-backed on **`GET/PATCH /household/profile`** (person-owned). **Monthly savings target** ships via **`PATCH /household/settings`** and may stay **duplicated** on **Home** (quick adjust) per §13.

### Story 7.2 - Category and trend reporting
**Status: 🟡 Partial (2026-04-02).** **Depends on Epic 5.1** (categories on ledger rows); **Story 5.3** adds **roll-up / grouping** in reports (parent vs leaf) and clearer drill-down labels. **Delivered:** category-backed aggregates + charts on the home dashboard via **`categoryBreakdown`**. **Delivered:** click-through/drill-down into the ledger from “By category (period)” and dashboard charts/tables (pre-filtered by `categoryId` and the dashboard’s date window, optionally `accountId`). **Delivered:** **period comparisons** — **`GET /reports/cash-summary`** returns **`comparison.previousPeriod`** and (when applicable) **`comparison.yearOverYear`** with household KPI deltas; the home dashboard surfaces these as compact delta chips (see **`docs/API_CASH_SUMMARY.md`**). Comparison semantics: **month** → previous calendar month + same month last year; **YTD** → prior-year YTD; **rolling_30 / rolling_90** → immediately preceding same-length window; **custom** inclusive **`dateFrom` / `dateTo`** (**`CR-015`**, max **366** days) → same-length prior window. **Delivered:** **`byCategory[]`** prior-window totals and deltas (`previousInflows` / `previousOutflows` / `previousNet`, `delta*`) when **`categoryBreakdown=true`** (**`CR-029`**); dashboard “By category” table shows per-category deltas alongside household KPI chips. **Still not:** arbitrary ranges **beyond** the **366-day** cap (and other KPI / safe-to-spend polish noted in **`CHECKPOINT`**), and richer **hierarchical** presentation/labels in `byCategory` beyond **`categoryRollup`** (`leaf` \| `parent`) until **Story 5.3** lands.

- Tasks:
  - Build spend-by-category chart with drill-down. (M) 🟡
  - Prior period / YoY / prior-window comparisons for household KPIs. (M) 🟡 (API + dashboard; includes **`byCategory`** deltas — **`CR-029`**)
  - Add weekly/monthly/YTD/yearly/custom filters. (M) 🟡 (presets + custom **`dateFrom`/`dateTo`** — **`CR-015`**; cap **366** days)
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

## Epic 10: Design system, branding, and UI polish (P1)
**Goal:** cohesive visual identity and maintainable styling so new screens match the rest of the app without one-off CSS.

**Context:** Incremental UX work already ships via **`docs/CHANGE_HISTORY.md`** (e.g. **UX-002**, **UX-003** — picker overlay, DM Sans, tokens in **`frontend/src/index.css`**). This epic **tracks** a deliberate pass: tokens, themes, and consistency—not ad hoc fixes only.

### Story 10.1 - Design tokens and global styles
- Tasks:
  - Audit **`frontend/src/index.css`** `:root` variables (color, typography, radius, shadow, spacing); document naming in a short **`docs/`** appendix or **`frontend/README.md`** pointer.
  - Align buttons, links, cards, tables, and form controls on shared tokens (reduce one-off hex where practical). (M)
- Acceptance:
  - New UI work can reuse documented tokens; no mandatory full-page redesign in one shot.

### Story 10.2 - Color themes (e.g. light / dark)
- Tasks:
  - Define a second palette (or full dark theme) using **`data-theme`** or **`prefers-color-scheme`** + optional user toggle persisted (e.g. `localStorage`). (M)
  - Ensure charts and third-party-looking components remain legible. (S)
- Acceptance:
  - User can switch theme (or OS-driven) without breaking contrast on primary flows (home, ledger, import, resolution).

### Story 10.3 - Screen-by-screen consistency pass
- Tasks:
  - Reconcile spacing, heading hierarchy, empty states, and mobile header across **ShellLayout** pages; align with **Epic 11** when shell changes land. (M)
  - Optional: micro-interactions (focus rings, hover) where they improve clarity without noise. (S)
- Acceptance:
  - No page feels like a different product family than **Home** / **Ledger** after pass.

### Story 10.4 - Brand guidelines (lightweight)
- Tasks:
  - One-page **`docs/UI_BRAND.md`** (or section in **`frontend/README.md`**): font stack, primary/accent usage, when to use muted text, logo/header rules if applicable. (S)
- Acceptance:
  - Future contributors can match tone without re-deriving from **`index.css`** alone.

---

## Epic 11: Application shell, transactions hub, and settings (P0)
**Goal:** Adopt a **persistent shell** and **Transactions-first** IA so users navigate less and work from dense, filterable surfaces — **PRD §13** (phases A–D). **Data density** is a **feature** for analysis, not a bug to minimize, provided hierarchy and filters stay clear.

**Status:** 🟡 In progress (2026-03-29): **11.1**, **11.3**, **11.4** partial; **11.2** command center shipped (**CR-013**); **11.5** core **DOC-005** slice shipped (**CR-014** + **CR-018** — expand context, per-row status, redirect, CTAs). **Residual:** duplicate/transfer specialist UX, near-duplicate ledger visibility edge case.

### Story 11.1 - Phase A: Shell and wayfinding
**Status: 🟡 Partial (2026-03-27).** Collapsible sidebar + top bar + Account menu shipped (**UX-007**).  
- Tasks:
  - **Collapsible** left sidebar (collapse to icon rail). (M) 🟡 (abbr rail + `hf_sidebar_collapsed`)
  - **User menu** (top-right): **Settings** link, **Log out**; placeholders for help/notifications if needed. (S) 🟡
  - **IA copy:** Choose **Transactions** *or* **Ledger** as the single user-facing name; align **`App`** nav, page `<h1>`, and **`docs/`** references. (S) 🟡 (**Transactions** chosen)
- Acceptance:
  - Authenticated layout matches §13 Phase A; import remains reachable from **header** in one click.

### Story 11.2 - Phase B: Transactions command center
**Status: 🟡 Partial / core shipped (2026-03-27).** **CR-013:** **All \| Needs review** tabs, sticky filters, substring search, amount bounds, **Why** / **`reviewReasons`**, **+ Add** (**`POST /transactions`**). **Not in this story:** absorbing full **`/resolution`** workflows — see **11.5**.  
- Tasks:
  - **Tabs:** **All** | **Needs review** on **`/transactions`** (same table component; tab drives query/filters). **Needs review** = §13 definition (uncategorized **or** open resolution tied to row **or** blocked/failed import path — implement with explicit filters + row-level **reason** chips or columns so the tab is not a junk drawer). (L) 🟡
  - **Actions:** **+ Add** (manual **`POST`** transaction) alongside **Import** entry point on this screen or header. (M) 🟡
  - **Filter bar:** Sticky row — search, account, date, category, amount; **More filters** as needed. (L) 🟡 *Ranked FTS still future.*
  - **Trash tab:** **Do not ship** until **soft-delete** epic exists; see **P1** note.
- Acceptance:
  - User can switch All / Needs review without leaving the shell; manual add is obvious; filters stay visible while scrolling the table (or clear sticky affordance).

### Story 11.5 - Unify review: port Review queue into Transactions → Needs review
**Status: ✅ Core shipped (2026-03-29, **CR-014** + **CR-018**).** **`GET /transactions`** when **`needsReview=true`**: **`resolutionType`**, **`openReviewItems`** (**`id`**, **`type`**, **`status`**), **`importSessionId`**. **`GET /transactions/:id/open-review`** returns the same **`context`** family as **`GET /resolution`** for open items on that row. **Needs review** UI: type multi-select, bulk status/category, **Show** expandable row — raw preview, file/session links, classification pills, per-item category (unknown), **In review / Resolve / Reopen** (**`PATCH /resolution/:id`**). **Nav:** **Review queue** removed; **`/resolution`** redirects to **`/transactions?needsReview=true`**. **Home** + **Import** CTAs → Needs review (with **`sessionId`** when relevant). **Removed:** standalone **`ResolutionQueuePage`**. **Intentional gaps (documented in **CHECKPOINT** / **CR-018**):** rows that only exist as **`resolution_item`** without a matching canonical **`source_ref`** link (e.g. some near-duplicate paths) may not appear on Needs review; richer duplicate/transfer workflows vs old queue. **Intent (** **DOC-005** **):** primary review work is **`/transactions`**.  
- Acceptance:
  - Main queue workflows (bulk + per-row status + import context + category) run from **Transactions → Needs review**; **`GET /resolution`** remains for API/tests.

### Story 11.3 - Phase C: Dashboard scope prominence
**Status: 🟡 Partial (2026-03-27).** **Scope** bar at top of Home card (**UX-007**).  
- Tasks:
  - Move **account scope** (all vs one account) to a **primary** control at the **top** of **Home** (layout + copy for financial accounts). (S) 🟡
  - Ensure KPIs and charts respect scope consistently. (S) 🟡 (existing API filter; placement only)
- Acceptance:
  - Matches §13 Phase C; behavior unchanged aside from placement/clarity unless gaps found.

### Story 11.4 - Phase D: Settings route and tabs
**Status: 🟡 Partial (2026-03-27).** **`/settings`** + tabs + Household savings target form (**UX-007**).  
- Tasks:
  - **`/settings`** (or equivalent) from user menu; **sub-tabs:** **Profile**, **Household**, **Accounts**, **Notifications**, **Security** — render only tabs with backing API; others show honest empty/placeholder state. (M) 🟡
  - Enforce RBAC for Household management: **owner/admin edit**, members hidden from Household tab; backend rejects member mutation/list endpoints with `403`. (S)
  - **Household:** surface **`monthly_savings_target_usd`** (and future fields); allow **dual entry** with Home slider per §13. (M) 🟡
  - **Revision (2026-04):** align Settings with separate identity model (`user_account` + `person_profile`) and move employer ownership from household-level shape toward person ownership in follow-on epics.
- Acceptance:
  - Settings is discoverable; no dead tabs without explanation.

---

## Epic 12: Identity, Profile, Household Membership, and Ownership (P0)
**Goal:** support multi-person households with clean ownership attribution while keeping auth concerns separate from person records.

### Story 12.1 - User account vs person profile foundation
- Tasks:
  - Add explicit `user_account` (auth) and `person_profile` (name/phone/avatar) model boundaries. (M)
  - Introduce deterministic link between account and primary person profile. (S)
- Acceptance:
  - Personal metadata can evolve without auth-table coupling; schema documents the boundary clearly.

### Story 12.2 - Household membership with role and relationship
- Tasks:
  - Add `household_membership` with role (`head`, `member`) and relationship (`spouse`, `child`, `dependent`, `other`). (M)
  - Allow profile-only members (no login credentials required). (S)
- Acceptance:
  - Household can include spouse/children as assignable members even without login.

### Story 12.3 - Settings: Profile and Household management
- Tasks:
  - **Profile tab:** edit name, email/contact details, and avatar/icon selection. (M)
  - **Household tab:** create/rename household, add members, set role/relationship. (M)
- Acceptance:
  - User can fully set up a primary household and member roster from Settings.

### Story 12.4 - Ownership attribution across records
- Tasks:
  - Add person attribution fields for import files, payslip snapshots, accounts, and canonical transactions. (L)
  - Expose assign/filter flows so statements and transactions can be tagged to household members. (L)
- Acceptance:
  - Files/transactions can be attributed to a person profile; owner/member visibility rules remain enforceable.

### Story 12.5 - Employer ownership refactor
- Tasks:
  - Move employer semantics from household-level settings toward person-owned profile settings. (M) ✅
  - Remove household-level write path and legacy read fallback for salary/employers (**CR-040**). (S)
- Acceptance:
  - Employer/parser selection is person-specific and no longer modeled as a generic household-wide list.

---

## Epic 13: Security and Credentials Lifecycle (P0)
**Goal:** replace bootstrap `.env` credentials with durable local-account security suitable for air-gapped deployment.

**Execution sequencing:** see **`docs/EPIC_12_13_EXECUTION_PLAN.md`** for phased delivery, dependency order, and first-two-sprint scope.

### Story 13.1 - Local credential store and login flow
- Tasks:
  - Store password hashes in DB-backed auth model; remove dependency on static `.env` login for normal runtime. (M)
  - Keep first-user bootstrap path documented for fresh installs. (S)
- Acceptance:
  - Regular login uses DB credentials; bootstrap path is explicit and auditable.

### Story 13.2 - Security settings self-service
- Tasks:
  - Add **Security** tab backing API for change password. (M)
  - Add session/token invalidation behavior for sensitive changes. (S)
- Acceptance:
  - User can rotate password without manual DB/env changes.

### Story 13.3 - Household member onboarding (air-gapped manual-first)
- Tasks:
  - Add invite/add-member flow that works without external email dependencies in air-gapped mode. (M)
  - Capture future-ready hooks for invite tokens/activation if online mode is later introduced. (S)
- Acceptance:
  - Household admin can onboard member accounts manually in offline environments.

---

## P1 Backlog (After MVP)
- **Epic 10** (design system / themes / branding — structured stories above).
- **Transactions Trash tab + soft-delete:** restore semantics, retention, fingerprint/dedupe behavior — only after spec (**PRD §13** deferral).
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
4. **Story 5.3** (hierarchy seed + CRUD) enables hierarchical roll-up and labeling in **Epic 7.2**
5. Epic 6 + posted data feed Epic 7
6. Epic 8 can begin after Epic 2 baseline
7. Epic 9 spans all prior epics
8. **Epic 10** can start once a baseline shell exists (**Epic 1**); often scheduled **after** core flows feel functionally complete (P1)
9. **Epic 11** can proceed in parallel with **Epic 7** / **Epic 6** once **Epic 1** shell exists; **11.2** uses resolution + ledger APIs; **11.5** replaces dual **resolution** vs **Needs review** UX (**DOC-005**)

## Suggested First Sprint (2 weeks)
- Epic 1 complete.
- Epic 2 Story 2.1 + 2.2.
- Epic 4 Story 4.1.
- Skeleton UI for import session list.

