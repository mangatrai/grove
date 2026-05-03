import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { env } from "../../config/env.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import {
  connectGDrive,
  disconnectGDrive,
  getGDriveCredentials,
  getGDriveStatus,
  parseServiceAccountKey,
  testDriveConnection
} from "./gdrive.service.js";
import {
  getBackupJob,
  queueBackupJob,
  scheduleBackupJobProcessing
} from "../export/gdrive-backup.service.js";

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
  serviceAccountKeyJson: z.string().min(1),
  folderId: z.string().min(1)
});

export const gdriveRouter = Router();
gdriveRouter.use(requireAuth);

/** GET /gdrive/status — returns connection state; never returns the key itself. */
gdriveRouter.get("/status", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const status = await getGDriveStatus(req.authUser!.householdId);
  if (!status) {
    res.json({ connected: false });
    return;
  }
  res.json({ connected: true, ...status });
});

/** POST /gdrive/connect — validates key + folder, saves to DB. */
gdriveRouter.post("/connect", requireRole(["owner"]), connectRateLimit, async (req: AuthenticatedRequest, res) => {
  const parsed = connectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  let keyObj: unknown;
  try {
    keyObj = JSON.parse(parsed.data.serviceAccountKeyJson);
  } catch {
    res.status(400).json({ code: "INVALID_KEY_JSON", message: "Service account key is not valid JSON." });
    return;
  }

  const keyResult = parseServiceAccountKey(keyObj);
  if (!keyResult.ok) {
    res.status(400).json({ code: "INVALID_KEY_FORMAT", message: keyResult.message });
    return;
  }

  const testResult = await testDriveConnection(keyResult.key, parsed.data.folderId);
  if (!testResult.ok) {
    res.status(422).json({ code: "DRIVE_CONNECTION_FAILED", message: testResult.message });
    return;
  }

  await connectGDrive(
    req.authUser!.householdId,
    req.authUser!.userId,
    parsed.data.serviceAccountKeyJson,
    parsed.data.folderId,
    testResult.folderName
  );

  res.status(200).json({
    connected: true,
    folderName: testResult.folderName,
    folderId: parsed.data.folderId
  });
});

/** DELETE /gdrive/disconnect — removes stored credentials. */
gdriveRouter.delete("/disconnect", requireRole(["owner"]), async (req: AuthenticatedRequest, res) => {
  await disconnectGDrive(req.authUser!.householdId);
  res.status(200).json({ connected: false });
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
