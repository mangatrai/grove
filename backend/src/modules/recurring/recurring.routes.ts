import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { deleteOverride, listOverrides, upsertOverride } from "./recurring.service.js";

const upsertOverrideSchema = z.object({
  merchantKey: z.string().trim().min(1),
  displayName: z.string().optional(),
  verdict: z.enum(["confirmed", "dismissed"]),
  amountAnchor: z.number().finite().optional(),
  amountTolerancePct: z.number().finite().optional().default(15)
});

export const recurringRouter = Router();
recurringRouter.use(requireAuth);

recurringRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const data = await listOverrides(householdId);
  res.status(200).json({ ok: true, data });
});

recurringRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = upsertOverrideSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const userId = req.authUser!.userId;
  const data = await upsertOverride(householdId, userId, parsed.data);
  res.status(200).json({ ok: true, data });
});

recurringRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const result = await deleteOverride(householdId, req.params.id);
  if (!result.found) {
    res.status(404).json({ ok: false, code: "NOT_FOUND" });
    return;
  }
  res.status(200).json({ ok: true });
});
