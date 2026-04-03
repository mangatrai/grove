import { describe, expect, it } from "vitest";

import { db } from "../src/db/sqlite.js";
import { DEFAULT_CATEGORY_IDS } from "../src/modules/category/category-ids.js";
import { resolveLeafCategoryIdForHousehold } from "../src/modules/category/categories.service.js";

describe("resolveLeafCategoryIdForHousehold", () => {
  const householdId = (
    db.prepare(`SELECT household_id FROM app_user WHERE email = ?`).get("owner@example.com") as {
      household_id: string;
    }
  ).household_id;

  it("prefers categoryId when present and valid leaf", () => {
    const r = resolveLeafCategoryIdForHousehold(householdId, {
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      categoryPath: "nonsense > path"
    });
    expect(r).toEqual({ ok: true, id: DEFAULT_CATEGORY_IDS.groceries });
  });

  it("resolves two-segment path (Shopping > Groceries)", () => {
    const r = resolveLeafCategoryIdForHousehold(householdId, { categoryPath: "Shopping > Groceries" });
    expect(r).toEqual({ ok: true, id: DEFAULT_CATEGORY_IDS.groceries });
  });

  it("resolves Home > HOA Fees", () => {
    const r = resolveLeafCategoryIdForHousehold(householdId, { categoryPath: "Home | HOA Fees" });
    expect(r).toEqual({ ok: true, id: DEFAULT_CATEGORY_IDS.homeHoaFees });
  });

  it("resolves Investments > IRA", () => {
    const r = resolveLeafCategoryIdForHousehold(householdId, { categoryPath: "Investments > IRA" });
    expect(r).toEqual({ ok: true, id: DEFAULT_CATEGORY_IDS.investmentsIra });
  });

  it("resolves Shopping > General merchandise", () => {
    const r = resolveLeafCategoryIdForHousehold(householdId, {
      categoryPath: "Shopping > General merchandise"
    });
    expect(r).toEqual({ ok: true, id: DEFAULT_CATEGORY_IDS.shoppingGeneralMerchandise });
  });

  it("resolves Income > Reimbursements", () => {
    const r = resolveLeafCategoryIdForHousehold(householdId, { categoryPath: "Income > Reimbursements" });
    expect(r).toEqual({ ok: true, id: DEFAULT_CATEGORY_IDS.incomeReimbursements });
  });

  it("resolves Taxes > Property tax", () => {
    const r = resolveLeafCategoryIdForHousehold(householdId, { categoryPath: "Taxes > Property tax" });
    expect(r).toEqual({ ok: true, id: DEFAULT_CATEGORY_IDS.taxesPropertyTax });
  });

  it("resolves Taxes > Tax prep", () => {
    const r = resolveLeafCategoryIdForHousehold(householdId, { categoryPath: "Taxes > Tax prep" });
    expect(r).toEqual({ ok: true, id: DEFAULT_CATEGORY_IDS.taxesTaxPrep });
  });

  it("rejects parent category id (not a leaf)", () => {
    const r = resolveLeafCategoryIdForHousehold(householdId, {
      categoryId: DEFAULT_CATEGORY_IDS.home
    });
    expect(r).toEqual({ ok: false, code: "NOT_LEAF" });
  });
});
