import {
  ActionIcon,
  Box,
  Button,
  Group,
  Paper,
  Skeleton,
  Stack,
  Tabs,
  Text
} from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { apiJson } from "../api";
import { FS_CAT_PALETTE, FS_FOREST, FS_TERRACOTTA } from "../theme/chartPalette";

export type LedgerAggregateSummary = {
  count: number;
  net: number;
  inflows: number;
  outflows: number;
  avgAbsolute: number;
  byCategory: Array<{ label: string; value: number; categoryId: string | null }>;
  byMerchant: Array<{ label: string; value: number }>;
  byAccount: Array<{ label: string; value: number; accountId: string }>;
  byMonth: Array<{ label: string; value: number; net: number }>;
  dateFirst: string | null;
  dateLast: string | null;
};

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdPlain(value: number): string {
  return `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdAbs(value: number): string {
  return `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(y, m - 1, d)
  );
}

function formatDateSpan(first: string | null, last: string | null): string {
  if (!first || !last) return "—";
  const [fy, fm, fd] = first.split("-").map((x) => Number(x));
  const [ly, lm, ld] = last.split("-").map((x) => Number(x));
  if (!fy || !fm || !fd || !ly || !lm || !ld) return "—";
  const sameYear = fy === ly;
  const startFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" })
  }).format(new Date(fy, fm - 1, fd));
  const endFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(ly, lm - 1, ld)
  );
  return `${startFmt} – ${endFmt}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map((x) => Number(x));
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(y, m - 1, 1));
}

type RankedRow = { label: string; value: number; net?: number };

function RankedBars({
  rows,
  colorForIndex,
  signedAmount = false,
  secondaryNet = false
}: {
  rows: RankedRow[];
  colorForIndex: (idx: number, row: RankedRow) => string;
  signedAmount?: boolean;
  secondaryNet?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No data
      </Text>
    );
  }
  const maxOut = Math.max(...rows.map((s) => Math.abs(s.value)), 1);
  return (
    <Stack gap={8} mt="xs">
      {rows.map((row, idx) => {
        const pct = (Math.abs(row.value) / maxOut) * 100;
        const color = colorForIndex(idx, row);
        return (
          <Box
            key={`${row.label}-${idx}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(80px, 140px) 1fr 80px",
              alignItems: "center",
              gap: 10,
              fontSize: 12.5
            }}
          >
            <Text size="sm" truncate title={row.label}>
              {row.label}
            </Text>
            <Box
              style={{
                height: 10,
                background: "var(--color-track)",
                borderRadius: 999,
                overflow: "hidden"
              }}
            >
              <Box
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: color,
                  borderRadius: 999,
                  transition: "width 240ms ease"
                }}
              />
            </Box>
            <Box ta="right">
              <Text
                size="sm"
                c={signedAmount ? (row.value >= 0 ? "fsForest" : "fsTerracotta") : "dimmed"}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {signedAmount ? formatUsd(row.value) : formatUsdAbs(row.value)}
              </Text>
              {secondaryNet && row.net != null ? (
                <Text
                  size="xs"
                  c={row.net >= 0 ? "fsForest" : "fsTerracotta"}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatUsd(row.net)}
                </Text>
              ) : null}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

function BreakdownTab({
  rows,
  limit = 8,
  colorForIndex,
  signedAmount = false,
  secondaryNet = false
}: {
  rows: RankedRow[];
  limit?: number;
  colorForIndex: (idx: number, row: RankedRow) => string;
  signedAmount?: boolean;
  secondaryNet?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, limit);
  return (
    <>
      <RankedBars rows={visible} colorForIndex={colorForIndex} signedAmount={signedAmount} secondaryNet={secondaryNet} />
      {rows.length > limit ? (
        <Button variant="subtle" size="compact-xs" mt="xs" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show top 8" : `Show all (${rows.length})`}
        </Button>
      ) : null}
    </>
  );
}

