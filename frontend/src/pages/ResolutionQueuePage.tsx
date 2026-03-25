import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { LedgerCategoryPicker } from "../components/LedgerCategoryPicker";

type ResolutionItem = {
  id: string;
  type: string;
  targetId: string;
  reason: string;
  reasonDetail: { kind?: string; message?: string; existingCanonicalId?: string; rawId?: string } | null;
  status: ResolutionStatus;
  createdAt: string;
  context: {
    sessionId: string | null;
    fileId: string | null;
    fileName: string | null;
    raw: {
      txnDate: string | null;
      amount: number | null;
      description: string | null;
      referenceId: string | null;
    } | null;
  };
};

type ResolutionStatus = "open" | "in_review" | "resolved";
type ResolutionFilter = ResolutionStatus | "all";

type ResolutionTypeFilter =
  | "all"
  | "unknown_category"
  | "duplicate_ambiguity"
  | "transfer_ambiguity"
  | "reconciliation_mismatch";

type CategoryOption = { id: string; name: string; parentId: string | null };

function formatType(t: string): string {
  switch (t) {
    case "duplicate_ambiguity":
      return "Near-duplicate / ambiguous match";
    case "unknown_category":
      return "Unknown category";
    case "transfer_ambiguity":
      return "Transfer ambiguity";
    case "reconciliation_mismatch":
      return "Reconciliation mismatch";
    default:
      return t;
  }
}

