/**
 * Rules assign **leaf** `category_id` values from `DEFAULT_CATEGORY_IDS` / seed (Epic 5.3 hierarchy).
 * Additional leaves (e.g. medical, dining out) use ids from `category-ids.ts` and migrations.
 * Parents (e.g. Shopping, Home, Income) are for roll-up only; rules do not target parent rows.
 */
export interface ClassificationResult {
  /** Matched default category id, or null if no conservative rule fired. */
  categoryId: string | null;
  /** Stable id for tests / debugging (not stored on row). */
  ruleId: string | null;
  /** Rule source for explainability. */
  source: "household" | "builtin" | "none";
  /** Confidence score in range [0,1]. */
  confidence: number;
  /** Human-readable explanation used by review queue / ledger context. */
  reason: string;
}

export type RuleAmountScope = "any" | "credit_only" | "debit_only";

export interface DbCategoryRule {
  id: string;
  pattern: string;
  matchType: "contains" | "prefix" | "regex";
  categoryId: string;
  confidence: number;
  amountScope: RuleAmountScope;
  ruleOrigin: "household" | "global";
}

export function amountMatchesScope(signedAmountRounded: number, scope: RuleAmountScope): boolean {
  if (scope === "any") {
    return true;
  }
  if (scope === "credit_only") {
    return signedAmountRounded > 0;
  }
  if (scope === "debit_only") {
    return signedAmountRounded < 0;
  }
  return false;
}

export function classifyWithRules(
  normalizedDescription: string,
  signedAmountRounded: number,
  dbRules: DbCategoryRule[]
): ClassificationResult {
  const t = normalizedDescription.trim();
  if (t.length === 0) {
    return noMatch("Description is empty after normalization.");
  }

  for (const rule of dbRules) {
    if (!amountMatchesScope(signedAmountRounded, rule.amountScope)) {
      continue;
    }
    if (matchesRule(t, rule)) {
      const source: ClassificationResult["source"] = rule.ruleOrigin === "household" ? "household" : "builtin";
      const label = source === "household" ? "household" : "built-in";
      return {
        categoryId: rule.categoryId,
        ruleId: rule.id,
        source,
        confidence: clampConfidence(rule.confidence),
        reason: `Matched ${rule.matchType} ${label} rule pattern "${rule.pattern}".`
      };
    }
  }

  return noMatch("No category rule matched.");
}

function matchesRule(normalizedDescription: string, rule: Pick<DbCategoryRule, "pattern" | "matchType">): boolean {
  if (!rule.pattern) {
    return false;
  }
  if (rule.matchType === "contains") {
    return normalizedDescription.includes(rule.pattern);
  }
  if (rule.matchType === "prefix") {
    return normalizedDescription.startsWith(rule.pattern);
  }
  try {
    const re = new RegExp(rule.pattern, "i");
    return re.test(normalizedDescription);
  } catch {
    return false;
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function noMatch(reason: string): ClassificationResult {
  return { categoryId: null, ruleId: null, source: "none", confidence: 0, reason };
}
