# Household Finance App

Private, self-hosted household finance platform with a strict correctness-first
ingestion pipeline.

## Monorepo Layout

- `docs/`: product and architecture documents.
- `docs/API_IMPORT_SESSIONS.md`: Epic 2.1 import session + file intake API contract.
- `docs/API_LEDGER.md`: `GET /transactions`, `PATCH /transactions/:id` (category); optional `sessionId` filter.
- `docs/API_CATEGORIES.md`: Epic 5.1 / 5.3 — `GET /categories`, **`/categories/rules`** (household classification rules), taxonomy + CRUD.
- `docs/IMPORT_STAGING_PURGE.md`: Epic 2.4 — purge `data/imports/...` staging files + clear `stored_path`.
- `docs/PAYSLIP_V1.md`: Epic 3 Story 3.3 — payslip module intent, v1 summary-only scope, storage vs ledger (see backlog).
- `docs/API_RESOLUTION.md`: resolution queue — `GET` / `PATCH` / `POST /resolution/bulk` (`resolution_item`).
- `docs/API_CASH_SUMMARY.md`: Epic 7.1 cash view — `GET /reports/cash-summary` (dashboard KPIs + trend).
- `docs/CHECKPOINT.md`: **current implementation status** (✅ / 🟡 / ⬜ progress legend), run commands, file map, next steps (keep in sync when shipping).
- `docs/CHANGE_HISTORY.md`: **CR / UX / fix history** and PRD deviations — why the app diverges from earlier backlog wording.
- `backend/`: API, domain model, migrations, auth/RBAC baseline.
- `frontend/`: Vite + React Import UI (Epic 2.3).

## Quick Start

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`.
   - Set `MODE=TEST` for development and `MODE=PROD` for production runs on the same machine.
2. Run initial setup (dependencies + SQLite schema + seed):
   - `npm run setup`
3. Start backend + frontend dev servers (background, logs under `.runtime/logs/`):
   - `npm run services:start`
   - Open the UI (default **http://127.0.0.1:3000**), log in with seeded credentials from `.env.example` — land on the **home dashboard** (cash KPIs). Use **New import** in the header when you need a statement import.
   - Or run interactively: `npm run dev` (backend only) and `npm run dev:frontend` in a second terminal.
4. Stop services when needed:
   - `npm run services:stop` — stops the recorded wrapper PIDs, then **clears whatever is still listening** on the dev ports
     (**`FRONTEND_PORT` / `PORT`**, default **3000** / **4000** from `.env`). That catches **orphan** `node`
     (Vite) processes that are no longer a child of the wrapper PID (common on macOS).
   - If you use another app on those ports, stop it first or change ports in `.env`.
5. Reset current mode DB only (safe by mode):
   - `npm run db:cleanup`

**Migrations:** new SQL files under `backend/db/migrations/` apply on `npm run setup` / `db:init`. If the account dropdown
still omits **last-four** labels, your DB may predate a mask fix — run a fresh init for your mode or apply migrations so
`financial_account.account_mask` stores digits (see `0005_account_mask_last_four.sql`).

**Import staging disk cleanup (Epic 2.4):** run **`npm run import:purge -- --help`** — dry-run by default; see `docs/IMPORT_STAGING_PURGE.md` before using `--execute`.

## Current Implementation Scope

Progress markers: ✅ done · 🟡 partial · ⬜ not started (see **`docs/CHECKPOINT.md`** for the live table).

- ✅ Epic 1: monorepo, migrations, seed, auth/RBAC baseline.
- 🟡 Epic 2.1+: import sessions API; **Epic 2.3**: browser Import UI (`frontend/`) for session → upload → bind → parse → canonicalize; **uploads only in `created`/`processing`** — after **review**, UI steers users to a **new import session** (see `docs/MVP_BACKLOG.md` Story 2.1 note).
- ✅ Epic 2.4: staging purge script + auto-delete staging after successful canonicalize; test cleanup for `data/imports` session dirs.
- ✅ **Epic 4.2 (baseline):** fingerprint dedupe, near duplicates → `resolution_item`, `GET /resolution`, Review queue page, `nearDuplicates` in API/UI.
- 🟡 **Epic 6 (partial):** resolution queue with status filters, row context, ledger links, per-row and **bulk** status actions; **not** category bulk or full inbox drill-down yet.
- 🟡 **Epic 7.1–7.2 (partial):** **Home** at **`/`** — cash KPIs, **`categoryBreakdown`**, **period comparison deltas** (prior window / YoY where applicable); **`/dashboard`** → **`/`**; drill-down to ledger. **Not** safe-to-spend / savings targets or arbitrary custom date range (see **`docs/API_CASH_SUMMARY.md`**).
- ✅ **Frontend shell (signed-in):** sticky **header** — **Home**, **Ledger**, **Categories**, **Review queue**, **New import**, **Sign out**.
- 🟡 **Epic 5.1–5.3 (partial):** taxonomy through **`0008`** + **`0009`** (DB **`category_rule`**); **`GET /categories`**, **`GET/POST/PATCH /categories/rules`**, **`/categories`** and **`/categories/rules`** UIs; ledger **`LedgerCategoryPicker`** + **`PATCH /transactions/:id`**; **`unknown_category`** on resolution queue with inline assign. **Epic 5.2 (partial):** transfer matcher + **env-tunable** thresholds (**`.env`** / **`backend/src/config/env.ts`**); **cash-summary** excludes transfers when identified.
- **Not yet:** full transfer matcher coverage, **bulk** category from resolution, import undo before finalize.

**Detail:** `docs/CHECKPOINT.md` · **Backlog:** `docs/MVP_BACKLOG.md` · **History:** `docs/CHANGE_HISTORY.md`.

