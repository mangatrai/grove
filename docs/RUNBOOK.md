# End-to-end runbook (brand new environment)

Single checklist to go from an empty machine to a running app. For **production** database policy (minimal seeds), see [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md). API surface: [`openapi/openapi.yaml`](../openapi/openapi.yaml).

## 1. Prerequisites

- **Node.js** — Current LTS (v20+ recommended).
- **npm** — Comes with Node (workspace monorepo at repo root).
- **Ports** — Defaults: UI **3000**, API **4000** (see `.env.example`: `FRONTEND_PORT`, `PORT`). Ensure nothing else binds to those ports, or change them in `.env`.
- **Optional:** `sqlite3` CLI for ad-hoc DB inspection (not required for normal operation).

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
| `JWT_SECRET` | **Required.** Long random string for signing JWTs. |
| `MODE` | `TEST` (default dev DB path) or `PROD` for separate SQLite file. |
| `DB_PATH` | Optional override; else `DB_PATH_TEST` / `DB_PATH_PROD` from `.env.example`. |
| `PORT` / `FRONTEND_PORT` | API and Vite dev server ports. |

Seeded login defaults are documented in `.env.example` and match `backend/db/seeds/0001_seed_defaults.sql` unless you change seeds.

## 5. Database (schema + seeds)

**Development (full seed including dev fixtures under `backend/db/seeds/dev/`):**

```bash
npm run setup
```

This runs `scripts/setup.sh`: `npm install`, creates `data/` and `.runtime/logs/`, then `scripts/db.sh --init --seed` (migrations + top-level seeds + `seeds/dev/*.sql`).

**Migrations only (no seeds):**

```bash
npm run db:init
```

**Reseed after cleanup:**

```bash
npm run db:seed
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

- **UI:** `http://127.0.0.1:3000` (or `FRONTEND_PORT`).
- **API:** `http://127.0.0.1:4000` (or `PORT`).
- **Health:** `GET http://127.0.0.1:4000/health`

## 7. First sign-in

1. Open the home page (`/`).
2. Sign in with the **seeded** email/password from `.env.example` (typically `owner@example.com` / `ChangeMe123!` unless you changed the seed).
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

**Stop background dev servers:**

```bash
npm run services:stop
```

**Reset DB for current `MODE` (destructive):**

```bash
npm run db:cleanup
```

**Full wipe + reseed:**

```bash
npm run db:cleanup -- --yes && npm run db:seed
```

## 10. Troubleshooting

| Symptom | Check |
|---------|--------|
| Port in use | Change `PORT` / `FRONTEND_PORT` in `.env` or stop the other process. |
| 401 / invalid token | Clear browser storage for the site; sign in again. |
| Missing tables / old schema | Run `npm run setup` or `npm run db:seed` after `db:cleanup`. |
| Import staging disk | See [`IMPORT_STAGING_PURGE.md`](IMPORT_STAGING_PURGE.md); `npm run import:purge -- --help`. |

## Related docs

- [`README.md`](../README.md) — quick start summary  
- [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) — production DB and seeds  
- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — product scope  
- [`CHECKPOINT.md`](CHECKPOINT.md) — implementation status  
