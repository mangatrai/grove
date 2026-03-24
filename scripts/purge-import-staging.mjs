#!/usr/bin/env node
/**
 * Epic 2.4 — Purge staged import files under data/imports/<sessionId>/ and clear stored_path in DB.
 *
 * Default: dry-run (prints actions only). Destructive runs require --execute --i-understand.
 *
 * IMPORTANT: TEST and PROD use different SQLite files but the SAME data/imports/ tree. Use
 *   --mode=PROD   or   --mode=TEST   to match the database where your sessions live (see .env MODE).
 *
 * Usage:
 *   node scripts/purge-import-staging.mjs --all-sessions --dry-run
 *   node scripts/purge-import-staging.mjs --mode=PROD --all-sessions --execute --i-understand
 *   node scripts/purge-import-staging.mjs --orphan-dirs --dry-run
 *
 * See docs/IMPORT_STAGING_PURGE.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/** Loose UUID folder names (session ids). */
const UUID_DIR =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function resolveDbPath() {
  const mode = (process.env.MODE || "TEST").toUpperCase();
  if (process.env.DB_PATH) {
    const p = process.env.DB_PATH;
    return path.isAbsolute(p) ? p : path.join(repoRoot, p);
  }
  const rel =
    mode === "PROD"
      ? process.env.DB_PATH_PROD || "data/household-finance-prod.sqlite"
      : process.env.DB_PATH_TEST || "data/household-finance-test.sqlite";
  return path.join(repoRoot, rel.replace(/^\.\//, ""));
}

/** Session ids that exist in either test or prod DB (same disk tree for both). */
function getSessionIdsUnionFromBothDbs() {
  const paths = [
    path.join(repoRoot, "data", "household-finance-test.sqlite"),
    path.join(repoRoot, "data", "household-finance-prod.sqlite")
  ];
  const set = new Set();
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      continue;
    }
    const db = new Database(p);
    try {
      const rows = db.prepare(`SELECT id FROM import_session`).all();
      for (const r of rows) {
        set.add(r.id);
      }
    } finally {
      db.close();
    }
  }
  return set;
}

/**
 * Remove UUID-named dirs under imports/ that are not import_session ids in ANY local DB file.
 * Does not touch `custom/` (reserved). Does not update DB (orphans have no session row here).
 */
function runOrphanDirCleanup(importsRoot, dryRun) {
  if (!fs.existsSync(importsRoot)) {
    return;
  }
  const protectedIds = getSessionIdsUnionFromBothDbs();
  const entries = fs.readdirSync(importsRoot, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) {
      continue;
    }
    const name = ent.name;
    if (name === "custom") {
      continue;
    }
    if (!UUID_DIR.test(name)) {
      continue;
    }
    if (protectedIds.has(name)) {
      continue;
    }
    const dir = path.join(importsRoot, name);
    if (dryRun) {
      console.log(`[dry-run] Would remove orphan dir (no import_session in test/prod DB): ${dir}`);
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`Removed orphan dir: ${dir}`);
    }
  }
}

function printHelp() {
  console.log(`purge-import-staging.mjs — remove data/imports/<sessionId>/ and clear import_file.stored_path

TEST and PROD use different SQLite files but the SAME data/imports/ folder. If your imports are in
the prod DB, you must use  --mode=PROD  or imports will look "invisible" to this script.

  --mode=TEST|PROD       Override MODE for which database file to use (default: .env MODE)

Scope (pick exactly one, unless using --orphan-dirs as the only scope):
  --session=<uuid>           One import session
  --older-than-days=<n>      Sessions with started_at older than N days
  --all-sessions             Every session id in import_session (for the selected DB only)
  --orphan-dirs              Only remove UUID-named dirs under data/imports/ that are NOT in
                             either test or prod import_session (safe for shared disk tree)

Optional after a main scope (not with --orphan-dirs-only duplicate):
  --also-orphans             After main work, also run orphan-dir cleanup (same as --orphan-dirs logic)

Mode:
  --dry-run                  Print actions only (default if --execute not passed)
  --execute                  Actually delete files and update DB (requires --i-understand)
  --i-understand             Required with --execute

  --help                     This message
`);
}

