# Grove

Self-hosted household finance: import bank and card activity, categorize with rules, resolve exceptions, and view cash summaries on a private stack you control. Data stays on your infrastructure (**Postgres**).

**Multi-person household:** add family members in Settings → Household, then attribute accounts, transactions, payslips, and net worth snapshots to individuals. Transactions, Net Worth, and Payslip views all filter by member. Multiple login users per household are supported at the database level (see [`RUNBOOK.md`](docs/RUNBOOK.md)).

**Monorepo:** `backend/` (Node.js + Express API), `frontend/` (Vite + React).

## Documentation

| Audience | Start here |
|----------|------------|
| **People using the app** | [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) |
| **Developers — full setup from zero** | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| **Production / hosting / DB policy** | [`docs/PRODUCTION_SETUP.md`](docs/PRODUCTION_SETUP.md) |
| **Environment variables** | [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md) |
| **HTTP API** | [`openapi/openapi.yaml`](openapi/openapi.yaml) · [`docs/API_INDEX.md`](docs/API_INDEX.md) |
| **System design** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| **Release / change log** | [`docs/CHANGE_HISTORY.md`](docs/CHANGE_HISTORY.md) |
| **User guide** | [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) |

## One-command workflows (local dev)

| Goal | Command |
|------|---------|
| **1. First-time machine setup** — install packages, create runtime dirs, apply migrations + bootstrap seed + dev sample accounts | `npm run setup` |
| **2. Start API + frontend together** (background, logs under `.runtime/logs/`) | `npm run start:dev` (same as `npm run services:start`) |
| **3. Database only** — migrations + seeds (no `npm install`) | `npm run db:seed` (minimal seed) or `npm run db:seed:dev` (+ sample accounts) |
| **4. Wipe database** — drop/recreate `public` schema, re-run migrations + seeds | `npm run db:cleanup` or `npm run db:reset` (same). Optional: `npm run db:reset:dev` to reseed with dev accounts |
| **5. Stop API + frontend** | `npm run stop:dev` (same as `npm run services:stop`) |

`npm run setup` creates `.env` from `.env.example` if `.env` is missing. Edit **`JWT_SECRET`** and **`DATABASE_*`** (see [`.env.example`](.env.example)). For local Docker Postgres: `docker compose up -d` before setup if the DB is not already running.

## Quick start (development)

1. **Prerequisites:** Node.js **20.x** (see `engines` in root `package.json`), **npm**, and a **Postgres** instance (see [`docker-compose.yml`](docker-compose.yml) for local port **5433**).

2. **One-shot setup** (from repo root):

   ```bash
   npm run setup
   ```

   This runs `npm install`, prepares `data/` and `.runtime/`, then applies migrations and seeds **including** dev sample bank accounts. For **bootstrap-only** seed (no sample accounts), use `npm run db:seed` after a clean DB — see [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

3. **Run the app:**

   ```bash
   npm run start:dev
   ```

   - UI: `http://127.0.0.1:3000` (or `FRONTEND_PORT`)
   - API: `http://127.0.0.1:4000` (or `PORT`)
   - Health: `GET /health`

   Interactive alternative: `npm run dev` (API) and `npm run dev:frontend` in two terminals.

4. **Stop:** `npm run stop:dev`

5. **Reset database:** stop services, then `npm run db:cleanup` and `npm run db:seed` (or `npm run setup` for a full reinstall path). Connection settings are in `.env` (`DATABASE_*`).

## Quality checks

```bash
npm test          # backend + frontend tests
npm run lint      # eslint both workspaces
```

## Import staging cleanup

Dry-run by default; see `npm run import:purge -- --help` before using destructive flags.

## Sample CSV templates

Repository-tracked examples for category and household-rule CSV import live under [`fixtures/category-import/`](fixtures/category-import/) (see README there).
