import { qAll, qGet } from "../../db/query.js";
import { env } from "../../config/env.js";
import { getHouseholdMonthlySavingsTarget } from "../household/household.service.js";

export type CashPreset =
  | "month"
  | "ytd"
  | "rolling_7"
  | "rolling_30"
  | "rolling_90"
  | "rolling_180"
  | "prev_calendar_year"
  | "custom";

/** Inclusive span guard for `dateFrom`/`dateTo` custom ranges — from env (see `CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS`). */
export function getCashSummaryMaxCustomRangeDays(): number {
  return env.CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS;
}

export interface CashSummaryInput {
  /** Required unless both `dateFrom` and `dateTo` are set (custom range). */
  preset?: CashPreset;
  /** Required when preset is `month` (YYYY-MM). */
  month?: string;
  /** Inclusive end date for rolling/YTD and month boundaries (YYYY-MM-DD). Defaults to today (UTC). */
  asOf?: string;
  /** Inclusive start (YYYY-MM-DD). When both `dateFrom` and `dateTo` are set, they define the KPI range instead of `preset`. */
  dateFrom?: string;
  /** Inclusive end (YYYY-MM-DD). */
  dateTo?: string;
  /** Include per-account breakdown for the KPI range. */
  breakdown: boolean;
  /** Include per-category breakdown (`LEFT JOIN category`; null category = "Uncategorized"). */
  categoryBreakdown: boolean;
  /** When `categoryBreakdown`: `parent` rolls up leaf categories to top-level parent; `leaf` keeps per-leaf rows. Default `parent`. */
  categoryRollup?: "leaf" | "parent";
  /** Optional filter; must belong to household. */
  accountId?: string;
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string;
}

export interface CashSummaryRange {
  start: string;
  end: string;
  preset: CashPreset;
  label: string;
}

export interface CashSummaryHousehold {
  inflows: number;
  outflows: number;
  net: number;
  transactionCount: number;
}

export interface CashSummaryComparisonMetrics {
  inflows: number;
  outflows: number;
  net: number;
  transactionCount: number;
}

export interface CashSummaryComparisonDelta {
  inflows: number;
  outflows: number;
  net: number;
}

export interface CashSummaryComparisonBlock {
  label: string;
  range: { start: string; end: string };
  household: CashSummaryComparisonMetrics;
  delta: CashSummaryComparisonDelta;
}

export interface CashSummaryAccountRow {
  accountId: string;
  institution: string;
  accountType: string;
  accountMask: string | null;
  inflows: number;
  outflows: number;
  net: number;
  transactionCount: number;
}

export interface CashSummaryCategoryRow {
  categoryId: string | null;
  categoryName: string;
  inflows: number;
  outflows: number;
  net: number;
  transactionCount: number;
  /**
   * Optional (Epic 7): previous-window totals + deltas for this category.
   * Present when `categoryBreakdown=true` (same previous period used for `comparison.previousPeriod`).
   */
  previousInflows?: number;
  previousOutflows?: number;
  previousNet?: number;
  deltaInflows?: number;
  deltaOutflows?: number;
  deltaNet?: number;
}

export interface CashSummaryTrendPoint {
  month: string;
  inflows: number;
  outflows: number;
  net: number;
}

/** Debit magnitude (outflows) by category for one calendar month (same 6-month window as `monthlyTrend`). */
export interface CashSummaryMonthCategoryOutflows {
  month: string;
  segments: Array<{
    categoryId: string | null;
    categoryName: string;
    /** Sum of -amount for debits (positive magnitude). */
    outflows: number;
  }>;
}

/** ~365.25/12 — used to prorate a monthly savings $ amount to arbitrary date ranges. */
const AVG_DAYS_PER_MONTH = 30.437;

export interface CashSummarySpendingPower {
  /** Household setting; `null` if unset — then `safeToSpend` / `savingsTargetApplied` are `null`. */
  monthlySavingsTargetUsd: number | null;
  /** `monthlySavingsTargetUsd` scaled to this report window: `monthly × (days in range ÷ avg days/month)`. */
  savingsTargetApplied: number | null;
  /** Net cashflow for the period minus `savingsTargetApplied` when a monthly target is set. */
  safeToSpend: number | null;
  /** `(inflows − outflows) / inflows` when inflows > 0; else `null`. */
  savingsRate: number | null;
  /** Short formula note for UI / API consumers. */
  explanation: string;
}

