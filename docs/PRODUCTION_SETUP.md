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
- Set `OPENAI_API_KEY` if you use **Deloitte payslip** import (async LLM extract); transaction categories are **rules-only** (no OpenAI categorization).
- Change default seeded credentials immediately after first deploy.

## Institution list

Curated U.S. institution labels and household custom names are app-level (see Connected accounts). No separate production SQL is required for the catalog.

## Koyeb (Node.js) — buildpack overrides

[Koyeb](https://www.koyeb.com/) detects this repo as **Node.js** via the root [`package.json`](../package.json). The backend follows the usual **Express** pattern (`npm run build` → `node dist/server.js`). Use **npm workspaces** from the **repository root** so dependencies resolve correctly.

| Override | Value |
|----------|--------|
| **Work directory** | **`.`** (repo root) |
| **Build command** | **`npm ci && npm run build -w backend`** |
| **Run command** | **`npm run start -w backend`** |

If you leave **work directory** at the root, **keep** `-w backend` on the start command (the root `package.json` has no top-level `start` script). If you instead set work directory to **`backend/`**, use **`npm start`** there and **omit** `-w backend`.

**Frontend (SPA) on the same service:** With **`MODE=PROD`**, Express serves **`frontend/dist`** when that folder exists. The build command above **only compiles the API**; it does **not** run Vite. To ship the UI from the same Koyeb service, use a build that also produces `frontend/dist`, e.g. **`npm ci && npm run build`** (root script: backend + frontend) or **`npm ci && npm run build -w backend && npm run build -w frontend`**.

### `PORT` (Koyeb)

- The API listens on **`PORT`** (see backend [`env.ts`](../backend/src/config/env.ts)).
- In the Koyeb service **environment variables**, set **`PORT`** to the **same number** as the port you expose (e.g. **8000** if the service exposes **8000**). If Koyeb already injects **`PORT`** for that port, you do not need to duplicate it.
- **Do not** set **`FRONTEND_PORT`** for the API-only runtime on Koyeb; it is for local Vite dev.

### Health check (Koyeb)

- Prefer an **HTTP** health check when available: **GET** path **`/health`** — expect **200** and JSON like `{"status":"ok"}`.
- **TCP** on the same port as **`PORT`** only verifies the process is listening; it does not hit **`/health`**.

### Other notes

| Topic | What to configure |
|--------|-------------------|
| **Node version** | Root and `backend` declare `"engines": { "node": "20.x" }` — align Koyeb if you pin runtime. |
| **`MODE`** | Use **`MODE=PROD`** for production SQLite path and for serving **`frontend/dist`** when present (see above). |
| **Runtime** | Output is compiled JS; **devDependencies** are not required at **`npm start`** unless you changed the start script. |
| **SQLite file** | Default DB path is under **`./data/`** (see **`DB_PATH`** / **`DB_PATH_PROD`**). Koyeb’s filesystem is **ephemeral** unless you attach a **persistent volume** and point **`DB_PATH`** at a path on that volume. |
| **Local vs prod UI** | With **`MODE=TEST`**, Express does not serve the SPA from **`frontend/dist`** (use Vite on **`FRONTEND_PORT`** locally). If **`MODE=PROD`** but **`dist`** is missing, the API still runs; **`GET /`** may show “Cannot GET /” until a full frontend build is deployed. |

## Postgres + Koyeb readiness (planned, not shipped)

This app is currently SQLite-first in production. Before switching to hosted Postgres/Koyeb, track and complete:

1. DB runtime abstraction for Postgres (driver + query/migration compatibility).
2. Env contract (**`DATABASE_HOST`**, **`DATABASE_USER`**, **`DATABASE_PASSWORD`**, **`DATABASE_NAME`**, port, **`DATABASE_SSL`** / pool size) and secret handling.
3. Startup migration policy (safe one-shot migration before serving traffic).
4. Operational playbook: backup/restore, rollback, and schema drift checks.
5. Koyeb deploy checklist: health endpoint, zero-downtime rollout behavior, and failure recovery.
