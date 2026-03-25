import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createHouseholdCategory,
  deleteHouseholdCategory,
  listCategoriesForHousehold,
  updateHouseholdCategory
} from "./categories.service.js";

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get("/", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const categories = listCategoriesForHousehold(householdId);
  res.status(200).json({ categories });
});

const createBodySchema = z.object({
  name: z.string().min(1),
  parentId: z.union([z.string().uuid(), z.null()]).optional().default(null)
});

categoriesRouter.post("/", (req: AuthenticatedRequest, res) => {
  const parsed = createBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = createHouseholdCategory(householdId, parsed.data.name, parsed.data.parentId ?? null);
  if (!out.ok) {
    if (out.code === "INVALID_NAME") {
      res.status(400).json({ message: "Name is required", code: out.code });
      return;
    }
    if (out.code === "INVALID_PARENT" || out.code === "MAX_DEPTH") {
      res.status(400).json({ message: "Invalid parent for subcategory", code: out.code });
      return;
    }
    res.status(400).json({ message: "Cannot create category", code: out.code });
    return;
  }
  res.status(201).json({ category: out.data });
});

const patchBodySchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.union([z.string().uuid(), z.null()]).optional()
});

categoriesRouter.patch("/:id", (req: AuthenticatedRequest, res) => {
  const parsed = patchBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = updateHouseholdCategory(householdId, req.params.id, parsed.data);
  if (!out.ok) {
    if (out.code === "NOT_FOUND") {
      res.status(404).json({ message: "Category not found", code: out.code });
      return;
    }
    if (out.code === "FORBIDDEN") {
      res.status(403).json({ message: "Not allowed to edit this category", code: out.code });
      return;
    }
    res.status(400).json({ message: "Cannot update category", code: out.code });
    return;
  }
  res.status(200).json({ category: out.data });
});

categoriesRouter.delete("/:id", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const out = deleteHouseholdCategory(householdId, req.params.id);
  if (!out.ok) {
    if (out.code === "NOT_FOUND") {
      res.status(404).json({ message: "Category not found", code: out.code });
      return;
    }
    if (out.code === "FORBIDDEN") {
      res.status(403).json({ message: "Not allowed to delete this category", code: out.code });
      return;
    }
    if (out.code === "HAS_CHILDREN") {
      res.status(409).json({ message: "Remove or reassign subcategories first", code: out.code });
      return;
    }
    if (out.code === "IN_USE") {
      res.status(409).json({ message: "Category is used by ledger rows", code: out.code });
      return;
    }
    res.status(400).json({ message: "Cannot delete category", code: out.code });
    return;
  }
  res.status(204).send();
});
