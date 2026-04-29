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

See [`RUNBOOK.md`](RUNBOOK.md) §11 for Postgres connection details and operator FAQ.

## Backend (runtime)

**Logging (backend):** Set **`LOG_LEVEL`** and optional **`LOG_FILE`** in the repo root `.env`. Implementation: [`backend/src/logger.ts`](../backend/src/logger.ts) — the **only** module that may write to `console` or a log file; all other backend code must `import { log } from "./logger.js"`.

| `LOG_LEVEL` value | Behavior |
|-------------------|----------|
| `debug` | All output |
| `info` | Default — hides `debug` |
| `warn` | Warnings + errors only |
| `error` | Errors only |
| `silent` | Suppress everything |

**`LOG_FILE`:** Set to a repo-relative or absolute path (e.g. `.runtime/logs/api.log`). Parent directories are created automatically. Lines are appended (ISO timestamp + level + message) while still printing to console (tee). If the file can't be opened, logging continues on console only with a one-time warning. GitHub [#10](https://github.com/mangatrai/household-finance-app/issues/10) tracks migrating remaining `console.*` calls.

**Where output goes:** [`scripts/services.sh`](../scripts/services.sh) redirects **stdout/stderr** to [`.runtime/logs/`](../.runtime/logs/) when you run **`npm run start:dev`** (backend → **`backend.log`**, frontend → **`frontend.log`**). Stop with **`npm run stop:dev`**, status with **`npm run services:status`**.

| Variable | Notes |
|----------|--------|
| `MODE` | `TEST` or `PROD`. Affects static SPA serving when **`frontend/dist`** exists; **not** used to pick a database file. |
| `LOG_LEVEL` | Backend only: `debug`, `info`, `warn`, `error`, or `silent` (default `info`). |
| `LOG_FILE` | Optional. Repo-relative or absolute path; appended (tee with stdout/stderr). Empty = disabled. |
| `PORT` | API listen port (default `4000`). |
| `JWT_SECRET` | JWT signing; **min 32 chars** (raised from 16). The app **refuses to start in PROD** with the default dev value. Generate: `openssl rand -base64 48`. |
| `ALLOWED_ORIGIN` | **PROD:** set to your app's public URL (e.g. `https://finance.example.com`) to lock CORS to that origin. Unset in TEST — all origins allowed. If unset in PROD, the API sends no `Allow-Origin` header (browser cross-origin requests blocked). |
| `TRANSFER_*` | Transfer matcher thresholds (see `env.ts`). |
| `OPENAI_API_KEY` | API key for OpenAI (**required** for **IBM** and **Deloitte** payslip PDF extraction — upload, import parse, and Deloitte async reconcile). |
| `OPENAI_MODEL` | Chat completion model id (default `gpt-4o-mini`). Used by payslip extraction and any other OpenAI-backed features. |
| `PAYSLIP_ASYNC_POLL_INTERVAL_MS` | Minimum milliseconds between background polls for queued Deloitte LLM extraction during import (default `120000`). |
| `CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS` | Max **inclusive** day span for **`GET /reports/cash-summary`** when both **`dateFrom`** and **`dateTo`** are set (default `1096`, min `31`, max `4000`). |

## Email / SMTP (optional)

Used by self-service password reset and future invite/notification flows.

| Variable | Notes |
|----------|-------|
| `SMTP_HOST` | SMTP hostname (e.g. `smtp.gmail.com`, `smtp.resend.com`). |
| `SMTP_PORT` | SMTP port (default `587`). |
| `SMTP_SECURE` | `1` for SSL (typically port `465`), `0` for STARTTLS (typically `587`). |
| `SMTP_USER` | SMTP login username (`resend` for Resend, Gmail address for Gmail). |
| `SMTP_PASS` | SMTP password (Resend API key or Gmail App Password). |
| `SMTP_FROM` | Display sender value, e.g. `Household Finance <you@gmail.com>`. |
| `PUBLIC_BASE_URL` | Public app URL (e.g. `https://finance.example.com`) used in email links and OAuth callbacks. |

**Resend SMTP example**

```bash
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxxx
SMTP_FROM=Household Finance <onboarding@resend.dev>
PUBLIC_BASE_URL=https://finance.example.com
```

**Gmail App Password example**

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=you@gmail.com
SMTP_PASS=your-16-char-app-password
SMTP_FROM=Household Finance <you@gmail.com>
PUBLIC_BASE_URL=https://finance.example.com
```

## Frontend (Vite)

| Variable | Notes |
|----------|--------|
| `FRONTEND_PORT` | Dev server port (default `3000`). |
| `VITE_PROXY_API` | Base URL for API proxy targets (default `http://127.0.0.1:4000` in [`vite.config.ts`](../frontend/vite.config.ts)). |
| `VITE_DEV_SIGNIN_EMAIL` / `VITE_DEV_SIGNIN_PASSWORD` | Optional sign-in field prefill on `/`; omit or leave empty for no prefill. |

## Known hardcoded defaults (ops)

- **Seed user row:** [`backend/db/seeds/0001_bootstrap.sql`](../backend/db/seeds/0001_bootstrap.sql) — email and bcrypt hash for the default password.
- **Tests:** `backend` `npm test` runs **`scripts/prep-test-db.sh`** (resets schema on the configured Postgres) then migrations + seeds + Vitest. **`DATABASE_*`** must be set (see `docker-compose.yml`).

See also [`RUNBOOK.md`](RUNBOOK.md) for setup and reset.
