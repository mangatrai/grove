import { MultiSelect } from "@mantine/core";
import { IconArrowBackUp, IconPlus, IconTrash } from "@tabler/icons-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HelpIcon } from "../components/HelpIcon";
import { HierarchicalSearchPicker, lookupLabel, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { buildCategoryFilterGroups, type CategoryOption } from "../components/categoryPickerGroups";
import { LedgerCategoryPicker } from "../components/LedgerCategoryPicker";
import { formatAccountForSelect } from "../import/accountDisplay";

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
      source?: "household" | "builtin" | "none" | "db" | "default";
      ruleId?: string | null;
      confidence?: number;
      reason?: string;
      ai?: {
        suggestedCategoryId?: string | null;
        confidence?: number;
        suggestedNewCategoryName?: string | null;
        reason?: string;
        model?: string;
        autoApplied?: boolean;
      } | null;
    } | null;
  };
};

type TxClassificationMeta = {
  source: string;
  ruleId: string | null;
  confidence: number;
  reason: string;
} | null;

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
  ownerScope: "household" | "person";
  ownerPersonProfileId: string | null;
  /** Rules / manual classification audit from import canonicalize. */
  classificationMeta: TxClassificationMeta;
  reviewReasons?: string[];
  openReviewItems?: OpenReviewItem[];
  importSessionId?: string | null;
};

const LEDGER_RESOLUTION_TYPES = [
  "duplicate_ambiguity",
  "reconciliation_mismatch"
] as const;

type LedgerResolutionType = (typeof LEDGER_RESOLUTION_TYPES)[number];

const RESOLUTION_TYPE_LABELS: Record<LedgerResolutionType, string> = {
  duplicate_ambiguity: "Duplicate",
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

type OwnerProfileOption = { id: string; label: string };
type BelongsToFilterValue = "" | "household" | `person:${string}`;

function parseBelongsToFilterValue(value: string): {
  ownerScope?: "household" | "person";
  ownerPersonProfileId?: string;
} {
  if (value === "household") {
    return { ownerScope: "household" };
  }
  if (value.startsWith("person:")) {
    const id = value.slice("person:".length);
    if (id) {
      return { ownerScope: "person", ownerPersonProfileId: id };
    }
  }
  return {};
}

function formatBelongsToLabel(label: string): string {
  return `Household > ${label}`;
}

function buildBelongsToGroups(ownerProfiles: OwnerProfileOption[]): HierarchicalPickerGroup[] {
  return [
    { group: "Household", items: [{ value: "household", label: "Household", searchText: "household" }] },
    {
      group: "Members",
      items: ownerProfiles.map((p) => ({
        value: `person:${p.id}`,
        label: formatBelongsToLabel(p.label),
        displayLabel: p.label,
        searchText: p.label
      }))
    }
  ];
}

function buildAccountGroups(accounts: AccountRow[]): HierarchicalPickerGroup[] {
  const byInstitution = new Map<string, AccountRow[]>();
  for (const a of accounts) {
    byInstitution.set(a.institution, [...(byInstitution.get(a.institution) ?? []), a]);
  }
  return [...byInstitution.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([institution, rows]) => ({
      group: institution,
      items: rows
        .sort((a, b) => formatAccountForSelect(a).localeCompare(formatAccountForSelect(b)))
        .map((a) => ({
          value: a.id,
          label: formatAccountForSelect(a),
          searchText: `${a.institution} ${a.type} ${a.account_mask ?? ""}`
        }))
    }));
}

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
      return "Duplicate / ambiguous match";
    case "unknown_category":
      return "Unknown category";
    case "reconciliation_mismatch":
      return "Reconciliation mismatch";
    default:
      return t;
  }
}

function prettyClassificationSource(
  source?: "household" | "builtin" | "none" | "db" | "default" | "manual" | string
): string | null {
  if (!source) return null;
  if (source === "manual") return "Manual entry";
  if (source === "household" || source === "db") return "Household rule";
  if (source === "builtin" || source === "default") return "Built-in rule";
  if (source === "none") return "No rule match";
  return null;
}

