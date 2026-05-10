import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Code,
  Box,
  ActionIcon,
  Alert,
  NativeSelect,
  Radio,
  MultiSelect
} from "@mantine/core";
import { IconArrowBackUp, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { useCurrentUser } from "../UserContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HelpIcon } from "../components/HelpIcon";
import { HierarchicalSearchPicker, lookupLabel, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { RecurringTagModal } from "../components/RecurringTagModal";
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
  transferCandidates?: {
    id: string;
    txnDate: string;
    amount: number;
    description: string;
    accountName: string;
  }[];
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
  /** Bank-supplied category from the source file (e.g. Discover "Category" column). Only present when source === "none". */
  bankCategory?: string | null;
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
  "transfer_ambiguity",
  "duplicate_ambiguity",
  "reconciliation_mismatch"
] as const;

type LedgerResolutionType = (typeof LEDGER_RESOLUTION_TYPES)[number];

const RESOLUTION_TYPE_LABELS: Record<LedgerResolutionType, string> = {
  transfer_ambiguity: "Transfer",
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

type RecurringOverride = {
  id: string;
  householdId: string;
  merchantKey: string;
  displayName: string | null;
  verdict: "confirmed" | "dismissed";
  amountAnchor: number | null;
  amountTolerancePct: number;
  taggedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

function findConfirmedOverride(merchant: string | null, overrides: RecurringOverride[]): RecurringOverride | null {
  if (!merchant) return null;
  const normalizedMerchant = merchant.toLowerCase();
  return overrides.find((o) => o.verdict === "confirmed" && normalizedMerchant.includes(o.merchantKey.toLowerCase())) ?? null;
}

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
  const showBankCategory = meta.source === "none" && meta.bankCategory;
  if (bits.length === 0 && !meta.reason?.trim() && !showBankCategory) {
    return null;
  }
  return (
    <Text c="dimmed" size="xs" mt={4} lh={1.35}>
      <Box component="span" title={title || undefined}>
        {bits.length > 0 ? <Text span>{bits.join(" · ")}</Text> : null}
        {meta.reason?.trim() ? (
          <Text span component="span" display="block" mt={bits.length > 0 ? 2 : 0}>
            {meta.reason.length > 120 ? `${meta.reason.slice(0, 117)}…` : meta.reason}
          </Text>
        ) : null}
      </Box>
      {showBankCategory ? (
        <Text component="span" display="block" mt={3}>
          Bank suggested: <strong>{meta.bankCategory}</strong>
        </Text>
      ) : null}
      {meta.source === "household" && meta.ruleId ? (
        <Text component="span" display="block" mt={3}>
          <Link to="/categories/rules">Household rules</Link>
          <Text span c="dimmed">{" · "}id {meta.ruleId.slice(0, 8)}…</Text>
        </Text>
      ) : null}
    </Text>
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
  const cfg: Record<string, { label: string; color: string }> = {
    posted:    { label: "Posted", color: "green" },
    trashed:   { label: "Trashed", color: "red" },
    duplicate: { label: "Duplicate", color: "yellow" },
    pending:   { label: "Pending", color: "gray" },
  };
  const c = cfg[status] ?? { label: status, color: "gray" };
  return (
    <Badge size="xs" radius="sm" color={c.color} variant="light">
      {c.label}
    </Badge>
  );
}

export function TransactionsPage() {
  const token = useAuthToken();
  const { role: currentRole, personProfileId: currentPersonProfileId } = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionFilter = searchParams.get("sessionId")?.trim() || null;
  const fileFilter = searchParams.get("fileId")?.trim() || null;
  const categoryFilter = searchParams.get("categoryId")?.trim() || null;
  const uncategorizedOnly = searchParams.get("uncategorizedOnly") === "true";
  const needsReviewTab = searchParams.get("needsReview") === "true";
  const trashTab = searchParams.get("trash") === "true";
  const recurringOnlyFilter = searchParams.get("recurringOnly") === "true";
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
  const [recurringOverrides, setRecurringOverrides] = useState<RecurringOverride[]>([]);
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
  // Tracks which merchant keys have already been offered rule-creation this session.
  // Prevents the dialog from re-firing for every WHOLEFDS item in a large triage queue.
  const [ruleOfferedMerchants, setRuleOfferedMerchants] = useState<Set<string>>(() => new Set());
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(() => new Set());
  const [savingTrash, setSavingTrash] = useState(false);
  const [selectedAllIds, setSelectedAllIds] = useState<Set<string>>(() => new Set());
  const [bulkAllCategoryId, setBulkAllCategoryId] = useState<string>("");
  const [savingBulkAll, setSavingBulkAll] = useState(false);
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  const [patternResolveOpen, setPatternResolveOpen] = useState(false);
  const [patternDraft, setPatternDraft] = useState("");
  const [patternCategoryId, setPatternCategoryId] = useState("");
  const [patternPreview, setPatternPreview] = useState<{ matched: number; descriptions: string[] } | null>(null);
  const [patternPreviewLoading, setPatternPreviewLoading] = useState(false);
  const [patternResolving, setPatternResolving] = useState(false);
  const [recurringModalTxn, setRecurringModalTxn] = useState<TxRow | null>(null);

  useEffect(() => {
    setSearchDraft(searchFromUrl);
  }, [searchFromUrl]);

  // For members: auto-default Belongs-To in the manual-entry form to their own profile.
  useEffect(() => {
    if (currentRole === "member" && currentPersonProfileId) {
      setAddBelongsTo(`person:${currentPersonProfileId}` as BelongsToFilterValue);
    }
  }, [currentRole, currentPersonProfileId]);

  // For members: default the transaction list filter to their own profile on mount
  // (only when no owner filter is already present in the URL).
  useEffect(() => {
    if (currentRole === "member" && currentPersonProfileId) {
      setSearchParams((prev) => {
        if (prev.get("ownerPersonProfileId")) return prev;
        const next = new URLSearchParams(prev);
        next.set("ownerScope", "person");
        next.set("ownerPersonProfileId", currentPersonProfileId);
        return next;
      }, { replace: true });
    }
  }, [currentRole, currentPersonProfileId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const [txRes, catRes, acctRes, ovRes] = await Promise.all([
      apiJson<ListResponse>(`/transactions?${qs.toString()}`),
      apiJson<{ categories: CategoryOption[] }>("/categories"),
      apiJson<{ accounts: AccountRow[] }>("/imports/accounts"),
      apiJson<{ ok: boolean; data: RecurringOverride[] }>("/recurring-overrides")
    ]);
    setData(txRes);
    setCategories(catRes.categories);
    setAccounts(acctRes.accounts);
    setRecurringOverrides(ovRes.ok ? ovRes.data : []);
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
    setSelectedAllIds(new Set());
    setBulkAllCategoryId("");
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

  const visibleTransactions = useMemo(() => {
    if (!recurringOnlyFilter || !data?.transactions) {
      return data?.transactions ?? [];
    }
    return data.transactions.filter((t) => findConfirmedOverride(t.merchant, recurringOverrides) !== null);
  }, [data?.transactions, recurringOnlyFilter, recurringOverrides]);

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

  const openTransferCountInSelection = useMemo(() => {
    if (!data) return 0;
    let count = 0;
    for (const t of data.transactions) {
      if (!selectedTxnIds.has(t.id)) continue;
      count += (t.openReviewItems ?? []).filter((i) => i.type === "transfer_ambiguity").length;
    }
    return count;
  }, [data, selectedTxnIds]);
  const allVisibleSelected = useMemo(
    () =>
      Boolean(visibleTransactions.length) &&
      visibleTransactions.every((t) => selectedTxnIds.has(t.id)),
    [visibleTransactions, selectedTxnIds]
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
    if (!visibleTransactions.length) {
      return;
    }
    if (allVisibleSelected) {
      setSelectedTxnIds(new Set());
    } else {
      setSelectedTxnIds(new Set(visibleTransactions.map((t) => t.id)));
    }
  }

  const allVisibleAllSelected = useMemo(
    () =>
      Boolean(visibleTransactions.length) &&
      visibleTransactions.every((t) => selectedAllIds.has(t.id)),
    [visibleTransactions, selectedAllIds]
  );

  function toggleSelectAllTab() {
    if (!visibleTransactions.length) return;
    if (allVisibleAllSelected) {
      setSelectedAllIds(new Set());
    } else {
      setSelectedAllIds(new Set(visibleTransactions.map((t) => t.id)));
    }
  }

  async function bulkAssignCategoryAll() {
    if (!bulkAllCategoryId) {
      setError("Choose a category.");
      return;
    }
    const ids = data ? [...selectedAllIds].filter((id) => data.transactions.some((t) => t.id === id)) : [];
    if (ids.length === 0) return;
    setError(null);
    setSavingBulkAll(true);
    try {
      const res = await apiJson<{ updated: number; skipped: number }>(
        "/transactions/bulk-category",
        { method: "POST", body: JSON.stringify({ ids, categoryId: bulkAllCategoryId }) }
      );
      if (res.skipped > 0) {
        setError(`Applied to ${res.updated}; ${res.skipped} row(s) could not be updated.`);
      }
      setSelectedAllIds(new Set());
      setBulkAllCategoryId("");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk category apply failed");
    } finally {
      setSavingBulkAll(false);
    }
  }

  async function bulkTrashSelectedAll() {
    const ids = data ? [...selectedAllIds].filter((id) => data.transactions.some((t) => t.id === id)) : [];
    if (!ids.length) return;
    setError(null);
    setSavingBulkAll(true);
    try {
      await apiJson<{ trashed: number; skipped: number }>(
        "/transactions/bulk-trash",
        { method: "POST", body: JSON.stringify({ ids }) }
      );
      setSelectedAllIds(new Set());
      setBulkAllCategoryId("");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk trash failed");
    } finally {
      setSavingBulkAll(false);
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

  async function fetchPatternPreview(pattern: string) {
    if (!pattern.trim()) {
      setPatternPreview(null);
      return;
    }
    setPatternPreviewLoading(true);
    try {
      const r = await apiJson<{ matched: number; descriptions: string[] }>("/resolution/pattern-preview", {
        method: "POST",
        body: JSON.stringify({ descriptionPattern: pattern.trim() })
      });
      setPatternPreview(r);
    } catch {
      setPatternPreview(null);
    } finally {
      setPatternPreviewLoading(false);
    }
  }

  async function applyPatternResolve() {
    if (!patternDraft.trim() || !patternCategoryId) return;
    setPatternResolving(true);
    setError(null);
    try {
      await apiJson<{ updated: number }>("/resolution/bulk-apply-by-pattern", {
        method: "POST",
        body: JSON.stringify({ descriptionPattern: patternDraft.trim(), categoryId: patternCategoryId })
      });
      setPatternResolveOpen(false);
      setPatternDraft("");
      setPatternCategoryId("");
      setPatternPreview(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk resolve by pattern failed");
    } finally {
      setPatternResolving(false);
    }
  }

  function startMemoEdit(id: string, currentMemo: string | null) {
    setEditingMemoId(id);
    setMemoDraft(currentMemo ?? "");
  }

  function cancelMemoEdit() {
    setEditingMemoId(null);
    setMemoDraft("");
  }

  async function saveMemo(id: string) {
    const memo = memoDraft.trim() || null;
    setEditingMemoId(null);
    setMemoDraft("");
    try {
      await apiJson(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify({ memo }) });
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, transactions: prev.transactions.map((t) => t.id === id ? { ...t, memo } : t) };
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save memo");
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

  async function confirmTransferItem(txnId: string, itemId: string, creditId: string) {
    setError(null);
    setSavingResolutionItemId(itemId);
    try {
      await apiJson(`/resolution/${itemId}/confirm-transfer`, {
        method: "POST",
        body: JSON.stringify({ creditId })
      });
      forgetReviewDetail(txnId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to confirm transfer pair");
    } finally {
      setSavingResolutionItemId(null);
    }
  }

  async function updateCategory(
    txnId: string,
    categoryId: string | null,
    ownerScope?: "household" | "person",
    ownerPersonProfileId?: string | null
  ): Promise<boolean> {
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
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update category");
      return false;
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
      amountMaxUrl !== "" ||
      recurringOnlyFilter
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
    <Stack gap="md">
      <Paper withBorder radius="md" p="md">
        <Group gap="xs" wrap="wrap">
          <Title order={1} size="h3" m={0}>Transactions</Title>
          <HelpIcon label="Posted rows from your household ledger. Needs review includes uncategorized rows, non-posted status, or open duplicate/transfer flags. Categories can be set by rules or manually here." />
          {sessionFilter ? (
            <Text c="dimmed" size="sm" ml={4}>
              Session: <code>{sessionFilter}</code>{" · "}
              <Link to={`/imports/${sessionFilter}`}>Workspace</Link>{" · "}
              <Link to="/transactions">All transactions</Link>
            </Text>
          ) : null}
          {fromDashboard && returnTo ? (
            <Text component={Link} to={returnTo} size="sm" ml="auto">← Dashboard</Text>
          ) : null}
        </Group>
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Group role="tablist" aria-label="Transaction scope" mb="sm">
          <Button
            type="button"
            role="tab"
            aria-selected={!needsReviewTab && !trashTab}
            variant={!needsReviewTab && !trashTab ? "filled" : "default"}
            onClick={() => setTab("all")}
          >
            All
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={needsReviewTab}
            variant={needsReviewTab ? "filled" : "default"}
            onClick={() => setTab("review")}
          >
            Needs review
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={trashTab}
            variant={trashTab ? "filled" : "default"}
            onClick={() => setTab("trash")}
          >
            Trash
          </Button>
        </Group>
        {needsReviewTab && (resolutionQueueSummary?.openDuplicateAmbiguityNotOnLedger ?? 0) > 0 ? (
          <Alert color="yellow" mb="sm">
            <strong>{resolutionQueueSummary?.openDuplicateAmbiguityNotOnLedger}</strong> near-duplicate item(s) flagged during import have no matching ledger row — they can be ignored or resolved by re-importing.
          </Alert>
        ) : null}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
          {needsReviewTab ? (
            <Box>
              <Text size="sm" mb={4}>Review type</Text>
              <MultiSelect
                placeholder="All types"
                aria-label="Filter by open review item types"
                data={resolutionTypeMultiData}
                value={resolutionTypes}
                onChange={(v) => setResolutionTypesInUrl(v as LedgerResolutionType[])}
                clearable
                searchable={false}
                size="sm"
              />
            </Box>
          ) : null}
            <TextInput
              label="Search"
              type="search"
              placeholder="Merchant or memo"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              autoComplete="off"
            />
          <Box>
            <Text size="sm" mb={4}>Account</Text>
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
          </Box>
          <TextInput
            label="From"
            type="date"
            value={dateFrom ?? ""}
            onChange={(e) => {
              mergeParams((n) => {
                n.set("offset", "0");
                const v = e.target.value;
                if (!v) n.delete("dateFrom");
                else n.set("dateFrom", v);
              });
            }}
          />
          <TextInput
            label="To"
            type="date"
            value={dateTo ?? ""}
            onChange={(e) => {
              mergeParams((n) => {
                n.set("offset", "0");
                const v = e.target.value;
                if (!v) n.delete("dateTo");
                else n.set("dateTo", v);
              });
            }}
          />
          <Box>
            <Text size="sm" mb={4}>Belongs-to</Text>
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
          </Box>
          <Box>
            <Text size="sm" mb={4}>Category</Text>
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
          </Box>
        </SimpleGrid>
        <Group mt="sm">
            {hasLedgerFilters ? (
              <Button
                type="button"
                variant="default"
                onClick={() => clearFilters()}
                title="Reset to default view"
              >
                Clear all filters
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={openAddModal}
              leftSection={<IconPlus size={15} />}
            >
              Add transaction
            </Button>
        </Group>
        <Group align="center" gap={6} mt="sm">
          <Button
            type="button"
            variant="subtle"
            aria-expanded={moreFiltersOpen}
            onClick={() => setMoreFiltersOpen((o) => !o)}
          >
            {moreFiltersOpen ? "Fewer filters ▴" : "More filters ▾"}
          </Button>
          <HelpIcon label="Search matches a substring in merchant + memo (multi-word = AND). Results sorted by date, newest first. Use amount min/max for signed amount range filtering." />
        </Group>
        {moreFiltersOpen ? (
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" mt="sm">
            <TextInput
              label="Amount min (signed)"
              type="number"
              step="any"
              placeholder="e.g. -500"
              value={amountMinDraft}
              onChange={(e) => setAmountMinDraft(e.target.value)}
            />
            <TextInput
              label="Amount max (signed)"
              type="number"
              step="any"
              placeholder="e.g. 100"
              value={amountMaxDraft}
              onChange={(e) => setAmountMaxDraft(e.target.value)}
            />
            <Checkbox
              label="Recurring only"
              checked={recurringOnlyFilter}
              onChange={(e) => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  if (e.target.checked) {
                    next.set("recurringOnly", "true");
                  } else {
                    next.delete("recurringOnly");
                  }
                  next.set("offset", "0");
                  return next;
                });
              }}
            />
            <Button type="button" onClick={() => commitAmountFilters()}>
              Apply amounts
            </Button>
          </SimpleGrid>
        ) : null}
      </Paper>

      <Paper withBorder radius="md" p="md">
        {hasLedgerFilters ? (
          <Text c="dimmed" size="sm">
            Active filters:
            {needsReviewTab ? <> [needs review]</> : null}
            {resolutionTypes.length > 0 ? (
              <>
                {" "}
                [review types:{" "}
                <Code>{resolutionTypes.map((t) => RESOLUTION_TYPE_LABELS[t]).join(", ")}</Code>]
              </>
            ) : null}
            {categoryName ? (
              <>
                {" "}
                [category: <Code>{categoryName}</Code>]
              </>
            ) : null}
            {uncategorizedOnly ? <> [uncategorized only]</> : null}
            {searchFromUrl ? (
              <>
                {" "}
                [search: <Code>{searchFromUrl}</Code>]
              </>
            ) : null}
            {dateFrom ? (
              <>
                {" "}
                [from <Code>{dateFrom}</Code>]
              </>
            ) : null}
            {dateTo ? (
              <>
                {" "}
                [to <Code>{dateTo}</Code>]
              </>
            ) : null}
            {accountName ? (
              <>
                {" "}
                [account: <Code>{accountName}</Code>]
              </>
            ) : null}
            {ownerScopeFilter ? (
              <>
                {" "}
                [belongs-to:{" "}
                <Code>{lookupLabel(belongsToGroups, ownerScopeFilter) ?? ownerScopeFilter}</Code>]
              </>
            ) : null}
            {ownerPersonProfileFilter ? (
              <>
                {" "}
                [belongs-to:{" "}
                <Code>{lookupLabel(belongsToGroups, `person:${ownerPersonProfileFilter}`) ?? ownerPersonProfileFilter}</Code>]
              </>
            ) : null}
            {amountMinUrl !== "" ? (
              <>
                {" "}
                [min <Code>{amountMinUrl}</Code>]
              </>
            ) : null}
            {amountMaxUrl !== "" ? (
              <>
                {" "}
                [max <Code>{amountMaxUrl}</Code>]
              </>
            ) : null}
            {recurringOnlyFilter ? <> [recurring only]</> : null}
            . <Button variant="subtle" size="compact-sm" onClick={() => clearFilters()}>Clear filters</Button>
          </Text>
        ) : null}
        {needsReviewTab ? (
          <Box pos="sticky" top={0} style={{ zIndex: 10 }} bg="var(--color-surface, #fff)" pb={4}>
            {selectedCount > 0 ? (
              <Group role="status" aria-live="polite" wrap="wrap" align="center">
                <Text c="dimmed" size="sm">
                  {selectedCount} row{selectedCount === 1 ? "" : "s"} selected
                </Text>
                <Box miw="12rem" maw="20rem">
                  <LedgerCategoryPicker
                    categories={categories}
                    value={bulkCategoryId || null}
                    disabled={savingBulk}
                    onChange={(id) => setBulkCategoryId(id ?? "")}
                    onCategoryCreated={() => void refreshCategories()}
                    ariaLabel="Bulk category"
                  />
                </Box>
                <Button type="button" disabled={savingBulk || !bulkCategoryId} onClick={() => void bulkAssignCategory()}>
                  Apply category
                </Button>
                {openFlagCountInSelection > 0 ? (
                  <Button
                    type="button"
                    variant="default"
                    disabled={savingBulk}
                    onClick={() => void bulkResolveFlags()}
                    title="Dismiss flags without pairing — use for coincidental amount matches that are NOT real transfers"
                  >
                    {openTransferCountInSelection > 0 ? `Not a transfer / dismiss (${openFlagCountInSelection})` : `Resolve flags (${openFlagCountInSelection})`}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="default"
                  disabled={savingBulk}
                  onClick={() => void bulkTrashSelected()}
                  title="Move selected rows to Trash"
                >
                  Move to trash
                </Button>
              </Group>
            ) : null}
          <Box mb="sm">
            {!patternResolveOpen ? (
              <Button type="button" variant="default" size="xs" onClick={() => setPatternResolveOpen(true)}>
                Resolve all by merchant name…
              </Button>
            ) : (
              <Paper withBorder radius="md" p="md" bg="var(--color-surface-alt, #f9fafb)">
                <Text fw={600} size="sm" mb="sm">Resolve all matching a merchant name</Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <TextInput
                    id="pattern-input"
                    label="Description contains (case-insensitive)"
                    type="text"
                    value={patternDraft}
                    placeholder="e.g. WHOLEFDS or Amazon"
                    onChange={(e) => {
                      setPatternDraft(e.target.value);
                      void fetchPatternPreview(e.target.value);
                    }}
                  />
                  <Box>
                    <Text size="xs" mb={4}>Assign category</Text>
                    <LedgerCategoryPicker
                      categories={categories}
                      value={patternCategoryId || null}
                      disabled={patternResolving}
                      onChange={(id) => setPatternCategoryId(id ?? "")}
                      ariaLabel="Pattern resolve category"
                    />
                  </Box>
                </SimpleGrid>
                {patternPreviewLoading ? (
                  <Text c="dimmed" mt="xs" size="xs">Checking…</Text>
                ) : patternPreview !== null ? (
                  <Text mt="xs" size="xs">
                    {patternPreview.matched === 0 ? (
                      <Text span c="dimmed">No open uncategorized items match this pattern.</Text>
                    ) : (
                      <>
                        <strong>{patternPreview.matched}</strong> item{patternPreview.matched === 1 ? "" : "s"} will be resolved.
                        {patternPreview.descriptions.length > 0 ? (
                          <Text span c="dimmed"> Examples: {patternPreview.descriptions.slice(0, 3).join(", ")}{patternPreview.descriptions.length > 3 ? "…" : ""}</Text>
                        ) : null}
                      </>
                    )}
                  </Text>
                ) : null}
                <Group gap="xs" mt="sm">
                  <Button
                    type="button"
                    disabled={patternResolving || !patternDraft.trim() || !patternCategoryId || patternPreview?.matched === 0}
                    onClick={() => void applyPatternResolve()}
                  >
                    {patternResolving ? "Resolving…" : "Apply to all"}
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    disabled={patternResolving}
                    onClick={() => {
                      setPatternResolveOpen(false);
                      setPatternDraft("");
                      setPatternCategoryId("");
                      setPatternPreview(null);
                    }}
                  >
                    Cancel
                  </Button>
                </Group>
              </Paper>
            )}
          </Box>
          </Box>
        ) : null}
        {!needsReviewTab && !trashTab && selectedAllIds.size > 0 ? (
          <Group role="status" aria-live="polite" wrap="wrap" align="center">
            <Text c="dimmed" size="sm">
              {selectedAllIds.size} row{selectedAllIds.size === 1 ? "" : "s"} selected
            </Text>
            <Box miw="12rem" maw="20rem">
              <LedgerCategoryPicker
                categories={categories}
                value={bulkAllCategoryId || null}
                disabled={savingBulkAll}
                onChange={(id) => setBulkAllCategoryId(id ?? "")}
                onCategoryCreated={() => void refreshCategories()}
                ariaLabel="Bulk category (all tab)"
              />
            </Box>
            <Button
              type="button"
              disabled={savingBulkAll || !bulkAllCategoryId}
              onClick={() => void bulkAssignCategoryAll()}
            >
              Apply category
            </Button>
            <Button
              type="button"
              disabled={savingBulkAll}
              onClick={() => void bulkTrashSelectedAll()}
            >
              Move to trash
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={savingBulkAll}
              onClick={() => { setSelectedAllIds(new Set()); setBulkAllCategoryId(""); }}
            >
              Clear selection
            </Button>
          </Group>
        ) : null}
        {trashTab && selectedTrashIds.size > 0 ? (
          <Group role="status" aria-live="polite" wrap="wrap" align="center">
            <Text c="dimmed" size="sm">
              {selectedTrashIds.size} row{selectedTrashIds.size === 1 ? "" : "s"} selected
            </Text>
            <Button
              type="button"
              disabled={savingTrash}
              onClick={() => void bulkRestoreSelected()}
            >
              Restore ({selectedTrashIds.size})
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={savingTrash}
              onClick={() => void bulkHardDeleteSelected()}
              title="Permanently delete selected rows — cannot be undone"
            >
              Delete permanently ({selectedTrashIds.size})
            </Button>
          </Group>
        ) : null}
        {error ? <Alert color="red">{error}</Alert> : null}
        {loading ? <Text c="dimmed">Loading…</Text> : null}
        {!loading && data ? (
          <>
            <Group gap="md" wrap="wrap" mb="xs">
              <Text c="dimmed" size="sm">
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
              </Text>
              <Group gap="xs">
                <Button type="button" variant="default" disabled={!canPageBack} onClick={() => updatePaging(pageOffset - pageLimit)}>
                  ← Previous
                </Button>
                <Button type="button" variant="default" disabled={!canPageForward} onClick={() => updatePaging(pageOffset + pageLimit)}>
                  Next →
                </Button>
              </Group>
              <NativeSelect
                label="Per page"
                size="xs"
                value={String(pageLimit)}
                data={[25, 50, 100, 200].map((n) => ({ value: String(n), label: String(n) }))}
                onChange={(e) => mergeParams((n) => { n.set("limit", e.target.value); n.set("offset", "0"); })}
              />
            </Group>
            {visibleTransactions.length === 0 ? (
              <Text c="dimmed">
                {sessionFilter
                  ? "No posted rows for this session yet. Either parse/canonicalize has not finished, or all lines were flagged (duplicates / review queue)."
                  : hasLedgerFilters
                    ? "No rows match these filters."
                    : trashTab
                      ? "Trash is empty."
                      : needsReviewTab
                        ? "Nothing needs review right now."
                        : "No transactions yet. Use New import in the header, then run import from the workspace, or add a row with + Add transaction."}
              </Text>
            ) : (
              <Table withTableBorder withColumnBorders withRowBorders striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      {needsReviewTab ? (
                        <Table.Th w="2.5rem">
                          <Checkbox
                            checked={allVisibleSelected}
                            onChange={() => toggleSelectAllVisible()}
                            disabled={savingBulk}
                            title="Select all rows on this page"
                            aria-label="Select all rows on this page"
                          />
                        </Table.Th>
                      ) : trashTab ? (
                        <Table.Th w="2.5rem">
                          <Checkbox
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
                        </Table.Th>
                      ) : (
                        <Table.Th w="2.5rem">
                          <Checkbox
                            checked={allVisibleAllSelected}
                            onChange={() => toggleSelectAllTab()}
                            disabled={savingBulkAll}
                            title="Select all rows on this page"
                            aria-label="Select all rows on this page"
                          />
                        </Table.Th>
                      )}
                      {needsReviewTab ? (
                        <Table.Th scope="col">
                          Context
                        </Table.Th>
                      ) : null}
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Account</Table.Th>
                      <Table.Th>Amount</Table.Th>
                      <Table.Th>Description</Table.Th>
                      <Table.Th w="5.5rem" ta="center">Recurring</Table.Th>
                      {needsReviewTab ? <Table.Th>Why</Table.Th> : null}
                      {needsReviewTab ? <Table.Th>Session</Table.Th> : null}
                      {!trashTab ? <Table.Th>Belongs-to</Table.Th> : null}
                      <Table.Th>Category</Table.Th>
                      <Table.Th w={1}></Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleTransactions.map((t) => {
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
                      const colSpan = needsReviewTab ? 12 : trashTab ? 8 : 11;
                      const confirmedRecurringOverride = findConfirmedOverride(t.merchant, recurringOverrides);
                      return (
                        <Fragment key={t.id}>
                          <Table.Tr>
                            {needsReviewTab ? (
                              <Table.Td>
                                <Checkbox
                                  checked={selectedTxnIds.has(t.id)}
                                  onChange={() => toggleTxnSelected(t.id)}
                                  disabled={savingBulk}
                                  aria-label={`Select row ${desc}`}
                                />
                              </Table.Td>
                            ) : trashTab ? (
                              <Table.Td>
                                <Checkbox
                                  checked={selectedTrashIds.has(t.id)}
                                  onChange={() => setSelectedTrashIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                                    return next;
                                  })}
                                  disabled={savingTrash}
                                  aria-label={`Select row ${desc}`}
                                />
                              </Table.Td>
                            ) : (
                              <Table.Td>
                                <Checkbox
                                  checked={selectedAllIds.has(t.id)}
                                  onChange={() => setSelectedAllIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                                    return next;
                                  })}
                                  disabled={savingBulkAll}
                                  aria-label={`Select row ${desc}`}
                                />
                              </Table.Td>
                            )}
                            {needsReviewTab ? (
                              <Table.Td>
                                <Button
                                  type="button"
                                  variant="subtle"
                                  size="compact-sm"
                                  aria-expanded={expanded}
                                  onClick={() => toggleTxnExpand(t.id)}
                                >
                                  {expanded ? "Hide" : "Show"}
                                </Button>
                              </Table.Td>
                            ) : null}
                            <Table.Td>{t.txnDate}</Table.Td>
                            <Table.Td>{accountLabel}</Table.Td>
                            <Table.Td>
                              <Group gap={5} wrap="nowrap">
                                <Text>{formatMoney(t.amount, t.direction)}</Text>
                                {t.status !== "posted" ? <StatusBadge status={t.status} /> : null}
                              </Group>
                            </Table.Td>
                            <Table.Td>
                              <Text>{t.merchant || "—"}</Text>
                              {trashTab ? (
                                t.memo ? (
                                  <Text fs="italic" size="sm">{t.memo}</Text>
                                ) : null
                              ) : editingMemoId === t.id ? (
                                <Group
                                  gap="xs"
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void saveMemo(t.id);
                                    if (e.key === "Escape") cancelMemoEdit();
                                  }}
                                >
                                  <TextInput
                                    value={memoDraft}
                                    onChange={(e) => setMemoDraft(e.target.value)}
                                    placeholder="Add memo…"
                                    autoFocus
                                    maxLength={500}
                                  />
                                  <ActionIcon type="button" onClick={() => void saveMemo(t.id)} title="Save" variant="default">✓</ActionIcon>
                                  <ActionIcon type="button" onClick={cancelMemoEdit} title="Cancel" variant="default">✕</ActionIcon>
                                </Group>
                              ) : (
                                <Group gap="xs" wrap="nowrap">
                                  <Text fs={t.memo ? "italic" : "normal"} size="sm">
                                    {t.memo ?? "Add memo…"}
                                  </Text>
                                  <ActionIcon
                                    type="button"
                                    onClick={() => startMemoEdit(t.id, t.memo)}
                                    title={t.memo ? "Edit memo" : "Add memo"}
                                    variant="subtle"
                                    size="sm"
                                  >
                                    <IconPencil size={11} />
                                  </ActionIcon>
                                </Group>
                              )}
                            </Table.Td>
                            <Table.Td ta="center">
                              {t.status === "posted" && t.direction === "debit" ? (
                                <Button
                                  type="button"
                                  title={confirmedRecurringOverride ? `Recurring: ${confirmedRecurringOverride.merchantKey}` : "Mark as recurring"}
                                  onClick={() => setRecurringModalTxn(t)}
                                  variant="subtle"
                                  color={confirmedRecurringOverride ? "blue" : "gray"}
                                  size="compact-xs"
                                  aria-label={
                                    confirmedRecurringOverride
                                      ? `Edit recurring override for ${t.merchant ?? ""}`
                                      : `Mark ${t.merchant ?? ""} as recurring`
                                  }
                                >
                                  {confirmedRecurringOverride ? "●" : "○"}
                                </Button>
                              ) : null}
                            </Table.Td>
                            {needsReviewTab ? (
                              <Table.Td><Text title={reasons}>{reasons}</Text></Table.Td>
                            ) : null}
                            {needsReviewTab ? (
                              <Table.Td>
                                {t.importSessionId ? (
                                  <Text
                                    component={Link}
                                    to={`/transactions?needsReview=true&sessionId=${t.importSessionId}`}
                                    c="dimmed"
                                    size="sm"
                                  >
                                    Import session
                                  </Text>
                                ) : (
                                  <Text c="dimmed">—</Text>
                                )}
                              </Table.Td>
                            ) : null}
                            {!trashTab ? (
                              <Table.Td miw="12rem">
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
                              </Table.Td>
                            ) : null}
                            <Table.Td>
                              {trashTab ? (
                                <Text c="dimmed" size="sm">{t.categoryName ?? "—"}</Text>
                              ) : (
                                <>
                                  <LedgerCategoryPicker
                                    categories={categories}
                                    value={t.categoryId}
                                    disabled={savingId === t.id || savingBulk}
                                    onChange={(v) => void (async () => {
                                      const ok = await updateCategory(t.id, v, t.ownerScope, t.ownerPersonProfileId);
                                      if (ok && v && v !== t.categoryId && (currentRole === "owner" || currentRole === "admin")) {
                                        setRuleFromLedgerConfirm({ txnId: t.id, categoryId: v });
                                      }
                                    })()}
                                    ariaLabel={`Category for ${desc}`}
                                  />
                                  {needsReviewTab ? <CategoryClassificationHint meta={t.classificationMeta ?? null} /> : null}
                                </>
                              )}
                            </Table.Td>
                            <Table.Td>
                              {trashTab ? (
                                <Group gap={4} wrap="nowrap">
                                  <ActionIcon
                                    type="button"
                                    disabled={savingTrash}
                                    onClick={() => void restoreSingle(t.id)}
                                    title="Restore"
                                    variant="default"
                                    color="green"
                                  >
                                    <IconArrowBackUp size={14} />
                                  </ActionIcon>
                                  <ActionIcon
                                    type="button"
                                    disabled={savingTrash}
                                    onClick={() => void hardDeleteSingle(t.id)}
                                    title="Permanently delete — cannot be undone"
                                    variant="default"
                                    color="red"
                                  >
                                    <IconTrash size={14} />
                                  </ActionIcon>
                                </Group>
                              ) : (
                                <ActionIcon
                                  type="button"
                                  disabled={savingId === t.id || savingBulk}
                                  onClick={() => void trashSingle(t.id)}
                                  title="Move to Trash"
                                  variant="default"
                                >
                                  <IconTrash size={14} />
                                </ActionIcon>
                              )}
                            </Table.Td>
                          </Table.Tr>
                          {needsReviewTab && expanded ? (
                            <Table.Tr key={`${t.id}-ctx`}>
                              <Table.Td colSpan={colSpan}>
                                <Stack gap="xs">
                                  {detailLoading ? <Text c="dimmed">Loading review context…</Text> : null}
                                  {detailError ? <Alert color="red">{detailError}</Alert> : null}
                                  {!detailLoading && !detailError && detailItems && detailItems.length === 0 ? (
                                    <Text c="dimmed" size="sm">
                                      This row is here because it has no category. Assign one using the picker
                                      in the row above to move it out of Needs review.
                                    </Text>
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
                                          <Paper key={it.id} withBorder radius="sm" p="sm">
                                            <Group gap="xs">
                                              <Text fw={700}>{formatResolutionTypeLabel(it.type)}</Text>
                                              <Text c="dimmed">
                                                {it.status}
                                              </Text>
                                              <Text c="dimmed">
                                                · {it.createdAt}
                                              </Text>
                                            </Group>
                                            <Text c="dimmed" mt={4} mb={2}>
                                              <Text span c="dimmed">File:</Text>{" "}
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
                                            </Text>
                                            <Text c="dimmed" mb={4}>
                                              <Text span c="dimmed">Raw preview:</Text>{" "}
                                              {it.context.raw ? (
                                                <>
                                                  {it.context.raw.txnDate ?? "—"} ·{" "}
                                                  {formatSignedMoneyRaw(it.context.raw.amount)} ·{" "}
                                                  {it.context.raw.description ?? "—"}
                                                </>
                                              ) : (
                                                "—"
                                              )}
                                            </Text>
                                            <Text size="sm" mb={4}>{summary}</Text>
                                            {explainSource || explainConf || explainRule || explainReason ? (
                                              <Group gap="xs" wrap="wrap">
                                                {explainSource ? (
                                                  <Badge variant="light">{explainSource}</Badge>
                                                ) : null}
                                                {explainConf ? (
                                                  <Badge variant="light">{explainConf}</Badge>
                                                ) : null}
                                                {explainRule ? (
                                                  <Badge variant="light">
                                                    ID {explainRule.slice(0, 8)}
                                                  </Badge>
                                                ) : null}
                                                {explainReason ? (
                                                  <Text c="dimmed" size="sm">{explainReason}</Text>
                                                ) : null}
                                              </Group>
                                            ) : null}
                                            {it.context.classification?.ai ? (
                                              <Text c="dimmed" mt="xs" size="xs" lh={1.4}>
                                                Legacy AI suggestion metadata is present on this ticket (older
                                                canonicalize). New imports use rules-only classification.
                                              </Text>
                                            ) : null}
                                            <Group mt="sm" wrap="wrap" align="flex-start">
                                              {it.type === "unknown_category" ? (
                                                <Box miw="12rem" maw="16rem">
                                                  <Text c="dimmed" size="xs">
                                                    Set category
                                                  </Text>
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
                                                        // Offer rule creation once per unique merchant in this session.
                                                        // If the user already saw the dialog for "WHOLEFDS" and declined
                                                        // or created a rule, the next 29 WHOLEFDS items won't re-prompt.
                                                        if (currentRole === "owner" || currentRole === "admin") {
                                                          const merchantKey = (t.merchant || t.memo || "").toLowerCase().trim();
                                                          if (merchantKey && !ruleOfferedMerchants.has(merchantKey)) {
                                                            setRuleOfferedMerchants((prev) => new Set(prev).add(merchantKey));
                                                            setRuleFromLedgerConfirm({ txnId: t.id, categoryId });
                                                          }
                                                        }
                                                      } catch (e: unknown) {
                                                        setError(e instanceof Error ? e.message : "Failed to set category");
                                                      } finally {
                                                        setSavingId(null);
                                                      }
                                                    }}
                                                    ariaLabel={`Set category for transaction ${t.id}`}
                                                  />
                                                </Box>
                                              ) : null}
                                              {it.type === "transfer_ambiguity" ? (
                                                <Stack gap={6} w="100%">
                                                  {it.transferCandidates != null && it.transferCandidates.length > 0 ? (
                                                    <Stack gap={4}>
                                                      {it.transferCandidates.map((c) => {
                                                        const rawDesc = c.description ?? "";
                                                        const descShort =
                                                          rawDesc.length > 40 ? `${rawDesc.slice(0, 40)}…` : rawDesc;
                                                        const amt = `$${Number(c.amount).toLocaleString(undefined, {
                                                          minimumFractionDigits: 2,
                                                          maximumFractionDigits: 2
                                                        })}`;
                                                        return (
                                                          <Group
                                                            key={c.id}
                                                            gap="xs"
                                                            wrap="nowrap"
                                                            justify="space-between"
                                                            align="center"
                                                          >
                                                            <Group gap={6} wrap="wrap" style={{ flex: 1, minWidth: 0 }}>
                                                              <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                                                                {c.txnDate}
                                                              </Text>
                                                              <Text size="xs" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
                                                                {amt}
                                                              </Text>
                                                              <Text size="xs">{c.accountName}</Text>
                                                              <Text size="xs" c="dimmed" title={rawDesc || undefined}>
                                                                {descShort}
                                                              </Text>
                                                            </Group>
                                                            <Button
                                                              type="button"
                                                              variant="light"
                                                              size="xs"
                                                              disabled={busy || savingResolutionItemId === it.id}
                                                              title="Link this transaction with the other leg as a transfer pair"
                                                              onClick={() => void confirmTransferItem(t.id, it.id, c.id)}
                                                            >
                                                              {savingResolutionItemId === it.id ? "Confirming…" : "Confirm as Transfer"}
                                                            </Button>
                                                          </Group>
                                                        );
                                                      })}
                                                    </Stack>
                                                  ) : it.transferCandidates != null ? (
                                                    <Text c="dimmed" size="xs">
                                                      No matching candidates — may resolve on next import.
                                                    </Text>
                                                  ) : null}
                                                </Stack>
                                              ) : null}
                                              <Group gap="xs" wrap="wrap">
                                                {it.status !== "resolved" ? (
                                                  <>
                                                    <Button
                                                      type="button"
                                                      variant="default"
                                                      disabled={busy || savingResolutionItemId === it.id}
                                                      title={it.type === "transfer_ambiguity" ? "Dismiss without pairing — use when this is NOT a real transfer" : undefined}
                                                      onClick={() =>
                                                        void patchResolutionItemStatus(t.id, it.id, "resolved")
                                                      }
                                                    >
                                                      {it.type === "transfer_ambiguity" ? "Not a transfer" : "Resolve flag"}
                                                    </Button>
                                                  </>
                                                ) : (
                                                  <Button
                                                    type="button"
                                                    variant="default"
                                                    disabled={busy || savingResolutionItemId === it.id}
                                                    onClick={() => void patchResolutionItemStatus(t.id, it.id, "open")}
                                                  >
                                                    Reopen
                                                  </Button>
                                                )}
                                                <Button
                                                  type="button"
                                                  variant="default"
                                                  disabled={busy}
                                                  onClick={() => void trashSingle(t.id)}
                                                  title="Move this transaction to Trash"
                                                >
                                                  Move to trash
                                                </Button>
                                              </Group>
                                            </Group>
                                          </Paper>
                                        );
                                      })
                                    : null}
                                </Stack>
                              </Table.Td>
                            </Table.Tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </Table.Tbody>
                </Table>
            )}
          </>
        ) : null}
      </Paper>

      <Modal opened={addOpen} onClose={() => setAddOpen(false)} title="Add transaction" centered>
        <Stack gap="sm">
          <Text c="dimmed" size="sm">Choose money direction first, then enter a positive amount.</Text>
          {addError ? <Alert color="red">{addError}</Alert> : null}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <NativeSelect
              ref={addFirstFieldRef}
              label="Account"
              value={addAccountId}
              onChange={(e) => setAddAccountId(e.target.value)}
              data={[
                { value: "", label: "Select…", disabled: true },
                ...accounts.map((a) => ({ value: a.id, label: formatAccountForSelect(a) }))
              ]}
            />
            <TextInput label="Date" type="date" value={addTxnDate} onChange={(e) => setAddTxnDate(e.target.value)} />
            <Box>
              <Text size="sm" mb={6}>Money flow</Text>
              <Radio.Group value={addDirection} onChange={(v) => setAddDirection(v as "credit" | "debit")} name="add-direction">
                <Group gap="md">
                  <Radio value="credit" label="Money In" />
                  <Radio value="debit" label="Money Out" />
                </Group>
              </Radio.Group>
            </Box>
            <TextInput
              label="Amount"
              type="number"
              step="any"
              min="0"
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
              placeholder="42.50"
            />
          </SimpleGrid>
          <TextInput label="Description" value={addMerchant} onChange={(e) => setAddMerchant(e.target.value)} placeholder="Merchant or payee" />
          <Box>
            <Text size="sm" mb={6}>Belongs-to</Text>
            <HierarchicalSearchPicker
              value={addBelongsTo || null}
              onChange={(v) => setAddBelongsTo((v ?? "") as BelongsToFilterValue)}
              groups={belongsToGroups}
              placeholder="Choose belongs-to..."
              ariaLabel="Belongs-to for new transaction"
            />
          </Box>
          <Box>
            <Text size="sm" mb={6}>Category</Text>
            <LedgerCategoryPicker
              categories={categories}
              value={addCategoryId}
              disabled={addSaving}
              onChange={(v) => setAddCategoryId(v)}
              ariaLabel="Category for new transaction"
            />
          </Box>
          <Group justify="flex-end">
            <Button type="button" variant="default" disabled={addSaving} onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={addSaving} onClick={() => void submitManual()}>
              {addSaving ? "Saving…" : "Save"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {recurringModalTxn ? (
        <RecurringTagModal
          opened={recurringModalTxn !== null}
          onClose={() => setRecurringModalTxn(null)}
          txnMerchant={recurringModalTxn.merchant?.toLowerCase().trim() ?? ""}
          txnAmount={Math.abs(recurringModalTxn.amount)}
          allTxns={data?.transactions ?? []}
          existingOverride={findConfirmedOverride(recurringModalTxn.merchant, recurringOverrides)}
          onConfirm={async ({ merchantKey, amountAnchor, amountTolerancePct }) => {
            const postRes = await apiFetch("/recurring-overrides", {
              method: "POST",
              body: JSON.stringify({
                merchantKey,
                verdict: "confirmed",
                amountAnchor,
                amountTolerancePct
              })
            });
            if (!postRes.ok) {
              throw new Error(`Failed to save recurring override (HTTP ${postRes.status})`);
            }
            const updated = await apiJson<{ ok: boolean; data: RecurringOverride[] }>("/recurring-overrides");
            if (updated.ok) {
              setRecurringOverrides(updated.data);
            }
            setRecurringModalTxn(null);
          }}
          onRemove={async () => {
            const existing = findConfirmedOverride(recurringModalTxn.merchant, recurringOverrides);
            if (existing) {
              const delRes = await apiFetch(`/recurring-overrides/${existing.id}`, { method: "DELETE" });
              if (!delRes.ok) throw new Error(`Failed to remove recurring override (HTTP ${delRes.status})`);
              setRecurringOverrides((prev) => prev.filter((o) => o.id !== existing.id));
            }
            setRecurringModalTxn(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        opened={ruleFromLedgerConfirm !== null}
        title="Create classification rule?"
        message={`Create a household rule so future transactions with similar descriptions are automatically categorized the same way? Uses a contains match on the normalized description.`}
        confirmLabel="Create rule"
        cancelLabel="Not now"
        closeOnClickOutside
        onClose={() => setRuleFromLedgerConfirm(null)}
        onConfirm={handleCreateRuleFromLedger}
      />
    </Stack>
  );
}
