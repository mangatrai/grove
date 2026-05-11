import type { PayslipSnapshotDetail } from "./types";
import { FS_FOREST, FS_GOLD, FS_TERRACOTTA } from "../theme/chartPalette";

function sortTime(r: PayslipSnapshotDetail): number {
  const s = r.payDate ?? r.payPeriodEnd ?? r.payPeriodStart ?? r.createdAt;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/** Calendar day in local time for grouping (pay date → else period end → else period start → upload time). */
export function payrollDayKey(r: PayslipSnapshotDetail): string | null {
  const raw = r.payDate ?? r.payPeriodEnd ?? r.payPeriodStart ?? r.createdAt;
  if (!raw) {
    return null;
  }
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) {
    return null;
  }
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function labelForDayKey(dayKey: string): string {
  const [y, m, day] = dayKey.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export type PaycheckChartPoint = {
  /** Stable key for chart / React (YYYY-MM-DD). */
  dayKey: string;
  label: string;
  gross: number;
  net: number;
  taxes: number;
  /** Stubs merged into this point (same calendar pay date). */
  stubCount: number;
  sortTime: number;
};

/**
 * One point per calendar pay date: multiple uploads or jobs on the same day are summed.
 * Chronological order (oldest → newest).
 */
export function toPaycheckSeries(items: PayslipSnapshotDetail[]): PaycheckChartPoint[] {
  const map = new Map<
    string,
    { gross: number; net: number; taxes: number; n: number; sortTime: number }
  >();
  for (const r of items) {
    const dayKey = payrollDayKey(r);
    if (!dayKey) {
      continue;
    }
    const t = sortTime(r);
    const cur = map.get(dayKey) ?? { gross: 0, net: 0, taxes: 0, n: 0, sortTime: t };
    cur.gross += r.grossPayCurrent ?? 0;
    cur.net += r.netPayCurrent ?? 0;
    cur.taxes += r.employeeTaxesCurrent ?? 0;
    cur.n += 1;
    cur.sortTime = Math.min(cur.sortTime, t);
    map.set(dayKey, cur);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[1].sortTime - b[1].sortTime)
    .map(([dayKey, v]) => ({
      dayKey,
      label: labelForDayKey(dayKey),
      gross: v.gross,
      net: v.net,
      taxes: v.taxes,
      stubCount: v.n,
      sortTime: v.sortTime
    }));
}

function monthKeyFromSnapshot(r: PayslipSnapshotDetail): string | null {
  const raw = r.payDate ?? r.payPeriodEnd ?? r.payPeriodStart;
  if (!raw) {
    return null;
  }
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) {
    return null;
  }
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export type MonthPayrollBucket = {
  monthKey: string;
  label: string;
  gross: number;
  net: number;
  taxes: number;
  stubCount: number;
};

export function aggregatePayrollByCalendarMonth(items: PayslipSnapshotDetail[]): MonthPayrollBucket[] {
  const map = new Map<string, { gross: number; net: number; taxes: number; n: number }>();
  for (const r of items) {
    const key = monthKeyFromSnapshot(r);
    if (!key) {
      continue;
    }
    const cur = map.get(key) ?? { gross: 0, net: 0, taxes: 0, n: 0 };
    cur.gross += r.grossPayCurrent ?? 0;
    cur.net += r.netPayCurrent ?? 0;
    cur.taxes += r.employeeTaxesCurrent ?? 0;
    cur.n += 1;
    map.set(key, cur);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, v]) => ({
      monthKey,
      label: monthLabel(monthKey),
      gross: v.gross,
      net: v.net,
      taxes: v.taxes,
      stubCount: v.n
    }));
}

export type BreakdownSlice = { name: string; value: number; fill: string };

/** Most recent stub by pay/period date — composition of “current” column. */
export function latestSnapshotForBreakdown(
  items: PayslipSnapshotDetail[]
): PayslipSnapshotDetail | null {
  if (items.length === 0) {
    return null;
  }
  const sorted = [...items].sort((a, b) => sortTime(b) - sortTime(a));
  return sorted[0] ?? null;
}

const BREAKDOWN_COLORS = {
  net: FS_FOREST,
  taxes: FS_GOLD,
  preTax: "#7c3aed",
  postTax: FS_TERRACOTTA
};

export function payslipBreakdownSlices(r: PayslipSnapshotDetail): BreakdownSlice[] {
  const net = r.netPayCurrent ?? 0;
  const tax = r.employeeTaxesCurrent ?? 0;
  const pre = r.preTaxDeductionsCurrent ?? 0;
  const post = r.postTaxDeductionsCurrent ?? 0;
  const out: BreakdownSlice[] = [];
  if (net > 0) {
    out.push({ name: "Net pay (take-home)", value: net, fill: BREAKDOWN_COLORS.net });
  }
  if (tax > 0) {
    out.push({ name: "Employee taxes withheld", value: tax, fill: BREAKDOWN_COLORS.taxes });
  }
  if (pre > 0) {
    out.push({ name: "Pre-tax deductions", value: pre, fill: BREAKDOWN_COLORS.preTax });
  }
  if (post > 0) {
    out.push({ name: "Post-tax deductions", value: post, fill: BREAKDOWN_COLORS.postTax });
  }
  return out;
}
