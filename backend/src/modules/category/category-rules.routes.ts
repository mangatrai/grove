import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createCategoryRuleForHousehold,
  listCategoryRulesForHousehold,
  updateCategoryRuleForHousehold
} from "./category-rules.service.js";

const matchTypeSchema = z.enum(["contains", "prefix", "regex"]);

export const categoryRulesRouter = Router();
categoryRulesRouter.use(requireAuth);

categoryRulesRouter.get("/", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const rules = listCategoryRulesForHousehold(householdId);
  res.status(200).json({ rules });
});

const createSchema = z.object({
  pattern: z.string().min(1),
  matchType: matchTypeSchema,
  categoryId: z.string().uuid(),
  confidence: z.number().min(0).max(1).optional().default(0.85),
  priority: z.number().int().min(0).max(10000).optional().default(100),
  enabled: z.boolean().optional().default(true)
});

categoryRulesRouter.post("/", (req: AuthenticatedRequest, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  const out = createCategoryRuleForHousehold(householdId, parsed.data);
  if (!out.ok) {
    res.status(400).json({ message: "Cannot create rule", code: out.code });
    return;
  }

  res.status(201).json({ rule: out.data });
});

const patchSchema = z
  .object({
    pattern: z.string().min(1).optional(),
    matchType: matchTypeSchema.optional(),
    categoryId: z.string().uuid().optional(),
    confidence: z.number().min(0).max(1).optional(),
    priority: z.number().int().min(0).max(10000).optional(),
    enabled: z.boolean().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

categoryRulesRouter.patch("/:id", (req: AuthenticatedRequest, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  const out = updateCategoryRuleForHousehold(householdId, req.params.id, parsed.data);
  if (!out.ok) {
    if (out.code === "NOT_FOUND") {
      res.status(404).json({ message: "Rule not found", code: out.code });
      return;
    }
    res.status(400).json({ message: "Cannot update rule", code: out.code });
    return;
  }

  res.status(200).json({ rule: out.data });
});
