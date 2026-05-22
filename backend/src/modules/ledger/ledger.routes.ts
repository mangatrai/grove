import { Router } from "express";
import { z } from "zod";

import { qAll, qGet } from "../../db/query.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { computeAndUpsertCashBalanceIfApplicable } from "../reports/balance-sheet.service.js";
import { listOpenResolutionItemsForCanonicalTransaction } from "../resolution/resolution.service.js";
import {
  aggregateCanonicalTransactions,
  bulkHardDeleteTransactions,
  bulkReassignOwner,
  bulkRestoreTransactions,
  bulkTrashTransactions,
  bulkUpdateCategory,
  createManualCanonicalTransaction,
  hardDeleteTransaction,
  listCanonicalTransactions,
  listCanonicalTransactionsForImportSession,
  restoreTransaction,
  trashTransaction,
  updateManualTransactionAmount,
  updateCanonicalTransactionCategory,
  updateCanonicalTransactionMemo,
  pairTransactions,
  unpairTransactions,
  type LedgerListFilters
} from "./ledger.service.js";

const LEDGER_RESOLUTION_TYPES = [
  "duplicate_ambiguity",
  "reconciliation_mismatch",
  "unknown_category",
  "transfer_ambiguity"
] as const;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sessionId: z.string().uuid().optional(),
  fileId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  accountIds: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((v): string[] | undefined => {
      if (v === undefined) return undefined;
      const parts = (Array.isArray(v) ? v : [v]).filter(Boolean);
      const uniq = [...new Set(parts)];
      return uniq.length ? uniq : undefined;
    }),
  categoryId: z.string().uuid().optional(),
  categoryIds: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((v): string[] | undefined => {
      if (v === undefined) return undefined;
      const parts = (Array.isArray(v) ? v : [v]).filter(Boolean);
      const uniq = [...new Set(parts)];
      return uniq.length ? uniq : undefined;
    }),
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
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ownerScope: z.enum(["household", "person"]).optional(),
  ownerPersonProfileId: z.string().uuid().optional(),
  ownerPersonProfileIds: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((v): string[] | undefined => {
      if (v === undefined) return undefined;
      const parts = (Array.isArray(v) ? v : [v]).filter(Boolean);
      const uniq = [...new Set(parts)];
      return uniq.length ? uniq : undefined;
    }),
  belongsTo: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v): string[] | undefined => {
      if (!v) return undefined;
      const parts = (Array.isArray(v) ? v : [v]).filter(Boolean);
      const uniq = [...new Set(parts)];
      return uniq.length ? uniq : undefined;
    }),
  trashOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  transferPaired: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true")
});

const aggregateQuerySchema = querySchema.omit({ limit: true, offset: true });

const postManualSchema = z.object({
  accountId: z.string().uuid(),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().refine((n) => n !== 0, "Amount must not be zero"),
  merchant: z.string().max(200).optional().default("Manual entry"),
  memo: z.union([z.string().max(500), z.null()]).optional(),
  categoryId: z.union([z.string().uuid(), z.null()]).optional()
});

/**
 * For member-scoped bulk ops: returns ids the member owns and the not-owned count.
 * Uses Postgres ANY($n) so it's a single round-trip regardless of list size.
 */
async function filterOwnedTransactionIds(
  householdId: string,
  ids: string[],
  personProfileId: string
): Promise<{ owned: string[]; notOwnedCount: number }> {
  if (ids.length === 0) return { owned: [], notOwnedCount: 0 };
  const rows = await qAll<{ id: string }>(
    `SELECT id FROM transaction_canonical
     WHERE household_id = ? AND id = ANY(?) AND owner_person_profile_id = ?`,
    householdId,
    ids,
    personProfileId
  );
  const ownedSet = new Set(rows.map((r) => r.id));
  const owned = ids.filter((id) => ownedSet.has(id));
  return { owned, notOwnedCount: ids.length - owned.length };
}

export const ledgerRouter = Router();
ledgerRouter.use(requireAuth);

