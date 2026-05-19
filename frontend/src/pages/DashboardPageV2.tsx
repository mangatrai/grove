import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GroveCardLoader } from "../components/GroveLoader";
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from "recharts";

import {
  IconAlertCircle,
  IconArrowsExchange,
  IconCopy,
  IconRefresh,
} from "@tabler/icons-react";

import { FinancialHealthCard } from "../components/FinancialHealthCard";
import { apiFetch, apiJson, useAuthToken } from "../api";
import { useLocalStorageCache } from "../hooks/useLocalStorageCache";
import { FS_CAT_PALETTE, FS_FOREST, FS_TERRACOTTA } from "../theme/chartPalette";
import { formatTimeAgo, formatUsd } from "../utils/format";

type CashSummaryResponse = {
  range: { start: string; end: string; label: string };
  household: { inflows: number; outflows: number; net: number; transactionCount: number };
  byCategory: Array<{ categoryId: string | null; categoryName: string; inflows: number; outflows: number; net: number }> | null;
  spendingPower: { savingsRate: number | null };
  monthlyTrend: Array<{ month: string; inflows: number; outflows: number; net: number }>;
};

type ResolutionSummary = {
  totalOpen: number;
  openByType: { unknown_category?: number; transfer_ambiguity?: number; duplicate_ambiguity?: number };
};

type NetWorthSnapshot = {
  asOf: string;
  totals: { netWorth: number | null; assets: number | null; liabilities: number | null };
};

type NetWorthHistoryPoint = { date: string; netWorth: number | null };

type BudgetMonthResponse = {
  month: string;
  exists: boolean;
  summary: { totalBudgeted: number; totalSpent: number; remaining: number; unbudgetedSpend: number };
  categories: Array<{
    categoryId: string;
    categoryName: string;
    parentName: string | null;
    budgeted: number;
    spent: number;
    remaining: number;
    percentUsed: number;
  }>;
};

type LedgerRow = {
  id: string;
  merchant: string | null;
  amount: number;
  txnDate: string;
  status: string;
  accountId: string;
  institution: string;
  accountType: string;
  accountMask: string | null;
  categoryName: string | null;
};

type CashDataState = CashSummaryResponse | null | "error";

type RecurringItem = { merchant: string; medianAmount: number; monthCount: number };

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

type AccountBucket = {
  accountId: string;
  name: string;
  accountType: string;
  thisMonthOutflow: number;
  priorMonthOutflow: number;
  priorMonthTxnCount: number;
};


// Named for the field it actually checks (LedgerRow.merchant), not the brief's "description".
const EXCLUDE_MERCHANT_TOKENS = [
  "TRANSFER",
  "E-PAYMENT",
  "AUTOPAY",
  "PAYDOWN",
  "PAYMENT",
  "DIRECT DEP",
  "DIRECT DEPOSIT",
  "REFUND"
];

const EXCLUDE_CATEGORIES = new Set([
  "food",
  "coffee",
  "dining",
  "snacks",
  "shopping",
  "groceries",
  "clothing",
  "electronic",
  "personal care",
  "general merchandise",
  "office",
  "travel",
  "airfare",
  "hotel",
  "car rental",
  "taxi",
  "parking",
  "entertainment",
  "movies",
  "fuel",
  "gas",
  "gifts",
  "tax"
]);

const ALLOW_CATEGORIES = new Set([
  "utilities",
  "energy",
  "internet",
  "mobile",
  "water",
  "insurance",
  "loan",
  "mortgage",
  "heloc",
  "rent",
  "housing",
  "hoa",
  "subscriptions",
  "streaming",
  "software",
  "fitness",
  "childcare",
  "tuition"
]);

const LIABILITY_ACCOUNT_TYPES = new Set(["credit_card", "loan"]);
const ACCOUNT_CARD_TYPES = new Set(["credit_card", "checking", "savings"]);

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
}

function sameMonthPriorYear(ym: string): string {
  return `${Number(ym.slice(0, 4)) - 1}-${ym.slice(5, 7)}`;
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  return `${names[m! - 1]} ${y}`;
}

function firstDayOf(ym: string): string {
  return `${ym}-01`;
}

function lastDayOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, m!, 0).toISOString().slice(0, 10);
}

function firstDayNMonthsBefore(ym: string, n: number): string {
  let [y, m] = ym.split("-").map(Number);
  m = m! - n;
  while (m! <= 0) {
    m = m! + 12;
    y = y! - 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function formatMonthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m! - 1]} '${String(y).slice(2)}`;
}

