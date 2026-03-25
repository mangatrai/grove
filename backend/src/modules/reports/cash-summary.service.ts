import { db } from "../../db/sqlite.js";

export type CashPreset = "month" | "ytd" | "rolling_30" | "rolling_90";

export interface CashSummaryInput {
  preset: CashPreset;
  /** Required when preset is `month` (YYYY-MM). */
  month?: string;
  /** Inclusive end date for rolling/YTD and month boundaries (YYYY-MM-DD). Defaults to today (UTC). */
  asOf?: string;
  /** Include per-account breakdown for the KPI range. */
  breakdown: boolean;
  /** Include per-category breakdown (`LEFT JOIN category`; null category = "Uncategorized"). */
  categoryBreakdown: boolean;
  /** When `categoryBreakdown`: `parent` rolls up leaf categories to top-level parent; `leaf` keeps per-leaf rows. Default `parent`. */
  categoryRollup?: "leaf" | "parent";
  /** Optional filter; must belong to household. */
  accountId?: string;
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

export interface CashSummaryResult {
  range: CashSummaryRange;
  asOf: string;
  household: CashSummaryHousehold;
  byAccount: CashSummaryAccountRow[] | null;
  byCategory: CashSummaryCategoryRow[] | null;
  monthlyTrend: CashSummaryTrendPoint[];
  /** Stacked-bar source: outflows per category per month (omitted when `categoryBreakdown` is false). */
  monthlyOutflowsByCategory: CashSummaryMonthCategoryOutflows[] | null;
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

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildRangeLabel(preset: CashPreset, start: string, end: string, month?: string): string {
  switch (preset) {
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
    case "rolling_30":
      return `Last 30 days (${start} – ${end})`;
    case "rolling_90":
      return `Last 90 days (${start} – ${end})`;
    default:
      return `${start} – ${end}`;
  }
}

export function resolveCashRange(input: CashSummaryInput): {
  range: CashSummaryRange;
  asOf: string;
} {
  const asOf = input.asOf?.trim() || defaultAsOfUtc();
  let start: string;
  let end: string;
  let month: string | undefined;

  switch (input.preset) {
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
    case "rolling_30":
      end = asOf;
      start = daysBefore(asOf, 29);
      break;
    case "rolling_90":
      end = asOf;
      start = daysBefore(asOf, 89);
      break;
    default:
      throw new Error("INVALID_PRESET");
  }

  const range: CashSummaryRange = {
    start,
    end,
    preset: input.preset,
    label: buildRangeLabel(input.preset, start, end, month)
  };

  return { range, asOf };
}

function accountFilterClause(accountId: string | undefined): { sql: string; params: string[] } {
  if (!accountId) {
    return { sql: "", params: [] };
  }
  return { sql: " AND tc.account_id = ? ", params: [accountId] };
}

function aggregateForRange(
  householdId: string,
  start: string,
  end: string,
  accountId?: string
): CashSummaryHousehold {
  const { sql: acctSql, params: acctParams } = accountFilterClause(accountId);
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inflows,
         COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows,
         COALESCE(SUM(tc.amount), 0) AS net,
         COUNT(*) AS cnt
       FROM transaction_canonical tc
       WHERE tc.household_id = ?
         AND tc.status = 'posted'
         AND tc.txn_date >= ? AND tc.txn_date <= ?
         ${acctSql}`
    )
    .get(householdId, start, end, ...acctParams) as {
    inflows: number;
    outflows: number;
    net: number;
    cnt: number;
  };

  return {
    inflows: roundMoney(Number(row.inflows)),
    outflows: roundMoney(Number(row.outflows)),
    net: roundMoney(Number(row.net)),
    transactionCount: Number(row.cnt)
  };
}

function aggregateByAccount(
  householdId: string,
  start: string,
  end: string,
  accountId?: string
): CashSummaryAccountRow[] {
  const { sql: acctSql, params: acctParams } = accountFilterClause(accountId);
  const rows = db
    .prepare(
      `SELECT
         tc.account_id AS accountId,
         fa.institution AS institution,
         fa.type AS accountType,
         fa.account_mask AS accountMask,
         COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inflows,
         COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows,
         COALESCE(SUM(tc.amount), 0) AS net,
         COUNT(*) AS cnt
       FROM transaction_canonical tc
       INNER JOIN financial_account fa ON fa.id = tc.account_id AND fa.household_id = tc.household_id
       WHERE tc.household_id = ?
         AND tc.status = 'posted'
         AND tc.txn_date >= ? AND tc.txn_date <= ?
         ${acctSql}
       GROUP BY tc.account_id
       ORDER BY fa.institution, fa.account_mask`
    )
    .all(householdId, start, end, ...acctParams) as Array<{
    accountId: string;
    institution: string;
    accountType: string;
    accountMask: string | null;
    inflows: number;
    outflows: number;
    net: number;
    cnt: number;
  }>;

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

function aggregateByCategory(
  householdId: string,
  start: string,
  end: string,
  accountId: string | undefined,
  rollup: "leaf" | "parent"
): CashSummaryCategoryRow[] {
  const { sql: acctSql, params: acctParams } = accountFilterClause(accountId);

  const leafQuery = `SELECT
         tc.category_id AS categoryId,
         COALESCE(c.name, 'Uncategorized') AS categoryName,
         COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inflows,
         COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows,
         COALESCE(SUM(tc.amount), 0) AS net,
         COUNT(*) AS cnt
       FROM transaction_canonical tc
       LEFT JOIN category c ON c.id = tc.category_id
       WHERE tc.household_id = ?
         AND tc.status = 'posted'
         AND tc.txn_date >= ? AND tc.txn_date <= ?
         ${acctSql}
       GROUP BY tc.category_id
       ORDER BY outflows DESC, inflows DESC`;

  const parentQuery = `SELECT
         CASE WHEN tc.category_id IS NULL THEN NULL ELSE COALESCE(p.id, c.id) END AS categoryId,
         CASE WHEN tc.category_id IS NULL THEN 'Uncategorized' ELSE COALESCE(p.name, c.name) END AS categoryName,
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
         ${acctSql}
       GROUP BY CASE WHEN tc.category_id IS NULL THEN NULL ELSE COALESCE(p.id, c.id) END
       ORDER BY outflows DESC, inflows DESC`;

  const rows = db
    .prepare(rollup === "parent" ? parentQuery : leafQuery)
    .all(householdId, start, end, ...acctParams) as Array<{
    categoryId: string | null;
    categoryName: string;
    inflows: number;
    outflows: number;
    net: number;
    cnt: number;
  }>;

  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    inflows: roundMoney(Number(r.inflows)),
    outflows: roundMoney(Number(r.outflows)),
    net: roundMoney(Number(r.net)),
    transactionCount: Number(r.cnt)
  }));
}

function monthlyTrend(
  householdId: string,
  rangeEnd: string,
  accountId?: string
): CashSummaryTrendPoint[] {
  const endYm = rangeEnd.slice(0, 7);
  const points: CashSummaryTrendPoint[] = [];
  const { sql: acctSql, params: acctParams } = accountFilterClause(accountId);

  for (let i = 5; i >= 0; i -= 1) {
    const ym = monthsBack(endYm, i);
    const monthStart = `${ym}-01`;
    const monthEndFull = lastDayOfMonth(ym);
    const capEnd = ym === endYm ? minDate(monthEndFull, rangeEnd) : monthEndFull;

    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inflows,
           COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows,
           COALESCE(SUM(tc.amount), 0) AS net
         FROM transaction_canonical tc
         WHERE tc.household_id = ?
           AND tc.status = 'posted'
           AND tc.txn_date >= ? AND tc.txn_date <= ?
           ${acctSql}`
      )
      .get(householdId, monthStart, capEnd, ...acctParams) as {
      inflows: number;
      outflows: number;
      net: number;
    };

