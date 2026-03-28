import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { apiJson, useAuthToken } from "../api";
import { formatAccountForSelect } from "../import/accountDisplay";

type CashPreset = "month" | "ytd" | "rolling_30" | "rolling_90";

type CashSummaryCategoryRow = {
  categoryId: string | null;
  categoryName: string;
  inflows: number;
  outflows: number;
  net: number;
  transactionCount: number;
};

type CashSummaryResponse = {
  range: { start: string; end: string; preset: CashPreset; label: string };
  asOf: string;
  household: {
    inflows: number;
    outflows: number;
    net: number;
    transactionCount: number;
  };
  comparison?: {
    previousPeriod: {
      label: string;
      range: { start: string; end: string };
      household: { inflows: number; outflows: number; net: number; transactionCount: number };
      delta: { inflows: number; outflows: number; net: number };
    };
    yearOverYear?: {
      label: string;
      range: { start: string; end: string };
      household: { inflows: number; outflows: number; net: number; transactionCount: number };
      delta: { inflows: number; outflows: number; net: number };
    };
  };
  byAccount: Array<{
    accountId: string;
    institution: string;
    accountType: string;
    accountMask: string | null;
    inflows: number;
    outflows: number;
    net: number;
    transactionCount: number;
  }> | null;
  byCategory: CashSummaryCategoryRow[] | null;
  monthlyTrend: Array<{ month: string; inflows: number; outflows: number; net: number }>;
  monthlyOutflowsByCategory: Array<{
    month: string;
    segments: Array<{ categoryId: string | null; categoryName: string; outflows: number }>;
  }> | null;
  spendingPower: {
    monthlySavingsTargetUsd: number | null;
    savingsTargetApplied: number | null;
    safeToSpend: number | null;
    savingsRate: number | null;
    explanation: string;
  };
};

type AccountRow = {
  id: string;
  institution: string;
  type: string;
  account_mask: string | null;
};

const PIE_COLORS = ["#0b5fff", "#22c55e", "#f59e0b", "#e11d48", "#8b5cf6", "#0d9488", "#64748b", "#94a3b8"];

function formatMonthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m! - 1]} ${String(y).slice(2)}`;
}

function formatMoneySigned(n: number): string {
  const abs = Math.abs(n);
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${abs.toFixed(2)}`;
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthStr(): string {
  return new Date().toISOString().slice(0, 7);
}

function asPreset(v: string | null): CashPreset {
  return v === "month" || v === "ytd" || v === "rolling_30" || v === "rolling_90" ? v : "rolling_30";
}

function formatDeltaMoney(n: number): string {
  if (n === 0) {
    return "$0.00";
  }
  return formatMoneySigned(n);
}

