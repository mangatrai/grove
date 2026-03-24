import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { resolveDbPath } from "../config/env.js";

const dbPath = resolveDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

export { db, dbPath };
