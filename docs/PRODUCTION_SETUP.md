# Production database setup

## Migrations

Schema is applied in order from `backend/db/migrations/` via `scripts/db.mjs` (tracked in `schema_migrations`).

## Seeds

- **`backend/db/seeds/0001_seed_defaults.sql`** — Global default category taxonomy, a bootstrap household, and the seeded owner user (for first login when used). **Apply this** for a usable empty app (no sample bank accounts).
- **`backend/db/seeds/dev/*.sql`** — Dev-only sample **`financial_account`** rows (BoA/Citi/Chase/Marcus). Applied **only** with **`--dev-seeds`**. The payslip import account is created from **Profile → Employer Setup**, not from seed SQL.

**`npm run db:seed`** runs migrations + **`0001` only** — appropriate for production-style databases where users create real accounts in Settings.

**`npm run db:seed:dev`** adds the dev fixtures for local smoke tests (same as first-time `npm run setup`).

## Environment

- Set `JWT_SECRET` and database path in `.env` (see `.env.example`).
- If you are enabling AI categorization, set `AI_CATEGORY_ENABLED=true`, `OPENAI_API_KEY`, and tune
  `AI_CATEGORY_AUTO_APPLY_MIN` / `AI_CATEGORY_REVIEW_MIN`.
- Change default seeded credentials immediately after first deploy.

## Institution list

Curated U.S. institution labels and household custom names are app-level (see Connected accounts). No separate production SQL is required for the catalog.

## Postgres + Koyeb readiness (planned, not shipped)

This app is currently SQLite-first in production. Before switching to hosted Postgres/Koyeb, track and complete:

1. DB runtime abstraction for Postgres (driver + query/migration compatibility).
2. Env contract (`DATABASE_URL`, SSL mode, pool size) and secret handling.
3. Startup migration policy (safe one-shot migration before serving traffic).
4. Operational playbook: backup/restore, rollback, and schema drift checks.
5. Koyeb deploy checklist: health endpoint, zero-downtime rollout behavior, and failure recovery.
