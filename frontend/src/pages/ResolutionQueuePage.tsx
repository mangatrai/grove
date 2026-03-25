import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { apiJson, getToken } from "../api";

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
  const token = getToken();
  const [items, setItems] = useState<ResolutionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ResolutionFilter>("open");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setError(null);
    const res = await apiJson<{ items: ResolutionItem[]; status: ResolutionFilter }>(
      `/resolution?status=${encodeURIComponent(statusFilter)}`
    );
    setItems(res.items);
  }, [statusFilter]);

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
  }, [statusFilter]);

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
          Items created when an import line could not be posted safely (e.g. near-duplicate of an existing ledger row).
          Resolve them as you work through imports.
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
                      <td style={{ whiteSpace: "nowrap" }}>
                        {it.context.sessionId ? (
                          <Link to={`/transactions?sessionId=${it.context.sessionId}`}>Ledger rows</Link>
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
