import { IconChevronDown, IconChevronRight, IconPencil } from "@tabler/icons-react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CurrencyInput } from "../components/CurrencyInput";
import { HelpIcon } from "../components/HelpIcon";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";
import { FS_CLAY, FS_FOREST, FS_SAGE } from "../theme/chartPalette";

type BalanceSheetAccountRow = {
  financialAccountId: string;
  institution: string;
  accountMask: string | null;
  type: string;
  currency: string;
  /** Present when API returns F-1 enrichment; missing balances bucket as uncategorized in liquidity breakdown. */
  liquidity?: "liquid" | "semi_liquid" | "restricted" | null;
  side: "asset" | "liability";
  balance: number | null;
  balanceAsOf: string | null;
  balanceSource: "manual" | "import" | null;
  importFileId: string | null;
};

type PropertySheetRow = {
  propertyId: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  propertyUse: "primary" | "rental" | "vacation" | null;
  marketValue: number | null;
  marketValueAsOf: string | null;
  linkedMortgageAccountId: string | null;
  linkedMortgageBalance: number | null;
  linkedMortgageAsOf: string | null;
};

type BalanceSheetResponse = {
  asOf: string;
  assets: BalanceSheetAccountRow[];
  liabilities: BalanceSheetAccountRow[];
  properties?: PropertySheetRow[];
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

type BalanceSheetHistoryAccountSlice = {
  financialAccountId: string;
  side: "asset" | "liability";
  balance: number | null;
  balanceAsOf: string | null;
};

type BalanceSheetHistoryResponse = {
  from: string;
  to: string;
  interval: "month" | "quarter" | "week" | "day";
  points: Array<{
    asOf: string;
    totals: {
      assets: number | null;
      liabilities: number | null;
      netWorth: number | null;
    };
    accounts?: BalanceSheetHistoryAccountSlice[];
  }>;
};

type PeriodPreset = "3m" | "6m" | "12m" | "2y" | "3y" | "ytd" | "custom";

type BelongsToFilter = "" | "household" | `person:${string}`;

const HISTORY_DEBOUNCE_MS = 280;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function rangeForPreset(preset: PeriodPreset, custom: { from: string; to: string } | null): { from: string; to: string } {
  const to = new Date();
  const toStr = to.toISOString().slice(0, 10);
  if (preset === "custom" && custom) {
    return { from: custom.from, to: custom.to };
  }
  if (preset === "ytd") {
    return { from: `${to.getUTCFullYear()}-01-01`, to: toStr };
  }
  const months = preset === "3m" ? 3 : preset === "6m" ? 6 : preset === "2y" ? 24 : preset === "3y" ? 36 : 12;
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - months, to.getUTCDate()));
  return { from: from.toISOString().slice(0, 10), to: toStr };
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return "—";
  }
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


/** Display-only: liabilities negative, assets positive (matches net-worth intuition). */
function signedDisplayBalance(row: Pick<BalanceSheetAccountRow, "side" | "balance">): number | null {
  if (row.balance == null || !Number.isFinite(row.balance)) {
    return null;
  }
  return row.side === "liability" ? -row.balance : row.balance;
}

function storageAmountFromInput(raw: number, side: "asset" | "liability"): number {
  if (side === "asset") {
    return raw;
  }
  return Math.abs(raw);
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit Card",
  investment: "Investment",
  retirement: "Retirement",
  health: "Health",
  education: "Education",
  loan: "Loan",
  payslip: "Payslip",
};

