import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import unzipper from "unzipper";

import { qBegin, qExec, qGet } from "../../db/query.js";
import { resolveDataPath } from "../../paths.js";
import { log } from "../../logger.js";
import { EXPORT_REGISTRY, type ExportRow } from "./export-registry.js";

const IMPORTS_RESTORE_DIR = resolveDataPath("data/imports-restore");

export type ImportJobRow = {
  id: string;
  householdId: string;
  requestedByUserId: string;
  status: "queued" | "running" | "complete" | "failed";
  storagePath: string | null;
  errorText: string | null;
  statsJson: string | null;
  createdAt: string;
  completedAt: string | null;
};

/** Counts of rows restored per table, returned on completion. */
export type ImportStats = Record<string, number>;

function mapRow(r: Record<string, unknown>): ImportJobRow {
  return {
    id: r.id as string,
    householdId: r.household_id as string,
    requestedByUserId: r.requested_by_user_id as string,
    status: r.status as ImportJobRow["status"],
    storagePath: (r.storage_path as string) ?? null,
    errorText: (r.error_text as string) ?? null,
    statsJson: (r.stats_json as string) ?? null,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string) ?? null
  };
}

export async function queueHouseholdImport(
  householdId: string,
  userId: string,
  uploadedPath: string
): Promise<{ jobId: string }> {
  fs.mkdirSync(IMPORTS_RESTORE_DIR, { recursive: true });
  const jobId = randomUUID();
  const dest = path.join(IMPORTS_RESTORE_DIR, `${jobId}.zip`);
  fs.renameSync(uploadedPath, dest);
  await qExec(
    `INSERT INTO import_job (id, household_id, requested_by_user_id, status, storage_path)
     VALUES (?, ?, ?, 'queued', ?)`,
    jobId,
    householdId,
    userId,
    dest
  );
  return { jobId };
}

export async function getImportJob(householdId: string, jobId: string): Promise<ImportJobRow | null> {
  const r = (await qGet(
    `SELECT id, household_id, requested_by_user_id, status, storage_path, error_text, stats_json, created_at, completed_at
       FROM import_job WHERE id = ? AND household_id = ?`,
    jobId,
    householdId
  )) as Record<string, unknown> | undefined;
  return r ? mapRow(r) : null;
}

export function scheduleImportJobProcessing(jobId: string, householdId: string): void {
  setImmediate(() => {
    void runImportJob(jobId, householdId);
  });
}

/** Parsed ZIP contents, normalised to per-table maps regardless of export version. */
type ZipContents = {
  manifest: Record<string, unknown>;
  tables: Map<string, ExportRow[]>;
};

const TABLE_KEY_ALIASES: Record<string, string> = {
  users: "app_user",
  accounts: "financial_account",
  categories: "category",
  category_rules: "category_rule",
  transactions: "transaction_canonical",
  person_profiles: "person_profile",
  memberships: "household_membership",
  balance_snapshots: "account_balance_snapshot",
  payslips: "payslip_snapshot",
  custom_institutions: "household_custom_institution"
};

function normalizeTableKey(tableKey: string): string {
  return TABLE_KEY_ALIASES[tableKey] ?? tableKey;
}

/**
 * Read the ZIP and return normalised table data.
 * Supports exportVersion 4/3 (split files) and versions 1/2 (single household-bundle.json).
 */
async function readZipEntries(zipPath: string): Promise<ZipContents> {
  const directory = await unzipper.Open.file(zipPath);

  const readEntry = async (name: string): Promise<string | null> => {
    const entry = directory.files.find((f) => f.path === name);
    if (!entry) return null;
    return (await entry.buffer()).toString("utf-8");
  };

  const manifestText = await readEntry("manifest.json");
  if (!manifestText) throw new Error("ZIP is missing manifest.json");
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const version = manifest.exportVersion as number;
  const tables = new Map<string, Row[]>();

  if (version === 4 || version === 3) {
    // Split-file format: each table has its own JSON file listed in manifest.tables.
    const tableIndex = manifest.tables as Record<string, { file: string }> | undefined;
    if (!tableIndex) throw new Error("manifest.json is missing 'tables' index (expected exportVersion 3/4 format)");
    for (const [key, meta] of Object.entries(tableIndex)) {
      const text = await readEntry(meta.file);
      if (text == null) throw new Error(`ZIP is missing table file: ${meta.file} (table: ${key})`);
      tables.set(normalizeTableKey(key), JSON.parse(text) as ExportRow[]);
    }
  } else if (version === 1 || version === 2) {
    // Legacy single-bundle format: map bundle keys → table keys.
    const bundleText = await readEntry("household-bundle.json");
    if (!bundleText) throw new Error("ZIP is missing household-bundle.json (expected for exportVersion 1/2)");
    const bundle = JSON.parse(bundleText) as Record<string, unknown>;
    const legacyMap: Record<string, string> = {
      household: "household",
      appUsers: "app_user",
      financialAccounts: "financial_account",
      categories: "category",
      categoryRulesHousehold: "category_rule",
      transactionCanonical: "transaction_canonical",
      personProfiles: "person_profile",
      householdMemberships: "household_membership",
      accountBalanceSnapshots: "account_balance_snapshot",
      payslipSnapshots: "payslip_snapshot",
      householdCustomInstitutions: "household_custom_institution"
    };
    for (const [bundleKey, tableKey] of Object.entries(legacyMap)) {
      const val = bundle[bundleKey];
      if (bundleKey === "household") {
        tables.set(tableKey, val ? [val as ExportRow] : []);
      } else {
        tables.set(tableKey, (val as ExportRow[] | undefined) ?? []);
      }
    }
  } else {
    throw new Error(`Unsupported export version: ${String(version)}. Expected 1, 2, 3, or 4.`);
  }

  return { manifest, tables };
}

