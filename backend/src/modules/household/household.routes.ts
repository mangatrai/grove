import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { employerInputSchema } from "./household.types.js";
import { ensurePayslipImportBucketAccount } from "../imports/import-file-binding.service.js";
import {
  createHouseholdMember,
  createLoginForMember,
  deleteHouseholdMember,
  getCurrentUserProfile,
  getHouseholdMemberDataCount,
  getHouseholdSettings,
  listHouseholdMembers,
  patchCurrentUserProfile,
  patchHouseholdMember,
  patchHouseholdSettings,
  resetMemberPassword
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
    employers: full.employers,
    city: full.city,
    state: full.state,
    combinedGrossIncomeUsd: full.combinedGrossIncomeUsd
  });
});

const patchSchema = z
  .object({
    monthlySavingsTargetUsd: z.union([z.number().min(0).max(1_000_000_000), z.null()]).optional(),
    city: z.string().max(100).nullable().optional(),
    state: z.string().max(100).nullable().optional(),
    combinedGrossIncomeUsd: z.union([z.number().min(0).max(100_000_000), z.null()]).optional()
  })
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field required" });

householdRouter.patch("/settings", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
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
    employers: full.employers,
    city: full.city,
    state: full.state,
    combinedGrossIncomeUsd: full.combinedGrossIncomeUsd
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
    employers: z.array(employerInputSchema).max(20).optional(),
    age: z.union([z.number().int().min(1).max(129), z.null()]).optional(),
    sex: z.enum(["male", "female", "nonbinary", "prefer_not_to_say"]).nullable().optional(),
    individualGrossIncomeUsd: z.union([z.number().min(0).max(100_000_000), z.null()]).optional(),
    riskTolerance: z.enum(["conservative", "moderate", "aggressive"]).nullable().optional(),
    financialGoals: z.array(z.string().max(100)).max(20).optional()
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
    res.status(400).json({ errors: parsed.error.issues });
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
    relationship: relationshipSchema,
    createLogin: z.boolean().optional().default(false)
  })
  .refine((b) => Boolean(b.fullName?.trim() || b.firstName?.trim()), {
    message: "First name or fullName is required"
  })
  .refine((b) => !b.createLogin || Boolean(b.email?.trim()), {
    message: "Email is required when createLogin is true"
  });

householdRouter.post("/members", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = createMemberSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await createHouseholdMember(householdId, parsed.data);
  if (!out.ok) {
    if (out.code === "EMAIL_REQUIRED") {
      res.status(400).json({ message: "Email is required to create a login account", code: out.code });
      return;
    }
    res.status(409).json({ message: "Email already in use", code: out.code });
    return;
  }
  res.status(201).json({ member: out.member, inviteSent: out.inviteSent });
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
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const body = patchMemberSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ errors: body.error.issues });
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

householdRouter.get("/members/:memberId/data-count", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ memberId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const counts = await getHouseholdMemberDataCount(householdId, params.data.memberId);
  res.status(200).json(counts);
});

householdRouter.post("/members/:memberId/create-login", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ memberId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await createLoginForMember(householdId, params.data.memberId);
  if (!out.ok) {
    if (out.code === "NOT_FOUND") { res.status(404).json({ message: "Member not found", code: out.code }); return; }
    if (out.code === "ALREADY_HAS_LOGIN") { res.status(409).json({ message: "Member already has a login account", code: out.code }); return; }
    if (out.code === "EMAIL_REQUIRED") { res.status(400).json({ message: "Member must have an email to create a login", code: out.code }); return; }
    res.status(409).json({ message: "Email already in use by another account", code: out.code }); return;
  }
  res.status(201).json({ inviteSent: out.inviteSent });
});

householdRouter.post("/members/:memberId/reset-password", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ memberId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const out = await resetMemberPassword(req.authUser!.householdId, params.data.memberId);
  if (!out.ok) {
    if (out.code === "NO_LOGIN") {
      res.status(409).json({ message: "Member does not have a login account", code: out.code });
      return;
    }
    res.status(404).json({ message: "Member not found", code: out.code });
    return;
  }
  if (out.emailSent) {
    res.status(200).json({ emailSent: true });
    return;
  }
  res.status(200).json({ emailSent: false, tempPassword: out.tempPassword });
});

const deleteMemberBodySchema = z.object({
  deleteLogin: z.boolean().optional().default(false)
});

householdRouter.delete("/members/:memberId", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ memberId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const body = deleteMemberBodySchema.safeParse(req.body ?? {});
  const householdId = req.authUser!.householdId;
  const out = await deleteHouseholdMember(householdId, params.data.memberId, {
    deleteLogin: body.success ? body.data.deleteLogin : false
  });
  if (!out.ok) {
    res.status(404).json({ message: "Member not found", code: out.code });
    return;
  }
  res.status(204).end();
});
