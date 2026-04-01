#!/usr/bin/env node
/**
 * Prints the absolute SQLite path the API uses (same rules as backend/src/config/env.ts resolveDbPath).
 * Used by db-cleanup.sh and db.sh so CLI targets match the running Node process.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const require = createRequire(import.meta.url);
const dotenv = require(require.resolve("dotenv", { paths: [path.join(repoRoot, "backend")] }));
dotenv.config({ path: path.join(repoRoot, ".env") });

function resolveConfiguredPath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(repoRoot, filePath);
}

const mode = (process.env.MODE || "TEST").toUpperCase();
const dbPathOverride = process.env.DB_PATH?.trim();
const dbPathTest = process.env.DB_PATH_TEST || "./data/household-finance-test.sqlite";
const dbPathProd = process.env.DB_PATH_PROD || "./data/household-finance-prod.sqlite";

let resolved;
if (dbPathOverride) {
  resolved = resolveConfiguredPath(dbPathOverride);
} else if (mode === "PROD") {
  resolved = resolveConfiguredPath(dbPathProd);
} else {
  resolved = resolveConfiguredPath(dbPathTest);
}

process.stdout.write(`${resolved}\n`);
