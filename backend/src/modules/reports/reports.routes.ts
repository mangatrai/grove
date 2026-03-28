import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { getCashSummary } from "./cash-summary.service.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const emptyToUndef = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);

const querySchema = z
  .object({
    preset: z.enum(["month", "ytd", "rolling_30", "rolling_90"]).optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateFrom: z.preprocess(emptyToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    dateTo: z.preprocess(emptyToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
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
  })
  .superRefine((q, ctx) => {
    const hasFrom = Boolean(q.dateFrom);
    const hasTo = Boolean(q.dateTo);
    if (hasFrom !== hasTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dateFrom and dateTo must both be provided for a custom range"
      });
      return;
    }
    const custom = hasFrom && hasTo;
    if (!custom && !q.preset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preset is required unless both dateFrom and dateTo are set"
      });
      return;
    }
    if (q.preset === "month" && !custom && !q.month) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "month (YYYY-MM) is required when preset=month"
      });
    }
  });

reportsRouter.get("/cash-summary", (req: AuthenticatedRequest, res) => {
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    const customMsgs = parsed.error.issues
      .filter((i) => i.code === "custom")
      .map((i) => (typeof i.message === "string" ? i.message : ""))
      .filter(Boolean);
    if (customMsgs.length > 0) {
      res.status(400).json({ message: customMsgs[0] });
      return;
    }
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const q = parsed.data;

  const householdId = req.authUser!.householdId;

  try {
    const data = getCashSummary(householdId, {
      preset: q.preset,
      month: q.month,
      asOf: q.asOf,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      breakdown: q.breakdown ?? false,
      categoryBreakdown: q.categoryBreakdown ?? false,
      categoryRollup: q.categoryRollup,
      accountId: q.accountId
    });
    res.status(200).json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg === "INVALID_MONTH" ||
      msg === "INVALID_PRESET" ||
      msg === "CUSTOM_RANGE_INCOMPLETE" ||
      msg === "INVALID_DATE_FORMAT" ||
      msg === "INVALID_DATE_ORDER" ||
      msg === "CUSTOM_RANGE_TOO_LONG"
    ) {
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
