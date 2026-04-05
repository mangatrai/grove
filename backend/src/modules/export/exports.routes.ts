import { Router } from "express";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  getExportJob,
  queueHouseholdExport,
  readExportFileIfReady,
  scheduleExportJobProcessing
} from "./export-job.service.js";

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

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

/** Reserved: merge / restore from export bundle (ZIP). */
exportsRouter.post("/household/import", (_req, res) => {
  res.status(501).json({
    message:
      "Import from export bundle is not implemented yet. Download the ZIP from Settings for an offline archive."
  });
});

exportsRouter.post("/household", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const userId = req.authUser!.userId;
  if (!allowHouseholdExport(userId)) {
    res.status(429).json({ message: "Too many export requests; try again in about an hour." });
    return;
  }
  const { jobId } = await queueHouseholdExport(householdId, userId);
  scheduleExportJobProcessing(jobId, householdId);
  res.status(202).json({
    jobId,
    message:
      "Export started. Poll GET /exports/:jobId until status is complete, then GET /exports/:jobId/download for the ZIP."
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
  if (!file) {
    res.status(404).json({ message: "Export not ready or not found" });
    return;
  }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="household-export-${jobId}.zip"`);
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
    res.status(404).json({ message: "Export job not found" });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    error: job.errorText
  });
});
