/**
 * Deposit matching v2 (#301 step 4): match each deposit line the payslip prints, not one credit vs net pay.
 *
 * Lines mode — the payslip's deposit lines sum to net pay to the cent:
 *   candidates per line = posted household credits within the pay-date window, amount equal to the line to
 *   the cent, not linked to any payslip yet; ranked account-mask match > employer's primary account > other,
 *   then by date distance. Confirmed links are assigned to lines by amount (mask match preferred).
 * Net-pay mode — no lines, or lines that don't sum to net (LLM missed an account, misread a digit):
 *   today's single-deposit-vs-net-pay suggestion (`findMatchedDeposits`), unchanged. Nothing is rejected.
 *
 * Read-only: suggestions are computed on GET; nothing is written here.
 */
import { qAll } from "../../db/query.js";
import { getPayslipDepositLines, type PayslipDepositLine } from "./payslip-deposit-lines.js";
import {
  daysBetween,
  findMatchedDeposits,
  resolveSalaryDepositAccountId,
  type MatchedDeposit,
  type PayslipSnapshotRow
} from "./payslip.service.js";

export type DepositMatchReason = "account_mask" | "primary_account" | "other";

export type DepositCandidate = MatchedDeposit & { matchReason: DepositMatchReason };

export type DepositLineMatch = PayslipDepositLine & {
  status: "linked" | "suggested" | "not_found";
  linked: MatchedDeposit | null;
  candidates: DepositCandidate[];
};

export type PayslipDepositMatch = {
  matchMode: "lines" | "net_pay";
  depositLines: DepositLineMatch[];
  /** Confirmed links; `amountDelta` is measured against the deposit line each one fills (lines mode). */
  confirmedDeposits: MatchedDeposit[];
  /** Best candidate per unmatched line (lines mode) or net-pay candidates (net-pay mode, none confirmed). */
  suggestedDeposits: MatchedDeposit[];
  linkedTotal: number;
  netPay: number | null;
  /** Net pay − linked total; null when net pay is unknown. */
  remainder: number | null;
};

const MAX_CANDIDATES_PER_LINE = 5;
const RANK: Record<DepositMatchReason, number> = { account_mask: 0, primary_account: 1, other: 2 };

const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Account's stored mask and the payslip's printed digits agree on their common tail (≥3 digits). */
export function accountMaskMatches(accountMask: string | null, accountSuffix: string | null): boolean {
  if (!accountMask || !accountSuffix) return false;
  const digits = accountMask.replace(/\D/g, "");
  if (digits.length < 3 || accountSuffix.length < 3) return false;
  return digits.endsWith(accountSuffix) || accountSuffix.endsWith(digits);
}

function matchReason(
  candidate: MatchedDeposit,
  line: PayslipDepositLine,
  primaryAccountId: string | null
): DepositMatchReason {
  if (accountMaskMatches(candidate.accountMask, line.accountSuffix)) return "account_mask";
  if (primaryAccountId && candidate.accountId === primaryAccountId) return "primary_account";
  return "other";
}

type CreditRow = {
  id: string;
  txn_date: string;
  amount: string | number;
  direction: string;
  merchant: string | null;
  memo: string | null;
  account_id: string;
  institution: string;
  account_type: string;
  account_mask: string | null;
};

/** Unlinked posted credits in the window whose amount equals one of `amountsCents`. */
async function findUnlinkedCredits(
  householdId: string,
  fromDate: string,
  toDate: string,
  amountsCents: number[]
): Promise<CreditRow[]> {
  const placeholders = amountsCents.map(() => "?").join(", ");
  return qAll<CreditRow>(
    `SELECT tc.id, tc.txn_date, tc.amount, tc.direction, tc.merchant, tc.memo,
            tc.account_id, fa.institution, fa.type AS account_type, fa.account_mask
       FROM transaction_canonical tc
       JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
      WHERE tc.household_id = ?
        AND tc.direction = 'credit'
        AND tc.status = 'posted'
        AND tc.txn_date BETWEEN ? AND ?
        AND ROUND(tc.amount, 2) IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM payslip_deposit_match pdm
           WHERE pdm.transaction_canonical_id = tc.id AND pdm.household_id = tc.household_id
        )
      ORDER BY tc.txn_date ASC, tc.id ASC`,
    householdId,
    fromDate,
    toDate,
    ...amountsCents.map((c) => fromCents(c).toFixed(2))
  );
}

function linkedTotalsFor(confirmed: MatchedDeposit[], netPay: number | null) {
  const linkedCents = confirmed.reduce((acc, d) => acc + toCents(d.amount), 0);
  return {
    linkedTotal: fromCents(linkedCents),
    netPay,
    remainder: netPay == null ? null : fromCents(toCents(netPay) - linkedCents)
  };
}