function deltaTone(n: number): "up" | "down" | "flat" {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

function ledgerDrillHref(
  range: { start: string; end: string },
  opts?: {
    categoryId?: string | null;
    uncategorizedOnly?: boolean;
    accountId?: string | null;
    dashboardContext?: URLSearchParams;
  }
): string {
  const qs = new URLSearchParams();
  qs.set("dateFrom", range.start);
  qs.set("dateTo", range.end);
  if (opts?.accountId) {
    qs.set("accountId", opts.accountId);
  }
  if (opts?.uncategorizedOnly) {
    qs.set("uncategorizedOnly", "true");
  } else if (opts?.categoryId) {
    qs.set("categoryId", opts.categoryId);
  }
  if (opts?.dashboardContext) {
    qs.set("returnTo", `/?${opts.dashboardContext.toString()}`);
    qs.set("fromDashboard", "true");
  }
  return `/transactions?${qs.toString()}`;
}

function KpiInfo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kpi-info">
      <button type="button" className="kpi-info__btn" aria-label={`About ${label}`}>
        i
      </button>
      <div className="kpi-info__tip" role="tooltip">
        {children}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = useAuthToken();
  const [preset, setPreset] = useState<CashPreset>(() => asPreset(searchParams.get("preset")));
  const [monthStr, setMonthStr] = useState(searchParams.get("month") || currentMonthStr());
  const [asOf, setAsOf] = useState(searchParams.get("asOf") || todayISODate());
  const [accountId, setAccountId] = useState<string>(() => searchParams.get("accountId") || "");
  useEffect(() => {
    const next = new URLSearchParams();
    next.set("preset", preset);
    next.set("asOf", asOf);
    if (preset === "month") {
      next.set("month", monthStr);
    }
    if (accountId) {
      next.set("accountId", accountId);
    }
    setSearchParams(next, { replace: true });
  }, [preset, monthStr, asOf, accountId, setSearchParams]);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [data, setData] = useState<CashSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolutionSummary, setResolutionSummary] = useState<{
    openByType: Record<string, number>;
    totalOpen: number;
  } | null>(null);
  const [savingsTargetDraft, setSavingsTargetDraft] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<{ accounts: AccountRow[] }>("/imports/accounts")
      .then((r) => setAccounts(r.accounts))
      .catch(() => setAccounts([]));
  }, [token]);

  const load = useCallback(async () => {
    setError(null);
    const qs = new URLSearchParams();
    qs.set("preset", preset);
    qs.set("asOf", asOf);
    qs.set("breakdown", "true");
    qs.set("categoryBreakdown", "true");
    qs.set("categoryRollup", "parent");
    if (preset === "month") {
      qs.set("month", monthStr);
    }
    if (accountId) {
      qs.set("accountId", accountId);
    }
    const res = await apiJson<CashSummaryResponse>(`/reports/cash-summary?${qs.toString()}`);
    setData(res);
    void apiJson<{ openByType: Record<string, number>; totalOpen: number }>("/resolution/summary")
      .then((r) => setResolutionSummary(r))
      .catch(() => setResolutionSummary(null));
  }, [preset, monthStr, asOf, accountId]);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    void load()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, load]);

  useEffect(() => {
    if (data?.spendingPower.monthlySavingsTargetUsd != null) {
      setSavingsTargetDraft(String(data.spendingPower.monthlySavingsTargetUsd));
    } else {
      setSavingsTargetDraft("");
    }
  }, [data?.spendingPower.monthlySavingsTargetUsd]);

  const chartData = useMemo(
    () =>
      (data?.monthlyTrend ?? []).map((p) => ({
        ...p,
        label: formatMonthShort(p.month)
      })),
    [data?.monthlyTrend]
  );

  const outflowPieData = useMemo(() => {
    if (!data?.byCategory) {
      return [];
    }
    return data.byCategory
      .filter((c) => c.outflows > 0)
      .map((c) => ({
        name: c.categoryName,
        value: c.outflows,
        categoryId: c.categoryId
      }));
  }, [data?.byCategory]);

  const inflowPieData = useMemo(() => {
    if (!data?.byCategory) {
      return [];
    }
    return data.byCategory
      .filter((c) => c.inflows > 0)
      .map((c) => ({
        name: c.categoryName,
        value: c.inflows,
        categoryId: c.categoryId
      }));
  }, [data?.byCategory]);

  const drillOpts = useMemo(
    () => ({ accountId: accountId || undefined, dashboardContext: new URLSearchParams(searchParams) }),
    [accountId, searchParams]
  );

  async function saveSavingsTarget(value: number | null) {
    if (!token) {
      return;
    }
    setSavingTarget(true);
    setError(null);
    try {
      await apiJson<{ monthlySavingsTargetUsd: number | null }>("/household/settings", {
        method: "PATCH",
        body: JSON.stringify({ monthlySavingsTargetUsd: value })
      });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save savings target");
    } finally {
      setSavingTarget(false);
    }
  }

  function formatPct(n: number | null): string {
    if (n === null || !Number.isFinite(n)) {
      return "—";
    }
    return `${(n * 100).toFixed(1)}%`;
  }

  const stackBarModel = useMemo(() => {
    const raw = data?.monthlyOutflowsByCategory;
    if (!raw || raw.length === 0) {
      return { keys: [] as string[], rows: [] as Record<string, string | number>[] };
    }

    const totals = new Map<string, number>();
    raw.forEach((m) => {
      m.segments.forEach((s) => {
        totals.set(s.categoryName, (totals.get(s.categoryName) ?? 0) + s.outflows);
      });
    });
    const topKeys = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);

    if (topKeys.length === 0) {
      const rows = raw.map((m) => {
        let total = 0;
        m.segments.forEach((s) => {
          total += s.outflows;
        });
        return { label: formatMonthShort(m.month), Outflows: Math.round(total * 100) / 100 };
      });
      return { keys: ["Outflows"], rows };
    }

    const topSet = new Set(topKeys);

    const rows = raw.map((m) => {
      const row: Record<string, string | number> = { label: formatMonthShort(m.month) };
      topKeys.forEach((k) => {
        const seg = m.segments.find((s) => s.categoryName === k);
        row[k] = seg ? seg.outflows : 0;
      });
      let other = 0;
      m.segments.forEach((s) => {
        if (!topSet.has(s.categoryName)) {
          other += s.outflows;
        }
      });
      row.Other = Math.round(other * 100) / 100;
      return row;
    });

    return { keys: [...topKeys, "Other"], rows };
  }, [data?.monthlyOutflowsByCategory]);

  return (
    <div>
      <div className="card">
        <h1>Home</h1>
        {resolutionSummary && (resolutionSummary.openByType.unknown_category ?? 0) > 0 ? (
          <p
            className="muted"
            style={{
              padding: "0.65rem 0.85rem",
              borderRadius: "8px",
              border: "1px solid #bae6fd",
              background: "#f0f9ff",
              marginBottom: "0.75rem"
            }}
          >
            <strong>{resolutionSummary.openByType.unknown_category}</strong> posted transaction(s) have no category
            yet.{" "}
            <Link to="/resolution?status=open&type=unknown_category">Open review queue</Link> to assign categories in
            bulk or per row.
          </p>
        ) : null}
        <p className="muted">
          Posted ledger totals by period — household cashflow plus category splits (rules + manual categories from the
          ledger).
        </p>

        <div className="dashboard-controls">
          <label>
            Period
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as CashPreset)}
              style={{ marginLeft: "0.5rem", width: "auto", minWidth: "12rem" }}
            >
              <option value="month">Calendar month</option>
              <option value="ytd">Year to date</option>
              <option value="rolling_30">Last 30 days</option>
              <option value="rolling_90">Last 90 days</option>
            </select>
          </label>

          {preset === "month" ? (
            <label>
              Month
              <input
                type="month"
                value={monthStr}
                onChange={(e) => setMonthStr(e.target.value)}
                style={{ marginLeft: "0.5rem", width: "auto" }}
              />
            </label>
          ) : null}

          <label>
            As of (end date)
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              style={{ marginLeft: "0.5rem", width: "auto" }}
            />
          </label>

          <label>
            Account
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              style={{ marginLeft: "0.5rem", width: "auto", minWidth: "14rem" }}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAccountForSelect(a)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}

        {!loading && data ? (
          <>
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              <strong>{data.range.label}</strong>
              <span className="muted"> · {data.household.transactionCount} posted transactions</span>
            </p>

            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-label kpi-label--row">
                  <span>Inflows</span>
                  <KpiInfo label="Inflows">
                    Sum of posted credit amounts for this period. If you pick an account above, only that account is
                    included.
                  </KpiInfo>
                </div>
                <div className="kpi-value kpi-in">{formatMoneySigned(data.household.inflows)}</div>
                {data.comparison?.previousPeriod ? (
                  <div className="kpi-delta-row">
                    <span className={`kpi-delta-chip kpi-delta-chip--${deltaTone(data.comparison.previousPeriod.delta.inflows)}`}>
                      vs {data.comparison.previousPeriod.label}: {formatDeltaMoney(data.comparison.previousPeriod.delta.inflows)}
                    </span>
                  </div>
                ) : null}
                {data.comparison?.yearOverYear ? (
                  <div className="kpi-delta-row">
                    <span className={`kpi-delta-chip kpi-delta-chip--${deltaTone(data.comparison.yearOverYear.delta.inflows)}`}>
                      vs {data.comparison.yearOverYear.label}: {formatDeltaMoney(data.comparison.yearOverYear.delta.inflows)}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="kpi-card">
                <div className="kpi-label kpi-label--row">
                  <span>Outflows</span>
                  <KpiInfo label="Outflows">
                    Sum of posted debit amounts for this period. Respects the account filter when set.
                  </KpiInfo>
                </div>
                <div className="kpi-value kpi-out">${data.household.outflows.toFixed(2)}</div>
                {data.comparison?.previousPeriod ? (
                  <div className="kpi-delta-row">
                    <span className={`kpi-delta-chip kpi-delta-chip--${deltaTone(data.comparison.previousPeriod.delta.outflows)}`}>
                      vs {data.comparison.previousPeriod.label}: {formatDeltaMoney(data.comparison.previousPeriod.delta.outflows)}
                    </span>
                  </div>
                ) : null}
                {data.comparison?.yearOverYear ? (
                  <div className="kpi-delta-row">
                    <span className={`kpi-delta-chip kpi-delta-chip--${deltaTone(data.comparison.yearOverYear.delta.outflows)}`}>
                      vs {data.comparison.yearOverYear.label}: {formatDeltaMoney(data.comparison.yearOverYear.delta.outflows)}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="kpi-card">
                <div className="kpi-label kpi-label--row">
                  <span>Net</span>
                  <KpiInfo label="Net">Inflows minus outflows for this period (household cashflow for the range).</KpiInfo>
                </div>
                <div className="kpi-value">{formatMoneySigned(data.household.net)}</div>
                {data.comparison?.previousPeriod ? (
                  <div className="kpi-delta-row">
                    <span className={`kpi-delta-chip kpi-delta-chip--${deltaTone(data.comparison.previousPeriod.delta.net)}`}>
                      vs {data.comparison.previousPeriod.label}: {formatDeltaMoney(data.comparison.previousPeriod.delta.net)}
                    </span>
                  </div>
                ) : null}
                {data.comparison?.yearOverYear ? (
                  <div className="kpi-delta-row">
                    <span className={`kpi-delta-chip kpi-delta-chip--${deltaTone(data.comparison.yearOverYear.delta.net)}`}>
                      vs {data.comparison.yearOverYear.label}: {formatDeltaMoney(data.comparison.yearOverYear.delta.net)}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="kpi-card kpi-card--safe">
                <div className="kpi-label kpi-label--row">
                  <span>Safe to spend</span>
                  <KpiInfo label="Safe to spend">
                    When a monthly savings target is set below, this is net cashflow for this period minus that
                    commitment, scaled by calendar days in the period vs about 30.44 days per month. Without a target,
                    this stays empty.
                  </KpiInfo>
                </div>
                <div className="kpi-value">
                  {data.spendingPower.safeToSpend !== null ? formatMoneySigned(data.spendingPower.safeToSpend) : "—"}
                </div>
                {data.spendingPower.savingsTargetApplied !== null && data.spendingPower.monthlySavingsTargetUsd !== null ? (
                  <p className="kpi-sub muted" style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}>
                    After ~${data.spendingPower.savingsTargetApplied.toFixed(2)} savings commitment this period
                  </p>
                ) : (
                  <p className="kpi-sub muted" style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}>
                    Set a monthly target below
                  </p>
                )}
              </div>
              <div className="kpi-card">
                <div className="kpi-label kpi-label--row">
                  <span>Savings rate</span>
                  <KpiInfo label="Savings rate">
                    When inflows are greater than zero: (inflows − outflows) ÷ inflows, rounded to two decimal places,
                    then shown as a percent. If there are no inflows, this is empty.
                  </KpiInfo>
                </div>
                <div className="kpi-value">{formatPct(data.spendingPower.savingsRate)}</div>
              </div>
            </div>

            <div className="dashboard-savings-target">
              <label className="dashboard-savings-target__label">
                Monthly savings target (USD)
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 500"
                  value={savingsTargetDraft}
                  onChange={(e) => setSavingsTargetDraft(e.target.value)}
                  disabled={savingTarget}
                />
              </label>
              <button
                type="button"
                disabled={savingTarget}
                onClick={() => {
                  const t = savingsTargetDraft.trim();
                  if (t === "") {
                    void saveSavingsTarget(null);
                    return;
                  }
                  const n = Number(t);
                  if (!Number.isFinite(n) || n < 0) {
                    setError("Enter a non-negative number or leave blank to clear.");
                    return;
                  }
                  void saveSavingsTarget(n);
                }}
              >
                {savingTarget ? "Saving…" : "Save target"}
              </button>
              {data.spendingPower.monthlySavingsTargetUsd !== null ? (
                <button type="button" className="secondary" disabled={savingTarget} onClick={() => void saveSavingsTarget(null)}>
                  Clear
                </button>
              ) : null}
            </div>

            {data.byCategory && data.byCategory.length > 0 ? (
              <div className="chart-section category-report-grid">
                <div>
                  <h2 style={{ fontSize: "1.05rem", marginBottom: "0.35rem" }}>Outflows by category</h2>
                  <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                    Debit totals in this period (pie excludes categories with $0 outflows). Click a slice to open the
                    ledger for that category.
                  </p>
                  <div className="chart-wrap chart-wrap--pie">
                    {outflowPieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie
                            data={outflowPieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={56}
                            outerRadius={88}
                            paddingAngle={1}
                            cursor="pointer"
                            onClick={(_, index) => {
                              const slice = outflowPieData[index];
                              if (!slice || !data) {
                                return;
                              }
                              navigate(
                                ledgerDrillHref(data.range, {
                                  accountId: drillOpts.accountId,
                                  ...(slice.categoryId === null
                                    ? { uncategorizedOnly: true }
                                    : { categoryId: slice.categoryId })
                                })
                              );
                            }}
                          >
                            {outflowPieData.map((_, i) => (
                              <Cell key={String(i)} fill={PIE_COLORS[i % PIE_COLORS.length]!} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="muted">No outflows in this period.</p>
                    )}
                  </div>
                </div>
                <div>
                  <h2 style={{ fontSize: "1.05rem", marginBottom: "0.35rem" }}>Inflows by category</h2>
                  <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                    Credit totals in this period. Click a slice to open the ledger for that category.
                  </p>
                  <div className="chart-wrap chart-wrap--pie">
                    {inflowPieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie
                            data={inflowPieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={56}
                            outerRadius={88}
                            paddingAngle={1}
                            cursor="pointer"
                            onClick={(_, index) => {
                              const slice = inflowPieData[index];
                              if (!slice || !data) {
                                return;
                              }
                              navigate(
                                ledgerDrillHref(data.range, {
                                  accountId: drillOpts.accountId,
                                  ...(slice.categoryId === null
                                    ? { uncategorizedOnly: true }
                                    : { categoryId: slice.categoryId })
                                })
                              );
                            }}
                          >
                            {inflowPieData.map((_, i) => (
                              <Cell key={String(i)} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]!} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="muted">No inflows in this period.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {data.byCategory && data.byCategory.length > 0 ? (
              <div style={{ marginTop: "1.25rem" }}>
                <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>By category (period)</h2>
                <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                  Amounts roll up to <strong>parent</strong> groups (e.g. Shopping combines Groceries and Clothing).
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Inflows</th>
                        <th>Outflows</th>
                        <th>Net</th>
                        <th>Txns</th>
                        <th>Ledger</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byCategory.map((c) => (
                        <tr key={c.categoryId ?? "uncat"}>
                          <td>{c.categoryName}</td>
                          <td>{formatMoneySigned(c.inflows)}</td>
                          <td>${c.outflows.toFixed(2)}</td>
                          <td>{formatMoneySigned(c.net)}</td>
                          <td>{c.transactionCount}</td>
                          <td>
                            <Link
                              to={ledgerDrillHref(data.range, {
                                accountId: drillOpts.accountId,
                                ...(c.categoryId === null
                                  ? { uncategorizedOnly: true }
                                  : { categoryId: c.categoryId })
                              })}
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {stackBarModel.rows.length > 0 && stackBarModel.keys.length > 0 ? (
              <div className="chart-section">
                <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Monthly outflows by category (6 months)</h2>
                <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                  Stacked debit amounts; top five categories over the window plus &quot;Other&quot; per month.
                </p>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={stackBarModel.rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v: number) =>
                          v >= 1000 || v <= -1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
                        }
                      />
                      <Tooltip formatter={(v: number) => `$${Number(v).toFixed(2)}`} />
                      <Legend />
                      {stackBarModel.keys.map((k, i) => (
                        <Bar
                          key={k}
                          dataKey={k}
                          stackId="out"
                          fill={PIE_COLORS[i % PIE_COLORS.length]!}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}

            {data.byAccount && data.byAccount.length > 0 ? (
              <div style={{ marginTop: "1.25rem" }}>
                <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>By account</h2>
                <div style={{ overflowX: "auto" }}>
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Inflows</th>
                        <th>Outflows</th>
                        <th>Net</th>
                        <th>Txns</th>
                        <th>Ledger</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byAccount.map((a) => (
                        <tr key={a.accountId}>
                          <td>
                            {a.institution}
                            {a.accountMask ? ` · ${a.accountMask}` : ""}
                            <span className="muted"> ({a.accountType})</span>
                          </td>
                          <td>{formatMoneySigned(a.inflows)}</td>
                          <td>${a.outflows.toFixed(2)}</td>
                          <td>{formatMoneySigned(a.net)}</td>
                          <td>{a.transactionCount}</td>
                          <td>
                            <Link to={ledgerDrillHref(data.range, { accountId: a.accountId })}>View</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="chart-section">
              <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Monthly net (last 6 months)</h2>
              <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                Each bar is net cashflow for that calendar month (through the &quot;as of&quot; date in the current
                month).
              </p>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v: number) =>
                        v >= 1000 || v <= -1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
                      }
                    />
                    <Tooltip formatter={(value: number) => [formatMoneySigned(value), "Net"]} />
                    <Bar dataKey="net" fill="#0b5fff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
