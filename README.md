# Household Finance App

Self-hosted household finance: import bank and card activity, categorize with rules, resolve exceptions, and view cash summaries on a private stack you control. Data stays on your infrastructure (SQLite by default).

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
| **Dead code / optional features audit** | [`docs/DEAD_CODE.md`](docs/DEAD_CODE.md) |

## Quick start (development)

1. **Prerequisites:** Node.js **20.x** (see `engines` in root `package.json`), **npm**.

2. **Environment:** copy `.env.example` to `.env`. Set a strong **`JWT_SECRET`**. Use **`MODE=TEST`** for the default dev SQLite file, or **`MODE=PROD`** for a separate file on the same machine. See `.env.example` for ports (`PORT`, `FRONTEND_PORT`).

3. **Install and database:** from the repo root:

   ```bash
   npm install
   npm run setup
   ```

   `setup` installs dependencies, creates `data/`, and applies migrations plus seeds **including** sample bank accounts for local smoke tests.

   For **minimal** seed (default household + owner + global categories, **no** sample accounts): after a clean DB, use `npm run db:seed` — details in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

4. **Run the app:**

   ```bash
   npm run services:start
   ```

   - UI: `http://127.0.0.1:3000` (or `FRONTEND_PORT`)
   - API: `http://127.0.0.1:4000` (or `PORT`)
   - Health: `GET /health`

   Interactive alternative: `npm run dev` (API) and `npm run dev:frontend` in two terminals.

5. **Stop:** `npm run services:stop` (stops wrapper processes and clears listeners on the dev ports).

6. **Reset database:** stop services, then `npm run db:cleanup` and `npm run db:seed` (or `npm run setup`). Resolve the active DB path with `node scripts/print-db-path.mjs`.

## Quality checks

```bash
npm test          # backend + frontend tests
npm run lint      # eslint both workspaces
```

## Import staging cleanup

Dry-run by default; see `npm run import:purge -- --help` before using destructive flags. Background: [`docs/archive/IMPORT_STAGING_PURGE.md`](docs/archive/IMPORT_STAGING_PURGE.md).

## Sample CSV templates

Repository-tracked examples for category and household-rule CSV import live under [`fixtures/category-import/`](fixtures/category-import/) (see README there).
