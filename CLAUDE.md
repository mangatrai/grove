# CLAUDE.md — Household Finance App

Self-hosted household finance app. Node.js 20 + React 18 monorepo, Express backend, Postgres 18 (Podman locally, Koyeb in prod). User doesn't want a yes-man — stay true to facts, don't blindly agree.

---

## Key Commands

```bash
npm run dev              # Backend (tsx watch, :4000)
npm run dev:frontend     # Frontend (Vite HMR, :3000)
npm run start:dev        # Both, background (.runtime/logs/)
npm run test -w backend  # Backend (single-worker, real Postgres — shares the dev DB, wipes dev data)
npm run test -w frontend # Frontend (Vitest, pure logic, no DOM)
npm run test:e2e         # Playwright (needs start:dev + db:reset:dev first)
npm run db:reset         # Drop/recreate schema + migrations + bootstrap
npm run db:reset:dev     # + dev seeds
podman compose up -d     # Local Postgres 18 :5433 (DATABASE_SSL=0)
```

---

## No PII / Real Financial Data

Never commit real account numbers, balances, share prices, salary/payslip figures, or real transaction dates — in code, tests, docs, or comments. Use round fictional numbers, generic names ("Acme Corp"), obviously-test dates (`2026-06-15`). Applies everywhere it lands in git history: `backend/tests/`, `docs/`, `concept/`, API_REFERENCE examples.

## Code Conventions

(`no-console` and `_`-prefixed unused vars are enforced by ESLint — not repeated here.)

- No default exports — named exports only
- Logging via `log.info/warn/error/debug` from `backend/src/logger.ts`
- File naming: `<domain>.routes.ts` / `.service.ts` / `.middleware.ts` / `.types.ts`
- DB `snake_case` → TS `camelCase`; API routes `kebab-case`; env vars `SCREAMING_SNAKE_CASE`
- Services return `{ ok: true, data: T }` or `{ ok: false, code, message }`
- Zod `.safeParse()` on request bodies; 400 + `{ errors: z.issues }` on failure

## DB Layer (`backend/src/db/query.ts`)

Migrations live in `backend/db/migrations/`. Never use the `postgres` client directly:
- `qAll/qGet/qExec(sqlStr, ...params)` — SQL with `?` placeholders, params spread as args
- `qBegin` for transactions; `sqlBind(sql, params)` → `{text, values}` — **only** inside `qBegin`, never wrapped inside `qAll/qGet/qExec` (passes an object where a string is expected → runtime crash)
- `getSql()` lazy-inits the client + applies pending migrations
- `isPgUniqueViolation(err)` checks SQLSTATE 23505
- `txn_date`/`pay_date` are `TEXT` (ISO) — compare as plain strings, no `::date` on params; cast the column for `EXTRACT()`. `account_balance_snapshot.as_of_date` is a real date — `::date` on params is fine there.

## Codebase Investigation

Use the haiku model for investigation subagents (the general rule lives in the global CLAUDE.md).

## Non-Obvious Gotchas

- **Mantine:** any page you touch must be migrated to Mantine in the same pass — no new custom CSS for patterns Mantine already covers.
- **Chase/Citi CSV parsers** are still wired up but unused in practice — both banks import via OFX; don't develop/test the CSV path.
- **Classification is rule-based only** — no LLM categorization. All LLM features (payslip vision extraction, insights, Family Planner agent loop) go through `LLM_PROVIDER` (`openai` | `anthropic`) via `backend/src/llm/`.
- **After restore:** transactions may reference deleted custom categories — `LEFT JOIN category`, never `INNER JOIN`.
- **Bank adapters:** `backend/src/modules/imports/profiles/`; BoA is MVP/reference. New adapter: add file, register in the profile-ID enum, wire into `import-parser.service.ts`.
- **Export registry:** every new DB table → `EXPORT_REGISTRY` (user data, next `restoreOrder`) or `EXPORT_EPHEMERAL_TABLES` (infra) in `backend/src/modules/export/`, or it's silently excluded from backups (`[export-coverage]` WARN on startup). Check on every migration.

## Fail-Closed Fan-Out/Pipeline Code

Any `Promise.all` branch (agent domains, batch jobs), poll/scheduler tick, or cron job must catch its own errors and return the type's safe empty value — never throw uncaught, or one failing branch takes down its siblings. `log.warn`/`log.error` with entity ID + `String(err)` on catch. Precedent: `family-agent.service.ts` domain functions.

## Docs

Exactly 7 canonical files under `docs/` — never add new ones: `USER_GUIDE`, `ADMIN_GUIDE`, `BACKLOG`, `PRD_AND_CRS`, `API_REFERENCE`, `CHANGE_HISTORY` (append-only), `DATABASE_ARCHITECTURE`. GitHub issues/milestones are the source of truth for active work.

## Mandatory Per-Change Checklist

Apply the `ship-change` skill (docs, tests, versioning, GitHub issue) before committing or considering any code/DB change finished.
