import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  getBalanceSheet,
  getBalanceSheetHistory,
  patchManualBalanceSnapshot,
  upsertManualBalanceSnapshot
} from "./balance-sheet.service.js";
import { getCashSummary } from "./cash-summary.service.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const emptyToUndef = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);

const querySchema = z
  .object({
    preset: z
      .enum([
        "month",
        "ytd",
        "rolling_7",
        "rolling_30",
        "rolling_90",
        "rolling_180",
        "prev_calendar_year"
      ])
      .optional(),
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
    accountId: z.string().uuid().optional(),
    ownerScope: z.enum(["household", "person"]).optional(),
    ownerPersonProfileId: z.string().uuid().optional()
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

const balanceSheetQuerySchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const balanceSheetHistoryQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  interval: z.enum(["month", "week", "day"]).optional().default("month")
});

const manualBalancePostSchema = z
  .object({
    financialAccountId: z.string().uuid(),
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.number().finite(),
    currency: z.string().min(3).max(8).optional().default("USD")
  })
  .strict();

const manualBalancePatchSchema = z
  .object({
    amount: z.number().finite().optional(),
    currency: z.string().min(3).max(8).optional()
  })
  .strict()
  .refine((o) => o.amount !== undefined || o.currency !== undefined, {
    message: "Provide amount and/or currency"
  });

reportsRouter.get("/balance-sheet", async (req: AuthenticatedRequest, res) => {
  const parsed = balanceSheetQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.flatten() });
    return;
  }
  const asOf = parsed.data.asOf ?? new Date().toISOString().slice(0, 10);
  const householdId = req.authUser!.householdId;
  const data = await getBalanceSheet(householdId, asOf);
  res.status(200).json(data);
});

reportsRouter.get("/balance-sheet/history", async (req: AuthenticatedRequest, res) => {
  const parsed = balanceSheetHistoryQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.flatten() });
    return;
  }
  const { from, to, interval } = parsed.data;
  if (from > to) {
    res.status(400).json({ message: "from must be on or before to" });
    return;
  }
  const householdId = req.authUser!.householdId;
  try {
    const data = await getBalanceSheetHistory(householdId, from, to, interval);
    res.status(200).json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "BALANCE_HISTORY_TOO_MANY_POINTS") {
      res.status(400).json({
        message: "Too many sample points for this range and interval (max 120). Narrow the range or use a coarser interval.",
        code: "BALANCE_HISTORY_TOO_MANY_POINTS"
      });
      return;
    }
    throw e;
  }
});

reportsRouter.post("/balance-sheet/manual", async (req: AuthenticatedRequest, res) => {
  const parsed = manualBalancePostSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    return;
  }
  const householdId = req.authUser!.householdId;
  try {
    const out = await upsertManualBalanceSnapshot(householdId, parsed.data);
    res.status(201).json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "ACCOUNT_NOT_FOUND") {
      res.status(404).json({ message: "Financial account not found for this household", code: "ACCOUNT_NOT_FOUND" });
      return;
    }
    if (msg === "PAYSLIP_ACCOUNT_NOT_ALLOWED") {
      res.status(400).json({ message: "Payslip bucket accounts cannot hold statement balances", code: "INVALID_ACCOUNT" });
      return;
    }
    throw e;
  }
});

reportsRouter.patch("/balance-sheet/manual/:id", async (req: AuthenticatedRequest, res) => {
  const idParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
  if (!idParsed.success) {
    res.status(400).json({ message: "Invalid snapshot id" });
    return;
  }
  const body = manualBalancePatchSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ message: "Invalid payload", issues: body.error.flatten() });
    return;
  }
  const householdId = req.authUser!.householdId;
  const updated = await patchManualBalanceSnapshot(householdId, idParsed.data.id, body.data);
  if (!updated) {
    res.status(404).json({ message: "Manual balance snapshot not found", code: "NOT_FOUND" });
    return;
  }
  res.status(200).json(updated);
});

reportsRouter.get("/cash-summary", async (req: AuthenticatedRequest, res) => {
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
    const data = await getCashSummary(householdId, {
      preset: q.preset,
      month: q.month,
      asOf: q.asOf,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      breakdown: q.breakdown ?? false,
      categoryBreakdown: q.categoryBreakdown ?? false,
      categoryRollup: q.categoryRollup,
      accountId: q.accountId,
      ownerScope: q.ownerScope,
      ownerPersonProfileId: q.ownerPersonProfileId
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
      msg === "CUSTOM_RANGE_TOO_LONG" ||
      msg === "OWNER_PERSON_REQUIRED"
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
