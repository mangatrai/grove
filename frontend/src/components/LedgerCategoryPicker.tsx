import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { apiJson } from "../api";

type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
};

export function LedgerCategoryPicker({
  categories,
  value,
  disabled,
  onChange,
  ariaLabel
}: {
  categories: CategoryOption[];
  value: string | null;
  disabled: boolean;
  onChange: (categoryId: string | null) => void | Promise<void>;
  ariaLabel: string;
}) {
  const topLevelParents = useMemo(() => {
    return categories
      .filter((c) => c.parentId === null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, CategoryOption[]>();
    for (const c of categories) {
      if (!c.parentId) continue;
      const arr = map.get(c.parentId) ?? [];
      arr.push(c);
      map.set(c.parentId, arr);
    }
    for (const [pid, arr] of map) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
      map.set(pid, arr);
    }
    return map;
  }, [categories]);

  const topLevelParentIds = useMemo(() => new Set(topLevelParents.map((p) => p.id)), [topLevelParents]);

  const selectedCategory = useMemo(() => {
    if (!value) return null;
    return categories.find((c) => c.id === value) ?? null;
  }, [categories, value]);

  const selectedTopLevelParentId = useMemo(() => {
    if (!selectedCategory) return null;
    if (selectedCategory.parentId === null) return selectedCategory.id;
    return selectedCategory.parentId;
  }, [selectedCategory]);

  /** Single-line trigger: show the selected category’s own name; distinguish parent vs leaf visually. */
  const triggerDisplay = useMemo(() => {
    if (!selectedCategory) {
      return { label: "Uncategorized", kind: "empty" as const };
    }
    if (selectedCategory.parentId === null) {
      return { label: selectedCategory.name, kind: "parent" as const };
    }
    return { label: selectedCategory.name, kind: "leaf" as const };
  }, [selectedCategory]);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);
  const [flyoutStyle, setFlyoutStyle] = useState<CSSProperties>({});

  const [activeTopLevelParentId, setActiveTopLevelParentId] = useState<string | null>(selectedTopLevelParentId);
  const [error, setError] = useState<string | null>(null);
  const [savingCreate, setSavingCreate] = useState(false);

  const [addParentName, setAddParentName] = useState("");
  const [addChildName, setAddChildName] = useState("");

  const activeChildren = useMemo(() => {
    if (!activeTopLevelParentId) return [];
    return childrenByParentId.get(activeTopLevelParentId) ?? [];
  }, [activeTopLevelParentId, childrenByParentId]);

  const canAddChild = Boolean(activeTopLevelParentId && topLevelParentIds.has(activeTopLevelParentId));

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    // Focus restoration: always return focus to the trigger after the popover closes.
    window.setTimeout(() => {
      triggerRef.current?.focus();
    }, 0);
  }, []);

  const openFlyout = useCallback(() => {
    if (disabled) return;
    setError(null);
    setSavingCreate(false);
    setActiveTopLevelParentId(selectedTopLevelParentId);
    setOpen(true);
  }, [disabled, selectedTopLevelParentId]);

  useEffect(() => {
    if (!open) return;
    if (disabled) {
      close();
      return;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (flyoutRef.current?.contains(target)) return;
      close();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close, disabled, open]);

  const positionFlyout = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = flyoutRef.current;
    if (!open || !trigger) return;

    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;
    const maxW = Math.min(580, vw - pad * 2);
    let left = rect.left;
    left = Math.min(Math.max(pad, left), vw - maxW - pad);

    const panelH = panel?.offsetHeight ?? 400;
    let top = rect.bottom + 8;
    const spaceBelow = vh - top - pad;
    const spaceAbove = rect.top - pad;
    if (panelH > spaceBelow && spaceAbove > spaceBelow) {
      top = Math.max(pad, rect.top - panelH - 8);
    }
    if (top + panelH > vh - pad) {
      top = Math.max(pad, vh - pad - panelH);
    }

    setFlyoutStyle({
      position: "fixed",
      top,
      left,
      width: maxW,
      maxHeight: Math.min(vh * 0.72, vh - top - pad),
      zIndex: 1002
    });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    positionFlyout();
    const id = requestAnimationFrame(() => positionFlyout());
    return () => cancelAnimationFrame(id);
  }, [open, positionFlyout, activeTopLevelParentId, categories.length]);

  useEffect(() => {
    if (!open) return;
    const opts = { capture: true, passive: true } as const;
    const parents: Element[] = [];
    let el = triggerRef.current?.parentElement ?? null;
    while (el) {
      const st = getComputedStyle(el);
      if (/(auto|scroll|overlay)/.test(`${st.overflow}${st.overflowY}${st.overflowX}`)) {
        parents.push(el);
        el.addEventListener("scroll", positionFlyout, opts);
      }
      el = el.parentElement;
    }
    window.addEventListener("resize", positionFlyout);
    window.addEventListener("scroll", positionFlyout, opts);
    return () => {
      window.removeEventListener("resize", positionFlyout);
      window.removeEventListener("scroll", positionFlyout, opts);
      parents.forEach((p) => p.removeEventListener("scroll", positionFlyout, opts));
    };
  }, [open, positionFlyout]);

  useEffect(() => {
    if (!open) return;
    // Improve keyboard UX: focus the "Uncategorized" option on open.
    window.setTimeout(() => {
      firstFocusableRef.current?.focus();
    }, 0);
  }, [open]);

  useEffect(() => {
    // Keep hover/focus state synced when the selected category changes
    // while the picker is closed.
    if (open) return;
    setActiveTopLevelParentId(selectedTopLevelParentId);
  }, [open, selectedTopLevelParentId]);

  const selectCategory = useCallback(
    async (categoryId: string | null) => {
      if (disabled) return;
      setError(null);
      try {
        await Promise.resolve(onChange(categoryId));
        close();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to set category");
      }
    },
    [close, disabled, onChange]
  );

  const createParentGroup = useCallback(async () => {
    if (disabled) return;
    const trimmed = addParentName.trim();
    if (!trimmed) return;
    setError(null);
    setSavingCreate(true);
    try {
      const res = await apiJson<{ category: CategoryOption }>("/categories", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, parentId: null })
      });
      setAddParentName("");
      await Promise.resolve(onChange(res.category.id));
      close();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not add parent group");
    } finally {
      setSavingCreate(false);
    }
  }, [addParentName, close, disabled, onChange]);

  const createSubcategory = useCallback(async () => {
    if (disabled) return;
    if (!activeTopLevelParentId) return;
    const trimmed = addChildName.trim();
    if (!trimmed) return;
    if (!topLevelParentIds.has(activeTopLevelParentId)) return;

    setError(null);
    setSavingCreate(true);
    try {
      const res = await apiJson<{ category: CategoryOption }>("/categories", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, parentId: activeTopLevelParentId })
      });
      setAddChildName("");
      await Promise.resolve(onChange(res.category.id));
      close();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not add subcategory");
    } finally {
      setSavingCreate(false);
    }
  }, [activeTopLevelParentId, addChildName, close, disabled, onChange, topLevelParentIds]);

  return (
    <div className="ledger-category-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={[
          "ledger-category-picker__trigger",
          triggerDisplay.kind === "empty" ? "ledger-category-picker__trigger--empty" : "",
          triggerDisplay.kind === "parent" ? "ledger-category-picker__trigger--parent" : "",
          triggerDisplay.kind === "leaf" ? "ledger-category-picker__trigger--leaf" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        title={triggerDisplay.label}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openFlyout())}
      >
        <span className="ledger-category-picker__trigger-text">{triggerDisplay.label}</span>
      </button>

      {open
        ? createPortal(
            <>
              <div
                className="ledger-category-picker__backdrop"
                aria-hidden
                onMouseDown={(e) => {
                  e.preventDefault();
                  close();
                }}
              />
              <div
                ref={flyoutRef}
                className="ledger-category-picker__flyout"
                style={flyoutStyle}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
              >
                <div className="ledger-category-picker__shell">
                  <header className="ledger-category-picker__header">
                    <span className="ledger-category-picker__header-title">Choose category</span>
                    <button
                      type="button"
                      className="ledger-category-picker__close"
                      aria-label="Close"
                      onClick={() => close()}
                    >
                      ×
                    </button>
                  </header>

                  <div className="ledger-category-picker__columns">
                    <div className="ledger-category-picker__col">
                      <div className="ledger-category-picker__col-title">Groups</div>
                      <div className="ledger-category-picker__list" role="listbox" aria-label="Parent groups list">
                        {topLevelParents.map((p) => {
                          const isActive = activeTopLevelParentId === p.id;
                          const isSelected = value === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              className={[
                                "ledger-category-picker__item",
                                isActive ? "ledger-category-picker__item--active" : ""
                              ].join(" ")}
                              onMouseEnter={() => setActiveTopLevelParentId(p.id)}
                              onFocus={() => setActiveTopLevelParentId(p.id)}
                              onClick={() => void selectCategory(p.id)}
                            >
                              {p.name}
                            </button>
                          );
                        })}
                        {topLevelParents.length === 0 ? (
                          <p className="ledger-category-picker__help">No parent groups.</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="ledger-category-picker__col">
                      <div className="ledger-category-picker__col-title">Subcategories</div>
                      <div className="ledger-category-picker__list" role="listbox" aria-label="Subcategories list">
                        <button
                          ref={firstFocusableRef}
                          type="button"
                          role="option"
                          aria-selected={value === null}
                          className={[
                            "ledger-category-picker__item",
                            "ledger-category-picker__item--clear",
                            value === null ? "ledger-category-picker__item--active" : ""
                          ].join(" ")}
                          onClick={() => void selectCategory(null)}
                        >
                          Clear selection
                        </button>

                        {!activeTopLevelParentId ? (
                          <p className="ledger-category-picker__help">Select a group to see subcategories.</p>
                        ) : null}

                        {activeChildren.map((c) => {
                          const isSelected = value === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              className={[
                                "ledger-category-picker__item",
                                isSelected ? "ledger-category-picker__item--active" : ""
                              ].join(" ")}
                              onClick={() => void selectCategory(c.id)}
                            >
                              {c.name}
                            </button>
                          );
                        })}

                        {activeTopLevelParentId && activeChildren.length === 0 ? (
                          <p className="ledger-category-picker__help">No subcategories yet.</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="ledger-category-picker__col ledger-category-picker__col--add">
                      <div className="ledger-category-picker__col-title">New category</div>
                      <div className="ledger-category-picker__add-card">
                        <form
                          className="ledger-category-picker__form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void createParentGroup();
                          }}
                        >
                          <span className="ledger-category-picker__field-label">New top-level group</span>
                          <input
                            className="ledger-category-picker__input"
                            type="text"
                            value={addParentName}
                            onChange={(e) => setAddParentName(e.target.value)}
                            placeholder="e.g. Pets, Travel"
                            disabled={disabled || savingCreate}
                            autoComplete="off"
                          />
                          <button
                            type="submit"
                            className="ledger-category-picker__btn-primary"
                            disabled={disabled || savingCreate || !addParentName.trim()}
                          >
                            {savingCreate ? "Saving…" : "Create group"}
                          </button>
                        </form>

                        <form
                          className="ledger-category-picker__form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void createSubcategory();
                          }}
                        >
                          <span className="ledger-category-picker__field-label">
                            Subcategory under{" "}
                            <strong>
                              {activeTopLevelParentId
                                ? topLevelParents.find((p) => p.id === activeTopLevelParentId)?.name ?? "…"
                                : "—"}
                            </strong>
                          </span>
                          <input
                            className="ledger-category-picker__input"
                            type="text"
                            value={addChildName}
                            onChange={(e) => setAddChildName(e.target.value)}
                            placeholder={canAddChild ? "e.g. Vet, Flights" : "Select a group first"}
                            disabled={disabled || savingCreate || !canAddChild}
                            autoComplete="off"
                          />
                          <button
                            type="submit"
                            className="ledger-category-picker__btn-primary"
                            disabled={disabled || savingCreate || !canAddChild || !addChildName.trim()}
                          >
                            {savingCreate ? "Saving…" : "Add subcategory"}
                          </button>
                        </form>
                      </div>

                      {error ? <p className="ledger-category-picker__error">{error}</p> : null}
                    </div>
                  </div>
                </div>
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  );
}

