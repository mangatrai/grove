import { useMemo, useState } from "react";
import { Box, Button, Group, Modal, Text, TextInput } from "@mantine/core";

import { apiJson } from "../api";
import { buildCategoryAssignmentGroups, type CategoryOption } from "./categoryPickerGroups";
import { HierarchicalSearchPicker, type HierarchicalPickerGroup } from "./HierarchicalSearchPicker";

export type { CategoryOption };

type CreateMode = { kind: "group" } | { kind: "subcategory"; parentId: string; parentName: string } | null;

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
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [createName, setCreateName] = useState("");

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

  // activeParentIdFromPicker is the category UUID of the hovered parent (emitted by the picker).
  // Fall back to selectedParentId (derived from the current value) when no hover is active.
  const subcategoryParentId = activeParentIdFromPicker ?? selectedParentId;

  function openAddGroup() {
    if (disabled) return;
    setCreateName("");
    setError(null);
    setCreateMode({ kind: "group" });
  }

  function openAddSubcategory() {
    if (disabled || !subcategoryParentId) return;
    const parent = byId.get(subcategoryParentId);
    if (!parent) return;
    setCreateName("");
    setError(null);
    setCreateMode({ kind: "subcategory", parentId: parent.id, parentName: parent.name });
  }

  function closeModal() {
    setCreateMode(null);
    setCreateName("");
    setError(null);
  }

  async function handleCreate() {
    if (!createMode || !createName.trim()) return;
    setSavingCreate(true);
    setError(null);
    try {
      if (createMode.kind === "group") {
        const res = await apiJson<{ category: CategoryOption }>("/categories", {
          method: "POST",
          body: JSON.stringify({ name: createName.trim(), parentId: null })
        });
        closeModal();
        await Promise.resolve(onChange(res.category.id));
        await Promise.resolve(onCategoryCreated?.());
      } else {
        const res = await apiJson<{ category: CategoryOption }>("/categories", {
          method: "POST",
          body: JSON.stringify({ name: createName.trim(), parentId: createMode.parentId })
        });
        closeModal();
        await Promise.resolve(onChange(res.category.id));
        await Promise.resolve(onCategoryCreated?.());
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create category");
    } finally {
      setSavingCreate(false);
    }
  }

  const modalTitle = createMode?.kind === "group"
    ? "New top-level group"
    : `New subcategory under "${createMode?.kind === "subcategory" ? createMode.parentName : ""}"`;

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
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={openAddGroup}
              disabled={disabled || savingCreate}
            >
              Add group
            </Button>
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={openAddSubcategory}
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

      <Modal
        opened={createMode !== null}
        onClose={closeModal}
        title={modalTitle}
        size="sm"
        centered
      >
        <TextInput
          label="Name"
          placeholder="Enter a name"
          value={createName}
          onChange={(e) => setCreateName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
          data-autofocus
        />
        {error ? (
          <Text c="red" size="xs" mt={4}>{error}</Text>
        ) : null}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={closeModal} disabled={savingCreate}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreate()}
            loading={savingCreate}
            disabled={!createName.trim()}
          >
            Create
          </Button>
        </Group>
      </Modal>
    </Box>
  );
}
