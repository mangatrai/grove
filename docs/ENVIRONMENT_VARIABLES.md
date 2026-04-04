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

**Logging (backend):** Set **`LOG_LEVEL`** and optional **`LOG_FILE`** in the repo root `.env` (see [`docs/LOGGING.md`](LOGGING.md)). Application code under `backend/src` should use [`logger`](../backend/src/logger.ts) only; ESLint blocks direct `console.*` outside `logger.ts`. Third-party libraries may still print to stderr.

**Where output goes:** [`scripts/services.sh`](../scripts/services.sh) redirects **stdout/stderr** to [`.runtime/logs/`](../.runtime/logs/) when you run **`npm run services:start`** (backend → **`backend.log`**, frontend → **`frontend.log`**). It does not parse log levels—filtering is done inside the Node process for lines that go through `log.*`. Stop with **`npm run services:stop`**, status with **`npm run services:status`**.

On macOS with launchd or Linux with systemd, logs go to the configured log path or `journalctl`.

| Variable | Notes |
|----------|--------|
| `LOG_LEVEL` | Backend only: `debug`, `info`, `warn`, `error`, or `silent` (default `info`). |
| `LOG_FILE` | Optional. Repo-relative or absolute path; timestamped lines are appended (tee with stdout/stderr). Empty = disabled. See [`LOGGING.md`](LOGGING.md). |
| `PORT` | API listen port (default `4000`). |
| `JWT_SECRET` | JWT signing; min 16 chars in schema (default exists for local dev only). |
| `TRANSFER_*` | Transfer matcher thresholds (see `env.ts`). |
| `AI_CATEGORY_ENABLED` | Enable OpenAI categorization pass during canonicalize (default `false`). Prefer **off** for deterministic rules-first categorization; see [`IMPORT_CLASSIFICATION.md`](IMPORT_CLASSIFICATION.md). |
| `AI_CATEGORY_AUTO_APPLY_MIN` | Confidence threshold for automatic category assignment (default `0.9`). Model-reported confidence only. Lower (e.g. `0.7`) reduces review backlog but increases wrong auto-labels. See [`docs/AI_CATEGORIZATION.md`](AI_CATEGORIZATION.md). |
| `AI_CATEGORY_REVIEW_MIN` | Minimum confidence to attach AI suggestion in review payload `reason` JSON (default `0.6`). |
| `AI_CATEGORY_BATCH_SIZE` | Max transactions per **single** OpenAI request (default `28`, max `128`). Log line counts vary: see [`docs/AI_CATEGORIZATION.md`](AI_CATEGORIZATION.md). Payload may split below this size if JSON is very large. |
| `AI_CATEGORY_MAX_PARALLEL` | Concurrent OpenAI requests for different chunks of the same contiguous AI run (default `1`, max `8`). Higher can reduce wall time but may trigger rate limits. |
| `OPENAI_API_KEY` | API key for OpenAI calls. |
| `OPENAI_MODEL` | Chat completion model id (default `gpt-4o-mini`). Faster/cheaper models may trade categorization quality. |
| `LOG_AI_DEBUG_BODY_MAX_CHARS` | With `LOG_LEVEL=debug`, max characters per logged OpenAI body snippet (default `4000`). |

## Frontend (Vite)

| Variable | Notes |
|----------|--------|
| `FRONTEND_PORT` | Dev server port (default `3000`). |
| `VITE_PROXY_API` | Base URL for API proxy targets (default `http://127.0.0.1:4000` in [`vite.config.ts`](../frontend/vite.config.ts)). |
| `VITE_DEV_SIGNIN_EMAIL` / `VITE_DEV_SIGNIN_PASSWORD` | Optional sign-in field prefill on `/`; omit or leave empty for no prefill. |

## Known hardcoded defaults (ops)

- **Seed user row:** [`backend/db/seeds/0001_bootstrap.sql`](../backend/db/seeds/0001_bootstrap.sql) — email and bcrypt hash for the default password.
- **Tests:** `backend` `npm test` runs `MODE=TEST` with `DB_PATH` unset so the test DB path is deterministic (see [`scripts/prep-test-db.sh`](../scripts/prep-test-db.sh)).

See also [`RUNBOOK.md`](RUNBOOK.md) for setup and reset.

## Postgres / Koyeb (planned)

Current runtime is SQLite-only. Postgres/Koyeb production deployment is tracked as planned work:
- add a Postgres-backed migration runner path (or dialect-safe migration strategy),
- define `DATABASE_URL` / SSL / pooling env contract,
- add startup migration policy for container deploys,
- validate health checks + rollback strategy for Koyeb.
