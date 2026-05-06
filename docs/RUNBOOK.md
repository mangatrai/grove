# End-to-end runbook (brand new environment)

Single checklist to go from an empty machine to a running app. For **production** database policy (minimal seeds), see [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md). API surface: [`openapi/openapi.yaml`](../openapi/openapi.yaml). Database layout: [`backend/db/README.md`](../backend/db/README.md). Operator Q&A and Postgres notes: §11 below.

## One-command map (local)

| Goal | Command |
|------|---------|
| First-time setup (install + dirs + migrations + bootstrap + dev sample accounts) | `npm run setup` |
| Start API + UI together (background) | `npm run start:dev` (alias: `npm run services:start`) |
| Migrations + seeds only (no `npm install`) | `npm run db:seed` or `npm run db:seed:dev` |
| Wipe DB and reapply migrations + seeds | `npm run db:cleanup` or `npm run db:reset` (add `--with-dev-seeds` via `npm run db:reset:dev`) |
| Stop API + UI | `npm run stop:dev` (alias: `npm run services:stop`) |

`setup` creates `.env` from `.env.example` if `.env` is missing.

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
| `LOG_LEVEL` | (Optional) Backend verbosity: `debug`, `info`, `warn`, `error`, or `silent` (default `info`). See [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md). |

**API logs:** Backend output is controlled by **`LOG_LEVEL`**; capture to files with `npm run start:dev` → `.runtime/logs/backend.log`. Full index: [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

**Seeded database user:** The first user is inserted only by [`backend/db/seeds/0001_bootstrap.sql`](../backend/db/seeds/0001_bootstrap.sql) (email + bcrypt hash). Optional sign-in field prefill uses `VITE_DEV_SIGNIN_*` only (see above), not the backend env.

## 5. Database (Postgres: schema + seeds)

**Postgres only** — see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) and §11 for connection details. Start local Postgres with **`docker compose up -d`** from the repo root (see [`docker-compose.yml`](../docker-compose.yml)), then set **`DATABASE_*`** in `.env` (port **5433** → server **5432** per compose).

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
npm run start:dev
```

(Same as `npm run services:start`.)

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
npm run stop:dev
```

**`npm run db:cleanup`** (same as **`npm run db:reset`**) runs [`scripts/db-cleanup.sh`](../scripts/db-cleanup.sh) with `--yes`: it **drops and recreates** the Postgres `public` schema using **`DATABASE_*`** from the repo root `.env` (see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md)), then applies migrations and **bootstrap seed only** (default household, owner user, global categories — no sample bank accounts).

- **Sample dev accounts** (BoA / Citi / Chase / Marcus) after wipe: **`npm run db:reset:dev`** (cleanup + migrations + bootstrap + dev seeds).

**`npm run db:seed`** runs migrations + bootstrap only. **`npm run db:seed:dev`** adds the dev `financial_account` rows without dropping the schema.

Then start the API again (`npm run start:dev` or `npm run dev:backend`). Clear site storage or sign out if you had an old JWT.

## 10. Validation and troubleshooting

**Confirm you are looking at the same database as the backend:** compare **`DATABASE_HOST`**, **`DATABASE_PORT`**, and **`DATABASE_NAME`** in the repo root **`.env`** with the values used by the running API process (or container env). Optional sanity check with **`psql`** or your host’s SQL console — e.g. `SELECT COUNT(*) FROM transaction_canonical;`.

| Symptom | Check |
|---------|--------|
| `db:cleanup` ran but the UI still shows old rows | **API still connected** to Postgres: stop services, run cleanup again. Or **wrong database**: cleanup uses `DATABASE_HOST` / `DATABASE_NAME` from `.env` — must match the instance the API uses. |
| Port in use | Change `PORT` / `FRONTEND_PORT` in `.env` or stop the other process. |
| 401 / invalid token | Clear browser storage for the site; sign in again. |
| Missing tables / old schema | Run `npm run setup` or `npm run db:seed` after `db:cleanup`. |
| Import staging disk | `npm run import:purge -- --help` to prune old staged files. |

## 11. Operator FAQ

### Import sessions after finalize
- Sessions are **not** auto-deleted or TTL-expired.
- The list shows up to **40** sessions (newest first, all statuses).
- After finalize the session row remains for audit (which files ran, links into Transactions filtered by session). It is not required for ongoing work.

### "Re-apply rules to ledger" (`POST /categories/rules/recategorize`)
- Scope: the **entire posted ledger** for the authenticated household (`transaction_canonical` where `status = 'posted'`).
- **`uncategorized_only`** updates only rows with `category_id IS NULL`. **`all`** can overwrite categories when a rule matches.
- Does **not** filter by import session; finalized imports' rows are included.

### Household data export + restore (.hfb)
- **Export:** Settings → **Data** → export triggers `POST /exports/household`. Job runs async; UI polls until complete, then shows a persistent download link.
- The file is a **`.hfb`** (ZIP-shaped) bundle: `manifest.json` + per-table JSON files (**`exportVersion` 4** current). Tables: household settings, app users (bcrypt hashes), accounts, categories, rules, transactions, balance snapshots, payslip snapshots, person profiles, memberships, and other registry tables (see `docs/API_EXPORTS.md`).
- `categories.json` / `category_rules.json` contain **only household-custom rows** — global seed rows are excluded (they re-seed on restore via `db:seed`).
- Exports are rate-limited (10 per rolling hour). Files are stored under `data/exports/`; no auto-cleanup — delete manually if disk is a concern.
- **Restore:** Settings → **Data** → restore uploads an `.hfb` from the export above (preview step recommended).
- Restore is **destructive and irreversible**: wipes current household data and replaces from the bundle.
- All `token_version` values are incremented on restore (every existing JWT is invalidated; user is signed out automatically).
- API: `POST /exports/household/import` (multipart `file`) → `{ jobId }` → poll `GET /exports/import/:jobId`.
- Backward-compatible with older bundles (v1/v2 single `household-bundle.json`, v3/v4 split JSON).

### PostgreSQL notes
- The app uses PostgreSQL only via the `postgres` (porsager) client. Schema applied from `backend/db/migrations/`. Seeds in `backend/db/seeds/`.
- Full-text search: `transaction_canonical.search_document` is a generated `tsvector` (English) over `merchant + memo` with a GIN index.
- Connection shape (separate fields, not a URL — required for Koyeb and most managed providers):
  ```ts
  postgres({ host, port, database, username, password, ssl: ssl !== "0" ? "require" : false })
  ```
- Use `DATABASE_SSL=0` for local Docker; `DATABASE_SSL=1` (or omit) for managed TLS hosts.

## Related docs

- [`README.md`](../README.md) — product summary and developer quick start  
- [`USER_GUIDE.md`](USER_GUIDE.md) — using the app (imports, transactions, settings)  
- [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) — `.env` reference (`DATABASE_*`, Vite, transfer thresholds)  
- [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) — production DB and seeds  
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system design  

## 12. Production and Docker

Postgres + migrations-on-startup + bootstrap seeds + **Docker / Koyeb** deploy flow are documented in [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) (including **image vs `docker run`**, **`--env-file`**, and when to **`docker build`** again).
