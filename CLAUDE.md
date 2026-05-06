# CLAUDE.md — Household Finance App

## Project Overview

Self-hosted household finance app for importing bank/card statements and payslips, categorizing transactions with rules, and viewing financial dashboards. Node.js + React monorepo. Data stays on user infrastructure (Postgres in all modes).

---

## Tech Stack

### Backend
- **Node.js 20**, **TypeScript 5.6.3** (strict, ESM, NodeNext modules)
- **Express 4.19.2** — HTTP framework
- **Database:** Postgres 18 in all modes. `TEST` = local Docker Postgres; `PROD` = managed Postgres (Koyeb). SQLite is removed — any lingering references in older scripts/migrations are stale and will be cleaned up.
- **Postgres client:** `postgres` npm package v3.4.8
- **Validation:** Zod 3.23.8 (env config + request bodies)
- **Auth:** JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`)
- **LLM:** OpenAI 4.77.0 (payslip vision extraction)
- **File parsing:** `csv-parse`, `xlsx`, `pdf-parse`, `cheerio`
- **Testing:** Vitest 2.1.2 + supertest

### Frontend
- **Vite 5.4.11**, **React 18.3.1**, **TypeScript 5.6.3**
- **React Router v6** (hash history)
- **Mantine 7.17.8** — UI component library
- **Recharts 2.15.1** — charts

---

## Repository Structure

```
household-finance-app/
├── backend/src/
│   ├── server.ts           # Entry point (start HTTP server)
│   ├── app.ts              # Express app setup, route registration, SPA fallback
│   ├── logger.ts           # Structured logger (LOG_LEVEL, optional LOG_FILE)
│   ├── paths.ts            # Runtime paths (repo root, data dir)
│   ├── config/env.ts       # Zod-validated env parsing
│   ├── db/
│   │   ├── query.ts        # SQL helpers: qAll, qGet, qExec, qBegin, sqlBind, getSql
│   │   ├── postgres.ts     # Postgres client factory
│   │   └── apply-pg-migrations.ts  # applies SQL from backend/db/migrations at startup
│   └── modules/            # 13 domain modules (see below)
├── backend/db/             # Postgres migrations/*.sql + seeds/*.sql
├── backend/tests/          # Vitest integration tests (10 files)
├── frontend/src/
│   ├── App.tsx             # React Router config
│   ├── api.ts              # JWT token store + fetch helpers
│   ├── pages/              # 13 page components
│   ├── components/         # Shared UI components
│   ├── import/             # Import UX helpers
│   └── payslip/            # Payslip charts/detail
├── scripts/                # Shell automation (setup, db, services, purge)
├── docs/                   # Comprehensive markdown docs (RUNBOOK, ARCHITECTURE, API_*)
├── openapi/openapi.yaml    # OpenAPI 3.1 spec (full API)
├── db/                     # Fixtures: redacted bank/payslip exports
├── fixtures/               # Sample CSV templates (categories, rules)
├── docker-compose.yml      # Local Postgres 18 on port 5433
├── Dockerfile              # Production image: API + built SPA (no Postgres in image)
├── .dockerignore           # Shrinks build context; keeps `backend/db/migrations` in image
├── .env / .env.example     # App configuration
└── data/                   # Runtime (git-ignored): import staging files
```

---

## Domain Modules (`backend/src/modules/`)

| Module | Key Files | Responsibility |
|---|---|---|
| `auth/` | `auth.service.ts`, `auth.routes.ts`, `auth.middleware.ts` | Login, JWT generation/verification, password change, `requireAuth` middleware |
| `rbac/` | `rbac.middleware.ts` | `requireRole(roles)` middleware; roles: owner, admin, member |
| `household/` | `household.service.ts`, `household.routes.ts` | Settings, members, per-person profiles, salary deposit account |
| `category/` | `categories.service.ts`, `category-rules.service.ts`, `category-rules.ts`, `category-rule-learning.service.ts` | Category CRUD, rule engine (regex + amount scope), auto-learning from edits |
| `imports/` | `import-session.service.ts`, `import-file-binding.service.ts`, `import-parser.service.ts`, `parsers/`, `profiles/` | Session lifecycle, file upload, bank-specific adapters (BoA primary/MVP; Chase, Citi, Marcus also present), PDF extraction. **Bank adapters are actively extended.** |
| `payslip/` | `payslip.service.ts`, `payslip-parse.service.ts`, `llm-extract/` | Payslip CRUD, PDF parsing, async OpenAI vision extraction for unstructured PDFs |
| `canonical/` | `canonical-ingest.service.ts` | **Single write path**: dedupe (fingerprint), classification (rules), transfer detection → `transaction_canonical` |
| `ledger/` | `ledger.service.ts`, `ledger.routes.ts` | List/filter canonical transactions, manual entry, category updates |
| `resolution/` | `resolution.service.ts` | Unresolved items queue (unknown_category, duplicate_ambiguity, transfer_ambiguity) |
| `reports/` | `cash-summary.service.ts`, `balance-sheet.service.ts`, `reports.routes.ts` | Cash flow KPIs (`/reports/cash-summary`); net worth snapshot + history (`/reports/balance-sheet`, `/reports/balance-sheet/history`); manual balance POST/PATCH |
| `export/` | `export-household-bundle.service.ts`, `export-job.service.ts`, `import-household-bundle.service.ts`, `exports.routes.ts` | Async **`.hfb` export** (`exportVersion` 4: manifest + per-table JSON) and **async restore** (`POST /exports/household/import`, poll `GET /exports/import/:jobId`); wipe-then-restore, JWT invalidation via `token_version` |
| `budget/` | `budget.service.ts`, `budget.routes.ts` | Monthly per-category budgets; suggestions from recent spend; actuals vs budgeted with parent-level rollup (`/budget/suggest`, `/budget/months`, `/budget/:month` GET/PUT) |
| `health/` | routes only | `GET /health` liveness endpoint |

---

## Database Layer (`backend/src/db/query.ts`)

All DB access goes through these helpers — never use the `postgres` client directly:

```typescript
getSql()                          // Lazy-init Postgres client, applies pending migrations
qAll(sql, ...params)              // → Row[]
qGet(sql, ...params)              // → Row | undefined
qExec(sql, ...params)             // → void (INSERT/UPDATE/DELETE)
qBegin(fn)                        // Transaction scope (sql.begin callback)
sqlBind(sql, params)              // Translates ? → $1, $2, ... for Postgres
isPgUniqueViolation(err)          // Check SQLSTATE 23505
closeSql()                        // Graceful shutdown (used in Vitest teardown)
```

**Placeholder convention:** Write SQL with `?`. `sqlBind()` translates to `$1, $2, ...` for Postgres.

### Schema Highlights

```sql
household                         -- Isolation boundary; settings, employers_json
app_user                          -- household_id, role, password_hash, token_version
person_profile                    -- Per-person salary deposit account + employers
financial_account                 -- Accounts (checking, savings, credit card)
import_session                    -- Session lifecycle: created → processing → review → finalized
import_file                       -- Uploaded files, parser_profile_id, financial_account_id
transaction_raw                   -- Parser output, provenance (linked to import_file)
transaction_canonical             -- Ledger rows; status: 'posted' | 'trashed' (soft-deleted) | 'pending' | 'duplicate'; fingerprint, classification_meta, transfer_group_id
category                          -- Global defaults + household custom
category_rule                     -- Regex pattern, category_id, amount_scope, priority
resolution_item                   -- Unresolved queue: type, target_id, status
payslip_snapshot                  -- Net, gross, taxes, deductions per pay period
account_balance_snapshot          -- Manual + import-sourced balances per account/date (net worth)
export_job                        -- Async export tracking
import_job                        -- Async restore tracking (status, stats_json)
budget_category                   -- Per-month, per-category budget amounts (household_id, category_id, month YYYY-MM, amount)
```

Active migrations live in **`backend/db/migrations/`**; bootstrap seeds in **`backend/db/seeds/`**. `0001_baseline.sql` is the squashed full schema; subsequent numbered files are additive. Example: `0012_exact_duplicate_review.sql` (partial unique index on fingerprint for `status NOT IN ('duplicate','trashed')`).

---

## Import Pipeline (end-to-end)

```
POST /imports/sessions                  → Create session
POST /imports/sessions/{id}/files       → Upload file (multer, stored in data/imports/<sessionId>/)
PATCH /imports/sessions/{id}/files/{fileId} → Bind to financial account + parser profile
POST /imports/sessions/{id}/parse       → Run adapter → insert transaction_raw rows
POST /imports/sessions/{id}/canonicalize → canonical-ingest: dedupe + classify + transfer detect → transaction_canonical
PATCH /imports/sessions/{id}/status     → Finalize (status: "finalized")
POST /imports/sessions/{id}/undo-import → Rollback canonical rows (available regardless of session status)
```

The canonical ingest (`canonical-ingest.service.ts`) is the **single write path** for all posted transactions. It enforces:
1. **Fingerprint dedupe** — SHA256(account_id, txn_date, amount, normalized_description)
2. **Classification** — custom rules → global builtin rules → Unknown
3. **Transfer detection** — amount match + date proximity + household accounts

---

## Bank Adapters (`backend/src/modules/imports/profiles/`)

Bank adapters are **actively developed** — BoA was the MVP focus; others will be added/updated over time.

Each adapter exports a parse function that takes raw file bytes and returns `transaction_raw`-compatible rows. Adapters live under `profiles/` and are selected by `parser_profile_id` during file binding.

| Institution | Formats | Status |
|---|---|---|
| Bank of America | Checking/savings CSV, credit card CSV, e-statement PDF | MVP / primary |
| Chase | Card CSV | Present |
| Citi | Card CSV | Present |
| Marcus | Savings PDF | Present |

When adding a new adapter: create a file in `profiles/`, register its ID in the profile IDs enum, wire it into `import-parser.service.ts`.

---

## Category Classification Priority

1. Custom household rules (regex, amount scope, priority-ordered)
2. Global builtin keyword rules (immutable)
3. → Unknown category (creates resolution_item for user review)

Rule schema: `pattern` (regex), `categoryId`, `amountScope` (any | credit_only | debit_only), `priority`.

> **Note:** AI/LLM-based transaction categorization (Anthropic API) was explored and fully removed. Classification is rule-based only. OpenAI is used exclusively for payslip PDF extraction.

---

## Key Conventions

### TypeScript/Code Style
- **Strict mode** + no default exports (named exports only)
- **No `console.*`** outside `logger.ts` and `scripts/` — use `logger.info/warn/error`
- Unused vars: prefix with `_` to suppress ESLint
- ESM (`"type": "module"` in package.json)

### File Naming
- `<domain>.routes.ts` — HTTP handlers, request validation, status mapping
- `<domain>.service.ts` — Business logic + DB queries
- `<domain>.middleware.ts` — Express middleware
- `<domain>.types.ts` — Shared types/interfaces
- `<domain>.constants.ts` — Constants

### Naming Conventions
- DB columns: `snake_case` → TypeScript: `camelCase`
- API routes: `kebab-case` path segments (`/cash-summary`, `/parser-profiles`)
- Env vars: `SCREAMING_SNAKE_CASE`

### Service Return Pattern
Services return `{ ok: true, data: T }` or `{ ok: false, code: string, message: string }`. Routes map to HTTP status codes.

### Request Validation
Zod `.safeParse()` on request bodies. On failure: 400 + `{ errors: z.issues }`.

---

## Mandatory Per-Change Checklist

These are non-negotiable — apply to **every** code change, no exceptions:

### 1. Docs (same commit as code)
- **`docs/CHANGE_HISTORY.md`** — always add an entry (CR-, FIX-, UX-, DB- prefix). What changed, why, which files. This is the primary audit trail.
- **Affected API docs** (`docs/API_*.md`) — update when request/response shape, behaviour, or error codes change.
- **`openapi/openapi.yaml`** — add/update paths for every new or modified HTTP endpoint. No new route ships without an OpenAPI entry.

### 2. Commits
- **Create a commit** at the end of every work session (or logical unit). Never leave working changes uncommitted when the user's request is complete.
- **Sliced commits**: one commit per logical concern (parser fix, feature, doc update). Use the project's `feat(scope/ID):` / `fix(scope/ID):` convention.
- **Each commit must include** the doc changes for that code (CHANGE_HISTORY + affected API docs + openapi.yaml), not in a separate later commit.

### 3. Tests
- Run `npm run test` (or `-w backend` / `-w frontend`) after every change. Do not commit if tests fail.
- Add tests for new parser profiles, service logic, and API behaviour changes.

---

## Environment Variables (`.env`)

```bash
MODE=TEST                    # TEST = local Docker Postgres | PROD = managed Postgres (Koyeb)
PORT=4000
JWT_SECRET=...               # min 16 chars
DATABASE_HOST=               # Postgres host (required in both modes)
DATABASE_PORT=5432
DATABASE_USER=
DATABASE_PASSWORD=
DATABASE_NAME=
DATABASE_SSL=1               # 0 for local Docker
LOG_LEVEL=info               # debug | info | warn | error | silent
LOG_FILE=                    # Optional file path for log sink
TRANSFER_MIN_AUTO_PAIR_SCORE=45   # 0–100 threshold for auto-pairing transfers
OPENAI_API_KEY=              # For payslip LLM extraction
OPENAI_MODEL=gpt-4o-mini
VITE_DEV_SIGNIN_EMAIL=       # Dev auto-fill login
VITE_DEV_SIGNIN_PASSWORD=
VITE_PROXY_API=              # Defaults to http://127.0.0.1:4000
```

---

## Development Commands

```bash
# Initial setup (once) — npm install + dirs + migrations + bootstrap + dev sample accounts
npm run setup                # Creates .env from .env.example if missing

