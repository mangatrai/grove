import { DEFAULT_CATEGORY_IDS } from "./category-ids.js";

/**
 * Rules assign **leaf** `category_id` values from `DEFAULT_CATEGORY_IDS` / seed (Epic 5.3 hierarchy).
 * Additional leaves (e.g. medical, dining out) use ids from `category-ids.ts` and migrations.
 * Parents (e.g. Shopping, Home & utilities, Income) are for roll-up only; rules do not target parent rows.
 */
export interface ClassificationResult {
  /** Matched default category id, or null if no conservative rule fired. */
  categoryId: string | null;
  /** Stable id for tests / debugging (not stored on row). */
  ruleId: string | null;
  /** Rule source for explainability. */
  source: "db" | "default" | "none";
  /** Confidence score in range [0,1]. */
  confidence: number;
  /** Human-readable explanation used by review queue / ledger context. */
  reason: string;
}

export interface DbCategoryRule {
  id: string;
  pattern: string;
  matchType: "contains" | "prefix" | "regex";
  categoryId: string;
  confidence: number;
}

/**
 * Conservative substring rules on **fingerprint-normalized** description (lowercase, alnum + spaces).
 * First matching rule wins. Designed for Epic 5.1 baseline — expand via DB-driven rules later.
 */
export function classifyDefaultCategory(
  normalizedDescription: string,
  signedAmountRounded: number
): ClassificationResult {
  const t = normalizedDescription.trim();
  if (t.length === 0) {
    return {
      categoryId: null,
      ruleId: null,
      source: "none",
      confidence: 0,
      reason: "Description is empty after normalization."
    };
  }

  const inflow = signedAmountRounded > 0;
  const outflow = signedAmountRounded < 0;

  if (inflow) {
    // Income leaves (conservative inflow keywords)
    if (includesAny(t, ["refund"])) {
      return defaultMatch(DEFAULT_CATEGORY_IDS.incomeRefunds, "income_refunds_keywords", "Matched inflow refund keywords.");
    }

    if (includesAny(t, ["rental income"])) {
      return defaultMatch(
        DEFAULT_CATEGORY_IDS.incomeRentalIncome,
        "income_rental_income_keywords",
        "Matched inflow rental income keywords."
      );
    }

    if (includesAny(t, ["interest", "int pymt", "int payment"])) {
      return defaultMatch(DEFAULT_CATEGORY_IDS.incomeInterest, "income_interest", "Matched inflow interest keywords.");
    }

    if (includesAny(t, ["dividend"])) {
      return defaultMatch(DEFAULT_CATEGORY_IDS.incomeDividends, "income_dividends", "Matched inflow dividend keywords.");
    }

    if (includesAny(t, ["payroll", "direct dep", "salary", "pay check", "paycheck", "commission"])) {
      return defaultMatch(
        DEFAULT_CATEGORY_IDS.incomeSalary,
        "income_salary_inflow_keywords",
        "Matched inflow payroll/salary keywords."
      );
    }
    return noMatch("No conservative default inflow rule matched.");
  }

  if (!outflow) {
    return noMatch("Amount is zero; default rules only classify inflow/outflow transactions.");
  }

  if (includesAny(t, ["mortgage", " mtg", "rent ", " rent", "hoa", "landlord", "lease"])) {
    return defaultMatch(DEFAULT_CATEGORY_IDS.housing, "housing_keywords", "Matched housing payment keywords.");
  }

  if (
    includesAny(t, [
      "electric",
      "water bill",
      "utilities",
      "utility",
      "comcast",
      "verizon",
      "at&t",
      "att ",
      "internet",
      "sewer",
      "gas bill",
      "duke energy"
    ])
  ) {
    return defaultMatch(DEFAULT_CATEGORY_IDS.utilities, "utilities_keywords", "Matched utilities bill keywords.");
  }

  if (
    includesAny(t, [
      "restaurant",
      "grubhub",
      "doordash",
      "uber eats",
      "chipotle",
      "taco bell",
      "mcdonald",
      "panera",
      "panda express"
    ])
  ) {
    return defaultMatch(DEFAULT_CATEGORY_IDS.diningOut, "dining_out_keywords", "Matched dining/delivery merchant keywords.");
  }

  if (includesAny(t, ["starbucks", "dunkin", "dutch bro", "coffee"])) {
    return defaultMatch(DEFAULT_CATEGORY_IDS.coffeeSnacks, "coffee_snacks_keywords", "Matched coffee/snacks keywords.");
  }

  if (
    includesAny(t, [
      "whole foods",
      "trader joe",
      "kroger",
      "safeway",
      "aldi",
      "grocery",
      "groceries",
      "walmart",
      "costco",
      "target",
      "publix"
    ])
  ) {
    return defaultMatch(DEFAULT_CATEGORY_IDS.groceries, "groceries_merchant", "Matched grocery merchant keywords.");
  }

  if (
    includesAny(t, [
      "uber",
      "lyft",
      "shell",
      "exxon",
      "chevron",
      "bp ",
      "parking",
      "metro",
      "transit",
      "toll "
    ])
  ) {
    return defaultMatch(DEFAULT_CATEGORY_IDS.transport, "transport_keywords", "Matched transportation/fuel keywords.");
  }

  if (
    includesAny(t, [
      "card payment",
      "credit card",
      "loan pmt",
      "loan payment",
      "auto loan",
      "student loan",
      "lending club"
    ])
  ) {
    return defaultMatch(DEFAULT_CATEGORY_IDS.debtPayments, "debt_keywords", "Matched debt payment keywords.");
  }

  if (
    includesAny(t, [
      "hospital",
      "physician",
      "doctor",
      "urgent care",
      "medical",
      "lab corp",
      "quest diag"
    ])
  ) {
    return defaultMatch(DEFAULT_CATEGORY_IDS.medical, "medical_keywords", "Matched medical provider keywords.");
  }

  if (includesAny(t, ["cvs ", "cvs#", "walgreens", "pharmacy", "rite aid"])) {
    return defaultMatch(DEFAULT_CATEGORY_IDS.pharmacy, "pharmacy_keywords", "Matched pharmacy keywords.");
  }

  return noMatch("No conservative default outflow rule matched.");
}

export function classifyWithRules(
  normalizedDescription: string,
  signedAmountRounded: number,
  dbRules: DbCategoryRule[]
): ClassificationResult {
  const t = normalizedDescription.trim();
  if (t.length > 0) {
    for (const rule of dbRules) {
      if (matchesRule(t, rule)) {
        return {
          categoryId: rule.categoryId,
          ruleId: rule.id,
          source: "db",
          confidence: clampConfidence(rule.confidence),
          reason: `Matched ${rule.matchType} DB rule pattern "${rule.pattern}".`
        };
      }
    }
  }
  return classifyDefaultCategory(normalizedDescription, signedAmountRounded);
}

function includesAny(haystack: string, needles: string[]): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) {
      return true;
    }
  }
  return false;
}

function matchesRule(normalizedDescription: string, rule: DbCategoryRule): boolean {
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

function defaultMatch(categoryId: string, ruleId: string, reason: string): ClassificationResult {
  return { categoryId, ruleId, source: "default", confidence: 0.7, reason };
}

function noMatch(reason: string): ClassificationResult {
  return { categoryId: null, ruleId: null, source: "none", confidence: 0, reason };
}
