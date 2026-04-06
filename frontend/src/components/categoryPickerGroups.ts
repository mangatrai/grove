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
          displayLabel: c.name,
          searchText: `${p.name} ${c.name}`
        }))
      )
    }
  ];
}

/**
 * Ledger row / Add transaction: top-level groups are selectable; children use `Parent > Child`.
 * Merges into one logical tree in `HierarchicalSearchPicker` (General parents first, then child paths).
 */
export function buildCategoryAssignmentGroups(
  categories: CategoryOption[],
  selectedId?: string | null
): HierarchicalPickerGroup[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parents = categories.filter((c) => c.parentId === null).sort((a, b) => a.name.localeCompare(b.name));
  const byParent = new Map<string, CategoryOption[]>();
  for (const c of categories) {
    if (c.parentId) {
      byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
    }
  }

  const generalItems = parents.map((p) => ({
    value: p.id,
    label: p.name,
    displayLabel: p.name,
    searchText: p.name
  }));

  const childItems = parents.flatMap((p) =>
    (byParent.get(p.id) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        value: c.id,
        label: `${p.name} > ${c.name}`,
        displayLabel: c.name,
        searchText: `${p.name} ${c.name}`
      }))
  );

  const seen = new Set<string>([...generalItems.map((i) => i.value), ...childItems.map((i) => i.value)]);
  if (selectedId && !seen.has(selectedId)) {
    const row = byId.get(selectedId);
    if (row) {
      const label =
        row.parentId && byId.get(row.parentId) ? `${byId.get(row.parentId)!.name} > ${row.name}` : row.name;
      generalItems.unshift({
        value: row.id,
        label,
        displayLabel: row.name,
        searchText: label
      });
    }
  }

  return [
    { group: "General", items: generalItems },
    { group: "Categories", items: childItems }
  ];
}
