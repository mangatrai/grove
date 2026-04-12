import { useCallback, useEffect, useState } from "react";
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
  suggestions: BudgetSuggestionRow[];
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

function prevMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // month is 0-based, go back 1
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, m, 1); // month is 0-based, go forward 1
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(percent, 100);
  const color =
    percent > 100 ? "#dc2626" : percent >= 80 ? "#d97706" : "#16a34a";
  return (
    <div
      style={{
        background: "#e2e8f0",
        borderRadius: 4,
        height: 8,
        width: "100%",
        overflow: "hidden"
      }}
    >
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

// ── Budget setup form ─────────────────────────────────────────────────────────

type SetupEntry = { categoryId: string; categoryName: string; parentName: string | null; amount: string };

function SetupForm({
  month,
  suggestions,
  onSaved
}: {
  month: string;
  suggestions: BudgetSuggestionRow[];
  onSaved: (result: BudgetResult) => void;
}) {
  const [entries, setEntries] = useState<SetupEntry[]>(() =>
    suggestions.map((s) => ({
      categoryId: s.categoryId,
      categoryName: s.categoryName,
      parentName: s.parentName,
      amount: String(s.suggestedAmount)
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setAmount(categoryId: string, value: string) {
    setEntries((prev) =>
      prev.map((e) => (e.categoryId === categoryId ? { ...e, amount: value } : e))
    );
  }

  function removeEntry(categoryId: string) {
    setEntries((prev) => prev.filter((e) => e.categoryId !== categoryId));
  }

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

  const total = entries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  return (
    <div>
      <p style={{ color: "var(--color-text-muted)", marginTop: 0 }}>
        Pre-filled from last month&apos;s actual spend. Adjust amounts, remove categories you
        don&apos;t want to budget, then save.
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
            const suggestion = suggestions.find((s) => s.categoryId === entry.categoryId);
            return (
              <tr
                key={entry.categoryId}
                style={{ borderBottom: "1px solid var(--color-border)" }}
              >
                <td style={{ padding: "0.5rem 0.75rem 0.5rem 0" }}>
                  <span style={{ fontWeight: 500 }}>{entry.categoryName}</span>
                  {entry.parentName ? (
                    <span style={{ color: "var(--color-text-muted)", fontSize: 12, marginLeft: 6 }}>
                      {entry.parentName}
                    </span>
                  ) : null}
                </td>
                <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", color: "var(--color-text-muted)", fontSize: 13 }}>
                  {suggestion
                    ? suggestion.basis === "three_month_avg"
                      ? `${fmtUSD(suggestion.lastMonthActual)} (avg ${fmtUSD(suggestion.threeMonthAvg)})`
                      : fmtUSD(suggestion.lastMonthActual)
                    : "—"}
                </td>
                <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    <span style={{ color: "var(--color-text-muted)" }}>$</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={entry.amount}
                      onChange={(e) => setAmount(entry.categoryId, e.target.value)}
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
                    onClick={() => removeEntry(entry.categoryId)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--color-text-muted)",
                      fontSize: 16,
                      padding: "0.1rem 0.3rem",
                      borderRadius: 4
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 600 }}>
            <td style={{ padding: "0.5rem 0.75rem 0.5rem 0" }}>Total</td>
            <td></td>
            <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>{fmtUSD(total)}</td>
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
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.7 : 1
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

function ProgressView({
  budget,
  onEdit
}: {
  budget: BudgetResult;
  onEdit: () => void;
}) {
  const { summary, categories, month } = budget;
  const monthStart = `${month}-01`;
  const [yr, mo] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(yr, mo, 0)).toISOString().slice(0, 10);

  return (
    <div>
      {/* Summary strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1rem",
          marginBottom: "1.5rem"
        }}
      >
        {[
          { label: "Budgeted", value: fmtUSD(summary.totalBudgeted), muted: false },
          { label: "Spent", value: fmtUSD(summary.totalSpent), muted: false },
          {
            label: summary.remaining >= 0 ? "Remaining" : "Over budget",
            value: fmtUSD(Math.abs(summary.remaining)),
            muted: summary.remaining < 0,
            red: summary.remaining < 0
          }
        ].map(({ label, value, red }) => (
          <div
            key={label}
            className="card"
            style={{ marginBottom: 0, textAlign: "center" }}
          >
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>
              {label}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: red ? "#dc2626" : "var(--color-text)"
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Category rows */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-border)", textAlign: "left" }}>
            <th style={{ padding: "0.5rem 0.75rem 0.5rem 0", minWidth: 140 }}>Category</th>
            <th style={{ padding: "0.5rem 0.75rem", minWidth: 200 }}>Progress</th>
            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Spent</th>
            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Budget</th>
            <th style={{ padding: "0.5rem 0.25rem", textAlign: "right" }}>Left</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => {
            const txnUrl = `/transactions?categoryId=${cat.categoryId}&dateFrom=${monthStart}&dateTo=${lastDay}`;
            const isOver = cat.remaining < 0;
            return (
              <tr
                key={cat.categoryId}
                style={{ borderBottom: "1px solid var(--color-border)" }}
              >
                <td style={{ padding: "0.6rem 0.75rem 0.6rem 0" }}>
                  <Link to={txnUrl} style={{ fontWeight: 500, textDecoration: "none", color: "var(--color-text)" }}>
                    {cat.categoryName}
                  </Link>
                  {cat.parentName ? (
                    <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                      {cat.parentName}
                    </div>
                  ) : null}
                </td>
                <td style={{ padding: "0.6rem 0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <ProgressBar percent={cat.percentUsed} />
                    </div>
                    <span style={{ fontSize: 12, color: "var(--color-text-muted)", width: 38, textAlign: "right" }}>
                      {cat.percentUsed}%
                    </span>
                  </div>
                </td>
                <td style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>
                  {fmtUSD(cat.spent)}
                </td>
                <td style={{ padding: "0.6rem 0.75rem", textAlign: "right", color: "var(--color-text-muted)" }}>
                  {fmtUSD(cat.budgeted)}
                </td>
                <td
                  style={{
                    padding: "0.6rem 0.25rem",
                    textAlign: "right",
                    fontWeight: 600,
                    color: isOver ? "#dc2626" : "#16a34a"
                  }}
                >
                  {isOver ? `-${fmtUSD(Math.abs(cat.remaining))}` : fmtUSD(cat.remaining)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {summary.unbudgetedSpend > 0 && (
        <p style={{ marginTop: "0.75rem", color: "var(--color-text-muted)", fontSize: 13 }}>
          +{fmtUSD(summary.unbudgetedSpend)} spent in unbudgeted categories this month.{" "}
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

// ── Main page ────────────────────────────────────────────────────────────────

export function BudgetPage() {
  const token = useAuthToken();
  const [month, setMonth] = useState(currentMonth);
  const [budget, setBudget] = useState<BudgetResult | null>(null);
  const [suggestions, setSuggestions] = useState<BudgetSuggestionRow[] | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBudget = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiJson<BudgetResult>(`/budget/${m}`);
      setBudget(result);
      setEditMode(!result.exists);
      if (!result.exists) {
        // Pre-load suggestions so the setup form is ready immediately
        const suggestResult = await apiJson<SuggestResult>(`/budget/suggest?month=${m}`);
        setSuggestions(suggestResult.suggestions);
      }
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
    setEditMode(true);
    if (!suggestions) {
      try {
        const result = await apiJson<SuggestResult>(`/budget/suggest?month=${month}`);
        setSuggestions(result.suggestions);
      } catch {
        // ignore — user can still edit existing budget entries
      }
    }
  }, [month, suggestions]);

  const handleSaved = useCallback(
    (result: BudgetResult) => {
      setBudget(result);
      setEditMode(false);
      setSuggestions(null);
    },
    []
  );

  const handleMonthNav = useCallback(
    (direction: "prev" | "next") => {
      const m = direction === "prev" ? prevMonth(month) : nextMonth(month);
      setMonth(m);
      setBudget(null);
      setSuggestions(null);
      setEditMode(false);
    },
    [month]
  );

  if (!token) return null;

  return (
    <div style={{ padding: "1.5rem", maxWidth: 860, margin: "0 auto" }}>
      {/* Header */}
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
          <button
            type="button"
            onClick={() => handleMonthNav("prev")}
            title="Previous month"
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              padding: "0.3rem 0.65rem",
              cursor: "pointer",
              fontSize: 16
            }}
          >
            ‹
          </button>
          <span style={{ fontWeight: 600, minWidth: 140, textAlign: "center" }}>
            {monthLabel(month)}
          </span>
          <button
            type="button"
            onClick={() => handleMonthNav("next")}
            title="Next month"
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              padding: "0.3rem 0.65rem",
              cursor: "pointer",
              fontSize: 16
            }}
          >
            ›
          </button>
        </div>
      </div>

      {loading && (
        <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
      )}
      {error && (
        <p style={{ color: "#dc2626" }}>{error}</p>
      )}

      {!loading && !error && budget && (
        <div className="card" style={{ marginBottom: 0 }}>
          {editMode ? (
            <>
              <h2 style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>
                {budget.exists ? `Edit budget — ${monthLabel(month)}` : `Set up budget — ${monthLabel(month)}`}
              </h2>
              <SetupForm
                month={month}
                suggestions={
                  editMode && budget.exists
                    ? budget.categories.map((c) => ({
                        categoryId: c.categoryId,
                        categoryName: c.categoryName,
                        parentName: c.parentName,
                        suggestedAmount: c.budgeted,
                        basis: "last_month" as const,
                        lastMonthActual: c.budgeted,
                        threeMonthAvg: c.budgeted
                      }))
                    : (suggestions ?? [])
                }
                onSaved={handleSaved}
              />
              {budget.exists && (
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  style={{
                    marginTop: "0.75rem",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--color-text-muted)",
                    fontSize: 13
                  }}
                >
                  Cancel
                </button>
              )}
            </>
          ) : (
            <ProgressView budget={budget} onEdit={() => void handleEdit()} />
          )}
        </div>
      )}

      {!loading && !error && !budget && !loading && (
        <p style={{ color: "var(--color-text-muted)" }}>No data for this month.</p>
      )}
    </div>
  );
}
