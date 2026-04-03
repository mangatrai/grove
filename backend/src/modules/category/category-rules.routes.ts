import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { normalizeDescriptionForFingerprint } from "../canonical/transaction-fingerprint.js";
import { recategorizeHouseholdTransactions } from "./category-recategorize.service.js";
import { classifyWithRules } from "./category-rules.js";
import { listRuleLearningPreviewForSession } from "./category-rule-learning.service.js";
import {
  bulkCreateCategoryRulesForHousehold,
  bulkCreateGlobalCategoryRules,
  createCategoryRuleForHousehold,
  createCategoryRulesFromPatterns,
  createGlobalCategoryRule,
  createRuleFromLedgerTransaction,
  deleteCategoryRuleForHousehold,
  deleteGlobalCategoryRule,
  listCategoryRulesForHousehold,
  listEnabledDbRulesForClassification,
  listGlobalCategoryRules,
  updateCategoryRuleForHousehold,
  updateGlobalCategoryRule
} from "./category-rules.service.js";

const matchTypeSchema = z.enum(["contains", "prefix", "regex"]);
const amountScopeSchema = z.enum(["any", "credit_only", "debit_only"]);

export const categoryRulesRouter = Router();
categoryRulesRouter.use(requireAuth);

categoryRulesRouter.get("/", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const rules = listCategoryRulesForHousehold(householdId);
  const builtinRules = listGlobalCategoryRules().map((b) => ({
    origin: "builtin" as const,
    id: b.id,
    ruleKey: b.ruleKey,
    pattern: b.pattern,
    matchType: b.matchType,
    categoryId: b.categoryId,
    amountScope: b.amountScope,
    confidence: b.confidence,
    priority: b.priority,
    enabled: b.enabled,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt
  }));
  res.status(200).json({ builtinRules, rules });
});

const createBodySchema = z
  .object({
    pattern: z.string().optional(),
    patterns: z.string().optional(),
    matchType: matchTypeSchema,
    categoryId: z.string().uuid(),
    confidence: z.number().min(0).max(1).optional().default(0.85),
    priority: z.number().int().min(0).max(10000).optional().default(100),
    enabled: z.boolean().optional().default(true)
  })
  .refine(
    (d) =>
      (typeof d.patterns === "string" && d.patterns.trim().length > 0) ||
      (typeof d.pattern === "string" && d.pattern.trim().length > 0),
    { message: "Provide pattern or patterns (multi-line / comma-separated)" }
  );

categoryRulesRouter.post("/", (req: AuthenticatedRequest, res) => {
  const parsed = createBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  const body = parsed.data;
  const multi = typeof body.patterns === "string" && body.patterns.trim().length > 0;

  if (multi) {
    const out = createCategoryRulesFromPatterns(householdId, {
      patternsRaw: body.patterns!,
      matchType: body.matchType,
      categoryId: body.categoryId,
      confidence: body.confidence,
      priority: body.priority,
      enabled: body.enabled
    });
    if (!out.ok) {
      res.status(400).json({ message: "Cannot create rules", code: out.code });
      return;
    }
    res.status(201).json({ rules: out.data });
    return;
  }

  const out = createCategoryRuleForHousehold(householdId, {
    pattern: body.pattern!,
    matchType: body.matchType,
    categoryId: body.categoryId,
    confidence: body.confidence,
    priority: body.priority,
    enabled: body.enabled
  });
  if (!out.ok) {
    res.status(400).json({ message: "Cannot create rule", code: out.code });
    return;
  }

  res.status(201).json({ rule: out.data });
});

const bulkHouseholdRowSchema = z
  .object({
    pattern: z.string(),
    matchType: matchTypeSchema,
    categoryId: z.string().uuid().optional(),
    categoryPath: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    priority: z.number().int().min(0).max(10000).optional(),
    enabled: z.boolean().optional()
  })
  .refine(
    (r) =>
      (typeof r.categoryId === "string" && r.categoryId.length > 0) ||
      (typeof r.categoryPath === "string" && r.categoryPath.trim().length > 0),
    { message: "Each rule needs categoryId or categoryPath" }
  );

const bulkHouseholdSchema = z.object({
  rules: z.array(bulkHouseholdRowSchema).min(1).max(2000)
});

categoryRulesRouter.post("/bulk", (req: AuthenticatedRequest, res) => {
  const parsed = bulkHouseholdSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = bulkCreateCategoryRulesForHousehold(householdId, parsed.data.rules);
  res.status(200).json({ created: out.created, errors: out.errors });
});

const bulkBuiltinRowSchema = z
  .object({
    pattern: z.string(),
    matchType: matchTypeSchema,
    categoryId: z.string().uuid().optional(),
    categoryPath: z.string().optional(),
    amountScope: amountScopeSchema,
    ruleKey: z.string().min(2).max(120).optional(),
    confidence: z.number().min(0).max(1).optional(),
    priority: z.number().int().min(0).max(10000).optional(),
    enabled: z.boolean().optional()
  })
  .refine(
    (r) =>
      (typeof r.categoryId === "string" && r.categoryId.length > 0) ||
      (typeof r.categoryPath === "string" && r.categoryPath.trim().length > 0),
    { message: "Each rule needs categoryId or categoryPath" }
  );

const bulkBuiltinSchema = z.object({
  rules: z.array(bulkBuiltinRowSchema).min(1).max(2000)
});

categoryRulesRouter.post("/builtin/bulk", requireRole(["owner", "admin"]), (req: AuthenticatedRequest, res) => {
  const parsed = bulkBuiltinSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = bulkCreateGlobalCategoryRules(householdId, parsed.data.rules);
  res.status(200).json({ created: out.created, errors: out.errors });
});

