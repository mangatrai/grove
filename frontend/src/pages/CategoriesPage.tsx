import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { Link, Navigate } from "react-router-dom";
import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Radio,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

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
  const [blockDeleteOpen, setBlockDeleteOpen] = useState(false);

  const canManageCategories = authRole === "owner" || authRole === "admin";

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

  const parentOptions = useMemo(
    () => topLevelParents.map((p) => ({ value: p.id, label: p.name })),
    [topLevelParents]
  );

  function openEdit(row: HierarchyRow) {
    setError(null);
    setEditRow(row);
    setEditName(row.category.name);
    setEditParentId(row.kind === "child" ? row.parent.id : "");
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
    const isChild = editRow.kind === "child";
    if (isChild && !editParentId) {
      setError("Choose a parent group.");
      return;
    }
    setEditSaving(true);
    setError(null);
    try {
      const body: { name: string; parentId?: string | null } = { name: trimmed };
      body.parentId = isChild ? editParentId : null;
      const res = await apiFetch(`/categories/${editRow.category.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
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
          parentId: addMode === "parent" ? null : parentId,
        }),
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
    }
  }, [deleteConfirmId, load]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <Paper p="md">
      <Group mb="xs" align="center">
        <Title order={1} size="h2" style={{ margin: 0 }}>Categories</Title>
        <HelpIcon label="Parent groups are the top-level buckets (Housing, Shopping…). Categories are specific line items underneath. Built-in entries can be renamed by owners/admins but not deleted. Source 'Yours' = added by your household." />
        <Group ml="auto" gap="md" fz="sm">
          <Anchor component={Link} to="/transactions">Transactions</Anchor>
          <Anchor component={Link} to="/categories/rules">Rules</Anchor>
        </Group>
      </Group>

      {error ? <Alert color="red" mb="sm" withCloseButton onClose={() => setError(null)}>{error}</Alert> : null}

      {/* Edit category modal */}
      <Modal opened={editOpen && editRow !== null} onClose={closeEdit} title="Edit category" centered>
        <form onSubmit={(e) => void onSaveEdit(e)}>
          <Stack gap="sm">
            <TextInput
              label="Name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
              required
            />
            {editRow?.kind === "child" ? (
              <Select
                label="Parent group"
                value={editParentId}
                onChange={(v) => setEditParentId(v ?? "")}
                data={parentOptions}
                placeholder="Select parent…"
                required
              />
            ) : editRow && categoryHasChildren(editRow.category.id, categories) ? (
              <Text size="sm" c="dimmed">
                This group has subcategories; only the name can be changed here.
              </Text>
            ) : null}
            <Group justify="flex-end" gap="sm" mt={4}>
              <Button variant="default" onClick={closeEdit} disabled={editSaving}>Cancel</Button>
              <Button type="submit" loading={editSaving}>Save</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Blocked delete modal — shown when trying to delete a parent that still has children */}
      <Modal
        opened={blockDeleteOpen}
        onClose={() => setBlockDeleteOpen(false)}
        title="Cannot delete group"
        centered
        size="sm"
      >
        <Stack gap="sm">
          <Text size="sm">
            This group still has subcategories. Delete or move all subcategories first, then delete the group.
          </Text>
          <Group justify="flex-end">
            <Button onClick={() => setBlockDeleteOpen(false)}>OK</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Add category form */}
      <Title order={2} size="h4" mt="md" mb="xs">Add category</Title>
      <form onSubmit={(e) => void onCreate(e)}>
        <Group align="flex-end" gap="md" wrap="wrap">
          <Radio.Group
            value={addMode}
            onChange={(v) => {
              setAddMode(v as "parent" | "child");
              if (v === "parent") setParentId("");
            }}
            label="Add a"
          >
            <Group gap="md" mt={4}>
              <Radio value="parent" label="New parent group" />
              <Radio value="child" label="Subcategory under a parent" />
            </Group>
          </Radio.Group>
          {addMode === "child" ? (
            <Select
              label="Parent group"
              value={parentId}
              onChange={(v) => setParentId(v ?? "")}
              data={parentOptions}
              placeholder="Select parent…"
              miw={200}
            />
          ) : null}
          <TextInput
            label={addMode === "parent" ? "Name of new group" : "Name of subcategory"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={addMode === "parent" ? "e.g. Pets, Travel" : "e.g. Vet, Flights"}
          />
          <Button
            type="submit"
            loading={saving}
            disabled={!name.trim() || (addMode === "child" && !parentId)}
          >
            Add
          </Button>
        </Group>
      </form>

      {/* All categories — accordion grouped by parent */}
      <Group mt="lg" mb="xs" align="center">
        <Title order={2} size="h4" style={{ margin: 0 }}>All categories</Title>
        <HelpIcon label="Built-in: ships with the app. Yours: added by your household. Built-ins can be renamed by owners/admins but not deleted." />
      </Group>

      {loading ? <Skeleton height={120} /> : null}
      {!loading && categories.length === 0 ? <Text c="dimmed">No categories.</Text> : null}
      {!loading && topLevelParents.length > 0 ? (
        <Accordion multiple variant="separated" chevronPosition="left">
          {topLevelParents.map((parent) => {
            const children = categories
              .filter((c) => c.parentId === parent.id)
              .sort((a, b) => a.name.localeCompare(b.name));
            const parentRow: HierarchyRow = { kind: "parent", category: parent };

            return (
              <Accordion.Item key={parent.id} value={parent.id}>
                <Accordion.Control>
                  <Group gap="sm" wrap="nowrap">
                    <Text fw={600} size="sm">{parent.name}</Text>
                    <Badge
                      variant={parent.householdScoped ? "light" : "outline"}
                      color={parent.householdScoped ? "green" : "gray"}
                      size="sm"
                    >
                      {parent.householdScoped ? "Yours" : "Built-in"}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {children.length === 0
                        ? "no subcategories"
                        : `${children.length} subcategor${children.length === 1 ? "y" : "ies"}`}
                    </Text>
                    {canManageCategories ? (
                      <Group gap={4} wrap="nowrap" ml="auto" onClick={(e) => e.stopPropagation()}>
                        <ActionIcon variant="subtle" color="gray" title="Edit group" onClick={() => openEdit(parentRow)}>
                          <IconPencil size={14} />
                        </ActionIcon>
                        {parent.householdScoped ? (
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            title="Delete group"
                            onClick={() => {
                              if (categoryHasChildren(parent.id, categories)) {
                                setBlockDeleteOpen(true);
                              } else {
                                setDeleteConfirmId(parent.id);
                              }
                            }}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        ) : null}
                      </Group>
                    ) : null}
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  {children.length === 0 ? (
                    <Text size="sm" c="dimmed" px="xs" pb="xs">No subcategories.</Text>
                  ) : (
                    <Table highlightOnHover withRowBorders={false}>
                      <Table.Tbody>
                        {children.map((child) => {
                          const childRow: HierarchyRow = { kind: "child", category: child, parent };
                          return (
                            <Table.Tr key={child.id}>
                              <Table.Td>{child.name}</Table.Td>
                              <Table.Td>
                                <Badge
                                  variant={child.householdScoped ? "light" : "outline"}
                                  color={child.householdScoped ? "green" : "gray"}
                                  size="sm"
                                >
                                  {child.householdScoped ? "Yours" : "Built-in"}
                                </Badge>
                              </Table.Td>
                              <Table.Td>
                                <Group gap={4} wrap="nowrap" justify="flex-end">
                                  {canManageCategories ? (
                                    <ActionIcon variant="subtle" color="gray" title="Edit" onClick={() => openEdit(childRow)}>
                                      <IconPencil size={14} />
                                    </ActionIcon>
                                  ) : null}
                                  {child.householdScoped && canManageCategories ? (
                                    <ActionIcon
                                      variant="subtle"
                                      color="red"
                                      title="Delete"
                                      onClick={() => setDeleteConfirmId(child.id)}
                                    >
                                      <IconTrash size={14} />
                                    </ActionIcon>
                                  ) : null}
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      ) : null}

      <ConfirmDialog
        opened={deleteConfirmId !== null}
        title="Delete category?"
        message="This cannot be undone. The category must have no transaction rows."
        confirmLabel="Delete"
        danger
        closeOnClickOutside={false}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={confirmDeleteCategory}
      />
    </Paper>
  );
}