ledgerRouter.get("/aggregate", async (req: AuthenticatedRequest, res) => {
  const parsed = aggregateQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const {
    sessionId,
    fileId,
    accountId,
    accountIds,
    categoryId,
    categoryIds,
    uncategorizedOnly,
    needsReview,
    resolutionType,
    search,
    amountMin,
    amountMax,
    dateFrom,
    dateTo,
    ownerScope,
    ownerPersonProfileId,
    ownerPersonProfileIds,
    belongsTo,
    trashOnly,
    transferPaired
  } = parsed.data;
  const householdId = req.authUser!.householdId;

  if ((categoryId || (categoryIds?.length ?? 0) > 0) && uncategorizedOnly) {
    res.status(400).json({ message: "Use categoryId/categoryIds or uncategorizedOnly, not both" });
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

  const filters: LedgerListFilters = {
    categoryId: categoryId ?? undefined,
    categoryIds: categoryIds ?? undefined,
    uncategorizedOnly: uncategorizedOnly || undefined,
    needsReviewOnly: needsReview || undefined,
    resolutionTypes: resolutionType?.length ? resolutionType : undefined,
    search: search?.trim() || undefined,
    amountMin: amin,
    amountMax: amax,
    dateFrom: dateFrom ?? undefined,
    dateTo: dateTo ?? undefined,
    fileId: fileId ?? undefined,
    accountId: accountId ?? undefined,
    accountIds: accountIds ?? undefined,
    trashOnly: trashOnly || undefined,
    transferPaired: transferPaired || undefined,
    ...(belongsTo?.length
      ? { belongsTo }
      : {
          ownerScope: ownerScope ?? undefined,
          ownerPersonProfileId: ownerPersonProfileId ?? undefined,
          ownerPersonProfileIds: ownerPersonProfileIds ?? undefined
        })
  };

  if (sessionId) {
    const session = await qGet(`SELECT 1 FROM import_session WHERE id = ? AND household_id = ?`, sessionId, householdId);
    if (!session) {
      res.status(404).json({ message: "Import session not found", code: "SESSION_NOT_FOUND" });
      return;
    }
    const result = await aggregateCanonicalTransactions(householdId, filters, { importSessionId: sessionId });
    res.status(200).json(result);
    return;
  }

  const result = await aggregateCanonicalTransactions(householdId, filters);
  res.status(200).json(result);
});

ledgerRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const {
    limit,
    offset,
    sessionId,
    fileId,
    accountId,
    accountIds,
    categoryId,
    categoryIds,
    uncategorizedOnly,
    needsReview,
    resolutionType,
    search,
    amountMin,
    amountMax,
    dateFrom,
    dateTo,
    ownerScope,
    ownerPersonProfileId,
    ownerPersonProfileIds,
    belongsTo,
    trashOnly,
    transferPaired
  } = parsed.data;
  const householdId = req.authUser!.householdId;

  if ((categoryId || (categoryIds?.length ?? 0) > 0) && uncategorizedOnly) {
    res.status(400).json({ message: "Use categoryId/categoryIds or uncategorizedOnly, not both" });
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

  const filters: LedgerListFilters = {
    categoryId: categoryId ?? undefined,
    categoryIds: categoryIds ?? undefined,
    uncategorizedOnly: uncategorizedOnly || undefined,
    needsReviewOnly: needsReview || undefined,
    resolutionTypes: resolutionType?.length ? resolutionType : undefined,
    search: search?.trim() || undefined,
    amountMin: amin,
    amountMax: amax,
    dateFrom: dateFrom ?? undefined,
    dateTo: dateTo ?? undefined,
    fileId: fileId ?? undefined,
    accountId: accountId ?? undefined,
    accountIds: accountIds ?? undefined,
    trashOnly: trashOnly || undefined,
    transferPaired: transferPaired || undefined,
    ...(belongsTo?.length
      ? { belongsTo }
      : {
          ownerScope: ownerScope ?? undefined,
          ownerPersonProfileId: ownerPersonProfileId ?? undefined,
          ownerPersonProfileIds: ownerPersonProfileIds ?? undefined
        })
  };

  if (sessionId) {
    const result = await listCanonicalTransactionsForImportSession(householdId, sessionId, limit, offset, filters);
    if ("code" in result && result.code === "SESSION_NOT_FOUND") {
      res.status(404).json({ message: "Import session not found", code: result.code });
      return;
    }
    res.status(200).json(result);
    return;
  }

  const result = await listCanonicalTransactions(householdId, limit, offset, filters);
  res.status(200).json(result);
});

ledgerRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = postManualSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    return;
  }

  const { householdId, userId, role, personProfileId } = req.authUser!;
  const body = parsed.data;

  // Members may only create manual transactions on accounts they own.
  if (role === "member") {
    if (!personProfileId) {
      res.status(403).json({ message: "Your account is not linked to a household profile." });
      return;
    }
    const acct = await qGet<{ owner_person_profile_id: string | null }>(
      `SELECT owner_person_profile_id FROM financial_account WHERE id = ? AND household_id = ?`,
      body.accountId,
      householdId
    );
    if (!acct || acct.owner_person_profile_id !== personProfileId) {
      res.status(403).json({ message: "You can only add transactions to your own accounts." });
      return;
    }
  }
  const out = await createManualCanonicalTransaction(householdId, userId, {
    accountId: body.accountId,
    txnDate: body.txnDate,
    amount: body.amount,
    merchant: body.merchant,
    memo: body.memo === undefined ? null : body.memo,
    categoryId: body.categoryId === undefined ? null : body.categoryId
  });

  if (out.ok) {
    await computeAndUpsertCashBalanceIfApplicable(householdId, body.accountId, body.txnDate, out.amount);
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

const bulkCategorySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  categoryId: z.string().uuid()
});

ledgerRouter.post("/bulk-category", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkCategorySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    return;
  }
  const { householdId, role, personProfileId } = req.authUser!;
  if (role === "member") {
    if (!personProfileId) {
      res.status(403).json({ message: "Your account is not linked to a household profile." });
      return;
    }
    const { owned, notOwnedCount } = await filterOwnedTransactionIds(householdId, parsed.data.ids, personProfileId);
    const result = owned.length > 0 ? await bulkUpdateCategory(householdId, owned, parsed.data.categoryId) : { updated: 0, skipped: 0 };
    res.json({ ...result, skippedNotOwned: notOwnedCount });
    return;
  }
  const result = await bulkUpdateCategory(householdId, parsed.data.ids, parsed.data.categoryId);
  res.json(result);
});

const patchCategorySchema = z.object({
  categoryId: z.union([z.string().uuid(), z.null()]).optional(),
  ownerScope: z.enum(["household", "person"]).optional(),
  ownerPersonProfileId: z.union([z.string().uuid(), z.null()]).optional(),
  status: z.enum(["trashed", "posted"]).optional(),
  memo: z.union([z.string().max(500).trim(), z.null()]).optional(),
  amount: z.number().finite().refine((n) => n !== 0, "Amount must not be zero").optional()
});

const txnIdParamSchema = z.object({
  id: z.string().uuid()
});

ledgerRouter.get("/:id/open-review", async (req: AuthenticatedRequest, res) => {
  const parsed = txnIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid transaction id" });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await listOpenResolutionItemsForCanonicalTransaction(householdId, parsed.data.id);
  if (!out.ok) {
    res.status(404).json({ message: "Transaction not found" });
    return;
  }
  res.status(200).json({ items: out.items });
});

ledgerRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const parsed = patchCategorySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const { householdId, role, personProfileId } = req.authUser!;

  // Members can only modify their own transactions.
  if (role === "member") {
    const tx = await qGet<{ owner_person_profile_id: string | null }>(
      `SELECT owner_person_profile_id FROM transaction_canonical WHERE id = ? AND household_id = ?`,
      req.params.id,
      householdId
    );
    if (!tx) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }
    if (tx.owner_person_profile_id !== personProfileId) {
      res.status(403).json({ message: "You can only modify your own transactions." });
      return;
    }
  }

  // Amount-only update (manual transactions only).
  if (
    parsed.data.amount !== undefined &&
    parsed.data.memo === undefined &&
    parsed.data.status === undefined &&
    parsed.data.categoryId === undefined &&
    !parsed.data.ownerScope
  ) {
    const out = await updateManualTransactionAmount(householdId, req.params.id, parsed.data.amount);
    if (!out.ok) {
      if (out.code === "INVALID_AMOUNT") {
        res.status(400).json({ message: "Amount must be a non-zero finite number", code: out.code });
        return;
      }
      if (out.code === "NOT_MANUAL") {
        res.status(400).json({ message: "Cannot edit amount of an imported transaction", code: out.code });
        return;
      }
      res.status(404).json({ message: "Transaction not found" });
      return;
    }
    const delta = out.newAmount - out.oldAmount;
    await computeAndUpsertCashBalanceIfApplicable(householdId, out.accountId, out.txnDate, delta);
    res.status(200).json({ amount: out.newAmount });
    return;
  }

  // Memo-only update.
  if (parsed.data.memo !== undefined && parsed.data.status === undefined && parsed.data.categoryId === undefined && !parsed.data.ownerScope) {
    const out = await updateCanonicalTransactionMemo(householdId, req.params.id, parsed.data.memo);
    if (!out.ok) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }
    res.status(200).json({ memo: parsed.data.memo });
    return;
  }

  // Status-only change: trash or restore.
  if (parsed.data.status && parsed.data.categoryId === undefined && !parsed.data.ownerScope) {
    if (parsed.data.status === "trashed") {
      const out = await trashTransaction(householdId, req.params.id);
      if (!out.ok) {
        res.status(out.code === "NOT_FOUND" ? 404 : 409).json({ message: out.code });
        return;
      }
      res.status(200).json({ status: "trashed" });
      return;
    }
    if (parsed.data.status === "posted") {
      const out = await restoreTransaction(householdId, req.params.id);
      if (!out.ok) {
        res.status(out.code === "NOT_FOUND" ? 404 : 409).json({ message: out.code });
        return;
      }
      res.status(200).json({ status: "posted" });
      return;
    }
  }

  if (parsed.data.categoryId === undefined) {
    res.status(400).json({ message: "Provide categoryId, memo, or status" });
    return;
  }

  // Members cannot reassign ownership — strip ownerScope/ownerPersonProfileId from their requests.
  const effectiveOwnerScope = role === "member" ? undefined : parsed.data.ownerScope;
  const effectiveOwnerPersonProfileId = role === "member" ? undefined : parsed.data.ownerPersonProfileId;

  if (effectiveOwnerScope === "person") {
    const ownerId = effectiveOwnerPersonProfileId ?? null;
    if (!ownerId) {
      res.status(400).json({ message: "ownerPersonProfileId is required when ownerScope=person" });
      return;
    }
    const ownerOk = await qGet(`SELECT 1 FROM person_profile WHERE household_id = ? AND id = ?`, householdId, ownerId);
    if (!ownerOk) {
      res.status(400).json({ message: "Owner person profile not found for household" });
      return;
    }
  }
  const out = await updateCanonicalTransactionCategory(
    householdId,
    req.params.id,
    parsed.data.categoryId,
    effectiveOwnerScope,
    effectiveOwnerPersonProfileId
  );
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

ledgerRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const parsed = txnIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid transaction id" });
    return;
  }
  const { householdId, role, personProfileId } = req.authUser!;

  if (role === "member") {
    const tx = await qGet<{ owner_person_profile_id: string | null }>(
      `SELECT owner_person_profile_id FROM transaction_canonical WHERE id = ? AND household_id = ?`,
      parsed.data.id,
      householdId
    );
    if (!tx) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }
    if (tx.owner_person_profile_id !== personProfileId) {
      res.status(403).json({ message: "You can only delete your own transactions." });
      return;
    }
  }

  const txnSnap = await qGet<{ account_id: string; amount: string; txn_date: string }>(
    `SELECT account_id, amount, txn_date FROM transaction_canonical WHERE id = ? AND household_id = ?`,
    parsed.data.id,
    householdId
  );

  const out = await hardDeleteTransaction(householdId, parsed.data.id);
  if (!out.ok) {
    res.status(out.code === "NOT_FOUND" ? 404 : 409).json({ message: out.code });
    return;
  }

  if (txnSnap) {
    await computeAndUpsertCashBalanceIfApplicable(
      householdId,
      txnSnap.account_id,
      String(txnSnap.txn_date).slice(0, 10),
      -Number(txnSnap.amount)
    );
  }
  res.status(204).send();
});

