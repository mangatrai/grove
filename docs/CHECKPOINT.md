# Development checkpoint

**Last updated:** 2026-03-27 (docs pass: classification rules UI, env transfer tuning, backlog alignment)

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
| **Home / cash dashboard (Epic 7.1 / 7.2)** | 🟡 | **`GET /reports/cash-summary`** — presets, KPIs, **`comparison.previousPeriod`** + optional **`yearOverYear`** (household deltas), account filter, by-account, **by-category** + charts when `categoryBreakdown=true`, trend. **Transfer rows excluded** when `transfer_group_id` set or open **`transfer_ambiguity`** (**CR-004**). **UI:** `unknown_category` banner, **KPI delta chips**, chart/table **drill-down** to ledger (`categoryId`, `accountId`, dates). **Not yet:** safe-to-spend / savings targets, arbitrary custom date range (`docs/API_CASH_SUMMARY.md`) |
| **Classification (Epic 5.1)** | 🟡 | **Static rules** in **`category-rules.ts`** + **DB rules** (migration **`0009`**, **`category_rule`** table) evaluated before defaults; **`classification_meta`** on canonical rows for explainability. **`GET/POST/PATCH /categories/rules`**; **UI:** **`/categories/rules`** (list, add, edit, enable/disable — linked from **`/categories`**). **`unknown_category`** on **`/resolution`** with type filter + inline category + summary chips. **Still not:** bulk category from queue, richer confidence UX |
| **Category hierarchy + ledger UX (Epic 5.3)** | 🟡 | **Migrations** through **`0008`** (+ **`0009`** for rules). **`/categories`** page. **Ledger:** **`LedgerCategoryPicker`** (portal flyout, inline **`POST /categories`**), **single-line** category cell, **no Status column** (**UX-003**, **PRD-001**). **Gaps:** D-014 (`/categories` vs ledger-only); hierarchical **`byCategory`** semantics beyond **`categoryRollup`** |
| **Transfer matcher (Epic 5.2)** | 🟡 | Matcher in **`canonical-ingest.service.ts`**: scoring, **`transfer_ambiguity`**, **`low_pair_score`** when description confidence is below threshold. **Tunable via `.env`:** `TRANSFER_MIN_AUTO_PAIR_SCORE`, `TRANSFER_DISAMBIG_*` — see **`backend/src/config/env.ts`** and **`.env.example`**. **Not** exhaustive real-world card/loan coverage |
| **UI shell & routing** | ✅ | **App shell** — Home (`/`), Ledger, Categories (**+** **`/categories/rules`**), Review queue, New import. **`/dashboard`** → **`/`** |
| **Import UX** | 🟡 | Closed sessions: uploads hidden; **Start another import session** |
| **Operator purge** | ✅ | `npm run import:purge` — `docs/IMPORT_STAGING_PURGE.md` |
| **Tests** | 🟡 | Vitest + integration paths (canonicalize, cash-summary, category rules, transfer exclusion) — **`cd backend && npm test`** should pass after **`0008`** Income parent fix |

---

## Key docs (by topic)

| Topic | File |
|----------|------|
| Backlog & epics | `docs/MVP_BACKLOG.md` |
| **Change / CR / UX history** | **`docs/CHANGE_HISTORY.md`** |
| Decisions (ADR-lite) | `docs/DECISIONS_LOG.md` |
| Import API | `docs/API_IMPORT_SESSIONS.md` |
| Ledger API | `docs/API_LEDGER.md` |
| Categories API | `docs/API_CATEGORIES.md` |
| Resolution queue API | `docs/API_RESOLUTION.md` |
| Cash summary (home) | `docs/API_CASH_SUMMARY.md` |
| Staging purge | `docs/IMPORT_STAGING_PURGE.md` |
| Payslip (planned v1) | `docs/PAYSLIP_V1.md` |

---

## Sensible next steps (prioritized themes)

1. **Epic 5.2 continuation:** broaden transfer matcher coverage (card payments, loan patterns) + tests.
2. **Epic 5.1 continuation:** bulk category assignment from resolution grid; polish confidence/explainability display.
3. **Epic 7 continuation:** ledger drill paging/context, category-level period comparisons (optional), **safe-to-spend** + savings targets.
4. **Epic 6:** import inbox file-level drill-down; bulk category from resolution grid.  
5. **Product cleanup:** **D-014** — whether **`/categories`** + **`/categories/rules`** stay as power-user surfaces or consolidate (**`docs/DECISIONS_LOG.md`**).  
6. **Docs hygiene:** append **`CHANGE_HISTORY.md`** when shipping user-visible or behavior-changing work.

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
- `frontend/src/components/LedgerCategoryPicker.tsx` — ledger category flyout + inline create  
- `frontend/src/pages/TransactionsPage.tsx` — ledger table (**no Status column**)  
- `frontend/src/pages/CategoriesPage.tsx` — category management; **link to rules**  
- `frontend/src/pages/CategoryRulesPage.tsx` — **household classification rules UI**  
- `docs/CHANGE_HISTORY.md` — **CR / UX / FIX / PRD deviation log**
