import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { apiJson, getToken } from "../api";
import { formatAccountForSelect } from "../import/accountDisplay";

type TxRow = {
  id: string;
  txnDate: string;
  amount: number;
  direction: string;
  merchant: string | null;
  memo: string | null;
  status: string;
  accountId: string;
  institution: string;
  accountType: string;
  accountMask: string | null;
  sourceRef: string | null;
  createdAt: string;
};

type ListResponse = {
  total: number;
  limit: number;
  offset: number;
  sessionId?: string;
  transactions: TxRow[];
};

function formatMoney(amount: number, direction: string): string {
  const abs = Math.abs(amount);
  const sign = direction === "credit" ? "+" : "−";
  return `${sign}$${abs.toFixed(2)}`;
}

export function TransactionsPage() {
  const token = getToken();
  const [searchParams] = useSearchParams();
  const sessionFilter = searchParams.get("sessionId")?.trim() || null;

  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    const qs = new URLSearchParams({ limit: "100", offset: "0" });
    if (sessionFilter) {
      qs.set("sessionId", sessionFilter);
    }
    const res = await apiJson<ListResponse>(`/transactions?${qs.toString()}`);
    setData(res);
  }, [sessionFilter]);

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

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div>
      <p>
        <Link to="/">← Home</Link>
        {" · "}
        <Link to="/resolution">Review queue</Link>
        {sessionFilter ? (
          <>
            {" "}
            ·{" "}
            <Link to={`/imports/${sessionFilter}`}>This import session</Link>
          </>
        ) : null}
      </p>
      <div className="card">
        <h1>Ledger</h1>
        {sessionFilter ? (
          <p className="muted">
            Showing only transactions loaded from import session <code>{sessionFilter}</code>.{" "}
            <Link to="/transactions">Show all household transactions</Link>.
          </p>
        ) : (
          <p className="muted">
            Recent transactions from your household (read-only). Rows appear here after import → parse → canonicalize.
          </p>
        )}
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && data ? (
          <>
            <p className="muted">
              Showing <strong>{data.transactions.length}</strong> of <strong>{data.total}</strong> transaction(s)
              {data.sessionId ? " for this import" : ""}.
            </p>
            {data.transactions.length === 0 ? (
              <p className="muted">
                {sessionFilter
                  ? "No ledger rows linked to this session yet (parse and canonicalize first), or they were deduped against earlier imports."
                  : "No ledger rows yet. Complete an import session and run import from the home page."}
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Account</th>
                      <th>Amount</th>
                      <th>Description</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((t) => {
                      const accountLabel = formatAccountForSelect({
                        institution: t.institution,
                        type: t.accountType,
                        account_mask: t.accountMask
                      });
                      const desc = t.merchant || t.memo || "—";
                      return (
                        <tr key={t.id}>
                          <td>{t.txnDate}</td>
                          <td>{accountLabel}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatMoney(t.amount, t.direction)}</td>
                          <td>{desc}</td>
                          <td>
                            <span className="muted">{t.status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