export function ResolutionQueuePage() {
  const token = useAuthToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ResolutionItem[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [assigningTxnId, setAssigningTxnId] = useState<string | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ResolutionFilter>("open");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const typeFilter = (searchParams.get("type") as ResolutionTypeFilter) || "all";

  const load = useCallback(async () => {
    setError(null);
    const qs = new URLSearchParams();
    qs.set("status", statusFilter);
    qs.set("type", typeFilter);
    const res = await apiJson<{ items: ResolutionItem[]; status: ResolutionFilter }>(
      `/resolution?${qs.toString()}`
    );
    setItems(res.items);
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<{ categories: CategoryOption[] }>("/categories")
      .then((r) => setCategories(r.categories))
      .catch(() => setCategories([]));
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    void load()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [token, load]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter, typeFilter]);

  function setTypeFilter(next: ResolutionTypeFilter) {
    const p = new URLSearchParams(searchParams);
    if (next === "all") {
      p.delete("type");
    } else {
      p.set("type", next);
    }
    setSearchParams(p);
  }

  const selectedCount = selectedIds.size;
  const allVisibleSelected = useMemo(
    () => items.length > 0 && items.every((it) => selectedIds.has(it.id)),
    [items, selectedIds]
  );

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((it) => it.id)));
    }
  }

  async function bulkApplyCategory() {
    if (!bulkCategoryId || selectedIds.size === 0) {
      return;
    }
    const ids = [...selectedIds].filter((id) => {
      const it = items.find((x) => x.id === id);
      return it?.type === "unknown_category";
    });
    if (ids.length === 0) {
      setError("Select one or more “Unknown category” rows to apply a category.");
      return;
    }
    setError(null);
    setSavingBulk(true);
    try {
      const res = await apiJson<{ updated: { id: string }[]; errors: { id: string; code: string }[] }>(
        "/resolution/bulk-apply-category",
        {
          method: "POST",
          body: JSON.stringify({ ids, categoryId: bulkCategoryId })
        }
      );
      if (res.errors.length > 0) {
        setError(`Applied to ${res.updated.length}; ${res.errors.length} row(s) could not be updated.`);
      }
      setSelectedIds(new Set());
      setBulkCategoryId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk category apply failed");
    } finally {
      setSavingBulk(false);
    }
  }

  async function bulkUpdateStatus(status: ResolutionStatus) {
    if (selectedIds.size === 0) {
      return;
    }
    setError(null);
    setSavingBulk(true);
    try {
      const res = await apiJson<{ updated: { id: string; status: string }[]; errors: { id: string; code: string }[] }>(
        "/resolution/bulk",
        {
          method: "POST",
          body: JSON.stringify({ ids: [...selectedIds], status })
        }
      );
      if (res.errors.length > 0) {
        setError(
          `Updated ${res.updated.length} item(s); ${res.errors.length} could not be changed (${res.errors.map((e) => e.code).join(", ")})`
        );
      }
      setSelectedIds(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk update failed");
    } finally {
      setSavingBulk(false);
    }
  }

  async function updateStatus(itemId: string, status: ResolutionStatus) {
    setError(null);
    setSavingId(itemId);
    try {
      await apiJson(`/resolution/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await load();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update item");
    } finally {
      setSavingId(null);
    }
  }

  function formatMoney(amount: number | null): string {
    if (amount == null) {
      return "—";
    }
    const abs = Math.abs(amount);
    const sign = amount >= 0 ? "+" : "−";
    return `${sign}$${abs.toFixed(2)}`;
  }

  return (
    <div>
      <div className="card">
        <h1>Review queue</h1>
        <p className="muted">
          Items from imports: near-duplicates, <strong>unknown category</strong> (no rule matched — assign a category
          below or on the ledger), and transfer pairings that need a second look.
        </p>
        <div className="row" style={{ marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <label style={{ marginBottom: 0 }}>
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ResolutionFilter)}
              style={{ marginLeft: "0.5rem", width: "auto", minWidth: "10rem" }}
            >
              <option value="open">Open</option>
              <option value="in_review">In review</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </label>
          <label style={{ marginBottom: 0 }}>
            Type
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ResolutionTypeFilter)}
              style={{ marginLeft: "0.5rem", width: "auto", minWidth: "12rem" }}
            >
              <option value="all">All types</option>
              <option value="unknown_category">Unknown category</option>
              <option value="duplicate_ambiguity">Near-duplicate</option>
              <option value="transfer_ambiguity">Transfer ambiguity</option>
              <option value="reconciliation_mismatch">Reconciliation</option>
            </select>
          </label>
          {selectedCount > 0 ? (
            <span className="row" style={{ gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <span className="muted">
                {selectedCount} selected
              </span>
              <button
                type="button"
                className="secondary"
                disabled={savingBulk}
                onClick={() => void bulkUpdateStatus("in_review")}
              >
                In review
              </button>
              <button type="button" disabled={savingBulk} onClick={() => void bulkUpdateStatus("resolved")}>
                Resolve
              </button>
              <button
                type="button"
                className="secondary"
                disabled={savingBulk}
                onClick={() => void bulkUpdateStatus("open")}
              >
                Reopen
              </button>
              <label style={{ marginBottom: 0, marginLeft: "0.5rem" }}>
                <span className="muted" style={{ marginRight: "0.35rem" }}>
                  Category (unknown items)
                </span>
                <select
                  value={bulkCategoryId}
                  onChange={(e) => setBulkCategoryId(e.target.value)}
                  disabled={savingBulk}
                  style={{ minWidth: "10rem" }}
                >
                  <option value="">—</option>
                  {categories
                    .filter((c) => !c.parentId)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => {
                      const children = categories
                        .filter((c) => c.parentId === p.id)
                        .sort((a, b) => a.name.localeCompare(b.name));
                      if (children.length === 0) {
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        );
                      }
                      return (
                        <optgroup key={p.id} label={p.name}>
                          {children.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                </select>
              </label>
              <button
                type="button"
                disabled={savingBulk || !bulkCategoryId || selectedIds.size === 0}
                onClick={() => void bulkApplyCategory()}
              >
                Apply category
              </button>
            </span>
          ) : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && items.length === 0 ? (
          <p className="muted">
            {statusFilter === "all"
              ? "No items in the queue."
              : `No ${statusFilter.replace("_", " ")} items right now.`}
          </p>
        ) : null}
        {!loading && items.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th style={{ width: "2.5rem" }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() => toggleSelectAllVisible()}
                      disabled={savingBulk}
                      title="Select all rows in this list"
                      aria-label="Select all rows in this list"
                    />
                  </th>
                  <th>Created</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>File</th>
                  <th>Raw preview</th>
                  <th>Target</th>
                  <th>Summary</th>
                  <th>Category</th>
                  <th>Links</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const summary =
                    it.reasonDetail?.message ??
                    (it.reasonDetail?.kind === "near_duplicate"
                      ? "Possible duplicate of an existing transaction."
                      : it.reason.slice(0, 120));
                  return (
                    <tr key={it.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(it.id)}
                          onChange={() => toggleSelected(it.id)}
                          disabled={savingBulk}
                          aria-label={`Select row ${it.id}`}
                        />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{it.createdAt}</td>
                      <td>{formatType(it.type)}</td>
                      <td>{it.status}</td>
                      <td>{it.context.fileName ?? "—"}</td>
                      <td>
                        {it.context.raw ? (
                          <span className="muted">
                            {it.context.raw.txnDate ?? "—"} · {formatMoney(it.context.raw.amount)} ·{" "}
                            {it.context.raw.description ?? "—"}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <code style={{ fontSize: "0.85rem" }}>{it.targetId}</code>
                      </td>
                      <td>{summary}</td>
                      <td style={{ minWidth: "9rem", maxWidth: "14rem" }}>
                        {it.type === "unknown_category" ? (
                          <LedgerCategoryPicker
                            categories={categories}
                            value={null}
                            disabled={savingBulk || assigningTxnId === it.targetId}
                            onChange={async (categoryId) => {
                              if (!categoryId) {
                                return;
                              }
                              setAssigningTxnId(it.targetId);
                              setError(null);
                              try {
                                await apiJson(`/transactions/${it.targetId}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ categoryId })
                                });
                                await load();
                              } catch (e: unknown) {
                                setError(e instanceof Error ? e.message : "Failed to set category");
                              } finally {
                                setAssigningTxnId(null);
                              }
                            }}
                            ariaLabel={`Set category for transaction ${it.targetId}`}
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {it.context.sessionId ? (
                          <Link to={`/transactions?sessionId=${it.context.sessionId}`}>Ledger rows</Link>
                        ) : it.type === "unknown_category" ? (
                          <Link to={`/transactions`}>Ledger</Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div className="row" style={{ gap: "0.35rem" }}>
                          {it.status !== "in_review" ? (
                            <button
                              type="button"
                              className="secondary"
                              disabled={savingBulk || savingId === it.id}
                              onClick={() => void updateStatus(it.id, "in_review")}
                            >
                              In review
                            </button>
                          ) : null}
                          {it.status !== "resolved" ? (
                            <button
                              type="button"
                              disabled={savingBulk || savingId === it.id}
                              onClick={() => void updateStatus(it.id, "resolved")}
                            >
                              Resolve
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary"
                              disabled={savingBulk || savingId === it.id}
                              onClick={() => void updateStatus(it.id, "open")}
                            >
                              Reopen
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
