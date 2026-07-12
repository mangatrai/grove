import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import unzipper from "unzipper";

import { qBegin, qExec, qGet, sqlBind } from "../../db/query.js";
import { resolveDataPath } from "../../paths.js";
import { log } from "../../logger.js";
import { env } from "../../config/env.js";
import { decryptBackup, isEncryptedBackup } from "./backup-crypto.js";
import { EXPORT_REGISTRY, type ExportRow } from "./export-registry.js";
import { ExportUserFacingError } from "./export-errors.js";
import { assertRestoreInsertColumnNames, assertRestoreTableName } from "./restore-insert-validation.js";
import { createNotification } from "../notifications/notification.service.js";

export type HfbManifestPreview = {
  exportVersion: number;
  exportedAt: string;
  encrypted: boolean;
  scope: "household" | "member";
  personProfileId?: string;
  format: string;
  tables: Record<string, { rows: number }>;
  totalRows: number;
};

/**
 * Read an `.hfb` file from disk, decrypt if needed, and return the manifest preview shape.
 * Throws with a descriptive message on any failure (bad zip, missing manifest, unsupported version,
 * encrypted-no-key). Callers are responsible for deleting `filePath` after the call.
 */
export async function readHfbManifestFromFile(filePath: string): Promise<HfbManifestPreview> {
  let buffer = fs.readFileSync(filePath);
  if (isEncryptedBackup(buffer)) {
    if (!env.BACKUP_ENCRYPTION_KEY) {
      throw Object.assign(
        new Error(
          "This backup is encrypted. Configure BACKUP_ENCRYPTION_KEY on the server to preview or restore this file."
        ),
        { code: "ENCRYPTED_NO_KEY" }
      );
    }
    // Buffer.from() ensures the result is Buffer<ArrayBuffer> (NonSharedBuffer), which is
    // required by unzipper and compatible across Node 20–24 type definitions.
    buffer = Buffer.from(decryptBackup(buffer, env.BACKUP_ENCRYPTION_KEY));
  }

  let manifest: Record<string, unknown>;
  try {
    const directory = await unzipper.Open.buffer(buffer);
    const manifestEntry = directory.files.find((f) => f.path === "manifest.json");
    if (!manifestEntry) throw new Error("ZIP is missing manifest.json");
    manifest = JSON.parse((await manifestEntry.buffer()).toString("utf-8")) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read backup file: ${msg}`);
  }

  const version = Number(manifest.exportVersion);
  if (![1, 2, 3, 4].includes(version)) {
    throw new Error(`Unsupported export version: ${String(manifest.exportVersion)}`);
  }

  const rawTables = (manifest.tables ?? {}) as Record<string, { rows?: unknown }>;
  const tables = Object.fromEntries(
    Object.entries(rawTables).map(([k, v]) => [k, { rows: Number(v?.rows ?? 0) }])
  ) as Record<string, { rows: number }>;
  const totalRows = Object.values(tables).reduce((sum, t) => sum + t.rows, 0);

  return {
    exportVersion: version,
    exportedAt: String(manifest.exportedAt ?? ""),
    encrypted: Boolean(manifest.encrypted ?? false),
    scope: manifest.scope === "member" ? "member" : "household",
    personProfileId: typeof manifest.personProfileId === "string" ? manifest.personProfileId : undefined,
    format: String(manifest.format ?? ""),
    tables,
    totalRows
  };
}

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
  const dest = path.join(IMPORTS_RESTORE_DIR, `${jobId}.hfb`);
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
async function readZipEntries(data: Buffer): Promise<ZipContents> {
  const directory = await unzipper.Open.buffer(data);

  const readEntry = async (name: string): Promise<string | null> => {
    const entry = directory.files.find((f) => f.path === name);
    if (!entry) return null;
    return (await entry.buffer()).toString("utf-8");
  };

  const manifestText = await readEntry("manifest.json");
  if (!manifestText) throw new ExportUserFacingError("ZIP is missing manifest.json");
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const version = manifest.exportVersion as number;
  const tables = new Map<string, ExportRow[]>();

  if (version === 4 || version === 3) {
    // Split-file format: each table has its own JSON file listed in manifest.tables.
    const tableIndex = manifest.tables as Record<string, { file: string }> | undefined;
    if (!tableIndex)
      throw new ExportUserFacingError("manifest.json is missing 'tables' index (expected exportVersion 3/4 format)");
    for (const [key, meta] of Object.entries(tableIndex)) {
      const text = await readEntry(meta.file);
      if (text == null) throw new ExportUserFacingError(`ZIP is missing table file: ${meta.file} (table: ${key})`);
      tables.set(normalizeTableKey(key), JSON.parse(text) as ExportRow[]);
    }
  } else if (version === 1 || version === 2) {
    // Legacy single-bundle format: map bundle keys → table keys.
    const bundleText = await readEntry("household-bundle.json");
    if (!bundleText)
      throw new ExportUserFacingError("ZIP is missing household-bundle.json (expected for exportVersion 1/2)");
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
    throw new ExportUserFacingError(`Unsupported export version: ${String(version)}. Expected 1, 2, 3, or 4.`);
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

  const storagePath = row.storage_path;

  await qExec(`UPDATE import_job SET status = 'running' WHERE id = ?`, jobId);

  try {
    const rawBuffer = fs.readFileSync(storagePath);
    let zipBuffer: Buffer;
    if (isEncryptedBackup(rawBuffer)) {
      if (!env.BACKUP_ENCRYPTION_KEY) {
        throw new ExportUserFacingError(
          "This backup is encrypted but BACKUP_ENCRYPTION_KEY is not configured on this server. " +
          "Set BACKUP_ENCRYPTION_KEY to the key used when this backup was created."
        );
      }
      zipBuffer = decryptBackup(rawBuffer, env.BACKUP_ENCRYPTION_KEY);
    } else {
      zipBuffer = rawBuffer;
    }
    const { manifest, tables } = await readZipEntries(zipBuffer);

    const bundleHouseholdId = manifest.householdId as string;
    if (!bundleHouseholdId) throw new ExportUserFacingError("manifest.json is missing householdId");

    function remap<T extends Record<string, unknown>>(r: T): T {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(r)) {
        out[key] = r[key] === bundleHouseholdId ? householdId : r[key];
      }
      return out as T;
    }

    const stats: ImportStats = {};
    const ordered = [...EXPORT_REGISTRY].sort((a, b) => a.restoreOrder - b.restoreOrder);
    // Defense-in-depth (SEC #187): tableName always comes from EXPORT_REGISTRY, never the
    // uploaded file, but assert it against an allowlist before any interpolation regardless.
    const knownTableNames = new Set(EXPORT_REGISTRY.map((e) => e.tableName));
    for (const entry of ordered) {
      assertRestoreTableName(entry.tableName, knownTableNames);
    }
    let deferredHouseholdFks:
      | { owner_user_id: string | null; salary_deposit_financial_account_id: string | null }
      | null = null;

    await qBegin(async (tx) => {
      const txExec = async (sqlStr: string, ...params: unknown[]): Promise<void> => {
        const { text, values } = sqlBind(sqlStr, params);
        await tx.unsafe(text, values as never[]);
      };
      const txInsertObject = async (tableName: string, objectRow: ExportRow): Promise<void> => {
        assertRestoreInsertColumnNames(tableName, objectRow);
        const columns = Object.keys(objectRow);
        if (columns.length === 0) {
          return;
        }
        const placeholders = columns.map(() => "?").join(", ");
        const values = columns.map((column) => objectRow[column]);
        await txExec(
          `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
          ...values
        );
      };

      // Break household-level FKs before deleting referenced rows.
      await txExec(
        `UPDATE household
         SET owner_user_id = NULL,
             salary_deposit_financial_account_id = NULL
         WHERE id = ?`,
        householdId
      );
      // Ephemeral import pipeline rows are not restored; clear them first to avoid
      // FKs from import_file.financial_account_id blocking financial_account deletes.
      await txExec(
        `DELETE FROM transaction_raw
         WHERE file_id IN (
           SELECT f.id
           FROM import_file f
           JOIN import_session s ON s.id = f.session_id
           WHERE s.household_id = ?
         )`,
        householdId
      );
      await txExec(
        `DELETE FROM import_file
         WHERE session_id IN (
           SELECT id
           FROM import_session
           WHERE household_id = ?
         )`,
        householdId
      );
      await txExec(`DELETE FROM import_session WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM export_job WHERE household_id = ?`, householdId);
      await txExec(`DELETE FROM import_job WHERE household_id = ? AND id <> ?`, householdId, jobId);
      await txExec(`DELETE FROM insight_job WHERE household_id = ?`, householdId);

      for (const entry of [...ordered].reverse()) {
        if (entry.skipInsert) {
          continue;
        }
        if (entry.tableName === "app_user") {
          await txExec(
            `DELETE FROM app_user WHERE household_id = ? AND id <> ?`,
            householdId,
            row.requested_by_user_id
          );
          continue;
        }
        await txExec(
          `DELETE FROM ${entry.tableName} WHERE ${entry.householdIdColumn} = ?`,
          householdId
        );
      }

      for (const entry of ordered) {
        const sourceRows = tables.get(entry.tableKey);
        if (!sourceRows) {
          stats[entry.tableKey] = 0;
          continue;
        }
        const remappedRows = sourceRows.map((entryRow) => remap(entryRow));
        if (entry.tableName === "household" && remappedRows[0]) {
          deferredHouseholdFks = {
            owner_user_id: (remappedRows[0].owner_user_id as string | null) ?? null,
            salary_deposit_financial_account_id:
              (remappedRows[0].salary_deposit_financial_account_id as string | null) ?? null
          };
        }
        let rows = remappedRows;
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
              assertRestoreInsertColumnNames(entry.tableName, next);
              const updateColumns = Object.keys(next);
              const updateSet = updateColumns.map((column) => `${column} = ?`).join(", ");
              const updateValues = updateColumns.map((column) => next[column]);
              await txExec(
                `UPDATE ${entry.tableName} SET ${updateSet} WHERE ${entry.householdIdColumn} = ?`,
                ...updateValues,
                householdId
              );
            }
          }
          stats[entry.tableKey] = rows.length;
          continue;
        }

        for (const row of rows) {
          if (entry.tableName === "app_user") {
            assertRestoreInsertColumnNames("app_user", row);
            const updateRow = { ...row };
            delete updateRow.id;
            const insertColumns = Object.keys(row);
            const insertValues = insertColumns.map((column) => row[column]);
            const updateColumns = Object.keys(updateRow);
            const updateSet = updateColumns.map((column) => `${column} = ?`).join(", ");
            const updateValues = updateColumns.map((column) => updateRow[column]);
            await txExec(
              `INSERT INTO app_user (${insertColumns.join(", ")})
               VALUES (${insertColumns.map(() => "?").join(", ")})
               ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
              ...insertValues,
              ...updateValues
            );
            continue;
          }
          await txInsertObject(entry.tableName, row);
        }
        stats[entry.tableKey] = rows.length;
      }

      if (deferredHouseholdFks) {
        await txExec(
          `UPDATE household
           SET owner_user_id = ?,
               salary_deposit_financial_account_id = ?
           WHERE id = ?`,
          deferredHouseholdFks.owner_user_id,
          deferredHouseholdFks.salary_deposit_financial_account_id,
          householdId
        );
      }

      // Force all household members to reset their password after a restore —
      // the backup may contain stale credentials.
      await txExec(
        `UPDATE app_user SET force_password_change = true WHERE household_id = ?`,
        householdId
      );
    });

    await qExec(
      `UPDATE import_job SET status = 'complete', completed_at = NOW(), stats_json = ?, error_text = NULL WHERE id = ?`,
      JSON.stringify(stats),
      jobId
    );
    log.info(`Import job ${jobId} complete for household ${householdId}: ${JSON.stringify(stats)}`);
    void createNotification({
      householdId,
      type: "restore_complete",
      title: "Household restore complete",
      body: "Your household data has been restored from backup. Please log in again to continue.",
      actionUrl: "/dashboard"
    });
  } catch (err: unknown) {
    // Only ExportUserFacingError messages (deliberately worded, no internals) are safe to persist
    // and return to the client; anything else is replaced with a generic message (SEC #188).
    // Full detail always reaches the server-side log below regardless.
    const safeMsg =
      err instanceof ExportUserFacingError
        ? err.message
        : "Job failed due to a system error. Check server logs for details.";
    await qExec(
      `UPDATE import_job SET status = 'failed', completed_at = NOW(), error_text = ? WHERE id = ?`,
      safeMsg,
      jobId
    );
    log.error("Import job failed", { jobId, householdId, err });
  } finally {
    try {
      await fsp.unlink(storagePath);
    } catch {
      /* ignore */
    }
  }
}
