import { Router } from "express";
import { z } from "zod";

import { env } from "../../config/env.js";
import { qGet } from "../../db/query.js";
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

const INSIGHT_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

async function refreshCooldownRemainingMs(householdId: string): Promise<number> {
  if (env.MODE === "TEST") {
    return 0;
  }
  const row = await qGet<{ created_at: Date }>(
    `SELECT created_at FROM insight_job WHERE household_id = ? ORDER BY created_at DESC LIMIT 1`,
    householdId
  );
  if (!row) {
    return 0;
  }
  const elapsed = Date.now() - new Date(row.created_at).getTime();
  if (elapsed >= INSIGHT_REFRESH_COOLDOWN_MS) {
    return 0;
  }
  return INSIGHT_REFRESH_COOLDOWN_MS - elapsed;
}

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
  const cooldownRemaining = await refreshCooldownRemainingMs(householdId);
  if (cooldownRemaining > 0) {
    res.status(429).json({
      ok: false,
      code: "RATE_LIMITED",
      message: "Insight refresh is rate limited to one request per household every 5 minutes.",
      retryAfterMs: cooldownRemaining
    });
    return;
  }

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
