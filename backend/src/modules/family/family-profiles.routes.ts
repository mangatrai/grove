import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import {
  createAvailability,
  deleteAvailability,
  listAvailability,
  listHouseholdMembers,
  updateAvailability,
  updateMemberProfile,
} from "./family-profiles.service.js";

export const familyProfilesRouter = Router();
familyProfilesRouter.use(requireAuth);

// ── Member profiles ────────────────────────────────────────────────────────

familyProfilesRouter.get(
  "/members",
  requireRole("owner", "admin", "member"),
  async (req: AuthenticatedRequest, res) => {
    const members = await listHouseholdMembers(req.authUser!.householdId);
    res.json({ members });
  }
);

const updateMemberSchema = z.object({
  interestsJson: z.array(z.string().max(80)).max(30).optional(),
  notes: z.string().max(2000).nullable().optional(),
  age: z.number().int().min(0).max(150).nullable().optional(),
  relationship: z.enum(["self", "spouse", "child", "dependent", "employee", "other"]).optional(),
});

familyProfilesRouter.patch(
  "/members/:profileId",
  requireRole("owner", "admin"),
  async (req: AuthenticatedRequest, res) => {
    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.issues });
      return;
    }
    const member = await updateMemberProfile(
      req.params.profileId,
      req.authUser!.householdId,
      parsed.data
    );
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    res.json({ member });
  }
);

// ── Household help availability ────────────────────────────────────────────

familyProfilesRouter.get(
  "/availability",
  requireRole("owner", "admin", "member"),
  async (req: AuthenticatedRequest, res) => {
    const includeInactive = req.query.includeInactive === "true";
    const slots = await listAvailability(req.authUser!.householdId, includeInactive);
    res.json({ slots });
  }
);

const slotTypeEnum = z.enum(["regular", "one_off", "unavailable"]);
const serviceTypeEnum = z.enum(["nanny", "babysitter", "cleaner", "activity_teacher", "tutor", "other"]);

const createSlotSchema = z.object({
  personProfileId: z.string().min(1),
  slotType: slotTypeEnum,
  serviceType: serviceTypeEnum,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  specificDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  label: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

familyProfilesRouter.post(
  "/availability",
  requireRole("owner", "admin"),
  async (req: AuthenticatedRequest, res) => {
    const parsed = createSlotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.issues });
      return;
    }
    const slot = await createAvailability(req.authUser!.householdId, parsed.data);
    res.status(201).json({ slot });
  }
);

const updateSlotSchema = z.object({
  slotType: slotTypeEnum.optional(),
  serviceType: serviceTypeEnum.optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  specificDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  label: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

familyProfilesRouter.patch(
  "/availability/:id",
  requireRole("owner", "admin"),
  async (req: AuthenticatedRequest, res) => {
    const parsed = updateSlotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.issues });
      return;
    }
    const slot = await updateAvailability(req.params.id, req.authUser!.householdId, parsed.data);
    if (!slot) {
      res.status(404).json({ error: "Slot not found" });
      return;
    }
    res.json({ slot });
  }
);

familyProfilesRouter.delete(
  "/availability/:id",
  requireRole("owner", "admin"),
  async (req: AuthenticatedRequest, res) => {
    const deleted = await deleteAvailability(req.params.id, req.authUser!.householdId);
    if (!deleted) {
      res.status(404).json({ error: "Slot not found" });
      return;
    }
    res.status(204).end();
  }
);
