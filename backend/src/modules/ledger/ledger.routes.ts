import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { listCanonicalTransactions, listCanonicalTransactionsForImportSession } from "./ledger.service.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sessionId: z.string().uuid().optional()
});

export const ledgerRouter = Router();
ledgerRouter.use(requireAuth);

ledgerRouter.get("/", (req: AuthenticatedRequest, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const { limit, offset, sessionId } = parsed.data;
  const householdId = req.authUser!.householdId;

  if (sessionId) {
    const result = listCanonicalTransactionsForImportSession(householdId, sessionId, limit, offset);
    if ("code" in result && result.code === "SESSION_NOT_FOUND") {
      res.status(404).json({ message: "Import session not found", code: result.code });
      return;
    }
    res.status(200).json(result);
    return;
  }

  const result = listCanonicalTransactions(householdId, limit, offset);
  res.status(200).json(result);
});
