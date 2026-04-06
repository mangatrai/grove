#!/usr/bin/env node
/**
 * Epic 2.4 — Purge staged import files under data/imports/<sessionId>/ and clear stored_path in Postgres.
 *
 * Default: dry-run (prints actions only). Destructive runs require --execute --i-understand.
 *
 * Uses DATABASE_* from repo root .env (same as the backend).
 *
 * Usage:
 *   node scripts/purge-import-staging.mjs --all-sessions --dry-run
 *   node scripts/purge-import-staging.mjs --all-sessions --execute --i-understand
 *
 * See docs/IMPORT_STAGING_PURGE.md (may still mention SQLite in places).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

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

async function connectSql() {
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
  return postgres({
    host,
    port,
    database,
    username: user,
    password,
    max: 5,
    ssl
  });
}

async function getSessionIdsFromDb(sql) {
  const rows = await sql`SELECT id FROM import_session`;
  return new Set(rows.map((r) => r.id));
}

function printHelp() {
  console.log(`purge-import-staging.mjs — remove data/imports/<sessionId>/ and clear import_file.stored_path (Postgres)

  --session=<uuid>           One import session
  --older-than-days=<n>      Sessions with started_at older than N days
  --all-sessions             Every session id in import_session
  --orphan-dirs              Remove UUID dirs under data/imports/ not in import_session

Optional:
  --also-orphans             After main work, also run orphan-dir cleanup

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

async function runOrphanDirCleanup(sql, importsRoot, dryRun) {
  if (!fs.existsSync(importsRoot)) {
    return;
  }
  const protectedIds = await getSessionIdsFromDb(sql);
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
      console.log(`[dry-run] Would remove orphan dir (no import_session row): ${dir}`);
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`Removed orphan dir: ${dir}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
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

  loadEnvFile();
  const importsRoot = path.join(repoRoot, "data", "imports");

  const sql = await connectSql();

  try {
    if (orphanDirsOnly) {
      console.log(`Repository root: ${repoRoot}`);
      console.log(`Staging directory: ${importsRoot}`);
      console.log(`Run mode: ${dryRun ? "DRY-RUN (no changes)" : "EXECUTE"}`);
      console.log(`Orphan dirs: remove UUID folders not listed in import_session.\n`);
      await runOrphanDirCleanup(sql, importsRoot, dryRun);
      printRemainingFooter(importsRoot);
      console.log(dryRun ? "\nDry-run complete. Re-run with --execute --i-understand to apply." : "\nDone.");
      return;
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

    /** @type {string[]} */
    let sessionIds = [];

    if (sessionId) {
      const row = await sql`SELECT id FROM import_session WHERE id = ${sessionId} LIMIT 1`;
      if ([...row].length === 0) {
        console.error("No import_session row for id:", sessionId);
        process.exit(1);
      }
      sessionIds = [sessionId];
    } else if (olderThanDays != null) {
      const rows = await sql.unsafe(
        `SELECT id FROM import_session WHERE started_at < NOW() - $1::interval`,
        [`${olderThanDays} days`]
      );
      sessionIds = rows.map((r) => r.id);
    } else {
      const rows = await sql`SELECT id FROM import_session`;
      sessionIds = rows.map((r) => r.id);
    }

    console.log(`Repository root: ${repoRoot}`);
    console.log(`Staging directory: ${importsRoot}`);
    console.log(`Run mode: ${dryRun ? "DRY-RUN (no changes)" : "EXECUTE"}`);
    console.log(`Sessions targeted: ${sessionIds.length}`);
    if (alsoOrphans) {
      console.log(`Also: orphan-dir cleanup after.`);
    }
    console.log(
      "\nNote: This does NOT delete import_session / import_file / transaction rows — only files on disk and stored_path.\n"
    );

    if (sessionIds.length === 0) {
      console.log("Nothing to do for session scope (no matching sessions).");
      if (alsoOrphans) {
        await runOrphanDirCleanup(sql, importsRoot, dryRun);
      }
      printRemainingFooter(importsRoot);
      console.log(dryRun ? "\nDry-run complete." : "\nDone.");
      return;
    }

    for (const sid of sessionIds) {
      const dir = path.join(importsRoot, sid);
      const exists = fs.existsSync(dir);
      if (dryRun) {
        console.log(`[dry-run] Would remove directory: ${dir} (${exists ? "exists" : "missing"})`);
        const cntRows = await sql`SELECT COUNT(*)::int AS c FROM import_file WHERE session_id = ${sid}`;
        const cnt = Number(cntRows[0]?.c ?? 0);
        console.log(`[dry-run] Would set stored_path = NULL for ${cnt} import_file row(s) in session ${sid}`);
      } else {
        if (exists) {
          fs.rmSync(dir, { recursive: true, force: true });
          console.log(`Removed: ${dir}`);
        } else {
          console.log(`(no directory) ${dir}`);
        }
        const upd = await sql`
          UPDATE import_file SET stored_path = NULL WHERE session_id = ${sid}
        `;
        const n = Number(upd.count ?? 0);
        console.log(`Updated import_file: cleared stored_path on ${n} row(s) for session ${sid}`);
      }
    }

    if (alsoOrphans) {
      console.log("\n--- Orphan dir pass ---\n");
      await runOrphanDirCleanup(sql, importsRoot, dryRun);
    }

    printRemainingFooter(importsRoot);

    console.log(dryRun ? "\nDry-run complete. Re-run with --execute --i-understand to apply." : "\nDone.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
