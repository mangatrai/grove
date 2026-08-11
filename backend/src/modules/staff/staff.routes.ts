import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import {
  createStaffMember,
  getStaffMemberById,
  getStaffMemberForUser,
  listStaffMembers,
  updateStaffMember
} from "./staff.service.js";
import { timesheetRouter } from "./timesheet.routes.js";
import { expenseRouter } from "./expense.routes.js";

export const staffRouter = Router();
staffRouter.use(requireAuth);
staffRouter.use("/timesheets", timesheetRouter);
staffRouter.use("/expenses", expenseRouter);

const scheduleSchema = z.record(z.string(), z.number().min(0).max(24));

const createStaffSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().max(120).optional(),
  email: z.string().email(),
  phoneNumber: z.string().max(30).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").nullable().optional(),
  employmentStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  regularScheduleJson: scheduleSchema.optional(),
  hourlyRateCents: z.number().int().positive()
});

staffRouter.get("/", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const members = await listStaffMembers(householdId);
  res.status(200).json({ members });
});

staffRouter.post("/", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = createStaffSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const createdByUserId = req.authUser!.userId;
  const out = await createStaffMember(householdId, createdByUserId, parsed.data);
  if (!out.ok) {
    if (out.code === "EMAIL_REQUIRED") {
      res.status(400).json({ message: "Email is required", code: out.code });
      return;
    }
    res.status(409).json({ message: "Email already in use", code: out.code });
    return;
  }
  res.status(201).json({ member: out.member, inviteSent: out.inviteSent });
});

staffRouter.get("/me", requireRole(["staff"]), async (req: AuthenticatedRequest, res) => {
  const { householdId, personProfileId } = req.authUser!;
  if (!personProfileId) {
    res.status(404).json({ message: "Staff profile not found" });
    return;
  }
  const member = await getStaffMemberForUser(householdId, personProfileId);
  if (!member) {
    res.status(404).json({ message: "Staff profile not found" });
    return;
  }
  res.status(200).json({ member });
});

staffRouter.get("/:staffId", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ staffId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const member = await getStaffMemberById(householdId, params.data.staffId);
  if (!member) {
    res.status(404).json({ message: "Staff member not found" });
    return;
  }
  res.status(200).json({ member });
});

const patchStaffSchema = z
  .object({
    regularScheduleJson: scheduleSchema.optional(),
    isActive: z.boolean().optional(),
    newHourlyRateCents: z.number().int().positive().optional(),
    newRateEffectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional()
  })
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field required" })
  .refine((b) => (b.newHourlyRateCents === undefined) === (b.newRateEffectiveDate === undefined), {
    message: "newHourlyRateCents and newRateEffectiveDate must be provided together"
  });

staffRouter.patch("/:staffId", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ staffId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const body = patchStaffSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ errors: body.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await updateStaffMember(householdId, params.data.staffId, body.data);
  if (!out.ok) {
    res.status(404).json({ message: "Staff member not found", code: out.code });
    return;
  }
  res.status(200).json({ member: out.member });
});
