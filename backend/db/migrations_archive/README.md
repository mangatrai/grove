# Archived incremental migrations (pre-baseline)

These files applied in order on databases created before the **`0001_baseline.sql`** squash. They are **not** executed by `scripts/db.mjs` (only `migrations/*.sql` runs).

Use for archaeology or regenerating a baseline with `sqlite3 … .schema` if the live schema drifts.
