import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";

type CategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
};

type MatchType = "contains" | "prefix" | "regex";

type CategoryRule = {
  id: string;
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  confidence: number;
  priority: number;
  enabled: boolean;
};

function categoryLabel(cat: CategoryRow, all: CategoryRow[]): string {
  if (!cat.parentId) {
    return cat.name;
  }
  const p = all.find((x) => x.id === cat.parentId);
  return p ? `${p.name} › ${cat.name}` : cat.name;
}

/** Categories that can be rule targets: no subcategories (API requires leaf). */
function assignableCategories(categories: CategoryRow[]): CategoryRow[] {
  const idsWithChildren = new Set(
    categories.filter((c) => c.parentId).map((c) => c.parentId as string)
  );
  return categories.filter((c) => !idsWithChildren.has(c.id)).sort((a, b) => {
    const la = categoryLabel(a, categories);
    const lb = categoryLabel(b, categories);
    return la.localeCompare(lb);
  });
}

const emptyForm = {
  pattern: "",
  matchType: "contains" as MatchType,
  categoryId: "",
  priority: 100,
  confidence: 0.85,
  enabled: true
};

export function CategoryRulesPage() {
  const token = useAuthToken();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<typeof emptyForm | null>(null);

  const leaves = useMemo(() => assignableCategories(categories), [categories]);

  const load = useCallback(async () => {
    const [catRes, rulesRes] = await Promise.all([
      apiJson<{ categories: CategoryRow[] }>("/categories"),
      apiJson<{ rules: CategoryRule[] }>("/categories/rules")
    ]);
    setCategories(catRes.categories);
    setRules(rulesRes.rules);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    void load()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setRules([]);
        setCategories([]);
      })
      .finally(() => setLoading(false));
  }, [token, load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pattern = form.pattern.trim();
    if (pattern.length < 2) {
      setError("Pattern must be at least 2 characters.");
      return;
    }
    if (!form.categoryId) {
      setError("Choose a category (leaf).");
      return;
    }
    setSaving(true);
    try {
      await apiJson<{ rule: CategoryRule }>("/categories/rules", {
        method: "POST",
        body: JSON.stringify({
          pattern,
          matchType: form.matchType,
          categoryId: form.categoryId,
          priority: form.priority,
          confidence: form.confidence,
          enabled: form.enabled
        })
      });
      setForm(emptyForm);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create rule");
    } finally {
      setSaving(false);
    }
  }

  async function patchRule(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await apiJson(`/categories/rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  function startEdit(r: CategoryRule) {
    setEditingId(r.id);
    setEditDraft({
      pattern: r.pattern,
      matchType: r.matchType,
      categoryId: r.categoryId,
      priority: r.priority,
      confidence: r.confidence,
      enabled: r.enabled
    });
  }

  async function saveEdit() {
    if (!editingId || !editDraft) {
      return;
    }
    const pattern = editDraft.pattern.trim();
    if (pattern.length < 2) {
      setError("Pattern must be at least 2 characters.");
      return;
    }
    if (!editDraft.categoryId) {
      setError("Choose a category.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/categories/rules/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          pattern,
          matchType: editDraft.matchType,
          categoryId: editDraft.categoryId,
          priority: editDraft.priority,
          confidence: editDraft.confidence,
          enabled: editDraft.enabled
        })
      });
      setEditingId(null);
      setEditDraft(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div>
      <div className="card">
        <h1>Classification rules</h1>
        <p className="muted">
          When you import transactions, these patterns are checked <strong>before</strong> built-in keyword rules (lower
          priority numbers run first). Only <strong>leaf</strong> categories—no group that has subcategories—can be
          assigned.
        </p>
        <p className="muted">
          <Link to="/categories">Back to categories</Link>
          {" · "}
          <Link to="/transactions">Transactions</Link>
        </p>

        {error ? <p className="error">{error}</p> : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.25rem" }}>Add rule</h2>
        <form onSubmit={(e) => void onCreate(e)} className="category-rules-page__form">
          <label className="category-rules-page__field">
            Pattern
            <input
              value={form.pattern}
              onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))}
              placeholder="e.g. whole foods, ^ach credit"
              autoComplete="off"
            />
          </label>
          <label className="category-rules-page__field">
            Match type
            <select
              value={form.matchType}
              onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value as MatchType }))}
            >
              <option value="contains">Contains (substring)</option>
              <option value="prefix">Prefix</option>
              <option value="regex">Regex (case-insensitive)</option>
            </select>
          </label>
          <label className="category-rules-page__field">
            Category
            <select
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              required
            >
              <option value="">Select…</option>
              {leaves.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c, categories)}
                </option>
              ))}
            </select>
          </label>
          <label className="category-rules-page__field category-rules-page__field--narrow">
            Priority
            <input
              type="number"
              min={0}
              max={10000}
              step={1}
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
            />
          </label>
          <label className="category-rules-page__field category-rules-page__field--narrow">
            Confidence
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={form.confidence}
              onChange={(e) => setForm((f) => ({ ...f, confidence: Number(e.target.value) }))}
            />
          </label>
          <label className="category-rules-page__checkbox">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />{" "}
            Enabled
          </label>
          <button type="submit" disabled={saving || leaves.length === 0}>
            {saving ? "Saving…" : "Add rule"}
          </button>
        </form>

        {leaves.length === 0 && !loading ? (
          <p className="muted">Add leaf categories under <Link to="/categories">Categories</Link> before creating rules.</p>
        ) : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Your rules</h2>
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && rules.length === 0 ? <p className="muted">No rules yet.</p> : null}
        {!loading && rules.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table category-rules-page__table">
              <thead>
                <tr>
                  <th scope="col">On</th>
                  <th scope="col">Pattern</th>
                  <th scope="col">Match</th>
                  <th scope="col">Category</th>
                  <th scope="col">Pri</th>
                  <th scope="col">Conf</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const cat = categories.find((c) => c.id === r.categoryId);
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id}>
                      <td>
                        {isEditing && editDraft ? (
                          <input
                            type="checkbox"
                            checked={editDraft.enabled}
                            onChange={(e) =>
                              setEditDraft((d) => (d ? { ...d, enabled: e.target.checked } : d))
                            }
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={() => void patchRule(r.id, { enabled: !r.enabled })}
                            aria-label={`Enable rule ${r.pattern}`}
                          />
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <input
                            value={editDraft.pattern}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, pattern: e.target.value } : d))}
                          />
                        ) : (
                          <code className="category-rules-page__pattern">{r.pattern}</code>
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <select
                            value={editDraft.matchType}
                            onChange={(e) =>
                              setEditDraft((d) =>
                                d ? { ...d, matchType: e.target.value as MatchType } : d
                              )
                            }
                          >
                            <option value="contains">contains</option>
                            <option value="prefix">prefix</option>
                            <option value="regex">regex</option>
                          </select>
                        ) : (
                          r.matchType
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <select
                            value={editDraft.categoryId}
                            onChange={(e) =>
                              setEditDraft((d) => (d ? { ...d, categoryId: e.target.value } : d))
                            }
                          >
                            {leaves.map((c) => (
                              <option key={c.id} value={c.id}>
                                {categoryLabel(c, categories)}
                              </option>
                            ))}
                          </select>
                        ) : cat ? (
                          categoryLabel(cat, categories)
                        ) : (
                          <span className="muted">(missing)</span>
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            className="category-rules-page__num"
                            value={editDraft.priority}
                            onChange={(e) =>
                              setEditDraft((d) =>
                                d ? { ...d, priority: Number(e.target.value) } : d
                              )
                            }
                          />
                        ) : (
                          r.priority
                        )}
                      </td>
                      <td>
                        {isEditing && editDraft ? (
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            className="category-rules-page__num"
                            value={editDraft.confidence}
                            onChange={(e) =>
                              setEditDraft((d) =>
                                d ? { ...d, confidence: Number(e.target.value) } : d
                              )
                            }
                          />
                        ) : (
                          r.confidence.toFixed(2)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <span className="category-rules-page__row-actions">
                            <button type="button" disabled={saving} onClick={() => void saveEdit()}>
                              Save
                            </button>
                            <button type="button" className="secondary" onClick={cancelEdit}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="secondary" onClick={() => startEdit(r)}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
