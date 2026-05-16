import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GroveCardLoader, GroveLoader } from "../components/GroveLoader";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconPencil, IconX } from "@tabler/icons-react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";

import { apiJson, useAuthToken } from "../api";
import { CurrencyInput } from "../components/CurrencyInput";
import { HelpIcon } from "../components/HelpIcon";

// ── Types ────────────────────────────────────────────────────────────────────

type BudgetSuggestionRow = {
  categoryId: string;
  categoryName: string;
  parentId: string | null;
  parentName: string | null;
  suggestedAmount: number;
  basis: "last_month" | "three_month_avg";
  lastMonthActual: number;
  threeMonthAvg: number;
};

type BudgetCategoryRow = {
  categoryId: string;
  categoryName: string;
  parentName: string | null;
  budgeted: number;
  spent: number;
  remaining: number;
  percentUsed: number;
};

type BudgetResult = {
  month: string;
  exists: boolean;
  summary: {
    totalBudgeted: number;
    totalSpent: number;
    remaining: number;
    unbudgetedSpend: number;
  };
  categories: BudgetCategoryRow[];
};

type SuggestResult = {
  month: string;
  dataAsOf: string | null;
  suggestions: BudgetSuggestionRow[];
};

type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
  isDefault: boolean;
  householdScoped: boolean;
};

/**
 * A group of leaf suggestions under one parent, or a single parent-level
 * entry when all leaves are collapsed into one amount.
 *
 * mode "lump_sum"  → one budget entry for the parent category itself.
 * mode "detailed"  → one budget entry per leaf subcategory.
 */
