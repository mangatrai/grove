import { Badge } from "@mantine/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  parentSelectedCount,
  toggleMultiValue,
  toggleParentMultiSelection
} from "./hierarchicalPickerMultiSelect.js";

/** `label` is used for search and menu; `displayLabel` (optional) is shown on the closed trigger only. */
export type HierarchicalPickerItem = {
  value: string;
  label: string;
  searchText?: string;
  displayLabel?: string;
};

export type HierarchicalPickerGroup = {
  group: string;
  items: HierarchicalPickerItem[];
};

type FlatItem = HierarchicalPickerItem;

type PickerParent = {
  id: string;
  label: string;
  selectableValue: string | null;
  children: Array<{ value: string; label: string; searchText: string }>;
  searchText: string;
};

type PickerProps = {
  groups: HierarchicalPickerGroup[];
  placeholder: string;
  ariaLabel: string;
  clearable?: boolean;
  disabled?: boolean;
  footer?: ReactNode;
  onActiveParentChange?: (parentId: string | null) => void;
} & (
  | {
      multiSelect?: false;
      value: string | null;
      onChange: (value: string | null) => void;
    }
  | {
      multiSelect: true;
      multiValue: string[];
      onMultiChange: (value: string[]) => void;
      multiSelectLabel?: string;
    }
);

function flatten(groups: HierarchicalPickerGroup[]): FlatItem[] {
  return groups.flatMap((g) => g.items);
}

/** Text for the closed picker button and filter chips (prefers `displayLabel` when set). */
export function lookupTriggerLabel(
  groups: HierarchicalPickerGroup[],
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }
  const item = flatten(groups).find((x) => x.value === value);
  if (!item) {
    return null;
  }
  return item.displayLabel ?? item.label;
}

/** Alias for `lookupTriggerLabel` (short display for trigger / chips). */
export const lookupLabel = lookupTriggerLabel;

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

