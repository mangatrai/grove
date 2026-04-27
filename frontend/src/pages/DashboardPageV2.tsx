import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { apiJson, useAuthToken } from "../api";
import { DashboardPageLegacy } from "./DashboardPageLegacy";

type CashSummaryResponse = {
  range: { start: string; end: string; label: string };
  household: { inflows: number; outflows: number; net: number; transactionCount: number };
  byCategory: Array<{ categoryId: string | null; categoryName: string; inflows: number; outflows: number; net: number }> | null;
  spendingPower: { savingsRate: number | null };
  monthlyTrend: Array<{ month: string; inflows: number; outflows: number; net: number }>;
};

type ResolutionSummary = {
  totalOpen: number;
  openByType: { unknown_category?: number; transfer_ambiguity?: number; duplicate_ambiguity?: number };
};

type NetWorthSnapshot = {
  totals: { netWorth: number | null; assets: number | null; liabilities: number | null };
  asOf: string;
};

type NetWorthHistoryPoint = { date: string; netWorth: number | null };

type BudgetMonthResponse = {
  month: string;
  exists: boolean;
  summary: { totalBudgeted: number; totalSpent: number; remaining: number; unbudgetedSpend: number };
  categories: Array<{
    categoryId: string;
    categoryName: string;
    parentName: string | null;
    budgeted: number;
    spent: number;
    remaining: number;
    percentUsed: number;
  }>;
};

type LedgerRow = {
  id: string;
  merchant: string | null;
  amount: number;
  txnDate: string;
  status: string;
};

type CashDataState = CashSummaryResponse | null | "error";

type RecurringItem = { merchant: string; medianAmount: number; monthCount: number };

const PIE_COLORS = ["#3b82f6", "#f59e0b", "#22c55e", "#e11d48", "#8b5cf6", "#64748b"];

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = [
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
  return `${names[m! - 1]} ${y}`;
}

function firstDayOf(ym: string): string {
  return `${ym}-01`;
}

function lastDayOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, m!, 0).toISOString().slice(0, 10);
}

function firstDayNMonthsBefore(ym: string, n: number): string {
  let [y, m] = ym.split("-").map(Number);
  m = m! - n;
  while (m! <= 0) {
    m = m! + 12;
    y = y! - 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function formatMonthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m! - 1]} '${String(y).slice(2)}`;
}

function formatNoCents(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function detectRecurring(txns: LedgerRow[]): RecurringItem[] {
  const posted = txns.filter((t) => t.status === "posted" && t.amount < 0);
  const byMerchant = new Map<string, LedgerRow[]>();
  for (const t of posted) {
    const key = (t.merchant ?? "Unknown").toLowerCase().trim();
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), t]);
  }
  const results: RecurringItem[] = [];
  for (const [, rows] of byMerchant) {
    if (rows.length < 2) continue;
    const months = new Set(rows.map((r) => r.txnDate.slice(0, 7)));
    if (months.size < 2) continue;
    const amounts = rows.map((r) => Math.abs(r.amount)).sort((a, b) => a - b);
    const mid = Math.floor(amounts.length / 2);
    const median = amounts.length % 2 === 0 ? (amounts[mid - 1]! + amounts[mid]!) / 2 : amounts[mid]!;
    results.push({ merchant: rows[0]!.merchant ?? "Unknown", medianAmount: median, monthCount: months.size });
  }
  return results.sort((a, b) => b.medianAmount - a.medianAmount);
}

function outflowSlices(cashData: CashSummaryResponse | null): Array<{ categoryId: string | null; categoryName: string; outflows: number }> {
  const rows = (cashData?.byCategory ?? []).filter((r) => r.outflows > 0).sort((a, b) => b.outflows - a.outflows);
  if (rows.length <= 5) {
    return rows.map((r) => ({ categoryId: r.categoryId, categoryName: r.categoryName, outflows: r.outflows }));
  }
  const top = rows.slice(0, 5).map((r) => ({ categoryId: r.categoryId, categoryName: r.categoryName, outflows: r.outflows }));
  const other = rows.slice(5).reduce((acc, row) => acc + row.outflows, 0);
  return [...top, { categoryId: null, categoryName: "Other", outflows: other }];
}

