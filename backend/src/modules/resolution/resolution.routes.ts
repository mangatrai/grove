import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  bulkApplyCategoryToUnknownItems,
  bulkUpdateResolutionStatusForHousehold,
  countOpenResolutionItemsByType,
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

resolutionRouter.post("/bulk-apply-category", (req: AuthenticatedRequest, res) => {
  const parsed = bulkApplyCategorySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const uniqueIds = [...new Set(parsed.data.ids)];
  const out = bulkApplyCategoryToUnknownItems(householdId, uniqueIds, parsed.data.categoryId);
  if (!out.ok) {
    res.status(400).json({ message: "Category is not available for this household", code: out.code });
    return;
  }
  res.status(200).json({ updated: out.updated, errors: out.errors });
});

resolutionRouter.post("/bulk", (req: AuthenticatedRequest, res) => {
  const parsed = bulkBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const uniqueIds = [...new Set(parsed.data.ids)];
  const out = bulkUpdateResolutionStatusForHousehold(householdId, uniqueIds, parsed.data.status);
  res.status(200).json(out);
});

resolutionRouter.get("/summary", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const openByType = countOpenResolutionItemsByType(householdId);
  const totalOpen = Object.values(openByType).reduce((a, b) => a + b, 0);
  res.status(200).json({ openByType, totalOpen });
});

resolutionRouter.get("/", (req: AuthenticatedRequest, res) => {
  const q = listQuerySchema.safeParse(req.query ?? {});
  if (!q.success) {
    res.status(400).json({ message: "Invalid query", issues: q.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const typeFilter = q.data.type as ResolutionItemTypeFilter;
  const items = listResolutionItemsForHousehold(householdId, q.data.status, typeFilter);
  res.status(200).json({ items, status: q.data.status, type: q.data.type });
});

const statusSchema = z.object({
  status: z.enum(["open", "in_review", "resolved"])
});

resolutionRouter.patch("/:id", (req: AuthenticatedRequest, res) => {
  const parsed = statusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  const out = updateResolutionStatusForHousehold(householdId, req.params.id, parsed.data.status);
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
