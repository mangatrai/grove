import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  getHouseholdMonthlySavingsTarget,
  updateHouseholdMonthlySavingsTarget
} from "./household.service.js";

export const householdRouter = Router();
householdRouter.use(requireAuth);

householdRouter.get("/settings", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const monthlySavingsTargetUsd = getHouseholdMonthlySavingsTarget(householdId);
  res.status(200).json({ monthlySavingsTargetUsd });
});

const patchSchema = z.object({
  monthlySavingsTargetUsd: z.union([z.number().min(0).max(1_000_000_000), z.null()])
});

householdRouter.patch("/settings", (req: AuthenticatedRequest, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = updateHouseholdMonthlySavingsTarget(householdId, parsed.data.monthlySavingsTargetUsd);
  if (!out.ok) {
    if (out.code === "MIGRATION_REQUIRED") {
      res.status(503).json({
        message:
          "Database is missing migration 0010 (monthly_savings_target_usd). From repo root run: npm run db:init (or npm run db:seed). Use the same MODE / DB_PATH as your backend.",
        code: out.code
      });
      return;
    }
    res.status(400).json({ message: "Invalid amount", code: out.code });
    return;
  }
  res.status(200).json({ monthlySavingsTargetUsd: getHouseholdMonthlySavingsTarget(householdId) });
});