export interface CashSummaryResult {
  range: CashSummaryRange;
  asOf: string;
  /** Same as server env `CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS` — for UI validation copy. */
  maxCustomRangeDays: number;
  household: CashSummaryHousehold;
  /** Optional period comparisons. Added for Epic 7. */
  comparison?: {
    previousPeriod: CashSummaryComparisonBlock;
    yearOverYear?: CashSummaryComparisonBlock;
  };
  /** Safe-to-spend + savings rate; uses `household.monthly_savings_target_usd` when set. */
  spendingPower: CashSummarySpendingPower;
  byAccount: CashSummaryAccountRow[] | null;
  byCategory: CashSummaryCategoryRow[] | null;
  monthlyTrend: CashSummaryTrendPoint[];
  /** Stacked-bar source: outflows per category per month (omitted when `categoryBreakdown` is false). */
  monthlyOutflowsByCategory: CashSummaryMonthCategoryOutflows[] | null;
}

function categoryKey(categoryId: string | null): string {
  return categoryId ?? "__uncategorized__";
}

function mergeCategoryPreviousAndDeltas(
  current: CashSummaryCategoryRow[],
  previous: CashSummaryCategoryRow[]
): CashSummaryCategoryRow[] {
  const prev = new Map<string, CashSummaryCategoryRow>();
  for (const r of previous) {
    prev.set(categoryKey(r.categoryId), r);
  }

  return current.map((r) => {
    const p = prev.get(categoryKey(r.categoryId));
    const previousInflows = p?.inflows ?? 0;
    const previousOutflows = p?.outflows ?? 0;
    const previousNet = p?.net ?? 0;

    const deltaInflows = roundMoney(r.inflows - previousInflows);
    const deltaOutflows = roundMoney(r.outflows - previousOutflows);
    const deltaNet = roundMoney(r.net - previousNet);

    return {
      ...r,
      previousInflows,
      previousOutflows,
      previousNet,
      deltaInflows,
      deltaOutflows,
      deltaNet
    };
  });
}

function defaultAsOfUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function daysBefore(endIso: string, days: number): string {
  const [y, m, d] = endIso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() - days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y!, m!, 0).getDate();
  return `${ym}-${pad2(last)}`;
}

