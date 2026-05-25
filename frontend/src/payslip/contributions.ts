import type { PayslipLineItemRow } from "./types";

export type ContribGroupKey = "retirement" | "health" | "equity" | "other";

/**
 * Matches names that are investment/savings contributions.
 * Excludes insurance, premiums, LTD/STD, AD&D, life, parking, transit.
 */
const SAVINGS_ITEM_RE =
  /401\s*\(?\s*k\)?|403\s*\(?\s*b\)?|\b457\b|roth|\bespp\b|\brsu\b|\bhsa\b|\bfsa\b|deferred\s*comp|pension|after[- ]tax|employee\s*stock|stock\s+(?:salary|other|purchase)|share\s*purchase|profit\s*shar|savings\s*plan/i;

/** Returns true if the line item is an investment or savings contribution (not insurance or a benefit premium). */
export function isContributionItem(item: PayslipLineItemRow): boolean {
  return SAVINGS_ITEM_RE.test(item.name ?? "");
}

/** Maps LLM `contribution_type` values to display groups. */
export const CONTRIB_GROUP_MAP: Record<string, ContribGroupKey> = {
  "401k": "retirement",
  "403b": "retirement",
  "457": "retirement",
  hsa: "health",
  fsa: "health",
  medical: "health",
  dental: "health",
  vision: "health",
  espp: "equity",
  rsu: "equity"
};

type LineItemWithContrib = PayslipLineItemRow & {
  contributionType?: string | null;
  contribution_type?: string | null;
};

function getContributionType(item: PayslipLineItemRow): string | null {
  const ext = item as LineItemWithContrib;
  const raw = ext.contributionType ?? ext.contribution_type;
  return raw?.trim() ? raw.trim() : null;
}

/** Case-insensitive name pattern → group (when contribution_type is absent). */
export function matchContribGroupByName(name: string | null): ContribGroupKey | null {
  if (!name?.trim()) return null;
  const n = name.toLowerCase();
  if (/401\s*\(?\s*k\)?|403\s*\(?\s*b\)?|\b457\b/.test(n)) return "retirement";
  if (/\bhsa\b|\bfsa\b|medical|dental|vision/.test(n)) return "health";
  if (/\bespp\b|\brsu\b/.test(n)) return "equity";
  return null;
}

function resolveGroup(item: PayslipLineItemRow): ContribGroupKey {
  const ctype = getContributionType(item);
  if (ctype) {
    const normalized = ctype.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (CONTRIB_GROUP_MAP[normalized]) return CONTRIB_GROUP_MAP[normalized];
    const slug = ctype.toLowerCase();
    if (CONTRIB_GROUP_MAP[slug]) return CONTRIB_GROUP_MAP[slug];
  }
  return matchContribGroupByName(item.name) ?? "other";
}

export function groupContributions(
  lineItems: PayslipLineItemRow[]
): Record<ContribGroupKey, PayslipLineItemRow[]> {
  const groups: Record<ContribGroupKey, PayslipLineItemRow[]> = {
    retirement: [],
    health: [],
    equity: [],
    other: []
  };
  for (const item of lineItems) {
    if (item.section !== "pre_tax_deductions") continue;
    groups[resolveGroup(item)].push(item);
  }
  return groups;
}
