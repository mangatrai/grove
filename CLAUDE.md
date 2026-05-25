# CLAUDE.md — Household Finance App

Self-hosted household finance app. Node.js 20 + React 18 monorepo, Express backend, Postgres 18 (Docker locally, managed in prod on Koyeb). User dont want a suckup, yes man. so please stay true to facts and reality not blindly agree with user. 

---

## Key Commands

```bash
npm run dev              # Backend (tsx watch, port 4000)
npm run dev:frontend     # Frontend (Vite HMR, port 3000)
npm run start:dev        # Both services background (logs in .runtime/logs/)
npm test                 # All tests
npm run test -w backend  # Backend only (single-worker, real Postgres)
npm run test -w frontend # Frontend only
npm run build            # Both workspaces → dist/
npm run lint             # Both workspaces
npm run db:reset         # Drop/recreate schema + migrations + bootstrap
npm run db:reset:dev     # + dev seeds
docker compose up -d     # Local Postgres 18 on port 5433 (DATABASE_SSL=0 locally)
```

---

## Code Conventions

- **No default exports** — named exports only
- **No `console.*`** outside `logger.ts` and `scripts/` — use `logger.info/warn/error`
- Unused vars: prefix `_` to suppress ESLint; ESM throughout (`"type": "module"`)
- File naming: `<domain>.routes.ts` / `.service.ts` / `.middleware.ts` / `.types.ts`
- DB columns `snake_case` → TypeScript `camelCase`; API routes `kebab-case`; env vars `SCREAMING_SNAKE_CASE`
- Services return `{ ok: true, data: T }` or `{ ok: false, code: string, message: string }`
- Zod `.safeParse()` on all request bodies; 400 + `{ errors: z.issues }` on failure

## DB Layer (`backend/src/db/query.ts`)

Never use the `postgres` client directly — always use:

```
qAll / qGet / qExec / qBegin   — query helpers
getSql()                        — lazy-init client (also applies pending migrations)
sqlBind(sql, params)            — translates ? placeholders → $1, $2, ...
isPgUniqueViolation(err)        — check SQLSTATE 23505
```

**Write SQL with `?`** — `sqlBind()` handles the Postgres translation.

---

## Codebase Investigation — Use Subagents

When a task requires exploring the codebase to find a root cause, trace a data flow, or locate files to edit — **spawn a subagent** rather than reading files in the main context.

Prompt the subagent with a tight scope:
> "Investigate [X]. Return only: root cause, files to edit, fix plan. Do not return full file contents."

Apply this whenever the investigation would require reading more than 2–3 files.

---

## IMPORTANT: Non-Obvious Gotchas

- **Mantine:** Any page you touch MUST be migrated to Mantine in the same pass. No new custom CSS for patterns Mantine already covers.
- **Chase/Citi CSV parsers** are vestigial — do not develop or test them. Both banks use OFX in practice.
- **`@anthropic-ai/sdk`** stays in dependencies (optional AI insights pipeline, `LLM_PROVIDER=anthropic`). Do not remove it.
- **Classification is rule-based only.** LLM/Anthropic categorization was fully removed. OpenAI is used only for payslip PDF extraction.
- **After restore:** canonical transactions may reference deleted custom categories. Always `LEFT JOIN category`, never `INNER JOIN`.
- **Bank adapters** live in `backend/src/modules/imports/profiles/`. BoA is MVP/primary. Adding a new one: create file in `profiles/`, register in the profile IDs enum, wire into `import-parser.service.ts`.
- **Export registry:** Every new DB table must be registered in `EXPORT_REGISTRY` or `EXPORT_EPHEMERAL_TABLES` (check `backend/src/modules/export/`). Missing tables produce a `[export-coverage]` WARN on startup and will be silently excluded from backups. Check this on every migration.
- **DB query API:** `qAll/qGet/qExec` take `(sqlStr, ...params)` — SQL with `?` placeholders, params spread as individual args. `sqlBind` returns `{ text, values }` for use inside `qBegin` transactions only. Do NOT wrap `sqlBind(...)` inside `qAll/qGet/qExec` — that passes an object where a string is expected and crashes at runtime.
- **Date column types:** `transaction_canonical.txn_date` and `payslip_snapshot.pay_date` are `TEXT` (ISO YYYY-MM-DD). Compare with plain string params — no `::date` cast on the param. For `EXTRACT`/`date_part`, cast the column: `EXTRACT(MONTH FROM txn_date::date)`. `account_balance_snapshot.as_of_date` IS a real date — `::date` cast on params works there.

---

## IMPORTANT: Mandatory Per-Change Checklist

Every code change, no exceptions:

1. **`docs/CHANGE_HISTORY.md`** — add an entry (CR-/FIX-/UX-/DB- prefix). What changed, why, which files.
2. **`docs/API_*.md`** — update if request/response shape, behaviour, or error codes changed.
3. **`openapi/openapi.yaml`** — add/update for every new or modified HTTP endpoint. No route ships without an OpenAPI entry.
4. **Tests** — run `npm run test -w backend` after every backend change. Do not commit if tests fail. Add tests for new parser profiles, service logic, and API behaviour changes.
5. **Commits** — one commit per logical concern. Use `feat(scope/ID):` / `fix(scope/ID):` convention. Doc changes (CHANGE_HISTORY + API docs + openapi) go in the **same commit** as the code, never separate.
