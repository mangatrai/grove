import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  bulkApplyCategoryByDescriptionPattern,
  bulkApplyCategoryToUnknownItems,
  bulkConfirmTransferPairsForHousehold,
  bulkUpdateResolutionStatusForHousehold,
  confirmTransferPairForHousehold,
  countOpenDuplicateAmbiguityNotOnLedger,
  countOpenResolutionItemsByType,
  findUnknownCategoryItemsByDescriptionPattern,
  listResolutionItemsForHousehold,
  updateResolutionStatusForHousehold,
  type ResolutionItemTypeFilter
} from "./resolution.service.js";

export const resolutionRouter = Router();
resolutionRouter.use(requireAuth);

const resolutionTypeEnum = z.enum([
  "all",
  "unknown_category",
  "duplicate_ambiguity",
  "transfer_ambiguity",
  "reconciliation_mismatch"
]);

const listQuerySchema = z.object({
  status: z.enum(["all", "open", "in_review", "resolved"]).optional().default("all"),
  type: resolutionTypeEnum.optional().default("all")
});

const bulkBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(["open", "in_review", "resolved"])
});

const bulkApplyCategorySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  categoryId: z.string().uuid()
});

const patternPreviewSchema = z.object({
  descriptionPattern: z.string().min(1).max(200)
});

const bulkApplyByPatternSchema = z.object({
  descriptionPattern: z.string().min(1).max(200),
  categoryId: z.string().uuid()
});

/** Preview: how many open unknown_category items match the description pattern? */
resolutionRouter.post("/pattern-preview", async (req: AuthenticatedRequest, res) => {
  const parsed = patternPreviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const items = await findUnknownCategoryItemsByDescriptionPattern(householdId, parsed.data.descriptionPattern);
  res.status(200).json({ matched: items.length, descriptions: items.slice(0, 5).map((i) => i.description) });
});

/** Apply a category to all open unknown_category items matching a description pattern. */
resolutionRouter.post("/bulk-apply-by-pattern", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkApplyByPatternSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await bulkApplyCategoryByDescriptionPattern(householdId, parsed.data.descriptionPattern, parsed.data.categoryId);
  if (!out.ok) {
    res.status(400).json({ message: "Category is not available for this household", code: out.code });
    return;
  }
  res.status(200).json({ updated: out.updated });
});

resolutionRouter.post("/bulk-apply-category", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkApplyCategorySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const uniqueIds = [...new Set(parsed.data.ids)];
  const out = await bulkApplyCategoryToUnknownItems(householdId, uniqueIds, parsed.data.categoryId);
  if (!out.ok) {
    res.status(400).json({ message: "Category is not available for this household", code: out.code });
    return;
  }
  res.status(200).json({ updated: out.updated, errors: out.errors });
});

resolutionRouter.post("/bulk", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const uniqueIds = [...new Set(parsed.data.ids)];
  const out = await bulkUpdateResolutionStatusForHousehold(householdId, uniqueIds, parsed.data.status);
  res.status(200).json(out);
});

resolutionRouter.get("/summary", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const openByType = await countOpenResolutionItemsByType(householdId);
  const totalOpen = Object.values(openByType).reduce((a, b) => a + b, 0);
  const openDuplicateAmbiguityNotOnLedger = await countOpenDuplicateAmbiguityNotOnLedger(householdId);
  res.status(200).json({ openByType, totalOpen, openDuplicateAmbiguityNotOnLedger });
});

resolutionRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const q = listQuerySchema.safeParse(req.query ?? {});
  if (!q.success) {
    res.status(400).json({ message: "Invalid query", issues: q.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const typeFilter = q.data.type as ResolutionItemTypeFilter;
  const items = await listResolutionItemsForHousehold(householdId, q.data.status, typeFilter);
  res.status(200).json({ items, status: q.data.status, type: q.data.type });
});

const statusSchema = z.object({
  status: z.enum(["open", "in_review", "resolved"])
});

const bulkConfirmTransfersSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200)
});

/**
 * POST /resolution/bulk-confirm-transfers
 * Confirm many transfer_ambiguity items as real transfers (best-effort).
 * Sets transfer_group_id on both legs and resolves both items for each pair.
 */
resolutionRouter.post("/bulk-confirm-transfers", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkConfirmTransfersSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const uniqueIds = [...new Set(parsed.data.ids)];
  const out = await bulkConfirmTransferPairsForHousehold(householdId, uniqueIds);
  res.status(200).json(out);
});

const confirmTransferSchema = z.object({
  creditId: z.string().uuid()
});

/**
 * POST /resolution/:id/confirm-transfer
 * Confirm a single transfer_ambiguity item as a real transfer.
 * Body: { creditId: string } — the user-selected credit transaction to pair with this debit.
 * Sets a shared transfer_group_id on both rows and resolves all open transfer_ambiguity items
 * for both legs. Use PATCH /resolution/:id { status: "resolved" } to dismiss without pairing.
 */
resolutionRouter.post("/:id/confirm-transfer", async (req: AuthenticatedRequest, res) => {
  const parsed = confirmTransferSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "creditId (UUID) is required", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await confirmTransferPairForHousehold(householdId, req.params.id, parsed.data.creditId);
  if (!out.ok) {
    if (out.code === "NOT_FOUND") {
      res.status(404).json({ message: out.message, code: out.code });
      return;
    }
    res.status(400).json({ message: out.message, code: out.code });
    return;
  }
  res.status(200).json(out.data);
});

resolutionRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const parsed = statusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  const out = await updateResolutionStatusForHousehold(householdId, req.params.id, parsed.data.status);
  if (!out.ok) {
    if (out.code === "NOT_FOUND") {
      res.status(404).json({ message: out.message, code: out.code });
      return;
    }
    res.status(409).json({ message: out.message, code: out.code, from: out.from, to: out.to });
    return;
  }

  res.status(200).json(out.data);
});
