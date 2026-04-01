import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type FlatItem = { value: string; label: string; searchText?: string };

export type HierarchicalPickerGroup = {
  group: string;
  items: FlatItem[];
};

type PickerParent = {
  id: string;
  label: string;
  selectableValue: string | null;
  children: Array<{ value: string; label: string; searchText: string }>;
  searchText: string;
};

function flatten(groups: HierarchicalPickerGroup[]): FlatItem[] {
  return groups.flatMap((g) => g.items);
}

function normalizeGroups(groups: HierarchicalPickerGroup[]): PickerParent[] {
  const byLabel = new Map<string, PickerParent>();
  const standaloneGroupNames = new Set(["general", "household"]);
  function ensure(label: string): PickerParent {
    const key = label.toLowerCase();
    const existing = byLabel.get(key);
    if (existing) return existing;
    const next: PickerParent = {
      id: key,
      label,
      selectableValue: null,
      children: [],
      searchText: label
    };
    byLabel.set(key, next);
    return next;
  }
  for (const g of groups) {
    const groupName = g.group.trim();
    const groupLower = groupName.toLowerCase();
    for (const item of g.items) {
      const raw = item.label.trim();
      const parsed = raw.split(" > ").map((x) => x.trim()).filter(Boolean);
      if (parsed.length >= 2) {
        const parent = ensure(parsed[0]!);
        parent.children.push({
          value: item.value,
          label: parsed.slice(1).join(" > "),
          searchText: `${raw} ${item.searchText ?? ""}`.trim()
        });
        continue;
      }
      if (standaloneGroupNames.has(groupLower)) {
        const parent = ensure(raw);
        parent.selectableValue = item.value;
        parent.searchText = `${parent.searchText} ${item.searchText ?? ""}`.trim();
        continue;
      }
      const parent = ensure(groupName);
      parent.children.push({
        value: item.value,
        label: raw,
        searchText: `${groupName} ${raw} ${item.searchText ?? ""}`.trim()
      });
    }
  }
  return [...byLabel.values()]
    .map((p) => ({ ...p, children: [...p.children].sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function HierarchicalSearchPicker({
  value,
  onChange,
  groups,
  placeholder,
  ariaLabel,
  clearable = false,
  disabled = false,
  footer
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  groups: HierarchicalPickerGroup[];
  placeholder: string;
  ariaLabel: string;
  clearable?: boolean;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
  const parents = useMemo(() => normalizeGroups(groups), [groups]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return parents;
    return parents
      .map((p) => ({
        ...p,
        children: p.children.filter((c) => `${p.label} ${c.label} ${c.searchText}`.toLowerCase().includes(needle))
      }))
      .filter((p) => p.children.length > 0 || `${p.label} ${p.searchText}`.toLowerCase().includes(needle));
  }, [parents, search]);
  const selectedLabel = useMemo(() => lookupLabel(groups, value), [groups, value]);
  const activeParent = filtered.find((p) => p.id === activeParentId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setSearch("");
    }
    if (open) {
      window.addEventListener("mousedown", onDocClick);
      return () => window.removeEventListener("mousedown", onDocClick);
    }
  }, [open]);

  return (
    <div className="hs-picker" ref={rootRef}>
      <button
        type="button"
        className={`hs-picker__trigger${disabled ? " hs-picker__trigger--disabled" : ""}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span className={selectedLabel ? "hs-picker__value" : "hs-picker__placeholder"}>{selectedLabel ?? placeholder}</span>
        <span aria-hidden className="hs-picker__chev">▾</span>
      </button>
      {open ? (
        <div className="hs-picker__menu" role="listbox">
          <div className="hs-picker__search-wrap">
            <input
              ref={searchRef}
              className="hs-picker__search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to filter options..."
              aria-label={`${ariaLabel} search`}
            />
            {clearable ? (
              <button
                type="button"
                className="hs-picker__clear"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  setSearch("");
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          <div className="hs-picker__panes">
            <div className="hs-picker__parents">
              {filtered.length === 0 ? <div className="hs-picker__empty">No options</div> : null}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`hs-picker__parent${activeParent?.id === p.id ? " hs-picker__parent--active" : ""}`}
                  onMouseEnter={() => setActiveParentId(p.id)}
                  onClick={() => {
                    setActiveParentId(p.id);
                    if (p.selectableValue) {
                      onChange(p.selectableValue);
                      setOpen(false);
                      setSearch("");
                    }
                  }}
                >
                  <span>{p.label}</span>
                  {p.children.length ? <span className="hs-picker__arrow">›</span> : null}
                </button>
              ))}
            </div>
            <div className="hs-picker__children">
              {activeParent && activeParent.children.length > 0 ? (
                activeParent.children.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`hs-picker__child${value === c.value ? " hs-picker__child--active" : ""}`}
                    onClick={() => {
                      onChange(c.value);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    {c.label}
                  </button>
                ))
              ) : (
                <div className="hs-picker__empty">Hover/select a group to view submenu.</div>
              )}
            </div>
          </div>
          {footer ? <div className="hs-picker__footer">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function lookupLabel(groups: HierarchicalPickerGroup[], value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return flatten(groups).find((x) => x.value === value)?.label ?? null;
}
