import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";

// ── Types ────────────────────────────────────────────────────────────────────

type BudgetSuggestionRow = {
  categoryId: string;
  categoryName: string;
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
  /** Most recent calendar month used as the "last month" anchor. Null if no data found. */
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

// Entries are managed in the parent so initialization from async suggestions is reliable.
type SetupEntry = {
  categoryId: string;
  categoryName: string;
  parentName: string | null;
  amount: string; // string for controlled input
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

function buildCategoryLabel(cat: CategoryOption, byId: Map<string, CategoryOption>): string {
  if (cat.parentId) {
    const parent = byId.get(cat.parentId);
    return parent ? `${parent.name} > ${cat.name}` : cat.name;
  }
  return cat.name;
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(percent, 100);
  const color = percent > 100 ? "#dc2626" : percent >= 80 ? "#d97706" : "#16a34a";
  return (
    <div style={{ background: "#e2e8f0", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div
        style={{
          width: `${clamped}%`,
          height: "100%",
          background: color,
          borderRadius: 4,
          transition: "width 0.3s"
        }}
      />
    </div>
  );
}

// ── Add-category picker ───────────────────────────────────────────────────────

function AddCategoryRow({
  allCategories,
  excludedIds,
  onAdd
}: {
  allCategories: CategoryOption[];
  excludedIds: Set<string>;
  onAdd: (cat: CategoryOption) => void;
}) {
  const byId = new Map(allCategories.map((c) => [c.id, c]));
  // Only leaf categories (have a parent) that are not already in the budget
  const available = allCategories
    .filter((c) => c.parentId !== null && !excludedIds.has(c.id))
    .sort((a, b) => {
      const la = buildCategoryLabel(a, byId);
      const lb = buildCategoryLabel(b, byId);
      return la.localeCompare(lb);
    });

  const [selected, setSelected] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);

  function handleAdd() {
    if (!selected) return;
    const cat = allCategories.find((c) => c.id === selected);
    if (cat) {
      onAdd(cat);
      setSelected("");
    }
  }

  if (available.length === 0) return null;

  return (
    <tr>
      <td colSpan={4} style={{ paddingTop: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            ref={selectRef}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              padding: "0.3rem 0.5rem",
              fontSize: 13,
              flex: 1,
              maxWidth: 340,
              color: selected ? "var(--color-text)" : "var(--color-text-muted)"
            }}
          >
            <option value="">+ Add a category…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {buildCategoryLabel(c, byId)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!selected}
            style={{
              background: selected ? "var(--color-accent)" : "var(--color-border)",
              color: selected ? "#fff" : "var(--color-text-muted)",
              border: "none",
              borderRadius: 6,
              padding: "0.3rem 0.85rem",
              fontWeight: 600,
              fontSize: 13,
              cursor: selected ? "pointer" : "default"
            }}
          >
            Add
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Setup form ────────────────────────────────────────────────────────────────
// Entries state is owned by the parent (BudgetPage) so initialization from async
// suggestions is reliable — useState initializer only runs once at mount time,
// so if SetupForm mounted before suggestions arrived it would always start empty.

function SetupForm({
  month,
  entries,
  allCategories,
  onSetAmount,
  onRemove,
  onAdd,
  suggestions,
  dataAsOf,
  onSaved
}: {
  month: string;
  entries: SetupEntry[];
  allCategories: CategoryOption[];
  onSetAmount: (categoryId: string, value: string) => void;
  onRemove: (categoryId: string) => void;
  onAdd: (cat: CategoryOption) => void;
  suggestions: BudgetSuggestionRow[];
  dataAsOf?: string | null;
  onSaved: (result: BudgetResult) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestionMap = new Map(suggestions.map((s) => [s.categoryId, s]));
  const total = entries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const excludedIds = new Set(entries.map((e) => e.categoryId));

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = entries
        .map((e) => ({ categoryId: e.categoryId, amount: parseFloat(e.amount) || 0 }))
        .filter((e) => e.amount > 0);
      const result = await apiJson<BudgetResult>(`/budget/${month}`, {
        method: "PUT",
        body: JSON.stringify({ entries: payload })
      });
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save budget");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p style={{ color: "var(--color-text-muted)", marginTop: 0 }}>
        {dataAsOf
          ? <>Pre-filled from actual spend in <strong>{monthLabel(dataAsOf)}</strong>. Adjust amounts, remove categories you don&apos;t want to budget, then save.</>
          : <>No prior spend data found. Add categories manually and set your budgets.</>
        }
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-border)", textAlign: "left" }}>
            <th style={{ padding: "0.5rem 0.75rem 0.5rem 0" }}>Category</th>
            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Last month actual</th>
            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Your budget</th>
            <th style={{ padding: "0.5rem 0.25rem", width: 32 }}></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const s = suggestionMap.get(entry.categoryId);
            return (
              <tr key={entry.categoryId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td style={{ padding: "0.5rem 0.75rem 0.5rem 0" }}>
                  <span style={{ fontWeight: 500 }}>{entry.categoryName}</span>
                  {entry.parentName ? (
                    <span style={{ color: "var(--color-text-muted)", fontSize: 12, marginLeft: 6 }}>
                      {entry.parentName}
                    </span>
                  ) : null}
                </td>
                <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", color: "var(--color-text-muted)", fontSize: 13 }}>
                  {s ? (
                    s.basis === "three_month_avg"
                      ? `${fmtUSD(s.lastMonthActual)} (3mo avg ${fmtUSD(s.threeMonthAvg)})`
                      : fmtUSD(s.lastMonthActual)
                  ) : "—"}
                </td>
                <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    <span style={{ color: "var(--color-text-muted)" }}>$</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={entry.amount}
                      onChange={(e) => onSetAmount(entry.categoryId, e.target.value)}
                      style={{
                        width: 90,
                        textAlign: "right",
                        border: "1px solid var(--color-border)",
                        borderRadius: 4,
                        padding: "0.2rem 0.4rem",
                        fontSize: 14
                      }}
                    />
                  </div>
                </td>
                <td style={{ padding: "0.25rem" }}>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => onRemove(entry.categoryId)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--color-text-muted)",
                      fontSize: 18,
                      lineHeight: 1,
                      padding: "0.1rem 0.35rem",
                      borderRadius: 4
                    }}
                  >
                    x
                  </button>
                </td>
              </tr>
            );
          })}
          {/* Add category row */}
          <AddCategoryRow
            allCategories={allCategories}
            excludedIds={excludedIds}
            onAdd={onAdd}
          />
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 600 }}>
            <td style={{ padding: "0.75rem 0.75rem 0.5rem 0" }}>Total</td>
            <td></td>
            <td style={{ padding: "0.75rem 0.75rem 0.5rem", textAlign: "right" }}>{fmtUSD(total)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      {error ? <p style={{ color: "#dc2626", marginTop: "0.75rem" }}>{error}</p> : null}

      <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || entries.length === 0}
          style={{
            background: "var(--color-accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "0.5rem 1.25rem",
            fontWeight: 600,
            cursor: saving || entries.length === 0 ? "default" : "pointer",
            opacity: saving || entries.length === 0 ? 0.6 : 1
          }}
        >
          {saving ? "Saving…" : `Save budget for ${monthLabel(month)}`}
        </button>
        {entries.length === 0 && (
          <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
            Add at least one category to save.
          </span>
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

  return (
    <div>
      {/* Summary KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        {(
          [
            { label: "Budgeted", value: fmtUSD(summary.totalBudgeted), red: false },
            { label: "Spent", value: fmtUSD(summary.totalSpent), red: false },
            {
              label: summary.remaining >= 0 ? "Remaining" : "Over budget",
              value: fmtUSD(Math.abs(summary.remaining)),
              red: summary.remaining < 0
            }
          ] as const
        ).map(({ label, value, red }) => (
          <div key={label} className="card" style={{ marginBottom: 0, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: red ? "#dc2626" : "var(--color-text)" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Per-category rows */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-border)", textAlign: "left" }}>
            <th style={{ padding: "0.5rem 0.75rem 0.5rem 0", minWidth: 140 }}>Category</th>
            <th style={{ padding: "0.5rem 0.75rem", minWidth: 180 }}>Progress</th>
            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Spent</th>
            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Budget</th>
            <th style={{ padding: "0.5rem 0.25rem", textAlign: "right", minWidth: 80 }}>Left / Over</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => {
            const txnUrl = `/transactions?categoryId=${cat.categoryId}&dateFrom=${monthStart}&dateTo=${lastDay}`;
            const isOver = cat.remaining < 0;
            return (
              <tr key={cat.categoryId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td style={{ padding: "0.6rem 0.75rem 0.6rem 0" }}>
                  <Link to={txnUrl} style={{ fontWeight: 500, textDecoration: "none", color: "var(--color-text)" }}>
                    {cat.categoryName}
                  </Link>
                  {cat.parentName ? (
                    <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>{cat.parentName}</div>
                  ) : null}
                </td>
                <td style={{ padding: "0.6rem 0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <ProgressBar percent={cat.percentUsed} />
                    </div>
                    <span style={{ fontSize: 12, color: "var(--color-text-muted)", width: 42, textAlign: "right" }}>
                      {cat.percentUsed}%
                    </span>
                  </div>
                </td>
                <td style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>{fmtUSD(cat.spent)}</td>
                <td style={{ padding: "0.6rem 0.75rem", textAlign: "right", color: "var(--color-text-muted)" }}>
                  {fmtUSD(cat.budgeted)}
                </td>
                <td style={{ padding: "0.6rem 0.25rem", textAlign: "right", fontWeight: 600, color: isOver ? "#dc2626" : "#16a34a" }}>
                  {isOver ? `-${fmtUSD(Math.abs(cat.remaining))}` : fmtUSD(cat.remaining)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
            background: "none",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: "0.4rem 1rem",
            cursor: "pointer",
            fontSize: 14
          }}
        >
          Edit budget
        </button>
      </div>
    </div>
  );
}

// ── Nav button ────────────────────────────────────────────────────────────────

function NavBtn({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        padding: "0.3rem 0.75rem",
        cursor: "pointer",
        fontSize: 15,
        fontWeight: 700,
        color: "var(--color-text)",
        lineHeight: 1
      }}
    >
      {label}
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

  // Entries for the setup form — owned here so they initialize correctly
  // after the async suggestions call resolves.
  const [entries, setEntries] = useState<SetupEntry[]>([]);

  // Load all categories once for the "add category" picker
  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const res = await apiJson<{ categories: CategoryOption[] }>("/categories");
        setAllCategories(res.categories);
      } catch {
        // non-fatal — add picker just won't show
      }
    })();
  }, [token]);

  const loadBudget = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    setBudget(null);
    setSuggestions(null);
    setDataAsOf(null);
    setEntries([]);
    try {
      const result = await apiJson<BudgetResult>(`/budget/${m}`);
      if (!result.exists) {
        // Fetch suggestions and initialise entries before rendering the form,
        // so the SetupForm's controlled entries are populated on first render.
        const suggestResult = await apiJson<SuggestResult>(`/budget/suggest?month=${m}`);
        const initialEntries: SetupEntry[] = suggestResult.suggestions.map((s) => ({
          categoryId: s.categoryId,
          categoryName: s.categoryName,
          parentName: s.parentName,
          amount: String(s.suggestedAmount)
        }));
        setSuggestions(suggestResult.suggestions);
        setDataAsOf(suggestResult.dataAsOf);
        setEntries(initialEntries);
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
    // Populate entries from current budget amounts (not last-month actuals —
    // the user already made those decisions when they set up the budget).
    setEntries(
      budget.categories.map((c) => ({
        categoryId: c.categoryId,
        categoryName: c.categoryName,
        parentName: c.parentName,
        amount: String(c.budgeted)
      }))
    );
    // Also load suggestions for the "last month actual" reference column
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
  }, [budget, month, suggestions]);

  const handleSaved = useCallback((result: BudgetResult) => {
    setBudget(result);
    setEditMode(false);
    setEntries([]);
  }, []);

  const handleMonthNav = useCallback((delta: number) => {
    setMonth((m) => shiftMonth(m, delta));
  }, []);

  const handleSetAmount = useCallback((categoryId: string, value: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.categoryId === categoryId ? { ...e, amount: value } : e))
    );
  }, []);

  const handleRemove = useCallback((categoryId: string) => {
    setEntries((prev) => prev.filter((e) => e.categoryId !== categoryId));
  }, []);

  const handleAdd = useCallback(
    (cat: CategoryOption) => {
      const byId = new Map(allCategories.map((c) => [c.id, c]));
      const parentName = cat.parentId ? (byId.get(cat.parentId)?.name ?? null) : null;
      setEntries((prev) => [
        ...prev,
        { categoryId: cat.id, categoryName: cat.name, parentName, amount: "0" }
      ]);
    },
    [allCategories]
  );

  if (!token) return null;

  const setupReady = budget !== null && !budget.exists && suggestions !== null;
  const progressReady = budget !== null && budget.exists && !editMode;
  const editReady = budget !== null && budget.exists && editMode;

  return (
    <div style={{ padding: "1.5rem", maxWidth: 860, margin: "0 auto" }}>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
          gap: "0.75rem",
          flexWrap: "wrap"
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Budget</h1>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <NavBtn onClick={() => handleMonthNav(-1)} label="&lt;" title="Previous month" />
          <span style={{ fontWeight: 600, minWidth: 150, textAlign: "center", fontSize: 15 }}>
            {monthLabel(month)}
          </span>
          <NavBtn onClick={() => handleMonthNav(1)} label="&gt;" title="Next month" />
        </div>
      </div>

      {loading && <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {/* Setup: new budget for this month */}
      {!loading && !error && setupReady && (
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>
            Set up budget — {monthLabel(month)}
          </h2>
          <SetupForm
            month={month}
            entries={entries}
            allCategories={allCategories}
            suggestions={suggestions}
            dataAsOf={dataAsOf}
            onSetAmount={handleSetAmount}
            onRemove={handleRemove}
            onAdd={handleAdd}
            onSaved={handleSaved}
          />
        </div>
      )}

      {/* Edit: update existing budget */}
      {!loading && !error && editReady && (
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>
            Edit budget — {monthLabel(month)}
          </h2>
          <SetupForm
            month={month}
            entries={entries}
            allCategories={allCategories}
            suggestions={suggestions ?? []}
            onSetAmount={handleSetAmount}
            onRemove={handleRemove}
            onAdd={handleAdd}
            onSaved={handleSaved}
          />
          <button
            type="button"
            onClick={() => setEditMode(false)}
            style={{
              marginTop: "0.5rem",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              fontSize: 13
            }}
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

      {/* Waiting for suggestions to load after budget-not-found */}
      {!loading && !error && budget !== null && !budget.exists && suggestions === null && (
        <p style={{ color: "var(--color-text-muted)" }}>Loading suggestions…</p>
      )}
    </div>
  );
}
