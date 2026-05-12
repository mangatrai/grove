export type ParentSelectionNode = {
  selectableValue: string | null;
  children: Array<{ value: string }>;
};

export function toggleMultiValue(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
}

export function idsControlledByParent(parent: ParentSelectionNode): string[] {
  const childIds = parent.children.map((child) => child.value);
  const ownId = parent.selectableValue;
  return [...(ownId ? [ownId] : []), ...childIds];
}

export function toggleParentMultiSelection(selected: string[], parent: ParentSelectionNode): string[] {
  const allIds = idsControlledByParent(parent);
  if (allIds.length === 0) {
    return selected;
  }
  const alreadyAllSelected = allIds.every((id) => selected.includes(id));
  return alreadyAllSelected
    ? selected.filter((id) => !allIds.includes(id))
    : [...new Set([...selected, ...allIds])];
}

export function parentSelectedCount(parent: ParentSelectionNode, selected: string[]): number {
  const ids = new Set(idsControlledByParent(parent));
  return selected.filter((id) => ids.has(id)).length;
}