function monthsBack(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, m! - 1 - n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function shiftDateByYear(isoDate: string, years: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const year = (y ?? 0) + years;
  const maxDay = new Date(year, m!, 0).getDate();
  const safeDay = Math.min(d!, maxDay);
  return `${year}-${pad2(m!)}-${pad2(safeDay)}`;
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function inclusiveCalendarDays(startIso: string, endIso: string): number {
  const s = startIso.slice(0, 10);
  const e = endIso.slice(0, 10);
  const [sy, sm, sd] = s.split("-").map(Number);
  const [ey, em, ed] = e.split("-").map(Number);
  const t0 = Date.UTC(sy!, sm! - 1, sd!);
  const t1 = Date.UTC(ey!, em! - 1, ed!);
  return Math.round((t1 - t0) / (24 * 60 * 60 * 1000)) + 1;
}

function buildSpendingPower(
  household: CashSummaryHousehold,
  rangeStart: string,
  rangeEnd: string,
  monthlyTarget: number | null
): CashSummarySpendingPower {
  const savingsRate =
    household.inflows > 0
      ? roundMoney((household.inflows - household.outflows) / household.inflows)
      : null;

  if (monthlyTarget === null) {
    return {
      monthlySavingsTargetUsd: null,
      savingsTargetApplied: null,
      safeToSpend: null,
      savingsRate,
      explanation:
        "Savings rate = (inflows − outflows) ÷ inflows for this period when inflows > 0. Set a monthly savings target below to also show safe-to-spend (net for this period minus that commitment, scaled by period length vs ~30.44 days/month)."
    };
  }

  const days = inclusiveCalendarDays(rangeStart, rangeEnd);
  const savingsTargetApplied = roundMoney(monthlyTarget * (days / AVG_DAYS_PER_MONTH));
  const safeToSpend = roundMoney(household.net - savingsTargetApplied);

  return {
    monthlySavingsTargetUsd: monthlyTarget,
    savingsTargetApplied,
    safeToSpend,
    savingsRate,
    explanation:
      "Safe-to-spend = net cashflow for this period minus your monthly savings commitment, scaled by the number of days in this period (~30.44 days per month). Savings rate = (inflows − outflows) ÷ inflows when inflows > 0."
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidIsoCalendarDate(iso: string): void {
  if (!ISO_DATE_RE.test(iso)) {
    throw new Error("INVALID_DATE_FORMAT");
  }
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  if (dt.getFullYear() !== y || dt.getMonth() !== m! - 1 || dt.getDate() !== d!) {
    throw new Error("INVALID_DATE_FORMAT");
  }
}

function assertCustomDateRange(dateFrom: string, dateTo: string): void {
  assertValidIsoCalendarDate(dateFrom);
  assertValidIsoCalendarDate(dateTo);
  if (dateFrom > dateTo) {
    throw new Error("INVALID_DATE_ORDER");
  }
  const days = inclusiveCalendarDays(dateFrom, dateTo);
  if (days > env.CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS) {
    throw new Error("CUSTOM_RANGE_TOO_LONG");
  }
}

function buildRangeLabel(preset: CashPreset, start: string, end: string, month?: string): string {
  switch (preset) {
    case "custom":
      return `Custom range (${start} – ${end})`;
    case "month": {
      const label = month ?? start.slice(0, 7);
      const [y, mo] = label.split("-");
      const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December"
      ];
      return `${monthNames[parseInt(mo!, 10) - 1]} ${y}`;
    }
    case "ytd":
      return `Year to date (${start} – ${end})`;
    case "rolling_7":
      return `Last 7 days (${start} – ${end})`;
    case "rolling_30":
      return `Last 30 days (${start} – ${end})`;
    case "rolling_90":
      return `Last 90 days (${start} – ${end})`;
    case "rolling_180":
      return `Last 180 days (${start} – ${end})`;
    case "prev_calendar_year":
      return `Previous calendar year (${start} – ${end})`;
    default:
      return `${start} – ${end}`;
  }
}

export function resolveCashRange(input: CashSummaryInput): {
  range: CashSummaryRange;
  asOf: string;
} {
  const fromQ = input.dateFrom?.trim();
  const toQ = input.dateTo?.trim();
  if (fromQ || toQ) {
    if (!fromQ || !toQ) {
      throw new Error("CUSTOM_RANGE_INCOMPLETE");
    }
    assertCustomDateRange(fromQ, toQ);
    const range: CashSummaryRange = {
      start: fromQ,
      end: toQ,
      preset: "custom",
      label: buildRangeLabel("custom", fromQ, toQ)
    };
    return { range, asOf: toQ };
  }

  const preset = input.preset;
  if (!preset) {
    throw new Error("INVALID_PRESET");
  }

  const asOf = input.asOf?.trim() || defaultAsOfUtc();
  let start: string;
  let end: string;
  let month: string | undefined;

  switch (preset) {
    case "month": {
      const ym = input.month?.trim();
      if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
        throw new Error("INVALID_MONTH");
      }
      month = ym;
      start = `${ym}-01`;
      end = lastDayOfMonth(ym);
      break;
    }
    case "ytd": {
      const y = asOf.slice(0, 4);
      start = `${y}-01-01`;
      end = asOf;
      break;
    }
    case "rolling_7":
      end = asOf;
      start = daysBefore(asOf, 6);
      break;
    case "rolling_30":
      end = asOf;
      start = daysBefore(asOf, 29);
      break;
    case "rolling_90":
      end = asOf;
      start = daysBefore(asOf, 89);
      break;
    case "rolling_180":
      end = asOf;
      start = daysBefore(asOf, 179);
      break;
    case "prev_calendar_year": {
      const y = Number(asOf.slice(0, 4)) - 1;
      if (!Number.isFinite(y)) {
        throw new Error("INVALID_PRESET");
      }
      start = `${y}-01-01`;
      end = `${y}-12-31`;
      break;
    }
    default:
      throw new Error("INVALID_PRESET");
  }

  const range: CashSummaryRange = {
    start,
    end,
    preset,
    label: buildRangeLabel(preset, start, end, month)
  };

  return { range, asOf };
}

function ownershipFilterClause(
  accountId: string | undefined,
  ownerScope: "household" | "person" | undefined,
  ownerPersonProfileId: string | undefined
): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (accountId) {
    parts.push("tc.account_id = ?");
    params.push(accountId);
  }
  if (ownerScope) {
    parts.push("tc.owner_scope = ?");
    params.push(ownerScope);
  }
  if (ownerPersonProfileId) {
    parts.push("tc.owner_person_profile_id = ?");
    params.push(ownerPersonProfileId);
  }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")} ` : "", params };
}

function transferReportingExclusionClause(tcAlias = "tc"): string {
  // Exclude confirmed transfer pairs (auto-linked by canonicalize at high confidence).
  // Suspected-transfer ambiguity flags are no longer used to hide rows — both sides of
  // an internal transfer net to zero in whole-household reporting anyway.
  return ` AND ${tcAlias}.transfer_group_id IS NULL`;
}

async function aggregateForRange(
  householdId: string,
  start: string,
  end: string,
  accountId?: string,
  ownerScope?: "household" | "person",
  ownerPersonProfileId?: string
): Promise<CashSummaryHousehold> {
  const { sql: acctSql, params: acctParams } = ownershipFilterClause(accountId, ownerScope, ownerPersonProfileId);
  const row = await qGet<{
    inflows: string | number;
    outflows: string | number;
    net: string | number;
    cnt: string | number;
  }>(
    `SELECT
         COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inflows,
         COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows,
         COALESCE(SUM(tc.amount), 0) AS net,
         COUNT(*)::int AS cnt
       FROM transaction_canonical tc
       WHERE tc.household_id = ?
         AND tc.status = 'posted'
         AND tc.txn_date >= ? AND tc.txn_date <= ?
         ${transferReportingExclusionClause("tc")}
         ${acctSql}`,
    householdId,
    start,
    end,
    ...acctParams
  );
  if (!row) {
    return { inflows: 0, outflows: 0, net: 0, transactionCount: 0 };
  }

  return {
    inflows: roundMoney(Number(row.inflows)),
    outflows: roundMoney(Number(row.outflows)),
    net: roundMoney(Number(row.net)),
    transactionCount: Number(row.cnt)
  };
}

function resolveComparisonRanges(_input: CashSummaryInput, range: CashSummaryRange): {
  previous: { label: string; start: string; end: string };
  yearOverYear?: { label: string; start: string; end: string };
} {
  if (range.preset === "month") {
    const currentYm = range.start.slice(0, 7);
    const prevYm = monthsBack(currentYm, 1);
    const yoyYm = monthsBack(currentYm, 12);
    return {
      previous: {
        label: "Previous month",
        start: `${prevYm}-01`,
        end: lastDayOfMonth(prevYm)
      },
      yearOverYear: {
        label: "Same month last year",
        start: `${yoyYm}-01`,
        end: lastDayOfMonth(yoyYm)
      }
    };
  }

  if (range.preset === "ytd") {
    return {
      previous: {
        label: "YTD last year",
        start: shiftDateByYear(range.start, -1),
        end: shiftDateByYear(range.end, -1)
      }
    };
  }

  if (range.preset === "prev_calendar_year") {
    const y = Number(range.start.slice(0, 4));
    const prevY = y - 1;
    return {
      previous: {
        label: "Prior calendar year",
        start: `${prevY}-01-01`,
        end: `${prevY}-12-31`
      }
    };
  }

  // rolling windows compare against the immediately preceding window length.
  const dayCountInclusive =
    Math.round(
      (new Date(nextDay(range.end)).getTime() - new Date(range.start).getTime()) / (24 * 60 * 60 * 1000)
    ) || 0;
  const previousEnd = daysBefore(range.start, 1);
  const previousStart = daysBefore(previousEnd, Math.max(dayCountInclusive - 1, 0));
  return {
    previous: {
      label: `Previous ${dayCountInclusive}-day window`,
      start: previousStart,
      end: previousEnd
    }
  };
}

function computeDelta(current: CashSummaryHousehold, baseline: CashSummaryHousehold): CashSummaryComparisonDelta {
  return {
    inflows: roundMoney(current.inflows - baseline.inflows),
    outflows: roundMoney(current.outflows - baseline.outflows),
    net: roundMoney(current.net - baseline.net)
  };
}

async function aggregateByAccount(
  householdId: string,
  start: string,
  end: string,
  accountId?: string,
  ownerScope?: "household" | "person",
  ownerPersonProfileId?: string
): Promise<CashSummaryAccountRow[]> {
  const { sql: acctSql, params: acctParams } = ownershipFilterClause(accountId, ownerScope, ownerPersonProfileId);
  const rows = await qAll<{
    accountId: string;
    institution: string;
    accountType: string;
    accountMask: string | null;
    inflows: string | number;
    outflows: string | number;
    net: string | number;
    cnt: string | number;
  }>(
    `SELECT
         tc.account_id AS "accountId",
         fa.institution AS institution,
         fa.type AS "accountType",
         fa.account_mask AS "accountMask",
         COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inflows,
         COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows,
         COALESCE(SUM(tc.amount), 0) AS net,
         COUNT(*)::int AS cnt
       FROM transaction_canonical tc
       INNER JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
       WHERE tc.household_id = ?
         AND tc.status = 'posted'
         AND tc.txn_date >= ? AND tc.txn_date <= ?
         ${transferReportingExclusionClause("tc")}
         ${acctSql}
       GROUP BY tc.account_id, fa.institution, fa.type, fa.account_mask
       ORDER BY fa.institution, fa.account_mask`,
    householdId,
    start,
    end,
    ...acctParams
  );

  return rows.map((r) => ({
    accountId: r.accountId,
    institution: r.institution,
    accountType: r.accountType,
    accountMask: r.accountMask,
    inflows: roundMoney(Number(r.inflows)),
    outflows: roundMoney(Number(r.outflows)),
    net: roundMoney(Number(r.net)),
    transactionCount: Number(r.cnt)
  }));
}

async function aggregateByCategory(
  householdId: string,
  start: string,
  end: string,
  accountId: string | undefined,
  ownerScope: "household" | "person" | undefined,
  ownerPersonProfileId: string | undefined,
  rollup: "leaf" | "parent"
): Promise<CashSummaryCategoryRow[]> {
  const { sql: acctSql, params: acctParams } = ownershipFilterClause(accountId, ownerScope, ownerPersonProfileId);

  const leafQuery = `SELECT
         tc.category_id AS "categoryId",
         MAX(COALESCE(c.name, 'Uncategorized')) AS "categoryName",
         COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inflows,
         COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows,
         COALESCE(SUM(tc.amount), 0) AS net,
         COUNT(*) AS cnt
       FROM transaction_canonical tc
       LEFT JOIN category c ON c.id = tc.category_id
       WHERE tc.household_id = ?
         AND tc.status = 'posted'
         AND tc.txn_date >= ? AND tc.txn_date <= ?
         ${transferReportingExclusionClause("tc")}
         ${acctSql}
       GROUP BY tc.category_id
       ORDER BY outflows DESC, inflows DESC`;

  const parentQuery = `SELECT
         CASE WHEN tc.category_id IS NULL THEN NULL ELSE COALESCE(p.id, c.id) END AS "categoryId",
         MAX(CASE WHEN tc.category_id IS NULL THEN 'Uncategorized' ELSE COALESCE(p.name, c.name) END) AS "categoryName",
         COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inflows,
         COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows,
         COALESCE(SUM(tc.amount), 0) AS net,
         COUNT(*) AS cnt
       FROM transaction_canonical tc
       LEFT JOIN category c ON c.id = tc.category_id
       LEFT JOIN category p ON p.id = c.parent_id
       WHERE tc.household_id = ?
         AND tc.status = 'posted'
         AND tc.txn_date >= ? AND tc.txn_date <= ?
         ${transferReportingExclusionClause("tc")}
         ${acctSql}
       GROUP BY CASE WHEN tc.category_id IS NULL THEN NULL ELSE COALESCE(p.id, c.id) END
       ORDER BY outflows DESC, inflows DESC`;

  const rows = await qAll<{
    categoryId: string | null;
    categoryName: string;
    inflows: string | number;
    outflows: string | number;
    net: string | number;
    cnt: string | number;
  }>(rollup === "parent" ? parentQuery : leafQuery, householdId, start, end, ...acctParams);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    inflows: roundMoney(Number(r.inflows)),
    outflows: roundMoney(Number(r.outflows)),
    net: roundMoney(Number(r.net)),
    transactionCount: Number(r.cnt)
  }));
}