export function TransactionAggregateSummary({
  filterQs,
  hasActiveFilters
}: {
  filterQs: string;
  hasActiveFilters: boolean;
}) {
  const [data, setData] = useState<LedgerAggregateSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!hasActiveFilters) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void apiJson<LedgerAggregateSummary>(`/transactions/aggregate?${filterQs}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load summary");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filterQs, hasActiveFilters]);

  useEffect(() => {
    if (hasActiveFilters) setExpanded(true);
    else setExpanded(false);
  }, [hasActiveFilters]);

  const byCategory = useMemo(
    () => [...(data?.byCategory ?? [])].sort((a, b) => b.value - a.value),
    [data?.byCategory]
  );
  const byMerchant = useMemo(
    () =>
      [...(data?.byMerchant ?? [])]
        .sort((a, b) => b.value - a.value)
        .map((r) => ({
          label: r.label ? r.label.charAt(0).toUpperCase() + r.label.slice(1) : r.label,
          value: r.value
        })),
    [data?.byMerchant]
  );
  const byAccount = useMemo(
    () => [...(data?.byAccount ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    [data?.byAccount]
  );
  const byMonthAll = useMemo(
    () => [...(data?.byMonth ?? [])].sort((a, b) => a.label.localeCompare(b.label)),
    [data?.byMonth]
  );
  const byMonth = useMemo(() => byMonthAll.slice(-6), [byMonthAll]);
  const byMonthTotalCount = byMonthAll.length;
  const byMonthIsCapped = byMonthTotalCount > 6;

  if (!hasActiveFilters && !data) return null;
  if (data && !loading && data.count === 0) return null;

  const countLabel = data ? `${data.count.toLocaleString("en-US")} transaction${data.count === 1 ? "" : "s"}` : "…";

  return (
    <Paper withBorder p="md" radius="md" mb="sm">
      <Group justify="space-between" align="center" mb={expanded ? "sm" : 0}>
        <Text size="sm" fw={600}>
          Summary ({countLabel})
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={expanded ? "Collapse summary" : "Expand summary"}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </ActionIcon>
      </Group>

      {expanded ? (
        error ? (
          <Text c="dimmed" size="sm">
            Could not load summary.
          </Text>
        ) : (
          <>
            <Group justify="space-between" wrap="nowrap" align="flex-start" gap="lg">
              <Stack gap={2}>
                <Text
                  size="xs"
                  tt="uppercase"
                  fw={600}
                  c="dimmed"
                  style={{ letterSpacing: "0.08em" }}
                  title="Inflows minus outflows for the entire filtered set (all pages)"
                >
                  Net
                </Text>
                {loading ? (
                  <Skeleton height={28} width={100} />
                ) : (
                  <Text
                    fw={700}
                    size="xl"
                    c={data && data.net >= 0 ? "fsForest" : "fsTerracotta"}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {data ? formatUsd(data.net) : "—"}
                  </Text>
                )}
              </Stack>
              <Stack gap={2}>
                <Text
                  size="xs"
                  tt="uppercase"
                  fw={600}
                  c="dimmed"
                  style={{ letterSpacing: "0.08em" }}
                  title="Sum of all credits (positive amounts) in the filtered set"
                >
                  Inflows
                </Text>
                {loading ? (
                  <Skeleton height={20} width={80} />
                ) : (
                  <Text c="fsForest" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {data ? formatUsdPlain(data.inflows) : "—"}
                  </Text>
                )}
              </Stack>
              <Stack gap={2}>
                <Text
                  size="xs"
                  tt="uppercase"
                  fw={600}
                  c="dimmed"
                  style={{ letterSpacing: "0.08em" }}
                  title="Total spend (debit magnitude) in the filtered set"
                >
                  Outflows
                </Text>
                {loading ? (
                  <Skeleton height={20} width={80} />
                ) : (
                  <Text c="fsTerracotta" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {data ? formatUsdPlain(data.outflows) : "—"}
                  </Text>
                )}
              </Stack>
              <Stack gap={2}>
                <Text
                  size="xs"
                  tt="uppercase"
                  fw={600}
                  c="dimmed"
                  style={{ letterSpacing: "0.08em" }}
                  title="Average absolute transaction amount across the filtered set"
                >
                  Avg
                </Text>
                {loading ? (
                  <Skeleton height={20} width={80} />
                ) : (
                  <Text c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {data ? `${formatUsdAbs(data.avgAbsolute)}/txn` : "—"}
                  </Text>
                )}
              </Stack>
              <Stack gap={2}>
                <Text
                  size="xs"
                  tt="uppercase"
                  fw={600}
                  c="dimmed"
                  style={{ letterSpacing: "0.08em" }}
                  title="Date range of the earliest to latest transaction in the filtered set"
                >
                  Date span
                </Text>
                {loading ? (
                  <Skeleton height={20} width={120} />
                ) : (
                  <Text c="dimmed" size="sm">
                    {data ? formatDateSpan(data.dateFirst, data.dateLast) : "—"}
                  </Text>
                )}
              </Stack>
            </Group>

            {data && data.count > 1 ? (
              <Group gap="xl" mt={6}>
                {data.byCategory.length > 0 ? (
                  <Text size="xs" c="dimmed">
                    <Text span fw={600} c="inherit">
                      {data.byCategory.length}
                    </Text>{" "}
                    {data.byCategory.length === 1 ? "category" : "categories"}
                  </Text>
                ) : null}
                {data.byAccount.length > 0 ? (
                  <Text size="xs" c="dimmed">
                    <Text span fw={600} c="inherit">
                      {data.byAccount.length}
                    </Text>{" "}
                    {data.byAccount.length === 1 ? "account" : "accounts"}
                  </Text>
                ) : null}
                {byMonthTotalCount > 0 ? (
                  <Text size="xs" c="dimmed">
                    <Text span fw={600} c="inherit">
                      {byMonthTotalCount}
                    </Text>{" "}
                    {byMonthTotalCount === 1 ? "month" : "months"}
                  </Text>
                ) : null}
              </Group>
            ) : null}

            {data && data.count === 1 ? null : (
              <Tabs defaultValue="category" mt="md">
                <Tabs.List>
                  <Tabs.Tab value="category">By category</Tabs.Tab>
                  <Tabs.Tab value="merchant">By merchant</Tabs.Tab>
                  <Tabs.Tab value="account">By account</Tabs.Tab>
                  {byMonthTotalCount > 1 ? <Tabs.Tab value="month">By month</Tabs.Tab> : null}
                </Tabs.List>
                <Tabs.Panel value="category" pt="sm">
                  <BreakdownTab
                    rows={byCategory}
                    colorForIndex={(idx) => FS_CAT_PALETTE[idx % FS_CAT_PALETTE.length]!}
                  />
                </Tabs.Panel>
                <Tabs.Panel value="merchant" pt="sm">
                  <BreakdownTab
                    rows={byMerchant}
                    colorForIndex={(idx) => FS_CAT_PALETTE[idx % FS_CAT_PALETTE.length]!}
                  />
                </Tabs.Panel>
                <Tabs.Panel value="account" pt="sm">
                  <RankedBars
                    rows={byAccount}
                    signedAmount
                    colorForIndex={(_idx, row) => (row.value >= 0 ? FS_FOREST : FS_TERRACOTTA)}
                  />
                </Tabs.Panel>
                {byMonthTotalCount > 1 ? (
                  <Tabs.Panel value="month" pt="sm">
                    {byMonthIsCapped ? (
                      <Text c="dimmed" size="xs" mb={6}>
                        Showing last 6 of {byMonthTotalCount} months
                        {byMonthAll[0] ? ` · earliest: ${formatMonthLabel(byMonthAll[0].label)}` : ""}
                      </Text>
                    ) : null}
                    <RankedBars
                      rows={byMonth.map((m) => ({ label: formatMonthLabel(m.label), value: m.value, net: m.net }))}
                      secondaryNet
                      colorForIndex={() => FS_TERRACOTTA}
                    />
                  </Tabs.Panel>
                ) : null}
              </Tabs>
            )}
          </>
        )
      ) : null}
    </Paper>
  );
}
