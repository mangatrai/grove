# Database Baseline

This folder contains SQL-first schema and seed data.

## Files

- **`migrations/0001_baseline.sql`** — Full SQLite schema (squashed from the former incremental chain through `0032`). Applied on **new** databases as the only migration file.
- **`migrations_archive/`** — Legacy incremental migrations (not run by the app); kept for history. See [`migrations_archive/README.md`](migrations_archive/README.md).
- **`seeds/0001_bootstrap.sql`** — Default household, owner user, global category taxonomy, and built-in `category_rule_global` rows (`INSERT OR IGNORE`).
- **`seeds/dev/*.sql`** — Dev-only sample `financial_account` rows. Applied only with `scripts/db.mjs --seed --dev-seeds` (e.g. `npm run db:seed:dev` or `npm run setup`). `npm run db:seed` skips this folder. See [`seeds/dev/README.md`](seeds/dev/README.md) and [`docs/PRODUCTION_SETUP.md`](../../docs/PRODUCTION_SETUP.md).

## Existing SQLite files from before the baseline

If your database already recorded **32** rows in **`schema_migrations`** (old filenames), it will **not** match this repo’s single-file baseline. **Recommended:** back up, then `npm run db:cleanup` and `npm run db:seed` (or `setup`) so a fresh file receives **`0001_baseline.sql`** only. See [`docs/RUNBOOK.md`](../../docs/RUNBOOK.md).

## Notes

- Runner: `scripts/db.sh` / `scripts/db.mjs` — `PRAGMA journal_mode=WAL`, **`schema_migrations`**, **`schema_seeds`** tracking.
- Postgres is not wired in this runner yet; see [`docs/PRODUCTION_SETUP.md`](../../docs/PRODUCTION_SETUP.md).