# Run API + frontend together (background; logs in .runtime/logs/)
npm run start:dev            # alias: npm run services:start
npm run stop:dev             # alias: npm run services:stop
npm run services:status

# Daily dev (foreground, two terminals if you prefer)
npm run dev                  # Backend (tsx watch, port 4000)
npm run dev:frontend         # Frontend (Vite HMR, port 3000)

# Testing
npm test                     # All tests (backend + frontend)
npm run test -w backend      # Backend integration tests only (single-worker, Postgres)
npm run test -w frontend     # Frontend unit tests only

# Database (Postgres via DATABASE_* in .env)
npm run db:init              # Apply migrations only
npm run db:seed              # Migrations + bootstrap seeds
npm run db:seed:dev          # + dev sample financial_account rows
npm run db:cleanup           # Drop/recreate public schema + migrations + bootstrap (same as db:reset)
npm run db:reset             # Same as db:cleanup
npm run db:reset:dev         # Cleanup + dev seeds

# Build
npm run build                # Both workspaces → dist/
npm run build -w backend     # tsc + copy payslip schema JSON → backend/dist/
npm run build -w frontend    # tsc check + vite build → frontend/dist/

# Lint
npm run lint                 # Both workspaces
```

### Local Postgres (Docker)
```bash
docker compose up -d         # Start Postgres 18 on port 5433
# Host apps (npm run dev): DATABASE_HOST=127.0.0.1 DATABASE_PORT=5433 DATABASE_SSL=0 in .env
# App in its own container: same Compose network + DATABASE_HOST=postgres DATABASE_PORT=5432 — see docs/PRODUCTION_SETUP.md
```

---

## Testing

**Backend** (`backend/tests/`): Vitest, single-worker (DB serialization), supertest for HTTP assertions. Uses real Postgres in CI.

Key test files:
- `app.test.ts` — Full integration (auth, import, classify, reports)
- `canonical-ingest.test.ts` — Dedupe, classification, transfer logic
- `category-rules.test.ts` — Rule matching engine
- `boa-parser.test.ts`, `pdf-parsers.test.ts` — Bank adapter validation
- `payslip-upload.test.ts`, `payslip-canonical-map.test.ts` — Payslip flow

Fixtures: real (redacted) bank exports in `backend/tests/fixtures/`.

**Frontend** (`frontend/src/`): Vitest unit tests for chart models and parser profile inference.

---

## Production Deployment

**Platform:** [Koyeb](https://www.koyeb.com) (or any container host). No `.github/workflows/` or other CI config in this repo.

**Runtime contract:** Set **`MODE=PROD`** so Express serves **`frontend/dist/`** as the SPA and mounts JSON API routes at **`/`**. Postgres is **always external** — set **`DATABASE_*`** (+ **`DATABASE_SSL=1`** for typical managed TLS). Migrations under **`backend/db/migrations/`** apply **automatically on first DB connection** at startup; bootstrap data is **not** automatic — see **`docs/PRODUCTION_SETUP.md`** (first-time **`npm run db:seed`**, do not repeat blindly).

**Two ways to ship the same Node process:**

| Path | What to run |
|------|----------------|
| **Docker** | Root **`Dockerfile`**: multi-stage **`npm run build`**, **`npm prune --omit=dev`**, **`CMD node backend/dist/server.js`**. Postgres is **not** in the image; pass env at **`docker run`** (**`--env-file`**) or your platform’s env UI. Persist **`data/`** with a volume if imports/exports must survive restarts. |
| **Bare Node** | **`npm run build`** at repo root, then **`npm run start -w backend`** (or **`node backend/dist/server.js`** with **`NODE_ENV=production`**). |

Full checklist (image vs `docker run`, **`.env`**, Koyeb buildpack vs Dockerfile, migrations vs seeds): **`docs/PRODUCTION_SETUP.md`**. **`docs/RUNBOOK.md`** is the local-from-scratch path.

---

## Documentation Index

| File | Purpose |
|---|---|
| `docs/RUNBOOK.md` | Dev/prod setup walkthrough |
| `docs/ARCHITECTURE.md` | System design: ingestion, dedupe, transfer detection |
| `docs/PRODUCTION_SETUP.md` | Docker / Koyeb deploy, env, migrations vs seeds, Postgres ops |
| `Dockerfile` | Production image (Node 20): API + SPA; external Postgres only |
| `docs/HOSTING_OPTIONS_AND_HOME_LAB.md` | $0 opex / free-tier cloud / home lab / backup context (maintainer) |
| `docs/ENVIRONMENT_VARIABLES.md` | Full env reference |
| `docs/USER_GUIDE.md` | End-user features |
| `docs/API_INDEX.md` | All API routes summary |
| `docs/API_EXPORTS.md` | `.hfb` export + restore API |
| `docs/API_*.md` | Per-domain API guides |
| `docs/PAYSLIP_V1.md` | Payslip feature spec |
| `docs/CHANGE_HISTORY.md` | Detailed changelog |
| `openapi/openapi.yaml` | OpenAPI 3.1 complete spec |
