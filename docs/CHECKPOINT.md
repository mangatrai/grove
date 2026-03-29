# Development checkpoint

**Last updated:** 2026-03-28 — **CR-014** (11.5 slice: resolution type filter + bulk on **Needs review**), **CR-015** (cash summary **custom** `dateFrom`/`dateTo`), **CR-016** (transfer matcher tokens), **FIX-004** (ledger **POST** `tsc`)

This file is the **single place** to see what the repo actually does today vs the backlog, and what to do next.  
**Audit trail** of user-driven tweaks, UX passes, and PRD deviations: **`docs/CHANGE_HISTORY.md`**.

### Progress legend (used across `docs/`)

| Symbol | Meaning |
|--------|---------|
| ✅ | **Done** — shipped in repo, exercised in tests or manual smoke where noted |
| 🟡 | **Partial** — usable slice exists; backlog lists gaps |
| ⬜ | **Not started** — design/backlog only |

---

## How to run

| Action | Command |
|--------|---------|
| Install + DB + seed | `npm run setup` (repo root) |
| Backend tests | `cd backend && npm test` (runs prep DB + migrations + Vitest) |
| Frontend typecheck | `cd frontend && npm run lint` |
| Dev: API + UI | `npm run services:start` or two terminals: `npm run dev` (backend), `npm run dev:frontend` |

Default **UI:** `http://127.0.0.1:3000` · **API:** `http://127.0.0.1:4000` · See root **`.env`** for `PORT` / `FRONTEND_PORT` / **`MODE`**. Optional **transfer matcher** tuning: **`TRANSFER_*`** (see **`.env.example`** and **`backend/src/config/env.ts`**).

`npm test` in `backend/` runs **`prep-test-db.sh`**, **`db.sh --init --seed`**, then Vitest — it can sit without output for tens of seconds while SQLite is recreated; that is normal. If another process locks the test DB, stop it and retry.

**Migration order:** SQL migrations run **before** seeds. Any migration that inserts rows with `parent_id` to built-in parents must **`INSERT OR IGNORE`** those parents in the migration if they only existed in seed before (see **`0008`** + **FIX-002** in **`docs/CHANGE_HISTORY.md`**).

---

## Implemented (high level)

| Area | Status | What exists |
|------|--------|-------------|
| **Auth** | ✅ | Login, JWT, household-scoped routes |
| **Import** | ✅ | Session → upload → bind account/profile → parse → canonicalize; staging **deleted after successful canonicalize** |
| **Dedupe (Epic 4.2)** | ✅ | `transaction-fingerprint.ts` — stable fingerprint; near-duplicate → **`resolution_item`** (`duplicate_ambiguity`); **`nearDuplicates`** in canonicalize response |
| **Home / cash dashboard (Epic 7.1 / 7.2)** | 🟡 | **`GET /reports/cash-summary`** — presets + **custom `dateFrom`/`dateTo`** (inclusive, max 366 days, **`CR-015`**), KPIs, **`spendingPower`**, **`comparison`** (same-length prior window for custom), account filter, by-account, **by-category** + charts, trend. **`GET/PATCH /household/settings`** — **`monthly_savings_target_usd`**. **Transfer exclusions** per **CR-004**; **FIX-003** unmigrated DB. **UI:** Home — **Custom** period + Apply, KPI tooltips (**UX-005**), savings slider (**UX-006**), drill-down. **PRD §8** via **PRD-002**. **Not yet:** per-category prior-window deltas (**TODO** in service); free-form range beyond 366-day cap |
| **Classification (Epic 5.1)** | 🟡 | **Static rules** in **`category-rules.ts`** + **DB rules** (migration **`0009`**, **`category_rule`** table) evaluated before defaults; **`classification_meta`** on canonical rows for explainability. **`GET/POST/PATCH /categories/rules`**; **UI:** **`/categories/rules`**. **`unknown_category`** on **`/resolution`**: type filter, **inline** category, **bulk** assign (`POST /resolution/bulk-apply-category` — select rows + category, **`ResolutionQueuePage`**) + summary chips. **Still not:** richer confidence UX polish |
| **Category hierarchy + ledger UX (Epic 5.3)** | 🟡 | **Migrations** through **`0008`** (+ **`0009`** for rules). **`/categories`** page. **Ledger:** **`LedgerCategoryPicker`** (portal flyout, inline **`POST /categories`**), **single-line** category cell, **no Status column** (**UX-003**, **PRD-001**). **Gaps:** D-014 (`/categories` vs ledger-only); hierarchical **`byCategory`** semantics beyond **`categoryRollup`** |
| **Transfer matcher (Epic 5.2)** | 🟡 | Matcher in **`canonical-ingest.service.ts`**: scoring + **CR-016** payment/loan/card-network tokens + asymmetric card-payoff heuristic; **`transfer_ambiguity`**, **`low_pair_score`**. **Tunable via `.env`:** `TRANSFER_*`. **Still not:** exhaustive institution-specific coverage |
| **UI shell & routing** | 🟡 | **Epic 11.1 / 11.3 / 11.4 (partial):** collapsible **sidebar** + **top bar** + **Account** menu (**Settings** `/settings`, **Sign out**); nav label **Transactions** (`/transactions`). **`/dashboard`** → **`/`**. **Guests:** **`/`** = landing + **inline sign-in** (**CR-017**); **`/login`** → **`/`**. **Home (signed-in):** **Scope** bar (account filter). **`/settings`** — tabs (Household wired; other stubs). Sidebar width: **`localStorage`** `hf_sidebar_collapsed` |
| **Import UX** | 🟡 | Closed sessions: uploads hidden; **Start another import session** |
| **Operator purge** | ✅ | `npm run import:purge` — `docs/IMPORT_STAGING_PURGE.md` |
| **Tests** | 🟡 | Vitest + integration paths (canonicalize, cash-summary, category rules, transfer exclusion) — **`cd backend && npm test`** should pass after **`0008`** Income parent fix |
| **Design system & branding (Epic 10, P1)** | ⬜ | Ad hoc polish in **`CHANGE_HISTORY`** (e.g. **UX-002**); **no** full theme system yet — see **`docs/MVP_BACKLOG.md`** Epic **10** (tokens, optional dark/light, consistency pass, **`docs/UI_BRAND.md`**) |
| **Shell, transactions hub, settings (Epic 11, P0)** | 🟡 | **Shipped:** **CR-013** + **CR-014** slice: **`/transactions`** **Needs review** — **`resolutionType`** filter, **`openReviewItems`** / **`importSessionId`**, checkboxes, bulk status/category (resolution APIs), session column; queue banner → Transactions. **Still TODO for 11.5:** per-row queue actions, raw preview, duplicate/transfer-specific flows, Home links, remove **`/resolution`**. **Trash** deferred. See **`docs/FINANCE_APP_PRD.md` §13**. |

