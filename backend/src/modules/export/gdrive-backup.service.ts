import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { GaxiosError } from "gaxios";
import { google } from "googleapis";

import { qAll, qExec, qGet } from "../../db/query.js";
import { resolveDataPath } from "../../paths.js";
import { log } from "../../logger.js";
import { buildHfbFile } from "./export-job.service.js";
import { getGDriveCredentials } from "../gdrive/gdrive.service.js";

const STAGING_DIR = resolveDataPath("data/gdrive-backup-staging");

export type BackupJobRow = {
  id: string;
  householdId: string;
  status: "queued" | "running" | "complete" | "failed";
  driveFileId: string | null;
  driveFileName: string | null;
  sizeBytes: number | null;
  errorText: string | null;
  triggeredByUserId: string | null;
  createdAt: string;
  completedAt: string | null;
};

function mapBackupRow(r: Record<string, unknown>): BackupJobRow {
  return {
    id: r.id as string,
    householdId: r.household_id as string,
    status: r.status as BackupJobRow["status"],
    driveFileId: (r.drive_file_id as string) ?? null,
    driveFileName: (r.drive_file_name as string) ?? null,
    sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    errorText: (r.error_text as string) ?? null,
    triggeredByUserId: (r.triggered_by_user_id as string) ?? null,
    createdAt: String(r.created_at),
    completedAt: r.completed_at != null ? String(r.completed_at) : null
  };
}

function mapDriveUploadError(err: unknown): string {
  if (err instanceof GaxiosError) {
    const status = err.response?.status;
    if (status === 403) {
      return "Permission denied. Verify the service account still has Editor access to the Drive folder.";
    }
    if (status === 404) {
      return "Drive folder not found. The folder may have been deleted or the folder ID changed.";
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `Drive upload failed: ${msg}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function queueBackupJob(householdId: string, userId: string): Promise<{ jobId: string }> {
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  const jobId = randomUUID();
  await qExec(
    `INSERT INTO backup_job (id, household_id, triggered_by_user_id) VALUES (?, ?, ?)`,
    jobId,
    householdId,
    userId
  );
  return { jobId };
}

export function scheduleBackupJobProcessing(jobId: string, householdId: string): void {
  setImmediate(() => {
    void runBackupJob(jobId, householdId);
  });
}

async function runBackupJob(jobId: string, householdId: string): Promise<void> {
  await qExec(`UPDATE backup_job SET status = 'running' WHERE id = ?`, jobId);
  const creds = await getGDriveCredentials(householdId);
  if (!creds) {
    const msg = "Google Drive is not configured for this household.";
    await qExec(
      `UPDATE backup_job SET status = 'failed', completed_at = NOW(), error_text = ? WHERE id = ?`,
      msg,
      jobId
    );
    log.error(`Backup job ${jobId} failed: ${msg}`);
    return;
  }

  const tempPath = path.join(STAGING_DIR, `${jobId}.hfb`);
  try {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    await buildHfbFile(householdId, null, tempPath);
    const sizeBytes = fs.statSync(tempPath).size;
    const fileName = `hf-backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.hfb`;

    const auth = new google.auth.GoogleAuth({
      credentials: creds.key,
      scopes: ["https://www.googleapis.com/auth/drive"]
    });
    const drive = google.drive({ version: "v3", auth });

    let createRes: { data: { id?: string | null; name?: string | null } };
    try {
      createRes = await drive.files.create({
        requestBody: { name: fileName, parents: [creds.folderId] },
        media: { mimeType: "application/octet-stream", body: fs.createReadStream(tempPath) },
        fields: "id,name"
      });
    } catch (err: unknown) {
      const msg = mapDriveUploadError(err);
      await qExec(
        `UPDATE backup_job SET status = 'failed', completed_at = NOW(), error_text = ? WHERE id = ?`,
        msg,
        jobId
      );
      log.error(`Backup job ${jobId} failed: ${msg}`);
      return;
    }

    const driveFileId = createRes.data.id ?? null;
    const driveFileName = createRes.data.name ?? fileName;
    await qExec(
      `UPDATE backup_job SET status = 'complete', completed_at = NOW(), drive_file_id = ?, drive_file_name = ?, size_bytes = ?, error_text = NULL WHERE id = ?`,
      driveFileId,
      driveFileName,
      sizeBytes,
      jobId
    );
    log.info(`Backup job ${jobId} complete for household ${householdId}: uploaded ${driveFileName}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await qExec(
      `UPDATE backup_job SET status = 'failed', completed_at = NOW(), error_text = ? WHERE id = ?`,
      msg,
      jobId
    );
    log.error(`Backup job ${jobId} failed: ${msg}`);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* already gone */
    }
  }
}

export async function getBackupJob(householdId: string, jobId: string): Promise<BackupJobRow | null> {
  const r = await qGet<Record<string, unknown>>(
    `SELECT id, household_id, status, drive_file_id, drive_file_name, size_bytes, error_text, triggered_by_user_id, created_at, completed_at
       FROM backup_job WHERE id = ? AND household_id = ?`,
    jobId,
    householdId
  );
  return r ? mapBackupRow(r) : null;
}

export async function getRecentBackupJobs(householdId: string, limit = 10): Promise<BackupJobRow[]> {
  const rows = await qAll<Record<string, unknown>>(
    `SELECT id, household_id, status, drive_file_id, drive_file_name, size_bytes, error_text, triggered_by_user_id, created_at, completed_at
       FROM backup_job WHERE household_id = ? ORDER BY created_at DESC LIMIT ?`,
    householdId,
    limit
  );
  return rows.map(mapBackupRow);
}