function printRemainingFooter(importsRoot) {
  if (!fs.existsSync(importsRoot)) {
    console.log(`\n${importsRoot} does not exist.`);
    return;
  }
  const remaining = fs
    .readdirSync(importsRoot)
    .filter((n) => n !== ".DS_Store" && !n.startsWith("."));
  if (remaining.length > 0) {
    console.log(
      `\nStill present under ${importsRoot} (${remaining.length}): ${remaining.join(", ")}`
    );
    if (remaining.includes("custom")) {
      console.log('(Folder "custom" is reserved — not removed by this script.)');
    }
  } else {
    console.log(`\n${importsRoot} has no session subfolders left (except dotfiles).`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  let cliMode = null;
  for (const a of args) {
    if (a.startsWith("--mode=")) {
      cliMode = a.slice("--mode=".length).trim().toUpperCase();
      if (cliMode !== "TEST" && cliMode !== "PROD") {
        console.error("Error: --mode must be TEST or PROD");
        process.exit(1);
      }
    }
  }

  loadEnvFile();
  if (cliMode) {
    process.env.MODE = cliMode;
  }

  let dryRun = true;
  let execute = false;
  let confirmed = false;
  let sessionId = null;
  let olderThanDays = null;
  let allSessions = false;
  let orphanDirsOnly = false;
  let alsoOrphans = false;

  for (const a of args) {
    if (a === "--execute") {
      execute = true;
      dryRun = false;
    }
    if (a === "--dry-run") {
      dryRun = true;
      execute = false;
    }
    if (a === "--i-understand") {
      confirmed = true;
    }
    if (a.startsWith("--session=")) {
      sessionId = a.slice("--session=".length).trim();
    }
    if (a.startsWith("--older-than-days=")) {
      olderThanDays = Number.parseInt(a.slice("--older-than-days=".length).trim(), 10);
    }
    if (a === "--all-sessions") {
      allSessions = true;
    }
    if (a === "--orphan-dirs") {
      orphanDirsOnly = true;
    }
    if (a === "--also-orphans") {
      alsoOrphans = true;
    }
  }

  if (execute && !confirmed) {
    console.error("Error: --execute requires --i-understand (read docs/IMPORT_STAGING_PURGE.md first).");
    process.exit(1);
  }

  if (orphanDirsOnly && alsoOrphans) {
    console.error("Error: use either --orphan-dirs alone or --also-orphans with another scope.");
    process.exit(1);
  }

  const importsRoot = path.join(repoRoot, "data", "imports");

  if (orphanDirsOnly) {
    const modeEffective = (process.env.MODE || "TEST").toUpperCase();
    console.log(`Repository root: ${repoRoot}`);
    console.log(`MODE (from .env / --mode): ${modeEffective}`);
    console.log(`Staging directory: ${importsRoot}`);
    console.log(`Run mode: ${dryRun ? "DRY-RUN (no changes)" : "EXECUTE"}`);
    console.log(`Orphan dirs: remove UUID folders not listed in import_session in EITHER test or prod DB.\n`);
    runOrphanDirCleanup(importsRoot, dryRun);
    printRemainingFooter(importsRoot);
    console.log(dryRun ? "\nDry-run complete. Re-run with --execute --i-understand to apply." : "\nDone.");
    process.exit(0);
  }

  const mainScopes = [
    sessionId,
    olderThanDays != null && !Number.isNaN(olderThanDays),
    allSessions
  ].filter(Boolean).length;
  if (mainScopes !== 1) {
    console.error("Error: specify exactly one of --session=UUID | --older-than-days=N | --all-sessions");
    printHelp();
    process.exit(1);
  }

  if (olderThanDays != null && (Number.isNaN(olderThanDays) || olderThanDays < 0)) {
    console.error("Error: --older-than-days must be a non-negative integer.");
    process.exit(1);
  }

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error("Database file not found:", dbPath);
    process.exit(1);
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  /** @type {string[]} */
  let sessionIds = [];

  if (sessionId) {
    const row = db.prepare(`SELECT id FROM import_session WHERE id = ?`).get(sessionId);
    if (!row) {
      console.error("No import_session row for id:", sessionId);
      db.close();
      process.exit(1);
    }
    sessionIds = [sessionId];
  } else if (olderThanDays != null) {
    sessionIds = db
      .prepare(
        `SELECT id FROM import_session
         WHERE datetime(started_at) < datetime('now', '-' || CAST(? AS TEXT) || ' days')`
      )
      .all(String(olderThanDays))
      .map((r) => r.id);
  } else {
    sessionIds = db.prepare(`SELECT id FROM import_session`).all().map((r) => r.id);
  }

  const modeEffective = (process.env.MODE || "TEST").toUpperCase();
  console.log(`Repository root: ${repoRoot}`);
  console.log(`MODE (for DB path): ${modeEffective}`);
  console.log(`Database file: ${dbPath}`);
  console.log(`Staging directory (session dirs deleted here): ${importsRoot}`);
  console.log(`Run mode: ${dryRun ? "DRY-RUN (no changes)" : "EXECUTE"}`);
  console.log(`Sessions from THIS database targeted: ${sessionIds.length}`);
  if (alsoOrphans) {
    console.log(`Also: orphan-dir cleanup after (UUID dirs not in test or prod import_session).`);
  }
  console.log(
    "\nNote: This does NOT delete import_session / import_file / transaction rows — only files on disk and stored_path in THIS database.\n"
  );

  if (sessionIds.length === 0) {
    console.log("Nothing to do for session scope (no matching sessions).");
    db.close();
    if (alsoOrphans) {
      runOrphanDirCleanup(importsRoot, dryRun);
    }
    printRemainingFooter(importsRoot);
    console.log(dryRun ? "\nDry-run complete." : "\nDone.");
    process.exit(0);
  }

  const clearStmt = db.prepare(`UPDATE import_file SET stored_path = NULL WHERE session_id = ?`);

  for (const sid of sessionIds) {
    const dir = path.join(importsRoot, sid);
    const exists = fs.existsSync(dir);
    if (dryRun) {
      console.log(`[dry-run] Would remove directory: ${dir} (${exists ? "exists" : "missing"})`);
      const cnt = db.prepare(`SELECT COUNT(*) AS c FROM import_file WHERE session_id = ?`).get(sid).c;
      console.log(`[dry-run] Would set stored_path = NULL for ${cnt} import_file row(s) in session ${sid}`);
    } else {
      if (exists) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`Removed: ${dir}`);
      } else {
        console.log(`(no directory) ${dir}`);
      }
      const info = clearStmt.run(sid);
      console.log(`Updated import_file: cleared stored_path on ${info.changes} row(s) for session ${sid}`);
    }
  }

  db.close();

  if (alsoOrphans) {
    console.log("\n--- Orphan dir pass ---\n");
    runOrphanDirCleanup(importsRoot, dryRun);
  }

  printRemainingFooter(importsRoot);

  console.log(dryRun ? "\nDry-run complete. Re-run with --execute --i-understand to apply." : "\nDone.");
}

main();