function CategoryClassificationHint({ meta }: { meta: TxClassificationMeta }) {
  if (!meta) {
    return null;
  }
  const label = prettyClassificationSource(meta.source);
  const conf = formatConfidencePct(meta.confidence);
  const bits = [label, conf].filter(Boolean);
  const title = [bits.join(" · "), meta.reason?.trim() ? meta.reason : ""].filter(Boolean).join("\n");
  if (bits.length === 0 && !meta.reason?.trim()) {
    return null;
  }
  return (
    <div className="transactions-page__classify-hint muted" style={{ fontSize: "0.78rem", marginTop: "0.2rem", lineHeight: 1.35 }}>
      <span title={title || undefined}>
        {bits.length > 0 ? <span>{bits.join(" · ")}</span> : null}
        {meta.reason?.trim() ? (
          <span style={{ display: "block", marginTop: bits.length > 0 ? "0.1rem" : 0 }}>
            {meta.reason.length > 120 ? `${meta.reason.slice(0, 117)}…` : meta.reason}
          </span>
        ) : null}
      </span>
      {meta.source === "household" && meta.ruleId ? (
        <span style={{ display: "block", marginTop: "0.15rem" }}>
          <Link to="/categories/rules">Household rules</Link>
          <span className="muted"> · id {meta.ruleId.slice(0, 8)}…</span>
        </span>
      ) : null}
    </div>
  );
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

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    posted:    { label: "Posted",    bg: "var(--color-accent-subtle, #dcfce7)", color: "var(--color-accent)" },
    trashed:   { label: "Trashed",   bg: "#fee2e2", color: "#dc2626" },
    duplicate: { label: "Duplicate", bg: "#fef3c7", color: "#d97706" },
    pending:   { label: "Pending",   bg: "var(--color-surface-alt, #f8fafc)", color: "var(--color-text-muted)" },
  };
  const c = cfg[status] ?? { label: status, bg: "var(--color-surface-alt, #f8fafc)", color: "var(--color-text-muted)" };
  return (
    <span style={{
      display: "inline-block",
      padding: "0.1rem 0.45rem",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      background: c.bg,
      color: c.color,
      letterSpacing: "0.02em",
      whiteSpace: "nowrap"
    }}>
      {c.label}
    </span>
  );
}

