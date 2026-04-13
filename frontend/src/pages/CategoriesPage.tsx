import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HelpIcon } from "../components/HelpIcon";

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

function SourceBadge({ c }: { c: CategoryRow }) {
  const household = c.householdScoped;
  return (
    <span style={{
      display: "inline-block",
      padding: "0.1rem 0.45rem",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      background: household ? "var(--color-accent-subtle, #dcfce7)" : "var(--color-surface-alt, #f8fafc)",
      color: household ? "var(--color-accent)" : "var(--color-text-muted)",
      border: `1px solid ${household ? "var(--color-accent-bright, #22c55e)" : "var(--color-border)"}`,
      whiteSpace: "nowrap"
    }}>
      {household ? "Yours" : "Built-in"}
    </span>
  );
}

function compareRootCategories(a: CategoryRow, b: CategoryRow): number {
  const rank = (name: string) => (name === "Income" ? 0 : 1);
  const d = rank(a.name) - rank(b.name);
  if (d !== 0) {
    return d;
  }
  return a.name.localeCompare(b.name);
}

function categoryHasChildren(categoryId: string, categories: CategoryRow[]): boolean {
  return categories.some((c) => c.parentId === categoryId);
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { message?: string };
    if (j.message) {
      return j.message;
    }
  } catch {
    /* ignore */
  }
  return text || `${res.status} ${res.statusText}`;
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
  const [authRole, setAuthRole] = useState<"owner" | "admin" | "member" | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<HierarchyRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState<string>("");
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const canEditBuiltIns = authRole === "owner" || authRole === "admin";

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

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<{ user: { role: "owner" | "admin" | "member" } }>("/auth/me")
      .then((r) => setAuthRole(r.user.role))
      .catch(() => setAuthRole(null));
  }, [token]);

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

  function openEdit(row: HierarchyRow) {
    setError(null);
    setEditRow(row);
    if (row.kind === "parent") {
      setEditName(row.category.name);
      setEditParentId("");
    } else {
      setEditName(row.category.name);
      setEditParentId(row.parent.id);
    }
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditRow(null);
    setEditName("");
    setEditParentId("");
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editRow) {
      return;
    }
    const trimmed = editName.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    const cat = editRow.kind === "parent" ? editRow.category : editRow.category;
    const isChild = editRow.kind === "child";
    if (isChild && !editParentId) {
      setError("Choose a parent group.");
      return;
    }

    setEditSaving(true);
    setError(null);
    try {
      const body: { name: string; parentId?: string | null } = { name: trimmed };
      if (isChild) {
        body.parentId = editParentId;
      } else {
        body.parentId = null;
      }
      const res = await apiFetch(`/categories/${cat.id}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      await load();
      closeEdit();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setEditSaving(false);
    }
  }

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

  function requestDeleteCategory(id: string) {
    setDeleteConfirmId(id);
  }

  const confirmDeleteCategory = useCallback(async () => {
    const id = deleteConfirmId;
    if (!id) {
      return;
    }
    setError(null);
    try {
      const res = await apiFetch(`/categories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete");
      throw err;
    }
  }, [deleteConfirmId, load]);

  const showEditForRow = (row: HierarchyRow): boolean => {
    const c = row.kind === "parent" ? row.category : row.category;
    if (c.householdScoped) {
      return true;
    }
    return canEditBuiltIns;
  };

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Categories</h1>
          <HelpIcon label="Parent groups are the top-level buckets (Housing, Shopping…). Categories are specific line items underneath. Built-in entries can be renamed by owners/admins but not deleted. Source 'Yours' = added by your household." />
          <span style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 13 }}>
            <Link to="/transactions">Transactions</Link>
            <Link to="/categories/rules">Rules</Link>
          </span>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {editOpen && editRow ? (
          <div
            className="categories-page__edit-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="categories-edit-title"
          >
            <div className="categories-page__edit-dialog card">
              <h2 id="categories-edit-title" style={{ fontSize: "1.05rem", marginTop: 0 }}>
                Edit category
              </h2>
              <form onSubmit={(e) => void onSaveEdit(e)}>
                <label className="categories-page__name-field">
                  Name
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    required
                  />
                </label>
                {editRow.kind === "child" ? (
                  <label className="categories-page__parent-select">
                    Parent group
                    <select value={editParentId} onChange={(e) => setEditParentId(e.target.value)} required>
                      <option value="">Select parent…</option>
                      {topLevelParents.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : categoryHasChildren(editRow.category.id, categories) ? (
                  <p className="muted" style={{ marginTop: "0.5rem" }}>
                    This group has subcategories; only the name can be changed here.
                  </p>
                ) : null}
                <div className="categories-page__edit-actions" style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
                  <button type="submit" disabled={editSaving}>
                    {editSaving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="secondary" onClick={() => closeEdit()} disabled={editSaving}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

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
                  <th scope="col"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Source <HelpIcon label="Built-in: ships with the app. Yours: added by your household. Built-ins can be renamed by owners/admins." /></span></th>
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
                        <td><SourceBadge c={c} /></td>
                        <td>
                          <span style={{ display: "inline-flex", gap: "0.35rem" }}>
                            {showEditForRow(row) ? (
                              <button type="button" onClick={() => openEdit(row)} title="Edit" style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 4, cursor: "pointer", padding: "0.2rem 0.4rem", display: "inline-flex", alignItems: "center", color: "var(--color-text-muted)" }}>
                                <IconPencil size={13} />
                              </button>
                            ) : null}
                            {c.householdScoped ? (
                              <button type="button" onClick={() => requestDeleteCategory(c.id)} title="Delete" style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 4, cursor: "pointer", padding: "0.2rem 0.4rem", display: "inline-flex", alignItems: "center", color: "var(--color-danger, #dc2626)" }}>
                                <IconTrash size={13} />
                              </button>
                            ) : null}
                          </span>
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
                        <span style={{ display: "inline-flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          {showEditForRow(row) ? (
                            <button type="button" className="secondary" onClick={() => openEdit(row)}>
                              Edit
                            </button>
                          ) : null}
                          {c.householdScoped ? (
                            <button type="button" className="secondary" onClick={() => requestDeleteCategory(c.id)}>
                              Delete
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        opened={deleteConfirmId !== null}
        title="Delete category?"
        message="Delete this category? It must have no subcategories and no transaction rows."
        confirmLabel="Delete"
        danger
        closeOnClickOutside={false}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={confirmDeleteCategory}
      />
    </div>
  );
}
