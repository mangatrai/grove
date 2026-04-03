import crypto from "node:crypto";

import { db } from "../../db/sqlite.js";
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
    amountScope: "any",
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
export function splitPatternInput(raw: string): string[] {
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

function categoryAssignableByHousehold(categoryId: string, householdId: string): boolean {
  if (!categoryUsableByHousehold(categoryId, householdId)) {
    return false;
  }
  return !categoryHasChildren(categoryId);
}

export function listCategoryRulesForHousehold(householdId: string): CategoryRuleRow[] {
  const rows = db
    .prepare(
      `SELECT
         id,
         household_id AS householdId,
         pattern,
         match_type AS matchType,
         category_id AS categoryId,
         confidence,
         priority,
         enabled,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM category_rule
       WHERE household_id = ?
       ORDER BY enabled DESC, priority ASC, datetime(created_at) ASC, id ASC`
    )
    .all(householdId) as CategoryRuleDbRow[];

  return rows.map(mapRule);
}

export function listEnabledDbRulesForClassification(householdId: string): DbCategoryRule[] {
  const rows = db
    .prepare(
      `SELECT
         m.id AS id,
         m.pattern AS pattern,
         m.match_type AS matchType,
         m.category_id AS categoryId,
         m.confidence AS confidence,
         m.amount_scope AS amountScope,
         m.rule_origin AS ruleOrigin
       FROM (
         SELECT
           id,
           pattern,
           match_type,
           category_id,
           confidence,
           'any' AS amount_scope,
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
       ORDER BY m.seg ASC, m.priority ASC, datetime(m.created_at) ASC, m.sid ASC`
    )
    .all(householdId) as DbCategoryRule[];
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

export function listGlobalCategoryRules(): GlobalCategoryRuleRow[] {
  const rows = db
    .prepare(
      `SELECT
         id,
         rule_key AS ruleKey,
         pattern,
         match_type AS matchType,
         category_id AS categoryId,
         amount_scope AS amountScope,
         confidence,
         priority,
         enabled,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM category_rule_global
       ORDER BY enabled DESC, priority ASC, datetime(created_at) ASC, id ASC`
    )
    .all() as GlobalRuleDbRow[];

  return rows.map(mapGlobalRule);
}

export function createGlobalCategoryRule(input: {
  ruleKey: string;
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  amountScope: RuleAmountScope;
  confidence: number;
  priority: number;
  enabled: boolean;
}): { ok: true; data: GlobalCategoryRuleRow } | CreateRuleFailure {
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
  if (!categoryAssignableForGlobalBuiltin(input.categoryId)) {
    return { ok: false, code: "BUILTIN_REQUIRES_GLOBAL_LEAF" };
  }

  const id = crypto.randomUUID();
  try {
    db.prepare(
      `INSERT INTO category_rule_global (
         id, rule_key, pattern, match_type, category_id, amount_scope, confidence, priority, enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(
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
    const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      return { ok: false, code: "INVALID_PATTERN" };
    }
    throw e;
  }

  const row = db
    .prepare(
      `SELECT
         id,
         rule_key AS ruleKey,
         pattern,
         match_type AS matchType,
         category_id AS categoryId,
         amount_scope AS amountScope,
         confidence,
         priority,
         enabled,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM category_rule_global
       WHERE id = ?`
    )
    .get(id) as GlobalRuleDbRow;
  return { ok: true, data: mapGlobalRule(row) };
}

export function updateGlobalCategoryRule(
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
): { ok: true; data: GlobalCategoryRuleRow } | UpdateRuleFailure {
  const existing = db
    .prepare(
      `SELECT
         id,
         rule_key AS ruleKey,
         pattern,
         match_type AS matchType,
         category_id AS categoryId,
         amount_scope AS amountScope,
         confidence,
         priority,
         enabled,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM category_rule_global
       WHERE id = ?`
    )
    .get(ruleId) as GlobalRuleDbRow | undefined;
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
  if (!categoryAssignableForGlobalBuiltin(nextCategoryId)) {
    return { ok: false, code: "BUILTIN_REQUIRES_GLOBAL_LEAF" };
  }

  try {
    db.prepare(
      `UPDATE category_rule_global
       SET rule_key = ?, pattern = ?, match_type = ?, category_id = ?, amount_scope = ?,
           confidence = ?, priority = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
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
    const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      return { ok: false, code: "INVALID_PATTERN" };
    }
    throw e;
  }

  const row = db
    .prepare(
      `SELECT
         id,
         rule_key AS ruleKey,
         pattern,
         match_type AS matchType,
         category_id AS categoryId,
         amount_scope AS amountScope,
         confidence,
         priority,
         enabled,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM category_rule_global
       WHERE id = ?`
    )
    .get(ruleId) as GlobalRuleDbRow;
  return { ok: true, data: mapGlobalRule(row) };
}

export function deleteGlobalCategoryRule(ruleId: string): { ok: true } | { ok: false; code: "NOT_FOUND" } {
  const res = db.prepare(`DELETE FROM category_rule_global WHERE id = ?`).run(ruleId);
  if (res.changes === 0) {
    return { ok: false, code: "NOT_FOUND" };
  }
  return { ok: true };
}

type RuleValidationFailureCode =
  | "INVALID_PATTERN"
  | "INVALID_CATEGORY"
  | "INVALID_CONFIDENCE"
  | "INVALID_PRIORITY"
  /** Global built-in rules may only target default (non–household-scoped) leaf categories. */
  | "BUILTIN_REQUIRES_GLOBAL_LEAF";

export type CreateRuleFailure = { ok: false; code: RuleValidationFailureCode };

export function createCategoryRuleForHousehold(
  householdId: string,
  input: {
    pattern: string;
    matchType: MatchType;
    categoryId: string;
    confidence: number;
    priority: number;
    enabled: boolean;
  }
): { ok: true; data: CategoryRuleRow } | CreateRuleFailure {
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
  if (!categoryAssignableByHousehold(input.categoryId, householdId)) {
    return { ok: false, code: "INVALID_CATEGORY" };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO category_rule (
       id, household_id, pattern, match_type, category_id, confidence, priority, enabled, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(id, householdId, pattern, input.matchType, input.categoryId, input.confidence, input.priority, input.enabled ? 1 : 0);

  const row = db
    .prepare(
      `SELECT
         id,
         household_id AS householdId,
         pattern,
         match_type AS matchType,
         category_id AS categoryId,
         confidence,
         priority,
         enabled,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM category_rule
       WHERE id = ? AND household_id = ?`
    )
    .get(id, householdId) as CategoryRuleDbRow;
  return { ok: true, data: mapRule(row) };
}

export type BulkRuleRowError = { index: number; message: string; code?: string };

export function bulkCreateCategoryRulesForHousehold(
  householdId: string,
  rows: Array<{
    pattern: string;
    matchType: MatchType;
    categoryId?: string | null;
    categoryPath?: string | null;
    confidence?: number;
    priority?: number;
    enabled?: boolean;
  }>
): { created: CategoryRuleRow[]; errors: BulkRuleRowError[] } {
  const created: CategoryRuleRow[] = [];
  const errors: BulkRuleRowError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const resolved = resolveLeafCategoryIdForHousehold(householdId, {
      categoryId: row.categoryId,
      categoryPath: row.categoryPath
    });
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

    const out = createCategoryRuleForHousehold(householdId, {
      pattern: row.pattern,
      matchType: row.matchType,
      categoryId: resolved.id,
      confidence: row.confidence ?? 0.85,
      priority: row.priority ?? 100,
      enabled: row.enabled ?? true
    });
    if (!out.ok) {
      errors.push({
        index: i,
        code: out.code,
        message:
          out.code === "INVALID_PATTERN"
            ? "Invalid pattern or regex"
            : out.code === "INVALID_CATEGORY"
              ? "Category cannot be assigned"
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

export function bulkCreateGlobalCategoryRules(
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
): { created: GlobalCategoryRuleRow[]; errors: BulkRuleRowError[] } {
  const created: GlobalCategoryRuleRow[] = [];
  const errors: BulkRuleRowError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const resolved = resolveLeafCategoryIdForHousehold(householdId, {
      categoryId: row.categoryId,
      categoryPath: row.categoryPath
    });
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
    if (!categoryAssignableForGlobalBuiltin(resolved.id)) {
      errors.push({
        index: i,
        code: "BUILTIN_REQUIRES_GLOBAL_LEAF",
        message:
          "Built-in rules may only target installation default category leaves (not household-created categories)."
      });
      continue;
    }

    const ruleKey = row.ruleKey?.trim() || autoRuleKeyFromPattern(row.pattern);

    const out = createGlobalCategoryRule({
      ruleKey,
      pattern: row.pattern,
      matchType: row.matchType,
      categoryId: resolved.id,
      amountScope: row.amountScope,
      confidence: row.confidence ?? 0.7,
      priority: row.priority ?? 100,
      enabled: row.enabled ?? true
    });
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

export function createCategoryRulesFromPatterns(
  householdId: string,
  input: {
    patternsRaw: string;
    matchType: MatchType;
    categoryId: string;
    confidence: number;
    priority: number;
    enabled: boolean;
  }
): { ok: true; data: CategoryRuleRow[] } | CreateRuleFailure {
  const patterns = splitPatternInput(input.patternsRaw);
  if (patterns.length === 0) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  const created: CategoryRuleRow[] = [];
  for (let i = 0; i < patterns.length; i++) {
    const single = createCategoryRuleForHousehold(householdId, {
      pattern: patterns[i]!,
      matchType: input.matchType,
      categoryId: input.categoryId,
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

export function createRuleFromLedgerTransaction(
  householdId: string,
  transactionId: string,
  input: {
    categoryId: string;
    matchType: MatchType;
    scope: "contains" | "prefix";
    confidence: number;
    priority: number;
    enabled: boolean;
  }
): { ok: true; data: CategoryRuleRow } | CreateRuleFailure | { ok: false; code: "NOT_FOUND" } {
  const row = db
    .prepare(
      `SELECT merchant AS merchant, memo AS memo
       FROM transaction_canonical
       WHERE id = ? AND household_id = ?`
    )
    .get(transactionId, householdId) as { merchant: string | null; memo: string | null } | undefined;
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
    confidence: input.confidence,
    priority: input.priority,
    enabled: input.enabled
  });
}

export type UpdateRuleFailure = { ok: false; code: "NOT_FOUND" | RuleValidationFailureCode };

export function updateCategoryRuleForHousehold(
  householdId: string,
  ruleId: string,
  updates: {
    pattern?: string;
    matchType?: MatchType;
    categoryId?: string;
    confidence?: number;
    priority?: number;
    enabled?: boolean;
  }
): { ok: true; data: CategoryRuleRow } | UpdateRuleFailure {
  const existing = db
    .prepare(
      `SELECT
         id,
         household_id AS householdId,
         pattern,
         match_type AS matchType,
         category_id AS categoryId,
         confidence,
         priority,
         enabled,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM category_rule
       WHERE id = ? AND household_id = ?`
    )
    .get(ruleId, householdId) as CategoryRuleDbRow | undefined;
  if (!existing) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const nextMatchType = updates.matchType ?? existing.matchType;
  const nextPattern = normalizePattern(updates.pattern ?? existing.pattern);
  const nextCategoryId = updates.categoryId ?? existing.categoryId;
  const nextConfidence = updates.confidence ?? existing.confidence;
  const nextPriority = updates.priority ?? existing.priority;
  const nextEnabled = updates.enabled ?? (existing.enabled === 1);

  if (!isPatternValid(nextPattern, nextMatchType)) {
    return { ok: false, code: "INVALID_PATTERN" };
  }
  if (!Number.isFinite(nextConfidence) || nextConfidence < 0 || nextConfidence > 1) {
    return { ok: false, code: "INVALID_CONFIDENCE" };
  }
  if (!Number.isInteger(nextPriority) || nextPriority < 0 || nextPriority > 10000) {
    return { ok: false, code: "INVALID_PRIORITY" };
  }
  if (!categoryAssignableByHousehold(nextCategoryId, householdId)) {
    return { ok: false, code: "INVALID_CATEGORY" };
  }

  db.prepare(
    `UPDATE category_rule
     SET pattern = ?, match_type = ?, category_id = ?, confidence = ?, priority = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND household_id = ?`
  ).run(nextPattern, nextMatchType, nextCategoryId, nextConfidence, nextPriority, nextEnabled ? 1 : 0, ruleId, householdId);

  const row = db
    .prepare(
      `SELECT
         id,
         household_id AS householdId,
         pattern,
         match_type AS matchType,
         category_id AS categoryId,
         confidence,
         priority,
         enabled,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM category_rule
       WHERE id = ? AND household_id = ?`
    )
    .get(ruleId, householdId) as CategoryRuleDbRow;
  return { ok: true, data: mapRule(row) };
}

export function deleteCategoryRuleForHousehold(
  householdId: string,
  ruleId: string
): { ok: true } | { ok: false; code: "NOT_FOUND" } {
  const res = db.prepare(`DELETE FROM category_rule WHERE id = ? AND household_id = ?`).run(ruleId, householdId);
  if (res.changes === 0) {
    return { ok: false, code: "NOT_FOUND" };
  }
  return { ok: true };
}
