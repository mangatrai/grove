import crypto from "node:crypto";

import { isPgUniqueViolation, qAll, qExec, qGet } from "../../db/query.js";
import { normalizeDescriptionForFingerprint } from "../canonical/transaction-fingerprint.js";
import {
  categoryAssignableForGlobalBuiltin,
  categoryHasChildren,
  categoryUsableByHousehold,
  resolveLeafCategoryIdForHousehold
} from "./categories.service.js";
import type { DbCategoryRule, RuleAmountScope } from "./category-rules.js";

export interface CategoryRuleRow extends DbCategoryRule {
  householdId: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

type MatchType = CategoryRuleRow["matchType"];

interface CategoryRuleDbRow {
  id: string;
  householdId: string;
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  confidence: number;
  amountScope: RuleAmountScope;
  priority: number;
  enabled: number;
  createdAt: string;
  updatedAt: string;
}

function mapRule(row: CategoryRuleDbRow): CategoryRuleRow {
  return {
    id: row.id,
    householdId: row.householdId,
    pattern: row.pattern,
    matchType: row.matchType,
    categoryId: row.categoryId,
    confidence: row.confidence,
    amountScope: row.amountScope,
    ruleOrigin: "household",
    priority: row.priority,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizePattern(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Split user input into multiple patterns (newline first, then comma-separated per line).
 * Regex patterns containing commas should use one pattern per line.
 */
function splitPatternInput(raw: string): string[] {
  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    for (const piece of line.split(",")) {
      const t = piece.trim();
      if (t.length >= 2) {
        parts.push(t);
      }
    }
  }
  return parts;
}

function isPatternValid(pattern: string, matchType: MatchType): boolean {
  if (pattern.length < 2 || pattern.length > 120) {
    return false;
  }
  if (matchType === "regex") {
    try {
      // Compile once during validation to catch bad regex upfront.
      new RegExp(pattern, "i");
    } catch {
      return false;
    }
  }
  return true;
}

async function categoryAssignableByHousehold(categoryId: string, householdId: string): Promise<boolean> {
  if (!(await categoryUsableByHousehold(categoryId, householdId))) {
    return false;
  }
  return !(await categoryHasChildren(categoryId));
}

export async function listCategoryRulesForHousehold(householdId: string): Promise<CategoryRuleRow[]> {
  const rows = await qAll<CategoryRuleDbRow>(
    `SELECT
         id,
         household_id AS "householdId",
         pattern,
         match_type AS "matchType",
         category_id AS "categoryId",
         confidence,
         amount_scope AS "amountScope",
         priority,
         enabled,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM category_rule
       WHERE household_id = ?
       ORDER BY enabled DESC, priority ASC, created_at ASC, id ASC`,
    householdId
  );

  return rows.map(mapRule);
}

export async function listEnabledDbRulesForClassification(householdId: string): Promise<DbCategoryRule[]> {
  const rows = await qAll<DbCategoryRule>(
    `SELECT
         m.id AS id,
         m.pattern AS pattern,
         m.match_type AS "matchType",
         m.category_id AS "categoryId",
         m.confidence AS confidence,
         m.amount_scope AS "amountScope",
         m.rule_origin AS "ruleOrigin"
       FROM (
         SELECT
           id,
           pattern,
           match_type,
           category_id,
           confidence,
           amount_scope,
           'household' AS rule_origin,
           0 AS seg,
           priority,
           created_at,
           id AS sid
         FROM category_rule
         WHERE household_id = ? AND enabled = 1
         UNION ALL
         SELECT
           id,
           pattern,
           match_type,
           category_id,
           confidence,
           amount_scope,
           'global' AS rule_origin,
           1 AS seg,
           priority,
           created_at,
           id AS sid
         FROM category_rule_global
         WHERE enabled = 1
       ) AS m
       ORDER BY m.seg ASC, m.priority ASC, m.created_at ASC, m.sid ASC`,
    householdId
  );
  return rows;
}

export interface GlobalCategoryRuleRow {
  id: string;
  ruleKey: string;
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  amountScope: RuleAmountScope;
  confidence: number;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface GlobalRuleDbRow {
  id: string;
  ruleKey: string;
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  amountScope: RuleAmountScope;
  confidence: number;
  priority: number;
  enabled: number;
  createdAt: string;
  updatedAt: string;
}

function mapGlobalRule(row: GlobalRuleDbRow): GlobalCategoryRuleRow {
  return {
    id: row.id,
    ruleKey: row.ruleKey,
    pattern: row.pattern,
    matchType: row.matchType,
    categoryId: row.categoryId,
    amountScope: row.amountScope,
    confidence: row.confidence,
    priority: row.priority,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export async function listGlobalCategoryRules(): Promise<GlobalCategoryRuleRow[]> {
  const rows = await qAll<GlobalRuleDbRow>(
    `SELECT
         id,
         rule_key AS "ruleKey",
         pattern,
         match_type AS "matchType",
         category_id AS "categoryId",
         amount_scope AS "amountScope",
         confidence,
         priority,
         enabled,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM category_rule_global
       ORDER BY enabled DESC, priority ASC, created_at ASC, id ASC`
  );

  return rows.map(mapGlobalRule);
}

export async function createGlobalCategoryRule(
  input: {
    ruleKey: string;
    pattern: string;
    matchType: MatchType;
    categoryId: string;
    amountScope: RuleAmountScope;
    confidence: number;
    priority: number;
    enabled: boolean;
  },
  opts?: { skipGlobalBuiltinAssignableCheck?: boolean }
): Promise<{ ok: true; data: GlobalCategoryRuleRow } | CreateRuleFailure> {
  const pattern = normalizePattern(input.pattern);
  if (!isPatternValid(pattern, input.matchType)) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    return { ok: false, code: "INVALID_CONFIDENCE" };
  }
  if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 10000) {
    return { ok: false, code: "INVALID_PRIORITY" };
  }
  const rk = input.ruleKey.trim().toLowerCase().replace(/\s+/g, "_");
  if (rk.length < 2 || rk.length > 120) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  if (
    !opts?.skipGlobalBuiltinAssignableCheck &&
    !(await categoryAssignableForGlobalBuiltin(input.categoryId))
  ) {
    return { ok: false, code: "BUILTIN_REQUIRES_GLOBAL_LEAF" };
  }

  const id = crypto.randomUUID();
  try {
    await qExec(
      `INSERT INTO category_rule_global (
         id, rule_key, pattern, match_type, category_id, amount_scope, confidence, priority, enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      rk,
      pattern,
      input.matchType,
      input.categoryId,
      input.amountScope,
      input.confidence,
      input.priority,
      input.enabled ? 1 : 0
    );
  } catch (e: unknown) {
    if (isPgUniqueViolation(e)) {
      return { ok: false, code: "INVALID_PATTERN" };
    }
    throw e;
  }

  const row = (await qGet<GlobalRuleDbRow>(
    `SELECT
         id,
         rule_key AS "ruleKey",
         pattern,
         match_type AS "matchType",
         category_id AS "categoryId",
         amount_scope AS "amountScope",
         confidence,
         priority,
         enabled,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM category_rule_global
       WHERE id = ?`,
    id
  ))!;
  return { ok: true, data: mapGlobalRule(row) };
}

export async function updateGlobalCategoryRule(
  ruleId: string,
  updates: {
    ruleKey?: string;
    pattern?: string;
    matchType?: MatchType;
    categoryId?: string;
    amountScope?: RuleAmountScope;
    confidence?: number;
    priority?: number;
    enabled?: boolean;
  }
): Promise<{ ok: true; data: GlobalCategoryRuleRow } | UpdateRuleFailure> {
  const existing = await qGet<GlobalRuleDbRow>(
    `SELECT
         id,
         rule_key AS "ruleKey",
         pattern,
         match_type AS "matchType",
         category_id AS "categoryId",
         amount_scope AS "amountScope",
         confidence,
         priority,
         enabled,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM category_rule_global
       WHERE id = ?`,
    ruleId
  );
  if (!existing) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const nextKeyRaw = updates.ruleKey !== undefined ? updates.ruleKey.trim().toLowerCase().replace(/\s+/g, "_") : existing.ruleKey;
  const nextPattern = normalizePattern(updates.pattern ?? existing.pattern);
  const nextMatchType = updates.matchType ?? existing.matchType;
  const nextCategoryId = updates.categoryId ?? existing.categoryId;
  const nextAmountScope = updates.amountScope ?? existing.amountScope;
  const nextConfidence = updates.confidence ?? existing.confidence;
  const nextPriority = updates.priority ?? existing.priority;
  const nextEnabled = updates.enabled ?? (existing.enabled === 1);

  if (nextKeyRaw.length < 2 || nextKeyRaw.length > 120) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  if (!isPatternValid(nextPattern, nextMatchType)) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  if (!Number.isFinite(nextConfidence) || nextConfidence < 0 || nextConfidence > 1) {
    return { ok: false, code: "INVALID_CONFIDENCE" };
  }
  if (!Number.isInteger(nextPriority) || nextPriority < 0 || nextPriority > 10000) {
    return { ok: false, code: "INVALID_PRIORITY" };
  }
  if (!(await categoryAssignableForGlobalBuiltin(nextCategoryId))) {
    return { ok: false, code: "BUILTIN_REQUIRES_GLOBAL_LEAF" };
  }

  try {
    await qExec(
      `UPDATE category_rule_global
       SET rule_key = ?, pattern = ?, match_type = ?, category_id = ?, amount_scope = ?,
           confidence = ?, priority = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      nextKeyRaw,
      nextPattern,
      nextMatchType,
      nextCategoryId,
      nextAmountScope,
      nextConfidence,
      nextPriority,
      nextEnabled ? 1 : 0,
      ruleId
    );
  } catch (e: unknown) {
    if (isPgUniqueViolation(e)) {
      return { ok: false, code: "INVALID_PATTERN" };
    }
    throw e;
  }

  const row = (await qGet<GlobalRuleDbRow>(
    `SELECT
         id,
         rule_key AS "ruleKey",
         pattern,
         match_type AS "matchType",
         category_id AS "categoryId",
         amount_scope AS "amountScope",
         confidence,
         priority,
         enabled,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM category_rule_global
       WHERE id = ?`,
    ruleId
  ))!;
  return { ok: true, data: mapGlobalRule(row) };
}

export async function deleteGlobalCategoryRule(
  ruleId: string
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" }> {
  const del = await qGet<{ id: string }>(`DELETE FROM category_rule_global WHERE id = ? RETURNING id`, ruleId);
  if (!del) {
    return { ok: false, code: "NOT_FOUND" };
  }
  return { ok: true };
}

type RuleValidationFailureCode =
  | "INVALID_PATTERN"
  | "INVALID_CATEGORY"
  | "INVALID_CONFIDENCE"
  | "INVALID_PRIORITY"
  | "INVALID_AMOUNT_SCOPE"
  /** Global built-in rules may only target default (non–household-scoped) leaf categories. */
  | "BUILTIN_REQUIRES_GLOBAL_LEAF";

function isRuleAmountScope(v: unknown): v is RuleAmountScope {
  return v === "any" || v === "credit_only" || v === "debit_only";
}

export type CreateRuleFailure = { ok: false; code: RuleValidationFailureCode };

export async function createCategoryRuleForHousehold(
  householdId: string,
  input: {
    pattern: string;
    matchType: MatchType;
    categoryId: string;
    amountScope: RuleAmountScope;
    confidence: number;
    priority: number;
    enabled: boolean;
  },
  opts?: { skipCategoryAssignableCheck?: boolean }
): Promise<{ ok: true; data: CategoryRuleRow } | CreateRuleFailure> {
  const pattern = normalizePattern(input.pattern);
  if (!isPatternValid(pattern, input.matchType)) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  if (!isRuleAmountScope(input.amountScope)) {
    return { ok: false, code: "INVALID_AMOUNT_SCOPE" };
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    return { ok: false, code: "INVALID_CONFIDENCE" };
  }
  if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 10000) {
    return { ok: false, code: "INVALID_PRIORITY" };
  }
  if (
    !opts?.skipCategoryAssignableCheck &&
    !(await categoryAssignableByHousehold(input.categoryId, householdId))
  ) {
    return { ok: false, code: "INVALID_CATEGORY" };
  }

  const id = crypto.randomUUID();
  await qExec(
    `INSERT INTO category_rule (
       id, household_id, pattern, match_type, category_id, confidence, amount_scope, priority, enabled, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    id,
    householdId,
    pattern,
    input.matchType,
    input.categoryId,
    input.confidence,
    input.amountScope,
    input.priority,
    input.enabled ? 1 : 0
  );

  const row = (await qGet<CategoryRuleDbRow>(
    `SELECT
         id,
         household_id AS "householdId",
         pattern,
         match_type AS "matchType",
         category_id AS "categoryId",
         confidence,
         amount_scope AS "amountScope",
         priority,
         enabled,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM category_rule
       WHERE id = ? AND household_id = ?`,
    id,
    householdId
  ))!;
  return { ok: true, data: mapRule(row) };
}

export type BulkRuleRowError = { index: number; message: string; code?: string };

function bulkRuleResolveCacheKey(row: { categoryId?: string | null; categoryPath?: string | null }): string {
  return `${row.categoryId ?? ""}\u0001${row.categoryPath ?? ""}`;
}

export async function bulkCreateCategoryRulesForHousehold(
  householdId: string,
  rows: Array<{
    pattern: string;
    matchType: MatchType;
    categoryId?: string | null;
    categoryPath?: string | null;
    amountScope?: RuleAmountScope;
    confidence?: number;
    priority?: number;
    enabled?: boolean;
  }>
): Promise<{ created: CategoryRuleRow[]; errors: BulkRuleRowError[] }> {
  const created: CategoryRuleRow[] = [];
  const errors: BulkRuleRowError[] = [];
  const resolveCache = new Map<
    string,
    Awaited<ReturnType<typeof resolveLeafCategoryIdForHousehold>>
  >();
  const assignableByCategoryId = new Map<string, boolean>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const cacheKey = bulkRuleResolveCacheKey(row);
    let resolved = resolveCache.get(cacheKey);
    if (resolved === undefined) {
      resolved = await resolveLeafCategoryIdForHousehold(householdId, {
        categoryId: row.categoryId,
        categoryPath: row.categoryPath
      });
      resolveCache.set(cacheKey, resolved);
    }
    if (!resolved.ok) {
      const message =
        resolved.code === "MISSING_INPUT"
          ? "Provide category_id or category_path"
          : resolved.code === "AMBIGUOUS"
            ? "Ambiguous category path or name"
            : resolved.code === "NOT_LEAF"
              ? "category_id must be a leaf category"
              : "Category not found";
      errors.push({ index: i, code: resolved.code, message });
      continue;
    }

    let assignable = assignableByCategoryId.get(resolved.id);
    if (assignable === undefined) {
      assignable = await categoryAssignableByHousehold(resolved.id, householdId);
      assignableByCategoryId.set(resolved.id, assignable);
    }
    if (!assignable) {
      errors.push({ index: i, code: "INVALID_CATEGORY", message: "Category cannot be assigned" });
      continue;
    }

    const scope = row.amountScope ?? "any";
    if (!isRuleAmountScope(scope)) {
      errors.push({ index: i, code: "INVALID_AMOUNT_SCOPE", message: "Invalid amount_scope" });
      continue;
    }
    const out = await createCategoryRuleForHousehold(
      householdId,
      {
        pattern: row.pattern,
        matchType: row.matchType,
        categoryId: resolved.id,
        amountScope: scope,
        confidence: row.confidence ?? 0.85,
        priority: row.priority ?? 100,
        enabled: row.enabled ?? true
      },
      { skipCategoryAssignableCheck: true }
    );
    if (!out.ok) {
      errors.push({
        index: i,
        code: out.code,
        message:
          out.code === "INVALID_PATTERN"
            ? "Invalid pattern or regex"
            : out.code === "INVALID_CATEGORY"
              ? "Category cannot be assigned"
              : out.code === "INVALID_AMOUNT_SCOPE"
                ? "Invalid amount_scope"
                : `Cannot create rule (${out.code})`
      });
      continue;
    }
    created.push(out.data);
  }

  return { created, errors };
}

function autoRuleKeyFromPattern(pattern: string): string {
  return `custom_${pattern
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 80)}`;
}

export async function bulkCreateGlobalCategoryRules(
  householdId: string,
  rows: Array<{
    pattern: string;
    matchType: MatchType;
    categoryId?: string | null;
    categoryPath?: string | null;
    amountScope: RuleAmountScope;
    ruleKey?: string | null;
    confidence?: number;
    priority?: number;
    enabled?: boolean;
  }>
): Promise<{ created: GlobalCategoryRuleRow[]; errors: BulkRuleRowError[] }> {
  const created: GlobalCategoryRuleRow[] = [];
  const errors: BulkRuleRowError[] = [];
  const resolveCache = new Map<
    string,
    Awaited<ReturnType<typeof resolveLeafCategoryIdForHousehold>>
  >();
  const globalBuiltinAssignableByCategoryId = new Map<string, boolean>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const cacheKey = bulkRuleResolveCacheKey(row);
    let resolved = resolveCache.get(cacheKey);
    if (resolved === undefined) {
      resolved = await resolveLeafCategoryIdForHousehold(householdId, {
        categoryId: row.categoryId,
        categoryPath: row.categoryPath
      });
      resolveCache.set(cacheKey, resolved);
    }
    if (!resolved.ok) {
      const message =
        resolved.code === "MISSING_INPUT"
          ? "Provide category_id or category_path"
          : resolved.code === "AMBIGUOUS"
            ? "Ambiguous category path or name"
            : resolved.code === "NOT_LEAF"
              ? "category_id must be a leaf category"
              : "Category not found";
      errors.push({ index: i, code: resolved.code, message });
      continue;
    }
    let globalOk = globalBuiltinAssignableByCategoryId.get(resolved.id);
    if (globalOk === undefined) {
      globalOk = await categoryAssignableForGlobalBuiltin(resolved.id);
      globalBuiltinAssignableByCategoryId.set(resolved.id, globalOk);
    }
    if (!globalOk) {
      errors.push({
        index: i,
        code: "BUILTIN_REQUIRES_GLOBAL_LEAF",
        message:
          "Built-in rules may only target installation default category leaves (not household-created categories)."
      });
      continue;
    }

    const ruleKey = row.ruleKey?.trim() || autoRuleKeyFromPattern(row.pattern);

    const out = await createGlobalCategoryRule(
      {
        ruleKey,
        pattern: row.pattern,
        matchType: row.matchType,
        categoryId: resolved.id,
        amountScope: row.amountScope,
        confidence: row.confidence ?? 0.7,
        priority: row.priority ?? 100,
        enabled: row.enabled ?? true
      },
      { skipGlobalBuiltinAssignableCheck: true }
    );
    if (!out.ok) {
      const message =
        out.code === "BUILTIN_REQUIRES_GLOBAL_LEAF"
          ? "Built-in rules may only target installation default category leaves."
          : out.code === "INVALID_PATTERN"
            ? "Invalid pattern, rule key, or duplicate rule_key"
            : out.code === "INVALID_CONFIDENCE"
              ? "Invalid confidence"
              : out.code === "INVALID_PRIORITY"
                ? "Invalid priority"
                : `Cannot create rule (${out.code})`;
      errors.push({ index: i, code: out.code, message });
      continue;
    }
    created.push(out.data);
  }

  return { created, errors };
}

export async function createCategoryRulesFromPatterns(
  householdId: string,
  input: {
    patternsRaw: string;
    matchType: MatchType;
    categoryId: string;
    amountScope: RuleAmountScope;
    confidence: number;
    priority: number;
    enabled: boolean;
  }
): Promise<{ ok: true; data: CategoryRuleRow[] } | CreateRuleFailure> {
  const patterns = splitPatternInput(input.patternsRaw);
  if (patterns.length === 0) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  if (!isRuleAmountScope(input.amountScope)) {
    return { ok: false, code: "INVALID_AMOUNT_SCOPE" };
  }
  const created: CategoryRuleRow[] = [];
  for (let i = 0; i < patterns.length; i++) {
    const single = await createCategoryRuleForHousehold(householdId, {
      pattern: patterns[i]!,
      matchType: input.matchType,
      categoryId: input.categoryId,
      amountScope: input.amountScope,
      confidence: input.confidence,
      priority: input.priority + i,
      enabled: input.enabled
    });
    if (!single.ok) {
      return single;
    }
    created.push(single.data);
  }
  return { ok: true, data: created };
}

export async function createRuleFromLedgerTransaction(
  householdId: string,
  transactionId: string,
  input: {
    categoryId: string;
    matchType: MatchType;
    scope: "contains" | "prefix";
    amountScope: RuleAmountScope;
    confidence: number;
    priority: number;
    enabled: boolean;
  }
): Promise<{ ok: true; data: CategoryRuleRow } | CreateRuleFailure | { ok: false; code: "NOT_FOUND" }> {
  const row = await qGet<{ merchant: string | null; memo: string | null }>(
    `SELECT merchant AS merchant, memo AS memo
       FROM transaction_canonical
       WHERE id = ? AND household_id = ?`,
    transactionId,
    householdId
  );
  if (!row) {
    return { ok: false, code: "NOT_FOUND" };
  }
  const norm = normalizeDescriptionForFingerprint(`${row.merchant ?? ""} ${row.memo ?? ""}`.trim());
  if (norm.length < 2) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  let pattern = norm;
  if (input.scope === "prefix") {
    const words = norm.split(/\s+/).filter(Boolean);
    pattern = words.slice(0, 4).join(" ");
  }
  if (pattern.length < 2) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  return createCategoryRuleForHousehold(householdId, {
    pattern: pattern.slice(0, 120),
    matchType: input.matchType,
    categoryId: input.categoryId,
    amountScope: input.amountScope,
    confidence: input.confidence,
    priority: input.priority,
    enabled: input.enabled
  });
}

export type UpdateRuleFailure = { ok: false; code: "NOT_FOUND" | RuleValidationFailureCode };

export async function updateCategoryRuleForHousehold(
  householdId: string,
  ruleId: string,
  updates: {
    pattern?: string;
    matchType?: MatchType;
    categoryId?: string;
    amountScope?: RuleAmountScope;
    confidence?: number;
    priority?: number;
    enabled?: boolean;
  }
): Promise<{ ok: true; data: CategoryRuleRow } | UpdateRuleFailure> {
  const existing = await qGet<CategoryRuleDbRow>(
    `SELECT
         id,
         household_id AS "householdId",
         pattern,
         match_type AS "matchType",
         category_id AS "categoryId",
         confidence,
         amount_scope AS "amountScope",
         priority,
         enabled,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM category_rule
       WHERE id = ? AND household_id = ?`,
    ruleId,
    householdId
  );
  if (!existing) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const nextMatchType = updates.matchType ?? existing.matchType;
  const nextPattern = normalizePattern(updates.pattern ?? existing.pattern);
  const nextCategoryId = updates.categoryId ?? existing.categoryId;
  const nextAmountScope = updates.amountScope ?? existing.amountScope;
  const nextConfidence = updates.confidence ?? existing.confidence;
  const nextPriority = updates.priority ?? existing.priority;
  const nextEnabled = updates.enabled ?? (existing.enabled === 1);

  if (!isPatternValid(nextPattern, nextMatchType)) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  if (!isRuleAmountScope(nextAmountScope)) {
    return { ok: false, code: "INVALID_AMOUNT_SCOPE" };
  }
  if (!Number.isFinite(nextConfidence) || nextConfidence < 0 || nextConfidence > 1) {
    return { ok: false, code: "INVALID_CONFIDENCE" };
  }
  if (!Number.isInteger(nextPriority) || nextPriority < 0 || nextPriority > 10000) {
    return { ok: false, code: "INVALID_PRIORITY" };
  }
  if (!(await categoryAssignableByHousehold(nextCategoryId, householdId))) {
    return { ok: false, code: "INVALID_CATEGORY" };
  }

  await qExec(
    `UPDATE category_rule
     SET pattern = ?, match_type = ?, category_id = ?, confidence = ?, amount_scope = ?, priority = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND household_id = ?`,
    nextPattern,
    nextMatchType,
    nextCategoryId,
    nextConfidence,
    nextAmountScope,
    nextPriority,
    nextEnabled ? 1 : 0,
    ruleId,
    householdId
  );

  const row = (await qGet<CategoryRuleDbRow>(
    `SELECT
         id,
         household_id AS "householdId",
         pattern,
         match_type AS "matchType",
         category_id AS "categoryId",
         confidence,
         amount_scope AS "amountScope",
         priority,
         enabled,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM category_rule
       WHERE id = ? AND household_id = ?`,
    ruleId,
    householdId
  ))!;
  return { ok: true, data: mapRule(row) };
}

export async function deleteCategoryRuleForHousehold(
  householdId: string,
  ruleId: string
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" }> {
  const del = await qGet<{ id: string }>(
    `DELETE FROM category_rule WHERE id = ? AND household_id = ? RETURNING id`,
    ruleId,
    householdId
  );
  if (!del) {
    return { ok: false, code: "NOT_FOUND" };
  }
  return { ok: true };
}

/** Removes every household classification rule for this home (e.g. before re-importing a full CSV). */
export async function deleteAllCategoryRulesForHousehold(householdId: string): Promise<{ deleted: number }> {
  const rows = await qAll<{ id: string }>(
    `DELETE FROM category_rule WHERE household_id = ? RETURNING id`,
    householdId
  );
  return { deleted: rows.length };
}
