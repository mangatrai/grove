# Development checkpoint

**Last updated:** 2025-03-24 (session handoff — pick up from here anytime)

This file is the **single place** to see what the repo actually does today vs the backlog, and what to do next.

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

---

## Implemented (high level)

| Area | Status | What exists |
|------|--------|-------------|
| **Auth** | ✅ | Login, JWT, household-scoped routes |
| **Import** | ✅ | Session → upload → bind account/profile → parse → canonicalize; staging **deleted after successful canonicalize** |
| **Dedupe (Epic 4.2)** | ✅ | `transaction-fingerprint.ts` — stable date/amount/description; exact fingerprint dedupe; **near-duplicate** path (same account/date/amount, compatible description) → **`resolution_item`** (`duplicate_ambiguity`), not posted; **`nearDuplicates`** in canonicalize response |
| **Home / cash dashboard (Epic 7.1)** | 🟡 | **`GET /reports/cash-summary`** — period presets (month / YTD / rolling 30 & 90), KPIs, optional **account** filter, **by-account** breakdown, **by-category** + **monthly outflows by category** when `categoryBreakdown=true`, 6-month net trend + category charts (Recharts). **UI:** authenticated **`/`** (former `/dashboard` redirects here). **Not yet:** savings-rate / safe-to-spend, configurable targets (`docs/API_CASH_SUMMARY.md`) |
| **Classification (Epic 5.1)** | 🟡 | **`category-rules.ts`** on canonicalize → **`category_id`**; **`GET /categories`** (includes **`parentId`**); ledger **`categoryId`/`categoryName`** + **`PATCH /transactions/:id`**. **Not yet:** `unknown_category` queue wiring, DB-driven rules UI, confidence scores (`docs/API_CATEGORIES.md`, `docs/API_LEDGER.md`) |
| **Category hierarchy (Epic 5.3)** | ⬜ | **Story 5.3** — hierarchical seed, household create subcategory, API validation; see **`docs/MVP_BACKLOG.md`**. Schema **`parent_id`** exists; behavior not shipped yet. |
| **UI shell & routing** | ✅ | **App shell** — sticky header when signed in (`ShellLayout`): nav **Home** (`/` = dashboard), **Ledger**, **Review queue**; **New import** (no separate Import nav item). Guests at **`/`** see sign-in card only (no header). **Vite proxy:** `/categories`, `/resolution`, `/reports` (see `frontend/vite.config.ts`) |
| **Import UX** | 🟡 | When session is **`review`** / **`finalized`** / **`failed`**, uploads **hidden**; **“Start another import session”**; file-level inbox drill-down still backlog (Epic 6) |
| **Operator purge** | ✅ | `npm run import:purge` — see `docs/IMPORT_STAGING_PURGE.md` |
| **Tests** | 🟡 | `prep-test-db.sh` + `clean-import-session-dirs.mjs` + Vitest global teardown; integration tests include canonicalize idempotency, near-duplicate, cash-summary category breakdown |

---

## Key docs (by topic)

| Topic | File |
|----------|------|
| Backlog & epics | `docs/MVP_BACKLOG.md` |
| Import API | `docs/API_IMPORT_SESSIONS.md` |
| Canonicalize | `docs/API_IMPORT_SESSIONS.md` (canonicalize section includes `nearDuplicates`) |
| Ledger API | `docs/API_LEDGER.md` |
| Categories API | `docs/API_CATEGORIES.md` |
| Resolution queue API | `docs/API_RESOLUTION.md` |
| Cash summary (home) | `docs/API_CASH_SUMMARY.md` |
| Staging purge | `docs/IMPORT_STAGING_PURGE.md` |
| Payslip (planned v1) | `docs/PAYSLIP_V1.md` |

---

## Sensible next steps (not started)

1. **Epic 5 Story 5.3 — category hierarchy:** hierarchical **seed**, **`POST`/`PATCH`** (or equivalent) for household categories/subcategories, ledger **grouped picker**, then **Epic 7.2** roll-up in `byCategory` — see `MVP_BACKLOG.md`.
2. **Epic 5.1 continuation:** **`unknown_category`** queue, DB-driven rules UI, optional confidence — alongside or after 5.3.
3. **Epic 7 continuation:** period comparisons, safe-to-spend / savings target, **drill-down** from category charts to ledger (7.1–7.2 stretch); hierarchy roll-up **after 5.3**.
4. **Epic 6 continuation:** richer **inbox** (file-level drill-down), **undo before finalize** (6.3), bulk **category** / transfer actions when classification exists (Story 6.2 stretch goals).
5. **Payslip v1 (3.3a):** IBM summary strip + storage — **after** you schedule it (`docs/PAYSLIP_V1.md`).
6. **Epic 3.2:** More bank PDF adapters — deprioritized until polish; see backlog planning note.
7. **Backlog hygiene:** Keep Story **4.2** / **5** / **6** / **7** entries in `MVP_BACKLOG.md` in sync with this file when you ship more.

---

## Quick file map (dedupe + resolution)

- `backend/src/modules/canonical/transaction-fingerprint.ts` — fingerprint contract
- `backend/src/modules/canonical/canonical-ingest.service.ts` — ingest + near-duplicate + `deleteStagingFilesForSession`
- `backend/src/modules/resolution/resolution.service.ts` + `resolution.routes.ts` — `GET /resolution`, `PATCH /resolution/:id`, `POST /resolution/bulk`
- `frontend/src/pages/ResolutionQueuePage.tsx` — queue UI + row/bulk status actions
- `frontend/src/pages/ImportWorkspacePage.tsx` — import flow + closed-session upload UX
- `backend/src/modules/reports/` — `GET /reports/cash-summary`
- `frontend/src/pages/HomeRoute.tsx` — `/` → dashboard if JWT, else sign-in card
- `frontend/src/pages/DashboardPage.tsx` — Cash KPIs + category charts (authenticated home)
- `frontend/src/layout/ShellLayout.tsx` + `AppHeader.tsx` — app chrome; `src/auth/RequireAuth.tsx` — protected routes
- `backend/src/modules/category/` — rules + `GET /categories`; canonical ingest sets `category_id`; ledger `PATCH` for category
