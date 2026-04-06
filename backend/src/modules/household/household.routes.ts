import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { employerInputSchema } from "./household.types.js";
import { ensurePayslipImportBucketAccount } from "../imports/import-file-binding.service.js";
import {
  createHouseholdMember,
  getCurrentUserProfile,
  getHouseholdSettings,
  listHouseholdMembers,
  patchCurrentUserProfile,
  patchHouseholdMember,
  patchHouseholdSettings
} from "./household.service.js";

export const householdRouter = Router();
householdRouter.use(requireAuth);

householdRouter.get("/settings", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const full = await getHouseholdSettings(householdId, req.authUser!.userId);
  if (!full) {
    res.status(404).json({ message: "Household not found" });
    return;
  }
  res.status(200).json({
    monthlySavingsTargetUsd: full.monthlySavingsTargetUsd,
    salaryDepositFinancialAccountId: full.salaryDepositFinancialAccountId,
    employers: full.employers
  });
});

const patchSchema = z
  .object({
    monthlySavingsTargetUsd: z.union([z.number().min(0).max(1_000_000_000), z.null()]).optional()
  })
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field required" });

householdRouter.patch("/settings", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await patchHouseholdSettings(householdId, parsed.data);
  if (!out.ok) {
    res.status(400).json({ message: "Invalid amount", code: out.code });
    return;
  }
  const full = await getHouseholdSettings(householdId, req.authUser!.userId);
  if (!full) {
    res.status(404).json({ message: "Household not found" });
    return;
  }
  res.status(200).json({
    monthlySavingsTargetUsd: full.monthlySavingsTargetUsd,
    salaryDepositFinancialAccountId: full.salaryDepositFinancialAccountId,
    employers: full.employers
  });
});

const roleSchema = z.enum(["head", "member"]);
const relationshipSchema = z.enum(["self", "spouse", "child", "dependent", "other"]);

const profilePatchSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().max(120).optional(),
    fullName: z.string().min(1).max(200).optional(),
    email: z.string().email().nullable().optional(),
    phoneNumber: z.string().max(30).nullable().optional(),
    avatarKey: z.string().max(500).nullable().optional(),
    salaryDepositFinancialAccountId: z.union([z.string().uuid(), z.null()]).optional(),
    employers: z.array(employerInputSchema).max(20).optional()
  })
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field required" });

householdRouter.get("/profile", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const userId = req.authUser!.userId;
  const role = req.authUser!.role;
  const profile = await getCurrentUserProfile(householdId, userId, role);
  if (!profile) {
    res.status(404).json({ message: "Profile not found" });
    return;
  }
  res.status(200).json({ profile });
});

householdRouter.patch("/profile", async (req: AuthenticatedRequest, res) => {
  const parsed = profilePatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.flatten()
    });
    return;
  }
  const householdId = req.authUser!.householdId;
  const userId = req.authUser!.userId;
  const role = req.authUser!.role;
  const out = await patchCurrentUserProfile(householdId, userId, role, parsed.data);
  if (!out.ok) {
    if (out.code === "EMAIL_CONFLICT") {
      res.status(409).json({ message: "Email already in use", code: out.code });
      return;
    }
    res.status(404).json({ message: "Profile not found", code: out.code });
    return;
  }
  if (parsed.data.employers !== undefined) {
    await ensurePayslipImportBucketAccount(householdId, userId);
  }
  res.status(200).json({ profile: out.profile });
});

householdRouter.get("/members", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const members = await listHouseholdMembers(householdId);
  res.status(200).json({ members });
});

const createMemberSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().max(120).optional(),
    fullName: z.string().min(1).max(200).optional(),
    email: z.string().email().nullable().optional(),
    phoneNumber: z.string().max(30).nullable().optional(),
    avatarKey: z.string().max(500).nullable().optional(),
    role: roleSchema,
    relationship: relationshipSchema
  })
  .refine((b) => Boolean(b.fullName?.trim() || b.firstName?.trim()), {
    message: "First name or fullName is required"
  });

householdRouter.post("/members", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = createMemberSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.flatten()
    });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await createHouseholdMember(householdId, parsed.data);
  if (!out.ok) {
    res.status(409).json({ message: "Email already in use", code: out.code });
    return;
  }
  res.status(201).json({ member: out.member });
});

const patchMemberSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().max(120).optional(),
    fullName: z.string().min(1).max(200).optional(),
    email: z.string().email().nullable().optional(),
    phoneNumber: z.string().max(30).nullable().optional(),
    avatarKey: z.string().max(500).nullable().optional(),
    role: roleSchema.optional(),
    relationship: relationshipSchema.optional()
  })
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field required" });

householdRouter.patch("/members/:memberId", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ memberId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: "Invalid member id", issues: params.error.flatten() });
    return;
  }
  const body = patchMemberSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({
      message: "Invalid payload",
      issues: body.error.flatten()
    });
    return;
  }

  const householdId = req.authUser!.householdId;
  const out = await patchHouseholdMember(householdId, params.data.memberId, body.data);
  if (!out.ok) {
    if (out.code === "EMAIL_CONFLICT") {
      res.status(409).json({ message: "Email already in use", code: out.code });
      return;
    }
    res.status(404).json({ message: "Member not found", code: out.code });
    return;
  }
  res.status(200).json({ member: out.member });
});
