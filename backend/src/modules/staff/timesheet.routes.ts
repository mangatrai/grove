import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { getStaffMemberForUser } from "./staff.service.js";
import {
  approvePeriod,
  currentWeekStart,
  getOrCreateDraftPeriod,
  getPeriodById,
  listPendingPeriods,
  rejectPeriod,
  saveEntries,
  submitPeriod
} from "./timesheet.service.js";

export const timesheetRouter = Router();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

const entrySchema = z.object({
  workDate: dateSchema,
  hoursWorked: z.number().positive().max(24),
  note: z.string().max(500).nullable().optional()
});

const saveEntriesSchema = z.object({
  weekStartDate: dateSchema,
  entries: z.array(entrySchema).max(7)
});

async function requireStaffContext(
  req: AuthenticatedRequest
): Promise<{ householdId: string; staffProfileId: string } | null> {
  const { householdId, personProfileId } = req.authUser!;
  if (!personProfileId) return null;
  const member = await getStaffMemberForUser(householdId, personProfileId);
  if (!member) return null;
  return { householdId, staffProfileId: member.id };
}

timesheetRouter.get("/me", requireRole(["staff"]), async (req: AuthenticatedRequest, res) => {
  const ctx = await requireStaffContext(req);
  if (!ctx) {
    res.status(404).json({ message: "Staff profile not found" });
    return;
  }
  const weekStartParam = typeof req.query.weekStart === "string" ? req.query.weekStart : undefined;
  if (weekStartParam && !dateSchema.safeParse(weekStartParam).success) {
    res.status(400).json({ message: "weekStart must be YYYY-MM-DD" });
    return;
  }
  const weekStartDate = weekStartParam ?? currentWeekStart();
  const period = await getOrCreateDraftPeriod(ctx.householdId, ctx.staffProfileId, weekStartDate);
  res.status(200).json({ period });
});

timesheetRouter.put("/me", requireRole(["staff"]), async (req: AuthenticatedRequest, res) => {
  const ctx = await requireStaffContext(req);
  if (!ctx) {
    res.status(404).json({ message: "Staff profile not found" });
    return;
  }
  const parsed = saveEntriesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const out = await saveEntries(ctx.householdId, ctx.staffProfileId, parsed.data.weekStartDate, parsed.data.entries);
  if (!out.ok) {
    if (out.code === "INVALID_DATE") {
      res.status(400).json({ message: "Each entry's workDate must fall within the given week", code: out.code });
      return;
    }
    res.status(409).json({ message: "Timesheet is not editable", code: out.code });
    return;
  }
  res.status(200).json({ period: out.period });
});

timesheetRouter.post("/me/submit", requireRole(["staff"]), async (req: AuthenticatedRequest, res) => {
  const ctx = await requireStaffContext(req);
  if (!ctx) {
    res.status(404).json({ message: "Staff profile not found" });
    return;
  }
  const parsed = z.object({ weekStartDate: dateSchema }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const out = await submitPeriod(ctx.householdId, ctx.staffProfileId, parsed.data.weekStartDate);
  if (!out.ok) {
    const message = out.code === "EMPTY" ? "Add hours before submitting" : "Timesheet is not editable";
    res.status(409).json({ message, code: out.code });
    return;
  }
  res.status(200).json({ period: out.period });
});

timesheetRouter.get("/pending", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const periods = await listPendingPeriods(req.authUser!.householdId);
  res.status(200).json({ periods });
});

timesheetRouter.get("/:periodId", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ periodId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const period = await getPeriodById(req.authUser!.householdId, params.data.periodId);
  if (!period) {
    res.status(404).json({ message: "Timesheet not found" });
    return;
  }
  res.status(200).json({ period });
});

timesheetRouter.post("/:periodId/approve", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ periodId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const out = await approvePeriod(req.authUser!.householdId, params.data.periodId, req.authUser!.userId);
  if (!out.ok) {
    res.status(out.code === "NOT_FOUND" ? 404 : 409).json({ message: "Cannot approve", code: out.code });
    return;
  }
  res.status(200).json({ period: out.period });
});

const rejectSchema = z.object({ reviewNote: z.string().min(1).max(1000) });

timesheetRouter.post("/:periodId/reject", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ periodId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const body = rejectSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ errors: body.error.issues });
    return;
  }
  const out = await rejectPeriod(
    req.authUser!.householdId,
    params.data.periodId,
    req.authUser!.userId,
    body.data.reviewNote
  );
  if (!out.ok) {
    res.status(out.code === "NOT_FOUND" ? 404 : 409).json({ message: "Cannot reject", code: out.code });
    return;
  }
  res.status(200).json({ period: out.period });
});
