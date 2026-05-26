import { beforeAll, describe, expect, it } from "vitest";

import { qGet } from "../src/db/query.js";
import { classifyWithRules, type DbCategoryRule } from "../src/modules/category/category-rules.js";
import { DEFAULT_CATEGORY_IDS } from "../src/modules/category/category-ids.js";
import { listEnabledDbRulesForClassification } from "../src/modules/category/category-rules.service.js";
import { normalizeDescriptionForFingerprint } from "../src/modules/canonical/transaction-fingerprint.js";

let householdId: string;

beforeAll(async () => {
  const row = await qGet<{ h: string }>(
    `SELECT household_id AS h FROM app_user WHERE email = ?`,
    "owner@example.com"
  );
  if (!row) {
    throw new Error("seed owner missing");
  }
  householdId = row.h;
});

async function classifyNormalized(norm: string, signedAmount: number) {
  const rules = await listEnabledDbRulesForClassification(householdId);
  return classifyWithRules(norm, signedAmount, rules);
}

describe("category rules (Epic 5.1)", () => {
  it("classifies inflow payroll as Income->Salary", async () => {
    const n = normalizeDescriptionForFingerprint("ADP PAYROLL");
    const r = await classifyNormalized(n, 3000);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeSalary);
  });

  it("classifies inflow interest as Income->Interest", async () => {
    const n = normalizeDescriptionForFingerprint("INT PYMT");
    const r = await classifyNormalized(n, 12.34);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeInterest);
  });

  it("classifies inflow dividends as Income->Dividends", async () => {
    const n = normalizeDescriptionForFingerprint("VANGUARD DIVIDEND");
    const r = await classifyNormalized(n, 56.78);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeDividends);
  });

  it("classifies inflow rental income as Income->Rental income", async () => {
    const n = normalizeDescriptionForFingerprint("RENTAL INCOME");
    const r = await classifyNormalized(n, 1000);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeRentalIncome);
  });

  it("classifies inflow refunds as Income->Refunds", async () => {
    const n = normalizeDescriptionForFingerprint("AMZ REFUND");
    const r = await classifyNormalized(n, 10);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeRefunds);
  });

  it("classifies grocery merchants on debit", async () => {
    const n = normalizeDescriptionForFingerprint("WHOLE FOODS MK #1234");
    const r = await classifyNormalized(n, -45.2);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.groceries);
  });

  it("classifies coffee shops before grocery merchants", async () => {
    const n = normalizeDescriptionForFingerprint("STARBUCKS STORE 1234");
    const r = await classifyNormalized(n, -6.5);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.coffee);
  });

  it("classifies dining delivery keywords", async () => {
    const n = normalizeDescriptionForFingerprint("DOORDASH SUBSCRIPTION");
    const r = await classifyNormalized(n, -12);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.diningOut);
  });

  it("returns null for unmatched debit", async () => {
    const n = normalizeDescriptionForFingerprint("XYZ MYSTERY CO");
    const r = await classifyNormalized(n, -10);
    expect(r.categoryId).toBeNull();
  });

  it("contains matches when stored pattern has punctuation bank text does not (fingerprint normalization)", () => {
    const bankDesc =
      '"FID BKG SVC LLC DES:MONEYLINE ID:XXXXX9040 XY7YX INDN:ACCOUNT HOLDER CO ID:XXXXX04600 PPD"';
    const norm = normalizeDescriptionForFingerprint(bankDesc);
    const rule: DbCategoryRule = {
      id: "test-rule-punct",
      pattern: "fid bkg svc llc des:moneyline",
      matchType: "contains",
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      confidence: 0.9,
      amountScope: "any",
      ruleOrigin: "household"
    };
    const r = classifyWithRules(norm, -100, [rule]);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.groceries);
  });

  it("prefix matches using normalized pattern substrings", () => {
    const norm = normalizeDescriptionForFingerprint("APPLECARD GSBANK DES:PAYMENT");
    const rule: DbCategoryRule = {
      id: "test-rule-prefix",
      pattern: "applecard gsbank des:payment",
      matchType: "prefix",
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      confidence: 0.9,
      amountScope: "any",
      ruleOrigin: "household"
    };
    const r = classifyWithRules(norm, -50, [rule]);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.groceries);
  });

  it("household debit_only rule skips credit amounts", () => {
    const norm = normalizeDescriptionForFingerprint("SCOPE_TEST_VENDOR POS");
    const rules: DbCategoryRule[] = [
      {
        id: "scope-debit",
        pattern: "scope_test_vendor",
        matchType: "contains",
        categoryId: DEFAULT_CATEGORY_IDS.groceries,
        confidence: 1,
        amountScope: "debit_only",
        ruleOrigin: "household"
      }
    ];
    expect(classifyWithRules(norm, 50, rules).categoryId).toBeNull();
    expect(classifyWithRules(norm, -50, rules).categoryId).toBe(DEFAULT_CATEGORY_IDS.groceries);
  });
});
