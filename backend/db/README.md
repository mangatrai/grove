# Database Baseline

This folder contains SQL-first migrations and seed data for Story 1.2.

## Files

- `migrations/0001_init.sql`: core schema for household, auth, accounts, imports,
  canonical transactions, and resolution queues.
- `seeds/0001_seed_defaults.sql`: default household, owner user, and starter
  categories.

## Notes

- The project uses a SQL-first migration style for transparency and auditability.
- Migration execution tooling is provided via `scripts/db.sh` and `scripts/db.mjs`.
- SQLite is the MVP system of record; runner enables:
  - `PRAGMA journal_mode=WAL`,
  - idempotent migration tracking (`schema_migrations`),
  - idempotent seed tracking (`schema_seeds`).
