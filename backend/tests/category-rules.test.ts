import { describe, expect, it } from "vitest";

import { classifyDefaultCategory } from "../src/modules/category/category-rules.js";
import { DEFAULT_CATEGORY_IDS } from "../src/modules/category/category-ids.js";
import { normalizeDescriptionForFingerprint } from "../src/modules/canonical/transaction-fingerprint.js";

describe("category rules (Epic 5.1)", () => {
  it("classifies inflow payroll as Income", () => {
    const n = normalizeDescriptionForFingerprint("ADP PAYROLL");
    const r = classifyDefaultCategory(n, 3000);
    expect(r.categoryId).toBe(DEFAULT_CATEGORY_IDS.income);
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
