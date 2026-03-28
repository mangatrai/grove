import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  reviewReasons?: string[];
};

type ListResponse = {
  total: number;
  limit: number;
  offset: number;
  sessionId?: string;
  transactions: TxRow[];
};

type AccountRow = {
  id: string;
  institution: string;
  type: string;
  account_mask: string | null;
};

function localDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMoney(amount: number, direction: string): string {
  const abs = Math.abs(amount);
  const sign = direction === "credit" ? "+" : "−";
  return `${sign}$${abs.toFixed(2)}`;
}

export function TransactionsPage() {
  const token = useAuthToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionFilter = searchParams.get("sessionId")?.trim() || null;
  const categoryFilter = searchParams.get("categoryId")?.trim() || null;
  const uncategorizedOnly = searchParams.get("uncategorizedOnly") === "true";
  const needsReviewTab = searchParams.get("needsReview") === "true";
  const searchFromUrl = searchParams.get("search")?.trim() ?? "";
  const amountMinUrl = searchParams.get("amountMin")?.trim() ?? "";
  const amountMaxUrl = searchParams.get("amountMax")?.trim() ?? "";
  const dateFrom = searchParams.get("dateFrom")?.trim() || null;
  const dateTo = searchParams.get("dateTo")?.trim() || null;
  const accountFilter = searchParams.get("accountId")?.trim() || null;
  const returnTo = searchParams.get("returnTo")?.trim() || null;
  const fromDashboard = searchParams.get("fromDashboard") === "true";
  const pageLimit = Math.min(Math.max(Number(searchParams.get("limit") || 100), 1), 200);
  const pageOffset = Math.max(Number(searchParams.get("offset") || 0), 0);

  const [data, setData] = useState<ListResponse | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(searchFromUrl);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [amountMinDraft, setAmountMinDraft] = useState(amountMinUrl);
  const [amountMaxDraft, setAmountMaxDraft] = useState(amountMaxUrl);
  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addAccountId, setAddAccountId] = useState("");
  const [addTxnDate, setAddTxnDate] = useState(localDateStr);
  const [addAmount, setAddAmount] = useState("");
  const [addMerchant, setAddMerchant] = useState("Manual entry");
  const [addMemo, setAddMemo] = useState("");
  const [addCategoryId, setAddCategoryId] = useState<string | null>(null);
  const addFirstFieldRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    setSearchDraft(searchFromUrl);
  }, [searchFromUrl]);

  useEffect(() => {
    setAmountMinDraft(amountMinUrl);
    setAmountMaxDraft(amountMaxUrl);
  }, [amountMinUrl, amountMaxUrl]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchParams((prev) => {
        const cur = prev.get("search")?.trim() ?? "";
        const nextVal = searchDraft.trim();
        if (nextVal === cur) {
          return prev;
        }
        const next = new URLSearchParams(prev);
        if (nextVal) {
          next.set("search", nextVal);
        } else {
          next.delete("search");
        }
        next.set("offset", "0");
        return next;
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchDraft, setSearchParams]);

  const load = useCallback(async () => {
    setError(null);
    const qs = new URLSearchParams({ limit: String(pageLimit), offset: String(pageOffset) });
    if (sessionFilter) {
      qs.set("sessionId", sessionFilter);
    }
    if (categoryFilter) {
      qs.set("categoryId", categoryFilter);
    }
    if (uncategorizedOnly) {
      qs.set("uncategorizedOnly", "true");
    }
    if (needsReviewTab) {
      qs.set("needsReview", "true");
    }
    if (searchFromUrl) {
      qs.set("search", searchFromUrl);
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
    if (amountMinUrl !== "") {
      const n = Number(amountMinUrl);
      if (Number.isFinite(n)) {
        qs.set("amountMin", String(n));
      }
    }
    if (amountMaxUrl !== "") {
      const n = Number(amountMaxUrl);
      if (Number.isFinite(n)) {
        qs.set("amountMax", String(n));
      }
    }
    const [txRes, catRes, acctRes] = await Promise.all([
      apiJson<ListResponse>(`/transactions?${qs.toString()}`),
      apiJson<{ categories: CategoryOption[] }>("/categories"),
      apiJson<{ accounts: AccountRow[] }>("/imports/accounts")
    ]);
    setData(txRes);
    setCategories(catRes.categories);
    setAccounts(acctRes.accounts);
  }, [
    sessionFilter,
    categoryFilter,
    uncategorizedOnly,
    needsReviewTab,
    searchFromUrl,
    dateFrom,
    dateTo,
    accountFilter,
    amountMinUrl,
    amountMaxUrl,
    pageLimit,
    pageOffset
  ]);

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
    if (!addOpen) {
      return;
    }
    setAddError(null);
    const id = window.requestAnimationFrame(() => addFirstFieldRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [addOpen]);

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

  const categoryName = useMemo(
    () => (categoryFilter ? categories.find((c) => c.id === categoryFilter)?.name ?? categoryFilter : null),
    [categories, categoryFilter]
  );
  const accountName = useMemo(() => {
    if (!accountFilter) {
      return null;
    }
    const account = accounts.find((a) => a.id === accountFilter);
    return account ? formatAccountForSelect(account) : accountFilter;
  }, [accounts, accountFilter]);

  const categorySelectOptions = useMemo(() => {
    return [...categories].sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  const hasLedgerFilters = Boolean(
    categoryFilter ||
      uncategorizedOnly ||
      dateFrom ||
      dateTo ||
      accountFilter ||
      needsReviewTab ||
      searchFromUrl ||
      amountMinUrl !== "" ||
      amountMaxUrl !== ""
  );

  const canPageBack = pageOffset > 0;
  const canPageForward = data ? pageOffset + data.transactions.length < data.total : false;

  function mergeParams(mutate: (n: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next);
  }

  function updatePaging(nextOffset: number) {
    mergeParams((n) => {
      n.set("limit", String(pageLimit));
      n.set("offset", String(Math.max(nextOffset, 0)));
    });
  }

  function setTab(review: boolean) {
    mergeParams((n) => {
      n.set("offset", "0");
      if (review) {
        n.set("needsReview", "true");
      } else {
        n.delete("needsReview");
      }
    });
  }

  function clearFilters() {
    const next = new URLSearchParams();
    if (sessionFilter) {
      next.set("sessionId", sessionFilter);
    }
    if (returnTo) {
      next.set("returnTo", returnTo);
    }
    if (fromDashboard) {
      next.set("fromDashboard", "true");
    }
    next.set("limit", String(pageLimit));
    next.set("offset", "0");
    setSearchParams(next);
  }

  function commitAmountFilters() {
    mergeParams((n) => {
      n.set("offset", "0");
      const amin = amountMinDraft.trim();
      const amax = amountMaxDraft.trim();
      if (amin === "") {
        n.delete("amountMin");
      } else {
        const v = Number(amin);
        if (Number.isFinite(v)) {
          n.set("amountMin", String(v));
        }
      }
      if (amax === "") {
        n.delete("amountMax");
      } else {
        const v = Number(amax);
        if (Number.isFinite(v)) {
          n.set("amountMax", String(v));
        }
      }
    });
  }

  function openAddModal() {
    setAddAccountId(accountFilter ?? accounts[0]?.id ?? "");
    setAddTxnDate(localDateStr());
    setAddAmount("");
    setAddMerchant("Manual entry");
    setAddMemo("");
    setAddCategoryId(null);
    setAddError(null);
    setAddOpen(true);
  }

  async function submitManual() {
    setAddSaving(true);
    setAddError(null);
    const amt = Number(addAmount);
    if (!addAccountId || !Number.isFinite(amt) || amt === 0) {
      setAddError("Choose an account and enter a non-zero amount.");
      setAddSaving(false);
      return;
    }
    try {
      await apiJson<{ id: string }>("/transactions", {
        method: "POST",
        body: JSON.stringify({
          accountId: addAccountId,
          txnDate: addTxnDate,
          amount: amt,
          merchant: addMerchant.trim() || "Manual entry",
          memo: addMemo.trim() ? addMemo.trim() : null,
          categoryId: addCategoryId
        })
      });
      setAddOpen(false);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to add";
      setAddError(msg);
    } finally {
      setAddSaving(false);
    }
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const categorySelectValue = uncategorizedOnly ? "__uncat__" : categoryFilter ?? "";

  return (
    <div className="transactions-page">
      <div className="card transactions-page__intro">
        <h1>Transactions</h1>
        {sessionFilter ? (
          <p className="muted">
            Showing only transactions from import session <code>{sessionFilter}</code>.{" "}
            <Link to={`/imports/${sessionFilter}`}>Import workspace</Link>
            {" · "}
            <Link to="/transactions">All household transactions</Link>.
          </p>
        ) : (
          <p className="muted">
            Posted rows from your household after import → parse → canonicalize. Categories can be set automatically
            (rules) or here. Use <strong>Needs review</strong> for uncategorized rows, open resolution items, or
            non-posted ledger status.
          </p>
        )}
        {fromDashboard && returnTo ? (
          <p className="muted">
            <Link to={returnTo}>Back to dashboard context</Link>
          </p>
        ) : null}
      </div>

      <div className="transactions-toolbar card">
        <div className="transactions-toolbar__tabs" role="tablist" aria-label="Transaction scope">
          <button
            type="button"
            role="tab"
            aria-selected={!needsReviewTab}
            className={`transactions-toolbar__tab${!needsReviewTab ? " transactions-toolbar__tab--active" : ""}`}
            onClick={() => setTab(false)}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={needsReviewTab}
            className={`transactions-toolbar__tab${needsReviewTab ? " transactions-toolbar__tab--active" : ""}`}
            onClick={() => setTab(true)}
          >
            Needs review
          </button>
        </div>
        <div className="transactions-toolbar__row">
          <label className="transactions-toolbar__field">
            <span className="transactions-toolbar__label">Search</span>
            <input
              type="search"
              placeholder="Merchant or memo"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="transactions-toolbar__field">
            <span className="transactions-toolbar__label">Account</span>
            <select
              value={accountFilter ?? ""}
              onChange={(e) => {
                mergeParams((n) => {
                  n.set("offset", "0");
                  const v = e.target.value;
                  if (!v) {
                    n.delete("accountId");
                  } else {
                    n.set("accountId", v);
                  }
                });
              }}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAccountForSelect(a)}
                </option>
              ))}
            </select>
          </label>
          <label className="transactions-toolbar__field">
            <span className="transactions-toolbar__label">From</span>
            <input
              type="date"
              value={dateFrom ?? ""}
              onChange={(e) => {
                mergeParams((n) => {
                  n.set("offset", "0");
                  const v = e.target.value;
                  if (!v) {
                    n.delete("dateFrom");
                  } else {
                    n.set("dateFrom", v);
                  }
                });
              }}
            />
          </label>
          <label className="transactions-toolbar__field">
            <span className="transactions-toolbar__label">To</span>
            <input
              type="date"
              value={dateTo ?? ""}
              onChange={(e) => {
                mergeParams((n) => {
                  n.set("offset", "0");
                  const v = e.target.value;
                  if (!v) {
                    n.delete("dateTo");
                  } else {
                    n.set("dateTo", v);
                  }
                });
              }}
            />
          </label>
          <label className="transactions-toolbar__field">
            <span className="transactions-toolbar__label">Category</span>
            <select
              value={categorySelectValue}
              onChange={(e) => {
                const v = e.target.value;
                mergeParams((n) => {
                  n.set("offset", "0");
                  n.delete("categoryId");
                  n.delete("uncategorizedOnly");
                  if (v === "__uncat__") {
                    n.set("uncategorizedOnly", "true");
                  } else if (v) {
                    n.set("categoryId", v);
                  }
                });
              }}
            >
              <option value="">Any</option>
              <option value="__uncat__">Uncategorized only</option>
              {categorySelectOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="transactions-toolbar__actions">
            <button type="button" className="button-primary" onClick={openAddModal}>
              + Add transaction
            </button>
          </div>
        </div>
        <div className="transactions-toolbar__more">
          <button
            type="button"
            className="transactions-toolbar__more-toggle"
            aria-expanded={moreFiltersOpen}
            onClick={() => setMoreFiltersOpen((o) => !o)}
          >
            More filters {moreFiltersOpen ? "▴" : "▾"}
          </button>
          <p className="muted transactions-toolbar__fts-note">
            Full-text ranked search is not enabled yet; this search matches substrings in merchant and memo.
          </p>
        </div>
        {moreFiltersOpen ? (
          <div className="transactions-toolbar__more-panel row">
            <label className="transactions-toolbar__field">
              <span className="transactions-toolbar__label">Amount min (signed)</span>
              <input
                type="number"
                step="any"
                placeholder="e.g. -500"
                value={amountMinDraft}
                onChange={(e) => setAmountMinDraft(e.target.value)}
              />
            </label>
            <label className="transactions-toolbar__field">
              <span className="transactions-toolbar__label">Amount max (signed)</span>
              <input
                type="number"
                step="any"
                placeholder="e.g. 100"
                value={amountMaxDraft}
                onChange={(e) => setAmountMaxDraft(e.target.value)}
              />
            </label>
            <button type="button" onClick={() => commitAmountFilters()}>
              Apply amounts
            </button>
          </div>
        ) : null}
      </div>

      <div className="card">
        {hasLedgerFilters ? (
          <p className="muted">
            Active filters:
            {needsReviewTab ? <> [needs review]</> : null}
            {categoryName ? (
              <>
                {" "}
                [category: <code>{categoryName}</code>]
              </>
            ) : null}
            {uncategorizedOnly ? <> [uncategorized only]</> : null}
            {searchFromUrl ? (
              <>
                {" "}
                [search: <code>{searchFromUrl}</code>]
              </>
            ) : null}
            {dateFrom ? (
              <>
                {" "}
                [from <code>{dateFrom}</code>]
              </>
            ) : null}
            {dateTo ? (
              <>
                {" "}
                [to <code>{dateTo}</code>]
              </>
            ) : null}
            {accountName ? (
              <>
                {" "}
                [account: <code>{accountName}</code>]
              </>
            ) : null}
            {amountMinUrl !== "" ? (
              <>
                {" "}
                [min <code>{amountMinUrl}</code>]
              </>
            ) : null}
            {amountMaxUrl !== "" ? (
              <>
                {" "}
                [max <code>{amountMaxUrl}</code>]
              </>
            ) : null}
            . <button type="button" className="link-button" onClick={() => clearFilters()}>Clear filters</button>
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
            <p className="muted">
              Page offset <code>{pageOffset}</code>, limit <code>{pageLimit}</code>.{" "}
              <button type="button" disabled={!canPageBack} onClick={() => updatePaging(pageOffset - pageLimit)}>
                Previous
              </button>{" "}
              <button type="button" disabled={!canPageForward} onClick={() => updatePaging(pageOffset + pageLimit)}>
                Next
              </button>
            </p>
            {data.transactions.length === 0 ? (
              <p className="muted">
                {sessionFilter
                  ? "No posted rows for this session yet. Either parse/canonicalize has not finished, or all lines were flagged (duplicates / review queue)."
                  : hasLedgerFilters
                    ? "No rows match these filters."
                    : needsReviewTab
                      ? "Nothing needs review right now."
                      : "No transactions yet. Use New import in the header, then run import from the workspace, or add a row with + Add transaction."}
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
                      {needsReviewTab ? <th>Why</th> : null}
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
                      const reasons = t.reviewReasons?.length ? t.reviewReasons.join(" · ") : "—";
                      return (
                        <tr key={t.id}>
                          <td>{t.txnDate}</td>
                          <td>{accountLabel}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatMoney(t.amount, t.direction)}</td>
                          <td>{desc}</td>
                          {needsReviewTab ? (
                            <td className="transactions-page__why-cell">
                              <span className="transactions-page__why" title={reasons}>
                                {reasons}
                              </span>
                            </td>
                          ) : null}
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

      {addOpen ? (
        <div
          className="transactions-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setAddOpen(false);
            }
          }}
        >
          <div className="transactions-modal card" role="dialog" aria-modal="true" aria-labelledby="add-txn-title">
            <h2 id="add-txn-title">Add transaction</h2>
            <p className="muted">
              Amount uses the same sign as imports: negative for outflows (debit), positive for inflows (credit).
            </p>
            {addError ? <p className="error">{addError}</p> : null}
            <div className="transactions-modal__grid">
              <label>
                Account
                <select
                  ref={addFirstFieldRef}
                  value={addAccountId}
                  onChange={(e) => setAddAccountId(e.target.value)}
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountForSelect(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date
                <input type="date" value={addTxnDate} onChange={(e) => setAddTxnDate(e.target.value)} />
              </label>
              <label>
                Amount
                <input
                  type="number"
                  step="any"
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  placeholder="-42.50"
                />
              </label>
              <label>
                Payee / description
                <input value={addMerchant} onChange={(e) => setAddMerchant(e.target.value)} />
              </label>
              <label className="transactions-modal__full">
                Memo (optional)
                <input value={addMemo} onChange={(e) => setAddMemo(e.target.value)} />
              </label>
              <div className="transactions-modal__full">
                <span className="transactions-modal__picker-label">Category</span>
                <LedgerCategoryPicker
                  categories={categories}
                  value={addCategoryId}
                  disabled={addSaving}
                  onChange={(v) => setAddCategoryId(v)}
                  ariaLabel="Category for new transaction"
                />
              </div>
            </div>
            <div className="transactions-modal__footer">
              <button type="button" disabled={addSaving} onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="button" className="button-primary" disabled={addSaving} onClick={() => void submitManual()}>
                {addSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
