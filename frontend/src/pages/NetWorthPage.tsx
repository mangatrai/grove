import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";

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

  const load = useCallback(async () => {
    const res = await apiJson<BalanceSheetResponse>(
      `/reports/balance-sheet?asOf=${encodeURIComponent(asOf)}`
    );
    setData(res);
  }, [asOf]);

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
      } catch (err: unknown) {
        setManualError(err instanceof Error ? err.message : "Could not save balance");
      } finally {
        setManualSubmitting(false);
      }
    },
    [accounts, load, manualAccountId, manualAmount, manualAsOf]
  );

  const assetRows = useMemo(() => data?.assets ?? [], [data?.assets]);
  const liabilityRows = useMemo(() => data?.liabilities ?? [], [data?.liabilities]);

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
