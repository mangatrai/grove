import { useMemo, useState } from "react";

import { apiJson } from "../api";
import { buildCategoryAssignmentGroups, type CategoryOption } from "./categoryPickerGroups";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "./HierarchicalSearchPicker";

export type { CategoryOption };

export function LedgerCategoryPicker({
  categories,
  value,
  disabled,
  onChange,
  ariaLabel,
  onCategoryCreated
}: {
  categories: CategoryOption[];
  value: string | null;
  disabled: boolean;
  onChange: (categoryId: string | null) => void | Promise<void>;
  ariaLabel: string;
  /** Called after a new group or subcategory is created via this picker (parent can refetch categories). */
  onCategoryCreated?: () => void | Promise<void>;
}) {
  const [savingCreate, setSavingCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const groups: HierarchicalPickerGroup[] = useMemo(
    () => buildCategoryAssignmentGroups(categories, value),
    [categories, value]
  );
  const selectedParentId = useMemo(() => {
    if (!value) return null;
    const selected = byId.get(value);
    if (!selected) return null;
    return selected.parentId ?? selected.id;
  }, [value, byId]);
  async function createParentGroup() {
    if (disabled) return;
    const name = window.prompt("New top-level group name:");
    if (!name?.trim()) return;
    setSavingCreate(true);
    setError(null);
    try {
      const res = await apiJson<{ category: CategoryOption }>("/categories", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), parentId: null })
      });
      await Promise.resolve(onChange(res.category.id));
      await Promise.resolve(onCategoryCreated?.());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create group");
    } finally {
      setSavingCreate(false);
    }
  }
  async function createSubcategory() {
    if (disabled || !selectedParentId) return;
    const parent = byId.get(selectedParentId);
    if (!parent) return;
    const name = window.prompt(`New subcategory under ${parent.name}:`);
    if (!name?.trim()) return;
    setSavingCreate(true);
    setError(null);
    try {
      const res = await apiJson<{ category: CategoryOption }>("/categories", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), parentId: parent.id })
      });
      await Promise.resolve(onChange(res.category.id));
      await Promise.resolve(onCategoryCreated?.());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create subcategory");
    } finally {
      setSavingCreate(false);
    }
  }

  return (
    <div>
      <HierarchicalSearchPicker
        value={value}
        onChange={(next) => void onChange(next)}
        groups={groups}
        placeholder="Uncategorized"
        ariaLabel={ariaLabel}
        clearable
        disabled={disabled || savingCreate}
        footer={
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <button type="button" className="secondary" onClick={() => void createParentGroup()} disabled={disabled || savingCreate}>
              Add group
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void createSubcategory()}
              disabled={disabled || savingCreate || !selectedParentId}
              title={selectedParentId ? "Add subcategory under selected group" : "Select a group first"}
            >
              Add subcategory
            </button>
          </div>
        }
      />
      {error ? <p className="error" style={{ marginTop: "0.25rem" }}>{error}</p> : null}
    </div>
  );
}

