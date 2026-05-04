import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { env } from "../../config/env.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import {
  assertOwnerOfHousehold,
  buildOAuthConsentUrl,
  buildSettingsGdriveRedirectUrl,
  decodeGDriveOAuthState,
  disconnectGDrive,
  exchangeAndConnect,
  getGDriveCredentials,
  getGDriveStatus,
  updateGDriveSchedulerSettings
} from "./gdrive.service.js";
import {
  downloadDriveFile,
  getBackupJob,
  getRecentBackupJobs,
  listDriveBackups,
  queueBackupJob,
  scheduleBackupJobProcessing,
  STAGING_DIR
} from "../export/gdrive-backup.service.js";
import { queueHouseholdImport, scheduleImportJobProcessing } from "../export/import-household-bundle.service.js";

const connectRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many connect attempts. Please try again later." },
  skip: () => env.MODE === "TEST"
});

const backupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many backup requests. Try again in about an hour." },
  skip: () => env.MODE === "TEST"
});

const connectSchema = z.object({
  code: z.string().min(1),
  folderId: z.string().min(1)
});

const restoreSchema = z.object({
  fileId: z.string().min(1)
});

const schedulerSettingsSchema = z.object({
  backupFrequencyHours: z.number().int().refine((v) => [0, 12, 24, 48, 72, 168].includes(v), {
    message: "backupFrequencyHours must be one of: 0, 12, 24, 48, 72, 168"
  }),
  backupRetentionCount: z.number().int().min(1).max(30)
});

const oauthUrlQuerySchema = z.object({
  folderId: z.string().min(1)
});

export const gdriveRouter = Router();

/**
 * Google OAuth redirect — no JWT (browser redirect from accounts.google.com).
 * State is HMAC-signed; user must be household owner before tokens are persisted.
 */
gdriveRouter.get("/oauth/callback", async (req, res) => {
  const errRedirect = (msg: string) => {
    const safe = msg.slice(0, 500);
    res.redirect(
      302,
      buildSettingsGdriveRedirectUrl({
        tab: "data",
        gdrive: "error",
        message: encodeURIComponent(safe)
      })
    );
  };

  const code = String(req.query.code ?? "").trim();
  const state = String(req.query.state ?? "").trim();
  if (!code || !state) {
    errRedirect("Missing OAuth code or state.");
    return;
  }

  const decoded = decodeGDriveOAuthState(state);
  if (!decoded.ok) {
    errRedirect(decoded.message);
    return;
  }

  const ownerOk = await assertOwnerOfHousehold(decoded.userId, decoded.householdId);
  if (!ownerOk) {
    errRedirect("Invalid user for this connection.");
    return;
  }

  const result = await exchangeAndConnect(decoded.householdId, decoded.userId, code, decoded.folderId);
  if (!result.ok) {
    errRedirect(result.message);
    return;
  }

  res.redirect(302, buildSettingsGdriveRedirectUrl({ tab: "data", gdrive: "connected" }));
});

gdriveRouter.use(requireAuth);

/** GET /gdrive/status — returns connection state; never returns tokens. */
gdriveRouter.get("/status", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const status = await getGDriveStatus(req.authUser!.householdId);
  if (!status) {
    res.json({ connected: false });
    return;
  }
  res.json({ connected: true, ...status });
});

/** GET /gdrive/oauth/url — owner only; returns Google consent URL for the given folder. */
gdriveRouter.get("/oauth/url", requireRole(["owner"]), async (req: AuthenticatedRequest, res) => {
  const parsed = oauthUrlQuerySchema.safeParse({ folderId: String(req.query.folderId ?? "").trim() });
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }
  if (!env.GOOGLE_CLIENT_ID.trim() || !env.GOOGLE_CLIENT_SECRET.trim() || !env.GOOGLE_REDIRECT_URI.trim()) {
    res.status(400).json({
      code: "OAUTH_NOT_CONFIGURED",
      message: "Google OAuth is not configured on the server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)."
    });
    return;
  }
  const householdId = req.authUser!.householdId;
  const userId = req.authUser!.userId;
  const url = buildOAuthConsentUrl(householdId, userId, parsed.data.folderId);
  res.json({ url });
});

/** POST /gdrive/connect — owner only; exchange OAuth code (e.g. SPA flow) and save tokens. */
gdriveRouter.post("/connect", requireRole(["owner"]), connectRateLimit, async (req: AuthenticatedRequest, res) => {
  const parsed = connectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  if (!env.GOOGLE_CLIENT_ID.trim() || !env.GOOGLE_CLIENT_SECRET.trim() || !env.GOOGLE_REDIRECT_URI.trim()) {
    res.status(400).json({
      code: "OAUTH_NOT_CONFIGURED",
      message: "Google OAuth is not configured on the server."
    });
    return;
  }

  const result = await exchangeAndConnect(
    req.authUser!.householdId,
    req.authUser!.userId,
    parsed.data.code,
    parsed.data.folderId
  );
  if (!result.ok) {
    res.status(422).json({ code: "DRIVE_CONNECTION_FAILED", message: result.message });
    return;
  }

  res.status(200).json({
    connected: true,
    folderName: result.folderName,
    folderId: parsed.data.folderId
  });
});

