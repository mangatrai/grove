import type { HierarchicalPickerGroup } from "./HierarchicalSearchPicker";

export type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
};

/** Toolbar filter: Any / Uncategorized / roll-up parents / leaf paths. */
export function buildCategoryFilterGroups(categories: CategoryOption[]): HierarchicalPickerGroup[] {
  const parents = categories.filter((c) => c.parentId === null).sort((a, b) => a.name.localeCompare(b.name));
  const children = categories.filter((c) => c.parentId !== null).sort((a, b) => a.name.localeCompare(b.name));
  const byParent = new Map<string, CategoryOption[]>();
  for (const c of children) {
    byParent.set(c.parentId!, [...(byParent.get(c.parentId!) ?? []), c]);
  }
  return [
    {
      group: "General",
      items: [
        { value: "__any__", label: "Any", searchText: "any" },
        { value: "__uncat__", label: "Uncategorized only", searchText: "uncategorized" },
        ...parents.map((p) => ({ value: p.id, label: p.name, searchText: p.name }))
      ]
    },
    {
      group: "Categories",
      items: parents.flatMap((p) =>
        (byParent.get(p.id) ?? []).map((c) => ({
          value: c.id,
          label: `${p.name} > ${c.name}`,
          searchText: `${p.name} ${c.name}`
        }))
      )
    }
  ];
}

/** Leaf-only categories (same rule targets as `/categories/rules`). */
function assignableLeafCategories(categories: CategoryOption[]): CategoryOption[] {
  const idsWithChildren = new Set(
    categories.filter((c) => c.parentId).map((c) => c.parentId as string)
  );
  return categories.filter((c) => !idsWithChildren.has(c.id));
}

/**
 * Transaction row / Add transaction: only assignable leaves, labels aligned with filter (`Parent > Child`).
 * If `selectedId` points at a non-leaf (legacy row), include it once so the current value stays visible.
 */
export function buildCategoryAssignmentGroups(
  categories: CategoryOption[],
  selectedId?: string | null
): HierarchicalPickerGroup[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const assignable = assignableLeafCategories(categories);
  const assignableIds = new Set(assignable.map((c) => c.id));
  const rowLabel = (c: CategoryOption) =>
    c.parentId && byId.get(c.parentId) ? `${byId.get(c.parentId)!.name} > ${c.name}` : c.name;
  let items = assignable
    .map((c) => {
      const label = rowLabel(c);
      return { value: c.id, label, searchText: label };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  if (selectedId && !assignableIds.has(selectedId)) {
    const row = byId.get(selectedId);
    if (row) {
      const label = rowLabel(row);
      items = [{ value: row.id, label, searchText: label }, ...items];
    }
  }
  return [{ group: "Categories", items }];
}
