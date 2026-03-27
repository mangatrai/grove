# Development checkpoint

**Last updated:** 2026-03-27

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

Default **UI:** `http://127.0.0.1:3000` · **API:** `http://127.0.0.1:4000` · See root `.env` for `PORT` / `FRONTEND_PORT`.

`npm test` in `backend/` runs **`prep-test-db.sh`**, **`db.sh --init --seed`**, then Vitest — it can sit without output for tens of seconds while SQLite is recreated; that is normal. If another process locks the test DB, stop it and retry.

**Migration order:** SQL migrations run **before** seeds. Any migration that inserts rows with `parent_id` to built-in parents must **`INSERT OR IGNORE`** those parents in the migration if they only existed in seed before (see **`0008`** + **FIX-002** in **`docs/CHANGE_HISTORY.md`**).

---

## Implemented (high level)

| Area | Status | What exists |
|------|--------|-------------|
| **Auth** | ✅ | Login, JWT, household-scoped routes |
| **Import** | ✅ | Session → upload → bind account/profile → parse → canonicalize; staging **deleted after successful canonicalize** |
| **Dedupe (Epic 4.2)** | ✅ | `transaction-fingerprint.ts` — stable fingerprint; near-duplicate → **`resolution_item`** (`duplicate_ambiguity`); **`nearDuplicates`** in canonicalize response |
| **Home / cash dashboard (Epic 7.1)** | 🟡 | **`GET /reports/cash-summary`** — presets, KPIs, account filter, by-account, **by-category** + charts when `categoryBreakdown=true`, trend. **Transfer rows excluded** from income/expense/category aggregates when `transfer_group_id` set or open **`transfer_ambiguity`** (see **CR-004** in **`docs/CHANGE_HISTORY.md`**). **New:** dashboard resolution surfacing for open `unknown_category` items and **chart->ledger drill-down** (pie slice click + “View” links) with the ledger pre-filtered by **category** and **optionally account**. **Not yet:** savings-rate / safe-to-spend, configurable targets (`docs/API_CASH_SUMMARY.md`) |
| **Classification (Epic 5.1)** | 🟡 | **`category-rules.ts`** → **`category_id`** on canonicalize; **`GET /categories`**; ledger **`PATCH /transactions/:id`**. **Migration + rules:** Income **leaves** (Salary, Interest, Dividends, Refunds, Rental income), **Taxes** / **Transfers** parents + leaves (`0008`, `category-ids.ts`). **Now delivered:** `unknown_category` is actionable via **`/resolution`** type filter + **inline category assignment** on unknown items (uses the same ledger picker). **Still not:** DB-driven rules UI, confidence scores |
| **Category hierarchy + ledger UX (Epic 5.3)** | 🟡 | **Seed + migrations** through **`0008_income_taxes_transfers_taxonomy.sql`** (Income leaves, Taxes/Transfers, Rental reparented). **`POST`/`PATCH`/`DELETE /categories`**. **`/categories`** page (grouped table + add parent/sub). **Ledger:** **`LedgerCategoryPicker`** — portal **modal-style** flyout (backdrop, 3 columns), inline **create group / subcategory** via **`POST /categories`**, **single-line** trigger (leaf vs parent vs uncategorized styling). **Ledger table:** **no Status column** (user preference). **Gaps:** optional demotion of **`/categories`** if ledger-only parity is enough; hierarchical **`byCategory` roll-up** in reports still product-dependent (Epic 7.2) |
| **Transfer matcher (Epic 5.2)** | 🟡 | **Minimal** post-ingest matcher sets **`transfer_group_id`** for clear pairs; **`transfer_ambiguity`** resolution items when unclear. **Improved:** description/merchant+memo based scoring to disambiguate multiple candidates and a slightly wider date window (still conservative) — see **CR-006 / CR-007** in **`docs/CHANGE_HISTORY.md`**. **Not** full card/loan payment story coverage |
| **UI shell & routing** | ✅ | **App shell** — Home (`/`), Ledger, Categories, Review queue, New import. **`/dashboard`** → **`/`** |
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

1. **Epic 5.2 continuation:** broaden transfer matcher coverage (card payments, loan patterns) + strengthen ambiguity handling tests.
2. **Epic 5.1 continuation:** DB-driven rules UI, optional confidence scores, and improve bulk assignment ergonomics for unknown items.
3. **Epic 7 continuation:** deeper drill-down (e.g. ledger row paging / better drill semantics), category-level trend comparisons if needed, **safe-to-spend** + savings targets.
4. **Epic 6:** inbox drill-down, bulk category from resolution grid.  
5. **Product cleanup:** decide whether **`/categories`** stays as “advanced” or is folded into ledger-only flows (**D-014** / **DECISIONS_LOG.md**).  
6. **Docs hygiene:** keep **`CHANGE_HISTORY.md`** updated when user-facing behavior changes.

---

## Quick file map (categories + ledger + reporting)

- `backend/src/modules/category/category-rules.ts` — default classification rules  
- `backend/src/modules/category/category-ids.ts` — leaf/parent id constants  
- `backend/db/migrations/0008_income_taxes_transfers_taxonomy.sql` — Income/Taxes/Transfers taxonomy  
- `backend/src/modules/canonical/canonical-ingest.service.ts` — ingest, dedupe, **transfer matcher** hook  
- `backend/src/modules/reports/cash-summary.service.ts` — KPIs; **transfer exclusion** clause  
- `frontend/src/components/LedgerCategoryPicker.tsx` — ledger category flyout + inline create  
- `frontend/src/pages/TransactionsPage.tsx` — ledger table (**no Status column**)  
- `frontend/src/pages/CategoriesPage.tsx` — full category management  
- `docs/CHANGE_HISTORY.md` — **CR / UX / FIX / PRD deviation log**