/** DELETE /gdrive/disconnect — removes stored credentials. */
gdriveRouter.delete("/disconnect", requireRole(["owner"]), async (req: AuthenticatedRequest, res) => {
  await disconnectGDrive(req.authUser!.householdId);
  res.status(200).json({ connected: false });
});

/** GET /gdrive/backups — owner or admin; list recent `.hfb` files in the connected Drive folder. */
gdriveRouter.get("/backups", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const result = await listDriveBackups(req.authUser!.householdId);
  if (!result.ok) {
    if (result.reason === "not_configured") {
      res.status(409).json({
        code: "GDRIVE_NOT_CONFIGURED",
        message: "Google Drive is not connected."
      });
      return;
    }
    res.status(502).json({ code: "DRIVE_LIST_FAILED", message: result.message });
    return;
  }
  res.json({ files: result.files });
});

/** PATCH /gdrive/settings — owner only; scheduler frequency and Drive retention count. */
gdriveRouter.patch("/settings", requireRole(["owner"]), async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const parsed = schedulerSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const creds = await getGDriveCredentials(householdId);
  if (!creds) {
    res.status(409).json({ code: "GDRIVE_NOT_CONFIGURED", message: "Google Drive is not connected." });
    return;
  }
  await updateGDriveSchedulerSettings(householdId, {
    backupFrequencyHours: parsed.data.backupFrequencyHours,
    backupRetentionCount: parsed.data.backupRetentionCount
  });
  res.status(200).json({
    backupFrequencyHours: parsed.data.backupFrequencyHours,
    backupRetentionCount: parsed.data.backupRetentionCount
  });
});

/** GET /gdrive/backups/history — owner or admin; recent `backup_job` rows (local attempts). */
gdriveRouter.get("/backups/history", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const creds = await getGDriveCredentials(householdId);
  if (!creds) {
    res.status(409).json({
      code: "GDRIVE_NOT_CONFIGURED",
      message: "Google Drive is not connected."
    });
    return;
  }
  const jobs = await getRecentBackupJobs(householdId, 20);
  res.status(200).json({ jobs });
});

/** POST /gdrive/restore — owner only; download from Drive and queue household import. */
gdriveRouter.post("/restore", requireRole(["owner"]), async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const userId = req.authUser!.userId;

  const parsed = restoreSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const creds = await getGDriveCredentials(householdId);
  if (!creds) {
    res.status(409).json({
      code: "GDRIVE_NOT_CONFIGURED",
      message: "Google Drive is not connected."
    });
    return;
  }

  const { fileId } = parsed.data;
  const tempPath = path.join(STAGING_DIR, `${randomUUID()}.hfb`);
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  try {
    await downloadDriveFile(creds.refreshToken, fileId, tempPath);
  } catch (err: unknown) {
    res.status(502).json({
      code: "DRIVE_DOWNLOAD_FAILED",
      message: err instanceof Error ? err.message : "Could not download backup from Drive."
    });
    return;
  }

  const { jobId } = await queueHouseholdImport(householdId, userId, tempPath);
  scheduleImportJobProcessing(jobId, householdId);
  res.status(202).json({
    jobId,
    message: "Restore started. Poll GET /exports/import/:jobId for status."
  });
});

/** POST /gdrive/backup — owner only; queues async upload of .hfb to connected Drive folder. */
gdriveRouter.post("/backup", requireRole(["owner"]), backupRateLimit, async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const creds = await getGDriveCredentials(householdId);
  if (!creds) {
    res.status(409).json({
      code: "GDRIVE_NOT_CONFIGURED",
      message: "Google Drive is not connected. Go to Settings → Data to connect a Drive folder first."
    });
    return;
  }
  const { jobId } = await queueBackupJob(householdId, req.authUser!.userId);
  scheduleBackupJobProcessing(jobId, householdId);
  res.status(202).json({
    jobId,
    message: "Backup started. Poll GET /gdrive/backup/:jobId for status."
  });
});

/** GET /gdrive/backup/:jobId — owner or admin; backup job status. */
gdriveRouter.get("/backup/:jobId", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const job = await getBackupJob(req.authUser!.householdId, String(req.params.jobId ?? "").trim());
  if (!job) {
    res.status(404).json({ code: "BACKUP_JOB_NOT_FOUND", message: "Backup job not found." });
    return;
  }
  res.status(200).json({
    id: job.id,
    status: job.status,
    driveFileId: job.driveFileId,
    driveFileName: job.driveFileName,
    sizeBytes: job.sizeBytes,
    errorText: job.errorText,
    createdAt: job.createdAt,
    completedAt: job.completedAt
  });
});
