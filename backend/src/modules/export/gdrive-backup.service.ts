import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { GaxiosError } from "gaxios";
import { google } from "googleapis";

import { qAll, qExec, qGet } from "../../db/query.js";
import { resolveDataPath } from "../../paths.js";
import { log } from "../../logger.js";
import { buildHfbFile } from "./export-job.service.js";
import { getGDriveCredentials, type ServiceAccountKey } from "../gdrive/gdrive.service.js";

export const STAGING_DIR = resolveDataPath("data/gdrive-backup-staging");

export type DriveBackupEntry = {
  fileId: string;
  fileName: string;
  sizeBytes: number | null;
  createdAt: string;
};

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

function mapDriveListError(err: unknown): string {
  if (err instanceof GaxiosError) {
    const status = err.response?.status;
    if (status === 403) {
      return "Permission denied accessing Drive folder.";
    }
    if (status === 404) {
      return "Drive folder not found.";
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `Could not list Drive backups: ${msg}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function mapDriveDownloadError(err: unknown): Error {
  if (err instanceof GaxiosError) {
    const status = err.response?.status;
    if (status === 403) {
      return new Error("Permission denied downloading file from Drive.");
    }
    if (status === 404) {
      return new Error("Backup file not found in Drive — it may have been deleted.");
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new Error(`Drive download failed: ${msg}`);
  }
  return err instanceof Error ? err : new Error(String(err));
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

export async function listDriveBackups(
  householdId: string
): Promise<{ ok: true; files: DriveBackupEntry[] } | { ok: false; message: string }> {
  const creds = await getGDriveCredentials(householdId);
  if (!creds) {
    return { ok: false, message: "Google Drive is not configured." };
  }
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: creds.key,
      scopes: ["https://www.googleapis.com/auth/drive"]
    });
    const drive = google.drive({ version: "v3", auth });
    const res = await drive.files.list({
      q: `'${creds.folderId}' in parents and name contains '.hfb' and trashed = false`,
      fields: "files(id,name,size,createdTime)",
      orderBy: "createdTime desc",
      pageSize: 20
    });
    const raw = res.data.files ?? [];
    const files: DriveBackupEntry[] = raw.map((f) => ({
      fileId: f.id ?? "",
      fileName: f.name ?? "",
      sizeBytes: f.size != null && f.size !== "" ? Number(f.size) : null,
      createdAt: f.createdTime ?? ""
    }));
    return { ok: true, files };
  } catch (err: unknown) {
    if (err instanceof GaxiosError) {
      const status = err.response?.status;
      if (status === 403) {
        return { ok: false, message: "Permission denied accessing Drive folder." };
      }
      if (status === 404) {
        return { ok: false, message: "Drive folder not found." };
      }
    }
    return { ok: false, message: mapDriveListError(err) };
  }
}

/**
 * Download a Drive file to `destPath` (stream). On failure after a partial write,
 * removes `destPath` before rethrowing.
 */
export async function downloadDriveFile(key: ServiceAccountKey, fileId: string, destPath: string): Promise<void> {
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
  const drive = google.drive({ version: "v3", auth });
  let readable: NodeJS.ReadableStream;
  try {
    const getRes = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
    readable = getRes.data as NodeJS.ReadableStream;
  } catch (err: unknown) {
    try {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    } catch {
      /* ignore */
    }
    throw mapDriveDownloadError(err);
  }

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(destPath);
    const fail = (err: unknown) => {
      writeStream.destroy();
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    readable.on("error", fail);
    writeStream.on("error", fail);
    writeStream.on("close", () => resolve());
    readable.pipe(writeStream);
  });
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
  const tempPath = path.join(STAGING_DIR, `${jobId}.hfb`);
  try {
    const creds = await getGDriveCredentials(householdId);
    if (!creds) {
      throw new Error("Google Drive is not configured for this household.");
    }

    await buildHfbFile(householdId, null, tempPath);
    const sizeBytes = fs.statSync(tempPath).size;
    const fileName = `hf-backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.hfb`;

    const auth = new google.auth.GoogleAuth({
      credentials: creds.key,
      scopes: ["https://www.googleapis.com/auth/drive"]
    });
    const drive = google.drive({ version: "v3", auth });

    const createRes = await drive.files.create({
      requestBody: { name: fileName, parents: [creds.folderId] },
      media: { mimeType: "application/octet-stream", body: fs.createReadStream(tempPath) },
      fields: "id,name"
    });

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
    const msg =
      err instanceof GaxiosError ? mapDriveUploadError(err) : err instanceof Error ? err.message : String(err);
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