async function monthlyTrend(
  householdId: string,
  rangeEnd: string,
  accountId?: string,
  ownerScope?: "household" | "person",
  ownerPersonProfileId?: string
): Promise<CashSummaryTrendPoint[]> {
  const endYm = rangeEnd.slice(0, 7);
  const points: CashSummaryTrendPoint[] = [];
  const { sql: acctSql, params: acctParams } = ownershipFilterClause(accountId, ownerScope, ownerPersonProfileId);

  for (let i = 5; i >= 0; i -= 1) {
    const ym = monthsBack(endYm, i);
    const monthStart = `${ym}-01`;
    const monthEndFull = lastDayOfMonth(ym);
    const capEnd = ym === endYm ? minDate(monthEndFull, rangeEnd) : monthEndFull;

    const row = await qGet<{
      inflows: string | number;
      outflows: string | number;
      net: string | number;
    }>(
      `SELECT
           COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inflows,
           COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows,
           COALESCE(SUM(tc.amount), 0) AS net
         FROM transaction_canonical tc
         WHERE tc.household_id = ?
           AND tc.status = 'posted'
           AND tc.txn_date >= ? AND tc.txn_date <= ?
           ${transferReportingExclusionClause("tc")}
           ${acctSql}`,
      householdId,
      monthStart,
      capEnd,
      ...acctParams
    );
    if (!row) {
      points.push({ month: ym, inflows: 0, outflows: 0, net: 0 });
      continue;
    }

    points.push({
      month: ym,
      inflows: roundMoney(Number(row.inflows)),
      outflows: roundMoney(Number(row.outflows)),
      net: roundMoney(Number(row.net))
    });
  }

  return points;
}

