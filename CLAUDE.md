# CLAUDE.md — Household Finance App

Self-hosted household finance app. Node.js 20 + React 18 monorepo, Express backend, Postgres 18 (Podman locally, Koyeb in prod). User doesn't want a yes-man — stay true to facts, don't blindly agree.

---

## Key Commands

```bash
npm run dev              # Backend (tsx watch, :4000)
npm run dev:frontend     # Frontend (Vite HMR, :3000)
npm run start:dev        # Both, background (.runtime/logs/)
npm test                 # All tests
npm run test -w backend  # Backend (single-worker, real Postgres)
npm run test -w frontend # Frontend (Vitest, pure logic, no DOM)
npm run test:e2e         # Playwright (needs start:dev + db:reset:dev first)
npm run build            # Both → dist/
npm run lint             # Both
npm run db:reset         # Drop/recreate schema + migrations + bootstrap
npm run db:reset:dev     # + dev seeds
podman compose up -d     # Local Postgres 18 :5433 (DATABASE_SSL=0)
```

---

## No PII / Real Financial Data

Never commit real account numbers, balances, share prices, salary/payslip figures, or real transaction dates — in code, tests, docs, or comments. Use round fictional numbers, generic names ("Acme Corp"), obviously-test dates (`2026-06-15`). Applies everywhere it lands in git history: `backend/tests/`, `docs/`, `concept/`, API_REFERENCE examples.

## Code Conventions

- No default exports — named exports only
- No `console.*` outside `logger.ts`/`scripts/` — use `log.info/warn/error/debug` (`backend/src/logger.ts`)
- Unused vars: prefix `_`; ESM throughout
- File naming: `<domain>.routes.ts` / `.service.ts` / `.middleware.ts` / `.types.ts`
- DB `snake_case` → TS `camelCase`; API routes `kebab-case`; env vars `SCREAMING_SNAKE_CASE`
- Services return `{ ok: true, data: T }` or `{ ok: false, code, message }`
- Zod `.safeParse()` on request bodies; 400 + `{ errors: z.issues }` on failure

## DB Layer (`backend/src/db/query.ts`)

Never use the `postgres` client directly:
- `qAll/qGet/qExec(sqlStr, ...params)` — SQL with `?` placeholders, params spread as args
- `qBegin` for transactions; `sqlBind(sql, params)` → `{text, values}` — **only** inside `qBegin`, never wrapped inside `qAll/qGet/qExec` (passes an object where a string is expected → runtime crash)
- `getSql()` lazy-inits the client + applies pending migrations
- `isPgUniqueViolation(err)` checks SQLSTATE 23505
- `txn_date`/`pay_date` are `TEXT` (ISO) — compare as plain strings, no `::date` on params; cast the column for `EXTRACT()`. `account_balance_snapshot.as_of_date` is a real date — `::date` on params is fine there.

## Codebase Investigation — Use Subagents

Task needs reading >2-3 files to find a root cause or trace a data flow? Spawn a subagent using haiku model, tight scope: "Investigate X. Return only: root cause, files to edit, fix plan."

## Non-Obvious Gotchas

- **Mantine:** any page you touch must be migrated to Mantine in the same pass — no new custom CSS for patterns Mantine already covers.
- **Chase/Citi CSV parsers** are vestigial dead code — both banks use OFX in practice; don't develop/test the CSV path.
- **Classification is rule-based only** — no LLM categorization. OpenAI is payslip-PDF-extraction only. Anthropic (`LLM_PROVIDER=anthropic`) now powers Family Planner's agent loop (`pa-task-runner.ts`, `family-agent.service.ts`) — it's load-bearing there, not just an optional insights add-on.
- **After restore:** transactions may reference deleted custom categories — `LEFT JOIN category`, never `INNER JOIN`.
- **Bank adapters:** `backend/src/modules/imports/profiles/`; BoA is MVP/reference. New adapter: add file, register in the profile-ID enum, wire into `import-parser.service.ts`.
- **Export registry:** every new DB table → `EXPORT_REGISTRY` or `EXPORT_EPHEMERAL_TABLES` (`backend/src/modules/export/`), or it's silently excluded from backups (`[export-coverage]` WARN on startup). Check on every migration.

## Fail-Closed Fan-Out/Pipeline Code

Any `Promise.all` branch (agent domains, batch jobs), poll/scheduler tick, or cron job must catch its own errors and return the type's safe empty value — never throw uncaught, or one failing branch takes down its siblings. `log.warn`/`log.error` with entity ID + `String(err)` on catch. Precedent: `family-agent.service.ts` domain functions.

## Docs — 7 canonical files, never add new ones under `docs/`

| File | Content |
|------|---------|
| `USER_GUIDE.md` | screens/workflows for household members |
| `ADMIN_GUIDE.md` | deploy/config/ops — env vars, DB, email, troubleshooting |
| `BACKLOG.md` | feature requests, bugs, deferred items |
| `PRD_AND_CRS.md` | product requirements, architecture decisions |
| `API_REFERENCE.md` | HTTP endpoint request/response/errors |
| `CHANGE_HISTORY.md` | append-only shipped-change log (CR-/FIX-/UX-/DB-/DOC-) |
| `DATABASE_ARCHITECTURE.md` | schema catalog, ER diagrams (Mermaid), index/constraint rationale, Postgres-feature usage |

## Mandatory Per-Change Checklist

See the `ship-change` skill for the full checklist (docs, tests, versioning, GitHub issue) — apply it before committing or considering any code/DB change finished.
