import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { GaxiosError } from "gaxios";
import { google } from "googleapis";

import { env } from "../../config/env.js";
import { qAll, qExec, qGet } from "../../db/query.js";
import { resolveDataPath } from "../../paths.js";
import { log } from "../../logger.js";
import { buildHfbFile } from "./export-job.service.js";
import { buildOAuth2Client, getGDriveCredentials } from "../gdrive/gdrive.service.js";
import { logGoogleDriveApiError } from "../gdrive/log-google-drive-api-error.js";

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

/** Maps Drive list failures after explicit 403/404 handling in `listDriveBackups`. */
function mapDriveListError(err: unknown): string {
  if (err instanceof GaxiosError) {
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
      return "Permission denied. Verify your Google account still has access to the Drive folder.";
    }
    if (status === 404) {
      return "Drive folder not found. The folder may have been deleted or the folder ID changed.";
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `Drive upload failed: ${msg}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export type ListDriveBackupsResult =
  | { ok: true; files: DriveBackupEntry[] }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "drive_error"; message: string };

type ListHfbOptions = { maxTotal?: number };

/** `TEST` or `PROD` subfolder under the household-configured Drive folder (matches `MODE`). */
function driveBackupEnvFolderName(): "TEST" | "PROD" {
  return env.MODE === "PROD" ? "PROD" : "TEST";
}

/**
 * Ensures `{configuredFolder}/{TEST|PROD}/` exists; returns that subfolder's Drive file ID.
 * All `.hfb` backups and prune/list operations use this folder, not the configured parent directly.
 */
async function ensureDriveBackupEnvSubfolderId(
  refreshToken: string,
  configuredParentFolderId: string
): Promise<string> {
  const label = driveBackupEnvFolderName();
  const oauth2Client = buildOAuth2Client(refreshToken);
  const drive = google.drive({ version: "v3", auth: oauth2Client });
  const q = `'${configuredParentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${label}' and trashed = false`;
  const listRes = await drive.files.list({
    q,
    fields: "files(id,name)",
    pageSize: 10
  });
  const found = listRes.data.files?.find((f) => f.name === label);
  if (found?.id) {
    return found.id;
  }
  const createRes = await drive.files.create({
    requestBody: {
      name: label,
      mimeType: "application/vnd.google-apps.folder",
      parents: [configuredParentFolderId]
    },
    fields: "id,name"
  });
  const id = createRes.data.id;
  if (!id) {
    throw new Error(`Could not create Drive backup folder "${label}".`);
  }
  log.info(`Drive backup: created env subfolder "${label}" (${id}) under configured folder.`);
  return id;
}

/** Lists `.hfb` files in a folder (newest first). Used by `listDriveBackups` and pruning. */
async function listHfbFilesInFolder(
  refreshToken: string,
  folderId: string,
  pageSize: number,
  opts?: ListHfbOptions
): Promise<DriveBackupEntry[]> {
  if (!/^[\w-]+$/.test(folderId)) {
    throw new Error(`Invalid folderId: ${folderId}`);
  }

  const oauth2Client = buildOAuth2Client(refreshToken);
  const drive = google.drive({ version: "v3", auth: oauth2Client });
  const all: DriveBackupEntry[] = [];
  let pageToken: string | undefined;
  const q = `'${folderId}' in parents and name contains '.hfb' and trashed = false`;
  const maxTotal = opts?.maxTotal;
  do {
    const res = await drive.files.list({
      q,
      fields: "nextPageToken, files(id,name,size,createdTime)",
      orderBy: "createdTime desc",
      pageSize: Math.min(pageSize, 1000),
      pageToken
    });
    const raw = res.data.files ?? [];
    for (const f of raw) {
      all.push({
        fileId: f.id ?? "",
        fileName: f.name ?? "",
        sizeBytes: f.size != null && f.size !== "" ? Number(f.size) : null,
        createdAt: f.createdTime ?? ""
      });
      if (maxTotal != null && all.length >= maxTotal) {
        return all.slice(0, maxTotal);
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return all;
}

export async function listDriveBackups(householdId: string): Promise<ListDriveBackupsResult> {
  const creds = await getGDriveCredentials(householdId);
  if (!creds) {
    return { ok: false, reason: "not_configured" };
  }
  try {
    const backupFolderId = await ensureDriveBackupEnvSubfolderId(creds.refreshToken, creds.folderId);
    const files = await listHfbFilesInFolder(creds.refreshToken, backupFolderId, 20, { maxTotal: 20 });
    return { ok: true, files };
  } catch (err: unknown) {
    if (err instanceof GaxiosError) {
      logGoogleDriveApiError("listDriveBackups(files.list)", err);
      const status = err.response?.status;
      if (status === 403) {
        return { ok: false, reason: "drive_error", message: "Permission denied accessing Drive folder." };
      }
      if (status === 404) {
        return { ok: false, reason: "drive_error", message: "Drive folder not found." };
      }
    }
    return { ok: false, reason: "drive_error", message: mapDriveListError(err) };
  }
}

/**
 * Download a Drive file to `destPath` (stream). On failure after a partial write,
 * removes `destPath` before rethrowing.
 */
export async function downloadDriveFile(refreshToken: string, fileId: string, destPath: string): Promise<void> {
  const oauth2Client = buildOAuth2Client(refreshToken);
  const drive = google.drive({ version: "v3", auth: oauth2Client });
  let readable: NodeJS.ReadableStream;
  try {
    const getRes = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
    readable = getRes.data as NodeJS.ReadableStream;
  } catch (err: unknown) {
    logGoogleDriveApiError(`downloadDriveFile(fileId=${fileId})`, err);
    try {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    } catch {
      /* ignore */
    }
    throw mapDriveDownloadError(err);
  }

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(destPath);
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
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
    writeStream.on("close", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    readable.pipe(writeStream);
  });
}

/**
 * Deletes oldest `.hfb` files in the folder when count exceeds `retentionCount`.
 * Swallows list/delete errors (logs warnings) so backup success is never blocked.
 */
export async function pruneOldDriveBackups(
  refreshToken: string,
  folderId: string,
  retentionCount: number
): Promise<void> {
  let files: DriveBackupEntry[];
  try {
    files = await listHfbFilesInFolder(refreshToken, folderId, 1000);
  } catch (err: unknown) {
    logGoogleDriveApiError("pruneOldDriveBackups(files.list)", err);
    log.warn(
      `Drive backup prune: list failed — ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  if (files.length <= retentionCount) {
    return;
  }
  const excess = files.slice(retentionCount);
  const oauth2Client = buildOAuth2Client(refreshToken);
  const drive = google.drive({ version: "v3", auth: oauth2Client });
  for (let i = excess.length - 1; i >= 0; i--) {
    const f = excess[i];
    if (!f.fileId) continue;
    try {
      await drive.files.delete({ fileId: f.fileId });
    } catch (delErr: unknown) {
      logGoogleDriveApiError(`pruneOldDriveBackups(files.delete fileId=${f.fileId})`, delErr);
      log.warn(
        `Drive backup prune: delete failed for ${f.fileId} — ${delErr instanceof Error ? delErr.message : String(delErr)}`
      );
    }
  }
}

export async function queueBackupJob(
  householdId: string,
  triggeredByUserId: string | null | undefined
): Promise<{ jobId: string }> {
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  const jobId = randomUUID();
  await qExec(
    `INSERT INTO backup_job (id, household_id, triggered_by_user_id) VALUES (?, ?, ?)`,
    jobId,
    householdId,
    triggeredByUserId ?? null
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

    const backupFolderId = await ensureDriveBackupEnvSubfolderId(creds.refreshToken, creds.folderId);
    const oauth2Client = buildOAuth2Client(creds.refreshToken);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const createRes = await drive.files.create({
      requestBody: { name: fileName, parents: [backupFolderId] },
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
    if (creds.backupRetentionCount > 0) {
      await pruneOldDriveBackups(creds.refreshToken, backupFolderId, creds.backupRetentionCount);
    }
  } catch (err: unknown) {
    if (err instanceof GaxiosError) {
      logGoogleDriveApiError(`Backup job ${jobId} upload(files.create) household=${householdId}`, err);
    }
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
