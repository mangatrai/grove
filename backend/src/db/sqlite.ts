import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { resolveDbPath } from "../config/env.js";
import { log } from "../logger.js";
import { applyPendingMigrations } from "./apply-migrations.js";

const dbPath = resolveDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

const applied = applyPendingMigrations(db);
if (applied > 0 && process.env.NODE_ENV !== "test") {
  log.info(`Applied ${applied} pending migration(s).`);
}

export { db, dbPath };
