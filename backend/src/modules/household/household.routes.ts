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
import {
  addPropertyValueSnapshot,
  createProperty,
  deleteProperty,
  getProperty,
  listPropertiesForHousehold,
  listPropertyValueSnapshots,
  getEquityHistory,
  previewValuationByAddress,
  refreshPropertyValuation,
  updateProperty,
  type PropertyUse
} from "./property.service.js";
import { isRealtyApiConfigured, type ValuationDetail } from "./realty-api.service.js";
import { runDcadBackfill, saveRedfinComps } from "../protest/protest-worksheet.service.js";
import { qExec, qGet } from "../../db/query.js";
import { log } from "../../logger.js";

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
    combinedGrossIncomeUsd: full.combinedGrossIncomeUsd,
    largeTxnThresholdUsd: full.largeTxnThresholdUsd
  });
});

const patchSchema = z
  .object({
    monthlySavingsTargetUsd: z.union([z.number().min(0).max(1_000_000_000), z.null()]).optional(),
    city: z.string().max(100).nullable().optional(),
    state: z.string().max(100).nullable().optional(),
    combinedGrossIncomeUsd: z.union([z.number().min(0).max(100_000_000), z.null()]).optional(),
    largeTxnThresholdUsd: z.union([z.number().positive().max(1_000_000_000), z.null()]).optional()
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
    combinedGrossIncomeUsd: full.combinedGrossIncomeUsd,
    largeTxnThresholdUsd: full.largeTxnThresholdUsd
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
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").nullable().optional(),
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
    if (out.code === "HAS_LOGIN_ACCOUNT") {
      res.status(409).json({ message: "Member has a linked login account", code: out.code });
      return;
    }
    res.status(404).json({ message: "Member not found", code: out.code });
    return;
  }
  res.status(204).end();
});

// ─── Property routes ──────────────────────────────────────────────────────────

const propertyBodySchema = z.object({
  addressLine1: z.string().min(1).max(200).nullable().optional(),
  city: z.string().min(1).max(100).nullable().optional(),
  state: z.string().min(2).max(2).nullable().optional(),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, "Zip must be 5 digits (or 5+4 with hyphen)").nullable().optional(),
  propertyUse: z.enum(["primary", "rental", "vacation"]).nullable().optional(),
  /** accountId to link to this property on creation */
  accountId: z.string().uuid().optional(),
  purchasePrice: z.number().finite().positive().nullable().optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Initial market value snapshot (optional) */
  initialValueUsd: z.number().finite().min(0).nullable().optional(),
  initialValueAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Redfin IDs pre-fetched by preview-valuation — skip re-lookup on save */
  apiPropertyId: z.string().optional(),
  apiListingId: z.string().nullable().optional(),
  /** Full valuation detail JSON from preview-valuation — stored immediately on create */
  valuationDetailJson: z.unknown().optional()
});

householdRouter.get("/properties", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const properties = await listPropertiesForHousehold(householdId);
  res.status(200).json({ properties });
});

