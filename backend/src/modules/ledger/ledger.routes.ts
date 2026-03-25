import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  listCanonicalTransactions,
  listCanonicalTransactionsForImportSession,
  updateCanonicalTransactionCategory,
  type LedgerListFilters
} from "./ledger.service.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sessionId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  uncategorizedOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

export const ledgerRouter = Router();
ledgerRouter.use(requireAuth);

ledgerRouter.get("/", (req: AuthenticatedRequest, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const { limit, offset, sessionId, accountId, categoryId, uncategorizedOnly, dateFrom, dateTo } = parsed.data;
  const householdId = req.authUser!.householdId;

  if (categoryId && uncategorizedOnly) {
    res.status(400).json({ message: "Use categoryId or uncategorizedOnly, not both" });
    return;
  }

  const filters: LedgerListFilters | undefined =
    categoryId || uncategorizedOnly || dateFrom || dateTo || accountId
      ? {
          categoryId: categoryId ?? undefined,
          uncategorizedOnly: uncategorizedOnly || undefined,
          dateFrom: dateFrom ?? undefined,
          dateTo: dateTo ?? undefined,
          accountId: accountId ?? undefined
        }
      : undefined;

  if (sessionId) {
    const result = listCanonicalTransactionsForImportSession(householdId, sessionId, limit, offset, filters);
    if ("code" in result && result.code === "SESSION_NOT_FOUND") {
      res.status(404).json({ message: "Import session not found", code: result.code });
      return;
    }
    res.status(200).json(result);
    return;
  }

  const result = listCanonicalTransactions(householdId, limit, offset, filters);
  res.status(200).json(result);
});

const patchCategorySchema = z.object({
  categoryId: z.union([z.string().uuid(), z.null()])
});

ledgerRouter.patch("/:id", (req: AuthenticatedRequest, res) => {
  const parsed = patchCategorySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  const out = updateCanonicalTransactionCategory(householdId, req.params.id, parsed.data.categoryId);
  if (!out.ok) {
    if (out.code === "INVALID_CATEGORY") {
      res.status(400).json({
        message: "Category is not available for this household",
        code: out.code
      });
      return;
    }
    res.status(404).json({ message: "Transaction not found" });
    return;
  }

  res.status(200).json(out.data);
});
