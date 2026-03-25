import { DEFAULT_CATEGORY_IDS } from "./category-ids.js";

export interface ClassificationResult {
  /** Matched default category id, or null if no conservative rule fired. */
  categoryId: string | null;
  /** Stable id for tests / debugging (not stored on row). */
  ruleId: string | null;
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
    return { categoryId: null, ruleId: null };
  }

  const inflow = signedAmountRounded > 0;
  const outflow = signedAmountRounded < 0;

  if (inflow) {
    if (includesAny(t, ["payroll", "direct dep", "salary", "pay check", "commission", "dividend"])) {
      return { categoryId: DEFAULT_CATEGORY_IDS.income, ruleId: "income_inflow_keywords" };
    }
    if (includesAny(t, ["interest", "int pymt", "int payment"])) {
      return { categoryId: DEFAULT_CATEGORY_IDS.income, ruleId: "income_interest" };
    }
    return { categoryId: null, ruleId: null };
  }

  if (!outflow) {
    return { categoryId: null, ruleId: null };
  }

  if (includesAny(t, ["mortgage", " mtg", "rent ", " rent", "hoa", "landlord", "lease"])) {
    return { categoryId: DEFAULT_CATEGORY_IDS.housing, ruleId: "housing_keywords" };
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
    return { categoryId: DEFAULT_CATEGORY_IDS.utilities, ruleId: "utilities_keywords" };
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
      "starbucks",
      "walmart",
      "costco",
      "target",
      "publix"
    ])
  ) {
    return { categoryId: DEFAULT_CATEGORY_IDS.groceries, ruleId: "groceries_merchant" };
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
    return { categoryId: DEFAULT_CATEGORY_IDS.transport, ruleId: "transport_keywords" };
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
    return { categoryId: DEFAULT_CATEGORY_IDS.debtPayments, ruleId: "debt_keywords" };
  }

  return { categoryId: null, ruleId: null };
}

function includesAny(haystack: string, needles: string[]): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) {
      return true;
    }
  }
  return false;
}