async function buildMonthlyOutflowsByCategory(
  householdId: string,
  rangeEnd: string,
  accountId: string | undefined,
  ownerScope: "household" | "person" | undefined,
  ownerPersonProfileId: string | undefined,
  rollup: "leaf" | "parent"
): Promise<CashSummaryMonthCategoryOutflows[]> {
  const endYm = rangeEnd.slice(0, 7);
  const points: CashSummaryMonthCategoryOutflows[] = [];
  const { sql: acctSql, params: acctParams } = ownershipFilterClause(accountId, ownerScope, ownerPersonProfileId);

  const leafMonthly = `SELECT
           tc.category_id AS "categoryId",
           MAX(COALESCE(c.name, 'Uncategorized')) AS "categoryName",
           COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows
         FROM transaction_canonical tc
         LEFT JOIN category c ON c.id = tc.category_id
         WHERE tc.household_id = ?
           AND tc.status = 'posted'
           AND tc.txn_date >= ? AND tc.txn_date <= ?
           ${transferReportingExclusionClause("tc")}
           ${acctSql}
         GROUP BY tc.category_id
         HAVING SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END) > 0
         ORDER BY outflows DESC`;

  const parentMonthly = `SELECT
           CASE WHEN tc.category_id IS NULL THEN NULL ELSE COALESCE(p.id, c.id) END AS "categoryId",
           MAX(CASE WHEN tc.category_id IS NULL THEN 'Uncategorized' ELSE COALESCE(p.name, c.name) END) AS "categoryName",
           COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows
         FROM transaction_canonical tc
         LEFT JOIN category c ON c.id = tc.category_id
         LEFT JOIN category p ON p.id = c.parent_id
         WHERE tc.household_id = ?
           AND tc.status = 'posted'
           AND tc.txn_date >= ? AND tc.txn_date <= ?
           ${transferReportingExclusionClause("tc")}
           ${acctSql}
         GROUP BY CASE WHEN tc.category_id IS NULL THEN NULL ELSE COALESCE(p.id, c.id) END
         HAVING SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END) > 0
         ORDER BY outflows DESC`;

  for (let i = 5; i >= 0; i -= 1) {
    const ym = monthsBack(endYm, i);
    const monthStart = `${ym}-01`;
    const monthEndFull = lastDayOfMonth(ym);
    const capEnd = ym === endYm ? minDate(monthEndFull, rangeEnd) : monthEndFull;

    const rows = await qAll<{
      categoryId: string | null;
      categoryName: string;
      outflows: string | number;
    }>(rollup === "parent" ? parentMonthly : leafMonthly, householdId, monthStart, capEnd, ...acctParams);

    points.push({
      month: ym,
      segments: rows.map((r) => ({
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        outflows: roundMoney(Number(r.outflows))
      }))
    });
  }

  return points;
}