const createBuiltinBodySchema = z.object({
  ruleKey: z.string().min(2).max(120).optional(),
  pattern: z.string().min(2).max(120),
  matchType: matchTypeSchema,
  categoryId: z.string().uuid(),
  amountScope: amountScopeSchema,
  confidence: z.number().min(0).max(1).optional().default(0.7),
  priority: z.number().int().min(0).max(10000).optional().default(100),
  enabled: z.boolean().optional().default(true)
});

categoryRulesRouter.post("/builtin", requireRole(["owner", "admin"]), (req: AuthenticatedRequest, res) => {
  const parsed = createBuiltinBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  const ruleKey =
    b.ruleKey?.trim() ||
    `custom_${b.pattern
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 80)}`;
  const out = createGlobalCategoryRule({
    ruleKey,
    pattern: b.pattern,
    matchType: b.matchType,
    categoryId: b.categoryId,
    amountScope: b.amountScope,
    confidence: b.confidence,
    priority: b.priority,
    enabled: b.enabled
  });
  if (!out.ok) {
    const message =
      out.code === "BUILTIN_REQUIRES_GLOBAL_LEAF"
        ? "Built-in rules may only target installation default category leaves. Use a household classification rule for categories you created."
        : "Cannot create built-in rule";
    res.status(400).json({ message, code: out.code });
    return;
  }
  res.status(201).json({ rule: out.data });
});

const testSchema = z.object({
  description: z.string().max(2000),
  signedAmount: z.number().finite()
});

categoryRulesRouter.post("/test", (req: AuthenticatedRequest, res) => {
  const parsed = testSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const norm = normalizeDescriptionForFingerprint(parsed.data.description);
  const dbRules = listEnabledDbRulesForClassification(householdId);
  const classification = classifyWithRules(norm, parsed.data.signedAmount, dbRules);
  res.status(200).json({
    normalizedDescription: norm,
    classification
  });
});

const recategorizeSchema = z.object({
  mode: z.enum(["uncategorized_only", "all"]).default("uncategorized_only")
});

categoryRulesRouter.post("/recategorize", (req: AuthenticatedRequest, res) => {
  const parsed = recategorizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const result = recategorizeHouseholdTransactions(householdId, parsed.data.mode);
  res.status(200).json(result);
});

const fromLedgerSchema = z.object({
  transactionId: z.string().uuid(),
  categoryId: z.string().uuid(),
  matchType: matchTypeSchema,
  scope: z.enum(["contains", "prefix"]),
  confidence: z.number().min(0).max(1).optional().default(0.9),
  priority: z.number().int().min(0).max(10000).optional().default(100),
  enabled: z.boolean().optional().default(true)
});

categoryRulesRouter.post("/from-ledger", (req: AuthenticatedRequest, res) => {
  const parsed = fromLedgerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = createRuleFromLedgerTransaction(householdId, parsed.data.transactionId, {
    categoryId: parsed.data.categoryId,
    matchType: parsed.data.matchType,
    scope: parsed.data.scope,
    confidence: parsed.data.confidence,
    priority: parsed.data.priority,
    enabled: parsed.data.enabled
  });
  if (!out.ok) {
    if (out.code === "NOT_FOUND") {
      res.status(404).json({ message: "Transaction not found", code: out.code });
      return;
    }
    res.status(400).json({ message: "Cannot create rule", code: out.code });
    return;
  }
  res.status(201).json({ rule: out.data });
});

const previewSessionSchema = z.object({
  sessionId: z.string().uuid()
});

categoryRulesRouter.post("/rule-learning-preview", (req: AuthenticatedRequest, res) => {
  const parsed = previewSessionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const out = listRuleLearningPreviewForSession(parsed.data.sessionId, householdId);
  if (!out.ok) {
    res.status(404).json({ message: "Session not found", code: out.code });
    return;
  }
  res.status(200).json({ rows: out.rows });
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

const patchBuiltinSchema = z
  .object({
    ruleKey: z.string().min(2).max(120).optional(),
    pattern: z.string().min(2).max(120).optional(),
    matchType: matchTypeSchema.optional(),
    categoryId: z.string().uuid().optional(),
    amountScope: amountScopeSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    priority: z.number().int().min(0).max(10000).optional(),
    enabled: z.boolean().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

categoryRulesRouter.patch("/builtin/:id", requireRole(["owner", "admin"]), (req: AuthenticatedRequest, res) => {
  const parsed = patchBuiltinSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const out = updateGlobalCategoryRule(req.params.id, parsed.data);
  if (!out.ok) {
    if (out.code === "NOT_FOUND") {
      res.status(404).json({ message: "Rule not found", code: out.code });
      return;
    }
    const message =
      out.code === "BUILTIN_REQUIRES_GLOBAL_LEAF"
        ? "Built-in rules may only target installation default category leaves. Use a household classification rule for categories you created."
        : "Cannot update built-in rule";
    res.status(400).json({ message, code: out.code });
    return;
  }
  res.status(200).json({ rule: out.data });
});

categoryRulesRouter.delete("/builtin/:id", requireRole(["owner", "admin"]), (req: AuthenticatedRequest, res) => {
  const out = deleteGlobalCategoryRule(req.params.id);
  if (!out.ok) {
    res.status(404).json({ message: "Rule not found", code: out.code });
    return;
  }
  res.status(204).send();
});

categoryRulesRouter.delete("/:id", (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const out = deleteCategoryRuleForHousehold(householdId, req.params.id);
  if (!out.ok) {
    res.status(404).json({ message: "Rule not found", code: out.code });
    return;
  }
  res.status(204).send();
});
