import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Sql } from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "db", "migrations");
const TRACKING_TABLE = "schema_migrations";

/**
 * Applies any `.sql` files under `backend/db/migrations` not yet recorded in `schema_migrations`.
 */
export async function applyPendingPgMigrations(sql: Sql): Promise<number> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

  let applied = 0;
  for (const file of files) {
    const existing = await sql.unsafe(`SELECT 1 AS ok FROM ${TRACKING_TABLE} WHERE name = $1`, [file]);
    if (Array.from(existing as Iterable<unknown>).length > 0) {
      continue;
    }

    const body = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx.unsafe(`INSERT INTO ${TRACKING_TABLE} (name) VALUES ($1)`, [file]);
    });
    applied += 1;
  }

  return applied;
}
