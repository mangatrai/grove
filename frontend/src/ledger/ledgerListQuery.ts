import { lookupLabel, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker.js";

export type LedgerResolutionType =
  | "duplicate_ambiguity"
  | "reconciliation_mismatch"
  | "unknown_category"
  | "transfer_ambiguity";

export type BelongsToFilterValue = "" | "household" | `person:${string}`;

export function parseBelongsToFilterValue(value: string): {
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string;
} {
  if (value === "household") {
    return { ownerScope: "household" };
  }
  if (value.startsWith("person:")) {
    const id = value.slice("person:".length);
    if (id) {
      return { ownerScope: "person", ownerPersonProfileId: id };
    }
  }
  return {};
}

/** Picker value for a ledger row (household or raw person profile UUID). */
export function belongsToPickerValueFromRow(
  ownerScope: "household" | "person",
  ownerPersonProfileId: string | null
): string {
  if (ownerScope === "household") {
    return "household";
  }
  return ownerPersonProfileId ?? "";
}

/** Map picker output to owner scope; accepts legacy `person:<uuid>` and raw UUIDs. */
export function parseBelongsToPickerValue(value: string | null): {
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string;
} {
  if (!value) {
    return {};
  }
  if (value === "household") {
    return { ownerScope: "household" };
  }
  const legacy = parseBelongsToFilterValue(value);
  if (legacy.ownerScope) {
    return legacy;
  }
  return { ownerScope: "person", ownerPersonProfileId: value };
}

export function formatActiveBelongsToSummary(
  values: string[],
  groups: HierarchicalPickerGroup[]
): string {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    return lookupLabel(groups, values[0]!) ?? values[0]!;
  }
  const hasHousehold = values.includes("household");
  const people = values.filter((id) => id !== "household");
  if (hasHousehold && people.length > 0) {
    if (people.length === 1) {
      const personLabel = lookupLabel(groups, people[0]!) ?? "member";
      return `Household, ${personLabel}`;
    }
    return `Household + ${people.length} members`;
  }
  if (values.length === 2) {
    const a = lookupLabel(groups, values[0]!) ?? values[0]!;
    const b = lookupLabel(groups, values[1]!) ?? values[1]!;
    return `${a}, ${b}`;
  }
  return `${values.length} selections`;
}

export function buildBelongsToGroups(
  ownerProfiles: Array<{ id: string; label: string }>
): HierarchicalPickerGroup[] {
  return [
    { group: "Household", items: [{ value: "household", label: "Household", searchText: "household" }] },
    {
      group: "Members",
      items: ownerProfiles.map((p) => ({
        value: p.id,
        label: `Household > ${p.label}`,
        displayLabel: p.label,
        searchText: p.label
      }))
    }
  ];
}

export function resolveEffectiveIds(
  searchParams: URLSearchParams,
  multiKey: string,
  legacyKey: string
): string[] {
  const fromUrl = searchParams.getAll(multiKey).filter(Boolean);
  if (fromUrl.length > 0) {
    return fromUrl;
  }
  const legacy = searchParams.get(legacyKey)?.trim();
  return legacy ? [legacy] : [];
}

export function resolveActiveBelongsTo(params: {
  belongsTo: string[];
  ownerScope: "household" | "person" | null;
  legacyPersonId: string | null;
  personIds: string[];
}): string[] {
  if (params.belongsTo.length > 0) {
    return params.belongsTo;
  }
  if (params.ownerScope === "household") {
    return ["household"];
  }
  if (params.legacyPersonId) {
    return [params.legacyPersonId];
  }
  if (params.personIds.length > 0) {
    return params.personIds;
  }
  return [];
}

export function appendLedgerListFilters(
  qs: URLSearchParams,
  filters: {
    sessionFilter: string | null;
    fileFilter: string | null;
    effectiveCategoryIds: string[];
    uncategorizedOnly: boolean;
    needsReviewTab: boolean;
    trashTab: boolean;
    resolutionTypes: LedgerResolutionType[];
    searchFromUrl: string;
    dateFrom: string | null;
    dateTo: string | null;
    effectiveAccountIds: string[];
    effectiveBelongsTo: string[];
    ownerScopeFilter: "household" | "person" | null;
    effectivePersonIds: string[];
    amountMinUrl: string;
    amountMaxUrl: string;
  }
): void {
  if (filters.sessionFilter) {
    qs.set("sessionId", filters.sessionFilter);
  }
  if (filters.fileFilter) {
    qs.set("fileId", filters.fileFilter);
  }
  for (const id of filters.effectiveCategoryIds) {
    qs.append("categoryIds", id);
  }
  if (filters.uncategorizedOnly) {
    qs.set("uncategorizedOnly", "true");
  }
  if (filters.needsReviewTab) {
    qs.set("needsReview", "true");
  }
  if (filters.trashTab) {
    qs.set("trashOnly", "true");
  }
  for (const rt of filters.resolutionTypes) {
    qs.append("resolutionType", rt);
  }
  if (filters.searchFromUrl) {
    qs.set("search", filters.searchFromUrl);
  }
  if (filters.dateFrom) {
    qs.set("dateFrom", filters.dateFrom);
  }
  if (filters.dateTo) {
    qs.set("dateTo", filters.dateTo);
  }
  for (const id of filters.effectiveAccountIds) {
    qs.append("accountIds", id);
  }
  if (filters.effectiveBelongsTo.length > 0) {
    for (const id of filters.effectiveBelongsTo) {
      qs.append("belongsTo", id);
    }
  } else {
    if (filters.ownerScopeFilter === "household") {
      qs.set("ownerScope", "household");
    } else if (filters.effectivePersonIds.length === 1) {
      qs.set("ownerScope", "person");
      qs.set("ownerPersonProfileId", filters.effectivePersonIds[0]!);
    } else {
      for (const id of filters.effectivePersonIds) {
        qs.append("ownerPersonProfileIds", id);
      }
      if (filters.effectivePersonIds.length > 0) {
        qs.set("ownerScope", "person");
      }
    }
  }
  if (filters.amountMinUrl !== "") {
    const n = Number(filters.amountMinUrl);
    if (Number.isFinite(n)) {
      qs.set("amountMin", String(n));
    }
  }
  if (filters.amountMaxUrl !== "") {
    const n = Number(filters.amountMaxUrl);
    if (Number.isFinite(n)) {
      qs.set("amountMax", String(n));
    }
  }
}