export function DashboardPageV2() {
  const token = useAuthToken();
  const [useClassicView, setUseClassicView] = useState(() => localStorage.getItem("dashboard_classic") === "1");
  const [activeMonth, setActiveMonth] = useState<string>(() => currentYearMonth());
  const [cashData, setCashData] = useState<CashDataState>(null);
  const [resolutionData, setResolutionData] = useState<ResolutionSummary | null>(null);
  const [netWorthData, setNetWorthData] = useState<NetWorthSnapshot | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthHistoryPoint[] | null>(null);
  const [budgetData, setBudgetData] = useState<BudgetMonthResponse | null>(null);
  const [recentTxns, setRecentTxns] = useState<LedgerRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [cashRetrying, setCashRetrying] = useState(false);
  const [showAllRecurring, setShowAllRecurring] = useState(false);

  const isCurrentMonth = activeMonth === currentYearMonth();

  const loadCashSummary = useCallback(async () => {
    if (useClassicView) {
      return;
    }
    setCashRetrying(true);
    try {
      const value = await apiJson<CashSummaryResponse>(
        `/reports/cash-summary?preset=month&month=${encodeURIComponent(activeMonth)}&categoryBreakdown=true&categoryRollup=parent`,
        { cache: "no-store" }
      );
      setCashData(value);
    } catch {
      setCashData("error");
    } finally {
      setCashRetrying(false);
    }
  }, [activeMonth, useClassicView]);

  const loadAll = useCallback(async () => {
    if (!token || useClassicView) {
      return;
    }
    setLoading(true);
    const historyFrom = firstDayNMonthsBefore(activeMonth, 6);
    const monthEnd = lastDayOf(activeMonth);
    const results = await Promise.allSettled([
      apiJson<CashSummaryResponse>(
        `/reports/cash-summary?preset=month&month=${encodeURIComponent(activeMonth)}&categoryBreakdown=true&categoryRollup=parent`,
        { cache: "no-store" }
      ),
      apiJson<ResolutionSummary>("/resolution/summary", { cache: "no-store" }),
      apiJson<NetWorthSnapshot>("/reports/balance-sheet", { cache: "no-store" }),
      apiJson<{ points: NetWorthHistoryPoint[] }>(
        `/reports/balance-sheet/history?from=${historyFrom}&to=${monthEnd}&interval=month`,
        { cache: "no-store" }
      ),
      apiJson<BudgetMonthResponse>(`/budget/${encodeURIComponent(activeMonth)}`, { cache: "no-store" }),
      apiJson<{ transactions: LedgerRow[] }>(
        `/transactions?limit=200&dateFrom=${historyFrom}&dateTo=${monthEnd}`,
        { cache: "no-store" }
      )
    ]);
    setCashData(results[0].status === "fulfilled" ? results[0].value : "error");
    setResolutionData(results[1].status === "fulfilled" ? results[1].value : null);
    setNetWorthData(results[2].status === "fulfilled" ? results[2].value : null);
    setNetWorthHistory(results[3].status === "fulfilled" ? results[3].value.points : null);
    setBudgetData(results[4].status === "fulfilled" ? results[4].value : null);
    setRecentTxns(results[5].status === "fulfilled" ? results[5].value.transactions : null);
    setLoading(false);
  }, [activeMonth, token, useClassicView]);

  useEffect(() => {
    if (useClassicView) {
      return;
    }
    void loadAll();
  }, [loadAll, useClassicView]);

  useEffect(() => {
    setShowAllRecurring(false);
  }, [activeMonth]);

  const recurring = useMemo(() => detectRecurring(recentTxns ?? []), [recentTxns]);
  const recurringVisible = showAllRecurring ? recurring : recurring.slice(0, 5);
  const recurringTotalMonthly = useMemo(
    () => recurring.reduce((acc, item) => acc + item.medianAmount, 0),
    [recurring]
  );

  const trendData = cashData && cashData !== "error" ? cashData.monthlyTrend : [];
  const trendMax = useMemo(
    () => Math.max(0, ...trendData.flatMap((p) => [p.inflows, p.outflows])),
    [trendData]
  );
  const trendUseK = trendMax >= 1000;
  const slices = cashData && cashData !== "error" ? outflowSlices(cashData) : [];
  const totalOutflows = slices.reduce((acc, s) => acc + s.outflows, 0);

  if (useClassicView) {
    return (
      <>
        <DashboardPageLegacy />
        <div style={{ textAlign: "right", padding: "0.5rem 1rem", fontSize: "0.82rem" }}>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              localStorage.removeItem("dashboard_classic");
              setUseClassicView(false);
            }}
          >
            Switch to new view
          </button>
        </div>
      </>
    );
  }

  const cashUnavailable = cashData === "error";
  const monthStart = firstDayOf(activeMonth);
  const monthEnd = lastDayOf(activeMonth);

  return (
    <main className="dashboard-page">
      <div className="card dashboard-page__hero">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <button type="button" className="secondary" onClick={() => setActiveMonth((m) => prevMonth(m))} disabled={loading}>
            ‹
          </button>
          <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>{formatMonthLabel(activeMonth)}</span>
          <button
            type="button"
            className="secondary"
            onClick={() => setActiveMonth((m) => nextMonth(m))}
            disabled={isCurrentMonth || loading}
          >
            ›
          </button>
          <span style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: "0.8rem", padding: "0.2rem 0.5rem" }}
              onClick={() => {
                localStorage.setItem("dashboard_classic", "1");
                setUseClassicView(true);
              }}
            >
              Classic view
            </button>
          </span>
        </div>

        {loading ? (
          <div style={{ height: 60, borderRadius: 6, background: "#e5e7eb", width: 200, margin: "0 auto 1rem" }} />
        ) : cashUnavailable ? (
          <p className="muted" style={{ textAlign: "center", marginBottom: "1rem" }}>
            {cashRetrying ? (
              "Retrying…"
            ) : (
              <>
                Cash flow unavailable ·{" "}
                <button type="button" className="secondary" onClick={() => void loadCashSummary()}>
                  Retry
                </button>
              </>
            )}
          </p>
        ) : cashData ? (
          <>
            <p
              style={{
                fontSize: "2.8rem",
                fontWeight: 700,
                textAlign: "center",
                margin: "0.2rem 0",
                color: cashData.household.net > 0 ? "#16a34a" : cashData.household.net < 0 ? "#dc2626" : "#6b7280"
              }}
            >
              {cashData.household.net >= 0 ? "+" : "−"}${formatNoCents(Math.abs(cashData.household.net))}
            </p>
            <p
              className="muted"
              style={{
                textAlign: "center",
                fontSize: "0.95rem",
                marginTop: 0,
                color:
                  cashData.household.transactionCount === 0
                    ? undefined
                    : cashData.household.net < 0
                      ? "#dc2626"
                      : cashData.spendingPower.savingsRate !== null && cashData.spendingPower.savingsRate > 0.2
                        ? "#16a34a"
                        : undefined
              }}
            >
              {cashData.household.transactionCount === 0
                ? "No transactions posted yet — import a statement to get started"
                : cashData.spendingPower.savingsRate !== null &&
                    cashData.spendingPower.savingsRate > 0 &&
                    cashData.household.inflows > 0
                  ? `Saved ${Math.round(cashData.spendingPower.savingsRate * 100)}% of income this month`
                  : cashData.household.net < 0
                    ? "Spending exceeded income this month"
                    : ""}
            </p>
          </>
        ) : null}

        {budgetData?.exists && budgetData.summary.totalBudgeted > 0 ? (
          <div style={{ marginTop: "0.8rem" }}>
            <div style={{ height: 8, borderRadius: 4, background: "#e5e7eb", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.min(100, (budgetData.summary.totalSpent / budgetData.summary.totalBudgeted) * 100)}%`,
                  height: "100%",
                  background:
                    budgetData.summary.totalSpent >= budgetData.summary.totalBudgeted
                      ? "#dc2626"
                      : budgetData.summary.totalSpent / budgetData.summary.totalBudgeted >= 0.8
                        ? "#f59e0b"
                        : "#22c55e"
                }}
              />
            </div>
            <div style={{ display: "flex", marginTop: "0.35rem", fontSize: "0.85rem" }}>
              <span
                className="muted"
                style={{
                  color: budgetData.summary.totalSpent > budgetData.summary.totalBudgeted ? "#dc2626" : undefined
                }}
              >
                {budgetData.summary.totalSpent > budgetData.summary.totalBudgeted
                  ? `Over budget by $${formatNoCents(budgetData.summary.totalSpent - budgetData.summary.totalBudgeted)}`
                  : `$${formatNoCents(budgetData.summary.totalSpent)} spent · ${Math.min(
                      100,
                      Math.round((budgetData.summary.totalSpent / budgetData.summary.totalBudgeted) * 100)
                    )}% of $${formatNoCents(budgetData.summary.totalBudgeted)} budget`}
              </span>
              <Link to="/budget" style={{ marginLeft: "auto" }}>
                Manage →
              </Link>
            </div>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: "0.7rem", fontSize: "0.9rem" }}>
            No budget set for this month · <Link to="/budget">Set one up →</Link>
          </p>
        )}

        {!loading && cashData && cashData !== "error" && cashData.household.transactionCount > 0 ? (
          <p className="muted" style={{ marginTop: "0.45rem", fontSize: "0.85rem" }}>
            {cashData.household.transactionCount} posted transactions
          </p>
        ) : null}
      </div>

      {resolutionData?.totalOpen ? (
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(resolutionData.openByType.unknown_category ?? 0) > 0 ? (
            <Link
              to="/transactions?needsReview=true&resolutionType=unknown_category"
              style={{
                padding: "0.3rem 0.75rem",
                borderRadius: "999px",
                fontSize: "0.85rem",
                fontWeight: 500,
                textDecoration: "none",
                border: "1px solid #fcd34d",
                background: "#fef3c7",
                color: "#92400e",
                display: "inline-block"
              }}
            >
              ⚠ {resolutionData.openByType.unknown_category} uncategorized
            </Link>
          ) : null}
          {(resolutionData.openByType.transfer_ambiguity ?? 0) > 0 ? (
            <Link
              to="/transactions?needsReview=true&resolutionType=transfer_ambiguity"
              style={{
                padding: "0.3rem 0.75rem",
                borderRadius: "999px",
                fontSize: "0.85rem",
                fontWeight: 500,
                textDecoration: "none",
                border: "1px solid #fcd34d",
                background: "#fef3c7",
                color: "#92400e",
                display: "inline-block"
              }}
            >
              ⟳ {resolutionData.openByType.transfer_ambiguity} transfer
              {resolutionData.openByType.transfer_ambiguity === 1 ? "" : "s"} to pair
            </Link>
          ) : null}
          {(resolutionData.openByType.duplicate_ambiguity ?? 0) > 0 ? (
            <Link
              to="/transactions?needsReview=true&resolutionType=duplicate_ambiguity"
              style={{
                padding: "0.3rem 0.75rem",
                borderRadius: "999px",
                fontSize: "0.85rem",
                fontWeight: 500,
                textDecoration: "none",
                border: "1px solid #fcd34d",
                background: "#fef3c7",
                color: "#92400e",
                display: "inline-block"
              }}
            >
              ◑ {resolutionData.openByType.duplicate_ambiguity} possible duplicate
              {resolutionData.openByType.duplicate_ambiguity === 1 ? "" : "s"}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "1rem",
          marginTop: "1.2rem"
        }}
      >
          <section
            style={{
              background: "var(--color-surface-alt, #f9fafb)",
              border: "1px solid var(--color-border, #e5e7eb)",
              borderRadius: "10px",
              padding: "1.1rem 1.25rem"
            }}
          >
            <p
              style={{
                fontSize: "0.75rem",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#6b7280",
                marginBottom: "0.5rem"
              }}
            >
              Spending This Month
            </p>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : cashUnavailable ? (
              <p className="muted">Spending data unavailable</p>
            ) : slices.length === 0 ? (
              <p className="muted" style={{ textAlign: "center" }}>
                No spending data for this month
              </p>
            ) : (
              <>
                <div style={{ width: "100%", height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={slices} dataKey="outflows" nameKey="categoryName" innerRadius={44} outerRadius={72}>
                        {slices.map((_, i) => (
                          <Cell key={String(i)} fill={PIE_COLORS[i % PIE_COLORS.length]!} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ marginTop: "0.5rem" }}>
                  {slices.map((slice, idx) => {
                    const left = (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "999px",
                            background: PIE_COLORS[idx % PIE_COLORS.length]
                          }}
                        />
                        {slice.categoryName}
                      </span>
                    );
                    const href =
                      slice.categoryName === "Other"
                        ? null
                        : slice.categoryId
                          ? `/transactions?categoryId=${slice.categoryId}&dateFrom=${monthStart}&dateTo=${monthEnd}`
                          : `/transactions?uncategorizedOnly=true&dateFrom=${monthStart}&dateTo=${monthEnd}`;
                    return (
                      <div
                        key={`${slice.categoryName}-${idx}`}
                        style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.25rem" }}
                      >
                        {href ? <Link to={href}>{left}</Link> : left}
                        <span>${formatNoCents(slice.outflows)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem" }}>
                  ${formatNoCents(totalOutflows)} total outflows
                </p>
              </>
            )}
          </section>

          <section
            style={{
              background: "var(--color-surface-alt, #f9fafb)",
              border: "1px solid var(--color-border, #e5e7eb)",
              borderRadius: "10px",
              padding: "1.1rem 1.25rem"
            }}
          >
            <p
              style={{
                fontSize: "0.75rem",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#6b7280",
                marginBottom: "0.5rem"
              }}
            >
              Net Worth
            </p>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <>
                <p
                  style={{
                    margin: 0,
                    fontSize: "1.7rem",
                    fontWeight: 700,
                    color:
                      netWorthData?.totals.netWorth == null
                        ? "inherit"
                        : netWorthData.totals.netWorth >= 0
                          ? "#16a34a"
                          : "#dc2626"
                  }}
                >
                  {netWorthData?.totals.netWorth == null ? "—" : `$${formatNoCents(netWorthData.totals.netWorth)}`}
                </p>
                {netWorthData && (netWorthData.totals.assets !== null || netWorthData.totals.liabilities !== null) ? (
                  <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.45rem" }}>
                    Assets{" "}
                    {netWorthData.totals.assets == null ? "—" : `$${formatNoCents(netWorthData.totals.assets)}`} ·
                    Liabilities{" "}
                    {netWorthData.totals.liabilities == null ? "—" : `$${formatNoCents(netWorthData.totals.liabilities)}`}
                  </p>
                ) : null}
                {(() => {
                  const points = (netWorthHistory ?? [])
                    .filter(
                      (p): p is NetWorthHistoryPoint & { netWorth: number } =>
                        p != null &&
                        typeof p.date === "string" &&
                        p.date.length > 0 &&
                        typeof p.netWorth === "number" &&
                        Number.isFinite(p.netWorth)
                    )
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date));
                  if (points.length < 2) return null;
                  const latest = points[points.length - 1]!;
                  return (
                    <div style={{ width: "100%", height: 52, marginTop: "0.5rem" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                          <Line
                            type="monotone"
                            dataKey="netWorth"
                            dot={false}
                            strokeWidth={2}
                            stroke={(latest.netWorth ?? 0) >= 0 ? "#16a34a" : "#dc2626"}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
                {netWorthData ? (
                  <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.3rem" }}>
                    as of {netWorthData.asOf}
                  </p>
                ) : null}
                <div style={{ textAlign: "right" }}>
                  <Link to="/net-worth" style={{ fontSize: "0.82rem" }}>
                    View details →
                  </Link>
                </div>
              </>
            )}
          </section>

          <section
            style={{
              background: "var(--color-surface-alt, #f9fafb)",
              border: "1px solid var(--color-border, #e5e7eb)",
              borderRadius: "10px",
              padding: "1.1rem 1.25rem"
            }}
          >
            <p
              style={{
                fontSize: "0.75rem",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#6b7280",
                marginBottom: "0.5rem"
              }}
            >
              Monthly Commitments
            </p>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : recurring.length === 0 ? (
              <p className="muted">
                No recurring charges detected yet — import a few months of statements to see patterns
              </p>
            ) : (
              <>
                <p style={{ fontWeight: 600, fontSize: "1.4rem", margin: 0 }}>
                  ${formatNoCents(recurringTotalMonthly)} / month
                </p>
                <p className="muted" style={{ marginTop: "0.35rem", fontSize: "0.85rem" }}>
                  across {recurring.length} recurring charge{recurring.length === 1 ? "" : "s"}
                </p>
                <div>
                  {recurringVisible.map((item) => (
                    <div
                      key={item.merchant}
                      style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                    >
                      <span>{item.merchant}</span>
                      <span>${item.medianAmount.toFixed(2)}/mo</span>
                    </div>
                  ))}
                </div>
                {!showAllRecurring && recurring.length > 5 ? (
                  <button type="button" className="secondary" onClick={() => setShowAllRecurring(true)}>
                    + {recurring.length - 5} more
                  </button>
                ) : null}
              </>
            )}
          </section>
      </div>

      <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "1.5rem 0 0.5rem" }}>6-month trend</h2>
      {cashUnavailable ? (
        <p className="muted">Trend data unavailable</p>
      ) : !loading && trendData.length > 0 ? (
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tickFormatter={(v) => formatMonthShort(String(v))} />
              <YAxis tickFormatter={(v) => (trendUseK ? `$${(Number(v) / 1000).toFixed(0)}k` : `$${Number(v).toFixed(0)}`)} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
              <Legend />
              <Bar dataKey="inflows" fill="#22c55e" name="Income" />
              <Bar dataKey="outflows" fill="#f97316" name="Spending" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </main>
  );
}

