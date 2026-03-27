import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";

type CategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  isDefault: boolean;
  householdScoped: boolean;
};

type HierarchyRow =
  | { kind: "parent"; category: CategoryRow }
  | { kind: "child"; category: CategoryRow; parent: CategoryRow };

function sourceLabel(c: CategoryRow): string {
  if (c.householdScoped) {
    return "Added by you";
  }
  return c.isDefault ? "Built-in template" : "Built-in";
}

function compareRootCategories(a: CategoryRow, b: CategoryRow): number {
  const rank = (name: string) => (name === "Income" ? 0 : 1);
  const d = rank(a.name) - rank(b.name);
  if (d !== 0) {
    return d;
  }
  return a.name.localeCompare(b.name);
}

export function CategoriesPage() {
  const token = useAuthToken();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [addMode, setAddMode] = useState<"parent" | "child">("parent");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await apiJson<{ categories: CategoryRow[] }>("/categories");
    setCategories(res.categories);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    void load()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setCategories([]);
      })
      .finally(() => setLoading(false));
  }, [token, load]);

  const topLevelParents = useMemo(
    () => categories.filter((c) => !c.parentId).sort(compareRootCategories),
    [categories]
  );

  const hierarchyRows = useMemo((): HierarchyRow[] => {
    const rows: HierarchyRow[] = [];
    for (const root of topLevelParents) {
      rows.push({ kind: "parent", category: root });
      const children = categories
        .filter((c) => c.parentId === root.id)
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        rows.push({ kind: "child", category: child, parent: root });
      }
    }
    return rows;
  }, [categories, topLevelParents]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (addMode === "child" && !parentId) {
      setError("Choose a parent group for a subcategory.");
      return;
    }
    setSaving(true);
    try {
      await apiJson("/categories", {
        method: "POST",
        body: JSON.stringify({
          name: trimmed,
          parentId: addMode === "parent" ? null : parentId
        })
      });
      setName("");
      setParentId("");
      setAddMode("parent");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create category");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this category? It must have no subcategories and no ledger rows.")) {
      return;
    }
    setError(null);
    try {
      await apiJson(`/categories/${id}`, { method: "DELETE" });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div>
      <div className="card">
        <h1>Categories</h1>
        <p className="muted">
          <strong>Parent group</strong> (left) is the bucket you roll up into—housing, shopping, healthcare, and so on.{" "}
          <strong>Category</strong> (right) is the specific line item, often a subcategory under that group. Rows are
          grouped: each parent appears once, then its subcategories directly underneath so you never see a child before
          its parent.
        </p>
        <p className="muted">
          <strong>Source</strong> tells you whether a row came from the app&apos;s built-in list or was added for your
          household. &ldquo;—&rdquo; under parent group means that row <em>is</em> the top-level group (not a subcategory).
        </p>
        <p className="muted">
          <Link to="/transactions">Back to ledger</Link>
          {" · "}
          <Link to="/categories/rules">Classification rules</Link>
        </p>

        {error ? <p className="error">{error}</p> : null}

        <h2 style={{ fontSize: "1.05rem", marginTop: "1rem" }}>Add category</h2>
        <form onSubmit={(e) => void onCreate(e)} className="categories-page__add-form">
          <fieldset className="categories-page__add-fieldset">
            <legend className="sr-only">Add category</legend>
            <div className="categories-page__add-mode">
              <span className="categories-page__add-label">Add a</span>
              <label className="categories-page__radio">
                <input
                  type="radio"
                  name="addMode"
                  checked={addMode === "parent"}
                  onChange={() => {
                    setAddMode("parent");
                    setParentId("");
                  }}
                />{" "}
                New parent group
              </label>
              <label className="categories-page__radio">
                <input
                  type="radio"
                  name="addMode"
                  checked={addMode === "child"}
                  onChange={() => setAddMode("child")}
                />{" "}
                Subcategory under a parent
              </label>
            </div>
            {addMode === "child" ? (
              <label className="categories-page__parent-select">
                Parent group
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  required={addMode === "child"}
                >
                  <option value="">Select parent…</option>
                  {topLevelParents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="categories-page__name-field">
              {addMode === "parent" ? "Name of new group" : "Name of subcategory"}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={addMode === "parent" ? "e.g. Pets, Travel" : "e.g. Vet, Flights"}
              />
            </label>
            <button
              type="submit"
              disabled={saving || !name.trim() || (addMode === "child" && !parentId)}
            >
              {saving ? "Saving…" : "Add"}
            </button>
          </fieldset>
        </form>

        <h2 style={{ fontSize: "1.05rem", marginTop: "1.25rem" }}>All categories</h2>
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && categories.length === 0 ? <p className="muted">No categories.</p> : null}
        {!loading && categories.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table categories-page__table">
              <thead>
                <tr>
                  <th scope="col">Parent group</th>
                  <th scope="col">Category</th>
                  <th scope="col">Source</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {hierarchyRows.map((row) => {
                  if (row.kind === "parent") {
                    const c = row.category;
                    return (
                      <tr key={c.id} className="categories-page__row categories-page__row--parent">
                        <td className="muted" title="This row is a top-level group">
                          —
                        </td>
                        <td className="categories-page__category-cell categories-page__category-cell--parent">
                          {c.name}
                        </td>
                        <td className="muted">{sourceLabel(c)}</td>
                        <td>
                          {c.householdScoped ? (
                            <button type="button" className="secondary" onClick={() => void onDelete(c.id)}>
                              Delete
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  }
                  const c = row.category;
                  const p = row.parent;
                  return (
                    <tr key={c.id} className="categories-page__row categories-page__row--child">
                      <td>{p.name}</td>
                      <td className="categories-page__category-cell categories-page__category-cell--child">{c.name}</td>
                      <td className="muted">{sourceLabel(c)}</td>
                      <td>
                        {c.householdScoped ? (
                          <button type="button" className="secondary" onClick={() => void onDelete(c.id)}>
                            Delete
                          </button>
                        ) : (
                          <span className="muted">—</span>
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