export async function matchPayslipDeposits(
  householdId: string,
  snapshot: PayslipSnapshotRow,
  confirmedDeposits: MatchedDeposit[]
): Promise<PayslipDepositMatch> {
  const netPay = snapshot.netPayCurrent;
  const effectiveDate = snapshot.payDate ?? snapshot.payPeriodEnd ?? null;
  const lines = getPayslipDepositLines(snapshot.paymentSummaryJson);
  const linesSumCents = lines.reduce((acc, l) => acc + toCents(l.amount), 0);
  const useLines = lines.length > 0 && netPay != null && effectiveDate != null && linesSumCents === toCents(netPay);

  if (!useLines) {
    const suggestedDeposits =
      confirmedDeposits.length === 0
        ? await findMatchedDeposits(
            householdId,
            snapshot.payDate,
            netPay,
            snapshot.ownerPersonProfileId,
            snapshot.payPeriodEnd,
            snapshot.employerId
          )
        : [];
    return {
      matchMode: "net_pay",
      depositLines: [],
      confirmedDeposits,
      suggestedDeposits,
      ...linkedTotalsFor(confirmedDeposits, netPay)
    };
  }

  // ---- Assign confirmed links to lines: same amount to the cent, mask match preferred ----
  const unassigned = [...confirmedDeposits];
  const linkedByLine = lines.map((line) => {
    const sameAmount = unassigned.filter((d) => toCents(d.amount) === toCents(line.amount));
    const pick = sameAmount.find((d) => accountMaskMatches(d.accountMask, line.accountSuffix)) ?? sameAmount[0] ?? null;
    if (pick) unassigned.splice(unassigned.indexOf(pick), 1);
    return pick ? { ...pick, amountDelta: 0 } : null;
  });

  // ---- Candidates for the still-open lines ----
  const windowDays = snapshot.payDate != null ? 7 : 10;
  const openAmounts = [...new Set(lines.filter((_, i) => !linkedByLine[i]).map((l) => toCents(l.amount)))];
  const credits =
    openAmounts.length > 0
      ? await findUnlinkedCredits(householdId, addDays(effectiveDate, -windowDays), addDays(effectiveDate, windowDays), openAmounts)
      : [];
  const primaryAccountId = snapshot.ownerPersonProfileId
    ? await resolveSalaryDepositAccountId(householdId, snapshot.ownerPersonProfileId, snapshot.employerId)
    : null;

  const depositLines: DepositLineMatch[] = lines.map((line, i) => {
    const linked = linkedByLine[i] ?? null;
    if (linked) return { ...line, status: "linked", linked, candidates: [] };
    const candidates = credits
      .filter((r) => toCents(Number(r.amount)) === toCents(line.amount))
      .map((r): DepositCandidate => {
        const deposit: MatchedDeposit = {
          id: String(r.id),
          txnDate: String(r.txn_date),
          amount: Number(r.amount),
          direction: String(r.direction),
          merchant: r.merchant == null ? null : String(r.merchant),
          memo: r.memo == null ? null : String(r.memo),
          accountId: String(r.account_id),
          institution: String(r.institution),
          accountType: String(r.account_type),
          accountMask: r.account_mask == null ? null : String(r.account_mask),
          dateDelta: daysBetween(effectiveDate, String(r.txn_date)),
          amountDelta: 0
        };
        return { ...deposit, matchReason: matchReason(deposit, line, primaryAccountId) };
      })
      .sort(
        (a, b) =>
          RANK[a.matchReason] - RANK[b.matchReason] || a.dateDelta - b.dateDelta || a.txnDate.localeCompare(b.txnDate)
      )
      .slice(0, MAX_CANDIDATES_PER_LINE);
    return { ...line, status: candidates.length > 0 ? "suggested" : "not_found", linked: null, candidates };
  });

  // Confirmed links not tied to any line (manual picks with another amount) keep their net-pay delta.
  const lineDeltaById = new Map(linkedByLine.filter((d): d is MatchedDeposit => d != null).map((d) => [d.id, d.amountDelta]));
  const confirmed = confirmedDeposits.map((d) =>
    lineDeltaById.has(d.id) ? { ...d, amountDelta: lineDeltaById.get(d.id)! } : d
  );

  const suggested = new Map<string, MatchedDeposit>();
  for (const line of depositLines) {
    const top = line.candidates[0];
    if (top && !suggested.has(top.id)) suggested.set(top.id, top);
  }

  return {
    matchMode: "lines",
    depositLines,
    confirmedDeposits: confirmed,
    suggestedDeposits: [...suggested.values()],
    ...linkedTotalsFor(confirmedDeposits, netPay)
  };
}
