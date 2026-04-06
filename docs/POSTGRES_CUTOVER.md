# PostgreSQL (current production database)

**Status:** The app **uses PostgreSQL only** via the **`postgres`** client (porsager). Schema is applied from [`backend/db/migrations_pg/`](../backend/db/migrations_pg/). Bootstrap + dev sample data: [`backend/db/seeds_pg/`](../backend/db/seeds_pg/). Legacy SQLite files under `backend/db/migrations/` and `seeds/` are **historical reference** only.

**Full-text search:** `transaction_canonical.search_document` is a **generated `tsvector`** (English) over `merchant` + `memo`, with a **GIN** index — parity with the former SQLite FTS5 + `ledger_search_fts` approach.

## Connection shape (Koyeb / Node)

Use **separate fields** (as Koyeb exposes for Postgres), not only a `postgres://…` URL:

```ts
import postgres from "postgres";

const sql = postgres({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 5432),
  database: process.env.DATABASE_NAME,
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD ?? "",
  ssl: process.env.DATABASE_SSL !== "0" && process.env.DATABASE_SSL !== "false" ? "require" : false
});
```

## Tooling

| Script / path | Role |
|----------------|------|
| [`scripts/db-pg.mjs`](../scripts/db-pg.mjs) | Apply `migrations_pg` + optional `seeds_pg` |
| [`scripts/preset-pg-test.mjs`](../scripts/preset-pg-test.mjs) | Reset `public` schema for tests |
| [`scripts/db.sh`](../scripts/db.sh) | Wraps `db-pg.mjs` |
| [`scripts/prep-test-db.sh`](../scripts/prep-test-db.sh) | Preset + clean import staging dirs |
| [`docker-compose.yml`](../docker-compose.yml) | Local Postgres 16 on host port **5433** |

## Environment contract

| Variable | Use |
|----------|-----|
| `DATABASE_HOST` | Managed Postgres hostname (**required**). |
| `DATABASE_PORT` | Default **5432** in app schema. |
| `DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_NAME` | Credentials (**required** host/user/name). |
| `DATABASE_SSL` | TLS for managed hosts; **`0`** for local Docker. |

**Test vs prod:** same keys; different values for **test** vs **prod** instances.

## Related docs

- [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) — full `.env` index.
- [`OPERATOR_FAQ.md`](OPERATOR_FAQ.md) — import sessions, recategorize scope, exports.