type SetupGroup = {
  parentId: string;
  parentName: string;
  mode: "lump_sum" | "detailed";
  // lump_sum mode: single amount for the parent category
  lumpAmount: string;
  // detailed mode: one entry per leaf category
  leaves: { categoryId: string; categoryName: string; amount: string }[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(n);
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function shiftMonth(yyyyMm: string, delta: number): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Build SetupGroups from suggestions, grouped by parent. */
function suggestionsToGroups(suggestions: BudgetSuggestionRow[]): SetupGroup[] {
  const byParent = new Map<string, { parentName: string; rows: BudgetSuggestionRow[] }>();
  for (const s of suggestions) {
    const pid = s.parentId ?? s.categoryId; // orphan leaf → its own "group"
    const pname = s.parentName ?? s.categoryName;
    if (!byParent.has(pid)) byParent.set(pid, { parentName: pname, rows: [] });
    byParent.get(pid)!.rows.push(s);
  }
  const groups: SetupGroup[] = [];
  for (const [parentId, { parentName, rows }] of byParent) {
    if (rows.length === 1 && rows[0].parentId === null) {
      // Single root-level leaf — treat as lump sum with its own ID
      groups.push({
        parentId,
        parentName,
        mode: "lump_sum",
        lumpAmount: String(rows[0].suggestedAmount),
        leaves: [{ categoryId: rows[0].categoryId, categoryName: rows[0].categoryName, amount: String(rows[0].suggestedAmount) }]
      });
    } else {
      // Multiple leaves under one parent — default to lump_sum at parent level
      const totalSuggested = rows.reduce((s, r) => s + r.suggestedAmount, 0);
      groups.push({
        parentId,
        parentName,
        mode: "lump_sum",
        lumpAmount: String(Math.round(totalSuggested * 100) / 100),
        leaves: rows.map((r) => ({ categoryId: r.categoryId, categoryName: r.categoryName, amount: String(r.suggestedAmount) }))
      });
    }
  }
  return groups;
}

/** Convert SetupGroups to the flat entries array saved to the backend. */
function groupsToEntries(groups: SetupGroup[]): { categoryId: string; amount: number }[] {
  const out: { categoryId: string; amount: number }[] = [];
  for (const g of groups) {
    if (g.mode === "lump_sum") {
      const amount = parseFloat(g.lumpAmount) || 0;
      if (amount > 0) out.push({ categoryId: g.parentId, amount });
    } else {
      for (const leaf of g.leaves) {
        const amount = parseFloat(leaf.amount) || 0;
        if (amount > 0) out.push({ categoryId: leaf.categoryId, amount });
      }
    }
  }
  return out;
}

/** Convert existing budget rows (from progress view) back to SetupGroups for editing. */
function budgetCategoriesToGroups(
  cats: BudgetCategoryRow[],
  allCategories: CategoryOption[]
): SetupGroup[] {
  const catById = new Map(allCategories.map((c) => [c.id, c]));
  const parentNames = new Map(allCategories.filter((c) => !c.parentId).map((c) => [c.id, c.name]));

  const groups: SetupGroup[] = [];
  for (const cat of cats) {
    const catMeta = catById.get(cat.categoryId);
    const isParentEntry = !catMeta?.parentId; // no parent in category table = it IS a parent
    if (isParentEntry) {
      groups.push({
        parentId: cat.categoryId,
        parentName: cat.categoryName,
        mode: "lump_sum",
        lumpAmount: String(cat.budgeted),
        leaves: []
      });
    } else {
      // Leaf entry — find or create its parent group
      const parentId = catMeta!.parentId!;
      const existing = groups.find((g) => g.parentId === parentId);
      const leaf = { categoryId: cat.categoryId, categoryName: cat.categoryName, amount: String(cat.budgeted) };
      if (existing) {
        existing.leaves.push(leaf);
      } else {
        groups.push({
          parentId,
          parentName: parentNames.get(parentId) ?? cat.parentName ?? parentId,
          mode: "detailed",
          lumpAmount: "0",
          leaves: [leaf]
        });
      }
    }
  }
  return groups;
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(percent, 100);
  const color = percent > 100 ? "fsTerracotta" : percent >= 80 ? "fsGold" : "fsForest";
  return <Progress value={clamped} color={color} size={8} radius="sm" />;
}

// ── Amount input ──────────────────────────────────────────────────────────────

function AmountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = parseFloat(value);
  return (
    <CurrencyInput
      value={Number.isFinite(parsed) ? parsed : undefined}
      onChange={(v) => onChange(v == null ? "" : String(v))}
      placeholder="0.00"
    />
  );
}

// ── Setup form ────────────────────────────────────────────────────────────────

type SetupFormProps = {
  month: string;
  groups: SetupGroup[];
  allCategories: CategoryOption[];
  suggestions: BudgetSuggestionRow[];
  dataAsOf?: string | null;
  onGroupsChange: (groups: SetupGroup[]) => void;
  onSaved: (result: BudgetResult) => void;
};

function SetupForm({ month, groups, allCategories, suggestions, dataAsOf, onGroupsChange, onSaved }: SetupFormProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addSelected, setAddSelected] = useState<string | null>(null);

  const suggestionMap = new Map(suggestions.map((s) => [s.categoryId, s]));
  const catById = new Map(allCategories.map((c) => [c.id, c]));

  // All category IDs already in a group (either as parent or leaf)
  const usedIds = new Set<string>();
  for (const g of groups) {
    usedIds.add(g.parentId);
    g.leaves.forEach((l) => usedIds.add(l.categoryId));
  }

  // Total across all groups
  const total = groups.reduce((sum, g) => {
    if (g.mode === "lump_sum") return sum + (parseFloat(g.lumpAmount) || 0);
    return sum + g.leaves.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  }, 0);

  function setLump(parentId: string, value: string) {
    onGroupsChange(groups.map((g) => (g.parentId === parentId ? { ...g, lumpAmount: value } : g)));
  }

  function setLeafAmount(parentId: string, categoryId: string, value: string) {
    onGroupsChange(
      groups.map((g) =>
        g.parentId === parentId
          ? { ...g, leaves: g.leaves.map((l) => (l.categoryId === categoryId ? { ...l, amount: value } : l)) }
          : g
      )
    );
  }

  function removeGroup(parentId: string) {
    onGroupsChange(groups.filter((g) => g.parentId !== parentId));
  }

  function removeLeaf(parentId: string, categoryId: string) {
    onGroupsChange(
      groups
        .map((g) =>
          g.parentId === parentId ? { ...g, leaves: g.leaves.filter((l) => l.categoryId !== categoryId) } : g
        )
        .filter((g) => g.mode === "lump_sum" || g.leaves.length > 0)
    );
  }

  function toggleExpand(g: SetupGroup) {
    if (g.mode === "lump_sum") {
      // Expand to detailed: distribute lump sum proportionally across leaves based on suggestions
      const lumpVal = parseFloat(g.lumpAmount) || 0;
      const leaves = g.leaves.length > 0 ? g.leaves : buildLeavesForParent(g.parentId);
      // Re-compute individual amounts from suggestions, scaled to the lump sum
      const suggTotal = leaves.reduce((s, l) => s + (parseFloat(suggestionMap.get(l.categoryId)?.suggestedAmount?.toString() ?? "0") || 0), 0);
      const scaledLeaves = leaves.map((l) => {
        const suggested = parseFloat(suggestionMap.get(l.categoryId)?.suggestedAmount?.toString() ?? "0") || 0;
        const share = suggTotal > 0 ? (suggested / suggTotal) * lumpVal : lumpVal / Math.max(leaves.length, 1);
        return { ...l, amount: String(Math.round(share * 100) / 100) };
      });
      onGroupsChange(groups.map((gr) => gr.parentId === g.parentId ? { ...gr, mode: "detailed", leaves: scaledLeaves } : gr));
    } else {
      // Collapse to lump sum: sum up leaf amounts
      const sum = g.leaves.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
      onGroupsChange(groups.map((gr) => gr.parentId === g.parentId ? { ...gr, mode: "lump_sum", lumpAmount: String(Math.round(sum * 100) / 100) } : gr));
    }
  }

  function buildLeavesForParent(parentId: string): { categoryId: string; categoryName: string; amount: string }[] {
    return allCategories
      .filter((c) => c.parentId === parentId)
      .map((c) => ({ categoryId: c.id, categoryName: c.name, amount: String(suggestionMap.get(c.id)?.suggestedAmount ?? 0) }));
  }

  // Available items for "Add" picker: parents not already in a group, or leaves whose parent isn't present
  const availableToAdd = allCategories
    .filter((c) => {
      if (usedIds.has(c.id)) return false;
      // Show parent categories (those without a parentId in category table)
      if (!c.parentId) return true;
      // Show leaf categories only if their parent group isn't already present as a group
      const parentGroup = groups.find((g) => g.parentId === c.parentId);
      return !parentGroup;
    })
    .sort((a, b) => {
      const la = a.parentId ? `${catById.get(a.parentId)?.name ?? ""} > ${a.name}` : a.name;
      const lb = b.parentId ? `${catById.get(b.parentId)?.name ?? ""} > ${b.name}` : b.name;
      return la.localeCompare(lb);
    });

  function handleAdd() {
    if (!addSelected) return;
    const cat = allCategories.find((c) => c.id === addSelected);
    if (!cat) return;
    setAddSelected(null);

    if (!cat.parentId) {
      // Adding a parent category: default lump sum, populate leaves from suggestions
      const leaves = buildLeavesForParent(cat.id);
      const totalSuggested = leaves.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
      onGroupsChange([
        ...groups,
        {
          parentId: cat.id,
          parentName: cat.name,
          mode: "lump_sum",
          lumpAmount: String(Math.round(totalSuggested * 100) / 100),
          leaves
        }
      ]);
    } else {
      // Adding a leaf: find or create its parent group in detailed mode
      const parentCat = catById.get(cat.parentId);
      const existing = groups.find((g) => g.parentId === cat.parentId);
      const newLeaf = { categoryId: cat.id, categoryName: cat.name, amount: String(suggestionMap.get(cat.id)?.suggestedAmount ?? 0) };
      if (existing) {
        // Inject this leaf and switch to detailed mode so it's visible
        onGroupsChange(groups.map((g) =>
          g.parentId === cat.parentId
            ? { ...g, mode: "detailed", leaves: [...g.leaves.filter((l) => l.categoryId !== cat.id), newLeaf] }
            : g
        ));
      } else {
        onGroupsChange([
          ...groups,
          {
            parentId: cat.parentId,
            parentName: parentCat?.name ?? cat.parentId,
            mode: "detailed",
            lumpAmount: "0",
            leaves: [newLeaf]
          }
        ]);
      }
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const entries = groupsToEntries(groups);
      const result = await apiJson<BudgetResult>(`/budget/${month}`, {
        method: "PUT",
        body: JSON.stringify({ entries })
      });
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save budget");
    } finally {
      setSaving(false);
    }
  }

  const helpText = dataAsOf
    ? `Pre-filled from actual spend in ${monthLabel(dataAsOf)}. Expand a row to budget individual sub-categories, or keep the parent total.`
    : "No prior spend data found. Add categories below and set your budgets manually.";

  return (
    <Stack gap="md">
      <Group gap={6}>
        <Text size="sm" c="dimmed">
          {dataAsOf
            ? <><strong>Pre-filled from {monthLabel(dataAsOf)} spend.</strong></>
            : <>No prior spend — add categories manually.</>
          }
        </Text>
        <HelpIcon label={helpText} />
      </Group>

      <Box style={{ overflowX: "auto" }}>
        <Table style={{ tableLayout: "fixed", width: "100%" }} withRowBorders striped="odd" verticalSpacing={6}>
          <colgroup>
            <col style={{ width: "42%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <Table.Thead>
            <Table.Tr>
              <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>Category</Table.Th>
              <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em", textAlign: "right" }}>Last month</Table.Th>
              <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em", textAlign: "right" }}>Your budget</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((g) => {
              const isDetailed = g.mode === "detailed";
              const refTotal = g.leaves.reduce((s, l) => {
                const sug = suggestionMap.get(l.categoryId);
                return s + (sug?.lastMonthActual ?? 0);
              }, 0);
              const refHasThreeMonthAvg = g.leaves.some((l) => suggestionMap.get(l.categoryId)?.basis === "three_month_avg");

              return [
                // Parent / group header row
                <Table.Tr key={`group-${g.parentId}`}>
                  <Table.Td py="xs" pl={0}>
                    <Group gap={6} wrap="nowrap">
                      {(isDetailed || g.leaves.length > 0) ? (
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="xs"
                          onClick={() => toggleExpand(g)}
                          title={isDetailed ? "Collapse to total" : "Expand sub-categories"}
                        >
                          {isDetailed ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                        </ActionIcon>
                      ) : <Box w={22} style={{ display: "inline-block" }} />}
                      <Text fw={600} size="sm">{g.parentName}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    <Text size="xs" c="dimmed">
                      {refTotal > 0
                        ? <>{fmtUSD(refTotal)}{refHasThreeMonthAvg ? <Text span title="Includes 3-month average for some sub-categories"> *</Text> : null}</>
                        : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {isDetailed ? (
                      <Text size="sm" c="dimmed">
                        {fmtUSD(g.leaves.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0))}
                      </Text>
                    ) : (
                      <AmountInput value={g.lumpAmount} onChange={(v) => setLump(g.parentId, v)} />
                    )}
                  </Table.Td>
                  <Table.Td style={{ textAlign: "center", verticalAlign: "middle" }}>
                    {!isDetailed && (
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={() => removeGroup(g.parentId)}
                        title="Remove"
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>,

                // Sub-category rows when expanded
                ...(isDetailed ? g.leaves.map((leaf) => {
                  const sug = suggestionMap.get(leaf.categoryId);
                  return (
                    <Table.Tr key={`leaf-${leaf.categoryId}`}>
                      <Table.Td py="xs" pl={36}>
                        <Text size="sm">{leaf.categoryName}</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text size="xs" c="dimmed">
                          {sug
                            ? sug.basis === "three_month_avg"
                              ? <>{fmtUSD(sug.lastMonthActual)} <Text span size="xs" title="3-month average">(avg {fmtUSD(sug.threeMonthAvg)})</Text></>
                              : fmtUSD(sug.lastMonthActual)
                            : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <AmountInput value={leaf.amount} onChange={(v) => setLeafAmount(g.parentId, leaf.categoryId, v)} />
                      </Table.Td>
                      <Table.Td style={{ textAlign: "center", verticalAlign: "middle" }}>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          onClick={() => removeLeaf(g.parentId, leaf.categoryId)}
                          title="Remove sub-category"
                        >
                          <IconX size={14} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  );
                }) : [])
              ];
            })}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td colSpan={4} pt="md" pb="xs">
                {availableToAdd.length > 0 && (
                  <Group gap="xs">
                    <Select
                      value={addSelected}
                      onChange={setAddSelected}
                      data={availableToAdd.map((c) => ({
                        value: c.id,
                        label: c.parentId ? `${catById.get(c.parentId)?.name ?? ""} › ${c.name}` : c.name
                      }))}
                      placeholder="+ Add a category…"
                      size="xs"
                      style={{ flex: 1, maxWidth: 340 }}
                      clearable
                    />
                    <Button size="xs" onClick={handleAdd} disabled={!addSelected}>
                      Add
                    </Button>
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
            <Table.Tr style={{ borderTop: "2px solid var(--mantine-color-gray-3)" }}>
              <Table.Td pl={0} pt="md" pb="xs" fw={600}>Total</Table.Td>
              <Table.Td />
              <Table.Td style={{ textAlign: "right" }} pt="md" pb="xs" fw={600}>{fmtUSD(total)}</Table.Td>
              <Table.Td />
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Box>

      {error && <Text c="red" size="sm">{error}</Text>}

      <Group gap="md" align="center">
        <Button
          onClick={() => void handleSave()}
          disabled={saving || groups.length === 0}
          loading={saving}
        >
          {saving ? "Saving…" : `Save budget for ${monthLabel(month)}`}
        </Button>
        {groups.length === 0 && (
          <Text size="sm" c="dimmed">Add at least one category to save.</Text>
        )}
      </Group>
    </Stack>
  );
}

// ── Progress view ─────────────────────────────────────────────────────────────

function ProgressView({ budget, onEdit }: { budget: BudgetResult; onEdit: () => void }) {
  const { summary, categories, month } = budget;
  const monthStart = `${month}-01`;
  const [yr, mo] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(yr, mo, 0)).toISOString().slice(0, 10);

  // Group categories by parent for visual grouping
  const grouped: { parentName: string | null; cats: BudgetCategoryRow[] }[] = [];
  for (const cat of categories) {
    const key = cat.parentName ?? null;
    const existing = grouped.find((g) => g.parentName === key);
    if (existing) existing.cats.push(cat);
    else grouped.push({ parentName: key, cats: [cat] });
  }

  const kpiCards = [
    {
      label: "Budgeted",
      value: fmtUSD(summary.totalBudgeted),
      textColor: "var(--mantine-color-text)",
      borderColor: "var(--mantine-color-gray-4)"
    },
    {
      label: "Spent",
      value: fmtUSD(summary.totalSpent),
      textColor: summary.totalSpent > summary.totalBudgeted ? "var(--fs-terracotta)" : "var(--mantine-color-text)",
      borderColor: summary.totalSpent > summary.totalBudgeted ? "var(--fs-terracotta)" : "var(--mantine-color-gray-4)"
    },
    {
      label: summary.remaining >= 0 ? "Remaining" : "Over budget",
      value: fmtUSD(Math.abs(summary.remaining)),
      textColor: summary.remaining < 0 ? "var(--fs-terracotta)" : "var(--fs-forest)",
      borderColor: summary.remaining < 0 ? "var(--fs-terracotta)" : "var(--fs-forest)"
    }
  ];

  return (
    <Stack gap="md">
      {/* Summary KPI cards */}
      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }}>
        {kpiCards.map(({ label, value, textColor, borderColor }) => (
          <Paper key={label} p="md" withBorder radius="md" style={{ textAlign: "center", borderTop: `3px solid ${borderColor}` }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={500} mb={4} style={{ letterSpacing: "0.04em" }}>{label}</Text>
            <Text size="xl" fw={700} style={{ color: textColor }}>{value}</Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Box style={{ overflowX: "auto" }}>
        <Table withRowBorders striped="odd" verticalSpacing={6} style={{ width: "100%" }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em", minWidth: 140 }}>Category</Table.Th>
              <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em", minWidth: 160 }}>Progress</Table.Th>
              <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em", textAlign: "right" }}>Spent</Table.Th>
              <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em", textAlign: "right" }}>Budget</Table.Th>
              <Table.Th fz={11} tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em", textAlign: "right", minWidth: 80 }}>Left / Over</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {grouped.map(({ parentName, cats }) => {
              const showParentHeader = cats.length > 1 && parentName !== null;
              return cats.map((cat, i) => {
                const txnUrl = `/transactions?categoryId=${cat.categoryId}&dateFrom=${monthStart}&dateTo=${lastDay}`;
                const isOver = cat.remaining < 0;
                const isParentEntry = cat.parentName === null;
                return (
                  <Table.Tr key={cat.categoryId}>
                    <Table.Td
                      pl={isParentEntry || !showParentHeader ? 0 : "xl"}
                      pt={i === 0 && showParentHeader ? "sm" : "xs"}
                      pb="xs"
                    >
                      {i === 0 && showParentHeader && (
                        <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4} style={{ letterSpacing: "0.04em" }}>
                          {parentName}
                        </Text>
                      )}
                      <Link to={txnUrl} style={{ fontWeight: 500, textDecoration: "none", color: "inherit", fontSize: 14 }}>
                        {cat.categoryName}
                      </Link>
                      {isParentEntry && cat.categoryName !== parentName && cat.categoryName && (
                        <Text size="xs" c="dimmed" mt={1}>all sub-categories</Text>
                      )}
                    </Table.Td>
                    <Table.Td py="xs">
                      <Group gap={8} wrap="nowrap">
                        <Box style={{ flex: 1 }}><ProgressBar percent={cat.percentUsed} /></Box>
                        <Text size="xs" c="dimmed" w={42} ta="right">{cat.percentUsed}%</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>
                      <Text size="sm">{fmtUSD(cat.spent)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>
                      <Text size="sm" c="dimmed">{fmtUSD(cat.budgeted)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>
                      <Text
                        size="sm"
                        fw={600}
                        style={{ color: isOver ? "var(--fs-terracotta)" : "var(--fs-forest)" }}
                      >
                        {isOver ? `-${fmtUSD(Math.abs(cat.remaining))}` : fmtUSD(cat.remaining)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              });
            })}
          </Table.Tbody>
        </Table>
      </Box>

      {summary.unbudgetedSpend > 0 && (
        <Text size="sm" c="dimmed">
          +{fmtUSD(summary.unbudgetedSpend)} spent in categories not in this budget.{" "}
          <Link to={`/transactions?dateFrom=${monthStart}&dateTo=${lastDay}`} style={{ color: "var(--mantine-color-blue-6)" }}>
            View transactions
          </Link>
        </Text>
      )}

      <Group>
        <Button variant="default" leftSection={<IconPencil size={14} />} onClick={onEdit}>
          Edit budget
        </Button>
      </Group>
    </Stack>
  );
}

// ── Nav button ────────────────────────────────────────────────────────────────

function NavBtn({ onClick, direction, title }: { onClick: () => void; direction: "prev" | "next"; title: string }) {
  return (
    <ActionIcon variant="default" onClick={onClick} title={title} size="md">
      {direction === "prev" ? <IconChevronLeft size={16} /> : <IconChevronRight size={16} />}
    </ActionIcon>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BudgetPage() {
  const token = useAuthToken();

  const [month, setMonth] = useState(currentMonth);
  const [budget, setBudget] = useState<BudgetResult | null>(null);
  const [suggestions, setSuggestions] = useState<BudgetSuggestionRow[] | null>(null);
  const [allCategories, setAllCategories] = useState<CategoryOption[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Groups for the setup/edit form — owned here so initialization from async
  // suggestions is reliable (useState initializer only runs once at mount).
  const [groups, setGroups] = useState<SetupGroup[]>([]);

  // Load all categories once for the "add category" picker
  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const res = await apiJson<{ categories: CategoryOption[] }>("/categories");
        setAllCategories(res.categories);
      } catch {
        // non-fatal
      }
    })();
  }, [token]);

  const loadBudget = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    setBudget(null);
    setSuggestions(null);
    setDataAsOf(null);
    setGroups([]);
    try {
      const result = await apiJson<BudgetResult>(`/budget/${m}`);
      if (!result.exists) {
        const suggestResult = await apiJson<SuggestResult>(`/budget/suggest?month=${m}`);
        setSuggestions(suggestResult.suggestions);
        setDataAsOf(suggestResult.dataAsOf);
        setGroups(suggestionsToGroups(suggestResult.suggestions));
      }
      setBudget(result);
      setEditMode(!result.exists);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load budget");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadBudget(month);
  }, [token, month, loadBudget]);

  const handleEdit = useCallback(async () => {
    if (!budget) return;
    setGroups(budgetCategoriesToGroups(budget.categories, allCategories));
    // Load suggestions for reference column
    if (!suggestions) {
      try {
        const res = await apiJson<SuggestResult>(`/budget/suggest?month=${month}`);
        setSuggestions(res.suggestions);
        setDataAsOf(res.dataAsOf);
      } catch {
        // non-fatal — reference column shows "—"
      }
    }
    setEditMode(true);
  }, [budget, month, suggestions, allCategories]);

  const handleSaved = useCallback((result: BudgetResult) => {
    setBudget(result);
    setEditMode(false);
    setGroups([]);
  }, []);

  const handleMonthNav = useCallback((delta: number) => {
    setMonth((m) => shiftMonth(m, delta));
  }, []);

  if (!token) return null;

  const setupReady = budget !== null && !budget.exists && suggestions !== null;
  const progressReady = budget !== null && budget.exists && !editMode;
  const editReady = budget !== null && budget.exists && editMode;

  return (
    <Stack style={{ padding: "1.5rem", maxWidth: 860, margin: "0 auto" }} gap="xl">
      {/* Page header */}
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap={8}>
          <Title order={2} size="h3">Budget</Title>
          <HelpIcon label="Set monthly spending targets per category. In setup mode, amounts are pre-filled from recent spend. Switch to Progress to track actuals vs. budget in real time." />
        </Group>
        <Group gap={4}>
          <NavBtn onClick={() => handleMonthNav(-1)} direction="prev" title="Previous month" />
          <Text fw={600} w={150} ta="center" size="md">{monthLabel(month)}</Text>
          <NavBtn onClick={() => handleMonthNav(1)} direction="next" title="Next month" />
        </Group>
      </Group>

      {loading && <GroveCardLoader label="Loading budget…" size="lg" speed="slow" />}
      {error && <Text c="red">{error}</Text>}

      {/* Setup: new budget for this month */}
      {!loading && !error && setupReady && (
        <Paper p="md" withBorder radius="md">
          <Title order={3} size="h5" mb="md">Set up budget — {monthLabel(month)}</Title>
          <SetupForm
            month={month}
            groups={groups}
            allCategories={allCategories}
            suggestions={suggestions}
            dataAsOf={dataAsOf}
            onGroupsChange={setGroups}
            onSaved={handleSaved}
          />
        </Paper>
      )}

      {/* Edit: update existing budget */}
      {!loading && !error && editReady && (
        <Paper p="md" withBorder radius="md">
          <Title order={3} size="h5" mb="md">Edit budget — {monthLabel(month)}</Title>
          <SetupForm
            month={month}
            groups={groups}
            allCategories={allCategories}
            suggestions={suggestions ?? []}
            onGroupsChange={setGroups}
            onSaved={handleSaved}
          />
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            mt="xs"
            onClick={() => setEditMode(false)}
          >
            Cancel
          </Button>
        </Paper>
      )}

      {/* Progress view */}
      {!loading && !error && progressReady && (
        <Paper p="md" withBorder radius="md">
          <ProgressView budget={budget} onEdit={() => void handleEdit()} />
        </Paper>
      )}

      {/* Waiting for suggestions */}
      {!loading && !error && budget !== null && !budget.exists && suggestions === null && (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading suggestions…</Text>
        </Group>
      )}
    </Stack>
  );
}