function formatNoCents(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function coefficientOfVariation(amounts: number[]): number {
  if (amounts.length === 0) return Infinity;
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  if (mean === 0) return Infinity;
  const variance = amounts.reduce((acc, x) => acc + (x - mean) ** 2, 0) / amounts.length;
  return Math.sqrt(variance) / mean;
}

function modalCategory(rows: LedgerRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = r.categoryName?.toLowerCase().trim();
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

function detectRecurring(txns: LedgerRow[]): RecurringItem[] {
  // Layer 1 — drop transfers/payoffs/payments/refunds by merchant token before grouping.
  const filtered = txns.filter((t) => {
    if (t.status !== "posted" || t.amount >= 0) return false;
    const m = (t.merchant ?? "").toUpperCase();
    return !EXCLUDE_MERCHANT_TOKENS.some((tok) => m.includes(tok));
  });

  const byMerchant = new Map<string, LedgerRow[]>();
  for (const t of filtered) {
    const key = (t.merchant ?? "Unknown").toLowerCase().trim();
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), t]);
  }

  const results: RecurringItem[] = [];
  for (const [, rows] of byMerchant) {
    if (rows.length < 2) continue;
    const months = new Set(rows.map((r) => r.txnDate.slice(0, 7)));
    if (months.size < 2) continue;

    // Layer 3 — modal category gate: deny-list drops the bucket; allow-list relaxes the CV cap.
    const cat = modalCategory(rows);
    if (cat && [...EXCLUDE_CATEGORIES].some((token) => cat.includes(token))) continue;

    // Layer 2 — amount stability via coefficient of variation.
    const amounts = rows.map((r) => Math.abs(r.amount));
    const cv = coefficientOfVariation(amounts);
    const cvCap = cat && [...ALLOW_CATEGORIES].some((token) => cat.includes(token)) ? 0.5 : 0.25;
    if (cv >= cvCap) continue;

    const sorted = [...amounts].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
    results.push({ merchant: rows[0]!.merchant ?? "Unknown", medianAmount: median, monthCount: months.size });
  }
  return results.sort((a, b) => b.medianAmount - a.medianAmount);
}

function merchantMatches(merchant: string, key: string): boolean {
  return merchant.toLowerCase().includes(key.toLowerCase());
}

function normalizedKey(s: string): string {
  return s.toLowerCase().trim();
}

function computeAccountBuckets(txns: LedgerRow[], activeMonth: string): AccountBucket[] {
  const priorYm = prevMonth(activeMonth);
  const buckets = new Map<string, AccountBucket>();
  for (const t of txns) {
    if (t.status !== "posted" || t.amount >= 0) continue;
    if (!ACCOUNT_CARD_TYPES.has(t.accountType)) continue;
    const isThis = t.txnDate.startsWith(activeMonth);
    const isPrior = t.txnDate.startsWith(priorYm);
    if (!isThis && !isPrior) continue;
    let b = buckets.get(t.accountId);
    if (!b) {
      b = {
        accountId: t.accountId,
        name: `${t.institution}${t.accountMask ? ` · ${t.accountMask}` : ""}`,
        accountType: t.accountType,
        thisMonthOutflow: 0,
        priorMonthOutflow: 0,
        priorMonthTxnCount: 0
      };
      buckets.set(t.accountId, b);
    }
    const abs = Math.abs(t.amount);
    if (isThis) b.thisMonthOutflow += abs;
    if (isPrior) {
      b.priorMonthOutflow += abs;
      b.priorMonthTxnCount += 1;
    }
  }
  const all = [...buckets.values()].filter((b) => b.thisMonthOutflow > 0);
  const creditCards = all
    .filter((b) => b.accountType === "credit_card")
    .sort((a, b) => b.thisMonthOutflow - a.thisMonthOutflow)
    .slice(0, 3);
  const checkingSavings = all
    .filter((b) => b.accountType === "checking" || b.accountType === "savings")
    .sort((a, b) => b.thisMonthOutflow - a.thisMonthOutflow)
    .slice(0, 3);
  return [...creditCards, ...checkingSavings];
}

function accountArrow(b: AccountBucket): { char: string; color: string } | null {
  if (b.priorMonthTxnCount < 3) return null;
  const isLiability = LIABILITY_ACCOUNT_TYPES.has(b.accountType);
  if (b.priorMonthOutflow === 0) return { char: "→", color: "dimmed" };
  const delta = (b.thisMonthOutflow - b.priorMonthOutflow) / b.priorMonthOutflow;
  if (delta > 0.05) return { char: "↑", color: isLiability ? "fsTerracotta" : "fsGold" };
  if (delta < -0.05) return { char: "↓", color: "fsForest" };
  return { char: "→", color: "dimmed" };
}

