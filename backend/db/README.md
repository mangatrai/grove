# Database layout

## Migrations and seeds (PostgreSQL)

- **`migrations/0001_baseline.sql`** — Application schema (tables, indexes, generated `tsvector` for ledger search).
- **`migrations/0002_*.sql` …** — Ordered additive migrations.
- **`seeds/0001_bootstrap.sql`** — Default household, owner user, global categories, `category_rule_global` (`ON CONFLICT DO NOTHING`).
- **`seeds/dev/*.sql`** — Sample accounts, member profiles, and ~520 posted ledger rows for local dev/tests (`scripts/db.sh --dev-seeds` or `npm run db:seed:dev`). Regenerate ledger SQL: `npm run db:generate:dev-ledger`.

**Runner:** [`scripts/db.sh`](../../scripts/db.sh) → [`scripts/db-pg.mjs`](../../scripts/db-pg.mjs) using **`DATABASE_*`** env vars. The API also applies pending migrations on startup. See [`docs/RUNBOOK.md`](../../docs/RUNBOOK.md) §11 for Postgres connection details.

## Notes

- Tests reset the **`public`** schema via [`scripts/preset-pg-test.mjs`](../../scripts/preset-pg-test.mjs), then apply migrations + seeds. Local Postgres: root **`docker-compose.yml`** (port **5433**).
- Built-in global rules in **`seeds/0001_bootstrap.sql`** can be regenerated from CSV via [`backend/scripts/gen-0026-migration.mjs`](../scripts/gen-0026-migration.mjs).
