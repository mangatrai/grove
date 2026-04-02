import { DEFAULT_CATEGORY_IDS } from "./category-ids.js";

/**
 * Read-only catalog of built-in keyword rules from `classifyDefaultCategory` (category-rules.ts).
 * Used by GET /categories/rules for unified UI; engine behavior remains in code.
 */
export type BuiltinRuleCatalogEntry = {
  ruleId: string;
  flow: "inflow" | "outflow";
  categoryId: string;
  keywords: string[];
  summary: string;
};

export function listBuiltinRulesCatalog(): BuiltinRuleCatalogEntry[] {
  return [
    {
      ruleId: "income_refunds_keywords",
      flow: "inflow",
      categoryId: DEFAULT_CATEGORY_IDS.incomeRefunds,
      keywords: ["refund"],
      summary: "Inflow: refund keywords"
    },
    {
      ruleId: "income_rental_income_keywords",
      flow: "inflow",
      categoryId: DEFAULT_CATEGORY_IDS.incomeRentalIncome,
      keywords: ["rental income"],
      summary: "Inflow: rental income"
    },
    {
      ruleId: "income_interest",
      flow: "inflow",
      categoryId: DEFAULT_CATEGORY_IDS.incomeInterest,
      keywords: ["interest", "int pymt", "int payment"],
      summary: "Inflow: interest"
    },
    {
      ruleId: "income_dividends",
      flow: "inflow",
      categoryId: DEFAULT_CATEGORY_IDS.incomeDividends,
      keywords: ["dividend"],
      summary: "Inflow: dividends"
    },
    {
      ruleId: "income_salary_inflow_keywords",
      flow: "inflow",
      categoryId: DEFAULT_CATEGORY_IDS.incomeSalary,
      keywords: ["payroll", "direct dep", "salary", "pay check", "paycheck", "commission"],
      summary: "Inflow: payroll / salary"
    },
    {
      ruleId: "housing_keywords",
      flow: "outflow",
      categoryId: DEFAULT_CATEGORY_IDS.housing,
      keywords: ["mortgage", " mtg", "rent ", " rent", "hoa", "landlord", "lease"],
      summary: "Outflow: housing / rent / mortgage"
    },
    {
      ruleId: "utilities_keywords",
      flow: "outflow",
      categoryId: DEFAULT_CATEGORY_IDS.utilities,
      keywords: [
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
      ],
      summary: "Outflow: utilities / telecom"
    },
    {
      ruleId: "dining_out_keywords",
      flow: "outflow",
      categoryId: DEFAULT_CATEGORY_IDS.diningOut,
      keywords: [
        "restaurant",
        "grubhub",
        "doordash",
        "uber eats",
        "chipotle",
        "taco bell",
        "mcdonald",
        "panera",
        "panda express"
      ],
      summary: "Outflow: dining / delivery"
    },
    {
      ruleId: "coffee_snacks_keywords",
      flow: "outflow",
      categoryId: DEFAULT_CATEGORY_IDS.coffeeSnacks,
      keywords: ["starbucks", "dunkin", "dutch bro", "coffee"],
      summary: "Outflow: coffee / snacks"
    },
    {
      ruleId: "groceries_merchant",
      flow: "outflow",
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      keywords: [
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
      ],
      summary: "Outflow: grocery merchants"
    },
    {
      ruleId: "transport_keywords",
      flow: "outflow",
      categoryId: DEFAULT_CATEGORY_IDS.transport,
      keywords: ["uber", "lyft", "shell", "exxon", "chevron", "bp ", "parking", "metro", "transit", "toll "],
      summary: "Outflow: transport / fuel"
    },
    {
      ruleId: "debt_keywords",
      flow: "outflow",
      categoryId: DEFAULT_CATEGORY_IDS.debtPayments,
      keywords: [
        "card payment",
        "credit card",
        "loan pmt",
        "loan payment",
        "auto loan",
        "student loan",
        "lending club"
      ],
      summary: "Outflow: debt / card payments"
    },
    {
      ruleId: "medical_keywords",
      flow: "outflow",
      categoryId: DEFAULT_CATEGORY_IDS.medical,
      keywords: [
        "hospital",
        "physician",
        "doctor",
        "urgent care",
        "medical",
        "lab corp",
        "quest diag"
      ],
      summary: "Outflow: medical"
    },
    {
      ruleId: "pharmacy_keywords",
      flow: "outflow",
      categoryId: DEFAULT_CATEGORY_IDS.pharmacy,
      keywords: ["cvs ", "cvs#", "walgreens", "pharmacy", "rite aid"],
      summary: "Outflow: pharmacy"
    }
  ];
}
