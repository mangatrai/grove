import { Select, type ComboboxItem, type OptionsFilter } from "@mantine/core";

type FlatItem = ComboboxItem & { searchText?: string };

export type HierarchicalPickerGroup = {
  group: string;
  items: FlatItem[];
};

function flatten(groups: HierarchicalPickerGroup[]): FlatItem[] {
  return groups.flatMap((g) => g.items);
}

const filterByLabelAndSearchText: OptionsFilter = ({ options, search, limit }) => {
  const needle = search.trim().toLowerCase();
  const groups = options as HierarchicalPickerGroup[];
  if (!needle) {
    return groups.map((g) => ({
      group: g.group,
      items: g.items.slice(0, limit)
    }));
  }
  const out: HierarchicalPickerGroup[] = [];
  for (const g of groups) {
    const matched = g.items.filter((item) => {
      const hay = `${item.label} ${item.searchText ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
    if (matched.length) {
      out.push({ group: g.group, items: matched.slice(0, limit) });
    }
  }
  return out;
};

export function HierarchicalSearchPicker({
  value,
  onChange,
  groups,
  placeholder,
  ariaLabel,
  clearable = false,
  disabled = false
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  groups: HierarchicalPickerGroup[];
  placeholder: string;
  ariaLabel: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  if (groups.length === 0) {
    return (
      <Select
        value={null}
        onChange={() => undefined}
        data={[]}
        placeholder={placeholder}
        aria-label={ariaLabel}
        searchable
        nothingFoundMessage="No options"
        disabled
      />
    );
  }

  return (
    <Select
      value={value}
      onChange={onChange}
      data={groups}
      placeholder={placeholder}
      aria-label={ariaLabel}
      searchable
      clearable={clearable}
      nothingFoundMessage="No options"
      filter={filterByLabelAndSearchText}
      comboboxProps={{ position: "bottom-start", middlewares: { flip: true, shift: true } }}
      maxDropdownHeight={320}
      disabled={disabled}
    />
  );
}

export function lookupLabel(groups: HierarchicalPickerGroup[], value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return flatten(groups).find((x) => x.value === value)?.label ?? null;
}
