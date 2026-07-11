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
npm run test -w frontend # Frontend only (Vitest — pure logic, no DOM)
npm run test:e2e         # Playwright E2E (requires npm run start:dev + db:reset:dev first)
npm run build            # Both workspaces → dist/
npm run lint             # Both workspaces
npm run db:reset         # Drop/recreate schema + migrations + bootstrap
npm run db:reset:dev     # + dev seeds
docker compose up -d     # Local Postgres 18 on port 5433 (DATABASE_SSL=0 locally)
```

---

## IMPORTANT: No PII / Real Financial Data in Code or Docs

Test files, planning documents, code comments, and documentation examples must **never** contain real personal or financial data. This is a standing rule for all features — not just ESPP.

**What counts as PII/real data:**
- Real account numbers, transaction amounts, or balances from actual bank/brokerage statements
- Real share quantities, stock prices, cost bases, or FMV values from actual holdings
- Real payslip amounts, salary figures, or tax deduction values
- Real dates that correspond to specific transaction events (e.g., purchase dates matching an actual ESPP lot)
- Real names, emails, or other identifiers beyond the seeded test fixtures (`owner@example.com`, `e2e@example.com`)

**How to write test data:**
- Use obviously fictional values: round or near-round numbers (e.g., 10 shares, $150.00/share)
- Use generic company/institution names ("Acme Corp", "Example Bank") — never real employer or bank names in examples
- Use dates that are clearly chosen for testing (e.g., `2026-06-15`), not dates copied from real statements
- When building a feature from a real-world scenario, generalize all numbers before writing code or tests

This applies everywhere that ends up in git history: `backend/tests/`, `docs/`, `concept/`, inline code examples, and API_REFERENCE response examples.

---

## Code Conventions

- **No default exports** — named exports only
- **No `console.*`** outside `logger.ts` and `scripts/` — use `log.info` / `log.warn` / `log.error` / `log.debug` from `backend/src/logger.ts`
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

## IMPORTANT: Fail-Closed Error Handling in Fan-Out/Pipeline Code

Any function that is one branch of a `Promise.all` (agent domains, batch jobs), a background poll/scheduler tick, or a cron-style job **must catch its own errors** and return a safe empty/no-op result — never let it throw uncaught. One failing branch must not take down its siblings.

- Wrap the branch body in `try/catch`; on catch, `log.warn` (or `log.error` for genuinely unexpected failures) with enough context to debug — at minimum the entity ID (`householdId`, job ID, etc.) and `String(err)` — then return the type's safe empty value (`{ hasOutput: false, alerts: [] }`, `[]`, `null`, etc.), matching whatever the success path's "nothing to report" shape already is.
- This applies even to fully deterministic code with no LLM/external call — a DB blip or unexpected null is enough to throw. Don't assume "it's just a DB read" means it can't fail.
- Precedent: `backend/src/modules/family/family-agent.service.ts` — every Domain function (`analyzeCoverageAndCoordination`, `runProactiveResearch`, `sweepDeadlines`, `synthesizeDigest`, `detectOccasions`) wraps its own body and fails closed, so `runFamilyAgent`'s `Promise.all` never fails wholesale because one domain choked. Check this pattern is still intact whenever you add a new domain/branch to that file.

---

## IMPORTANT: Documentation Structure (6 canonical docs — do not create new files)

All documentation lives in exactly these 6 files. When adding or updating docs, route content to the right file:

| File | What goes here |
|------|----------------|
| `docs/USER_GUIDE.md` | How to use the app — screens, workflows, UI flows for household members |
| `docs/ADMIN_GUIDE.md` | How to deploy, configure, and operate — env vars, hosting, DB, caching, email, troubleshooting |
| `docs/BACKLOG.md` | Feature requests, planned work, bugs, deferred/dropped items (Jira-style board with status) |
| `docs/PRD_AND_CRS.md` | Product requirements, architectural decisions, design rationale, competitive notes |
| `docs/API_REFERENCE.md` | HTTP endpoint documentation — request/response schemas, errors, query params |
| `docs/CHANGE_HISTORY.md` | Append-only log of every shipped change (CR-/FIX-/UX-/DB-/DOC- entries) |

**Rule:** Never create a new standalone `.md` file in `docs/`. Route content to the right file above.

---

## IMPORTANT: Mandatory Per-Change Checklist

Every code change, no exceptions:

1. **`docs/CHANGE_HISTORY.md`** — add an entry (CR-/FIX-/UX-/DB- prefix). What changed, why, which files.
2. **`docs/API_REFERENCE.md`** — update the relevant section if request/response shape, behaviour, or error codes changed.
3. **`openapi/openapi.yaml`** — add/update for every new or modified HTTP endpoint. No route ships without an OpenAPI entry.
4. **Tests** — run `npm run test -w backend` after every backend change. Do not commit if tests fail. Add tests for new parser profiles, service logic, and API behaviour changes.
   - **Frontend unit tests** (`npm run test -w frontend`) — Vitest, tests pure logic functions (cache, ledger query builders, payslip chart models, parser profile detection). Add tests here for new pure functions.
   - **E2E tests** (`npm run test:e2e`) — Playwright, tests real browser flows (auth, navigation, DOM). Add new E2E specs in `e2e/` for new pages or critical user flows. Requires `npm run start:dev` + `npm run db:reset:dev`. Uses `e2e@example.com` / `ChangeMe123!` as the test user (seeded in bootstrap, `force_password_change=false`). Navigate via sidebar clicks — never `page.goto()` for routes proxied by Vite (see `vite.config.ts` proxy list).
5. **Commits** — one commit per logical concern. Use `feat(scope/ID):` / `fix(scope/ID):` convention. Doc changes (CHANGE_HISTORY + API_REFERENCE + openapi) go in the **same commit** as the code, never separate.
6. **Version bump** — bump `package.json`, `backend/package.json`, and `frontend/package.json` for every change that goes to production. Convention: `patch` for bug fixes (FIX-), `minor` for new features (CR-/feat), `major` for breaking changes. Bump in a separate commit immediately after the code commit. Never ship to production without a version bump.
7. **GitHub Issues** — every item committed to a version has a GitHub issue on the matching milestone. When planning: open issue. On ship: `closes #N` in the commit message. Find N with `gh issue list --search '<ID>'`. additionally open github issues for each bug reported. commit message should refer to these github issues whenever possible.
7. **`docs/USER_GUIDE.md`** — update the relevant section if new pages, sub pages or user facing functionality is added.
8. **`docs/ADMIN_GUIDE.md`** — update the relevant section if new pages, env variables, database schema, any architecture or operational decisions are made.
