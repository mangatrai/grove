import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { IconChevronLeft, IconChevronRight, IconPencil } from "@tabler/icons-react";

import { apiJson, useAuthToken } from "../api";
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
  const color = percent > 100 ? "var(--color-danger)" : percent >= 80 ? "var(--color-warning)" : "var(--color-success)";
  return (
    <div style={{ background: "var(--color-border)", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${clamped}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }} />
    </div>
  );
}

// ── Setup form ────────────────────────────────────────────────────────────────

function AmountInput({
  value,
  onChange,
  style
}: {
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
      <span style={{ color: "var(--color-text-muted)" }}>$</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 90,
          textAlign: "right",
          border: "1px solid var(--color-border)",
          borderRadius: 4,
          padding: "0.2rem 0.4rem",
          fontSize: 14,
          ...style
        }}
      />
    </div>
  );
}

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
  const selectRef = useRef<HTMLSelectElement>(null);
  const [addSelected, setAddSelected] = useState("");

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
    setAddSelected("");

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

  const colW = { cat: "40%", ref: "20%", budget: "25%", act: "15%" };
  const hintStyle: React.CSSProperties = { fontSize: "0.78rem", color: "var(--color-text-muted)" };

  const helpText = dataAsOf
    ? `Pre-filled from actual spend in ${monthLabel(dataAsOf)}. Expand a row to budget individual sub-categories, or keep the parent total.`
    : "No prior spend data found. Add categories below and set your budgets manually.";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "0.75rem" }}>
        <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          {dataAsOf
            ? <>Pre-filled from <strong>{monthLabel(dataAsOf)}</strong> spend.</>
            : <>No prior spend — add categories manually.</>
          }
        </span>
        <HelpIcon label={helpText} />
      </div>

      <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: colW.cat }} />
          <col style={{ width: colW.ref }} />
          <col style={{ width: colW.budget }} />
          <col style={{ width: colW.act }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-border)", textAlign: "left" }}>
            <th style={{ padding: "0.5rem 0.5rem 0.5rem 0" }}>Category</th>
            <th style={{ padding: "0.5rem 0.5rem", textAlign: "right", ...hintStyle }}>Last month</th>
            <th style={{ padding: "0.5rem 0.5rem", textAlign: "right" }}>Your budget</th>
            <th style={{ padding: "0.5rem 0", width: 56 }}></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isDetailed = g.mode === "detailed";
            // Reference figure: sum of suggestions (or nothing if adding manually)
            const refTotal = g.leaves.reduce((s, l) => {
              const sug = suggestionMap.get(l.categoryId);
              return s + (sug?.lastMonthActual ?? 0);
            }, 0);
            const refHasThreeMonthAvg = g.leaves.some((l) => suggestionMap.get(l.categoryId)?.basis === "three_month_avg");

            return [
              // Parent / group header row
              <tr
                key={`group-${g.parentId}`}
                style={{
                  borderBottom: isDetailed ? "none" : "1px solid var(--color-border)",
                  background: isDetailed ? "var(--color-surface-alt, #f8f9fa)" : undefined
                }}
              >
                <td style={{ padding: "0.55rem 0.5rem 0.55rem 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {/* Expand/collapse toggle — only shown when leaves are available */}
                    {(isDetailed || g.leaves.length > 0) ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(g)}
                        title={isDetailed ? "Collapse to total" : "Expand sub-categories"}
                        style={{
                          background: "none",
                          border: "1px solid var(--color-border)",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 11,
                          lineHeight: 1,
                          padding: "0.15rem 0.4rem",
                          color: "var(--color-text-muted)",
                          fontWeight: 600
                        }}
                      >
                        {isDetailed ? "▲" : "▼"}
                      </button>
                    ) : <span style={{ width: 22, display: "inline-block" }} />}
                    <span style={{ fontWeight: 600 }}>{g.parentName}</span>
                  </div>
                </td>
                <td style={{ padding: "0.55rem 0.5rem", textAlign: "right", ...hintStyle }}>
                  {refTotal > 0
                    ? <>{fmtUSD(refTotal)}{refHasThreeMonthAvg ? <span title="Includes 3-month average for some sub-categories"> *</span> : null}</>
                    : "—"}
                </td>
                <td style={{ padding: "0.55rem 0.5rem", textAlign: "right" }}>
                  {isDetailed ? (
                    <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                      {fmtUSD(g.leaves.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0))}
                    </span>
                  ) : (
                    <AmountInput value={g.lumpAmount} onChange={(v) => setLump(g.parentId, v)} />
                  )}
                </td>
                <td style={{ padding: "0.25rem 0", textAlign: "center" }}>
                  {!isDetailed && (
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => removeGroup(g.parentId)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: 16, padding: "0.1rem 0.3rem" }}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>,

              // Sub-category rows when expanded
              ...(isDetailed ? g.leaves.map((leaf) => {
                const sug = suggestionMap.get(leaf.categoryId);
                return (
                  <tr key={`leaf-${leaf.categoryId}`} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "0.4rem 0.5rem 0.4rem 2.25rem", fontSize: 13 }}>
                      {leaf.categoryName}
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", ...hintStyle }}>
                      {sug
                        ? sug.basis === "three_month_avg"
                          ? <>{fmtUSD(sug.lastMonthActual)} <span title="3-month average">(avg {fmtUSD(sug.threeMonthAvg)})</span></>
                          : fmtUSD(sug.lastMonthActual)
                        : "—"}
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                      <AmountInput value={leaf.amount} onChange={(v) => setLeafAmount(g.parentId, leaf.categoryId, v)} />
                    </td>
                    <td style={{ padding: "0.25rem 0", textAlign: "center" }}>
                      <button
                        type="button"
                        title="Remove sub-category"
                        onClick={() => removeLeaf(g.parentId, leaf.categoryId)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: 16, padding: "0.1rem 0.3rem" }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              }) : [])
            ];
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ paddingTop: "0.75rem", paddingBottom: "0.25rem" }}>
              {availableToAdd.length > 0 && (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <select
                    ref={selectRef}
                    value={addSelected}
                    onChange={(e) => setAddSelected(e.target.value)}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      padding: "0.3rem 0.5rem",
                      fontSize: 13,
                      flex: 1,
                      maxWidth: 340,
                      color: addSelected ? "var(--color-text)" : "var(--color-text-muted)"
                    }}
                  >
                    <option value="">+ Add a category…</option>
                    {availableToAdd.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parentId ? `${catById.get(c.parentId)?.name ?? ""} › ${c.name}` : c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!addSelected}
                    style={{
                      background: addSelected ? "var(--color-accent)" : "var(--color-border)",
                      color: addSelected ? "#fff" : "var(--color-text-muted)",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.3rem 0.85rem",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: addSelected ? "pointer" : "default"
                    }}
                  >
                    Add
                  </button>
                </div>
              )}
            </td>
          </tr>
          <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 600 }}>
            <td style={{ padding: "0.75rem 0.5rem 0.5rem 0" }}>Total</td>
            <td />
            <td style={{ padding: "0.75rem 0.5rem 0.5rem", textAlign: "right" }}>{fmtUSD(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      </div>

      {error ? <p style={{ color: "#dc2626", marginTop: "0.75rem" }}>{error}</p> : null}

      <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || groups.length === 0}
          style={{
            background: "var(--color-accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "0.5rem 1.25rem",
            fontWeight: 600,
            cursor: saving || groups.length === 0 ? "default" : "pointer",
            opacity: saving || groups.length === 0 ? 0.6 : 1
          }}
        >
          {saving ? "Saving…" : `Save budget for ${monthLabel(month)}`}
        </button>
        {groups.length === 0 && (
          <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Add at least one category to save.</span>
        )}
      </div>
    </div>
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

  return (
    <div>
      {/* Summary KPI cards */}
      <div className="budget-kpi-grid">
        {(
          [
            { label: "Budgeted", value: fmtUSD(summary.totalBudgeted), accent: "var(--color-text-muted)" },
            { label: "Spent", value: fmtUSD(summary.totalSpent), accent: summary.totalSpent > summary.totalBudgeted ? "var(--color-danger)" : "var(--color-text)" },
            {
              label: summary.remaining >= 0 ? "Remaining" : "Over budget",
              value: fmtUSD(Math.abs(summary.remaining)),
              accent: summary.remaining < 0 ? "var(--color-danger)" : "var(--color-success)"
            }
          ] as const
        ).map(({ label, value, accent }) => (
          <div key={label} className="card" style={{ marginBottom: 0, textAlign: "center", borderTop: `3px solid ${accent}` }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-border)", textAlign: "left" }}>
            <th style={{ padding: "0.5rem 0.75rem 0.5rem 0", minWidth: 140 }}>Category</th>
            <th style={{ padding: "0.5rem 0.75rem", minWidth: 160 }}>Progress</th>
            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Spent</th>
            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Budget</th>
            <th style={{ padding: "0.5rem 0.25rem", textAlign: "right", minWidth: 80 }}>Left / Over</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(({ parentName, cats }) => {
            const showParentHeader = cats.length > 1 && parentName !== null;
            return cats.map((cat, i) => {
              const txnUrl = `/transactions?categoryId=${cat.categoryId}&dateFrom=${monthStart}&dateTo=${lastDay}`;
              const isOver = cat.remaining < 0;
              const isParentEntry = cat.parentName === null; // budgeted at parent level (no parentName)
              return (
                <tr key={cat.categoryId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: `${i === 0 && showParentHeader ? "0.85rem" : "0.6rem"} 0.75rem 0.6rem ${isParentEntry || !showParentHeader ? "0" : "1.5rem"}` }}>
                    {i === 0 && showParentHeader && (
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-muted)", marginBottom: 4 }}>
                        {parentName}
                      </div>
                    )}
                    <Link to={txnUrl} style={{ fontWeight: 500, textDecoration: "none", color: "var(--color-text)", fontSize: 14 }}>
                      {cat.categoryName}
                    </Link>
                    {isParentEntry && cat.categoryName !== parentName && cat.categoryName && (
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>all sub-categories</div>
                    )}
                  </td>
                  <td style={{ padding: "0.6rem 0.75rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1 }}><ProgressBar percent={cat.percentUsed} /></div>
                      <span style={{ fontSize: 12, color: "var(--color-text-muted)", width: 42, textAlign: "right" }}>{cat.percentUsed}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>{fmtUSD(cat.spent)}</td>
                  <td style={{ padding: "0.6rem 0.75rem", textAlign: "right", color: "var(--color-text-muted)" }}>{fmtUSD(cat.budgeted)}</td>
                  <td style={{ padding: "0.6rem 0.25rem", textAlign: "right", fontWeight: 600, color: isOver ? "var(--color-danger)" : "var(--color-success)" }}>
                    {isOver ? `-${fmtUSD(Math.abs(cat.remaining))}` : fmtUSD(cat.remaining)}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
      </div>

      {summary.unbudgetedSpend > 0 && (
        <p style={{ marginTop: "0.75rem", color: "var(--color-text-muted)", fontSize: 13 }}>
          +{fmtUSD(summary.unbudgetedSpend)} spent in categories not in this budget.{" "}
          <Link to={`/transactions?dateFrom=${monthStart}&dateTo=${lastDay}`}>View transactions</Link>
        </p>
      )}

      <div style={{ marginTop: "1.25rem" }}>
        <button
          type="button"
          onClick={onEdit}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: "0.4rem 1rem",
            cursor: "pointer",
            fontSize: 14,
            color: "var(--color-text)",
            fontWeight: 500
          }}
        >
          <IconPencil size={14} />
          Edit budget
        </button>
      </div>
    </div>
  );
}

// ── Nav button ────────────────────────────────────────────────────────────────

function NavBtn({ onClick, direction, title }: { onClick: () => void; direction: "prev" | "next"; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        padding: "0.3rem 0.5rem",
        cursor: "pointer",
        color: "var(--color-text-secondary)",
        lineHeight: 1
      }}
    >
      {direction === "prev" ? <IconChevronLeft size={16} /> : <IconChevronRight size={16} />}
    </button>
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
    <div style={{ padding: "1.5rem", maxWidth: 860, margin: "0 auto" }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Budget</h1>
          <HelpIcon label="Set monthly spending targets per category. In setup mode, amounts are pre-filled from recent spend. Switch to Progress to track actuals vs. budget in real time." />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <NavBtn onClick={() => handleMonthNav(-1)} direction="prev" title="Previous month" />
          <span style={{ fontWeight: 600, minWidth: 150, textAlign: "center", fontSize: 15 }}>{monthLabel(month)}</span>
          <NavBtn onClick={() => handleMonthNav(1)} direction="next" title="Next month" />
        </div>
      </div>

      {loading && <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {/* Setup: new budget for this month */}
      {!loading && !error && setupReady && (
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>Set up budget — {monthLabel(month)}</h2>
          <SetupForm
            month={month}
            groups={groups}
            allCategories={allCategories}
            suggestions={suggestions}
            dataAsOf={dataAsOf}
            onGroupsChange={setGroups}
            onSaved={handleSaved}
          />
        </div>
      )}

      {/* Edit: update existing budget */}
      {!loading && !error && editReady && (
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>Edit budget — {monthLabel(month)}</h2>
          <SetupForm
            month={month}
            groups={groups}
            allCategories={allCategories}
            suggestions={suggestions ?? []}
            onGroupsChange={setGroups}
            onSaved={handleSaved}
          />
          <button
            type="button"
            onClick={() => setEditMode(false)}
            style={{ marginTop: "0.5rem", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: 13 }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Progress view */}
      {!loading && !error && progressReady && (
        <div className="card" style={{ marginBottom: 0 }}>
          <ProgressView budget={budget} onEdit={() => void handleEdit()} />
        </div>
      )}

      {/* Waiting for suggestions */}
      {!loading && !error && budget !== null && !budget.exists && suggestions === null && (
        <p style={{ color: "var(--color-text-muted)" }}>Loading suggestions…</p>
      )}
    </div>
  );
}
