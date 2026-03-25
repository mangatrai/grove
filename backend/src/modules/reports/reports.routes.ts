import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { getCashSummary } from "./cash-summary.service.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const querySchema = z.object({
  preset: z.enum(["month", "ytd", "rolling_30", "rolling_90"]),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  breakdown: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  categoryBreakdown: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  categoryRollup: z.enum(["leaf", "parent"]).optional(),
  accountId: z.string().uuid().optional()
});

reportsRouter.get("/cash-summary", (req: AuthenticatedRequest, res) => {
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const q = parsed.data;
  if (q.preset === "month" && !q.month) {
    res.status(400).json({ message: "month (YYYY-MM) is required when preset=month" });
    return;
  }

  const householdId = req.authUser!.householdId;

  try {
    const data = getCashSummary(householdId, {
      preset: q.preset,
      month: q.month,
      asOf: q.asOf,
      breakdown: q.breakdown ?? false,
      categoryBreakdown: q.categoryBreakdown ?? false,
      categoryRollup: q.categoryRollup,
      accountId: q.accountId
    });
    res.status(200).json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INVALID_MONTH" || msg === "INVALID_PRESET") {
      res.status(400).json({ message: msg });
      return;
    }
    if (msg === "ACCOUNT_NOT_FOUND") {
      res.status(404).json({ message: "Financial account not found for this household", code: "ACCOUNT_NOT_FOUND" });
      return;
    }
    throw e;
  }
});
