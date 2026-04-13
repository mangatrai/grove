# End-to-end runbook (brand new environment)

Single checklist to go from an empty machine to a running app. For **production** database policy (minimal seeds), see [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md). API surface: [`openapi/openapi.yaml`](../openapi/openapi.yaml). Database layout and baseline notes: [`backend/db/README.md`](../backend/db/README.md). **Operator FAQ** (import sessions, recategorize scope, exports, Postgres probe): [`OPERATOR_FAQ.md`](OPERATOR_FAQ.md). **Postgres cutover** roadmap: [`POSTGRES_CUTOVER.md`](POSTGRES_CUTOVER.md).

## 1. Prerequisites

- **Node.js** — Current LTS (v20+ recommended).
- **npm** — Comes with Node (workspace monorepo at repo root).
- **Ports** — Defaults: UI **3000**, API **4000** (see `.env.example`: `FRONTEND_PORT`, `PORT`). Ensure nothing else binds to those ports, or change them in `.env`.
- **Optional:** `psql` or a GUI SQL client for ad-hoc Postgres inspection (not required for normal operation).

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
| `MODE` | `TEST` or `PROD`. With **`MODE=PROD`**, the built API serves **`frontend/dist`** when present; does not select a different database (Postgres is always **`DATABASE_*`**). |
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` | **Required** for the API. Local Docker Compose defaults are in [`.env.example`](../.env.example). |
| `DATABASE_SSL` | Use **`0`** for local Postgres without TLS (e.g. `docker compose` on localhost); **`1`** for managed TLS. |
| `PORT` / `FRONTEND_PORT` | API and Vite dev server ports. |
| `VITE_PROXY_API` | (Optional) Base URL for API proxy in dev; default `http://127.0.0.1:4000`. |
| `VITE_DEV_SIGNIN_EMAIL` / `VITE_DEV_SIGNIN_PASSWORD` | (Optional) Prefill sign-in on the home page in dev only; leave empty for no prefill. |
| `OPENAI_*` | Used for **Deloitte payslip LLM import** when configured; not used for transaction categorization (rules-only). See [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md). |
| `LOG_LEVEL` | (Optional) Backend verbosity: `debug`, `info`, `warn`, `error`, or `silent` (default `info`). See [`LOGGING.md`](LOGGING.md). |

**API logs:** Backend output is controlled by **`LOG_LEVEL`** (see [`LOGGING.md`](LOGGING.md)); capture to files with `npm run services:start` → `.runtime/logs/backend.log`. Full index: [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

**Seeded database user:** The first user is inserted only by [`backend/db/seeds/0001_bootstrap.sql`](../backend/db/seeds/0001_bootstrap.sql) (email + bcrypt hash). Optional sign-in field prefill uses `VITE_DEV_SIGNIN_*` only (see above), not the backend env.

## 5. Database (Postgres: schema + seeds)

**Postgres only** — see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) and [`POSTGRES_CUTOVER.md`](POSTGRES_CUTOVER.md). Start local Postgres with **`docker compose up -d`** from the repo root (see [`docker-compose.yml`](../docker-compose.yml)), then set **`DATABASE_*`** in `.env` (port **5433** → server **5432** per compose).

**Migrations:** ordered `*.sql` under [`backend/db/migrations/`](../backend/db/migrations/). The **API applies pending migrations on startup** when it first connects. **`npm run db:*`** / [`scripts/db.sh`](../scripts/db.sh) apply the same files using your `.env` **`DATABASE_*`** (useful before the API runs, or from CI).

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
2. Sign in with the **seeded** user from `0001_bootstrap.sql` (default **owner@example.com** / **ChangeMe123!**) unless you changed the seed file.
3. You should land on the cash snapshot / dashboard after auth.

**Production:** change the default password immediately; consider not shipping dev seeds (see `PRODUCTION_SETUP.md`).

**Hosted API (e.g. Koyeb):** Docker image, **`docker run` / env files**, `PORT`, health check, migrations vs seeds, and buildpack alternatives are in [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md).

## 8. Smoke checks

- Sign in succeeds; **Home** loads.
- **Transactions** and **Settings** open without console errors.
- Optional quality gates:

```bash
npm run lint
npm test
```

## 9. Stop and reset (Postgres)

**Stop the API before cleanup** so connections are not held against objects you are about to drop.

```bash
npm run services:stop
```

**`npm run db:cleanup`** runs [`scripts/db-cleanup.sh`](../scripts/db-cleanup.sh) with `--yes`: it **drops and recreates** the Postgres `public` schema using **`DATABASE_*`** from the repo root `.env` (see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)), then applies migrations and **bootstrap seed only** (default household, owner user, global categories — no sample bank accounts).

- **Sample dev accounts** (BoA / Citi / Chase / Marcus):  
  `npm run db:cleanup -- --yes --with-dev-seeds`  
  (equivalent to also running `npm run db:seed:dev` after a bootstrap-only cleanup.)

**`npm run db:seed`** runs migrations + bootstrap only. **`npm run db:seed:dev`** adds the dev `financial_account` rows without dropping the schema.

Then start the API again (`npm run services:start` or `npm run dev:backend`). Clear site storage or sign out if you had an old JWT.

## 10. Validation and troubleshooting

**Confirm you are looking at the same database as the backend:** compare **`DATABASE_HOST`**, **`DATABASE_PORT`**, and **`DATABASE_NAME`** in the repo root **`.env`** with the values used by the running API process (or container env). Optional sanity check with **`psql`** or your host’s SQL console — e.g. `SELECT COUNT(*) FROM transaction_canonical;`.

| Symptom | Check |
|---------|--------|
| `db:cleanup` ran but the UI still shows old rows | **API still connected** to Postgres: stop services, run cleanup again. Or **wrong database**: cleanup uses `DATABASE_HOST` / `DATABASE_NAME` from `.env` — must match the instance the API uses. |
| Port in use | Change `PORT` / `FRONTEND_PORT` in `.env` or stop the other process. |
| 401 / invalid token | Clear browser storage for the site; sign in again. |
| Missing tables / old schema | Run `npm run setup` or `npm run db:seed` after `db:cleanup`. |
| Import staging disk | See [`archive/IMPORT_STAGING_PURGE.md`](archive/IMPORT_STAGING_PURGE.md); `npm run import:purge -- --help`. |

## Related docs

- [`README.md`](../README.md) — product summary and developer quick start  
- [`USER_GUIDE.md`](USER_GUIDE.md) — using the app (imports, transactions, settings)  
- [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) — `.env` reference (`DATABASE_*`, Vite, transfer thresholds)  
- [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) — production DB and seeds  
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system design  
- [`archive/README.md`](archive/README.md) — historical planning and handoff docs  

## 11. Production and Docker

Postgres + migrations-on-startup + bootstrap seeds + **Docker / Koyeb** deploy flow are documented in [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) (including **image vs `docker run`**, **`--env-file`**, and when to **`docker build`** again).
