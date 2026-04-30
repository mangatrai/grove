import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import archiver from "archiver";

import { qAll, qExec, qGet } from "../../db/query.js";
import { resolveDataPath } from "../../paths.js";
import { log } from "../../logger.js";
import { env } from "../../config/env.js";
import { encryptBackup } from "./backup-crypto.js";
import { queryAllExportTables } from "./export-household-bundle.service.js";

const EXPORTS_DIR = resolveDataPath("data/exports");
const EXPORT_TTL_HOURS = 48;

export type ExportJobRow = {
  id: string;
  householdId: string;
  requestedByUserId: string;
  /** Non-null for member-scoped exports; null for household-wide (owner/admin) exports. */
  personProfileId: string | null;
  status: "queued" | "running" | "complete" | "failed" | "expired";
  storagePath: string | null;
  errorText: string | null;
  createdAt: string;
  completedAt: string | null;
};

function mapRow(r: Record<string, unknown>): ExportJobRow {
  return {
    id: r.id as string,
    householdId: r.household_id as string,
    requestedByUserId: r.requested_by_user_id as string,
    personProfileId: (r.person_profile_id as string) ?? null,
    status: r.status as ExportJobRow["status"],
    storagePath: (r.storage_path as string) ?? null,
    errorText: (r.error_text as string) ?? null,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string) ?? null
  };
}

export async function queueHouseholdExport(
  householdId: string,
  userId: string,
  personProfileId?: string | null
): Promise<{ jobId: string }> {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  const jobId = randomUUID();
  const storagePath = path.join(EXPORTS_DIR, `${jobId}.hfb`);
  await qExec(
    `INSERT INTO export_job (id, household_id, requested_by_user_id, status, storage_path, person_profile_id)
     VALUES (?, ?, ?, 'queued', ?, ?)`,
    jobId,
    householdId,
    userId,
    storagePath,
    personProfileId ?? null
  );
  return { jobId };
}

export async function getExportJob(householdId: string, jobId: string): Promise<ExportJobRow | null> {
  const r = (await qGet(
    `SELECT id, household_id, requested_by_user_id, person_profile_id, status, storage_path, error_text, created_at, completed_at
       FROM export_job WHERE id = ? AND household_id = ?`,
    jobId,
    householdId
  )) as Record<string, unknown> | undefined;
  return r ? mapRow(r) : null;
}

export function scheduleExportJobProcessing(jobId: string, householdId: string): void {
  setImmediate(() => {
    void runExportJob(jobId, householdId);
  });
}

