import fs from "node:fs";
import path from "node:path";

import { Router } from "express";
import multer from "multer";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { log } from "../../logger.js";
import { resolveDataPath } from "../../paths.js";
import {
  getExportJob,
  queueHouseholdExport,
  readExportFileIfReady,
  scheduleExportJobProcessing,
  startExportCleanupSchedule
} from "./export-job.service.js";
import {
  getImportJob,
  queueHouseholdImport,
  readHfbManifestFromFile,
  scheduleImportJobProcessing
} from "./import-household-bundle.service.js";

const EXPORT_WINDOW_MS = 60 * 60 * 1000;
const EXPORT_MAX_PER_WINDOW = 10;
const exportStartsByUser = new Map<string, number[]>();

function allowHouseholdExport(userId: string): boolean {
  const now = Date.now();
  const prev = exportStartsByUser.get(userId) ?? [];
  const recent = prev.filter((t) => now - t < EXPORT_WINDOW_MS);
  if (recent.length >= EXPORT_MAX_PER_WINDOW) {
    return false;
  }
  recent.push(now);
  exportStartsByUser.set(userId, recent);
  return true;
}

/** Multer instance for restore backup uploads — stored on disk (not in memory, files can be large). */
const restoreUpload = multer({
  dest: resolveDataPath("data/imports-restore-upload"),
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB safety cap
});

const previewUpload = multer({
  dest: resolveDataPath("data/imports-preview-upload"),
  limits: { fileSize: 500 * 1024 * 1024 }
});

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

startExportCleanupSchedule();

exportsRouter.post(
  "/preview",
  requireRole(["owner"]),
  previewUpload.single("file"),
  async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded. Send a multipart/form-data request with a 'file' field." });
      return;
    }

    try {
      const ext = path.extname(req.file.originalname ?? "").toLowerCase();
      if (ext !== ".hfb") {
        res.status(400).json({ message: "Invalid file type. Only .hfb files are accepted." });
        return;
      }

      try {
        const preview = await readHfbManifestFromFile(req.file.path);
        res.json(preview);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string }).code;
        if (code === "ENCRYPTED_NO_KEY") {
          log.warn("export HFB preview: encrypted backup, no key", { householdId: req.authUser!.householdId });
          res.status(422).json({ message: msg });
        } else {
          log.error("export HFB preview manifest read failed", {
            householdId: req.authUser!.householdId,
            err
          });
          res.status(400).json({ message: msg });
        }
      }
    } finally {
      try { fs.unlinkSync(req.file.path); } catch { /* already gone */ }
    }
  }
);

/** Async restore from export bundle (.hfb). Owner only — wipes and replaces all household data. */
exportsRouter.post(
  "/household/import",
  requireRole(["owner"]),
  restoreUpload.single("file"),
  async (req: AuthenticatedRequest, res) => {
    const householdId = req.authUser!.householdId;
    const userId = req.authUser!.userId;

    if (!req.file) {
      res.status(400).json({ message: "No file uploaded. Send a multipart/form-data request with a 'file' field." });
      return;
    }

    const ext = path.extname(req.file.originalname ?? "").toLowerCase();
    if (ext !== ".hfb") {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* already gone */
      }
      res.status(400).json({ message: "Invalid file type. Only .hfb files are accepted." });
      return;
    }

    const { jobId } = await queueHouseholdImport(householdId, userId, req.file.path);
    scheduleImportJobProcessing(jobId, householdId);
    res.status(202).json({
      jobId,
      message: "Restore started. Poll GET /exports/import/:jobId for status."
    });
  }
);

/** Poll status of a restore (import) job. */
exportsRouter.get("/import/:jobId", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const jobId = req.params.jobId?.trim();
  if (!jobId) {
    res.status(400).json({ message: "Missing job id" });
    return;
  }
  const job = await getImportJob(householdId, jobId);
  if (!job) {
    res.status(404).json({ code: "IMPORT_JOB_NOT_FOUND", message: "Import job not found" });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    error: job.errorText,
    stats: job.statsJson ? (JSON.parse(job.statsJson) as Record<string, number>) : null
  });
});

exportsRouter.post("/household", async (req: AuthenticatedRequest, res) => {
  const { householdId, userId, role, personProfileId } = req.authUser!;

  // Members must have a linked person profile to export their data.
  if (role === "member" && !personProfileId) {
    res.status(403).json({ message: "Your account is not linked to a household profile." });
    return;
  }

  if (!allowHouseholdExport(userId)) {
    res.status(429).json({ message: "Too many export requests; try again in about an hour." });
    return;
  }

  // Members get a personal-data export; owner/admin get the full household export.
  const scopedProfileId = role === "member" ? personProfileId : null;
  const { jobId } = await queueHouseholdExport(householdId, userId, scopedProfileId);
  scheduleExportJobProcessing(jobId, householdId);
  res.status(202).json({
    jobId,
    scope: role === "member" ? "member" : "household",
    message:
      "Export started. Poll GET /exports/:jobId until status is complete, then GET /exports/:jobId/download for the .hfb backup."
  });
});

exportsRouter.get("/:jobId/download", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const jobId = req.params.jobId?.trim();
  if (!jobId) {
    res.status(400).json({ message: "Missing job id" });
    return;
  }
  const file = await readExportFileIfReady(householdId, jobId);
  if (!file.ok) {
    if (file.code === "EXPORT_EXPIRED") {
      res.status(410).json({
        code: file.code,
        message: `Export file has been deleted (exports are retained for ${48} hours). Start a new export.`
      });
      return;
    }
    const human =
      file.code === "EXPORT_NOT_READY"
        ? "Export not ready yet"
        : file.code === "EXPORT_FILE_MISSING"
          ? "Export file missing on disk"
          : file.code === "EXPORT_MISSING_PATH"
            ? "Export job has no storage path"
            : "Export job not found";
    res.status(404).json({
      code: file.code,
      message: human,
      jobStatus: file.jobStatus ?? null
    });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="household-export-${jobId}.hfb"`);
  res.send(file.buffer);
});

exportsRouter.get("/:jobId", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const jobId = req.params.jobId?.trim();
  if (!jobId) {
    res.status(400).json({ message: "Missing job id" });
    return;
  }
  const job = await getExportJob(householdId, jobId);
  if (!job) {
    res.status(404).json({ code: "EXPORT_JOB_NOT_FOUND", message: "Export job not found" });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    scope: job.personProfileId ? "member" : "household",
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    error: job.errorText
  });
});
