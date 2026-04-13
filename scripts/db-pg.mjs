#!/usr/bin/env node
/**
 * Apply Postgres migrations under backend/db/migrations and optional seeds (backend/db/seeds).
 * Loads repo root .env (same pattern as other scripts). Requires DATABASE_HOST, DATABASE_USER, DATABASE_NAME.
 *
 * Usage: node scripts/db-pg.mjs --init [--seed] [--dev-seeds]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

const host = process.env.DATABASE_HOST;
const user = process.env.DATABASE_USER;
const database = process.env.DATABASE_NAME;
if (!host || !user || !database) {
  console.error("Missing DATABASE_HOST, DATABASE_USER, or DATABASE_NAME in environment / .env");
  process.exit(1);
}

const port = Number(process.env.DATABASE_PORT || "5432");
const password = process.env.DATABASE_PASSWORD ?? "";
const ssl =
  String(process.env.DATABASE_SSL || "1").trim() === "0" ||
  String(process.env.DATABASE_SSL || "").toLowerCase() === "false"
    ? false
    : "require";

const migrationsDir = path.join(repoRoot, "backend", "db", "migrations");
const seedsDir = path.join(repoRoot, "backend", "db", "seeds");
const devSeedsDir = path.join(seedsDir, "dev");

const TRACKING_TABLE = "schema_migrations";

function usage() {
  console.error("Usage: node scripts/db-pg.mjs --init [--seed] [--dev-seeds]");
  process.exit(1);
}

const args = process.argv.slice(2);
let init = false;
let seed = false;
let devSeeds = false;
for (const a of args) {
  if (a === "--init") init = true;
  else if (a === "--seed") seed = true;
  else if (a === "--dev-seeds") devSeeds = true;
  else usage();
}
if (!init) usage();

const sql = postgres({
  host,
  port,
  database,
  username: user,
  password,
  max: 5,
  ssl
});

async function applyMigrations() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const file of files) {
    const existing = await sql.unsafe(`SELECT 1 AS ok FROM ${TRACKING_TABLE} WHERE name = $1`, [file]);
    if (Array.from(existing).length > 0) {
      continue;
    }
    const body = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx.unsafe(`INSERT INTO ${TRACKING_TABLE} (name) VALUES ($1)`, [file]);
    });
    applied += 1;
    console.log(`Applied migration: ${file}`);
  }
  if (applied === 0) {
    console.log("Migrations: nothing pending.");
  }
}

async function runSqlFiles(dir, label) {
  if (!fs.existsSync(dir)) {
    console.warn(`No ${label} directory: ${dir}`);
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const body = fs.readFileSync(path.join(dir, file), "utf8");
    await sql.unsafe(body);
    console.log(`${label}: ${file}`);
  }
}

try {
  await applyMigrations();
  if (seed) {
    await runSqlFiles(seedsDir, "seed");
  }
  if (devSeeds) {
    await runSqlFiles(devSeedsDir, "dev-seed");
  }
} finally {
  await sql.end({ timeout: 5 });
}

console.log("Postgres schema ready.");