function formatAccountType(type: string): string {
  return ACCOUNT_TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function propertyLabel(row: PropertySheetRow): string {
  const parts: string[] = [];
  if (row.addressLine1) {
    parts.push(row.addressLine1);
  }
  if (row.city) {
    parts.push(row.city);
  }
  if (row.state) {
    parts.push(row.state);
  }
  return parts.length > 0 ? parts.join(", ") : "Unnamed property";
}

function propertyUseLabel(use: PropertySheetRow["propertyUse"]): string {
  if (use === "primary") {
    return "Primary residence";
  }
  if (use === "rental") {
    return "Rental";
  }
  if (use === "vacation") {
    return "Vacation";
  }
  return "Real estate";
}

function appendOwnerQuery(qs: URLSearchParams, belongsTo: BelongsToFilter): void {
  if (belongsTo === "household") {
    qs.set("ownerScope", "household");
  } else if (belongsTo.startsWith("person:")) {
    const id = belongsTo.slice("person:".length);
    if (id) {
      qs.set("ownerScope", "person");
      qs.set("ownerPersonProfileId", id);
    }
  }
}


export function NetWorthPage() {
  const token = useAuthToken();
  const [tableAsOf, setTableAsOf] = useState(() => todayIso());
  const [data, setData] = useState<BalanceSheetResponse | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [ownerProfiles, setOwnerProfiles] = useState<Array<{ id: string; label: string }>>([]);
  const [belongsTo, setBelongsTo] = useState<BelongsToFilter>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("3m");
  const [customFrom, setCustomFrom] = useState(() => {
    const t = new Date();
    const from = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 3, t.getUTCDate()));
    return from.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => todayIso());

  const histRange = useMemo(() => {
    if (periodPreset === "custom") {
      return { from: customFrom, to: customTo };
    }
    return rangeForPreset(periodPreset, null);
  }, [periodPreset, customFrom, customTo]);

  const [histInterval, setHistInterval] = useState<"month" | "quarter" | "week" | "day">("month");
  const [historyData, setHistoryData] = useState<BalanceSheetHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedAccountIds, setExpandedAccountIds] = useState<Set<string>>(new Set());
  const [accountHistoryById, setAccountHistoryById] = useState<Map<string, Array<{ month: string; balance: number }>>>(
    new Map()
  );
  const [accountHistoryLoadingIds, setAccountHistoryLoadingIds] = useState<Set<string>>(new Set());
  const [accountHistoryFailedIds, setAccountHistoryFailedIds] = useState<Set<string>>(new Set());

  const [expandedPropertyIds, setExpandedPropertyIds] = useState<Set<string>>(new Set());
  const [propertyHistoryById, setPropertyHistoryById] = useState<Map<string, Array<{ asOf: string; value: number }>>>(
    new Map()
  );
  const [propertyHistoryLoadingIds, setPropertyHistoryLoadingIds] = useState<Set<string>>(new Set());
  const [propertyHistoryFailedIds, setPropertyHistoryFailedIds] = useState<Set<string>>(new Set());
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [editPropertyAmount, setEditPropertyAmount] = useState("");
  const [editPropertyAsOf, setEditPropertyAsOf] = useState("");
  const [propertyRowSaving, setPropertyRowSaving] = useState(false);
  const [propertyRowSaveError, setPropertyRowSaveError] = useState<string | null>(null);
  const [propertyRowRetrieving, setPropertyRowRetrieving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editAsOf, setEditAsOf] = useState("");
  const [rowSaveError, setRowSaveError] = useState<string | null>(null);
  const [rowSaving, setRowSaving] = useState(false);

  const [bulkAsOfDraft, setBulkAsOfDraft] = useState(() => tableAsOf);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const [editBaseline, setEditBaseline] = useState<{ amount: string; asOf: string } | null>(null);
  const editDirty = Boolean(
    editingId &&
      editBaseline &&
      (editAmount.trim() !== editBaseline.amount.trim() || editAsOf !== editBaseline.asOf)
  );

  const belongsToGroups = useMemo<HierarchicalPickerGroup[]>(
    () => [
      {
        group: "Household",
        items: [{ value: "household", label: "Household", searchText: "household" }]
      },
      {
        group: "Members",
        items: ownerProfiles.map((p) => ({
          value: `person:${p.id}`,
          label: `Household > ${p.label}`,
          displayLabel: p.label,
          searchText: p.label
        }))
      }
    ],
    [ownerProfiles]
  );

  const loadSheet = useCallback(async () => {
    const qs = new URLSearchParams({ asOf: tableAsOf });
    appendOwnerQuery(qs, belongsTo);
    const res = await apiJson<BalanceSheetResponse>(`/reports/balance-sheet?${qs.toString()}`);
    setData(res);
  }, [tableAsOf, belongsTo]);

  const loadHistoryImmediate = useCallback(async () => {
    const qs = new URLSearchParams({
      from: histRange.from,
      to: histRange.to,
      interval: histInterval
    });
    appendOwnerQuery(qs, belongsTo);
    const res = await apiJson<BalanceSheetHistoryResponse>(`/reports/balance-sheet/history?${qs.toString()}`);
    setHistoryData(res);
  }, [histRange.from, histRange.to, histInterval, belongsTo]);

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
    if (!token) {
      return;
    }
    void Promise.all([
      apiJson<{ members: Array<{ id: string; fullName: string; relationship?: string }> }>("/household/members").catch(
        () => ({ members: [] })
      ),
      apiJson<{ profile: { id: string; fullName: string } }>("/household/profile").catch(
        () => ({ profile: { id: "", fullName: "" } })
      )
    ]).then(([membersRes, profileRes]) => {
      const members = membersRes.members ?? [];
      const mapped = members.map((m) => ({
        id: m.id,
        label: `${m.fullName}${m.relationship ? ` (${m.relationship})` : ""}`.trim() || m.id
      }));
      const pid = profileRes.profile?.id;
      if (pid && !mapped.some((m) => m.id === pid)) {
        mapped.unshift({ id: pid, label: profileRes.profile.fullName || "Me" });
      }
      setOwnerProfiles(mapped);
    });
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    void loadSheet()
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : "Failed to load balance sheet");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, loadSheet]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const t = window.setTimeout(() => {
      setHistoryLoading(true);
      setHistoryError(null);
      void loadHistoryImmediate()
        .catch((e: unknown) => {
          setHistoryError(e instanceof Error ? e.message : "Failed to load history");
          setHistoryData(null);
        })
        .finally(() => setHistoryLoading(false));
    }, HISTORY_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [token, loadHistoryImmediate]);

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

  const allTableRows = useMemo(() => {
    const a = data?.assets ?? [];
    const l = data?.liabilities ?? [];
    return [...a, ...l];
  }, [data?.assets, data?.liabilities]);

  const topAssets = useMemo(
    () =>
      [...(data?.assets ?? [])]
        .filter((r) => r.balance != null)
        .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
        .slice(0, 5)
        .map((r) => ({
          id: r.financialAccountId,
          name: `${r.institution}${r.accountMask ? ` · ${r.accountMask}` : ""}`,
          balance: r.balance ?? 0
        })),
    [data?.assets]
  );

  const topLiabilities = useMemo(
    () =>
      [...(data?.liabilities ?? [])]
        .filter((r) => r.balance != null)
        .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
        .slice(0, 5)
        .map((r) => ({
          id: r.financialAccountId,
          name: `${r.institution}${r.accountMask ? ` · ${r.accountMask}` : ""}`,
          balance: r.balance ?? 0
        })),
    [data?.liabilities]
  );

  const liquidityTiers = useMemo(() => {
    if (!data) {
      return null;
    }
    let liquid = 0;
    let semiLiquid = 0;
    let restricted = 0;
    let uncategorized = 0;
    let hasAnyTagged = false;
    for (const r of data.assets ?? []) {
      if (r.balance == null || !Number.isFinite(r.balance)) {
        continue;
      }
      const liq = r.liquidity;
      if (liq === "liquid") {
        liquid += r.balance;
        hasAnyTagged = true;
      } else if (liq === "semi_liquid") {
        semiLiquid += r.balance;
        hasAnyTagged = true;
      } else if (liq === "restricted") {
        restricted += r.balance;
        hasAnyTagged = true;
      } else {
        uncategorized += r.balance;
      }
    }
    for (const p of data.properties ?? []) {
      if (p.marketValue == null || !Number.isFinite(p.marketValue)) {
        continue;
      }
      restricted += p.marketValue;
      hasAnyTagged = true;
    }
    if (!hasAnyTagged && uncategorized === 0) {
      return null;
    }
    return { liquid, semiLiquid, restricted, uncategorized, hasUncategorized: uncategorized > 0 };
  }, [data]);

  useEffect(() => {
    setBulkAsOfDraft(tableAsOf);
  }, [tableAsOf]);

  const reloadAll = useCallback(async () => {
    setLoadError(null);
    setHistoryError(null);
    setLoading(true);
    setHistoryLoading(true);
    try {
      await loadSheet();
      await loadHistoryImmediate();
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Reload failed");
    } finally {
      setLoading(false);
      setHistoryLoading(false);
    }
  }, [loadSheet, loadHistoryImmediate]);

  const startEdit = useCallback((row: BalanceSheetAccountRow) => {
    setEditingId(row.financialAccountId);
    setRowSaveError(null);
    const stored = row.balance;
    const display = signedDisplayBalance(row);
    const amt = stored == null ? "" : String(display ?? "");
    const asOf = row.balanceAsOf ?? tableAsOf;
    setEditAmount(amt);
    setEditAsOf(asOf);
    setEditBaseline({ amount: amt, asOf });
  }, [tableAsOf]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditAmount("");
    setEditAsOf("");
    setEditBaseline(null);
    setRowSaveError(null);
  }, []);

  const saveRow = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!editingId) {
        return;
      }
      const row = allTableRows.find((r) => r.financialAccountId === editingId);
      if (!row) {
        return;
      }
      const amountParsed = Number(String(editAmount).replace(/,/g, ""));
      if (!editAsOf || !Number.isFinite(amountParsed)) {
        setRowSaveError("Enter a valid amount and as-of date.");
        return;
      }
      const currency = accounts.find((a) => a.id === editingId)?.currency ?? row.currency ?? "USD";
      setRowSaving(true);
      setRowSaveError(null);
      try {
        await apiJson<{ id: string }>("/reports/balance-sheet/manual", {
          method: "POST",
          body: JSON.stringify({
            financialAccountId: editingId,
            asOfDate: editAsOf,
            amount: storageAmountFromInput(amountParsed, row.side),
            currency
          })
        });
        cancelEdit();
        await loadSheet();
        await loadHistoryImmediate();
      } catch (err: unknown) {
        setRowSaveError(err instanceof Error ? err.message : "Could not save balance");
      } finally {
        setRowSaving(false);
      }
    },
    [accounts, allTableRows, cancelEdit, editAmount, editAsOf, editingId, loadHistoryImmediate, loadSheet]
  );

  const runBulkAsOf = useCallback(async () => {
    if (!bulkAsOfDraft || !data) {
      return;
    }
    setBulkWorking(true);
    setBulkSummary(null);
    let okCount = 0;
    let fail = 0;
    let skipped = 0;
    for (const row of allTableRows) {
      if (row.balance == null) {
        skipped += 1;
        continue;
      }
      try {
        await apiJson("/reports/balance-sheet/manual", {
          method: "POST",
          body: JSON.stringify({
            financialAccountId: row.financialAccountId,
            asOfDate: bulkAsOfDraft,
            amount: row.balance,
            currency: row.currency
          })
        });
        okCount += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkWorking(false);
    setBulkSummary(`Updated ${okCount} account(s). Failed: ${fail}. Skipped (no balance): ${skipped}.`);
    await loadSheet();
    await loadHistoryImmediate();
  }, [allTableRows, bulkAsOfDraft, data, loadHistoryImmediate, loadSheet]);

  const loadAccountHistory = useCallback(async (accountId: string) => {
    if (accountHistoryById.has(accountId) || accountHistoryLoadingIds.has(accountId)) {
      return;
    }
    // Use a 12-month lookback window for per-account mini-charts.
    const to = todayIso();
    const fromDate = new Date();
    fromDate.setUTCMonth(fromDate.getUTCMonth() - 12);
    const from = fromDate.toISOString().slice(0, 10);

    setAccountHistoryLoadingIds((prev) => new Set(prev).add(accountId));
    try {
      const qs = new URLSearchParams({ from, to, accountIds: accountId, interval: "month" });
      const res = await apiJson<BalanceSheetHistoryResponse>(`/reports/balance-sheet/history?${qs.toString()}`);
      const chartPoints = (res.points ?? [])
        .map((p) => {
          const acct = p.accounts?.find((a) => a.financialAccountId === accountId);
          const bal = acct?.balance ?? null;
          return { month: p.asOf, balance: bal };
        })
        .filter((p): p is { month: string; balance: number } =>
          p.balance !== null && Number.isFinite(p.balance)
        );
      setAccountHistoryById((prev) => new Map(prev).set(accountId, chartPoints));
    } catch {
      setAccountHistoryFailedIds((prev) => new Set(prev).add(accountId));
    } finally {
      setAccountHistoryLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  }, [accountHistoryById, accountHistoryLoadingIds]);

  const toggleAccountExpanded = useCallback((accountId: string) => {
    let willExpand = false;
    setExpandedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
        willExpand = true;
      }
      return next;
    });
    if (willExpand) {
      void loadAccountHistory(accountId);
    }
  }, [loadAccountHistory]);

  const loadPropertyHistory = useCallback(
    async (propertyId: string, opts?: { force?: boolean }) => {
      if (
        !opts?.force &&
        (propertyHistoryById.has(propertyId) || propertyHistoryLoadingIds.has(propertyId))
      ) {
        return;
      }
      setPropertyHistoryLoadingIds((prev) => new Set(prev).add(propertyId));
      try {
        const res = await apiJson<{ snapshots: Array<{ asOfDate: string; marketValueUsd: number }> }>(
          `/household/properties/${propertyId}/values`
        );
        const points = (res.snapshots ?? []).map((s) => ({ asOf: s.asOfDate, value: s.marketValueUsd }));
        setPropertyHistoryById((prev) => new Map(prev).set(propertyId, points));
      } catch {
        setPropertyHistoryFailedIds((prev) => new Set(prev).add(propertyId));
      } finally {
        setPropertyHistoryLoadingIds((prev) => {
          const n = new Set(prev);
          n.delete(propertyId);
          return n;
        });
      }
    },
    [propertyHistoryById, propertyHistoryLoadingIds]
  );

  const togglePropertyExpanded = useCallback(
    (propertyId: string) => {
      let willExpand = false;
      setExpandedPropertyIds((prev) => {
        const next = new Set(prev);
        if (next.has(propertyId)) {
          next.delete(propertyId);
        } else {
          next.add(propertyId);
          willExpand = true;
        }
        return next;
      });
      if (willExpand) {
        void loadPropertyHistory(propertyId);
      }
    },
    [loadPropertyHistory]
  );

  const startPropertyEdit = useCallback(
    (row: PropertySheetRow) => {
      setEditingPropertyId(row.propertyId);
      setPropertyRowSaveError(null);
      setEditPropertyAmount(row.marketValue != null ? String(row.marketValue) : "");
      setEditPropertyAsOf(row.marketValueAsOf ?? tableAsOf);
    },
    [tableAsOf]
  );

  const cancelPropertyEdit = useCallback(() => {
    setEditingPropertyId(null);
    setEditPropertyAmount("");
    setEditPropertyAsOf("");
    setPropertyRowSaveError(null);
  }, []);

  const savePropertyMarketValue = useCallback(
    async (e: FormEvent, propertyId: string) => {
      e.preventDefault();
      const amount = Number(String(editPropertyAmount).replace(/,/g, ""));
      if (!editPropertyAsOf || !Number.isFinite(amount) || amount < 0) {
        setPropertyRowSaveError("Enter a valid amount and date.");
        return;
      }
      setPropertyRowSaving(true);
      setPropertyRowSaveError(null);
      try {
        await apiJson<{ id: string }>(`/household/properties/${propertyId}/values`, {
          method: "POST",
          body: JSON.stringify({
            marketValueUsd: amount,
            asOfDate: editPropertyAsOf,
            source: "manual"
          })
        });
        cancelPropertyEdit();
        await loadSheet();
        await loadHistoryImmediate();
        if (propertyHistoryById.has(propertyId)) {
          setPropertyHistoryById((prev) => {
            const n = new Map(prev);
            n.delete(propertyId);
            return n;
          });
          void loadPropertyHistory(propertyId, { force: true });
        }
      } catch (err: unknown) {
        setPropertyRowSaveError(err instanceof Error ? err.message : "Could not save value");
      } finally {
        setPropertyRowSaving(false);
      }
    },
    [
      cancelPropertyEdit,
      editPropertyAmount,
      editPropertyAsOf,
      loadHistoryImmediate,
      loadPropertyHistory,
      loadSheet,
      propertyHistoryById
    ]
  );

  const refreshPropertyValuation = useCallback(
    async (propertyId: string) => {
      setPropertyRowRetrieving(true);
      setPropertyRowSaveError(null);
      try {
        const r = await apiJson<{ estimate: number; fetchedAt: string }>(
          `/household/properties/${propertyId}/refresh-valuation`,
          { method: "POST" }
        );
        setEditPropertyAmount(String(Math.round(r.estimate)));
        setEditPropertyAsOf(r.fetchedAt);
      } catch (err: unknown) {
        setPropertyRowSaveError(err instanceof Error ? err.message : "Could not retrieve valuation");
      } finally {
        setPropertyRowRetrieving(false);
      }
    },
    []
  );

  const onPresetChange = (next: PeriodPreset) => {
    setPeriodPreset(next);
    if (next !== "custom") {
      const r = rangeForPreset(next, null);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
  };

  useEffect(() => {
    if (!editDirty) {
      return;
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editDirty]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <Stack gap="md">
      <Paper withBorder shadow="sm" radius="md" p="md">
        <Group justify="space-between" align="center">
          <Group gap={8} align="center">
            <Title order={2} style={{ fontSize: 22, fontWeight: 700 }}>Net worth</Title>
            <HelpIcon label="Balances show the most recent known value — manual entry or import, whichever is more current. Liabilities show as negative so net worth reads clearly. Manage accounts in Settings → Accounts." />
          </Group>
          <Anchor component={Link} to="/settings?tab=accounts" size="sm">
            Manage accounts
          </Anchor>
        </Group>
      </Paper>

      <Stack gap={4}>
        <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing="md">
          <Paper withBorder shadow="sm" radius="md" p="md" style={{ textAlign: "center", borderTop: "3px solid var(--color-success)" }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts="0.06em" mb={4}>Assets</Text>
            <Text size="xl" fw={700} style={{ color: "var(--color-success)", fontVariantNumeric: "tabular-nums" }}>
              {loading || !data ? "—" : formatMoney(data.totals.assets)}
            </Text>
          </Paper>
          <Paper withBorder shadow="sm" radius="md" p="md" style={{ textAlign: "center", borderTop: "3px solid var(--color-warm)" }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts="0.06em" mb={4}>Liabilities</Text>
            <Text size="xl" fw={700} style={{ color: "var(--color-warm)", fontVariantNumeric: "tabular-nums" }}>
              {loading || !data ? "—" : formatMoney(data.totals.liabilities)}
            </Text>
          </Paper>
          <Paper
            withBorder
            shadow="sm"
            radius="md"
            style={{
              textAlign: "center",
              borderTop: `4px solid ${loading || !data ? "var(--color-border)" : (data.totals.netWorth ?? 0) >= 0 ? "var(--color-accent)" : "var(--fs-terracotta)"}`,
              padding: "1rem 1rem 1.05rem"
            }}
          >
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts="0.06em" mb={4}>Net worth</Text>
            <Text fw={700} style={{ fontSize: 28, color: loading || !data ? "var(--color-text-muted)" : (data.totals.netWorth ?? 0) >= 0 ? "var(--color-accent)" : "var(--fs-terracotta)", fontVariantNumeric: "tabular-nums" }}>
              {loading || !data ? "—" : formatMoney(data.totals.netWorth)}
            </Text>
          </Paper>
        </SimpleGrid>
        <Text size="xs" c="dimmed" ta="right" mt={4}>Balances as of {tableAsOf}</Text>
      </Stack>

      {liquidityTiers ? (
        <Paper withBorder shadow="sm" radius="md" p="md">
          <Group gap={8} align="center" mb="sm">
            <Title order={3} style={{ fontSize: 16, fontWeight: 600 }}>Liquidity breakdown</Title>
            <HelpIcon label="Liquid: accessible same day. Semi-liquid: marketable assets, days to settle. Restricted: retirement, HSA, property — penalty or time to access. Tag accounts in Settings → Accounts to see this breakdown." />
          </Group>
          <Stack gap={4} style={{ maxWidth: "28rem" }}>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Liquid</Text>
              <Text size="sm" fw={600} style={{ color: "var(--color-success)" }}>{formatMoney(liquidityTiers.liquid)}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Semi-liquid</Text>
              <Text size="sm" fw={600}>{formatMoney(liquidityTiers.semiLiquid)}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Restricted</Text>
              <Text size="sm" fw={600}>{formatMoney(liquidityTiers.restricted)}</Text>
            </Group>
            {liquidityTiers.hasUncategorized ? (
              <Group justify="space-between">
                <Group gap={4}>
                  <Text size="sm" c="dimmed">Uncategorized</Text>
                  <Anchor component={Link} to="/settings?tab=accounts" size="xs">Tag accounts</Anchor>
                </Group>
                <Text size="sm" c="dimmed">{formatMoney(liquidityTiers.uncategorized)}</Text>
              </Group>
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      <Paper withBorder shadow="sm" radius="md" p="md">
        <Group gap={8} align="center" mb="sm">
          <Title order={3} style={{ fontSize: 16, fontWeight: 600 }}>Trend</Title>
          <HelpIcon label="Chart updates automatically when you change period, interval, or belongs-to filter." />
        </Group>
        <Group gap={6} wrap="wrap" role="group" aria-label="Trend period preset">
          {(["3m", "6m", "12m", "2y", "3y", "ytd", "custom"] as const).map((p) => (
            <Button
              key={p}
              type="button"
              size="xs"
              radius="xl"
              variant={periodPreset === p ? "filled" : "default"}
              color={periodPreset === p ? "green" : undefined}
              style={periodPreset === p ? { background: "var(--color-accent)", borderColor: "var(--color-accent)" } : undefined}
              onClick={() => onPresetChange(p)}
            >
              {p.toUpperCase()}
            </Button>
          ))}
        </Group>
        {periodPreset === "custom" ? (
          <Group align="flex-end" gap="sm" mt="sm" wrap="wrap">
            <TextInput type="date" size="sm" label="From" value={customFrom} onChange={(ev) => setCustomFrom(ev.target.value)} />
            <TextInput type="date" size="sm" label="To" value={customTo} onChange={(ev) => setCustomTo(ev.target.value)} />
          </Group>
        ) : null}
        <Group align="flex-end" gap="md" mt="sm" wrap="wrap">
          <Box>
            <Text size="xs" c="dimmed" mb={4}>Interval</Text>
            <Select
              size="sm"
              style={{ minWidth: "11rem" }}
              value={histInterval}
              onChange={(v) => setHistInterval((v ?? "month") as "month" | "quarter" | "week" | "day")}
              data={[
                { value: "month", label: "Month-end" },
                { value: "quarter", label: "Quarter-end" },
                { value: "week", label: "Every 7 days" },
                { value: "day", label: "Daily (max 120 points)" }
              ]}
            />
          </Box>
          <Box style={{ minWidth: "12rem" }}>
            <Text size="xs" c="dimmed" mb={4}>Scope</Text>
            <HierarchicalSearchPicker
              value={belongsTo || null}
              onChange={(v) => setBelongsTo((v ?? "") as BelongsToFilter)}
              groups={belongsToGroups}
              placeholder="All household activity"
              ariaLabel="Balance sheet owner filter"
              clearable
            />
          </Box>
        </Group>

        {(loadError || historyError) ? (
          <Stack gap="xs" mt="sm">
            {historyError ? <Alert color="red" variant="light" radius="md">{historyError}</Alert> : null}
            <Group align="center" gap="sm">
              <Button variant="default" size="sm" onClick={() => void reloadAll()} disabled={loading || historyLoading}>
                {loading || historyLoading ? "Loading…" : "Retry load"}
              </Button>
              <Text size="sm" c="dimmed">Refetches the balance sheet and trend chart.</Text>
            </Group>
          </Stack>
        ) : null}

        {historyLoading ? <Skeleton height={340} radius="md" mt="sm" animate /> : null}
        {!historyLoading && chartRows.length > 0 ? (
          <Box mt="sm">
            <Group gap="sm" wrap="wrap" align="center" style={{ fontSize: "0.82rem" }}>
              <Group gap={6} align="center">
                <Box w={8} h={8} style={{ borderRadius: "50%", background: "var(--color-accent)" }} />
                <Text size="xs" fw={600}>Net worth</Text>
              </Group>
              <Group gap={6} align="center">
                <Box w={8} h={8} style={{ borderRadius: "50%", background: FS_SAGE }} />
                <Text size="xs" c="dimmed">Assets</Text>
              </Group>
              <Group gap={6} align="center">
                <Box w={8} h={8} style={{ borderRadius: "50%", background: FS_CLAY }} />
                <Text size="xs" c="dimmed">Liabilities</Text>
              </Group>
            </Group>
            <Box style={{ width: "100%", height: 340, marginTop: "0.5rem" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <defs>
                    <linearGradient id="nwGrad_netWorth" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2d6a4f" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#2d6a4f" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="nwGrad_assets" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7a8a6e" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#7a8a6e" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="nwGrad_liabilities" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#b86b4a" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#b86b4a" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="asOf" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" height={52} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) =>
                      `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    }
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) {
                        return null;
                      }
                      const asOf = String(label ?? "");
                      return (
                        <Paper withBorder shadow="sm" radius="md" p="xs">
                          <Text size="xs" fw={600} mb={2}>{asOf}</Text>
                          {payload.map((p) => (
                            <Text size="xs" key={String(p.name ?? p.dataKey)}>
                              <Text span size="xs" style={{ color: String(p.color ?? "inherit") }}>{p.name}</Text>:{" "}
                              {p.value == null || !Number.isFinite(Number(p.value)) ? "—" : formatMoney(Number(p.value))}
                            </Text>
                          ))}
                        </Paper>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="assets" name="Assets" stroke={FS_SAGE} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.6} fill="url(#nwGrad_assets)" dot={false} connectNulls />
                  <Area type="monotone" dataKey="liabilities" name="Liabilities" stroke={FS_CLAY} strokeWidth={1} strokeOpacity={0.5} fill="url(#nwGrad_liabilities)" dot={false} connectNulls />
                  <Area type="monotone" dataKey="netWorth" name="Net worth" stroke="var(--color-accent)" strokeWidth={2.5} fill="url(#nwGrad_netWorth)" dot={false} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        ) : null}
        {!historyLoading && chartRows.length === 0 && !historyError ? (
          <Text c="dimmed" size="sm" mt="sm">No history points in this range (add manual or import balances to see a line).</Text>
        ) : null}

      </Paper>

      <Paper withBorder shadow="sm" radius="md" p="md">
        <Group gap={8} align="center" mb="sm">
          <Title order={3} style={{ fontSize: 16, fontWeight: 600 }}>Balance sheet</Title>
          <HelpIcon label="Snapshot date selects which balances to show. Use the pencil on a row to post or update a manual balance. Each row can still carry its own stored as-of date." />
        </Group>
        <Box mb="sm" style={{ maxWidth: "12rem" }}>
          <TextInput type="date" size="sm" label="Snapshot date" value={tableAsOf} onChange={(ev) => setTableAsOf(ev.target.value)} />
        </Box>
        {loading ? <Skeleton height={120} radius="md" animate /> : null}
        {!loading && data && (data.assets.length > 0 || (data.properties ?? []).length > 0) ? (
          <Box style={{ overflowX: "auto" }}>
            {editDirty ? (
              <Text size="sm" c="dimmed" mb="xs" style={{ maxWidth: "40rem" }}>
                Unsaved balance changes — use <strong>Save</strong> or <strong>Cancel</strong> before leaving this page. Closing
                or refreshing the tab may show a browser warning.
              </Text>
            ) : null}
            <Text size="xs" fw={700} tt="uppercase" lts="0.06em" c="dimmed" mb={6}>Assets</Text>
            <Table withTableBorder withRowBorders striped="odd" verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Account</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Type</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Balance</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>As of</Table.Th>
                  <Table.Th aria-label="Actions" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.assets.map((r) => {
                  const signed = signedDisplayBalance(r);
                  const isEditing = editingId === r.financialAccountId;
                  const isExpanded = expandedAccountIds.has(r.financialAccountId);
                  const isHistoryLoading = accountHistoryLoadingIds.has(r.financialAccountId);
                  const historyPoints = accountHistoryById.get(r.financialAccountId) ?? [];
                  const hasFetched = accountHistoryById.has(r.financialAccountId) || accountHistoryFailedIds.has(r.financialAccountId);
                  const showNoHistory = !isHistoryLoading && hasFetched && (accountHistoryFailedIds.has(r.financialAccountId) || historyPoints.length === 0);
                  return (
                    <Fragment key={r.financialAccountId}>
                      <Table.Tr onClick={() => toggleAccountExpanded(r.financialAccountId)} style={{ cursor: "pointer" }}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <ActionIcon variant="subtle" color="gray" size="sm" aria-hidden tabIndex={-1}>
                              {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                            </ActionIcon>
                            <Text size="sm">{r.institution}{r.accountMask ? ` · ${r.accountMask}` : ""}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{formatAccountType(r.type)}</Text>
                        </Table.Td>
                        <Table.Td>
                          {isEditing ? (
                            <Group gap={4} wrap="wrap" align="center" component="form" onSubmit={saveRow} onClick={(e) => e.stopPropagation()}>
                              <CurrencyInput size="xs" style={{ width: "7rem" }} value={editAmount === "" ? undefined : Number(String(editAmount).replace(/,/g, ""))} onChange={(v) => setEditAmount(v == null ? "" : String(v))} aria-label="Balance amount" />
                              <TextInput type="date" size="xs" value={editAsOf} onChange={(ev) => setEditAsOf(ev.target.value)} aria-label="As-of date" />
                              <Button type="submit" size="xs" disabled={rowSaving}>Save</Button>
                              <Button type="button" variant="default" size="xs" onClick={cancelEdit}>Cancel</Button>
                            </Group>
                          ) : formatMoney(signed)}
                        </Table.Td>
                        <Table.Td><Text size="sm">{r.balanceAsOf ?? "—"}</Text></Table.Td>
                        <Table.Td>
                          {!isEditing ? (
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEdit(r);
                              }}
                              aria-label="Edit balance"
                              title="Edit balance"
                            >
                              <IconPencil size={15} />
                            </ActionIcon>
                          ) : null}
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td colSpan={5} style={{ paddingTop: 0, paddingBottom: 0 }}>
                          <Collapse in={isExpanded}>
                            <Box py="xs">
                              {isHistoryLoading ? <Skeleton height={120} /> : null}
                              {!isHistoryLoading && !showNoHistory ? (
                                <Box style={{ width: "100%", height: 120 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={historyPoints} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
                                      <Tooltip
                                        formatter={(v: number | string) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                                        labelFormatter={(label) => `Month: ${String(label)}`}
                                      />
                                      <Line type="monotone" dataKey="balance" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </Box>
                              ) : null}
                              {showNoHistory ? <Text c="dimmed" size="xs">No balance history available</Text> : null}
                            </Box>
                          </Collapse>
                        </Table.Td>
                      </Table.Tr>
                    </Fragment>
                  );
                })}
                {(data.properties ?? []).length > 0 ? (
                  <>
                    <Table.Tr>
                      <Table.Td colSpan={5} style={{ paddingTop: "0.75rem", paddingBottom: "0.25rem" }}>
                        <Text size="xs" fw={700} tt="uppercase" lts="0.07em" c="dimmed">Real Estate</Text>
                      </Table.Td>
                    </Table.Tr>
                    {(data.properties ?? []).map((p) => {
                      const label = propertyLabel(p);
                      const isExpanded = expandedPropertyIds.has(p.propertyId);
                      const isEditing = editingPropertyId === p.propertyId;
                      const isHistLoading = propertyHistoryLoadingIds.has(p.propertyId);
                      const histPoints = propertyHistoryById.get(p.propertyId) ?? [];
                      const hasFetched =
                        propertyHistoryById.has(p.propertyId) || propertyHistoryFailedIds.has(p.propertyId);
                      const showNoHistory =
                        !isHistLoading &&
                        hasFetched &&
                        (propertyHistoryFailedIds.has(p.propertyId) || histPoints.length === 0);
                      const equity =
                        p.marketValue != null && p.linkedMortgageBalance != null
                          ? p.marketValue - p.linkedMortgageBalance
                          : p.marketValue;

                      return (
                        <Fragment key={p.propertyId}>
                          <Table.Tr
                            onClick={() => togglePropertyExpanded(p.propertyId)}
                            style={{ cursor: "pointer" }}
                          >
                            <Table.Td>
                              <Group gap={6} wrap="nowrap">
                                <ActionIcon variant="subtle" color="gray" size="sm" aria-hidden tabIndex={-1}>
                                  {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                                </ActionIcon>
                                <Box>
                                  <Text size="sm">{label}</Text>
                                  {p.linkedMortgageBalance != null && equity != null ? (
                                    <Text size="xs" c="dimmed">Equity: {formatMoney(equity)}</Text>
                                  ) : null}
                                </Box>
                              </Group>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">{propertyUseLabel(p.propertyUse)}</Text>
                            </Table.Td>
                            <Table.Td>
                              {isEditing ? (
                                <Group
                                  gap={4}
                                  wrap="wrap"
                                  align="center"
                                  component="form"
                                  onSubmit={(ev: FormEvent) => {
                                    void savePropertyMarketValue(ev, p.propertyId);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <TextInput
                                    size="xs"
                                    style={{ width: "7rem" }}
                                    inputMode="decimal"
                                    value={editPropertyAmount}
                                    onChange={(ev) => setEditPropertyAmount(ev.target.value)}
                                    aria-label="Market value"
                                  />
                                  <TextInput
                                    type="date"
                                    size="xs"
                                    value={editPropertyAsOf}
                                    onChange={(ev) => setEditPropertyAsOf(ev.target.value)}
                                    aria-label="As-of date"
                                  />
                                  <Button
                                    type="button"
                                    variant="light"
                                    size="xs"
                                    loading={propertyRowRetrieving}
                                    disabled={propertyRowSaving}
                                    onClick={() => void refreshPropertyValuation(p.propertyId)}
                                  >
                                    Redfin
                                  </Button>
                                  <Button type="submit" size="xs" disabled={propertyRowSaving || propertyRowRetrieving}>Save</Button>
                                  <Button type="button" variant="default" size="xs" onClick={cancelPropertyEdit} disabled={propertyRowSaving || propertyRowRetrieving}>Cancel</Button>
                                </Group>
                              ) : (
                                formatMoney(p.marketValue)
                              )}
                            </Table.Td>
                            <Table.Td><Text size="sm">{p.marketValueAsOf ?? "—"}</Text></Table.Td>
                            <Table.Td>
                              {!isEditing ? (
                                <ActionIcon
                                  variant="subtle"
                                  color="gray"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startPropertyEdit(p);
                                  }}
                                  aria-label="Edit market value"
                                  title="Edit market value"
                                >
                                  <IconPencil size={15} />
                                </ActionIcon>
                              ) : null}
                            </Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td colSpan={5} style={{ paddingTop: 0, paddingBottom: 0 }}>
                              <Collapse in={isExpanded}>
                                <Box py="xs">
                                  {isHistLoading ? <Skeleton height={120} /> : null}
                                  {!isHistLoading && !showNoHistory && histPoints.length > 0 ? (
                                    <Box style={{ width: "100%", height: 120 }}>
                                      <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={histPoints} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                                          <XAxis dataKey="asOf" tick={{ fontSize: 11 }} />
                                          <YAxis
                                            tick={{ fontSize: 11 }}
                                            tickFormatter={(v: number) =>
                                              `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                                            }
                                          />
                                          <Tooltip
                                            formatter={(v: number | string) => [
                                              `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                                              "Market value"
                                            ]}
                                            labelFormatter={(lbl) => `Date: ${String(lbl)}`}
                                          />
                                          <Line
                                            type="monotone"
                                            dataKey="value"
                                            stroke="var(--color-accent)"
                                            strokeWidth={2}
                                            dot={false}
                                          />
                                        </LineChart>
                                      </ResponsiveContainer>
                                    </Box>
                                  ) : null}
                                  {showNoHistory ? (
                                    <Text c="dimmed" size="xs">No value history — add market value snapshots to see a chart.</Text>
                                  ) : null}
                                </Box>
                              </Collapse>
                            </Table.Td>
                          </Table.Tr>
                        </Fragment>
                      );
                    })}
                  </>
                ) : null}
                <Table.Tr>
                  <Table.Td><Text size="sm" fw={700} style={{ color: "var(--fs-forest)" }}>Total Assets</Text></Table.Td>
                  <Table.Td />
                  <Table.Td><Text size="sm" fw={700} style={{ color: "var(--fs-forest)" }}>{formatMoney(data.totals.assets)}</Text></Table.Td>
                  <Table.Td />
                  <Table.Td />
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Box>
        ) : null}
        {!loading && data && data.liabilities.length > 0 ? (
          <>
            {!loading && data && (data.assets.length > 0 || (data.properties ?? []).length > 0) ? (
              <Divider my="md" />
            ) : null}
            <Box style={{ overflowX: "auto", marginTop: "1rem" }}>
              <Text size="xs" fw={700} tt="uppercase" lts="0.06em" c="dimmed" mb={6}>Liabilities</Text>
            <Table withTableBorder withRowBorders striped="odd" verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Account</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Type</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Balance</Table.Th>
                  <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>As of</Table.Th>
                  <Table.Th aria-label="Actions" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.liabilities.map((r) => {
                  const signed = signedDisplayBalance(r);
                  const isEditing = editingId === r.financialAccountId;
                  const isExpanded = expandedAccountIds.has(r.financialAccountId);
                  const isHistoryLoading = accountHistoryLoadingIds.has(r.financialAccountId);
                  const historyPoints = accountHistoryById.get(r.financialAccountId) ?? [];
                  const hasFetched = accountHistoryById.has(r.financialAccountId) || accountHistoryFailedIds.has(r.financialAccountId);
                  const showNoHistory = !isHistoryLoading && hasFetched && (accountHistoryFailedIds.has(r.financialAccountId) || historyPoints.length === 0);
                  return (
                    <Fragment key={r.financialAccountId}>
                      <Table.Tr onClick={() => toggleAccountExpanded(r.financialAccountId)} style={{ cursor: "pointer" }}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <ActionIcon variant="subtle" color="gray" size="sm" aria-hidden tabIndex={-1}>
                              {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                            </ActionIcon>
                            <Text size="sm">{r.institution}{r.accountMask ? ` · ${r.accountMask}` : ""}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{formatAccountType(r.type)}</Text>
                        </Table.Td>
                        <Table.Td>
                          {isEditing ? (
                            <Group gap={4} wrap="wrap" align="center" component="form" onSubmit={saveRow} onClick={(e) => e.stopPropagation()}>
                              <CurrencyInput size="xs" style={{ width: "7rem" }} value={editAmount === "" ? undefined : Number(String(editAmount).replace(/,/g, ""))} onChange={(v) => setEditAmount(v == null ? "" : String(v))} aria-label="Balance amount" />
                              <TextInput type="date" size="xs" value={editAsOf} onChange={(ev) => setEditAsOf(ev.target.value)} aria-label="As-of date" />
                              <Button type="submit" size="xs" disabled={rowSaving}>Save</Button>
                              <Button type="button" variant="default" size="xs" onClick={cancelEdit}>Cancel</Button>
                            </Group>
                          ) : formatMoney(signed)}
                        </Table.Td>
                        <Table.Td><Text size="sm">{r.balanceAsOf ?? "—"}</Text></Table.Td>
                        <Table.Td>
                          {!isEditing ? (
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEdit(r);
                              }}
                              aria-label="Edit balance"
                              title="Edit balance"
                            >
                              <IconPencil size={15} />
                            </ActionIcon>
                          ) : null}
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td colSpan={5} style={{ paddingTop: 0, paddingBottom: 0 }}>
                          <Collapse in={isExpanded}>
                            <Box py="xs">
                              {isHistoryLoading ? <Skeleton height={120} /> : null}
                              {!isHistoryLoading && !showNoHistory ? (
                                <Box style={{ width: "100%", height: 120 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={historyPoints} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
                                      <Tooltip
                                        formatter={(v: number | string) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                                        labelFormatter={(label) => `Month: ${String(label)}`}
                                      />
                                      <Line type="monotone" dataKey="balance" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </Box>
                              ) : null}
                              {showNoHistory ? <Text c="dimmed" size="xs">No balance history available</Text> : null}
                            </Box>
                          </Collapse>
                        </Table.Td>
                      </Table.Tr>
                    </Fragment>
                  );
                })}
                <Table.Tr>
                  <Table.Td><Text size="sm" fw={700} style={{ color: "var(--color-warm)" }}>Total Liabilities</Text></Table.Td>
                  <Table.Td />
                  <Table.Td><Text size="sm" fw={700} style={{ color: "var(--color-warm)" }}>{formatMoney(data.totals.liabilities)}</Text></Table.Td>
                  <Table.Td />
                  <Table.Td />
                </Table.Tr>
              </Table.Tbody>
            </Table>
            </Box>
          </>
        ) : null}
        {rowSaveError ? <Alert color="red" variant="light" radius="md" mt="sm">{rowSaveError}</Alert> : null}
        {propertyRowSaveError ? (
          <Alert color="red" variant="light" radius="md" mt="sm">{propertyRowSaveError}</Alert>
        ) : null}
        {!loading && data && (topAssets.length > 0 || topLiabilities.length > 0) ? (
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="lg" mt="md" style={{ paddingTop: "1rem", borderTop: "1px solid var(--color-border)" }}>
            {topAssets.length > 0 ? (
              <Box>
                <Text fz={11} fw={600} tt="uppercase" lts="0.05em" c="dimmed" mb={6}>Top Assets</Text>
                <ResponsiveContainer width="100%" height={topAssets.length * 34 + 8}>
                  <BarChart layout="vertical" data={topAssets} margin={{ top: 0, right: 72, left: 0, bottom: 0 }} barCategoryGap="25%">
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "var(--color-text)" }} tickFormatter={(v: string) => v.length > 18 ? `${v.slice(0, 17)}…` : v} />
                    <Bar dataKey="balance" fill={FS_FOREST} radius={[0, 3, 3, 0]} isAnimationActive={false}>
                      <LabelList dataKey="balance" position="right" formatter={(v: number) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} style={{ fontSize: 11, fill: "var(--color-text-muted)", fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            ) : null}
            {topLiabilities.length > 0 ? (
              <Box>
                <Text fz={11} fw={600} tt="uppercase" lts="0.05em" c="dimmed" mb={6}>Top Liabilities</Text>
                <ResponsiveContainer width="100%" height={topLiabilities.length * 34 + 8}>
                  <BarChart layout="vertical" data={topLiabilities} margin={{ top: 0, right: 72, left: 0, bottom: 0 }} barCategoryGap="25%">
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "var(--color-text)" }} tickFormatter={(v: string) => v.length > 18 ? `${v.slice(0, 17)}…` : v} />
                    <Bar dataKey="balance" fill={FS_CLAY} radius={[0, 3, 3, 0]} isAnimationActive={false}>
                      <LabelList dataKey="balance" position="right" formatter={(v: number) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} style={{ fontSize: 11, fill: "var(--color-text-muted)", fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            ) : null}
          </SimpleGrid>
        ) : null}
        <Box mt="md">
          <Button
            variant="subtle"
            size="xs"
            color="gray"
            onClick={() => setBulkOpen((v) => !v)}
          >
            {bulkOpen ? "Hide" : "Re-date all manual balances"}
          </Button>
          <Collapse in={bulkOpen}>
            <Text size="sm" c="dimmed" mt="xs" mb={0} style={{ maxWidth: "36rem" }}>
              Set the same as-of on every manual snapshot without changing amounts — useful when aligning reporting dates.
            </Text>
            <Group align="flex-end" gap="sm" wrap="wrap" mt="sm">
              <TextInput type="date" size="sm" label="New as-of date" value={bulkAsOfDraft} onChange={(ev) => setBulkAsOfDraft(ev.target.value)} />
              <Button type="button" variant="default" size="sm" disabled={bulkWorking || allTableRows.length === 0} onClick={() => setBulkConfirmOpen(true)} style={{ alignSelf: "flex-end" }}>
                {bulkWorking ? "Applying…" : "Apply to all rows"}
              </Button>
            </Group>
          </Collapse>
        </Box>
        {bulkSummary ? <Text size="sm" c="dimmed" mt="xs">{bulkSummary}</Text> : null}
        {loadError ? <Alert color="red" variant="light" radius="md" mt="sm">{loadError}</Alert> : null}
      </Paper>

      <ConfirmDialog
        opened={bulkConfirmOpen}
        title="Apply as-of date to all rows?"
        message={`Set manual balance as-of date to ${bulkAsOfDraft} for every row that has a balance? New snapshots use the same amounts as shown.`}
        confirmLabel="Apply to all"
        closeOnClickOutside={false}
        onClose={() => setBulkConfirmOpen(false)}
        onConfirm={runBulkAsOf}
      />
    </Stack>
  );
}
