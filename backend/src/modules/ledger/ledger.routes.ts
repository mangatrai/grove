import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { listCanonicalTransactions } from "./ledger.service.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

export const ledgerRouter = Router();
ledgerRouter.use(requireAuth);

ledgerRouter.get("/", (req: AuthenticatedRequest, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const { limit, offset } = parsed.data;
  const result = listCanonicalTransactions(req.authUser!.householdId, limit, offset);
  res.status(200).json(result);
});
