# Environment variables (reference)

Single-page index for operators. The backend loads the **repository root** `.env` (see [`backend/src/config/env.ts`](../backend/src/config/env.ts)). Vite uses the same root `.env` via `envDir` in [`frontend/vite.config.ts`](../frontend/vite.config.ts).

## Database (PostgreSQL — required)

The API and **`scripts/db.sh`** use **`DATABASE_*`** only (no SQLite / `DB_PATH`). Local testing: see root **`docker-compose.yml`** (port **5433**) and [`.env.example`](../.env.example).

| Variable | Meaning |
|----------|---------|
| `DATABASE_HOST` | **Required.** Postgres hostname (e.g. `127.0.0.1` or managed host). |
| `DATABASE_PORT` | Port (default **5432**). |
| `DATABASE_USER` | **Required.** Role name. |
| `DATABASE_PASSWORD` | Password (may be empty for some local setups). |
| `DATABASE_NAME` | **Required.** Database name. |
| `DATABASE_SSL` | Default **on** (`ssl: 'require'`). Set **`0`** / **`false`** for local Postgres without TLS (e.g. Docker on localhost). |

**Test vs prod:** same variable names; point CI/local at your **test** instance and production (e.g. Koyeb) at **prod**.

Migrations: [`backend/db/migrations/`](../backend/db/migrations/). Seeds: [`backend/db/seeds/`](../backend/db/seeds/) (and `seeds/dev/` for sample accounts).

**Reset local data:** `npm run db:cleanup` or `npm run db:reset` runs [`scripts/db-cleanup.sh`](../scripts/db-cleanup.sh) with `--yes` (drops `public`, then migrations + **bootstrap seed only**). Use **`npm run db:reset:dev`** to also load sample BoA/Chase/Citi/Marcus `financial_account` rows.

See [`POSTGRES_CUTOVER.md`](POSTGRES_CUTOVER.md) and [`RUNBOOK.md`](RUNBOOK.md).

## Backend (runtime)

**Logging (backend):** Set **`LOG_LEVEL`** and optional **`LOG_FILE`** in the repo root `.env` (see [`docs/LOGGING.md`](LOGGING.md)). Application code under `backend/src` should use [`logger`](../backend/src/logger.ts) only; ESLint blocks direct `console.*` outside `logger.ts`. Third-party libraries may still print to stderr.

**Where output goes:** [`scripts/services.sh`](../scripts/services.sh) redirects **stdout/stderr** to [`.runtime/logs/`](../.runtime/logs/) when you run **`npm run start:dev`** (same as `npm run services:start`; backend → **`backend.log`**, frontend → **`frontend.log`**). It does not parse log levels—filtering is done inside the Node process for lines that go through `log.*`. Stop with **`npm run stop:dev`** (or **`npm run services:stop`**), status with **`npm run services:status`**.

On macOS with launchd or Linux with systemd, logs go to the configured log path or `journalctl`.

| Variable | Notes |
|----------|--------|
| `MODE` | `TEST` or `PROD`. Affects static SPA serving when **`frontend/dist`** exists; **not** used to pick a database file. |
| `LOG_LEVEL` | Backend only: `debug`, `info`, `warn`, `error`, or `silent` (default `info`). |
| `LOG_FILE` | Optional. Repo-relative or absolute path; timestamped lines are appended (tee with stdout/stderr). Empty = disabled. See [`LOGGING.md`](LOGGING.md). |
| `PORT` | API listen port (default `4000`). |
| `JWT_SECRET` | JWT signing; min 16 chars in schema (default exists for local dev only). |
| `TRANSFER_*` | Transfer matcher thresholds (see `env.ts`). |
| `OPENAI_API_KEY` | API key for OpenAI (**required** for **IBM** and **Deloitte** payslip PDF extraction — upload, import parse, and Deloitte async reconcile). |
| `OPENAI_MODEL` | Chat completion model id (default `gpt-4o-mini`). Used by payslip extraction and any other OpenAI-backed features. |
| `PAYSLIP_ASYNC_POLL_INTERVAL_MS` | Minimum milliseconds between background polls for queued Deloitte LLM extraction during import (default `120000`). |
| `CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS` | Max **inclusive** day span for **`GET /reports/cash-summary`** when both **`dateFrom`** and **`dateTo`** are set (default `1096`, min `31`, max `4000`). |

## Frontend (Vite)

| Variable | Notes |
|----------|--------|
| `FRONTEND_PORT` | Dev server port (default `3000`). |
| `VITE_PROXY_API` | Base URL for API proxy targets (default `http://127.0.0.1:4000` in [`vite.config.ts`](../frontend/vite.config.ts)). |
| `VITE_DEV_SIGNIN_EMAIL` / `VITE_DEV_SIGNIN_PASSWORD` | Optional sign-in field prefill on `/`; omit or leave empty for no prefill. |

## Known hardcoded defaults (ops)

- **Seed user row:** [`backend/db/seeds/0001_bootstrap.sql`](../backend/db/seeds/0001_bootstrap.sql) — email and bcrypt hash for the default password.
- **Tests:** `backend` `npm test` runs **`scripts/prep-test-db.sh`** (resets schema on the configured Postgres) then migrations + seeds + Vitest. **`DATABASE_*`** must be set (see `docker-compose.yml`).

See also [`RUNBOOK.md`](RUNBOOK.md) for setup and reset. Operator Q&A: [`OPERATOR_FAQ.md`](OPERATOR_FAQ.md).
