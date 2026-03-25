import { describe, expect, it } from "vitest";

import { classifyDefaultCategory } from "../src/modules/category/category-rules.js";
import { DEFAULT_CATEGORY_IDS } from "../src/modules/category/category-ids.js";
import { normalizeDescriptionForFingerprint } from "../src/modules/canonical/transaction-fingerprint.js";

describe("category rules (Epic 5.1)", () => {
  it("classifies inflow payroll as Income->Salary", () => {
    const n = normalizeDescriptionForFingerprint("ADP PAYROLL");
    const r = classifyDefaultCategory(n, 3000);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeSalary);
  });

  it("classifies inflow interest as Income->Interest", () => {
    const n = normalizeDescriptionForFingerprint("INT PYMT");
    const r = classifyDefaultCategory(n, 12.34);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeInterest);
  });

  it("classifies inflow dividends as Income->Dividends", () => {
    const n = normalizeDescriptionForFingerprint("VANGUARD DIVIDEND");
    const r = classifyDefaultCategory(n, 56.78);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeDividends);
  });

  it("classifies inflow rental income as Income->Rental income", () => {
    const n = normalizeDescriptionForFingerprint("RENTAL INCOME");
    const r = classifyDefaultCategory(n, 1000);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeRentalIncome);
  });

  it("classifies inflow refunds as Income->Refunds", () => {
    const n = normalizeDescriptionForFingerprint("AMZ REFUND");
    const r = classifyDefaultCategory(n, 10);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.incomeRefunds);
  });

  it("classifies grocery merchants on debit", () => {
    const n = normalizeDescriptionForFingerprint("WHOLE FOODS MK #1234");
    const r = classifyDefaultCategory(n, -45.2);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.groceries);
  });

  it("classifies coffee shops before grocery merchants", () => {
    const n = normalizeDescriptionForFingerprint("STARBUCKS STORE 1234");
    const r = classifyDefaultCategory(n, -6.5);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.coffeeSnacks);
  });

  it("classifies dining delivery keywords", () => {
    const n = normalizeDescriptionForFingerprint("DOORDASH SUBSCRIPTION");
    const r = classifyDefaultCategory(n, -12);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.diningOut);
  });

  it("returns null for unmatched debit", () => {
    const n = normalizeDescriptionForFingerprint("XYZ MYSTERY CO");
    const r = classifyDefaultCategory(n, -10);
    expect(r.categoryId).toBeNull();
  });
});