async function runExportJob(jobId: string, householdId: string): Promise<void> {
  const row = (await qGet<{ storage_path: string; person_profile_id: string | null }>(
    `SELECT storage_path, person_profile_id FROM export_job WHERE id = ? AND household_id = ?`,
    jobId,
    householdId
  )) as { storage_path: string; person_profile_id: string | null } | undefined;
  if (!row?.storage_path) {
    return;
  }
  const personProfileId = row.person_profile_id ?? null;
  await qExec(`UPDATE export_job SET status = 'running' WHERE id = ?`, jobId);
  try {
    const exportedAt = new Date().toISOString();
    const tables = await queryAllExportTables(householdId, personProfileId);

    const tableIndex: Record<string, { file: string; rows: number }> = {};
    for (const t of tables) {
      tableIndex[t.key] = { file: t.fileName, rows: t.rows.length };
    }
    const manifest: Record<string, unknown> = {
      exportVersion: 4,
      exportedAt,
      householdId,
      format: "zip-split-v4",
      encrypted: Boolean(env.BACKUP_ENCRYPTION_KEY),
      tables: tableIndex
    };
    if (personProfileId) {
      manifest["personProfileId"] = personProfileId;
      manifest["scope"] = "member";
    }

    const output = fs.createWriteStream(row.storage_path);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.pipe(output);
    const outputClosed = new Promise<void>((resolve, reject) => {
      output.once("close", () => resolve());
      output.once("error", (err) => reject(err));
    });
    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    for (const t of tables) {
      archive.append(JSON.stringify(t.rows, null, 2), { name: t.fileName });
    }
    await archive.finalize();
    await outputClosed;
    if (env.BACKUP_ENCRYPTION_KEY) {
      const plain = fs.readFileSync(row.storage_path);
      const encrypted = encryptBackup(plain, env.BACKUP_ENCRYPTION_KEY);
      fs.writeFileSync(row.storage_path, encrypted);
    }
    await qExec(
      `UPDATE export_job SET status = 'complete', completed_at = NOW(), error_text = NULL WHERE id = ?`,
      jobId
    );
    const totalRows = tables.reduce((s, t) => s + t.rows.length, 0);
    log.info(`Export job ${jobId} complete for household ${householdId}: ${tables.length} files, ${totalRows} total rows`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await qExec(`UPDATE export_job SET status = 'failed', completed_at = NOW(), error_text = ? WHERE id = ?`, msg, jobId);
    log.error(`Export job ${jobId} failed: ${msg}`);
  }
}

export type ExportDownloadFailureCode =
  | "EXPORT_JOB_NOT_FOUND"
  | "EXPORT_NOT_READY"
  | "EXPORT_MISSING_PATH"
  | "EXPORT_FILE_MISSING"
  | "EXPORT_EXPIRED";

export type ExportDownloadResult =
  | { ok: true; path: string; buffer: Buffer }
  | { ok: false; code: ExportDownloadFailureCode; jobStatus?: string; storagePath: string | null };

export async function readExportFileIfReady(householdId: string, jobId: string): Promise<ExportDownloadResult> {
  const job = await getExportJob(householdId, jobId);
  if (!job) {
    log.info(
      `Export download refused: EXPORT_JOB_NOT_FOUND jobId=${jobId} householdId=${householdId} (job row missing)`
    );
    return { ok: false, code: "EXPORT_JOB_NOT_FOUND", storagePath: null };
  }
  if (job.status === "expired") {
    log.info(`Export download refused: EXPORT_EXPIRED jobId=${jobId} (file purged after ${EXPORT_TTL_HOURS}h TTL)`);
    return { ok: false, code: "EXPORT_EXPIRED", jobStatus: job.status, storagePath: null };
  }
  if (job.status !== "complete") {
    log.info(
      `Export download refused: EXPORT_NOT_READY jobId=${jobId} status=${job.status} error=${job.errorText ?? "none"} path=${job.storagePath ?? "none"}`
    );
    return {
      ok: false,
      code: "EXPORT_NOT_READY",
      jobStatus: job.status,
      storagePath: job.storagePath
    };
  }
  if (!job.storagePath) {
    log.info(`Export download refused: EXPORT_MISSING_PATH jobId=${jobId} status=complete`);
    return { ok: false, code: "EXPORT_MISSING_PATH", jobStatus: job.status, storagePath: null };
  }
  if (!fs.existsSync(job.storagePath)) {
    log.info(`Export download refused: EXPORT_FILE_MISSING jobId=${jobId} path=${job.storagePath}`);
    return {
      ok: false,
      code: "EXPORT_FILE_MISSING",
      jobStatus: job.status,
      storagePath: job.storagePath
    };
  }
  return { ok: true, path: job.storagePath, buffer: fs.readFileSync(job.storagePath) };
}

/**
 * Delete exported backup files and mark export_job rows as 'expired' for all complete exports
 * older than EXPORT_TTL_HOURS. Safe to call repeatedly.
 */
export async function purgeExpiredExports(): Promise<void> {
  const expired = (await qAll(
    `SELECT id, storage_path FROM export_job
      WHERE status = 'complete'
        AND completed_at < NOW() - INTERVAL '${EXPORT_TTL_HOURS} hours'`
  )) as { id: string; storage_path: string | null }[];

  if (expired.length === 0) return;

  for (const row of expired) {
    if (row.storage_path) {
      try {
        fs.unlinkSync(row.storage_path);
      } catch (err: unknown) {
        // File may already be gone; log but don't block the DB update.
        log.warn(`Export purge: could not delete file ${row.storage_path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await qExec(
      `UPDATE export_job SET status = 'expired', storage_path = NULL WHERE id = ?`,
      row.id
    );
  }
  log.info(`Export purge: expired ${expired.length} export job(s) older than ${EXPORT_TTL_HOURS}h`);
}

/** Run purge on startup and every hour thereafter. */
export function startExportCleanupSchedule(): void {
  void purgeExpiredExports();
  setInterval(() => { void purgeExpiredExports(); }, 60 * 60 * 1000);
}
