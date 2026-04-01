# End-to-end runbook (brand new environment)

Single checklist to go from an empty machine to a running app. For **production** database policy (minimal seeds), see [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md). API surface: [`openapi/openapi.yaml`](../openapi/openapi.yaml). Migration order: [`backend/db/README.md`](../backend/db/README.md).

## 1. Prerequisites

- **Node.js** — Current LTS (v20+ recommended).
- **npm** — Comes with Node (workspace monorepo at repo root).
- **Ports** — Defaults: UI **3000**, API **4000** (see `.env.example`: `FRONTEND_PORT`, `PORT`). Ensure nothing else binds to those ports, or change them in `.env`.
- **Optional:** `sqlite3` CLI for ad-hoc inspection (not required for normal operation).

## 2. Get the code

```bash
git clone <your-repo-url> household-finance-app
cd household-finance-app
```

## 3. Install dependencies

From the **repository root** (workspaces install backend + frontend):

```bash
npm install
```

## 4. Environment file

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | **Required** for anything beyond local throwaway use. Long random string for signing JWTs. |
| `MODE` | `TEST` (default dev DB file) or `PROD` for a separate SQLite file. |
| `DB_PATH` | Optional absolute or repo-relative path; when set, **overrides** `MODE` file selection. |
| `DB_PATH_TEST` / `DB_PATH_PROD` | Used when `DB_PATH` is unset (see backend [`env.ts`](../backend/src/config/env.ts)). |
| `PORT` / `FRONTEND_PORT` | API and Vite dev server ports. |
| `VITE_PROXY_API` | (Optional) Base URL for API proxy in dev; default `http://127.0.0.1:4000`. |
| `VITE_DEV_SIGNIN_EMAIL` / `VITE_DEV_SIGNIN_PASSWORD` | (Optional) Prefill sign-in on the home page in dev only; leave empty for no prefill. |
| `AI_CATEGORY_*` + `OPENAI_*` | (Optional) OpenAI categorization controls. Keep `AI_CATEGORY_ENABLED=false` until you are ready. |

**API logs:** The backend prints to **stdout/stderr** only (no rotating log files). See [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

**Seeded database user:** The first user is inserted only by [`backend/db/seeds/0001_seed_defaults.sql`](../backend/db/seeds/0001_seed_defaults.sql) (email + bcrypt hash). Optional sign-in field prefill uses `VITE_DEV_SIGNIN_*` only (see above), not the backend env.

## 5. Database (schema + seeds)

**Which file is used:** The API and all `npm run db:*` scripts resolve the same path via [`scripts/print-db-path.mjs`](../scripts/print-db-path.mjs) (same rules as the backend). To print it:

```bash
node scripts/print-db-path.mjs
```

**First-time dev setup (includes sample bank accounts under `seeds/dev/`):**

```bash
npm run setup
```

This runs `scripts/setup.sh`: `npm install`, creates `data/` and `.runtime/logs/`, then `scripts/db.sh --init --seed --dev-seeds`.

**Migrations only (no seeds):**

```bash
npm run db:init
```

**Migrations + minimal seeds** — default household, owner user, **global categories only** (no `financial_account` rows):

```bash
npm run db:seed
```

**Migrations + minimal seeds + dev sample accounts** (BoA/Citi/Chase/Marcus — for local smoke / tests; payslip bucket comes from profile, not SQL):

```bash
npm run db:seed:dev
```

## 6. Run the application

**Option A — background services (logs under `.runtime/logs/`):**

```bash
npm run services:start
```

**Option B — two terminals:**

```bash
# Terminal 1
npm run dev:backend

# Terminal 2
npm run dev:frontend
```

Vite reads env from the **repository root** (`envDir` in [`frontend/vite.config.ts`](../frontend/vite.config.ts)) so `FRONTEND_PORT`, `VITE_*`, etc. in the root `.env` apply when you use `npm run dev:frontend`.

- **UI:** `http://127.0.0.1:3000` (or `FRONTEND_PORT`).
- **API:** `http://127.0.0.1:4000` (or `PORT`).
- **Health:** `GET http://127.0.0.1:4000/health`

## 7. First sign-in

1. Open the home page (`/`).
2. Sign in with the **seeded** user from `0001_seed_defaults.sql` (default **owner@example.com** / **ChangeMe123!**) unless you changed the seed file.
3. You should land on the cash snapshot / dashboard after auth.

**Production:** change the default password immediately; consider not shipping dev seeds (see `PRODUCTION_SETUP.md`).

## 8. Smoke checks

- Sign in succeeds; **Home** loads.
- **Transactions** and **Settings** open without console errors.
- Optional quality gates:

```bash
npm run lint
npm test
```

## 9. Stop and reset

**Stop the API before cleanup.** If SQLite is still open, `rm` can remove the directory entry while Node keeps the **old** database in memory — the UI will still show transactions until you stop the process. On macOS/Linux, `db:cleanup` uses `lsof` and **refuses** to delete while something holds the file (unless you set `DB_CLEANUP_ALLOW_OPEN=1` and then restart the API yourself).

```bash
npm run services:stop
```

Compare paths: the backend logs `SQLite: /absolute/path/...` on startup; `node scripts/print-db-path.mjs` must print the same path.

**Reset the database file the API uses (destructive):**

`npm run db:cleanup` runs `scripts/db-cleanup.sh` with `--yes` and removes the resolved SQLite path (and `-wal` / `-shm`).

**Full wipe + reseed:**

```bash
npm run db:cleanup
npm run db:seed
# or, if you want the sample bank accounts again:
# npm run db:seed:dev
```

Then start the API again (`npm run services:start` or `npm run dev:backend`). Clear site storage or sign out if you had an old JWT.

## 10. Validation and troubleshooting

**Confirm you are looking at the same DB as the backend:**

```bash
node scripts/print-db-path.mjs
# Optional, if sqlite3 is installed:
# sqlite3 "$(node scripts/print-db-path.mjs | tr -d '\r\n')" "SELECT COUNT(*) FROM transaction_canonical;"
```

| Symptom | Check |
|---------|--------|
| `db:cleanup` ran but the UI still shows old rows | **API was still holding the DB open** (most common): stop with `npm run services:stop`, run `db:cleanup` again, then `db:seed` and restart. Or wrong file: compare backend log line `SQLite: …` with `node scripts/print-db-path.mjs`. |
| Port in use | Change `PORT` / `FRONTEND_PORT` in `.env` or stop the other process. |
| 401 / invalid token | Clear browser storage for the site; sign in again. |
| Missing tables / old schema | Run `npm run setup` or `npm run db:seed` after `db:cleanup`. |
| Import staging disk | See [`IMPORT_STAGING_PURGE.md`](IMPORT_STAGING_PURGE.md); `npm run import:purge -- --help`. |

## Related docs

- [`README.md`](../README.md) — quick start summary  
- [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) — `.env` reference (DB path, Vite, transfer thresholds)  
- [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) — production DB and seeds  
- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — product scope  
- [`CHECKPOINT.md`](CHECKPOINT.md) — implementation status  

## 11. Production roadmap notes (SQLite -> Postgres / Koyeb)

The current setup and scripts are SQLite-centric. For Koyeb + hosted Postgres migration, treat this as a tracked
phase after parser/categorization stabilization:

- add Postgres runtime support and migration compatibility,
- define `DATABASE_URL` + SSL/pooling env contract,
- decide startup migration strategy for container deploys,
- validate backups/rollback and health-check behavior in Koyeb.
