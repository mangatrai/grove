import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiJson, getToken } from "../api";

type ResolutionItem = {
  id: string;
  type: string;
  targetId: string;
  reason: string;
  reasonDetail: { kind?: string; message?: string; existingCanonicalId?: string; rawId?: string } | null;
  status: string;
  createdAt: string;
};

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

  const load = useCallback(async () => {
    setError(null);
    const res = await apiJson<{ items: ResolutionItem[] }>("/resolution");
    setItems(res.items);
  }, []);

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

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div>
      <p className="row" style={{ marginBottom: "0.5rem" }}>
        <Link to="/">← Home</Link>
        <span className="muted">·</span>
        <Link to="/transactions">Ledger</Link>
      </p>
      <div className="card">
        <h1>Review queue</h1>
        <p className="muted">
          Items created when an import line could not be posted safely (e.g. near-duplicate of an existing ledger row).
          Read-only for now.
        </p>
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && items.length === 0 ? (
          <p className="muted">No items in the queue.</p>
        ) : null}
        {!loading && items.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Summary</th>
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
                      <td style={{ whiteSpace: "nowrap" }}>{it.createdAt}</td>
                      <td>{formatType(it.type)}</td>
                      <td>{it.status}</td>
                      <td>
                        <code style={{ fontSize: "0.85rem" }}>{it.targetId}</code>
                      </td>
                      <td>{summary}</td>
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
