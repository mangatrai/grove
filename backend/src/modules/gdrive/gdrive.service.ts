import { GaxiosError } from "gaxios";
import { google } from "googleapis";

import { qExec, qGet } from "../../db/query.js";
import { log } from "../../logger.js";

/** Minimum fields required from a service account JSON key file. */
export type ServiceAccountKey = {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  [key: string]: unknown;
};

export type GDriveStatus = {
  folderId: string;
  folderName: string | null;
  connectedAt: string;
  /** Present when the connecting user still exists; null after `ON DELETE SET NULL`. */
  connectedByUserId: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  backupFrequencyHours: number;
  backupRetentionCount: number;
  lastScheduledBackupAt: string | null;
};

type GDriveRow = {
  household_id: string;
  folder_id: string;
  folder_name: string | null;
  connected_at: string;
  connected_by_user_id: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  backup_frequency_hours: number;
  backup_retention_count: number;
  last_scheduled_backup_at: string | null;
};

function mapRow(r: GDriveRow): GDriveStatus {
  return {
    folderId: r.folder_id,
    folderName: r.folder_name ?? null,
    connectedAt: String(r.connected_at),
    connectedByUserId: r.connected_by_user_id,
    lastVerifiedAt: r.last_verified_at ? String(r.last_verified_at) : null,
    lastError: r.last_error ?? null,
    backupFrequencyHours: Number(r.backup_frequency_hours),
    backupRetentionCount: Number(r.backup_retention_count),
    lastScheduledBackupAt: r.last_scheduled_backup_at != null ? String(r.last_scheduled_backup_at) : null
  };
}

export function parseServiceAccountKey(
  raw: unknown
): { ok: true; key: ServiceAccountKey } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Invalid JSON: expected an object." };
  }
  const obj = raw as Record<string, unknown>;
  if (obj["type"] !== "service_account") {
    return { ok: false, message: 'Not a service account key ("type" must be "service_account").' };
  }
  for (const field of ["project_id", "private_key", "client_email"] as const) {
    if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) {
      return { ok: false, message: `Missing required field: ${field}.` };
    }
  }
  return { ok: true, key: obj as ServiceAccountKey };
}

/**
 * Authenticate with the service account and attempt to fetch the folder metadata.
 * Uses drive scope. Returns the folder display name on success.
 */
export async function testDriveConnection(
  key: ServiceAccountKey,
  folderId: string
): Promise<{ ok: true; folderName: string } | { ok: false; message: string }> {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ["https://www.googleapis.com/auth/drive"]
    });
    const drive = google.drive({ version: "v3", auth });
    const res = await drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType"
    });
    if (!res.data.id) {
      return { ok: false, message: "Folder not found or not accessible by this service account." };
    }
    if (res.data.mimeType !== "application/vnd.google-apps.folder") {
      return { ok: false, message: "The provided ID is not a folder." };
    }
    return { ok: true, folderName: res.data.name ?? folderId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`GDrive connection test failed: ${msg}`);
    const httpStatus =
      err instanceof GaxiosError
        ? err.response?.status ?? (typeof err.status === "number" ? err.status : undefined)
        : undefined;
    if (httpStatus === 404) {
      return { ok: false, message: "Folder not found. Check the folder ID and ensure the service account has access." };
    }
    if (httpStatus === 403) {
      return { ok: false, message: "Permission denied. Share the folder with the service account email and try again." };
    }
    if (msg.includes("invalid_grant") || msg.includes("Invalid JWT")) {
      return { ok: false, message: "Service account key is invalid or has been revoked." };
    }
    return { ok: false, message: `Could not connect to Google Drive: ${msg}` };
  }
}

export async function connectGDrive(
  householdId: string,
  userId: string,
  keyJson: string,
  folderId: string,
  folderName: string
): Promise<void> {
  await qExec(
    `INSERT INTO household_gdrive_config
       (household_id, service_account_json, folder_id, folder_name, connected_by_user_id, last_verified_at, last_error)
     VALUES (?, ?, ?, ?, ?, NOW(), NULL)
     ON CONFLICT (household_id) DO UPDATE SET
       service_account_json  = EXCLUDED.service_account_json,
       folder_id             = EXCLUDED.folder_id,
       folder_name           = EXCLUDED.folder_name,
       connected_at          = NOW(),
       connected_by_user_id  = EXCLUDED.connected_by_user_id,
       last_verified_at      = NOW(),
       last_error            = NULL`,
    householdId,
    keyJson,
    folderId,
    folderName,
    userId
  );
}

export async function disconnectGDrive(householdId: string): Promise<void> {
  await qExec(`DELETE FROM household_gdrive_config WHERE household_id = ?`, householdId);
}

export async function getGDriveStatus(householdId: string): Promise<GDriveStatus | null> {
  const r = await qGet<GDriveRow>(
    `SELECT household_id, folder_id, folder_name, connected_at, connected_by_user_id, last_verified_at, last_error,
            backup_frequency_hours, backup_retention_count, last_scheduled_backup_at
       FROM household_gdrive_config WHERE household_id = ?`,
    householdId
  );
  return r ? mapRow(r) : null;
}

/** Credentials plus scheduler fields for Drive backup and pruning (single DB read). */
export type GDriveCredentials = {
  key: ServiceAccountKey;
  folderId: string;
  backupFrequencyHours: number;
  backupRetentionCount: number;
  lastScheduledBackupAt: string | null;
};

/**
 * Load the stored service account credentials for a household.
 * Used by upload/restore services (CR-130, CR-131) and backup scheduler.
 * Returns null if no config exists or the stored key JSON is invalid.
 */
export async function getGDriveCredentials(householdId: string): Promise<GDriveCredentials | null> {
  const r = await qGet<{
    service_account_json: string;
    folder_id: string;
    backup_frequency_hours: number;
    backup_retention_count: number;
    last_scheduled_backup_at: string | null;
  }>(
    `SELECT service_account_json, folder_id, backup_frequency_hours, backup_retention_count, last_scheduled_backup_at
       FROM household_gdrive_config WHERE household_id = ?`,
    householdId
  );
  if (!r) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.service_account_json);
  } catch {
    return null;
  }
  const result = parseServiceAccountKey(parsed);
  if (!result.ok) return null;
  return {
    key: result.key,
    folderId: r.folder_id,
    backupFrequencyHours: Number(r.backup_frequency_hours),
    backupRetentionCount: Number(r.backup_retention_count),
    lastScheduledBackupAt: r.last_scheduled_backup_at != null ? String(r.last_scheduled_backup_at) : null
  };
}

export async function updateGDriveSchedulerSettings(
  householdId: string,
  settings: { backupFrequencyHours: number; backupRetentionCount: number }
): Promise<void> {
  await qExec(
    `UPDATE household_gdrive_config
       SET backup_frequency_hours = ?, backup_retention_count = ?
     WHERE household_id = ?`,
    settings.backupFrequencyHours,
    settings.backupRetentionCount,
    householdId
  );
}
