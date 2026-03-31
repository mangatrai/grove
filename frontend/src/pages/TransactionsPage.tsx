import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { LedgerCategoryPicker } from "../components/LedgerCategoryPicker";
import { formatAccountForSelect } from "../import/accountDisplay";

type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
};

type OpenReviewItem = { id: string; type: string; status: "open" | "in_review" };

type ResolutionDetailItem = {
  id: string;
  type: string;
  targetId: string;
  reason: string;
  reasonDetail: { kind?: string; message?: string; existingCanonicalId?: string; rawId?: string } | null;
  status: "open" | "in_review" | "resolved";
  createdAt: string;
  context: {
    sessionId: string | null;
    fileId: string | null;
    fileName: string | null;
    raw: {
      txnDate: string | null;
      amount: number | null;
      description: string | null;
      referenceId: string | null;
    } | null;
    classification: {
      source?: "db" | "default" | "none";
      ruleId?: string | null;
      confidence?: number;
      reason?: string;
    } | null;
  };
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
  openReviewItems?: OpenReviewItem[];
  importSessionId?: string | null;
};

const LEDGER_RESOLUTION_TYPES = [
  "unknown_category",
  "duplicate_ambiguity",
  "transfer_ambiguity",
  "reconciliation_mismatch"
] as const;

type LedgerResolutionType = (typeof LEDGER_RESOLUTION_TYPES)[number];

const RESOLUTION_TYPE_LABELS: Record<LedgerResolutionType, string> = {
  unknown_category: "Unknown category",
  duplicate_ambiguity: "Near-duplicate",
  transfer_ambiguity: "Transfer ambiguity",
  reconciliation_mismatch: "Reconciliation"
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

function formatResolutionTypeLabel(t: string): string {
  switch (t) {
    case "duplicate_ambiguity":
      return "Near-duplicate / ambiguous match";
    case "unknown_category":
      return "Unknown category";
    case "transfer_ambiguity":
      return "Transfer ambiguity";
    case "reconciliation_mismatch":
      return "Reconciliation mismatch";
    default:
      return t;
  }
}

function prettyClassificationSource(source?: "db" | "default" | "none"): string | null {
  if (!source) return null;
  if (source === "db") return "Rule";
  if (source === "default") return "Default rule";
  return "Uncategorized";
}

function formatConfidencePct(confidence?: number): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return null;
  }
  return `${Math.round(confidence * 100)}%`;
}

function formatSignedMoneyRaw(amount: number | null): string {
  if (amount == null) {
    return "—";
  }
  const abs = Math.abs(amount);
  const sign = amount >= 0 ? "+" : "−";
  return `${sign}$${abs.toFixed(2)}`;
}

