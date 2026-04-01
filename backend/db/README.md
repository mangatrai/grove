# Database Baseline

This folder contains SQL-first migrations and seed data for Story 1.2.

## Files

- `migrations/0001_init.sql`: core schema for household, auth, accounts, imports,
  canonical transactions, and resolution queues.
- `seeds/0001_seed_defaults.sql`: default household, owner user, and starter
  categories.
- `seeds/dev/*.sql`: optional dev-only fixtures (sample `financial_account` rows).
  Applied only with `scripts/db.mjs --seed --dev-seeds` (e.g. `npm run db:seed:dev` or `npm run setup`).
  `npm run db:seed` skips this folder. See `seeds/dev/README.md` and `docs/PRODUCTION_SETUP.md`.

## Notes

- The project uses a SQL-first migration style for transparency and auditability.
- Migration execution tooling is provided via `scripts/db.sh` and `scripts/db.mjs`.
- SQLite is the MVP system of record; runner enables:
  - `PRAGMA journal_mode=WAL`,
  - idempotent migration tracking (`schema_migrations`),
  - idempotent seed tracking (`schema_seeds`).

## Postgres migration status

Postgres is not wired yet in this runner. Planned work includes:
- dialect-safe migration path (or dedicated Postgres migration pipeline),
- environment contract (`DATABASE_URL`, SSL, pool sizing),
- production deploy sequencing for hosted platforms (e.g. Koyeb).