function yoyArrow(
  b: AccountBucket,
  pyData: { outflow: number; count: number } | undefined
): { char: string; color: string } | null {
  if (!pyData || pyData.count < 3) return null;
  const isLiability = LIABILITY_ACCOUNT_TYPES.has(b.accountType);
  if (pyData.outflow === 0) return { char: "→", color: "dimmed" };
  const delta = (b.thisMonthOutflow - pyData.outflow) / pyData.outflow;
  if (delta > 0.05) return { char: "↑", color: isLiability ? "fsTerracotta" : "fsGold" };
  if (delta < -0.05) return { char: "↓", color: "fsForest" };
  return { char: "→", color: "dimmed" };
}

function outflowSlices(cashData: CashSummaryResponse | null): Array<{ categoryId: string | null; categoryName: string; outflows: number }> {
  const rows = (cashData?.byCategory ?? []).filter((r) => r.outflows > 0).sort((a, b) => b.outflows - a.outflows);
  if (rows.length <= 5) {
    return rows.map((r) => ({ categoryId: r.categoryId, categoryName: r.categoryName, outflows: r.outflows }));
  }
  const top = rows.slice(0, 5).map((r) => ({ categoryId: r.categoryId, categoryName: r.categoryName, outflows: r.outflows }));
  const other = rows.slice(5).reduce((acc, row) => acc + row.outflows, 0);
  return [...top, { categoryId: null, categoryName: "Other", outflows: other }];
}