export function TransactionsPage() {
  const token = useAuthToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionFilter = searchParams.get("sessionId")?.trim() || null;
  const categoryFilter = searchParams.get("categoryId")?.trim() || null;
  const uncategorizedOnly = searchParams.get("uncategorizedOnly") === "true";
  const needsReviewTab = searchParams.get("needsReview") === "true";
  const resolutionTypes = useMemo((): LedgerResolutionType[] => {
    const seen = new Set<LedgerResolutionType>();
    for (const r of searchParams.getAll("resolutionType")) {
      if (LEDGER_RESOLUTION_TYPES.includes(r as LedgerResolutionType)) {
        seen.add(r as LedgerResolutionType);
      }
    }
    return [...seen];
  }, [searchParams]);
  const resolutionTypesKey = useMemo(() => [...resolutionTypes].sort().join("|"), [resolutionTypes]);
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
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(() => new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("");
  const [savingBulk, setSavingBulk] = useState(false);
  const [expandedTxnIds, setExpandedTxnIds] = useState<Set<string>>(() => new Set());
  const [reviewDetailByTxn, setReviewDetailByTxn] = useState<Record<string, ResolutionDetailItem[]>>({});
  const [reviewDetailErr, setReviewDetailErr] = useState<Record<string, string>>({});
  const [reviewDetailLoadingIds, setReviewDetailLoadingIds] = useState<Set<string>>(() => new Set());
  const [savingResolutionItemId, setSavingResolutionItemId] = useState<string | null>(null);
  const reviewDetailLoadedRef = useRef<Set<string>>(new Set());
  const [resolutionQueueSummary, setResolutionQueueSummary] = useState<{
    openDuplicateAmbiguityNotOnLedger?: number;
  } | null>(null);

  useEffect(() => {
    setSearchDraft(searchFromUrl);
  }, [searchFromUrl]);

  useEffect(() => {
    if (!token || !needsReviewTab) {
      setResolutionQueueSummary(null);
      return;
    }
    void apiJson<{ openDuplicateAmbiguityNotOnLedger?: number }>("/resolution/summary")
      .then((r) => setResolutionQueueSummary(r))
      .catch(() => setResolutionQueueSummary(null));
  }, [token, needsReviewTab]);

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
    for (const rt of resolutionTypes) {
      qs.append("resolutionType", rt);
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
    resolutionTypesKey,
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
    setSelectedTxnIds(new Set());
  }, [
    needsReviewTab,
    resolutionTypesKey,
    sessionFilter,
    categoryFilter,
    uncategorizedOnly,
    searchFromUrl,
    dateFrom,
    dateTo,
    accountFilter,
    amountMinUrl,
    amountMaxUrl,
    pageOffset,
    pageLimit
  ]);

  useEffect(() => {
    setExpandedTxnIds(new Set());
    reviewDetailLoadedRef.current.clear();
    setReviewDetailByTxn({});
    setReviewDetailErr({});
  }, [
    needsReviewTab,
    resolutionTypesKey,
    sessionFilter,
    categoryFilter,
    uncategorizedOnly,
    searchFromUrl,
    dateFrom,
    dateTo,
    accountFilter,
    amountMinUrl,
    amountMaxUrl,
    pageOffset,
    pageLimit
  ]);

  useEffect(() => {
    if (!addOpen) {
      return;
    }
    setAddError(null);
    const id = window.requestAnimationFrame(() => addFirstFieldRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [addOpen]);

  const selectedCount = selectedTxnIds.size;

  const unknownCategoryResolutionIdsInSelection = useMemo(() => {
    if (!data) {
      return [];
    }
    const out: string[] = [];
    for (const t of data.transactions) {
      if (!selectedTxnIds.has(t.id)) {
        continue;
      }
      for (const item of t.openReviewItems ?? []) {
        if (item.type === "unknown_category") {
          out.push(item.id);
        }
      }
    }
    return [...new Set(out)];
  }, [data, selectedTxnIds]);
  const nonUnknownOpenResolutionCountInSelection = useMemo(() => {
    if (!data) {
      return 0;
    }
    let count = 0;
    for (const t of data.transactions) {
      if (!selectedTxnIds.has(t.id)) {
        continue;
      }
      for (const item of t.openReviewItems ?? []) {
        if (item.type !== "unknown_category") {
          count += 1;
        }
      }
    }
    return count;
  }, [data, selectedTxnIds]);
  const allVisibleSelected = useMemo(
    () =>
      Boolean(data?.transactions.length) &&
      data!.transactions.every((t) => selectedTxnIds.has(t.id)),
    [data, selectedTxnIds]
  );

  function toggleTxnSelected(txnId: string) {
    setSelectedTxnIds((prev) => {
      const next = new Set(prev);
      if (next.has(txnId)) {
        next.delete(txnId);
      } else {
        next.add(txnId);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    if (!data?.transactions.length) {
      return;
    }
    if (allVisibleSelected) {
      setSelectedTxnIds(new Set());
    } else {
      setSelectedTxnIds(new Set(data.transactions.map((t) => t.id)));
    }
  }

  function collectOpenResolutionIdsFromSelection(): string[] {
    if (!data) {
      return [];
    }
    const out: string[] = [];
    for (const t of data.transactions) {
      if (!selectedTxnIds.has(t.id)) {
        continue;
      }
      for (const item of t.openReviewItems ?? []) {
        out.push(item.id);
      }
    }
    return [...new Set(out)];
  }

  function collectUnknownCategoryResolutionIds(): string[] {
    if (!data) {
      return [];
    }
    const out: string[] = [];
    for (const t of data.transactions) {
      if (!selectedTxnIds.has(t.id)) {
        continue;
      }
      for (const item of t.openReviewItems ?? []) {
        if (item.type === "unknown_category") {
          out.push(item.id);
        }
      }
    }
    return [...new Set(out)];
  }

  async function bulkApplyCategory() {
    const ids = collectUnknownCategoryResolutionIds();
    if (ids.length === 0) {
      setError(
        "No open “Unknown category” items in your selection. Rows can stay on Needs review for transfer, duplicate, or other flags even when a category is set — filter Review types to “Unknown category” or pick different rows."
      );
      return;
    }
    if (!bulkCategoryId) {
      setError("Choose a category.");
      return;
    }
    setError(null);
    setSavingBulk(true);
    try {
      const res = await apiJson<{ updated: { id: string }[]; errors: { id: string; code: string }[] }>(
        "/resolution/bulk-apply-category",
        {
          method: "POST",
          body: JSON.stringify({ ids, categoryId: bulkCategoryId })
        }
      );
      if (res.errors.length > 0) {
        setError(`Applied to ${res.updated.length}; ${res.errors.length} row(s) could not be updated.`);
      }
      setSelectedTxnIds(new Set());
      setBulkCategoryId("");
      reviewDetailLoadedRef.current.clear();
      setReviewDetailByTxn({});
      setReviewDetailErr({});
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk category apply failed");
    } finally {
      setSavingBulk(false);
    }
  }

  async function bulkApplyCategoryAndResolve() {
    const ids = collectUnknownCategoryResolutionIds();
    if (ids.length === 0) {
      setError(
        "No open “Unknown category” items in your selection. Filter Review types to “Unknown category” or pick different rows."
      );
      return;
    }
    if (!bulkCategoryId) {
      setError("Choose a category.");
      return;
    }
    setError(null);
    setSavingBulk(true);
    try {
      const applyRes = await apiJson<{ updated: { id: string }[]; errors: { id: string; code: string }[] }>(
        "/resolution/bulk-apply-category",
        {
          method: "POST",
          body: JSON.stringify({ ids, categoryId: bulkCategoryId })
        }
      );
      const resolveRes = await apiJson<{ updated: { id: string; status: string }[]; errors: { id: string; code: string }[] }>(
        "/resolution/bulk",
        {
          method: "POST",
          body: JSON.stringify({ ids, status: "resolved" })
        }
      );
      if (applyRes.errors.length > 0 || resolveRes.errors.length > 0) {
        setError(
          `Category+resolve completed with partial errors: apply ${applyRes.errors.length}, resolve ${resolveRes.errors.length}.`
        );
      }
      setSelectedTxnIds(new Set());
      setBulkCategoryId("");
      reviewDetailLoadedRef.current.clear();
      setReviewDetailByTxn({});
      setReviewDetailErr({});
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk category + resolve failed");
    } finally {
      setSavingBulk(false);
    }
  }

  async function bulkUpdateResolutionStatus(status: "open" | "in_review" | "resolved") {
    const ids = collectOpenResolutionIdsFromSelection();
    if (ids.length === 0) {
      setError("Selected rows have no open review items to update.");
      return;
    }
    setError(null);
    setSavingBulk(true);
    try {
      const res = await apiJson<{ updated: { id: string; status: string }[]; errors: { id: string; code: string }[] }>(
        "/resolution/bulk",
        {
          method: "POST",
          body: JSON.stringify({ ids, status })
        }
      );
      if (res.errors.length > 0) {
        setError(
          `Updated ${res.updated.length} item(s); ${res.errors.length} could not be changed (${res.errors.map((e) => e.code).join(", ")})`
        );
      }
      setSelectedTxnIds(new Set());
      reviewDetailLoadedRef.current.clear();
      setReviewDetailByTxn({});
      setReviewDetailErr({});
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk update failed");
    } finally {
      setSavingBulk(false);
    }
  }

  function forgetReviewDetail(txnId: string) {
    reviewDetailLoadedRef.current.delete(txnId);
    setReviewDetailByTxn((d) => {
      if (!(txnId in d)) {
        return d;
      }
      const next = { ...d };
      delete next[txnId];
      return next;
    });
    setReviewDetailErr((e) => {
      if (!(txnId in e)) {
        return e;
      }
      const next = { ...e };
      delete next[txnId];
      return next;
    });
  }

  async function ensureReviewDetailLoaded(txnId: string) {
    if (reviewDetailLoadedRef.current.has(txnId)) {
      return;
    }
    setReviewDetailErr((e) => {
      const next = { ...e };
      delete next[txnId];
      return next;
    });
    setReviewDetailLoadingIds((s) => new Set(s).add(txnId));
    try {
      const res = await apiJson<{ items: ResolutionDetailItem[] }>(`/transactions/${txnId}/open-review`);
      setReviewDetailByTxn((d) => ({ ...d, [txnId]: res.items }));
      reviewDetailLoadedRef.current.add(txnId);
    } catch (e: unknown) {
      setReviewDetailErr((d) => ({
        ...d,
        [txnId]: e instanceof Error ? e.message : "Failed to load review context"
      }));
    } finally {
      setReviewDetailLoadingIds((s) => {
        const next = new Set(s);
        next.delete(txnId);
        return next;
      });
    }
  }

  function toggleTxnExpand(txnId: string) {
    setExpandedTxnIds((prev) => {
      const next = new Set(prev);
      if (next.has(txnId)) {
        next.delete(txnId);
        return next;
      }
      next.add(txnId);
      void ensureReviewDetailLoaded(txnId);
      return next;
    });
  }

  async function patchResolutionItemStatus(txnId: string, itemId: string, status: "open" | "in_review" | "resolved") {
    setError(null);
    setSavingResolutionItemId(itemId);
    try {
      await apiJson(`/resolution/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      forgetReviewDetail(txnId);
      await ensureReviewDetailLoaded(txnId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update review item");
    } finally {
      setSavingResolutionItemId(null);
    }
  }

  async function updateCategory(txnId: string, categoryId: string | null) {
    setSavingId(txnId);
    setError(null);
    try {
      await apiJson(`/transactions/${txnId}`, {
        method: "PATCH",
        body: JSON.stringify({ categoryId })
      });
      forgetReviewDetail(txnId);
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
      resolutionTypes.length > 0 ||
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

  function setResolutionTypesInUrl(nextTypes: LedgerResolutionType[]) {
    mergeParams((n) => {
      n.delete("resolutionType");
      for (const t of nextTypes) {
        n.append("resolutionType", t);
      }
      n.set("offset", "0");
    });
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
        n.delete("resolutionType");
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
    return <Navigate to="/" replace />;
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
            (rules) or here. <strong>Needs review</strong> includes uncategorized rows, non-posted status, and any
            open review item — including when a category is already set but transfer or duplicate review is still open.
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
        {needsReviewTab ? (
          <div className="transactions-toolbar__review-row">
            <label className="transactions-toolbar__field">
              <span className="transactions-toolbar__label">Review types</span>
              <select
                multiple
                size={4}
                className="transactions-toolbar__resolution-types"
                value={resolutionTypes}
                aria-label="Filter by open review item types"
                onChange={(e) => {
                  const next = Array.from(e.target.selectedOptions).map((o) => o.value as LedgerResolutionType);
                  setResolutionTypesInUrl(next);
                }}
              >
                {LEDGER_RESOLUTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RESOLUTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted transactions-toolbar__review-hint">
              Cmd or Ctrl + click to select multiple types. With none selected, all needs-review rows are shown. Same
              open-item types as the review queue.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => setResolutionTypesInUrl(["unknown_category"])}
              >
                Show unknown category only
              </button>{" "}
              (helps bulk-assign categories).
            </p>
          </div>
        ) : null}
        {needsReviewTab && (resolutionQueueSummary?.openDuplicateAmbiguityNotOnLedger ?? 0) > 0 ? (
          <div
            className="transactions-toolbar__orphan-banner"
            style={{
              padding: "0.65rem 0.85rem",
              marginBottom: "0.75rem",
              borderRadius: "8px",
              border: "1px solid #fcd34d",
              background: "#fffbeb"
            }}
          >
            <strong>{resolutionQueueSummary?.openDuplicateAmbiguityNotOnLedger}</strong> open near-duplicate item(s)
            are tied to import data only (no ledger row) — they do not appear in this table.{" "}
            <Link to="/resolution-queue">Open full resolution queue</Link> to triage.
          </div>
        ) : null}
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
            Search matches a <strong>substring</strong> in merchant + memo, or the <strong>FTS5</strong> index when
            present (multi-word queries use token <strong>AND</strong>). Results are sorted by <strong>date</strong>{" "}
            (newest first). Pagination: <code>limit</code>/<code>offset</code>.
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
            {resolutionTypes.length > 0 ? (
              <>
                {" "}
                [review types:{" "}
                <code>{resolutionTypes.map((t) => RESOLUTION_TYPE_LABELS[t]).join(", ")}</code>]
              </>
            ) : null}
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
        {needsReviewTab && selectedCount > 0 ? (
          <div className="transactions-bulk-bar row" role="status" aria-live="polite">
            <span className="muted">
              {selectedCount} row{selectedCount === 1 ? "" : "s"} selected
              {unknownCategoryResolutionIdsInSelection.length === 0 ? (
                <>
                  {" "}
                  — none have an open “Unknown category” item (bulk category disabled).
                </>
              ) : (
                <>
                  {" "}
                  — {unknownCategoryResolutionIdsInSelection.length} open “Unknown category” item
                  {unknownCategoryResolutionIdsInSelection.length === 1 ? "" : "s"} for bulk apply.
                </>
              )}
            </span>
            {nonUnknownOpenResolutionCountInSelection > 0 ? (
              <span className="muted" style={{ marginLeft: "0.25rem" }}>
                {nonUnknownOpenResolutionCountInSelection} other review item
                {nonUnknownOpenResolutionCountInSelection === 1 ? "" : "s"} also selected.
              </span>
            ) : null}
            <button
              type="button"
              className="secondary"
              disabled={savingBulk}
              onClick={() => void bulkUpdateResolutionStatus("in_review")}
            >
              In review
            </button>
            <button type="button" disabled={savingBulk} onClick={() => void bulkUpdateResolutionStatus("resolved")}>
              Resolve
            </button>
            <button
              type="button"
              className="secondary"
              disabled={savingBulk}
              onClick={() => void bulkUpdateResolutionStatus("open")}
            >
              Reopen
            </button>
            <label
              style={{
                marginBottom: 0,
                marginLeft: "0.25rem",
                opacity: unknownCategoryResolutionIdsInSelection.length === 0 ? 0.55 : 1
              }}
            >
              <span className="muted" style={{ marginRight: "0.35rem" }}>
                Category (unknown-category items)
              </span>
              <select
                value={bulkCategoryId}
                onChange={(e) => setBulkCategoryId(e.target.value)}
                disabled={savingBulk}
                style={{ minWidth: "10rem" }}
              >
                <option value="">—</option>
                {categories
                  .filter((c) => !c.parentId)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => {
                    const children = categories
                      .filter((c) => c.parentId === p.id)
                      .sort((a, b) => a.name.localeCompare(b.name));
                    if (children.length === 0) {
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      );
                    }
                    return (
                      <optgroup key={p.id} label={p.name}>
                        {children.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
              </select>
            </label>
            <button
              type="button"
              disabled={savingBulk || !bulkCategoryId || unknownCategoryResolutionIdsInSelection.length === 0}
              onClick={() => void bulkApplyCategory()}
              title={
                unknownCategoryResolutionIdsInSelection.length === 0
                  ? "Select rows that still have an open Unknown category review item, or filter to Unknown category."
                  : undefined
              }
            >
              Apply category
            </button>
            <button
              type="button"
              className="secondary"
              disabled={savingBulk || !bulkCategoryId || unknownCategoryResolutionIdsInSelection.length === 0}
              onClick={() => void bulkApplyCategoryAndResolve()}
              title="Applies category to unknown-category items in selection and marks those review items resolved."
            >
              Apply + resolve
            </button>
          </div>
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
                      {needsReviewTab ? (
                        <th style={{ width: "2.5rem" }}>
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={() => toggleSelectAllVisible()}
                            disabled={savingBulk}
                            title="Select all rows on this page"
                            aria-label="Select all rows on this page"
                          />
                        </th>
                      ) : null}
                      {needsReviewTab ? (
                        <th className="transactions-page__expand-th" scope="col">
                          Context
                        </th>
                      ) : null}
                      <th>Date</th>
                      <th>Account</th>
                      <th>Amount</th>
                      <th>Description</th>
                      {needsReviewTab ? <th>Why</th> : null}
                      {needsReviewTab ? <th>Session</th> : null}
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
                      const expanded = expandedTxnIds.has(t.id);
                      const detailItems = reviewDetailByTxn[t.id];
                      const detailLoading = reviewDetailLoadingIds.has(t.id);
                      const detailError = reviewDetailErr[t.id];
                      const colSpan = needsReviewTab ? 9 : 7;
                      return (
                        <Fragment key={t.id}>
                          <tr>
                            {needsReviewTab ? (
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedTxnIds.has(t.id)}
                                  onChange={() => toggleTxnSelected(t.id)}
                                  disabled={savingBulk}
                                  aria-label={`Select row ${desc}`}
                                />
                              </td>
                            ) : null}
                            {needsReviewTab ? (
                              <td className="transactions-page__expand-cell">
                                <button
                                  type="button"
                                  className="transactions-page__expand-btn"
                                  aria-expanded={expanded}
                                  onClick={() => toggleTxnExpand(t.id)}
                                >
                                  {expanded ? "Hide" : "Show"}
                                </button>
                              </td>
                            ) : null}
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
                            {needsReviewTab ? (
                              <td style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                                {t.importSessionId ? (
                                  <Link
                                    to={`/transactions?needsReview=true&sessionId=${t.importSessionId}`}
                                    className="muted"
                                  >
                                    Import session
                                  </Link>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                            ) : null}
                            <td>
                              <LedgerCategoryPicker
                                categories={categories}
                                value={t.categoryId}
                                disabled={savingId === t.id || savingBulk}
                                onChange={(v) => void updateCategory(t.id, v)}
                                ariaLabel={`Category for ${desc}`}
                              />
                            </td>
                          </tr>
                          {needsReviewTab && expanded ? (
                            <tr key={`${t.id}-ctx`} className="transactions-page__detail-row">
                              <td colSpan={colSpan}>
                                <div className="transactions-page__detail-panel">
                                  {detailLoading ? <p className="muted">Loading review context…</p> : null}
                                  {detailError ? <p className="error">{detailError}</p> : null}
                                  {!detailLoading && !detailError && detailItems && detailItems.length === 0 ? (
                                    <p className="muted">
                                      No open resolution items on this row (still listed for other reasons, e.g.
                                      uncategorized or non-posted status). Use filters and bulk actions above as
                                      needed.
                                    </p>
                                  ) : null}
                                  {!detailLoading && !detailError && detailItems && detailItems.length > 0
                                    ? detailItems.map((it) => {
                                        const summary =
                                          it.reasonDetail?.message ??
                                          (it.reasonDetail?.kind === "near_duplicate"
                                            ? "Possible duplicate of an existing transaction."
                                            : it.reason.slice(0, 200));
                                        const explainSource = prettyClassificationSource(
                                          it.context.classification?.source
                                        );
                                        const explainConf = formatConfidencePct(it.context.classification?.confidence);
                                        const explainRule = it.context.classification?.ruleId ?? null;
                                        const explainReason = it.context.classification?.reason ?? null;
                                        const busy =
                                          savingBulk ||
                                          Boolean(savingResolutionItemId) ||
                                          savingId === t.id;
                                        return (
                                          <div key={it.id} className="transactions-page__review-block">
                                            <div className="transactions-page__review-block-head">
                                              <strong>{formatResolutionTypeLabel(it.type)}</strong>
                                              <span className="muted" style={{ marginLeft: "0.5rem" }}>
                                                {it.status}
                                              </span>
                                              <span className="muted" style={{ marginLeft: "0.5rem" }}>
                                                · {it.createdAt}
                                              </span>
                                            </div>
                                            <p className="muted" style={{ margin: "0.35rem 0 0.25rem" }}>
                                              <span className="muted">File:</span>{" "}
                                              {it.context.fileName ?? "—"}{" "}
                                              {it.context.sessionId ? (
                                                <>
                                                  ·{" "}
                                                  <Link
                                                    to={`/transactions?needsReview=true&sessionId=${it.context.sessionId}`}
                                                  >
                                                    Session rows
                                                  </Link>
                                                </>
                                              ) : null}
                                            </p>
                                            <p className="muted" style={{ margin: "0 0 0.35rem" }}>
                                              <span className="muted">Raw preview:</span>{" "}
                                              {it.context.raw ? (
                                                <>
                                                  {it.context.raw.txnDate ?? "—"} ·{" "}
                                                  {formatSignedMoneyRaw(it.context.raw.amount)} ·{" "}
                                                  {it.context.raw.description ?? "—"}
                                                </>
                                              ) : (
                                                "—"
                                              )}
                                            </p>
                                            <p style={{ margin: "0 0 0.35rem", fontSize: "0.9rem" }}>{summary}</p>
                                            {explainSource || explainConf || explainRule || explainReason ? (
                                              <div className="resolution-explainability">
                                                {explainSource ? (
                                                  <span className="resolution-explainability__pill">{explainSource}</span>
                                                ) : null}
                                                {explainConf ? (
                                                  <span className="resolution-explainability__pill">{explainConf}</span>
                                                ) : null}
                                                {explainRule ? (
                                                  <span className="resolution-explainability__pill">
                                                    ID {explainRule.slice(0, 8)}
                                                  </span>
                                                ) : null}
                                                {explainReason ? (
                                                  <span className="resolution-explainability__reason">{explainReason}</span>
                                                ) : null}
                                              </div>
                                            ) : null}
                                            <div className="transactions-page__review-block-actions row">
                                              {it.type === "unknown_category" ? (
                                                <div style={{ minWidth: "12rem", maxWidth: "16rem" }}>
                                                  <span className="muted" style={{ fontSize: "0.78rem" }}>
                                                    Set category
                                                  </span>
                                                  <LedgerCategoryPicker
                                                    categories={categories}
                                                    value={null}
                                                    disabled={busy}
                                                    onChange={async (categoryId) => {
                                                      if (!categoryId) {
                                                        return;
                                                      }
                                                      setSavingId(t.id);
                                                      setError(null);
                                                      try {
                                                        await apiJson(`/transactions/${t.id}`, {
                                                          method: "PATCH",
                                                          body: JSON.stringify({ categoryId })
                                                        });
                                                        forgetReviewDetail(t.id);
                                                        await load();
                                                      } catch (e: unknown) {
                                                        setError(e instanceof Error ? e.message : "Failed to set category");
                                                      } finally {
                                                        setSavingId(null);
                                                      }
                                                    }}
                                                    ariaLabel={`Set category for transaction ${t.id}`}
                                                  />
                                                </div>
                                              ) : null}
                                              <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                                                {it.status !== "in_review" ? (
                                                  <button
                                                    type="button"
                                                    className="secondary"
                                                    disabled={busy || savingResolutionItemId === it.id}
                                                    onClick={() =>
                                                      void patchResolutionItemStatus(t.id, it.id, "in_review")
                                                    }
                                                  >
                                                    In review
                                                  </button>
                                                ) : null}
                                                {it.status !== "resolved" ? (
                                                  <button
                                                    type="button"
                                                    disabled={busy || savingResolutionItemId === it.id}
                                                    onClick={() =>
                                                      void patchResolutionItemStatus(t.id, it.id, "resolved")
                                                    }
                                                  >
                                                    Resolve
                                                  </button>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    className="secondary"
                                                    disabled={busy || savingResolutionItemId === it.id}
                                                    onClick={() => void patchResolutionItemStatus(t.id, it.id, "open")}
                                                  >
                                                    Reopen
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })
                                    : null}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
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
