import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { employerInputSchema } from "./household.types.js";
import {
  getHouseholdSettings,
  getHouseholdMonthlySavingsTarget,
  patchHouseholdSettings
} from "./household.service.js";

export const householdRouter = Router();
householdRouter.use(requireAuth);

householdRouter.get("/settings", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const full = getHouseholdSettings(householdId);
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
    monthlySavingsTargetUsd: z.union([z.number().min(0).max(1_000_000_000), z.null()]).optional(),
    salaryDepositFinancialAccountId: z.union([z.string().uuid(), z.null()]).optional(),
    employers: z.array(employerInputSchema).max(20).optional()
  })
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field required" });

householdRouter.patch("/settings", (req: AuthenticatedRequest, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = patchHouseholdSettings(householdId, parsed.data);
  if (!out.ok) {
    if (out.code === "MIGRATION_REQUIRED") {
      res.status(503).json({
        message:
          "Database is missing migration 0010 (monthly_savings_target_usd) or 0017 (income onboarding). From repo root run: npm run db:init (or npm run db:seed). Use the same MODE / DB_PATH as your backend.",
        code: out.code
      });
      return;
    }
    if (out.code === "INVALID_ACCOUNT") {
      res.status(400).json({ message: "salaryDepositFinancialAccountId must be a household account", code: out.code });
      return;
    }
    if (out.code === "INVALID_EMPLOYERS") {
      res.status(400).json({ message: "Invalid employers payload", code: out.code });
      return;
    }
    res.status(400).json({ message: "Invalid amount", code: out.code });
    return;
  }
  const full = getHouseholdSettings(householdId);
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
