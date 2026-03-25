import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

function ledgerDrillHref(range: { start: string; end: string }, categoryId: string | null): string {
  const qs = new URLSearchParams();
  qs.set("dateFrom", range.start);
  qs.set("dateTo", range.end);
  if (categoryId === null) {
    qs.set("uncategorizedOnly", "true");
  } else {
    qs.set("categoryId", categoryId);
  }
  return `/transactions?${qs.toString()}`;
}

export function DashboardPage() {
  const token = useAuthToken();
  const [preset, setPreset] = useState<CashPreset>("rolling_30");
  const [monthStr, setMonthStr] = useState(currentMonthStr);
  const [asOf, setAsOf] = useState(todayISODate);
  const [accountId, setAccountId] = useState<string>("");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [data, setData] = useState<CashSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      .map((c) => ({ name: c.categoryName, value: c.outflows }));
  }, [data?.byCategory]);

  const inflowPieData = useMemo(() => {
    if (!data?.byCategory) {
      return [];
    }
    return data.byCategory
      .filter((c) => c.inflows > 0)
      .map((c) => ({ name: c.categoryName, value: c.inflows }));
  }, [data?.byCategory]);

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
                <div className="kpi-label">Inflows</div>
                <div className="kpi-value kpi-in">{formatMoneySigned(data.household.inflows)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Outflows</div>
                <div className="kpi-value kpi-out">${data.household.outflows.toFixed(2)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Net</div>
                <div className="kpi-value">{formatMoneySigned(data.household.net)}</div>
              </div>
            </div>

            {data.byCategory && data.byCategory.length > 0 ? (
              <div className="chart-section category-report-grid">
                <div>
                  <h2 style={{ fontSize: "1.05rem", marginBottom: "0.35rem" }}>Outflows by category</h2>
                  <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                    Debit totals in this period (pie excludes categories with $0 outflows).
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
                    Credit totals in this period.
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
                            <Link to={ledgerDrillHref(data.range, c.categoryId)}>View</Link>
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
