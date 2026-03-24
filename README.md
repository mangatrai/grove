# Household Finance App

Private, self-hosted household finance platform with a strict correctness-first
ingestion pipeline.

## Monorepo Layout

- `docs/`: product and architecture documents.
- `docs/API_IMPORT_SESSIONS.md`: Epic 2.1 import session + file intake API contract.
- `docs/API_LEDGER.md`: read-only `GET /transactions` (canonical ledger).
- `backend/`: API, domain model, migrations, auth/RBAC baseline.
- `frontend/`: Vite + React Import UI (Epic 2.3).

## Quick Start

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`.
   - Set `MODE=TEST` for development and `MODE=PROD` for production runs on the same machine.
2. Run initial setup (dependencies + SQLite schema + seed):
   - `npm run setup`
3. Start backend + frontend dev servers (background, logs under `.runtime/logs/`):
   - `npm run services:start`
   - Open the UI (default **http://127.0.0.1:3000**), log in with seeded credentials from `.env.example`, then **New import session**.
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

## Current Implementation Scope

- Epic 1: monorepo, migrations, seed, auth/RBAC baseline.
- Epic 2.1+: import sessions API; **Epic 2.3**: browser Import UI (`frontend/`) for session → upload → bind → parse → canonicalize.

