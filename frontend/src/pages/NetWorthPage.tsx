import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { apiJson, useAuthToken } from "../api";

type BalanceSheetAccountRow = {
  financialAccountId: string;
  institution: string;
  accountMask: string | null;
  type: string;
  currency: string;
  side: "asset" | "liability";
  balance: number | null;
  balanceAsOf: string | null;
  balanceSource: "manual" | "import" | null;
  importFileId: string | null;
};

type BalanceSheetResponse = {
  asOf: string;
  assets: BalanceSheetAccountRow[];
  liabilities: BalanceSheetAccountRow[];
  totals: {
    assets: number | null;
    liabilities: number | null;
    netWorth: number | null;
  };
};

type AccountOption = {
  id: string;
  institution: string;
  type: string;
  currency: string;
  account_mask?: string | null;
};

type BalanceSheetHistoryResponse = {
  from: string;
  to: string;
  interval: "month" | "week" | "day";
  points: Array<{
    asOf: string;
    totals: {
      assets: number | null;
      liabilities: number | null;
      netWorth: number | null;
    };
  }>;
};

function defaultHistoryRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 12, to.getUTCDate()));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return "—";
  }
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function NetWorthPage() {
  const token = useAuthToken();
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<BalanceSheetResponse | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualAccountId, setManualAccountId] = useState("");
  const [manualAsOf, setManualAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualAmount, setManualAmount] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const [histRange, setHistRange] = useState(defaultHistoryRange);
  const [histInterval, setHistInterval] = useState<"month" | "week" | "day">("month");
  const [historyData, setHistoryData] = useState<BalanceSheetHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await apiJson<BalanceSheetResponse>(
      `/reports/balance-sheet?asOf=${encodeURIComponent(asOf)}`
    );
    setData(res);
  }, [asOf]);

  const loadHistory = useCallback(async () => {
    const qs = new URLSearchParams({
      from: histRange.from,
      to: histRange.to,
      interval: histInterval
    });
    const res = await apiJson<BalanceSheetHistoryResponse>(`/reports/balance-sheet/history?${qs.toString()}`);
    setHistoryData(res);
  }, [histRange.from, histRange.to, histInterval]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<{ accounts: AccountOption[] }>("/imports/accounts")
      .then((r) => {
        const list = (r.accounts ?? []).filter((a) => a.type !== "payslip");
        setAccounts(list);
      })
      .catch(() => setAccounts([]));
  }, [token]);

  useEffect(() => {
    if (manualAccountId || accounts.length === 0) {
      return;
    }
    setManualAccountId(accounts[0]!.id);
  }, [accounts, manualAccountId]);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    void load()
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : "Failed to load balance sheet");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, load]);

  useEffect(() => {
    if (!token) {
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    void loadHistory()
      .catch((e: unknown) => {
        setHistoryError(e instanceof Error ? e.message : "Failed to load history");
        setHistoryData(null);
      })
      .finally(() => setHistoryLoading(false));
  }, [token, loadHistory]);

  const onSubmitManual = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setManualError(null);
      const amount = Number(manualAmount.replace(/,/g, ""));
      if (!manualAccountId || !manualAsOf || !Number.isFinite(amount)) {
        setManualError("Choose an account, as-of date, and a numeric amount.");
        return;
      }
      setManualSubmitting(true);
      try {
        await apiJson<{ id: string }>("/reports/balance-sheet/manual", {
          method: "POST",
          body: JSON.stringify({
            financialAccountId: manualAccountId,
            asOfDate: manualAsOf,
            amount,
            currency: accounts.find((a) => a.id === manualAccountId)?.currency ?? "USD"
          })
        });
        setManualAmount("");
        await load();
        await loadHistory().catch(() => undefined);
      } catch (err: unknown) {
        setManualError(err instanceof Error ? err.message : "Could not save balance");
      } finally {
        setManualSubmitting(false);
      }
    },
    [accounts, load, loadHistory, manualAccountId, manualAmount, manualAsOf]
  );

  const assetRows = useMemo(() => data?.assets ?? [], [data?.assets]);
  const liabilityRows = useMemo(() => data?.liabilities ?? [], [data?.liabilities]);

  const chartRows = useMemo(
    () =>
      (historyData?.points ?? []).map((p) => ({
        asOf: p.asOf,
        assets: p.totals.assets ?? undefined,
        liabilities: p.totals.liabilities ?? undefined,
        netWorth: p.totals.netWorth ?? undefined
      })),
    [historyData?.points]
  );

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="payslips-page">
      <div className="card">
        <h1>Net worth</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          Assets vs liabilities from connected accounts. Manual balances override import hints for the same account.{" "}
          <Link to="/settings?tab=accounts">Manage accounts</Link>.
        </p>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Trend</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Sampled totals over time (same rules as the snapshot below: manual → import snapshot → statement hint).
        </p>
        <div className="row" style={{ alignItems: "flex-end", gap: "1rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>From</span>
            <input
              type="date"
              value={histRange.from}
              onChange={(ev) => setHistRange((r) => ({ ...r, from: ev.target.value }))}
            />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>To</span>
            <input
              type="date"
              value={histRange.to}
              onChange={(ev) => setHistRange((r) => ({ ...r, to: ev.target.value }))}
            />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Interval</span>
            <select value={histInterval} onChange={(ev) => setHistInterval(ev.target.value as "month" | "week" | "day")}>
              <option value="month">Month-end</option>
              <option value="week">Every 7 days</option>
              <option value="day">Daily (max 120 points)</option>
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => setHistRange(defaultHistoryRange())}
          >
            Last 12 months
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void loadHistory().catch(() => undefined)}
            disabled={historyLoading}
          >
            Refresh chart
          </button>
        </div>
        {historyError ? <p className="error">{historyError}</p> : null}
        {historyLoading ? <p className="muted">Loading chart…</p> : null}
        {!historyLoading && chartRows.length > 0 ? (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                <XAxis dataKey="asOf" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" height={52} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) =>
                    `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  }
                />
                <Tooltip
                  formatter={(value: number | undefined) =>
                    value == null || !Number.isFinite(value) ? "—" : formatMoney(value)
                  }
                />
                <Legend />
                <Line type="monotone" dataKey="assets" name="Assets" stroke="#2563eb" dot={false} strokeWidth={2} connectNulls />
                <Line
                  type="monotone"
                  dataKey="liabilities"
                  name="Liabilities"
                  stroke="#dc2626"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="netWorth"
                  name="Net worth"
                  stroke="#059669"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {!historyLoading && chartRows.length === 0 && !historyError ? (
          <p className="muted">No history points in this range (add manual or import balances to see a line).</p>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Snapshot (as of)</h2>
        <div className="row" style={{ alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>As of</span>
            <input type="date" value={asOf} onChange={(ev) => setAsOf(ev.target.value)} />
          </label>
          <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
        {loadError ? <p className="error">{loadError}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && data ? (
          <div style={{ marginTop: "1rem" }}>
            <div className="row" style={{ gap: "2rem", flexWrap: "wrap" }}>
              <div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>
                  Total assets
                </div>
                <div style={{ fontSize: "1.35rem", fontWeight: 600 }}>{formatMoney(data.totals.assets)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>
                  Total liabilities
                </div>
                <div style={{ fontSize: "1.35rem", fontWeight: 600 }}>{formatMoney(data.totals.liabilities)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>
                  Net worth
                </div>
                <div style={{ fontSize: "1.35rem", fontWeight: 600 }}>{formatMoney(data.totals.netWorth)}</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {!loading && data ? (
        <>
          <div className="card" style={{ marginTop: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Assets</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Balance</th>
                    <th>As of</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {assetRows.map((r) => (
                    <tr key={r.financialAccountId}>
                      <td>
                        {r.institution}
                        {r.accountMask ? ` · ${r.accountMask}` : ""}
                      </td>
                      <td>
                        <code style={{ fontSize: "0.8rem" }}>{r.type}</code>
                      </td>
                      <td>{formatMoney(r.balance)}</td>
                      <td>{r.balanceAsOf ?? "—"}</td>
                      <td>{r.balanceSource ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Liabilities</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Balance</th>
                    <th>As of</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {liabilityRows.map((r) => (
                    <tr key={r.financialAccountId}>
                      <td>
                        {r.institution}
                        {r.accountMask ? ` · ${r.accountMask}` : ""}
                      </td>
                      <td>
                        <code style={{ fontSize: "0.8rem" }}>{r.type}</code>
                      </td>
                      <td>{formatMoney(r.balance)}</td>
                      <td>{r.balanceAsOf ?? "—"}</td>
                      <td>{r.balanceSource ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Add or update manual balance</h2>
        <p className="muted">Sets the balance for an account on a given date (same date updates the row).</p>
        <form onSubmit={onSubmitManual}>
          <div className="row" style={{ gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="field">
              <span>Account</span>
              <select value={manualAccountId} onChange={(ev) => setManualAccountId(ev.target.value)}>
                <option value="">Select…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.institution}
                    {a.account_mask ? ` · ${a.account_mask}` : ""} ({a.type})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>As-of date</span>
              <input type="date" value={manualAsOf} onChange={(ev) => setManualAsOf(ev.target.value)} />
            </label>
            <label className="field">
              <span>Amount</span>
              <input
                inputMode="decimal"
                value={manualAmount}
                onChange={(ev) => setManualAmount(ev.target.value)}
                placeholder="0.00"
              />
            </label>
            <button type="submit" className="primary" disabled={manualSubmitting}>
              {manualSubmitting ? "Saving…" : "Save"}
            </button>
          </div>
          {manualError ? <p className="error">{manualError}</p> : null}
        </form>
      </div>
    </div>
  );
}