export function HierarchicalSearchPicker(props: PickerProps) {
  const {
    groups,
    placeholder,
    ariaLabel,
    clearable = false,
    disabled = false,
    footer,
    onActiveParentChange
  } = props;
  const multiSelect = props.multiSelect === true;
  const value = !multiSelect ? props.value : null;
  const onChange = !multiSelect ? props.onChange : undefined;
  const multiValue = multiSelect ? props.multiValue : [];
  const onMultiChange = multiSelect ? props.onMultiChange : undefined;
  const multiSelectLabel = multiSelect ? (props.multiSelectLabel ?? "items") : "items";

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
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
  const selectedLabel = useMemo(() => lookupTriggerLabel(groups, value), [groups, value]);
  const multiTriggerLabel = useMemo(() => {
    if (!multiSelect || multiValue.length === 0) {
      return null;
    }
    if (multiValue.length === 1) {
      return lookupTriggerLabel(groups, multiValue[0]!) ?? multiValue[0]!;
    }
    if (multiValue.length === 2) {
      const a = lookupTriggerLabel(groups, multiValue[0]!) ?? multiValue[0]!;
      const b = lookupTriggerLabel(groups, multiValue[1]!) ?? multiValue[1]!;
      return `${a}, ${b}`;
    }
    return `${multiValue.length} ${multiSelectLabel}`;
  }, [groups, multiSelect, multiSelectLabel, multiValue]);
  const activeParent = filtered.find((p) => p.id === activeParentId) ?? filtered[0] ?? null;

  const toggleMulti = useCallback(
    (id: string) => {
      if (!onMultiChange) return;
      onMultiChange(toggleMultiValue(multiValue, id));
    },
    [multiValue, onMultiChange]
  );

  const toggleParentChildren = useCallback(
    (parent: PickerParent) => {
      if (!onMultiChange) return;
      onMultiChange(toggleParentMultiSelection(multiValue, parent));
    },
    [multiValue, onMultiChange]
  );

  useEffect(() => {
    if (filtered.length === 0) {
      if (activeParentId !== null) {
        setActiveParentId(null);
      }
      return;
    }
    if (!activeParentId || !filtered.some((p) => p.id === activeParentId)) {
      setActiveParentId(filtered[0]!.id);
    }
  }, [filtered, activeParentId]);

  useEffect(() => {
    onActiveParentChange?.(activeParent?.selectableValue ?? null);
  }, [activeParent, onActiveParentChange]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const positionMenu = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minMenuW = Math.min(384, vw - margin * 2);
    const width = Math.max(r.width, minMenuW);
    let left = r.left;
    if (left + width > vw - margin) {
      left = Math.max(margin, vw - margin - width);
    }
    const spaceBelow = vh - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const openDown = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    if (openDown) {
      const top = r.bottom + 4;
      const maxH = Math.max(160, vh - top - margin);
      setMenuStyle({
        position: "fixed",
        top,
        left,
        width,
        maxHeight: maxH,
        zIndex: 1300
      });
    } else {
      const maxH = Math.max(160, r.top - margin - 4);
      const estTop = Math.max(margin, r.top - 4 - Math.min(420, maxH));
      setMenuStyle({
        position: "fixed",
        top: estTop,
        left,
        width,
        maxHeight: maxH,
        zIndex: 1300
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
    const onReposition = () => positionMenu();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, positionMenu, filtered, search]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
      setSearch("");
    }
    if (open) {
      window.addEventListener("mousedown", onDocClick);
      return () => window.removeEventListener("mousedown", onDocClick);
    }
  }, [open]);

  const triggerText = multiSelect ? multiTriggerLabel : selectedLabel;

  const menuContent = open ? (
    <div ref={menuRef} className="hs-picker__menu hs-picker__menu--portal" style={menuStyle} role="listbox">
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
              if (multiSelect) {
                onMultiChange?.([]);
              } else {
                onChange?.(null);
                setOpen(false);
              }
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
          {filtered.map((p) => {
            const chipCount = multiSelect ? parentSelectedCount(p, multiValue) : 0;
            return (
              <button
                key={p.id}
                type="button"
                className={`hs-picker__parent${activeParent?.id === p.id ? " hs-picker__parent--active" : ""}`}
                onMouseEnter={() => setActiveParentId(p.id)}
                onClick={() => {
                  setActiveParentId(p.id);
                  if (multiSelect) {
                    toggleParentChildren(p);
                    return;
                  }
                  if (p.selectableValue) {
                    onChange?.(p.selectableValue);
                    setOpen(false);
                    setSearch("");
                  }
                }}
              >
                <span>{p.label}</span>
                {multiSelect && chipCount > 0 ? (
                  <Badge size="xs" color="fsForest" variant="light" ml="auto">
                    {chipCount}
                  </Badge>
                ) : null}
                {p.children.length ? <span className="hs-picker__arrow">›</span> : null}
              </button>
            );
          })}
        </div>
        <div className="hs-picker__children">
          {activeParent ? (
            <>
              {activeParent.children.length > 0 ? (
                activeParent.children.map((c) =>
                  multiSelect ? (
                    <button
                      key={c.value}
                      type="button"
                      className={`hs-picker__child${multiValue.includes(c.value) ? " hs-picker__child--active" : ""}`}
                      onClick={() => toggleMulti(c.value)}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          minWidth: 16,
                          marginRight: 6,
                          color: "var(--color-accent, #2d6a4f)",
                          fontWeight: 700,
                          fontSize: 11,
                          lineHeight: 1
                        }}
                        aria-hidden
                      >
                        {multiValue.includes(c.value) ? "✓" : ""}
                      </span>
                      {c.label}
                    </button>
                  ) : (
                    <button
                      key={c.value}
                      type="button"
                      className={`hs-picker__child${value === c.value ? " hs-picker__child--active" : ""}`}
                      onClick={() => {
                        onChange?.(c.value);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      {c.label}
                    </button>
                  )
                )
              ) : !multiSelect || !activeParent.selectableValue ? (
                <div className="hs-picker__empty">Hover/select a group to view submenu.</div>
              ) : null}
            </>
          ) : (
            <div className="hs-picker__empty">Hover/select a group to view submenu.</div>
          )}
        </div>
      </div>
      {footer ? <div className="hs-picker__footer">{footer}</div> : null}
    </div>
  ) : null;

  return (
    <div className="hs-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`hs-picker__trigger${disabled ? " hs-picker__trigger--disabled" : ""}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span className={triggerText ? "hs-picker__value" : "hs-picker__placeholder"}>{triggerText ?? placeholder}</span>
        <span aria-hidden className="hs-picker__chev">
          ▾
        </span>
      </button>
      {typeof document !== "undefined" && menuContent ? createPortal(menuContent, document.body) : null}
    </div>
  );
}
