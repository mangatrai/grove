# Production database setup

## Migrations

Schema is applied in order from `backend/db/migrations/` via `scripts/db.mjs` (tracked in `schema_migrations`).

## Seeds

- **`backend/db/seeds/0001_seed_defaults.sql`** — Global default category taxonomy, a bootstrap household, and the seeded owner user (for first login when used). **Apply this** for a usable empty app.
- **`backend/db/seeds/dev/*.sql`** — Dev-only sample data (extra financial accounts, Marcus/payslip fixtures). **Not** scanned from the top-level `seeds/` folder; `scripts/db.mjs --seed` applies top-level `*.sql` first, then **`seeds/dev/*.sql`** in order.

Use **`--seed`** for local development so both layers run. For **strict production**, prefer migrations **without** `--seed**, then apply **`0001_seed_defaults.sql`** under change control and record it in `schema_seeds`, **or** run a copy of `seeds/` that contains **only** `0001_seed_defaults.sql` and **no** `dev/` subdirectory so `--seed` stays minimal.

## Environment

- Set `JWT_SECRET` and database path in `.env` (see `.env.example`).
- Change default seeded credentials immediately after first deploy.

## Institution list

Curated U.S. institution labels and household custom names are app-level (see Connected accounts). No separate production SQL is required for the catalog.
