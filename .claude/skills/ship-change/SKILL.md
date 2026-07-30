---
name: ship-change
description: Mandatory per-change checklist for this repo — use before committing or considering a code/DB change in household-finance-app finished (docs, tests, versioning, GitHub issue).
---

# Mandatory Per-Change Checklist

1. `CHANGE_HISTORY.md` entry (CR-/FIX-/UX-/DB- prefix)
2. `API_REFERENCE.md` + `openapi/openapi.yaml` for any new/changed endpoint
3. Any migration that adds, drops, or alters a table → update `docs/DATABASE_ARCHITECTURE.md` (catalog row + relevant ERD) in the same commit
4. `npm run test -w backend` must pass before commit; add tests for new logic. Frontend Vitest for pure logic; Playwright E2E (`e2e/`) for new pages/critical flows — `e2e@example.com`/`ChangeMe123!`, navigate via sidebar clicks, never `page.goto()` for Vite-proxied routes.
5. One commit per logical concern, `feat(scope/ID):`/`fix(scope/ID):`. Doc changes ship in the **same commit** as code.
6. Version bump (`package.json` × 3) in a separate commit right after: patch=fix, minor=feature, major=breaking. Never ship without one.
7. GitHub issue per shipped item, on the matching milestone; `closes #N` in the commit message. Open issues for backlog items too, not just shipped work.
8. Update `USER_GUIDE.md` / `ADMIN_GUIDE.md` if user-facing pages or ops/env/schema changed.
