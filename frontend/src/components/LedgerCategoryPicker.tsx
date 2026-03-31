import { useMemo, useState } from "react";
import { Group, ActionIcon, Tooltip } from "@mantine/core";

import { apiJson } from "../api";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "./HierarchicalSearchPicker";

type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
};

export function LedgerCategoryPicker({
  categories,
  value,
  disabled,
  onChange,
  ariaLabel
}: {
  categories: CategoryOption[];
  value: string | null;
  disabled: boolean;
  onChange: (categoryId: string | null) => void | Promise<void>;
  ariaLabel: string;
}) {
  const [savingCreate, setSavingCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const topLevelParents = useMemo(
    () => categories.filter((c) => c.parentId === null).sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );
  const childrenByParentId = useMemo(() => {
    const map = new Map<string, CategoryOption[]>();
    for (const c of categories) {
      if (!c.parentId) continue;
      const arr = map.get(c.parentId) ?? [];
      arr.push(c);
      map.set(c.parentId, arr);
    }
    for (const [pid, arr] of map.entries()) {
      map.set(
        pid,
        arr.sort((a, b) => a.name.localeCompare(b.name))
      );
    }
    return map;
  }, [categories]);
  const groups: HierarchicalPickerGroup[] = useMemo(() => {
    const parentItems = topLevelParents.map((p) => ({
      value: p.id,
      label: p.name,
      searchText: p.name
    }));
    const childItems = topLevelParents.flatMap((p) =>
      (childrenByParentId.get(p.id) ?? []).map((c) => ({
        value: c.id,
        label: `${p.name} > ${c.name}`,
        searchText: `${p.name} ${c.name}`
      }))
    );
    return [
      { group: "Top-level groups", items: parentItems },
      { group: "Subcategories", items: childItems }
    ];
  }, [topLevelParents, childrenByParentId]);
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create subcategory");
    } finally {
      setSavingCreate(false);
    }
  }

  return (
    <div>
      <Group gap={6} wrap="nowrap" align="center">
        <HierarchicalSearchPicker
          value={value}
          onChange={(next) => void onChange(next)}
          groups={groups}
          placeholder="Uncategorized"
          ariaLabel={ariaLabel}
          clearable
          disabled={disabled || savingCreate}
        />
        <Tooltip label="Add top-level group">
          <ActionIcon
            variant="light"
            size="sm"
            onClick={() => void createParentGroup()}
            disabled={disabled || savingCreate}
            aria-label="Add top-level category group"
          >
            <span aria-hidden>+</span>
          </ActionIcon>
        </Tooltip>
        <Tooltip label={selectedParentId ? "Add subcategory under selected group" : "Select a group first"}>
          <ActionIcon
            variant="light"
            size="sm"
            onClick={() => void createSubcategory()}
            disabled={disabled || savingCreate || !selectedParentId}
            aria-label="Add subcategory under selected group"
          >
            <span aria-hidden>+</span>
          </ActionIcon>
        </Tooltip>
      </Group>
      {error ? <p className="error" style={{ marginTop: "0.25rem" }}>{error}</p> : null}
    </div>
  );
}

