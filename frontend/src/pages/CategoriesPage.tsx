import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { Link, Navigate } from "react-router-dom";
import {
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
      throw err;
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

      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

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

      <Title order={2} size="h4" mt="lg" mb="xs">All categories</Title>
      {loading ? <Skeleton height={80} /> : null}
      {!loading && categories.length === 0 ? <Text c="dimmed">No categories.</Text> : null}
      {!loading && categories.length > 0 ? (
        <Table.ScrollContainer minWidth={500}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Parent group</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th>
                  <Group gap={4}>
                    Source
                    <HelpIcon label="Built-in: ships with the app. Yours: added by your household. Built-ins can be renamed by owners/admins." />
                  </Group>
                </Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {hierarchyRows.map((row) => {
                const c = row.category;
                if (row.kind === "parent") {
                  return (
                    <Table.Tr key={c.id}>
                      <Table.Td c="dimmed" title="This row is a top-level group">—</Table.Td>
                      <Table.Td fw={600}>{c.name}</Table.Td>
                      <Table.Td>
                        <Badge variant={c.householdScoped ? "light" : "outline"} color={c.householdScoped ? "green" : "gray"} size="sm">
                          {c.householdScoped ? "Yours" : "Built-in"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          {canManageCategories ? (
                            <ActionIcon variant="subtle" color="gray" title="Edit" onClick={() => openEdit(row)}>
                              <IconPencil size={14} />
                            </ActionIcon>
                          ) : null}
                          {c.householdScoped && canManageCategories ? (
                            <ActionIcon variant="subtle" color="red" title="Delete" onClick={() => setDeleteConfirmId(c.id)}>
                              <IconTrash size={14} />
                            </ActionIcon>
                          ) : null}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                }
                const p = row.parent;
                return (
                  <Table.Tr key={c.id}>
                    <Table.Td>{p.name}</Table.Td>
                    <Table.Td style={{ paddingLeft: "1rem", borderLeft: "3px solid var(--mantine-color-default-border)" }}>{c.name}</Table.Td>
                    <Table.Td>
                      <Badge variant={c.householdScoped ? "light" : "outline"} color={c.householdScoped ? "green" : "gray"} size="sm">
                        {c.householdScoped ? "Yours" : "Built-in"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        {canManageCategories ? (
                          <ActionIcon variant="subtle" color="gray" title="Edit" onClick={() => openEdit(row)}>
                            <IconPencil size={14} />
                          </ActionIcon>
                        ) : null}
                        {c.householdScoped && canManageCategories ? (
                          <ActionIcon variant="subtle" color="red" title="Delete" onClick={() => setDeleteConfirmId(c.id)}>
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
        </Table.ScrollContainer>
      ) : null}

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
    </Paper>
  );
}