async function runImportJob(jobId: string, householdId: string): Promise<void> {
  const row = (await qGet<{ storage_path: string; requested_by_user_id: string }>(
    `SELECT storage_path, requested_by_user_id FROM import_job WHERE id = ? AND household_id = ?`,
    jobId,
    householdId
  )) as { storage_path: string; requested_by_user_id: string } | undefined;
  if (!row?.storage_path) return;

  await qExec(`UPDATE import_job SET status = 'running' WHERE id = ?`, jobId);

  try {
    const { manifest, tables } = await readZipEntries(row.storage_path);

    const bundleHouseholdId = manifest.householdId as string;
    if (!bundleHouseholdId) throw new Error("manifest.json is missing householdId");

    function remap<T extends Record<string, unknown>>(r: T): T {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(r)) {
        out[key] = r[key] === bundleHouseholdId ? householdId : r[key];
      }
      return out as T;
    }

    const stats: ImportStats = {};
    const ordered = [...EXPORT_REGISTRY].sort((a, b) => a.restoreOrder - b.restoreOrder);

    await qBegin(async (tx) => {
      // Break household-level FKs before deleting referenced rows.
      await tx`UPDATE household
               SET owner_user_id = NULL,
                   salary_deposit_financial_account_id = NULL
               WHERE id = ${householdId}`;
      await tx`DELETE FROM export_job WHERE household_id = ${householdId}`;
      await tx`DELETE FROM import_job WHERE household_id = ${householdId} AND id <> ${jobId}`;
      await tx`DELETE FROM insight_job WHERE household_id = ${householdId}`;

      for (const entry of [...ordered].reverse()) {
        if (entry.skipInsert) {
          continue;
        }
        if (entry.tableName === "app_user") {
          await tx`DELETE FROM app_user WHERE household_id = ${householdId} AND id <> ${row.requested_by_user_id}`;
          continue;
        }
        await tx`DELETE FROM ${tx(entry.tableName)} WHERE ${tx(entry.householdIdColumn)} = ${householdId}`;
      }

      for (const entry of ordered) {
        const sourceRows = tables.get(entry.tableKey);
        if (!sourceRows) {
          stats[entry.tableKey] = 0;
          continue;
        }
        let rows = sourceRows.map((row) => remap(row));
        if (entry.parentFirst) {
          rows = rows.sort((a, b) => {
            const aParent = a.parent_id == null ? 0 : 1;
            const bParent = b.parent_id == null ? 0 : 1;
            return aParent - bParent;
          });
        }
        if (entry.onRestore) {
          rows = rows.map((row) => entry.onRestore!(row));
        }

        if (entry.skipInsert) {
          if (rows[0]) {
            const first = rows[0];
            const next = { ...first };
            delete next[entry.householdIdColumn];
            if (Object.keys(next).length > 0) {
              await tx`UPDATE ${tx(entry.tableName)} SET ${tx(next)} WHERE ${tx(entry.householdIdColumn)} = ${householdId}`;
            }
          }
          stats[entry.tableKey] = rows.length;
          continue;
        }

        for (const row of rows) {
          if (entry.tableName === "app_user") {
            const updateRow = { ...row };
            delete updateRow.id;
            await tx`INSERT INTO app_user ${tx(row)}
                     ON CONFLICT (id) DO UPDATE SET ${tx(updateRow)}`;
            continue;
          }
          await tx`INSERT INTO ${tx(entry.tableName)} ${tx(row)}`;
        }
        stats[entry.tableKey] = rows.length;
      }
    });

    await qExec(
      `UPDATE import_job SET status = 'complete', completed_at = NOW(), stats_json = ?, error_text = NULL WHERE id = ?`,
      JSON.stringify(stats),
      jobId
    );
    log.info(`Import job ${jobId} complete for household ${householdId}: ${JSON.stringify(stats)}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await qExec(`UPDATE import_job SET status = 'failed', completed_at = NOW(), error_text = ? WHERE id = ?`, msg, jobId);
    log.error(`Import job ${jobId} failed: ${msg}`);
  }
}
