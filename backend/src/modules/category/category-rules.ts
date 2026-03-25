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
    // Income leaves (conservative inflow keywords)
    if (includesAny(t, ["refund"])) {
      return { categoryId: DEFAULT_CATEGORY_IDS.incomeRefunds, ruleId: "income_refunds_keywords" };
    }

    if (includesAny(t, ["rental income"])) {
      return { categoryId: DEFAULT_CATEGORY_IDS.incomeRentalIncome, ruleId: "income_rental_income_keywords" };
    }

    if (includesAny(t, ["interest", "int pymt", "int payment"])) {
      return { categoryId: DEFAULT_CATEGORY_IDS.incomeInterest, ruleId: "income_interest" };
    }

    if (includesAny(t, ["dividend"])) {
      return { categoryId: DEFAULT_CATEGORY_IDS.incomeDividends, ruleId: "income_dividends" };
    }

    if (includesAny(t, ["payroll", "direct dep", "salary", "pay check", "paycheck", "commission"])) {
      return { categoryId: DEFAULT_CATEGORY_IDS.incomeSalary, ruleId: "income_salary_inflow_keywords" };
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
    return { categoryId: DEFAULT_CATEGORY_IDS.diningOut, ruleId: "dining_out_keywords" };
  }

  if (includesAny(t, ["starbucks", "dunkin", "dutch bro", "coffee"])) {
    return { categoryId: DEFAULT_CATEGORY_IDS.coffeeSnacks, ruleId: "coffee_snacks_keywords" };
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
    return { categoryId: DEFAULT_CATEGORY_IDS.medical, ruleId: "medical_keywords" };
  }

  if (includesAny(t, ["cvs ", "cvs#", "walgreens", "pharmacy", "rite aid"])) {
    return { categoryId: DEFAULT_CATEGORY_IDS.pharmacy, ruleId: "pharmacy_keywords" };
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
