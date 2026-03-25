import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { apiJson, getToken } from "../api";
import { formatAccountForSelect } from "../import/accountDisplay";

type CategoryOption = {
  id: string;
  name: string;
};

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
  categoryId: string | null;
  categoryName: string | null;
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
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const qs = new URLSearchParams({ limit: "100", offset: "0" });
    if (sessionFilter) {
      qs.set("sessionId", sessionFilter);
    }
    const [txRes, catRes] = await Promise.all([
      apiJson<ListResponse>(`/transactions?${qs.toString()}`),
      apiJson<{ categories: CategoryOption[] }>("/categories")
    ]);
    setData(txRes);
    setCategories(catRes.categories);
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

  async function updateCategory(txnId: string, raw: string) {
    const categoryId = raw === "" ? null : raw;
    setSavingId(txnId);
    setError(null);
    try {
      await apiJson(`/transactions/${txnId}`, {
        method: "PATCH",
        body: JSON.stringify({ categoryId })
      });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update category");
    } finally {
      setSavingId(null);
    }
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div>
      <div className="card">
        <h1>Ledger</h1>
        {sessionFilter ? (
          <p className="muted">
            Showing only transactions from import session <code>{sessionFilter}</code>.{" "}
            <Link to={`/imports/${sessionFilter}`}>Import workspace</Link>
            {" · "}
            <Link to="/transactions">All household transactions</Link>.
          </p>
        ) : (
          <p className="muted">
            Recent transactions from your household. Rows appear after import → parse → canonicalize. Categories can be
            set automatically (rules) or here.
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
                  ? "No posted ledger rows for this session yet. Either parse/canonicalize has not finished, or all lines were flagged (duplicates / review queue)."
                  : "No ledger rows yet. Complete an import session (New import in the header), then run import from the workspace."}
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
                      <th>Category</th>
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
                            <select
                              className="ledger-category-select"
                              value={t.categoryId ?? ""}
                              disabled={savingId === t.id}
                              onChange={(e) => void updateCategory(t.id, e.target.value)}
                              aria-label={`Category for ${desc}`}
                            >
                              <option value="">Uncategorized</option>
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>
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
