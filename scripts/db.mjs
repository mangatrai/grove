#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

function parseArgs(argv) {
  const args = {
    dbPath: "",
    migrationsDir: "",
    seedsDir: "",
    seed: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--db-path") {
      args.dbPath = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (current === "--migrations-dir") {
      args.migrationsDir = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (current === "--seeds-dir") {
      args.seedsDir = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (current === "--seed") {
      args.seed = true;
    }
  }

  if (!args.dbPath || !args.migrationsDir || !args.seedsDir) {
    throw new Error("Missing required arguments");
  }

  return args;
}

function ensureTrackingTable(db, tableName) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function applySqlFiles(db, folder, tableName) {
  ensureTrackingTable(db, tableName);

  const files = fs
    .readdirSync(folder)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const hasFileStmt = db.prepare(
    `SELECT 1 FROM ${tableName} WHERE name = ?`
  );
  const markAppliedStmt = db.prepare(
    `INSERT INTO ${tableName}(name) VALUES (?)`
  );

  let applied = 0;
  const transaction = db.transaction((file) => {
    const sql = fs.readFileSync(path.join(folder, file), "utf8");
    db.exec(sql);
    markAppliedStmt.run(file);
  });

  for (const file of files) {
    const exists = hasFileStmt.get(file);
    if (exists) {
      continue;
    }
    transaction(file);
    applied += 1;
    console.log(`Applied: ${file}`);
  }

  return applied;
}

function main() {
  const { dbPath, migrationsDir, seedsDir, seed } = parseArgs(process.argv.slice(2));

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");

    const migrationsApplied = applySqlFiles(db, migrationsDir, "schema_migrations");
    console.log(`Migrations applied this run: ${migrationsApplied}`);

    if (seed) {
      const seedsApplied = applySqlFiles(db, seedsDir, "schema_seeds");
      console.log(`Seeds applied this run: ${seedsApplied}`);
    }
  } finally {
    db.close();
  }
}

main();
