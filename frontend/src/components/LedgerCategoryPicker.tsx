import { useMemo, useState } from "react";
import { Box, Button, Group, Text } from "@mantine/core";

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
  const [activeParentIdFromPicker, setActiveParentIdFromPicker] = useState<string | null>(null);
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
  const subcategoryParentId = activeParentIdFromPicker ?? selectedParentId;

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
    if (disabled || !subcategoryParentId) return;
    const parent = byId.get(subcategoryParentId);
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
    <Box>
      <HierarchicalSearchPicker
        value={value}
        onChange={(next) => void onChange(next)}
        onActiveParentChange={setActiveParentIdFromPicker}
        groups={groups}
        placeholder="Uncategorized"
        ariaLabel={ariaLabel}
        clearable
        disabled={disabled || savingCreate}
        footer={
          <Group justify="space-between">
            <Button type="button" variant="default" size="xs" onClick={() => void createParentGroup()} disabled={disabled || savingCreate}>
              Add group
            </Button>
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={() => void createSubcategory()}
              disabled={disabled || savingCreate || !subcategoryParentId}
              title={subcategoryParentId ? "Add subcategory under selected group" : "Select a group first"}
            >
              Add subcategory
            </Button>
          </Group>
        }
      />
      {error ? (
        <Text c="red" size="xs" mt={4}>
          {error}
        </Text>
      ) : null}
    </Box>
  );
}

