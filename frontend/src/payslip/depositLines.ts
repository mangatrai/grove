import type { DepositLineMatch, DepositMatchReason, MatchedDeposit } from "./types";

export const MATCH_REASON_LABEL: Record<DepositMatchReason, string> = {
  account_mask: "Account digits match",
  primary_account: "Primary deposit account",
  other: "Other account"
};

export function depositLineAccountLabel(line: Pick<DepositLineMatch, "accountSuffix">): string {
  return line.accountSuffix ? `Account ···${line.accountSuffix}` : "Account not printed";
}

/**
 * Mirrors backend `accountMaskMatches`: stored mask and printed digits agree on their common tail (≥3 digits).
 * Used to pre-filter the "Link bank deposit" modal to the account a deposit line names.
 */
export function accountMaskMatches(accountMask: string | null, accountSuffix: string | null): boolean {
  if (!accountMask || !accountSuffix) return false;
  const digits = accountMask.replace(/\D/g, "");
  if (digits.length < 3 || accountSuffix.length < 3) return false;
  return digits.endsWith(accountSuffix) || accountSuffix.endsWith(digits);
}

/** Status badge for a deposit line; an auto link reads "Auto-linked" so a wrong one is easy to spot and remove. */
export function depositStatusBadge(line: Pick<DepositLineMatch, "status" | "linked">): { label: string; color: string } {
  if (line.status === "linked") {
    return line.linked?.linkSource === "auto" ? { label: "Auto-linked", color: "teal" } : { label: "Linked", color: "green" };
  }
  return line.status === "suggested" ? { label: "Suggested", color: "blue" } : { label: "Not found", color: "gray" };
}

/** Confirmed links that don't fill any printed deposit line (e.g. a manual pick with another amount). */
export function confirmedOutsideLines(confirmed: MatchedDeposit[], lines: DepositLineMatch[]): MatchedDeposit[] {
  const onLines = new Set(lines.map((l) => l.linked?.id).filter((id): id is string => !!id));
  return confirmed.filter((d) => !onLines.has(d.id));
}

/** Footer badge: nothing until something is linked; then fully linked vs amount still unaccounted for. */
export function remainderBadge(
  linkedTotal: number,
  remainder: number | null | undefined
): { color: "green" | "yellow"; label: string } | null {
  if (linkedTotal <= 0 || remainder == null) return null;
  if (Math.abs(remainder) < 0.005) return { color: "green", label: "Fully linked" };
  return remainder > 0
    ? { color: "yellow", label: `$${remainder.toFixed(2)} not linked` }
    : { color: "yellow", label: `$${Math.abs(remainder).toFixed(2)} over net pay` };
}

/** ISO date ± days (UTC, no DST drift) — the modal's default deposit search window. */
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
