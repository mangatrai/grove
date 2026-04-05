import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import archiver from "archiver";

import { qExec, qGet } from "../../db/query.js";
import { resolveDataPath } from "../../paths.js";
import { log } from "../../logger.js";
import { buildHouseholdExportBundle } from "./export-household-bundle.service.js";

const EXPORTS_DIR = resolveDataPath("data/exports");

export type ExportJobRow = {
  id: string;
  householdId: string;
  requestedByUserId: string;
  status: "queued" | "running" | "complete" | "failed";
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
    status: r.status as ExportJobRow["status"],
    storagePath: (r.storage_path as string) ?? null,
    errorText: (r.error_text as string) ?? null,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string) ?? null
  };
}

export async function queueHouseholdExport(householdId: string, userId: string): Promise<{ jobId: string }> {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  const jobId = randomUUID();
  const storagePath = path.join(EXPORTS_DIR, `${jobId}.zip`);
  await qExec(
    `INSERT INTO export_job (id, household_id, requested_by_user_id, status, storage_path)
     VALUES (?, ?, ?, 'queued', ?)`,
    jobId,
    householdId,
    userId,
    storagePath
  );
  return { jobId };
}

export async function getExportJob(householdId: string, jobId: string): Promise<ExportJobRow | null> {
  const r = (await qGet(
    `SELECT id, household_id, requested_by_user_id, status, storage_path, error_text, created_at, completed_at
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
  const row = (await qGet<{ storage_path: string }>(
    `SELECT storage_path FROM export_job WHERE id = ? AND household_id = ?`,
    jobId,
    householdId
  )) as { storage_path: string } | undefined;
  if (!row?.storage_path) {
    return;
  }
  await qExec(`UPDATE export_job SET status = 'running' WHERE id = ?`, jobId);
  try {
    const bundle = await buildHouseholdExportBundle(householdId);
    const meta = bundle as { exportVersion: number; exportedAt: string; householdId: string };
    const manifest = {
      exportVersion: meta.exportVersion,
      exportedAt: meta.exportedAt,
      householdId: meta.householdId,
      format: "zip",
      entries: ["manifest.json", "household-bundle.json"]
    };
    const output = fs.createWriteStream(row.storage_path);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.pipe(output);
    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    archive.append(JSON.stringify(bundle, null, 2), { name: "household-bundle.json" });
    await archive.finalize();
    await qExec(
      `UPDATE export_job SET status = 'complete', completed_at = NOW(), error_text = NULL WHERE id = ?`,
      jobId
    );
    log.info(`Export job ${jobId} complete for household ${householdId}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await qExec(`UPDATE export_job SET status = 'failed', completed_at = NOW(), error_text = ? WHERE id = ?`, msg, jobId);
    log.error(`Export job ${jobId} failed: ${msg}`);
  }
}

export async function readExportFileIfReady(
  householdId: string,
  jobId: string
): Promise<{ path: string; buffer: Buffer } | null> {
  const job = await getExportJob(householdId, jobId);
  if (!job) {
    log.warn(`Export download: job not found jobId=${jobId} householdId=${householdId}`);
    return null;
  }
  if (job.status !== "complete") {
    log.warn(
      `Export download: not ready jobId=${jobId} status=${job.status} error=${job.errorText ?? "none"} path=${job.storagePath ?? "none"}`
    );
    return null;
  }
  if (!job.storagePath) {
    log.warn(`Export download: missing storage_path jobId=${jobId}`);
    return null;
  }
  if (!fs.existsSync(job.storagePath)) {
    log.warn(`Export download: file missing jobId=${jobId} path=${job.storagePath}`);
    return null;
  }
  return { path: job.storagePath, buffer: fs.readFileSync(job.storagePath) };
}