export function DashboardPageV2() {
  const token = useAuthToken();
  const [activeMonth, setActiveMonth] = useState<string>(() => currentYearMonth());
  const [cashData, setCashData] = useState<CashDataState>(null);
  const [resolutionData, setResolutionData] = useState<ResolutionSummary | null>(null);
  const [netWorthData, setNetWorthData] = useState<NetWorthSnapshot | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthHistoryPoint[] | null>(null);
  const [budgetData, setBudgetData] = useState<BudgetMonthResponse | null>(null);
  const [recentTxns, setRecentTxns] = useState<LedgerRow[] | null>(null);
  const [priorYearTxns, setPriorYearTxns] = useState<LedgerRow[] | null>(null);
  const [recurringOverrides, setRecurringOverrides] = useState<RecurringOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllRecurring, setShowAllRecurring] = useState(false);

  const isCurrentMonth = activeMonth === currentYearMonth();

  const cashCacheKey = `cash-summary:${activeMonth}`;
  const {
    data: cachedCashData,
    loading: cashCacheLoading,
    error: cashCacheError,
    lastUpdatedAt: cashLastUpdated,
    refresh: refreshCashCache,
  } = useLocalStorageCache<CashSummaryResponse>(
    cashCacheKey,
    "dashboard",
    () =>
      apiJson<CashSummaryResponse>(
        `/reports/cash-summary?preset=month&month=${encodeURIComponent(activeMonth)}&categoryBreakdown=true&categoryRollup=parent`,
        { cache: "no-store" }
      )
  );

  useEffect(() => {
    if (cashCacheError) {
      setCashData("error");
    } else if (cachedCashData !== null) {
      setCashData(cachedCashData);
    }
  }, [cachedCashData, cashCacheError]);

  const loadCashSummary = useCallback(() => {
    refreshCashCache();
  }, [refreshCashCache]);

  const loadAll = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    const historyFrom = firstDayNMonthsBefore(activeMonth, 6);
    const monthEnd = lastDayOf(activeMonth);
    const pyMonth = sameMonthPriorYear(activeMonth);
    const results = await Promise.allSettled([
      apiJson<ResolutionSummary>("/resolution/summary", { cache: "no-store" }),
      apiJson<NetWorthSnapshot>("/reports/balance-sheet", { cache: "no-store" }),
      apiJson<{ points: Array<{ asOf: string; totals: { netWorth: number | null } }> }>(
        `/reports/balance-sheet/history?from=${historyFrom}&to=${monthEnd}&interval=month`,
        { cache: "no-store" }
      ),
      apiJson<BudgetMonthResponse>(`/budget/${encodeURIComponent(activeMonth)}`, { cache: "no-store" }),
      apiJson<{ transactions: LedgerRow[] }>(
        `/transactions?limit=200&dateFrom=${historyFrom}&dateTo=${monthEnd}`,
        { cache: "no-store" }
      ),
      apiJson<{ ok: boolean; data: RecurringOverride[] }>("/recurring-overrides", { cache: "no-store" }),
      apiJson<{ transactions: LedgerRow[] }>(
        `/transactions?limit=200&dateFrom=${firstDayOf(pyMonth)}&dateTo=${lastDayOf(pyMonth)}`,
        { cache: "no-store" }
      ),
    ]);
    setResolutionData(results[0].status === "fulfilled" ? results[0].value : null);
    setNetWorthData(results[1].status === "fulfilled" ? results[1].value : null);
    setNetWorthHistory(
      results[2].status === "fulfilled"
        ? results[2].value.points.map((p) => ({ date: p.asOf, netWorth: p.totals.netWorth }))
        : null
    );
    setBudgetData(results[3].status === "fulfilled" ? results[3].value : null);
    setRecentTxns(results[4].status === "fulfilled" ? results[4].value.transactions : null);
    setRecurringOverrides(results[5].status === "fulfilled" && results[5].value.ok ? results[5].value.data : []);
    setPriorYearTxns(results[6].status === "fulfilled" ? results[6].value.transactions : null);
    setLoading(false);
  }, [activeMonth, token]);

  const dismissRecurring = useCallback(async (merchantKey: string) => {
    const normalized = normalizedKey(merchantKey);
    const nowIso = new Date().toISOString();
    const optimistic: RecurringOverride = {
      id: `optimistic-${normalized}`,
      householdId: "optimistic",
      merchantKey: normalized,
      displayName: null,
      verdict: "dismissed",
      amountAnchor: null,
      amountTolerancePct: 15,
      taggedByUserId: null,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    setRecurringOverrides((prev) => [...prev.filter((row) => row.merchantKey !== normalized), optimistic]);
    try {
      const res = await apiFetch("/recurring-overrides", {
        method: "POST",
        body: JSON.stringify({ merchantKey: normalized, verdict: "dismissed" })
      });
      if (!res.ok) {
        throw new Error("Failed to dismiss recurring suggestion");
      }
      const json = (await res.json()) as { ok: boolean; data: RecurringOverride };
      if (json.ok) {
        setRecurringOverrides((prev) => [...prev.filter((row) => row.merchantKey !== normalized), json.data]);
      }
    } catch {
      setRecurringOverrides((prev) => prev.filter((row) => row.id !== optimistic.id));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setShowAllRecurring(false);
  }, [activeMonth]);

  const recurringHeuristic = useMemo(() => detectRecurring(recentTxns ?? []), [recentTxns]);
  const confirmedOverrides = useMemo(
    () => recurringOverrides.filter((o) => o.verdict === "confirmed"),
    [recurringOverrides]
  );
  const dismissedKeys = useMemo(
    () => new Set(recurringOverrides.filter((o) => o.verdict === "dismissed").map((o) => normalizedKey(o.merchantKey))),
    [recurringOverrides]
  );
  const confirmedRecurringItems = useMemo(() => {
    return confirmedOverrides
      .map((override) => {
        const match = recurringHeuristic.find((item) => merchantMatches(item.merchant, override.merchantKey));
        const fallback = override.amountAnchor ?? 0;
        return {
          merchant: override.displayName ?? override.merchantKey,
          medianAmount: match?.medianAmount ?? fallback,
          monthCount: match?.monthCount ?? 0
        };
      })
      .sort((a, b) => b.medianAmount - a.medianAmount);
  }, [confirmedOverrides, recurringHeuristic]);
  const suggestedRecurringItems = useMemo(
    () =>
      recurringHeuristic
        .filter((item) => !dismissedKeys.has(normalizedKey(item.merchant)))
        .filter((item) => !confirmedOverrides.some((o) => merchantMatches(item.merchant, o.merchantKey))),
    [confirmedOverrides, dismissedKeys, recurringHeuristic]
  );
  const recurringAll = useMemo(() => [...confirmedRecurringItems, ...suggestedRecurringItems], [
    confirmedRecurringItems,
    suggestedRecurringItems
  ]);
  const recurringVisible = showAllRecurring ? recurringAll : recurringAll.slice(0, 5);
  const recurringTotalMonthly = useMemo(
    () => recurringAll.reduce((acc, item) => acc + item.medianAmount, 0),
    [recurringAll]
  );

  const accountBuckets = useMemo(
    () => (recentTxns ? computeAccountBuckets(recentTxns, activeMonth) : []),
    [recentTxns, activeMonth]
  );
  const priorYearMap = useMemo(() => {
    const map = new Map<string, { outflow: number; count: number }>();
    if (!priorYearTxns) return map;
    const pyMonth = sameMonthPriorYear(activeMonth);
    for (const t of priorYearTxns) {
      if (t.status !== "posted" || t.amount >= 0) continue;
      if (!ACCOUNT_CARD_TYPES.has(t.accountType)) continue;
      if (!t.txnDate.startsWith(pyMonth)) continue;
      const entry = map.get(t.accountId) ?? { outflow: 0, count: 0 };
      entry.outflow += Math.abs(t.amount);
      entry.count += 1;
      map.set(t.accountId, entry);
    }
    return map;
  }, [priorYearTxns, activeMonth]);
  const showAccountModule = !loading && recentTxns !== null;

  const trendData = cashData && cashData !== "error" ? cashData.monthlyTrend : [];
  const trendMax = useMemo(
    () => Math.max(0, ...trendData.flatMap((p) => [p.inflows, p.outflows])),
    [trendData]
  );
  const trendUseK = trendMax >= 1000;
  const slices = cashData && cashData !== "error" ? outflowSlices(cashData) : [];
  const totalOutflows = slices.reduce((acc, s) => acc + s.outflows, 0);

  const cashUnavailable = cashData === "error";
  const monthStart = firstDayOf(activeMonth);
  const monthEnd = lastDayOf(activeMonth);

  const netColor =
    cashData && cashData !== "error"
      ? cashData.household.net > 0
        ? "fsForest"
        : cashData.household.net < 0
          ? "fsTerracotta"
          : "dimmed"
      : "dimmed";

  const savingsLineColor =
    cashData && cashData !== "error"
      ? cashData.household.transactionCount === 0
        ? "dimmed"
        : cashData.household.net < 0
          ? "fsTerracotta"
          : cashData.spendingPower.savingsRate !== null && cashData.spendingPower.savingsRate > 0.2
            ? "fsForest"
            : "dimmed"
      : "dimmed";

  return (
    <Box component="main" w="100%">
      <Paper withBorder p="lg" radius="md" mb="md">
        <Group justify="space-between" align="center" mb="lg">
          <Group gap="sm">
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={() => setActiveMonth((m) => prevMonth(m))}
              disabled={loading}
            >
              ‹
            </Button>
            <Text fw={600} size="lg">
              {formatMonthLabel(activeMonth)}
            </Text>
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={() => setActiveMonth((m) => nextMonth(m))}
              disabled={isCurrentMonth || loading}
            >
              ›
            </Button>
          </Group>
          <Tooltip
            label={cashLastUpdated ? `Last updated ${formatTimeAgo(cashLastUpdated)}` : "Loading..."}
            position="bottom"
            withArrow
          >
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={refreshCashCache}
              aria-label="Refresh dashboard data"
              loading={cashCacheLoading}
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {(loading || cashCacheLoading) && cashData === null ? (
          <GroveCardLoader label="Loading cash flow…" size="sm" />
        ) : cashUnavailable ? (
          <Text ta="center" mb="md" c="dimmed">
            {cashCacheLoading ? (
              "Retrying…"
            ) : (
              <>
                Cash flow unavailable ·{" "}
                <Button type="button" variant="default" size="xs" onClick={loadCashSummary}>
                  Retry
                </Button>
              </>
            )}
          </Text>
        ) : cashData ? (
          <>
            <Text ta="center" fz="2.8rem" fw={700} my={4} c={netColor}>
              {cashData.household.net >= 0 ? "+" : "−"}${formatNoCents(Math.abs(cashData.household.net))}
            </Text>
            <Group justify="center" gap="lg" mt={2} mb={4}>
              <Text size="sm" c="fsForest">
                ↑ ${formatNoCents(cashData.household.inflows)} inflow
              </Text>
              <Text size="sm" c="fsTerracotta">
                ↓ ${formatNoCents(cashData.household.outflows)} outflow
              </Text>
            </Group>
            <Text ta="center" size="sm" c={savingsLineColor}>
              {cashData.household.transactionCount === 0
                ? "No transactions posted yet — import a statement to get started"
                : cashData.spendingPower.savingsRate !== null &&
                    cashData.spendingPower.savingsRate > 0 &&
                    cashData.household.inflows > 0
                  ? `Saved ${Math.round(cashData.spendingPower.savingsRate * 100)}% of income this month`
                  : cashData.household.net < 0
                    ? "Spending exceeded income this month"
                    : ""}
            </Text>
          </>
        ) : null}

        {budgetData?.exists && budgetData.summary.totalBudgeted > 0 ? (
          <Box mt="md">
            <Progress
              value={Math.min(100, (budgetData.summary.totalSpent / budgetData.summary.totalBudgeted) * 100)}
              size="sm"
              color={
                budgetData.summary.totalSpent >= budgetData.summary.totalBudgeted
                  ? "fsTerracotta"
                  : budgetData.summary.totalSpent / budgetData.summary.totalBudgeted >= 0.8
                    ? "fsGold"
                    : "fsForest"
              }
            />
            <Group justify="space-between" mt={6}>
              <Text
                size="sm"
                c={budgetData.summary.totalSpent > budgetData.summary.totalBudgeted ? "fsTerracotta" : "dimmed"}
              >
                {budgetData.summary.totalSpent > budgetData.summary.totalBudgeted
                  ? `Over budget by $${formatNoCents(budgetData.summary.totalSpent - budgetData.summary.totalBudgeted)}`
                  : `$${formatNoCents(budgetData.summary.totalSpent)} spent · ${Math.min(
                      100,
                      Math.round((budgetData.summary.totalSpent / budgetData.summary.totalBudgeted) * 100)
                    )}% of $${formatNoCents(budgetData.summary.totalBudgeted)} budget`}
              </Text>
              <Anchor component={Link} to="/budget" size="sm">
                Manage →
              </Anchor>
            </Group>
          </Box>
        ) : (
          <Text mt="sm" size="sm" c="dimmed">
            No budget set for this month ·{" "}
            <Anchor component={Link} to="/budget">
              Set one up →
            </Anchor>
          </Text>
        )}

        {!loading && cashData && cashData !== "error" && cashData.household.transactionCount > 0 ? (
          <Text mt="xs" size="sm" c="dimmed">
            {cashData.household.transactionCount} posted transactions
          </Text>
        ) : null}
      </Paper>

      {resolutionData?.totalOpen ? (
        <Group gap="sm" mt="md" wrap="wrap">
          {(resolutionData.openByType.unknown_category ?? 0) > 0 ? (
            <Badge
              component={Link}
              to="/transactions?needsReview=true&resolutionType=unknown_category"
              variant="light"
              color="gray"
              size="lg"
              radius="xl"
              leftSection={<IconAlertCircle size={14} stroke={1.75} />}
              style={{ textDecoration: "none", cursor: "pointer" }}
            >
              {resolutionData.openByType.unknown_category} uncategorized
            </Badge>
          ) : null}
          {(resolutionData.openByType.transfer_ambiguity ?? 0) > 0 ? (
            <Badge
              component={Link}
              to="/transactions?needsReview=true&resolutionType=transfer_ambiguity"
              variant="light"
              color="gray"
              size="lg"
              radius="xl"
              leftSection={<IconArrowsExchange size={14} stroke={1.75} />}
              style={{ textDecoration: "none", cursor: "pointer" }}
            >
              {resolutionData.openByType.transfer_ambiguity} transfer
              {resolutionData.openByType.transfer_ambiguity === 1 ? "" : "s"} to pair
            </Badge>
          ) : null}
          {(resolutionData.openByType.duplicate_ambiguity ?? 0) > 0 ? (
            <Badge
              component={Link}
              to="/transactions?needsReview=true&resolutionType=duplicate_ambiguity"
              variant="light"
              color="gray"
              size="lg"
              radius="xl"
              leftSection={<IconCopy size={14} stroke={1.75} />}
              style={{ textDecoration: "none", cursor: "pointer" }}
            >
              {resolutionData.openByType.duplicate_ambiguity} possible duplicate
              {resolutionData.openByType.duplicate_ambiguity === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </Group>
      ) : null}

      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3, lg: 4 }} spacing="md" mt="lg">
        <Paper component="section" withBorder p="md" radius="md">
          {loading ? (
            <GroveCardLoader label="Loading spending…" />
          ) : cashUnavailable ? (
            <Text size="sm" c="dimmed">
              Spending data unavailable
            </Text>
          ) : slices.length === 0 ? (
            <Text size="sm" ta="center" c="dimmed">
              No spending data for this month
            </Text>
          ) : (
            <>
              <Text size="xs" tt="uppercase" fw={500} c="dimmed" mb={4} style={{ letterSpacing: "0.06em" }}>
                Where money went · this month
              </Text>
              <Text fw={700} size="lg" mb="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                ${formatNoCents(totalOutflows)}
              </Text>
              <Stack gap={8} mt="xs">
                {(() => {
                  const sortedSlices = [...slices].sort((a, b) => b.outflows - a.outflows);
                  const maxOut = Math.max(...sortedSlices.map((s) => s.outflows), 1);
                  return sortedSlices.map((slice, idx) => {
                    const pct = (slice.outflows / maxOut) * 100;
                    const color = FS_CAT_PALETTE[idx % FS_CAT_PALETTE.length]!;
                    const href =
                      slice.categoryName === "Other"
                        ? null
                        : slice.categoryId
                          ? `/transactions?categoryId=${slice.categoryId}&dateFrom=${monthStart}&dateTo=${monthEnd}`
                          : `/transactions?uncategorizedOnly=true&dateFrom=${monthStart}&dateTo=${monthEnd}`;
                    return (
                      <Box
                        key={`${slice.categoryName}-${idx}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(80px, 110px) 1fr 72px",
                          alignItems: "center",
                          gap: 10,
                          fontSize: 12.5,
                        }}
                      >
                        <Box style={{ minWidth: 0 }}>
                          {href ? (
                            <Anchor
                              component={Link}
                              to={href}
                              size="sm"
                              underline="hover"
                              style={{
                                display: "block",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {slice.categoryName}
                            </Anchor>
                          ) : (
                            <Text size="sm" truncate title={slice.categoryName}>
                              {slice.categoryName}
                            </Text>
                          )}
                        </Box>
                        <Box
                          style={{
                            height: 10,
                            background: "var(--color-track)",
                            borderRadius: 999,
                            overflow: "hidden",
                          }}
                        >
                          <Box
                            style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: color,
                              borderRadius: 999,
                              transition: "width 240ms ease",
                            }}
                          />
                        </Box>
                        <Text size="sm" ta="right" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                          ${formatNoCents(slice.outflows)}
                        </Text>
                      </Box>
                    );
                  });
                })()}
              </Stack>
            </>
          )}
        </Paper>

        <Paper component="section" withBorder p="md" radius="md">
          <Text size="xs" tt="uppercase" fw={500} c="dimmed" mb="xs" style={{ letterSpacing: "0.06em" }}>
            Net Worth
          </Text>
          {loading ? (
            <GroveCardLoader label="Calculating your net worth…" />
          ) : (
            <>
              <Text
                m={0}
                fz="1.5rem"
                fw={700}
                c={
                  netWorthData?.totals.netWorth == null
                    ? undefined
                    : netWorthData.totals.netWorth >= 0
                      ? "fsForest"
                      : "fsTerracotta"
                }
              >
                {netWorthData?.totals.netWorth == null ? "—" : `$${formatNoCents(netWorthData.totals.netWorth)}`}
              </Text>
              {netWorthData && (netWorthData.totals.assets !== null || netWorthData.totals.liabilities !== null) ? (
                <Text size="sm" c="dimmed" mt="xs">
                  Assets {netWorthData.totals.assets == null ? "—" : `$${formatNoCents(netWorthData.totals.assets)}`} ·
                  Liabilities{" "}
                  {netWorthData.totals.liabilities == null ? "—" : `$${formatNoCents(netWorthData.totals.liabilities)}`}
                </Text>
              ) : null}
              {(() => {
                const points = (netWorthHistory ?? [])
                  .filter(
                    (p): p is NetWorthHistoryPoint & { netWorth: number } =>
                      p != null &&
                      typeof p.date === "string" &&
                      p.date.length > 0 &&
                      typeof p.netWorth === "number" &&
                      Number.isFinite(p.netWorth)
                  )
                  .slice()
                  .sort((a, b) => a.date.localeCompare(b.date));
                const distinctNonZero = new Set(points.map((p) => p.netWorth).filter((v) => v !== 0)).size;
                if (points.length < 2 || distinctNonZero < 2) return null;
                const first = points[0]!.netWorth;
                const last = points[points.length - 1]!.netWorth;
                const stroke = last > first ? FS_FOREST : last < first ? FS_TERRACOTTA : "#6b7280";
                return (
                  <Box w="100%" h={48} mt="xs">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                        <Line
                          type="monotone"
                          dataKey="netWorth"
                          dot={false}
                          strokeWidth={2}
                          stroke={stroke}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </Box>
                );
              })()}
              {netWorthData ? (
                <Text size="sm" c="dimmed" mt="xs">
                  as of {netWorthData.asOf}
                </Text>
              ) : null}
              <Group justify="flex-end" mt="xs">
                <Anchor component={Link} to="/net-worth" size="sm">
                  View details →
                </Anchor>
              </Group>
            </>
          )}
        </Paper>

        <Paper component="section" withBorder p="md" radius="md">
          <Text size="xs" tt="uppercase" fw={500} c="dimmed" mb={2} style={{ letterSpacing: "0.06em" }}>
            Recurring Payments
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            Estimated from repeated charges
          </Text>
          {loading ? (
            <GroveCardLoader label="Detecting recurring payments…" />
          ) : recurringAll.length === 0 ? (
            <Text size="sm" c="dimmed">
              No recurring charges detected yet — import a few months of statements to see patterns
            </Text>
          ) : (
            <>
              <Text fw={600} fz="1.4rem" m={0}>
                ${formatNoCents(recurringTotalMonthly)} / month
              </Text>
              <Text mt={6} size="sm" c="dimmed">
                across {recurringAll.length} recurring charge{recurringAll.length === 1 ? "" : "s"}
              </Text>
              <Stack gap={4} mt="xs">
                {recurringVisible.map((item) => {
                  const isConfirmed = confirmedRecurringItems.some((confirmed) => confirmed.merchant === item.merchant);
                  return (
                    <Group key={item.merchant} justify="space-between" gap={4} wrap="nowrap">
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm">{isConfirmed ? "●" : "○"}</Text>
                        <Text size="sm">
                          {item.merchant} {isConfirmed ? "" : "(Suggested)"}
                        </Text>
                      </Group>
                      <Group gap={8} wrap="nowrap">
                        <Text size="sm">${formatUsd(item.medianAmount)}/mo</Text>
                        {!isConfirmed ? (
                          <Button
                            type="button"
                            variant="subtle"
                            color="gray"
                            size="compact-xs"
                            px={4}
                            onClick={() => void dismissRecurring(item.merchant)}
                            aria-label={`Dismiss recurring suggestion for ${item.merchant}`}
                          >
                            ×
                          </Button>
                        ) : null}
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
              {!showAllRecurring && recurringAll.length > 5 ? (
                <Button
                  type="button"
                  variant="default"
                  size="xs"
                  mt="xs"
                  onClick={() => setShowAllRecurring(true)}
                >
                  + {recurringAll.length - 5} more
                </Button>
              ) : null}
            </>
          )}
        </Paper>

        {showAccountModule ? (
          <Paper component="section" withBorder p="md" radius="md">
            <Tooltip
              label="First arrow = vs last month · second arrow = vs same month last year"
              position="top"
              withArrow
              multiline
              w={290}
            >
              <Text
                size="xs"
                tt="uppercase"
                fw={500}
                c="dimmed"
                mb="xs"
                style={{ letterSpacing: "0.06em", cursor: "help", display: "inline-block" }}
              >
                By Account — This Month
              </Text>
            </Tooltip>
            {accountBuckets.length === 0 ? (
              <Text size="sm" c="dimmed">
                No spending recorded this month for linked accounts.
              </Text>
            ) : (
              <Stack gap={4}>
                {accountBuckets.map((b) => {
                  const momArr = accountArrow(b);
                  const yoyArr = yoyArrow(b, priorYearMap.get(b.accountId));
                  const href = `/transactions?accountId=${b.accountId}&dateFrom=${monthStart}&dateTo=${monthEnd}`;
                  return (
                    <Group key={b.accountId} justify="space-between" gap={4} wrap="nowrap">
                      <Anchor component={Link} to={href} size="sm" underline="hover">
                        {b.name}
                      </Anchor>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm">${formatNoCents(b.thisMonthOutflow)}</Text>
                        {momArr ? (
                          <Tooltip label={`vs ${formatMonthLabel(prevMonth(activeMonth))}`} position="top" withArrow>
                            <Text size="sm" c={momArr.color} fw={600} style={{ cursor: "default" }}>
                              {momArr.char}
                            </Text>
                          </Tooltip>
                        ) : null}
                        {yoyArr ? (
                          <Tooltip label={`vs ${formatMonthLabel(sameMonthPriorYear(activeMonth))}`} position="top" withArrow>
                            <Text size="sm" c={yoyArr.color} fw={600} style={{ cursor: "default" }}>
                              {yoyArr.char}
                            </Text>
                          </Tooltip>
                        ) : null}
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            )}
          </Paper>
        ) : null}
      </SimpleGrid>

      <Box mt="md">
        <FinancialHealthCard />
      </Box>

      <Title order={4} mt="lg" mb="sm" fw={600}>
        6-month trend
      </Title>
      {cashUnavailable ? (
        <Text size="sm" c="dimmed">
          Trend data unavailable
        </Text>
      ) : !loading && trendData.length > 0 ? (
        <Box w="100%" h={220}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tickFormatter={(v) => formatMonthShort(String(v))} />
              <YAxis tickFormatter={(v) => (trendUseK ? `$${(Number(v) / 1000).toFixed(0)}k` : `$${Number(v).toFixed(0)}`)} />
              <RechartsTooltip formatter={(v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
              <Legend />
              <Bar dataKey="inflows" fill={FS_FOREST} name="Income" />
              <Bar dataKey="outflows" fill={FS_TERRACOTTA} name="Spending" />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      ) : null}
    </Box>
  );
}
