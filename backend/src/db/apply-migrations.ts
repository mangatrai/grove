import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "db", "migrations");
const TRACKING_TABLE = "schema_migrations";

function ensureTrackingTable(db: Database.Database, tableName: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Applies any migration `.sql` files under `backend/db/migrations` that are not yet in `schema_migrations`.
 * Idempotent — safe to call on every server start.
 */
export function applyPendingMigrations(db: Database.Database): number {
  ensureTrackingTable(db, TRACKING_TABLE);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const hasFileStmt = db.prepare(`SELECT 1 FROM ${TRACKING_TABLE} WHERE name = ?`);
  const markAppliedStmt = db.prepare(`INSERT INTO ${TRACKING_TABLE}(name) VALUES (?)`);

  let applied = 0;
  const transaction = db.transaction((file: string) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    db.exec(sql);
    markAppliedStmt.run(file);
    applied += 1;
  });

  for (const file of files) {
    if (hasFileStmt.get(file)) {
      continue;
    }
    transaction(file);
  }

  return applied;
}
