#!/usr/bin/env node
/**
 * Reset the public schema for an isolated test database (DROP + CREATE).
 * Next step: `node scripts/db-pg.mjs --init --seed --dev-seeds`.
 * Loads repo root .env. Requires DATABASE_* (same as backend).
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
  console.error("Missing DATABASE_HOST, DATABASE_USER, or DATABASE_NAME");
  process.exit(1);
}

const port = Number(process.env.DATABASE_PORT || "5432");
const password = process.env.DATABASE_PASSWORD ?? "";
const ssl =
  String(process.env.DATABASE_SSL || "1").trim() === "0" ||
  String(process.env.DATABASE_SSL || "").toLowerCase() === "false"
    ? false
    : "require";

const sql = postgres({
  host,
  port,
  database,
  username: user,
  password,
  max: 5,
  ssl
});

try {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE`);
  await sql.unsafe(`CREATE SCHEMA public`);
  await sql.unsafe(`GRANT ALL ON SCHEMA public TO PUBLIC`);
  console.log("Reset public schema (DROP CASCADE + CREATE).");
} finally {
  await sql.end({ timeout: 5 });
}
