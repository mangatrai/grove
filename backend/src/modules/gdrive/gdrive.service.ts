import { createHmac, timingSafeEqual } from "node:crypto";

import { GaxiosError } from "gaxios";
import { google } from "googleapis";

import { env } from "../../config/env.js";
import { qExec, qGet } from "../../db/query.js";
import { logGoogleDriveApiError } from "./log-google-drive-api-error.js";

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

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

type OAuthStatePayload = { householdId: string; userId: string; folderId: string; exp: number };

function signOAuthStatePayload(dataB64url: string): string {
  return createHmac("sha256", env.JWT_SECRET).update(dataB64url).digest("base64url");
}

/** Encode signed OAuth `state` (HMAC) so the callback cannot be forged without JWT_SECRET. */
export function encodeGDriveOAuthState(payload: { householdId: string; userId: string; folderId: string }): string {
  const body: OAuthStatePayload = {
    ...payload,
    exp: Date.now() + OAUTH_STATE_TTL_MS
  };
  const data = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const sig = signOAuthStatePayload(data);
  return `${data}.${sig}`;
}

export function decodeGDriveOAuthState(
  state: string
): { ok: true; householdId: string; userId: string; folderId: string } | { ok: false; message: string } {
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, message: "Invalid state." };
  }
  const [dataB64, sig] = parts;
  const expected = signOAuthStatePayload(dataB64);
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, message: "Invalid state signature." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, message: "Invalid state payload." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "Invalid state payload." };
  }
  const o = parsed as Record<string, unknown>;
  const householdId = typeof o.householdId === "string" ? o.householdId.trim() : "";
  const userId = typeof o.userId === "string" ? o.userId.trim() : "";
  const folderId = typeof o.folderId === "string" ? o.folderId.trim() : "";
  const exp = typeof o.exp === "number" ? o.exp : 0;
  if (!householdId || !userId || !folderId) {
    return { ok: false, message: "Invalid state fields." };
  }
  if (Date.now() > exp) {
    return { ok: false, message: "OAuth state expired. Start connect again from Settings." };
  }
  return { ok: true, householdId, userId, folderId };
}

/** Build an OAuth2Client from a stored refresh token. */
export function buildOAuth2Client(refreshToken: string): InstanceType<typeof google.auth.OAuth2> {
  const client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/** Build the Google consent URL. State is signed and includes folder + household context. */
export function buildOAuthConsentUrl(householdId: string, userId: string, folderId: string): string {
  const state = encodeGDriveOAuthState({ householdId, userId, folderId });
  const client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive"],
    state
  });
}

/** Exchange authorization code for tokens and verify folder access. */
export async function exchangeAndConnect(
  householdId: string,
  userId: string,
  code: string,
  folderId: string
): Promise<{ ok: true; folderName: string } | { ok: false; message: string }> {
  const client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  let refreshToken: string;
  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return { ok: false, message: "No refresh token returned. Disconnect and reconnect to re-authorize." };
    }
    refreshToken = tokens.refresh_token;
    client.setCredentials(tokens);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `OAuth2 code exchange failed: ${msg}` };
  }

  try {
    const drive = google.drive({ version: "v3", auth: client });
    const res = await drive.files.get({ fileId: folderId, fields: "id,name,mimeType" });
    if (res.data.mimeType !== "application/vnd.google-apps.folder") {
      return { ok: false, message: "The provided ID is not a folder." };
    }
    const folderName = res.data.name ?? folderId;
    await connectGDrive(householdId, userId, refreshToken, folderId, folderName);
    return { ok: true, folderName };
  } catch (err: unknown) {
    logGoogleDriveApiError("exchangeAndConnect(files.get folder)", err, "warn");
    const httpStatus = err instanceof GaxiosError ? err.response?.status : undefined;
    if (httpStatus === 403) {
      return { ok: false, message: "Permission denied. Share the folder with your Google account and try again." };
    }
    if (httpStatus === 404) {
      return { ok: false, message: "Folder not found. Check the folder ID." };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Could not verify folder: ${msg}` };
  }
}

export async function connectGDrive(
  householdId: string,
  userId: string,
  refreshToken: string,
  folderId: string,
  folderName: string
): Promise<void> {
  await qExec(
    `INSERT INTO household_gdrive_config
       (household_id, oauth2_refresh_token, folder_id, folder_name, connected_by_user_id, last_verified_at, last_error)
     VALUES (?, ?, ?, ?, ?, NOW(), NULL)
     ON CONFLICT (household_id) DO UPDATE SET
       oauth2_refresh_token              = EXCLUDED.oauth2_refresh_token,
       folder_id                         = EXCLUDED.folder_id,
       folder_name                       = EXCLUDED.folder_name,
       connected_at                      = NOW(),
       connected_by_user_id              = EXCLUDED.connected_by_user_id,
       last_verified_at                  = NOW(),
       last_error                        = NULL`,
    householdId,
    refreshToken,
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
  refreshToken: string;
  folderId: string;
  backupFrequencyHours: number;
  backupRetentionCount: number;
  lastScheduledBackupAt: string | null;
};

/**
 * Load stored OAuth refresh token and scheduler fields for a household.
 * Returns null if not configured or refresh token missing.
 */
export async function getGDriveCredentials(householdId: string): Promise<GDriveCredentials | null> {
  const r = await qGet<{
    oauth2_refresh_token: string | null;
    folder_id: string;
    backup_frequency_hours: number;
    backup_retention_count: number;
    last_scheduled_backup_at: string | null;
  }>(
    `SELECT oauth2_refresh_token, folder_id, backup_frequency_hours, backup_retention_count, last_scheduled_backup_at
       FROM household_gdrive_config WHERE household_id = ?`,
    householdId
  );
  if (!r) return null;
  const rt = typeof r.oauth2_refresh_token === "string" ? r.oauth2_refresh_token.trim() : "";
  if (!rt) return null;
  return {
    refreshToken: rt,
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

/** Redirect browser to SPA settings after OAuth callback (same-origin PROD or explicit public base URL). */
export function buildSettingsGdriveRedirectUrl(query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString();
  const hashPath = `/#/settings${qs ? `?${qs}` : ""}`;
  const base = env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  return base ? `${base}${hashPath}` : hashPath;
}

/** Validate OAuth callback user is owner of the household in state (defense in depth). */
export async function assertOwnerOfHousehold(userId: string, householdId: string): Promise<boolean> {
  const row = await qGet<{ role: string; household_id: string }>(
    `SELECT role, household_id FROM app_user WHERE id = ?`,
    userId
  );
  return Boolean(row && row.household_id === householdId && row.role === "owner");
}
