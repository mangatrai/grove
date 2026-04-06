# Database layout

## Active (PostgreSQL)

- **`migrations_pg/0001_baseline.sql`** — Application schema (tables, indexes, generated `tsvector` for ledger search).
- **`migrations_pg/0002_export_job.sql`** — `export_job` for async ZIP exports.
- **`seeds_pg/0001_bootstrap.sql`** — Default household, owner user, global categories, `category_rule_global` (`ON CONFLICT DO NOTHING`).
- **`seeds_pg/dev/*.sql`** — Sample `financial_account` rows for local dev/tests.

**Runner:** [`scripts/db.sh`](../../scripts/db.sh) → [`scripts/db-pg.mjs`](../../scripts/db-pg.mjs) using **`DATABASE_*`** env vars. See [`docs/POSTGRES_CUTOVER.md`](../../docs/POSTGRES_CUTOVER.md).

## Legacy (SQLite — reference only)

- **`migrations/0001_baseline.sql`**, **`migrations/0002_export_job.sql`** — Former SQLite chain; **not** executed by the app.
- **`seeds/0001_bootstrap.sql`**, **`seeds/dev/*.sql`** — Source for generating `seeds_pg/*` (same data, Postgres syntax).
- **`migrations_archive/`** — Old incremental migrations. See [`migrations_archive/README.md`](migrations_archive/README.md).

## Notes

- Tests reset the **`public`** schema via [`scripts/preset-pg-test.mjs`](../../scripts/preset-pg-test.mjs), then apply migrations + seeds. Local Postgres: root **`docker-compose.yml`** (port **5433**).
