import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  enqueueInsightJob,
  getInsightById,
  getInsightJob,
  getLatestInsight,
  listInsightHistory,
  runInsightJob
} from "./insights.service.js";

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

insightsRouter.get("/financial", async (req: AuthenticatedRequest, res) => {
  const { householdId, userId, role } = req.authUser!;
  const scope = role === "owner" || role === "admin" ? "household" : "personal";
  const targetUserId = scope === "personal" ? userId : null;
  const insight = await getLatestInsight(householdId, scope, targetUserId);
  res.status(200).json(insight);
});

insightsRouter.post("/financial/refresh", async (req: AuthenticatedRequest, res) => {
  const { householdId, userId, role } = req.authUser!;
  const scope = role === "owner" || role === "admin" ? "household" : "personal";
  const targetUserId = scope === "personal" ? userId : null;

  const jobResult = await enqueueInsightJob(householdId, userId, scope, targetUserId);
  if (!jobResult.ok) {
    res.status(500).json(jobResult);
    return;
  }
  void runInsightJob(jobResult.data, householdId);
  res.status(202).json({ ok: true, jobId: jobResult.data });
});

insightsRouter.get("/financial/history", async (req: AuthenticatedRequest, res) => {
  const { householdId, userId, role } = req.authUser!;
  const scope = role === "owner" || role === "admin" ? "household" : "personal";
  const targetUserId = scope === "personal" ? userId : null;
  const limit = Math.min(Number(req.query.limit ?? 20), 50);
  const offset = Number(req.query.offset ?? 0);
  const rows = await listInsightHistory(householdId, scope, targetUserId, limit, offset);
  res.status(200).json(rows);
});

insightsRouter.get("/financial/status/:jobId", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ jobId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const job = await getInsightJob(req.authUser!.householdId, params.data.jobId);
  if (!job.ok) {
    res.status(404).json(job);
    return;
  }
  res.status(200).json(job);
});

insightsRouter.get("/financial/:id", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const insight = await getInsightById(req.authUser!.householdId, params.data.id);
  if (!insight.ok) {
    res.status(404).json(insight);
    return;
  }
  res.status(200).json(insight);
});