export async function assertAccountInHousehold(accountId: string, householdId: string): Promise<boolean> {
  const row = await qGet<{ ok: number }>(
    `SELECT 1 AS ok FROM financial_account WHERE id = ? AND household_id = ?`,
    accountId,
    householdId
  );
  return Boolean(row);
}

export async function getCashSummary(householdId: string, input: CashSummaryInput): Promise<CashSummaryResult> {
  const { range, asOf } = resolveCashRange(input);

  if (input.accountId && !(await assertAccountInHousehold(input.accountId, householdId))) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }
  if (input.ownerScope === "person" && !input.ownerPersonProfileId) {
    throw new Error("OWNER_PERSON_REQUIRED");
  }

  const household = await aggregateForRange(
    householdId,
    range.start,
    range.end,
    input.accountId,
    input.ownerScope,
    input.ownerPersonProfileId
  );
  const comparisonRanges = resolveComparisonRanges(input, range);
  const previousHousehold = await aggregateForRange(
    householdId,
    comparisonRanges.previous.start,
    comparisonRanges.previous.end,
    input.accountId,
    input.ownerScope,
    input.ownerPersonProfileId
  );
  const yearOverYearHousehold = comparisonRanges.yearOverYear
    ? await aggregateForRange(
        householdId,
        comparisonRanges.yearOverYear.start,
        comparisonRanges.yearOverYear.end,
        input.accountId,
        input.ownerScope,
        input.ownerPersonProfileId
      )
    : null;
  const byAccount = input.breakdown
    ? await aggregateByAccount(
        householdId,
        range.start,
        range.end,
        input.accountId,
        input.ownerScope,
        input.ownerPersonProfileId
      )
    : null;
  const rollup = input.categoryRollup ?? "parent";
  let byCategory: CashSummaryCategoryRow[] | null = null;
  if (input.categoryBreakdown) {
    const current = await aggregateByCategory(
      householdId,
      range.start,
      range.end,
      input.accountId,
      input.ownerScope,
      input.ownerPersonProfileId,
      rollup
    );
    const previous = await aggregateByCategory(
      householdId,
      comparisonRanges.previous.start,
      comparisonRanges.previous.end,
      input.accountId,
      input.ownerScope,
      input.ownerPersonProfileId,
      rollup
    );
    byCategory = mergeCategoryPreviousAndDeltas(current, previous);
  }
  const trend = await monthlyTrend(householdId, range.end, input.accountId, input.ownerScope, input.ownerPersonProfileId);
  const monthlyOutflowsByCategory = input.categoryBreakdown
    ? await buildMonthlyOutflowsByCategory(
        householdId,
        range.end,
        input.accountId,
        input.ownerScope,
        input.ownerPersonProfileId,
        rollup
      )
    : null;

  const monthlyTarget = await getHouseholdMonthlySavingsTarget(householdId);
  const spendingPower = buildSpendingPower(household, range.start, range.end, monthlyTarget);

  return {
    range,
    asOf,
    maxCustomRangeDays: env.CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS,
    household,
    spendingPower,
    comparison: {
      previousPeriod: {
        label: comparisonRanges.previous.label,
        range: {
          start: comparisonRanges.previous.start,
          end: comparisonRanges.previous.end
        },
        household: previousHousehold,
        delta: computeDelta(household, previousHousehold)
      },
      ...(comparisonRanges.yearOverYear && yearOverYearHousehold
        ? {
            yearOverYear: {
              label: comparisonRanges.yearOverYear.label,
              range: {
                start: comparisonRanges.yearOverYear.start,
                end: comparisonRanges.yearOverYear.end
              },
              household: yearOverYearHousehold,
              delta: computeDelta(household, yearOverYearHousehold)
            }
          }
        : {})
    },
    byAccount,
    byCategory,
    monthlyTrend: trend,
    monthlyOutflowsByCategory
  };
}