export function TransactionsPage() {
  const token = useAuthToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionFilter = searchParams.get("sessionId")?.trim() || null;
  const fileFilter = searchParams.get("fileId")?.trim() || null;
  const categoryFilter = searchParams.get("categoryId")?.trim() || null;
  const uncategorizedOnly = searchParams.get("uncategorizedOnly") === "true";
  const needsReviewTab = searchParams.get("needsReview") === "true";
  const trashTab = searchParams.get("trash") === "true";
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
  const ownerScopeFilter = (searchParams.get("ownerScope")?.trim() as "household" | "person" | null) || null;
  const ownerPersonProfileFilter = searchParams.get("ownerPersonProfileId")?.trim() || null;
  const belongsToFilterValue: BelongsToFilterValue =
    ownerScopeFilter === "person" && ownerPersonProfileFilter
      ? (`person:${ownerPersonProfileFilter}` as BelongsToFilterValue)
      : ownerScopeFilter === "household"
        ? "household"
        : "";
  const returnTo = searchParams.get("returnTo")?.trim() || null;
  const fromDashboard = searchParams.get("fromDashboard") === "true";
  const pageLimit = Math.min(Math.max(Number(searchParams.get("limit") || 100), 1), 200);
  const pageOffset = Math.max(Number(searchParams.get("offset") || 0), 0);

  const [data, setData] = useState<ListResponse | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [ownerProfiles, setOwnerProfiles] = useState<OwnerProfileOption[]>([]);
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
  const [addDirection, setAddDirection] = useState<"credit" | "debit">("debit");
  const [addAmount, setAddAmount] = useState("");
  const [addMerchant, setAddMerchant] = useState("Manual entry");
  const [addCategoryId, setAddCategoryId] = useState<string | null>(null);
  const [addBelongsTo, setAddBelongsTo] = useState<BelongsToFilterValue>("");
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
  const [ruleFromLedgerConfirm, setRuleFromLedgerConfirm] = useState<{ txnId: string; categoryId: string } | null>(
    null
  );
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(() => new Set());
  const [savingTrash, setSavingTrash] = useState(false);

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
    if (fileFilter) {
      qs.set("fileId", fileFilter);
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
    if (trashTab) {
      qs.set("trashOnly", "true");
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
    if (ownerScopeFilter) {
      qs.set("ownerScope", ownerScopeFilter);
    }
    if (ownerPersonProfileFilter) {
      qs.set("ownerPersonProfileId", ownerPersonProfileFilter);
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
    if (ownerProfiles.length === 0) {
      try {
        const members = await apiJson<{ members: Array<{ id: string; fullName: string; relationship: string }> }>(
          "/household/members"
        );
        setOwnerProfiles(
          (members.members ?? []).map((m) => ({
            id: m.id,
            label: `${m.fullName}${m.relationship ? ` (${m.relationship})` : ""}`
          }))
        );
      } catch {
        try {
          const me = await apiJson<{ profile: { id: string; fullName: string } }>("/household/profile");
          setOwnerProfiles([{ id: me.profile.id, label: me.profile.fullName || "My profile" }]);
        } catch {
          setOwnerProfiles([]);
        }
      }
    }
  }, [
    sessionFilter,
    fileFilter,
    categoryFilter,
    uncategorizedOnly,
    needsReviewTab,
    trashTab,
    resolutionTypesKey,
    searchFromUrl,
    dateFrom,
    dateTo,
    accountFilter,
    ownerScopeFilter,
    ownerPersonProfileFilter,
    amountMinUrl,
    amountMaxUrl,
    pageLimit,
    pageOffset,
    ownerProfiles.length
  ]);

  const refreshCategories = useCallback(async () => {
    try {
      const catRes = await apiJson<{ categories: CategoryOption[] }>("/categories");
      setCategories(catRes.categories);
    } catch {
      /* ignore */
    }
  }, []);

  const handleCreateRuleFromLedger = useCallback(async () => {
    const p = ruleFromLedgerConfirm;
    if (!p) {
      return;
    }
    try {
      await apiJson("/categories/rules/from-ledger", {
        method: "POST",
        body: JSON.stringify({
          transactionId: p.txnId,
          categoryId: p.categoryId,
          matchType: "contains",
          scope: "contains"
        })
      });
    } catch (ruleErr: unknown) {
      setError(ruleErr instanceof Error ? ruleErr.message : "Could not create rule from description");
      throw ruleErr;
    }
  }, [ruleFromLedgerConfirm]);

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
    fileFilter,
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
    fileFilter,
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

  const openFlagCountInSelection = useMemo(() => {
    if (!data) return 0;
    let count = 0;
    for (const t of data.transactions) {
      if (!selectedTxnIds.has(t.id)) continue;
      count += (t.openReviewItems ?? []).length;
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
    if (!data) return [];
    const out: string[] = [];
    for (const t of data.transactions) {
      if (!selectedTxnIds.has(t.id)) continue;
      for (const item of t.openReviewItems ?? []) out.push(item.id);
    }
    return [...new Set(out)];
  }

  async function bulkAssignCategory() {
    if (!bulkCategoryId) {
      setError("Choose a category.");
      return;
    }
    const ids = data ? [...selectedTxnIds].filter((id) => data.transactions.some((t) => t.id === id)) : [];
    if (ids.length === 0) return;
    setError(null);
    setSavingBulk(true);
    try {
      const res = await apiJson<{ updated: number; skipped: number }>(
        "/transactions/bulk-category",
        { method: "POST", body: JSON.stringify({ ids, categoryId: bulkCategoryId }) }
      );
      if (res.skipped > 0) {
        setError(`Applied to ${res.updated}; ${res.skipped} row(s) could not be updated.`);
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

  async function bulkResolveFlags() {
    const ids = collectOpenResolutionIdsFromSelection();
    if (ids.length === 0) {
      setError("Selected rows have no open review flags to resolve.");
      return;
    }
    setError(null);
    setSavingBulk(true);
    try {
      const res = await apiJson<{ updated: { id: string; status: string }[]; errors: { id: string; code: string }[] }>(
        "/resolution/bulk",
        { method: "POST", body: JSON.stringify({ ids, status: "resolved" }) }
      );
      if (res.errors.length > 0) {
        setError(`Resolved ${res.updated.length}; ${res.errors.length} could not be changed.`);
      }
      setSelectedTxnIds(new Set());
      reviewDetailLoadedRef.current.clear();
      setReviewDetailByTxn({});
      setReviewDetailErr({});
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk resolve failed");
    } finally {
      setSavingBulk(false);
    }
  }

  async function trashSingle(id: string) {
    setError(null);
    try {
      await apiJson(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify({ status: "trashed" }) });
      forgetReviewDetail(id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Move to trash failed");
    }
  }

  async function bulkTrashSelected() {
    const ids = data ? [...selectedTxnIds].filter((id) => data.transactions.some((t) => t.id === id)) : [];
    if (!ids.length) return;
    setError(null);
    setSavingBulk(true);
    try {
      await apiJson<{ trashed: number; skipped: number }>(
        "/transactions/bulk-trash",
        { method: "POST", body: JSON.stringify({ ids }) }
      );
      setSelectedTxnIds(new Set());
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk trash failed");
    } finally {
      setSavingBulk(false);
    }
  }

  async function bulkRestoreSelected() {
    const ids = data ? [...selectedTrashIds].filter((id) => data.transactions.some((t) => t.id === id)) : [];
    if (!ids.length) return;
    setError(null);
    setSavingTrash(true);
    try {
      await apiJson<{ restored: number; skipped: number }>(
        "/transactions/bulk-restore",
        { method: "POST", body: JSON.stringify({ ids }) }
      );
      setSelectedTrashIds(new Set());
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setSavingTrash(false);
    }
  }

  async function bulkHardDeleteSelected() {
    const ids = data ? [...selectedTrashIds].filter((id) => data.transactions.some((t) => t.id === id)) : [];
    if (!ids.length) return;
    setError(null);
    setSavingTrash(true);
    try {
      await apiJson<{ deleted: number; skipped: number }>(
        "/transactions/bulk-delete",
        { method: "POST", body: JSON.stringify({ ids }) }
      );
      setSelectedTrashIds(new Set());
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSavingTrash(false);
    }
  }

  async function hardDeleteSingle(id: string) {
    setError(null);
    setSavingTrash(true);
    try {
      await apiJson(`/transactions/${id}`, { method: "DELETE" });
      setSelectedTrashIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete permanently failed");
    } finally {
      setSavingTrash(false);
    }
  }

  async function restoreSingle(id: string) {
    setError(null);
    setSavingTrash(true);
    try {
      await apiJson(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify({ status: "posted" }) });
      setSelectedTrashIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setSavingTrash(false);
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

  async function updateCategory(
    txnId: string,
    categoryId: string | null,
    ownerScope?: "household" | "person",
    ownerPersonProfileId?: string | null
  ) {
    setSavingId(txnId);
    setError(null);
    try {
      await apiJson(`/transactions/${txnId}`, {
        method: "PATCH",
        body: JSON.stringify({
          categoryId,
          ownerScope,
          ownerPersonProfileId: ownerScope === "person" ? ownerPersonProfileId : null
        })
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

  const accountGroups = useMemo(() => buildAccountGroups(accounts), [accounts]);
  const belongsToGroups = useMemo(() => buildBelongsToGroups(ownerProfiles), [ownerProfiles]);
  const categoryGroups = useMemo(() => buildCategoryFilterGroups(categories), [categories]);
  const resolutionTypeMultiData = useMemo(
    () =>
      LEDGER_RESOLUTION_TYPES.map((t) => ({
        value: t,
        label: RESOLUTION_TYPE_LABELS[t]
      })),
    []
  );

  const hasLedgerFilters = Boolean(
    categoryFilter ||
      uncategorizedOnly ||
      dateFrom ||
      dateTo ||
      accountFilter ||
      fileFilter ||
      ownerScopeFilter ||
      ownerPersonProfileFilter ||
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

  function setTab(tab: "all" | "review" | "trash") {
    mergeParams((n) => {
      n.set("offset", "0");
      n.delete("needsReview");
      n.delete("resolutionType");
      n.delete("trash");
      if (tab === "review") n.set("needsReview", "true");
      if (tab === "trash") n.set("trash", "true");
    });
    setSelectedTrashIds(new Set());
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
    setAddDirection("debit");
    setAddAmount("");
    setAddMerchant("Manual entry");
    setAddCategoryId(null);
    setAddBelongsTo("");
    setAddError(null);
    setAddOpen(true);
  }

  async function submitManual() {
    setAddSaving(true);
    setAddError(null);
    const amt = Number(addAmount);
    if (!addAccountId || !Number.isFinite(amt) || amt <= 0) {
      setAddError("Choose an account and enter a positive amount.");
      setAddSaving(false);
      return;
    }
    const belongsTo = parseBelongsToFilterValue(addBelongsTo);
    if (!belongsTo.ownerScope) {
      setAddError("Choose Belongs-to.");
      setAddSaving(false);
      return;
    }
    try {
      const created = await apiJson<{ id: string }>("/transactions", {
        method: "POST",
        body: JSON.stringify({
          accountId: addAccountId,
          txnDate: addTxnDate,
          amount: addDirection === "credit" ? amt : -amt,
          merchant: addMerchant.trim() || "Manual entry",
          memo: null,
          categoryId: addCategoryId
        })
      });
      await apiJson(`/transactions/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          categoryId: addCategoryId,
          ownerScope: belongsTo.ownerScope,
          ownerPersonProfileId: belongsTo.ownerScope === "person" ? belongsTo.ownerPersonProfileId : null
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Transactions</h1>
          <HelpIcon label="Posted rows from your household ledger. Needs review includes uncategorized rows, non-posted status, or open duplicate/transfer flags. Categories can be set by rules or manually here." />
          {sessionFilter ? (
            <span className="muted" style={{ fontSize: 13, marginLeft: 4 }}>
              Session: <code>{sessionFilter}</code>{" · "}
              <Link to={`/imports/${sessionFilter}`}>Workspace</Link>{" · "}
              <Link to="/transactions">All transactions</Link>
            </span>
          ) : null}
          {fromDashboard && returnTo ? (
            <Link to={returnTo} style={{ fontSize: 13, marginLeft: "auto" }}>← Dashboard</Link>
          ) : null}
        </div>
      </div>

      <div className="transactions-toolbar card transactions-page__control-band">
        <div className="transactions-toolbar__tabs" role="tablist" aria-label="Transaction scope">
          <button
            type="button"
            role="tab"
            aria-selected={!needsReviewTab && !trashTab}
            className={`transactions-toolbar__tab${!needsReviewTab && !trashTab ? " transactions-toolbar__tab--active" : ""}`}
            onClick={() => setTab("all")}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={needsReviewTab}
            className={`transactions-toolbar__tab${needsReviewTab ? " transactions-toolbar__tab--active" : ""}`}
            onClick={() => setTab("review")}
          >
            Needs review
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={trashTab}
            className={`transactions-toolbar__tab${trashTab ? " transactions-toolbar__tab--active" : ""}`}
            onClick={() => setTab("trash")}
          >
            Trash
          </button>
        </div>
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
            <strong>{resolutionQueueSummary?.openDuplicateAmbiguityNotOnLedger}</strong> near-duplicate item(s) flagged during import have no matching ledger row — they can be ignored or resolved by re-importing.
          </div>
        ) : null}
        <div className="transactions-toolbar__row">
          {needsReviewTab ? (
            <label className="transactions-toolbar__field transactions-toolbar__field--grow">
              <span className="transactions-toolbar__label">Review type</span>
              <MultiSelect
                placeholder="All types"
                aria-label="Filter by open review item types"
                data={resolutionTypeMultiData}
                value={resolutionTypes}
                onChange={(v) => setResolutionTypesInUrl(v as LedgerResolutionType[])}
                clearable
                searchable={false}
                size="sm"
                className="transactions-toolbar__resolution-multiselect"
              />
            </label>
          ) : null}
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
            <HierarchicalSearchPicker
              value={accountFilter ?? null}
              onChange={(v) =>
                mergeParams((n) => {
                  n.set("offset", "0");
                  if (!v) n.delete("accountId");
                  else n.set("accountId", v);
                })
              }
              groups={accountGroups}
              placeholder="All accounts"
              ariaLabel="Filter by account"
              clearable
            />
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
            <span className="transactions-toolbar__label">Belongs-to</span>
            <HierarchicalSearchPicker
              value={belongsToFilterValue || null}
              onChange={(v) =>
                mergeParams((n) => {
                  n.set("offset", "0");
                  const parsed = parseBelongsToFilterValue(v ?? "");
                  n.delete("ownerScope");
                  n.delete("ownerPersonProfileId");
                  if (parsed.ownerScope) n.set("ownerScope", parsed.ownerScope);
                  if (parsed.ownerPersonProfileId) n.set("ownerPersonProfileId", parsed.ownerPersonProfileId);
                })
              }
              groups={belongsToGroups}
              placeholder="All household activity"
              ariaLabel="Filter by belongs-to"
              clearable
            />
          </label>
          <label className="transactions-toolbar__field">
            <span className="transactions-toolbar__label">Category</span>
            <HierarchicalSearchPicker
              value={categorySelectValue || "__any__"}
              onChange={(v) => {
                const next = v ?? "__any__";
                mergeParams((n) => {
                  n.set("offset", "0");
                  n.delete("categoryId");
                  n.delete("uncategorizedOnly");
                  if (next === "__uncat__") n.set("uncategorizedOnly", "true");
                  else if (next && next !== "__any__") n.set("categoryId", next);
                });
              }}
              groups={categoryGroups}
              placeholder="Any"
              ariaLabel="Filter by category"
            />
          </label>
          <div className="transactions-toolbar__actions">
            {hasLedgerFilters ? (
              <button
                type="button"
                className="secondary"
                onClick={() => clearFilters()}
                title="Reset to default view"
              >
                Clear all filters
              </button>
            ) : null}
            <button
              type="button"
              className="button-primary"
              onClick={openAddModal}
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <IconPlus size={15} />
              Add transaction
            </button>
          </div>
        </div>
        <div className="transactions-toolbar__more" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className="transactions-toolbar__more-toggle"
            aria-expanded={moreFiltersOpen}
            onClick={() => setMoreFiltersOpen((o) => !o)}
          >
            {moreFiltersOpen ? "Fewer filters ▴" : "More filters ▾"}
          </button>
          <HelpIcon label="Search matches a substring in merchant + memo (multi-word = AND). Results sorted by date, newest first. Use amount min/max for signed amount range filtering." />
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
            {ownerScopeFilter ? (
              <>
                {" "}
                [belongs-to:{" "}
                <code>{lookupLabel(belongsToGroups, ownerScopeFilter) ?? ownerScopeFilter}</code>]
              </>
            ) : null}
            {ownerPersonProfileFilter ? (
              <>
                {" "}
                [belongs-to:{" "}
                <code>{lookupLabel(belongsToGroups, `person:${ownerPersonProfileFilter}`) ?? ownerPersonProfileFilter}</code>]
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
            </span>
            <div style={{ marginBottom: 0, minWidth: "12rem", maxWidth: "20rem" }}>
              <LedgerCategoryPicker
                categories={categories}
                value={bulkCategoryId || null}
                disabled={savingBulk}
                onChange={(id) => setBulkCategoryId(id ?? "")}
                onCategoryCreated={() => void refreshCategories()}
                ariaLabel="Bulk category"
              />
            </div>
            <button
              type="button"
              disabled={savingBulk || !bulkCategoryId}
              onClick={() => void bulkAssignCategory()}
            >
              Apply category
            </button>
            {openFlagCountInSelection > 0 ? (
              <button
                type="button"
                className="secondary"
                disabled={savingBulk}
                onClick={() => void bulkResolveFlags()}
                title="Mark open duplicate / reconciliation flags as resolved for selected rows"
              >
                Resolve flags ({openFlagCountInSelection})
              </button>
            ) : null}
            <button
              type="button"
              className="secondary"
              disabled={savingBulk}
              onClick={() => void bulkTrashSelected()}
              title="Move selected rows to Trash"
            >
              Move to trash
            </button>
          </div>
        ) : null}
        {trashTab && selectedTrashIds.size > 0 ? (
          <div className="transactions-bulk-bar row" role="status" aria-live="polite">
            <span className="muted">
              {selectedTrashIds.size} row{selectedTrashIds.size === 1 ? "" : "s"} selected
            </span>
            <button
              type="button"
              disabled={savingTrash}
              onClick={() => void bulkRestoreSelected()}
            >
              Restore ({selectedTrashIds.size})
            </button>
            <button
              type="button"
              className="secondary"
              disabled={savingTrash}
              onClick={() => void bulkHardDeleteSelected()}
              title="Permanently delete selected rows — cannot be undone"
            >
              Delete permanently ({selectedTrashIds.size})
            </button>
          </div>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && data ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <span className="muted" style={{ fontSize: "0.9rem" }}>
                {data.total > 0 ? (
                  <>
                    Showing <strong>{pageOffset + 1}–{pageOffset + data.transactions.length}</strong> of{" "}
                    <strong>{data.total}</strong> transaction(s){data.sessionId ? " for this import" : ""}.
                    {" "}Page <strong>{Math.floor(pageOffset / pageLimit) + 1}</strong> of{" "}
                    <strong>{Math.ceil(data.total / pageLimit)}</strong>.
                  </>
                ) : (
                  <>0 transaction(s){data.sessionId ? " for this import" : ""}.</>
                )}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <button type="button" disabled={!canPageBack} onClick={() => updatePaging(pageOffset - pageLimit)}>
                  ← Previous
                </button>
                <button type="button" disabled={!canPageForward} onClick={() => updatePaging(pageOffset + pageLimit)}>
                  Next →
                </button>
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
                <span className="muted">Per page:</span>
                <select
                  value={pageLimit}
                  onChange={(e) => mergeParams((n) => { n.set("limit", e.target.value); n.set("offset", "0"); })}
                  style={{ fontSize: "0.85rem" }}
                >
                  {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            {data.transactions.length === 0 ? (
              <p className="muted">
                {sessionFilter
                  ? "No posted rows for this session yet. Either parse/canonicalize has not finished, or all lines were flagged (duplicates / review queue)."
                  : hasLedgerFilters
                    ? "No rows match these filters."
                    : trashTab
                      ? "Trash is empty."
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
                      ) : trashTab ? (
                        <th style={{ width: "2.5rem" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(data?.transactions.length) && data!.transactions.every((t) => selectedTrashIds.has(t.id))}
                            onChange={() => {
                              if (!data?.transactions.length) return;
                              const allSel = data.transactions.every((t) => selectedTrashIds.has(t.id));
                              setSelectedTrashIds(allSel ? new Set() : new Set(data.transactions.map((t) => t.id)));
                            }}
                            disabled={savingTrash}
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
                      {!trashTab ? <th>Belongs-to</th> : null}
                      <th>Category</th>
                      <th style={{ width: "1px", whiteSpace: "nowrap" }}></th>
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
                      const colSpan = needsReviewTab ? 11 : trashTab ? 7 : 9;
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
                            ) : trashTab ? (
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedTrashIds.has(t.id)}
                                  onChange={() => setSelectedTrashIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                                    return next;
                                  })}
                                  disabled={savingTrash}
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
                            <td style={{ whiteSpace: "nowrap" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                {formatMoney(t.amount, t.direction)}
                                {t.status !== "posted" ? <StatusBadge status={t.status} /> : null}
                              </div>
                            </td>
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
                            {!trashTab ? (
                              <td style={{ minWidth: "12rem" }}>
                                <HierarchicalSearchPicker
                                  value={t.ownerScope === "household" ? "household" : (`person:${t.ownerPersonProfileId ?? ""}` as const)}
                                  onChange={(v) => {
                                    const parsed = parseBelongsToFilterValue(v ?? "household");
                                    if (parsed.ownerScope === "household") {
                                      void updateCategory(t.id, t.categoryId, "household", null);
                                    } else if (parsed.ownerPersonProfileId) {
                                      void updateCategory(t.id, t.categoryId, "person", parsed.ownerPersonProfileId);
                                    }
                                  }}
                                  groups={belongsToGroups}
                                  placeholder="Belongs-to"
                                  ariaLabel={`Belongs-to for ${desc}`}
                                  disabled={savingId === t.id || savingBulk}
                                />
                              </td>
                            ) : null}
                            <td>
                              {trashTab ? (
                                <span className="muted" style={{ fontSize: "0.9rem" }}>{t.categoryName ?? "—"}</span>
                              ) : (
                                <>
                                  <LedgerCategoryPicker
                                    categories={categories}
                                    value={t.categoryId}
                                    disabled={savingId === t.id || savingBulk}
                                    onChange={(v) => void updateCategory(t.id, v, t.ownerScope, t.ownerPersonProfileId)}
                                    ariaLabel={`Category for ${desc}`}
                                  />
                                  {needsReviewTab ? <CategoryClassificationHint meta={t.classificationMeta ?? null} /> : null}
                                </>
                              )}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {trashTab ? (
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button
                                    type="button"
                                    disabled={savingTrash}
                                    onClick={() => void restoreSingle(t.id)}
                                    title="Restore"
                                    style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 4, cursor: "pointer", padding: "0.2rem 0.4rem", display: "inline-flex", alignItems: "center", color: "var(--color-success)" }}
                                  >
                                    <IconArrowBackUp size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingTrash}
                                    onClick={() => void hardDeleteSingle(t.id)}
                                    title="Permanently delete — cannot be undone"
                                    style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 4, cursor: "pointer", padding: "0.2rem 0.4rem", display: "inline-flex", alignItems: "center", color: "var(--color-danger, #dc2626)" }}
                                  >
                                    <IconTrash size={14} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={savingId === t.id || savingBulk}
                                  onClick={() => void trashSingle(t.id)}
                                  title="Move to Trash"
                                  style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 4, cursor: "pointer", padding: "0.2rem 0.4rem", display: "inline-flex", alignItems: "center", color: "var(--color-text-muted)" }}
                                >
                                  <IconTrash size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                          {needsReviewTab && expanded ? (
                            <tr key={`${t.id}-ctx`} className="transactions-page__detail-row">
                              <td colSpan={colSpan}>
                                <div className="transactions-page__detail-panel">
                                  {detailLoading ? <p className="muted">Loading review context…</p> : null}
                                  {detailError ? <p className="error">{detailError}</p> : null}
                                  {!detailLoading && !detailError && detailItems && detailItems.length === 0 ? (
                                    <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
                                      This row is here because it has no category. Assign one using the picker
                                      in the row above to move it out of Needs review.
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
                                            {it.context.classification?.ai ? (
                                              <div
                                                className="muted"
                                                style={{ marginTop: "0.5rem", fontSize: "0.82rem", lineHeight: 1.4 }}
                                              >
                                                Legacy AI suggestion metadata is present on this ticket (older
                                                canonicalize). New imports use rules-only classification.
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
                                                        setRuleFromLedgerConfirm({ txnId: t.id, categoryId });
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
                                                {it.status !== "resolved" ? (
                                                  <button
                                                    type="button"
                                                    disabled={busy || savingResolutionItemId === it.id}
                                                    onClick={() =>
                                                      void patchResolutionItemStatus(t.id, it.id, "resolved")
                                                    }
                                                  >
                                                    Resolve flag
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
                                                <button
                                                  type="button"
                                                  className="secondary"
                                                  disabled={busy}
                                                  onClick={() => void trashSingle(t.id)}
                                                  title="Move this transaction to Trash"
                                                >
                                                  Move to trash
                                                </button>
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
              Choose money direction first, then enter a positive amount.
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
              <fieldset className="transactions-modal__money-flow">
                <legend>Money flow</legend>
                <label className="transactions-modal__radio">
                  <input
                    type="radio"
                    name="add-direction"
                    checked={addDirection === "credit"}
                    onChange={() => setAddDirection("credit")}
                  />
                  Money In
                </label>
                <label className="transactions-modal__radio">
                  <input
                    type="radio"
                    name="add-direction"
                    checked={addDirection === "debit"}
                    onChange={() => setAddDirection("debit")}
                  />
                  Money Out
                </label>
              </fieldset>
              <label>
                Amount
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  placeholder="42.50"
                />
              </label>
              <label className="transactions-modal__full">
                Description
                <input
                  value={addMerchant}
                  onChange={(e) => setAddMerchant(e.target.value)}
                  placeholder="Merchant or payee"
                />
              </label>
              <div className="transactions-modal__full">
                <span className="transactions-modal__picker-label">Belongs-to</span>
                <HierarchicalSearchPicker
                  value={addBelongsTo || null}
                  onChange={(v) => setAddBelongsTo((v ?? "") as BelongsToFilterValue)}
                  groups={belongsToGroups}
                  placeholder="Choose belongs-to..."
                  ariaLabel="Belongs-to for new transaction"
                />
              </div>
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

      <ConfirmDialog
        opened={ruleFromLedgerConfirm !== null}
        title="Create classification rule?"
        message="Create a household rule so similar descriptions map to this category? Uses a contains match on normalized text."
        confirmLabel="Create rule"
        cancelLabel="Not now"
        closeOnClickOutside={false}
        onClose={() => setRuleFromLedgerConfirm(null)}
        onConfirm={handleCreateRuleFromLedger}
      />
    </div>
  );
}