const pairSchema = z.object({
  ids: z.array(z.string().uuid()).length(2)
});

const groupIdParamSchema = z.object({
  groupId: z.string().uuid()
});

ledgerRouter.post("/pair", async (req: AuthenticatedRequest, res) => {
  const parsed = pairSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload — provide ids: [uuid, uuid]", issues: parsed.error.flatten() });
    return;
  }
  const [id1, id2] = parsed.data.ids as [string, string];
  const householdId = req.authUser!.householdId;
  const out = await pairTransactions(householdId, id1, id2);
  if (!out.ok) {
    const status = out.code === "NOT_FOUND" ? 404 : 400;
    res.status(status).json({ message: out.message, code: out.code });
    return;
  }
  res.status(200).json({ transferGroupId: out.transferGroupId });
});

ledgerRouter.delete("/pair/:groupId", async (req: AuthenticatedRequest, res) => {
  const parsed = groupIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid groupId — must be a UUID" });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await unpairTransactions(householdId, parsed.data.groupId);
  if (!out.ok) {
    res.status(404).json({ message: "Transfer pair not found", code: out.code });
    return;
  }
  res.status(200).json({ unlinked: out.unlinked });
});

const bulkIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500)
});

ledgerRouter.post("/bulk-trash", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkIdsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    return;
  }
  const { householdId, role, personProfileId } = req.authUser!;
  if (role === "member") {
    if (!personProfileId) {
      res.status(403).json({ message: "Your account is not linked to a household profile." });
      return;
    }
    const { owned, notOwnedCount } = await filterOwnedTransactionIds(householdId, parsed.data.ids, personProfileId);
    const result = owned.length > 0 ? await bulkTrashTransactions(householdId, owned) : { trashed: 0, skipped: 0 };
    res.json({ ...result, skippedNotOwned: notOwnedCount });
    return;
  }
  const result = await bulkTrashTransactions(householdId, parsed.data.ids);
  res.json(result);
});

ledgerRouter.post("/bulk-restore", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkIdsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    return;
  }
  const { householdId, role, personProfileId } = req.authUser!;
  if (role === "member") {
    if (!personProfileId) {
      res.status(403).json({ message: "Your account is not linked to a household profile." });
      return;
    }
    const { owned, notOwnedCount } = await filterOwnedTransactionIds(householdId, parsed.data.ids, personProfileId);
    const result = owned.length > 0 ? await bulkRestoreTransactions(householdId, owned) : { restored: 0, skipped: 0 };
    res.json({ ...result, skippedNotOwned: notOwnedCount });
    return;
  }
  const result = await bulkRestoreTransactions(householdId, parsed.data.ids);
  res.json(result);
});

ledgerRouter.post("/bulk-delete", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkIdsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    return;
  }
  const { householdId, role, personProfileId } = req.authUser!;
  if (role === "member") {
    if (!personProfileId) {
      res.status(403).json({ message: "Your account is not linked to a household profile." });
      return;
    }
    const { owned, notOwnedCount } = await filterOwnedTransactionIds(householdId, parsed.data.ids, personProfileId);
    const result = owned.length > 0 ? await bulkHardDeleteTransactions(householdId, owned) : { deleted: 0, skipped: 0 };
    res.json({ ...result, skippedNotOwned: notOwnedCount });
    return;
  }
  const result = await bulkHardDeleteTransactions(householdId, parsed.data.ids);
  res.json(result);
});

const reassignOwnerSchema = z.object({
  fromPersonProfileId: z.string().uuid(),
  toPersonProfileId: z.string().uuid()
});

ledgerRouter.post("/bulk-reassign-owner", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = reassignOwnerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    return;
  }
  if (parsed.data.fromPersonProfileId === parsed.data.toPersonProfileId) {
    res.status(400).json({ message: "from and to must be different" });
    return;
  }
  const householdId = req.authUser!.householdId;
  const result = await bulkReassignOwner(householdId, parsed.data.fromPersonProfileId, parsed.data.toPersonProfileId);
  res.json(result);
});
