# Environment variables (reference)

Single-page index for operators. The backend loads the **repository root** `.env` (see [`backend/src/config/env.ts`](../backend/src/config/env.ts)). Vite uses the same root `.env` via `envDir` in [`frontend/vite.config.ts`](../frontend/vite.config.ts).

## Database path (same as `node scripts/print-db-path.mjs`)

| Variable | Meaning |
|----------|---------|
| `MODE` | `TEST` or `PROD` — selects default file when `DB_PATH` is unset. |
| `DB_PATH` | Optional override; wins over `MODE` and `DB_PATH_*`. |
| `DB_PATH_TEST` | Relative to repo root or absolute; default `./data/household-finance-test.sqlite`. |
| `DB_PATH_PROD` | Same; default `./data/household-finance-prod.sqlite`. |

`npm run db:cleanup`, `npm run db:init`, and `npm run db:seed` resolve the SQLite file with the same rules as the API.

## Backend (runtime)

**Logging:** The API writes only to **stdout/stderr** (listen URL, SQLite path, migration counts). There are no rotating log files; capture process output in your shell, systemd journal, or platform logs (e.g. Koyeb).

| Variable | Notes |
|----------|--------|
| `PORT` | API listen port (default `4000`). |
| `JWT_SECRET` | JWT signing; min 16 chars in schema (default exists for local dev only). |
| `TRANSFER_*` | Transfer matcher thresholds (see `env.ts`). |
| `AI_CATEGORY_ENABLED` | Enable OpenAI categorization pass during canonicalize (default `false`). |
| `AI_CATEGORY_AUTO_APPLY_MIN` | Confidence threshold for automatic category assignment (default `0.9`). |
| `AI_CATEGORY_REVIEW_MIN` | Minimum confidence to attach AI suggestion in review payload (default `0.6`). |
| `OPENAI_API_KEY` | API key for OpenAI calls. |
| `OPENAI_MODEL` | Chat completion model id (default `gpt-4o-mini`). |

## Frontend (Vite)

| Variable | Notes |
|----------|--------|
| `FRONTEND_PORT` | Dev server port (default `3000`). |
| `VITE_PROXY_API` | Base URL for API proxy targets (default `http://127.0.0.1:4000` in [`vite.config.ts`](../frontend/vite.config.ts)). |
| `VITE_DEV_SIGNIN_EMAIL` / `VITE_DEV_SIGNIN_PASSWORD` | Optional sign-in field prefill on `/`; omit or leave empty for no prefill. |

## Known hardcoded defaults (ops)

- **Seed user row:** [`backend/db/seeds/0001_seed_defaults.sql`](../backend/db/seeds/0001_seed_defaults.sql) — email and bcrypt hash for the default password.
- **Tests:** `backend` `npm test` runs `MODE=TEST` with `DB_PATH` unset so the test DB path is deterministic (see [`scripts/prep-test-db.sh`](../scripts/prep-test-db.sh)).

See also [`RUNBOOK.md`](RUNBOOK.md) for setup and reset.

## Postgres / Koyeb (planned)

Current runtime is SQLite-only. Postgres/Koyeb production deployment is tracked as planned work:
- add a Postgres-backed migration runner path (or dialect-safe migration strategy),
- define `DATABASE_URL` / SSL / pooling env contract,
- add startup migration policy for container deploys,
- validate health checks + rollback strategy for Koyeb.
