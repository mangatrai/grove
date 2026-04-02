import crypto from "node:crypto";

import { db } from "../../db/sqlite.js";
import { normalizeDescriptionForFingerprint } from "../canonical/transaction-fingerprint.js";
import { categoryHasChildren, categoryUsableByHousehold } from "./categories.service.js";
import type { DbCategoryRule } from "./category-rules.js";

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
         id,
         pattern,
         match_type AS matchType,
         category_id AS categoryId,
         confidence
       FROM category_rule
       WHERE household_id = ? AND enabled = 1
       ORDER BY priority ASC, datetime(created_at) ASC, id ASC`
    )
    .all(householdId) as DbCategoryRule[];
  return rows;
}

type RuleValidationFailureCode = "INVALID_PATTERN" | "INVALID_CATEGORY" | "INVALID_CONFIDENCE" | "INVALID_PRIORITY";

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
