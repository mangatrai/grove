import type { PayslipLineItemRow } from "./types";

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
