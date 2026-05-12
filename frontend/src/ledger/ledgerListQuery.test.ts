import { describe, expect, it } from "vitest";

import {
  appendLedgerListFilters,
  belongsToPickerValueFromRow,
  buildBelongsToGroups,
  formatActiveBelongsToSummary,
  parseBelongsToFilterValue,
  parseBelongsToPickerValue,
  resolveActiveBelongsTo,
  resolveEffectiveIds
} from "./ledgerListQuery.js";

describe("resolveEffectiveIds", () => {
  it("prefers repeated multi-value params over the legacy singular key", () => {
    const sp = new URLSearchParams();
    sp.append("categoryIds", "cat-a");
    sp.append("categoryIds", "cat-b");
    sp.set("categoryId", "legacy-cat");
    expect(resolveEffectiveIds(sp, "categoryIds", "categoryId")).toEqual(["cat-a", "cat-b"]);
  });

  it("falls back to the legacy singular key when multi-value params are absent", () => {
    const sp = new URLSearchParams();
    sp.set("accountId", "acct-1");
    expect(resolveEffectiveIds(sp, "accountIds", "accountId")).toEqual(["acct-1"]);
  });
});

describe("resolveActiveBelongsTo", () => {
  it("uses belongsTo values when present", () => {
    expect(
      resolveActiveBelongsTo({
        belongsTo: ["household", "person-a"],
        ownerScope: "person",
        legacyPersonId: "legacy",
        personIds: ["person-b"]
      })
    ).toEqual(["household", "person-a"]);
  });

  it("falls back to legacy owner params when belongsTo is empty", () => {
    expect(
      resolveActiveBelongsTo({
        belongsTo: [],
        ownerScope: "household",
        legacyPersonId: null,
        personIds: []
      })
    ).toEqual(["household"]);
    expect(
      resolveActiveBelongsTo({
        belongsTo: [],
        ownerScope: "person",
        legacyPersonId: "person-legacy",
        personIds: ["person-a", "person-b"]
      })
    ).toEqual(["person-legacy"]);
    expect(
      resolveActiveBelongsTo({
        belongsTo: [],
        ownerScope: "person",
        legacyPersonId: null,
        personIds: ["person-a", "person-b"]
      })
    ).toEqual(["person-a", "person-b"]);
  });
});

describe("parseBelongsToFilterValue", () => {
  it("maps household and person-prefixed values", () => {
    expect(parseBelongsToFilterValue("household")).toEqual({ ownerScope: "household" });
    expect(parseBelongsToFilterValue("person:abc-123")).toEqual({
      ownerScope: "person",
      ownerPersonProfileId: "abc-123"
    });
    expect(parseBelongsToFilterValue("person:")).toEqual({});
  });
});

describe("belongsToPickerValueFromRow", () => {
  it("maps household and person rows to picker values", () => {
    expect(belongsToPickerValueFromRow("household", null)).toBe("household");
    expect(belongsToPickerValueFromRow("person", "person-1")).toBe("person-1");
  });
});

describe("parseBelongsToPickerValue", () => {
  it("accepts household, raw UUIDs, and legacy person-prefixed values", () => {
    expect(parseBelongsToPickerValue("household")).toEqual({ ownerScope: "household" });
    expect(parseBelongsToPickerValue("person-1")).toEqual({
      ownerScope: "person",
      ownerPersonProfileId: "person-1"
    });
    expect(parseBelongsToPickerValue("person:legacy-1")).toEqual({
      ownerScope: "person",
      ownerPersonProfileId: "legacy-1"
    });
    expect(parseBelongsToPickerValue(null)).toEqual({});
  });
});

describe("formatActiveBelongsToSummary", () => {
  const groups = buildBelongsToGroups([{ id: "person-1", label: "Alex" }]);

  it("describes household plus members without calling them all members", () => {
    expect(formatActiveBelongsToSummary(["household", "person-1"], groups)).toBe("Household, Alex");
    expect(formatActiveBelongsToSummary(["household", "person-1", "person-2"], groups)).toBe(
      "Household + 2 members"
    );
  });
});

describe("buildBelongsToGroups", () => {
  it("includes household and member profile options", () => {
    const groups = buildBelongsToGroups([{ id: "person-1", label: "Alex" }]);
    expect(groups[0]?.items[0]?.value).toBe("household");
    expect(groups[1]?.items[0]).toMatchObject({
      value: "person-1",
      displayLabel: "Alex",
      label: "Household > Alex"
    });
  });
});

describe("appendLedgerListFilters", () => {
  it("serializes multi-select filters and search", () => {
    const qs = new URLSearchParams();
    appendLedgerListFilters(qs, {
      sessionFilter: null,
      fileFilter: null,
      effectiveCategoryIds: ["cat-a", "cat-b"],
      uncategorizedOnly: false,
      needsReviewTab: false,
      trashTab: false,
      resolutionTypes: [],
      searchFromUrl: "coffee",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      effectiveAccountIds: ["acct-a"],
      effectiveBelongsTo: [],
      ownerScopeFilter: null,
      effectivePersonIds: [],
      amountMinUrl: "10",
      amountMaxUrl: "250"
    });
    expect(qs.getAll("categoryIds")).toEqual(["cat-a", "cat-b"]);
    expect(qs.get("search")).toBe("coffee");
    expect(qs.get("dateFrom")).toBe("2026-01-01");
    expect(qs.get("dateTo")).toBe("2026-01-31");
    expect(qs.getAll("accountIds")).toEqual(["acct-a"]);
    expect(qs.get("amountMin")).toBe("10");
    expect(qs.get("amountMax")).toBe("250");
  });

  it("prefers belongsTo over legacy owner params", () => {
    const qs = new URLSearchParams();
    appendLedgerListFilters(qs, {
      sessionFilter: null,
      fileFilter: null,
      effectiveCategoryIds: [],
      uncategorizedOnly: false,
      needsReviewTab: false,
      trashTab: false,
      resolutionTypes: [],
      searchFromUrl: "",
      dateFrom: null,
      dateTo: null,
      effectiveAccountIds: [],
      effectiveBelongsTo: ["household", "person-1"],
      ownerScopeFilter: "person",
      effectivePersonIds: ["person-2"],
      amountMinUrl: "",
      amountMaxUrl: ""
    });
    expect(qs.getAll("belongsTo")).toEqual(["household", "person-1"]);
    expect(qs.get("ownerScope")).toBeNull();
    expect(qs.get("ownerPersonProfileId")).toBeNull();
    expect(qs.getAll("ownerPersonProfileIds")).toEqual([]);
  });

  it("emits legacy owner params when belongsTo is empty", () => {
    const qs = new URLSearchParams();
    appendLedgerListFilters(qs, {
      sessionFilter: null,
      fileFilter: null,
      effectiveCategoryIds: [],
      uncategorizedOnly: false,
      needsReviewTab: false,
      trashTab: false,
      resolutionTypes: [],
      searchFromUrl: "",
      dateFrom: null,
      dateTo: null,
      effectiveAccountIds: [],
      effectiveBelongsTo: [],
      ownerScopeFilter: "person",
      effectivePersonIds: ["person-a", "person-b"],
      amountMinUrl: "",
      amountMaxUrl: ""
    });
    expect(qs.get("ownerScope")).toBe("person");
    expect(qs.getAll("ownerPersonProfileIds")).toEqual(["person-a", "person-b"]);
    expect(qs.get("ownerPersonProfileId")).toBeNull();
  });
});
