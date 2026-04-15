import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import {
  createHouseholdCategory,
  deleteHouseholdCategory,
  getCategoryHouseholdId,
  listCategoriesForHousehold,
  updateDefaultCategory,
  updateHouseholdCategory
} from "./categories.service.js";

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const categories = await listCategoriesForHousehold(householdId);
  res.status(200).json({ categories });
});

const createBodySchema = z.object({
  name: z.string().min(1),
  parentId: z.union([z.string().uuid(), z.null()]).optional().default(null)
});

categoriesRouter.post("/", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = createBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = await createHouseholdCategory(householdId, parsed.data.name, parsed.data.parentId ?? null);
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

categoriesRouter.patch("/:id", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = patchBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const role = req.authUser!.role;
  const scope = await getCategoryHouseholdId(req.params.id);
  if (scope === undefined) {
    res.status(404).json({ message: "Category not found", code: "NOT_FOUND" });
    return;
  }

  const out =
    scope === null
      ? role === "owner" || role === "admin"
        ? await updateDefaultCategory(householdId, req.params.id, parsed.data)
        : { ok: false as const, code: "FORBIDDEN" as const }
      : scope === householdId
        ? await updateHouseholdCategory(householdId, req.params.id, parsed.data)
        : { ok: false as const, code: "NOT_FOUND" as const };

  if (!out.ok) {
    if (out.code === "NOT_FOUND") {
      res.status(404).json({ message: "Category not found", code: out.code });
      return;
    }
    if (out.code === "FORBIDDEN") {
      res.status(403).json({
        message:
          scope === null
            ? "Only owners and admins can edit built-in categories for this installation"
            : "Not allowed to edit this category",
        code: out.code
      });
      return;
    }
    if (out.code === "INVALID_REPARENT") {
      res.status(400).json({
        message: "Remove or reassign subcategories before moving this group under another parent",
        code: out.code
      });
      return;
    }
    if (out.code === "INVALID_NAME") {
      res.status(400).json({ message: "Name is required", code: out.code });
      return;
    }
    if (out.code === "INVALID_PARENT" || out.code === "MAX_DEPTH") {
      res.status(400).json({ message: "Invalid parent for subcategory", code: out.code });
      return;
    }
    if (out.code === "CYCLE") {
      res.status(400).json({ message: "Invalid parent", code: out.code });
      return;
    }
    res.status(400).json({ message: "Cannot update category", code: out.code });
    return;
  }
  res.status(200).json({ category: out.data });
});

categoriesRouter.delete("/:id", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const scope = await getCategoryHouseholdId(req.params.id);
  if (scope === undefined) {
    res.status(404).json({ message: "Category not found", code: "NOT_FOUND" });
    return;
  }
  if (scope === null) {
    res.status(403).json({
      message: "Built-in categories cannot be deleted; rename them or hide via classification rules",
      code: "BUILTIN_READONLY"
    });
    return;
  }
  if (scope !== householdId) {
    res.status(404).json({ message: "Category not found", code: "NOT_FOUND" });
    return;
  }

  const out = await deleteHouseholdCategory(householdId, req.params.id);
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
