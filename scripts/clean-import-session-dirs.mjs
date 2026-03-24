#!/usr/bin/env node
/**
 * Remove UUID-named session directories under data/imports/ (never touches `custom/`).
 * Used before backend tests (prep-test-db) and after (vitest globalTeardown) to avoid
 * unbounded disk growth from integration tests.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UUID_DIR =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanImportSessionDirs() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..");
  const importsRoot = path.join(repoRoot, "data", "imports");
  if (!fs.existsSync(importsRoot)) {
    return;
  }
  for (const name of fs.readdirSync(importsRoot)) {
    if (name === "custom" || name.startsWith(".")) {
      continue;
    }
    if (!UUID_DIR.test(name)) {
      continue;
    }
    const dir = path.join(importsRoot, name);
    try {
      if (fs.statSync(dir).isDirectory()) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // best-effort
    }
  }
}

/** Vitest globalTeardown */
export default async function teardown() {
  cleanImportSessionDirs();
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  cleanImportSessionDirs();
}