householdRouter.post("/properties", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = propertyBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;

  if (parsed.data.accountId) {
    const acct = await qGet<{ id: string; property_id: string | null }>(
      `SELECT id, property_id FROM financial_account WHERE id = ? AND household_id = ?`,
      parsed.data.accountId,
      householdId
    );
    if (!acct) {
      res.status(404).json({ message: "Financial account not found", code: "ACCOUNT_NOT_FOUND" });
      return;
    }
    if (acct.property_id) {
      res.status(409).json({
        message: "This account already has a property linked. Open the existing property to update it.",
        code: "PROPERTY_ALREADY_LINKED"
      });
      return;
    }
  }

  try {
    const { id } = await createProperty({
      householdId,
      addressLine1: parsed.data.addressLine1 ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      zip: parsed.data.zip ?? null,
      propertyUse: (parsed.data.propertyUse as PropertyUse | null | undefined) ?? null,
      purchasePrice: parsed.data.purchasePrice ?? null,
      purchaseDate: parsed.data.purchaseDate ?? null,
      initialValueUsd: parsed.data.initialValueUsd ?? null,
      initialValueAsOf: parsed.data.initialValueAsOf ?? null
    });

    // Store Redfin IDs + valuation detail returned from preview-valuation.
    // Use NOW() directly — no CASE WHEN to avoid PostgreSQL type-resolution failure
    // on an untyped parameter in a predicate-only position.
    if (parsed.data.apiPropertyId) {
      const detail = parsed.data.valuationDetailJson as ValuationDetail | null;
      await qExec(
        `UPDATE property
            SET api_provider          = 'redfin',
                api_property_id       = ?,
                api_listing_id        = ?,
                valuation_detail_json = ?,
                photo_url             = ?,
                valuation_fetched_at  = NOW(),
                updated_at            = NOW()
          WHERE id = ?`,
        parsed.data.apiPropertyId,
        parsed.data.apiListingId ?? null,
        parsed.data.valuationDetailJson ?? null,
        detail?.photoUrl ?? null,
        id
      );

      // Save Redfin comps from preview into protest_comp immediately so they
      // appear on the protest worksheet without needing a separate refresh.
      if (detail?.comps && detail.comps.length > 0) {
        const taxYear = new Date().getUTCFullYear();
        await saveRedfinComps(
          id,
          householdId,
          taxYear,
          detail.comps.map((c) => ({
            address: c.address, city: c.city, state: c.state, zip: c.zip,
            sqft: c.sqft, beds: c.beds, baths: c.baths, yearBuilt: c.yearBuilt,
            lotSqft: c.lotSqft, soldPrice: c.soldPrice, listPrice: c.listPrice,
            soldDate: c.soldDate, pricePerSqft: c.pricePerSqft, raw: c as unknown,
          }))
        ).catch((err) => {
          log.warn("createProperty: saveRedfinComps failed", {
            propertyId: id, err: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }

    if (parsed.data.accountId) {
      await qExec(
        `UPDATE financial_account SET property_id = ? WHERE id = ? AND household_id = ?`,
        id,
        parsed.data.accountId,
        householdId
      );
    }

    res.status(201).json({ id });

    // Fire-and-forget DCAD data backfill for TX properties (non-blocking)
    const addressParts = [parsed.data.addressLine1, parsed.data.city, parsed.data.state, parsed.data.zip].filter(Boolean);
    if (addressParts.length >= 3) {
      const year = new Date().getUTCFullYear();
      const county = (parsed.data.state ?? "").toUpperCase() === "TX" ? "Denton" : null;
      void runDcadBackfill(id, householdId, addressParts.join(", "), year, county).catch((err) => {
        log.warn("CAD backfill failed at property creation", {
          propertyId: id,
          err: err instanceof Error ? err.message : String(err)
        });
      });
    }
  } catch (err) {
    log.error("POST /household/properties: create failed", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ message: "Failed to create property", code: "CREATE_FAILED" });
  }
});

householdRouter.get("/properties/:propertyId", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  res.status(200).json({ property });
});

const propertyPatchSchema = z.object({
  addressLine1: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  zip: z.string().max(20).nullable().optional(),
  propertyUse: z.enum(["primary", "rental", "vacation"]).nullable().optional(),
  purchasePrice: z.number().int().positive().nullable().optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  monthlyRent: z.number().int().min(0).nullable().optional(),
  propertyNotes: z.string().max(2000).nullable().optional()
}).refine((b) => Object.keys(b).length > 0, { message: "At least one field required" });

householdRouter.patch("/properties/:propertyId", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const parsed = propertyPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await updateProperty(params.data.propertyId, householdId, {
    addressLine1: parsed.data.addressLine1,
    city: parsed.data.city,
    state: parsed.data.state,
    zip: parsed.data.zip,
    propertyUse: parsed.data.propertyUse as PropertyUse | null | undefined,
    purchasePrice: parsed.data.purchasePrice,
    purchaseDate: parsed.data.purchaseDate,
    monthlyRent: parsed.data.monthlyRent,
    propertyNotes: parsed.data.propertyNotes
  });
  if (!out.ok) {
    res.status(404).json({ message: "Property not found", code: out.code });
    return;
  }
  res.status(200).json({ updated: true });
});

householdRouter.delete("/properties/:propertyId", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await deleteProperty(params.data.propertyId, householdId);
  if (!out.ok) {
    res.status(404).json({ message: "Property not found", code: out.code });
    return;
  }
  res.status(200).json({ unlinkedAccounts: out.unlinkedAccounts });
});

const valueSnapshotSchema = z.object({
  marketValueUsd: z.number().finite().min(0),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["manual", "api"]).optional().default("manual")
});

householdRouter.get("/properties/:propertyId/values", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const snapshots = await listPropertyValueSnapshots(params.data.propertyId, householdId);
  res.status(200).json({ snapshots });
});

householdRouter.get("/properties/:propertyId/equity-history", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const history = await getEquityHistory(params.data.propertyId, householdId);
  res.status(200).json({ history });
});

householdRouter.post("/properties/:propertyId/values", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const parsed = valueSnapshotSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await addPropertyValueSnapshot(params.data.propertyId, householdId, {
    marketValueUsd: parsed.data.marketValueUsd,
    asOfDate: parsed.data.asOfDate,
    source: parsed.data.source
  });
  if (!out.ok) {
    if (out.code === "NOT_FOUND") {
      res.status(404).json({ message: "Property not found", code: out.code });
      return;
    }
    res.status(400).json({ message: "Invalid value", code: out.code });
    return;
  }
  res.status(201).json({ id: out.id });
});

// ─── Valuation API routes ─────────────────────────────────────────────────────

/**
 * POST /properties/preview-valuation
 * Pre-save address lookup: calls Redfin, returns estimate + Redfin IDs.
 * Does NOT create any DB record. Frontend passes returned IDs back on save.
 */
householdRouter.post("/properties/preview-valuation", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  if (!isRealtyApiConfigured()) {
    res.status(503).json({ message: "Property valuation API not configured", code: "API_NOT_CONFIGURED" });
    return;
  }
  const parsed = z.object({
    address: z.string().min(5).max(300)
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const result = await previewValuationByAddress(parsed.data.address);
  if (!result.ok) {
    const status = result.code === "API_NOT_CONFIGURED" ? 503 : 502;
    res.status(status).json({ message: result.message, code: result.code });
    return;
  }
  res.status(200).json({
    estimate: result.estimate,
    apiPropertyId: result.apiPropertyId,
    apiListingId: result.apiListingId,
    detail: result.detail
  });
});

/**
 * POST /properties/:propertyId/refresh-valuation
 * On-demand or scheduler-triggered refresh for an existing saved property.
 * Updates property_value_snapshot and valuation_detail_json.
 */
householdRouter.post("/properties/:propertyId/refresh-valuation", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const result = await refreshPropertyValuation(params.data.propertyId, householdId);
  if (!result.ok) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404, NO_ADDRESS: 422, API_NOT_CONFIGURED: 503, API_ERROR: 502, RATE_LIMITED: 429
    };
    res.status(statusMap[result.code] ?? 500).json({ message: result.message, code: result.code });
    return;
  }
  res.status(200).json({ estimate: result.estimate, fetchedAt: result.fetchedAt });
});
