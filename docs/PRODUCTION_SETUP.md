# Production database setup

## Migrations

Schema is applied in order from `backend/db/migrations/` via `scripts/db.mjs` (tracked in `schema_migrations`).

## Seeds

- **`backend/db/seeds/0001_bootstrap.sql`** — Global default category taxonomy, bootstrap household, seeded owner user, and built-in global classification rules. **Apply this** for a usable empty app (no sample bank accounts).
- **`backend/db/seeds/dev/*.sql`** — Dev-only sample **`financial_account`** rows (BoA/Citi/Chase/Marcus). Applied **only** with **`--dev-seeds`**. The payslip import account is created from **Profile → Employer Setup**, not from seed SQL.

**`npm run db:seed`** runs migrations + **`0001` only** — appropriate for production-style databases where users create real accounts in Settings.

**`npm run db:seed:dev`** adds the dev fixtures for local smoke tests (same as first-time `npm run setup`).

## Environment

- Set `JWT_SECRET` and database path in `.env` (see `.env.example`).
- If you are enabling AI categorization, set `AI_CATEGORY_ENABLED=true`, `OPENAI_API_KEY`, and tune
  `AI_CATEGORY_AUTO_APPLY_MIN` / `AI_CATEGORY_REVIEW_MIN`.
- Change default seeded credentials immediately after first deploy.

## Institution list

Curated U.S. institution labels and household custom names are app-level (see Connected accounts). No separate production SQL is required for the catalog.

## Koyeb (Node.js) — API service with SQLite

[Koyeb](https://www.koyeb.com/) detects this repo as **Node.js** via the root [`package.json`](../package.json). The backend matches their **Express**-style deployment model (`npm run build` → `node dist/server.js`), not Next.js/Nuxt.

| Topic | What to configure |
|--------|-------------------|
| **Package manager** | **npm** (workspaces). Use install at repo root unless you set the service **root directory** to `backend/`. |
| **Node version** | Root and `backend` declare `"engines": { "node": "20.x" }` — set the same on Koyeb if you pin runtime. |
| **Build (monorepo root)** | `npm ci` then `npm run build -w backend` (API only), or `npm run build` to also build the Vite frontend. |
| **Start command** | From repo root: `npm run start -w backend`. If the service root is `backend/`: `npm ci && npm run build && npm start`. |
| **`PORT`** | The API reads `PORT` (see backend `env.ts`); Koyeb injects `PORT` — no code change needed. |
| **`NODE_ENV=production`** | Runtime is compiled JS; **devDependencies** (e.g. `tsx`, `typescript`) are not required at start. You only need `NPM_CONFIG_PRODUCTION=false` if something in **devDependencies** must exist at runtime (not the case for the default start script). |
| **SQLite file** | Default DB path is under `./data/` (see `DB_PATH` / `DB_PATH_PROD`). Koyeb’s filesystem is **ephemeral** unless you attach a **persistent volume** and set `DB_PATH` (or equivalent) to a path on that volume. |
| **Frontend (SPA)** | With **`MODE=PROD`** and a prior **`npm run build`** (includes Vite), Express serves **`frontend/dist`** and falls back to **`index.html`** for client-side routes (same origin as the API — no extra `VITE_PROXY_API` needed). With **`MODE=TEST`**, the API behaves as before (no static UI from Express — use Vite on `FRONTEND_PORT` locally). If `dist` is missing while `MODE=PROD`, the API still runs and **`GET /`** returns “Cannot GET /”. |

## Postgres + Koyeb readiness (planned, not shipped)

This app is currently SQLite-first in production. Before switching to hosted Postgres/Koyeb, track and complete:

1. DB runtime abstraction for Postgres (driver + query/migration compatibility).
2. Env contract (`DATABASE_URL`, SSL mode, pool size) and secret handling.
3. Startup migration policy (safe one-shot migration before serving traffic).
4. Operational playbook: backup/restore, rollback, and schema drift checks.
5. Koyeb deploy checklist: health endpoint, zero-downtime rollout behavior, and failure recovery.
