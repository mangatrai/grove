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
import { HelpIcon } from "../components/HelpIcon";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "../components/HierarchicalSearchPicker";

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

type BalanceSheetHistoryAccountSlice = {
  financialAccountId: string;
  side: "asset" | "liability";
  balance: number | null;
  balanceAsOf: string | null;
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
    accounts?: BalanceSheetHistoryAccountSlice[];
  }>;
};

type AccountHistoryPoint = {
  month: string;
  accounts: Array<{
    accountId: string;
    balance: number;
  }>;
};

type AccountHistoryResponse = {
  points: AccountHistoryPoint[];
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

function formatSignedDelta(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value >= 0 ? "+" : "–"}${formatMoney(Math.abs(value))}`;
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
  loan: "Loan",
  mortgage: "Mortgage",
  payslip: "Payslip",
};

function formatAccountType(type: string): string {
  return ACCOUNT_TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

  const periodSummary = useMemo(() => {
    const pts = historyData?.points ?? [];
    if (pts.length === 0) {
      return null;
    }
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const fa = first.totals.assets;
    const fl = first.totals.liabilities;
    const fn = first.totals.netWorth;
    const la = last.totals.assets;
    const ll = last.totals.liabilities;
    const ln = last.totals.netWorth;
    return {
      startLabel: first.asOf,
      endLabel: last.asOf,
      start: { assets: fa, liabilities: fl, net: fn },
      end: { assets: la, liabilities: ll, net: ln },
      delta:
        fa != null && la != null
          ? { assets: la - fa, liabilities: (ll ?? 0) - (fl ?? 0), net: (ln ?? 0) - (fn ?? 0) }
          : null
    };
  }, [historyData?.points]);

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
    if (accountHistoryById.has(accountId) || accountHistoryLoadingIds.has(accountId) || accountHistoryFailedIds.has(accountId)) {
      return;
    }
    setAccountHistoryLoadingIds((prev) => {
      const next = new Set(prev);
      next.add(accountId);
      return next;
    });
    try {
      const qs = new URLSearchParams({
        accountIds: accountId,
        interval: "month"
      });
      const res = await apiJson<AccountHistoryResponse>(`/reports/balance-sheet/history?${qs.toString()}`);
      const chartPoints = (res.points ?? []).map((p) => ({
        month: p.month,
        balance: Number(p.accounts?.[0]?.balance ?? Number.NaN)
      })).filter((p) => Number.isFinite(p.balance));
      setAccountHistoryById((prev) => {
        const next = new Map(prev);
        next.set(accountId, chartPoints);
        return next;
      });
    } catch {
      setAccountHistoryFailedIds((prev) => {
        const next = new Set(prev);
        next.add(accountId);
        return next;
      });
    } finally {
      setAccountHistoryLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  }, [accountHistoryById, accountHistoryFailedIds, accountHistoryLoadingIds]);

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
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
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
              borderTop: `4px solid ${loading || !data ? "var(--color-border)" : (data.totals.netWorth ?? 0) >= 0 ? "var(--color-accent)" : "var(--color-danger)"}`,
              padding: "1rem 1rem 1.05rem"
            }}
          >
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts="0.06em" mb={4}>Net worth</Text>
            <Text fw={700} style={{ fontSize: 28, color: loading || !data ? "var(--color-text-muted)" : (data.totals.netWorth ?? 0) >= 0 ? "var(--color-accent)" : "var(--color-danger)", fontVariantNumeric: "tabular-nums" }}>
              {loading || !data ? "—" : formatMoney(data.totals.netWorth)}
            </Text>
          </Paper>
        </SimpleGrid>
        <Text size="xs" c="dimmed" ta="right" mt={4}>Balances as of {tableAsOf}</Text>
      </Stack>

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

        {periodSummary?.delta ? (
          <Group gap="sm" wrap="wrap" mt="md">
            <Paper radius="md" p="sm" style={{ background: (periodSummary.delta.assets ?? 0) >= 0 ? "var(--color-success-subtle)" : "var(--color-danger-subtle)", minWidth: "13rem" }}>
              <Text size="xs" fw={700} tt="uppercase" lts="0.07em" c="dimmed">ASSETS</Text>
              <Text fw={700} style={{ fontSize: "1.05rem", color: (periodSummary.delta.assets ?? 0) >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                {formatSignedDelta(periodSummary.delta.assets)}
              </Text>
              <Text size="xs" c="dimmed">{periodSummary.startLabel} → {periodSummary.endLabel}</Text>
            </Paper>
            <Paper radius="md" p="sm" style={{ background: (periodSummary.delta.liabilities ?? 0) <= 0 ? "var(--color-success-subtle)" : "var(--color-danger-subtle)", minWidth: "13rem" }}>
              <Text size="xs" fw={700} tt="uppercase" lts="0.07em" c="dimmed">LIABILITIES</Text>
              <Text fw={700} style={{ fontSize: "1.05rem", color: (periodSummary.delta.liabilities ?? 0) <= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                {formatSignedDelta(periodSummary.delta.liabilities)}
              </Text>
              <Text size="xs" c="dimmed">{periodSummary.startLabel} → {periodSummary.endLabel}</Text>
            </Paper>
            <Paper radius="md" p="sm" style={{ background: (periodSummary.delta.net ?? 0) >= 0 ? "var(--color-success-subtle)" : "var(--color-danger-subtle)", minWidth: "13rem" }}>
              <Text size="xs" fw={700} tt="uppercase" lts="0.07em" c="dimmed">NET WORTH</Text>
              <Text fw={700} style={{ fontSize: "1.05rem", color: (periodSummary.delta.net ?? 0) >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                {formatSignedDelta(periodSummary.delta.net)}
              </Text>
              <Text size="xs" c="dimmed">{periodSummary.startLabel} → {periodSummary.endLabel}</Text>
            </Paper>
          </Group>
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
                <Box w={8} h={8} style={{ borderRadius: "50%", background: "#22c55e" }} />
                <Text size="xs" c="dimmed">Assets</Text>
              </Group>
              <Group gap={6} align="center">
                <Box w={8} h={8} style={{ borderRadius: "50%", background: "#f59e0b" }} />
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
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="nwGrad_liabilities" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
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
                  <Area type="monotone" dataKey="assets" name="Assets" stroke="#22c55e" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.6} fill="url(#nwGrad_assets)" dot={false} connectNulls />
                  <Area type="monotone" dataKey="liabilities" name="Liabilities" stroke="#f59e0b" strokeWidth={1} strokeOpacity={0.5} fill="url(#nwGrad_liabilities)" dot={false} connectNulls />
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
        {!loading && data && data.assets.length > 0 ? (
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
                  const showNoHistory = !isHistoryLoading && (accountHistoryFailedIds.has(r.financialAccountId) || historyPoints.length === 0);
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
                              <TextInput size="xs" style={{ width: "7rem" }} inputMode="decimal" value={editAmount} onChange={(ev) => setEditAmount(ev.target.value)} aria-label="Balance amount" />
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
                  <Table.Td><Text size="sm" fw={700} c="green">Total Assets</Text></Table.Td>
                  <Table.Td />
                  <Table.Td><Text size="sm" fw={700} c="green">{formatMoney(data.totals.assets)}</Text></Table.Td>
                  <Table.Td />
                  <Table.Td />
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Box>
        ) : null}
        {!loading && data && data.liabilities.length > 0 ? (
          <>
            {!loading && data && data.assets.length > 0 ? <Divider my="md" /> : null}
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
                  const showNoHistory = !isHistoryLoading && (accountHistoryFailedIds.has(r.financialAccountId) || historyPoints.length === 0);
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
                              <TextInput size="xs" style={{ width: "7rem" }} inputMode="decimal" value={editAmount} onChange={(ev) => setEditAmount(ev.target.value)} aria-label="Balance amount" />
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
        {!loading && data && (topAssets.length > 0 || topLiabilities.length > 0) ? (
          <SimpleGrid cols={2} spacing="lg" mt="md" style={{ paddingTop: "1rem", borderTop: "1px solid var(--color-border)" }}>
            {topAssets.length > 0 ? (
              <Box>
                <Text fz={11} fw={600} tt="uppercase" lts="0.05em" c="dimmed" mb={6}>Top Assets</Text>
                <ResponsiveContainer width="100%" height={topAssets.length * 34 + 8}>
                  <BarChart layout="vertical" data={topAssets} margin={{ top: 0, right: 72, left: 0, bottom: 0 }} barCategoryGap="25%">
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "var(--color-text)" }} tickFormatter={(v: string) => v.length > 18 ? `${v.slice(0, 17)}…` : v} />
                    <Bar dataKey="balance" fill="#22c55e" radius={[0, 3, 3, 0]} isAnimationActive={false}>
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
                    <Bar dataKey="balance" fill="#f59e0b" radius={[0, 3, 3, 0]} isAnimationActive={false}>
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
