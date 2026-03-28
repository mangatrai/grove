import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createManualCanonicalTransaction,
  listCanonicalTransactions,
  listCanonicalTransactionsForImportSession,
  updateCanonicalTransactionCategory,
  type LedgerListFilters
} from "./ledger.service.js";

const LEDGER_RESOLUTION_TYPES = [
  "unknown_category",
  "duplicate_ambiguity",
  "transfer_ambiguity",
  "reconciliation_mismatch"
] as const;

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
  needsReview: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  resolutionType: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v): string[] | undefined => {
      if (v === undefined) {
        return undefined;
      }
      const parts = (Array.isArray(v) ? v : [v]).flatMap((s) =>
        String(s)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      );
      const uniq = [...new Set(parts)];
      return uniq.length ? uniq : undefined;
    }),
  search: z.string().max(200).optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const postManualSchema = z.object({
  accountId: z.string().uuid(),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().refine((n) => n !== 0, "Amount must not be zero"),
  merchant: z.string().max(200).optional().default("Manual entry"),
  memo: z.union([z.string().max(500), z.null()]).optional(),
  categoryId: z.union([z.string().uuid(), z.null()]).optional()
});

export const ledgerRouter = Router();
ledgerRouter.use(requireAuth);

ledgerRouter.get("/", (req: AuthenticatedRequest, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const {
    limit,
    offset,
    sessionId,
    accountId,
    categoryId,
    uncategorizedOnly,
    needsReview,
    resolutionType,
    search,
    amountMin,
    amountMax,
    dateFrom,
    dateTo
  } = parsed.data;
  const householdId = req.authUser!.householdId;

  if (categoryId && uncategorizedOnly) {
    res.status(400).json({ message: "Use categoryId or uncategorizedOnly, not both" });
    return;
  }

  if (resolutionType?.length && !needsReview) {
    res.status(400).json({ message: "resolutionType requires needsReview=true" });
    return;
  }

  const allowedTypes = new Set<string>(LEDGER_RESOLUTION_TYPES);
  if (resolutionType?.some((t) => !allowedTypes.has(t))) {
    res.status(400).json({
      message: "Invalid resolutionType",
      allowed: [...LEDGER_RESOLUTION_TYPES]
    });
    return;
  }

  const amin = amountMin !== undefined && Number.isFinite(amountMin) ? amountMin : undefined;
  const amax = amountMax !== undefined && Number.isFinite(amountMax) ? amountMax : undefined;

  const filters: LedgerListFilters | undefined =
    categoryId ||
    uncategorizedOnly ||
    needsReview ||
    (resolutionType?.length ?? 0) > 0 ||
    (search !== undefined && search.trim() !== "") ||
    amin !== undefined ||
    amax !== undefined ||
    dateFrom ||
    dateTo ||
    accountId
      ? {
          categoryId: categoryId ?? undefined,
          uncategorizedOnly: uncategorizedOnly || undefined,
          needsReviewOnly: needsReview || undefined,
          resolutionTypes: resolutionType?.length ? resolutionType : undefined,
          search: search?.trim() || undefined,
          amountMin: amin,
          amountMax: amax,
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

ledgerRouter.post("/", (req: AuthenticatedRequest, res) => {
  const parsed = postManualSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  const userId = req.authUser!.userId;
  const body = parsed.data;
  const out = createManualCanonicalTransaction(householdId, userId, {
    accountId: body.accountId,
    txnDate: body.txnDate,
    amount: body.amount,
    merchant: body.merchant,
    memo: body.memo === undefined ? null : body.memo,
    categoryId: body.categoryId === undefined ? null : body.categoryId
  });

  if (out.ok) {
    res.status(201).json({ id: out.id });
    return;
  }

  if (out.code === "INVALID_ACCOUNT") {
    res.status(400).json({ message: "Account not found for this household", code: out.code });
    return;
  }
  if (out.code === "INVALID_CATEGORY") {
    res.status(400).json({ message: "Category is not available for this household", code: out.code });
    return;
  }
  if (out.code === "INVALID_AMOUNT") {
    res.status(400).json({ message: "Amount must be a non-zero finite number", code: out.code });
    return;
  }
  if (out.code === "DUPLICATE_FINGERPRINT") {
    res.status(409).json({
      message:
        "A transaction with the same account, date, amount, and description fingerprint already exists (dedupe).",
      code: out.code
    });
    return;
  }

  res.status(500).json({ message: "Unexpected create transaction outcome" });
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