---

## Key docs (by topic)

| Topic | File |
|----------|------|
| Backlog & epics | `docs/MVP_BACKLOG.md` |
| Target shell & IA (phased) | **`docs/FINANCE_APP_PRD.md` §13** · **Epic 11** in **`MVP_BACKLOG.md`** |
| External PFM patterns (non-competitive) | **`docs/PFM_COMPETITIVE_UX_REFERENCE.md`** · **D-018** |
| **Change / CR / UX history** | **`docs/CHANGE_HISTORY.md`** |
| Decisions (ADR-lite) | `docs/DECISIONS_LOG.md` |
| Import API | `docs/API_IMPORT_SESSIONS.md` |
| Ledger API | `docs/API_LEDGER.md` |
| Categories API | `docs/API_CATEGORIES.md` |
| Resolution queue API | `docs/API_RESOLUTION.md` |
| Cash summary (home) | `docs/API_CASH_SUMMARY.md` |
| Household settings (savings target) | `docs/API_HOUSEHOLD.md` |
| Staging purge | `docs/IMPORT_STAGING_PURGE.md` |
| Payslip (planned v1) | `docs/PAYSLIP_V1.md` |

---

## Sensible next steps (prioritized themes)

1. **Epic 5.2 continuation:** broaden transfer matcher coverage (card payments, loan patterns) + tests.
2. **Epic 5.1 continuation:** polish confidence/explainability display (bulk category on resolution queue is **shipped** — **`/resolution/bulk-apply-category`**).
3. **Epic 7 continuation:** ledger drill paging/context, category-level period comparisons (optional), **safe-to-spend** + savings targets.
4. **Epic 11:** **11.5** — port **Review queue** capabilities into **Transactions → Needs review**, then retire dual nav (**`DOC-005`**). Remaining **11.1–11.4** gaps per **`MVP_BACKLOG.md`**.
5. **Epic 6:** import inbox file-level drill-down; transfer/user bulk edits if still needed.  
6. **Product cleanup:** **D-014** — whether **`/categories`** + **`/categories/rules`** stay as power-user surfaces or consolidate (**`docs/DECISIONS_LOG.md`**).  
7. **Docs hygiene:** append **`CHANGE_HISTORY.md`** when shipping user-visible or behavior-changing work.

---

## Quick file map (categories + ledger + reporting)

- `backend/src/modules/category/category-rules.ts` — default classification + **DB rule** merge  
- `backend/src/modules/category/category-rules.service.ts` — **CRUD** for `category_rule`  
- `backend/src/modules/category/category-rules.routes.ts` — **`/categories/rules`** API  
- `backend/src/modules/category/category-ids.ts` — leaf/parent id constants  
- `backend/db/migrations/0008_income_taxes_transfers_taxonomy.sql` — Income/Taxes/Transfers taxonomy  
- `backend/db/migrations/0009_category_rules_explainability.sql` — **`category_rule`** + **`classification_meta`**  
- `backend/src/config/env.ts` — **transfer matcher** env vars (`.env` / `.env.example`)  
- `backend/src/modules/canonical/canonical-ingest.service.ts` — ingest, dedupe, **transfer matcher**  
- `backend/src/modules/reports/cash-summary.service.ts` — KPIs, comparisons, **transfer exclusion**  
- `frontend/src/layout/ShellLayout.tsx`, `AppSidebar.tsx`, `AppTopBar.tsx` — collapsible nav + top bar (**Epic 11.1**)  
- `frontend/src/pages/SettingsPage.tsx` — **`/settings`** tabs (**Epic 11.4**)  
- `frontend/src/components/LedgerCategoryPicker.tsx` — category flyout + inline create  
- `backend/src/modules/ledger/ledger.service.ts` — ledger list filters, **`needsReview`** predicate, **`reviewReasons`**, **`createManualCanonicalTransaction`**  
- `backend/src/modules/ledger/ledger.routes.ts` — **`GET/POST/PATCH /transactions`**  
- `frontend/src/pages/TransactionsPage.tsx` — **All \| Needs review** tabs, sticky filters, **Why** column, **+ Add** modal (**no Status column**; **Manage categories** link removed from intro)  
- `frontend/src/pages/CategoriesPage.tsx` — category management; **link to rules**  
- `frontend/src/pages/CategoryRulesPage.tsx` — **household classification rules UI**  
- `docs/CHANGE_HISTORY.md` — **CR / UX / FIX / PRD deviation log**
