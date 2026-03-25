import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { LedgerCategoryPicker } from "../components/LedgerCategoryPicker";
import { formatAccountForSelect } from "../import/accountDisplay";

type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
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
  const token = useAuthToken();
  const [searchParams] = useSearchParams();
  const sessionFilter = searchParams.get("sessionId")?.trim() || null;
  const categoryFilter = searchParams.get("categoryId")?.trim() || null;
  const uncategorizedOnly = searchParams.get("uncategorizedOnly") === "true";
  const dateFrom = searchParams.get("dateFrom")?.trim() || null;
  const dateTo = searchParams.get("dateTo")?.trim() || null;
  const accountFilter = searchParams.get("accountId")?.trim() || null;

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
    if (categoryFilter) {
      qs.set("categoryId", categoryFilter);
    }
    if (uncategorizedOnly) {
      qs.set("uncategorizedOnly", "true");
    }
    if (dateFrom) {
      qs.set("dateFrom", dateFrom);
    }
    if (dateTo) {
      qs.set("dateTo", dateTo);
    }
    if (accountFilter) {
      qs.set("accountId", accountFilter);
    }
    const [txRes, catRes] = await Promise.all([
      apiJson<ListResponse>(`/transactions?${qs.toString()}`),
      apiJson<{ categories: CategoryOption[] }>("/categories")
    ]);
    setData(txRes);
    setCategories(catRes.categories);
  }, [sessionFilter, categoryFilter, uncategorizedOnly, dateFrom, dateTo, accountFilter]);

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

  async function updateCategory(txnId: string, categoryId: string | null) {
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

  const hasLedgerFilters = Boolean(
    categoryFilter || uncategorizedOnly || dateFrom || dateTo || accountFilter
  );

  return (
    <div>
      <div className="card">
        <h1>Ledger</h1>
        <p className="muted">
          <Link to="/categories">Manage categories</Link>
        </p>
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
        {hasLedgerFilters ? (
          <p className="muted">
            Filtered
            {categoryFilter ? (
              <>
                {" "}
                · category <code>{categoryFilter}</code>
              </>
            ) : null}
            {uncategorizedOnly ? <> · uncategorized only</> : null}
            {dateFrom ? (
              <>
                {" "}
                · from <code>{dateFrom}</code>
              </>
            ) : null}
            {dateTo ? (
              <>
                {" "}
                · to <code>{dateTo}</code>
              </>
            ) : null}
            {accountFilter ? (
              <>
                {" "}
                · account <code>{accountFilter}</code>
              </>
            ) : null}
            . <Link to="/transactions">Clear filters</Link>
          </p>
        ) : null}
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
                  : hasLedgerFilters
                    ? "No rows match these filters."
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
                            <LedgerCategoryPicker
                              categories={categories}
                              value={t.categoryId}
                              disabled={savingId === t.id}
                              onChange={(v) => void updateCategory(t.id, v)}
                              ariaLabel={`Category for ${desc}`}
                            />
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