    points.push({
      month: ym,
      inflows: roundMoney(Number(row.inflows)),
      outflows: roundMoney(Number(row.outflows)),
      net: roundMoney(Number(row.net))
    });
  }

  return points;
}

function buildMonthlyOutflowsByCategory(
  householdId: string,
  rangeEnd: string,
  accountId: string | undefined,
  rollup: "leaf" | "parent"
): CashSummaryMonthCategoryOutflows[] {
  const endYm = rangeEnd.slice(0, 7);
  const points: CashSummaryMonthCategoryOutflows[] = [];
  const { sql: acctSql, params: acctParams } = accountFilterClause(accountId);

  const leafMonthly = `SELECT
           tc.category_id AS categoryId,
           COALESCE(c.name, 'Uncategorized') AS categoryName,
           COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows
         FROM transaction_canonical tc
         LEFT JOIN category c ON c.id = tc.category_id
         WHERE tc.household_id = ?
           AND tc.status = 'posted'
           AND tc.txn_date >= ? AND tc.txn_date <= ?
           ${acctSql}
         GROUP BY tc.category_id
         HAVING SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END) > 0
         ORDER BY outflows DESC`;

  const parentMonthly = `SELECT
           CASE WHEN tc.category_id IS NULL THEN NULL ELSE COALESCE(p.id, c.id) END AS categoryId,
           CASE WHEN tc.category_id IS NULL THEN 'Uncategorized' ELSE COALESCE(p.name, c.name) END AS categoryName,
           COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outflows
         FROM transaction_canonical tc
         LEFT JOIN category c ON c.id = tc.category_id
         LEFT JOIN category p ON p.id = c.parent_id
         WHERE tc.household_id = ?
           AND tc.status = 'posted'
           AND tc.txn_date >= ? AND tc.txn_date <= ?
           ${acctSql}
         GROUP BY CASE WHEN tc.category_id IS NULL THEN NULL ELSE COALESCE(p.id, c.id) END
         HAVING SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END) > 0
         ORDER BY outflows DESC`;

  for (let i = 5; i >= 0; i -= 1) {
    const ym = monthsBack(endYm, i);
    const monthStart = `${ym}-01`;
    const monthEndFull = lastDayOfMonth(ym);
    const capEnd = ym === endYm ? minDate(monthEndFull, rangeEnd) : monthEndFull;

    const rows = db
      .prepare(rollup === "parent" ? parentMonthly : leafMonthly)
      .all(householdId, monthStart, capEnd, ...acctParams) as Array<{
      categoryId: string | null;
      categoryName: string;
      outflows: number;
    }>;

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

export function assertAccountInHousehold(accountId: string, householdId: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM financial_account WHERE id = ? AND household_id = ?`)
    .get(accountId, householdId) as { ok: number } | undefined;
  return Boolean(row);
}

export function getCashSummary(householdId: string, input: CashSummaryInput): CashSummaryResult {
  const { range, asOf } = resolveCashRange(input);

  if (input.accountId && !assertAccountInHousehold(input.accountId, householdId)) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }

  const household = aggregateForRange(householdId, range.start, range.end, input.accountId);
  const byAccount = input.breakdown
    ? aggregateByAccount(householdId, range.start, range.end, input.accountId)
    : null;
  const rollup = input.categoryRollup ?? "parent";
  const byCategory = input.categoryBreakdown
    ? aggregateByCategory(householdId, range.start, range.end, input.accountId, rollup)
    : null;
  const trend = monthlyTrend(householdId, range.end, input.accountId);
  const monthlyOutflowsByCategory = input.categoryBreakdown
    ? buildMonthlyOutflowsByCategory(householdId, range.end, input.accountId, rollup)
    : null;

  return {
    range,
    asOf,
    household,
    byAccount,
    byCategory,
    monthlyTrend: trend,
    monthlyOutflowsByCategory
  };
}
