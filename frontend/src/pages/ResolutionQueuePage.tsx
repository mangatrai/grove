import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";

type ResolutionItem = {
  id: string;
  type: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
  context: {
    sessionId: string | null;
    fileId: string | null;
    fileName: string | null;
    raw: {
      txnDate: string | null;
      amount: number | null;
      description: string | null;
    } | null;
  };
};

type ListResponse = {
  items: ResolutionItem[];
  status: string;
  type: string;
};

const TYPE_LABELS: Record<string, string> = {
  duplicate_ambiguity: "Near-duplicate (raw)",
  unknown_category: "Unknown category",
  transfer_ambiguity: "Transfer ambiguity",
  reconciliation_mismatch: "Reconciliation"
};

export function ResolutionQueuePage() {
  const token = useAuthToken();
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await apiJson<ListResponse>("/resolution?status=open&type=all");
    setData(res);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    void load()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, load]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="resolution-queue-page">
      <div className="card">
        <h1>Open resolution items</h1>
        <p className="muted">
          Full queue of open review items (including near-duplicates that never received a ledger row — they do not
          appear on <Link to="/transactions?needsReview=true">Transactions → Needs review</Link>). Use status actions from
          your workflow; this list is the API-backed <code>GET /resolution</code> surface.
        </p>
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && data && data.items.length === 0 ? <p className="muted">No open items.</p> : null}
        {!loading && data && data.items.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>File</th>
                  <th>Raw preview</th>
                  <th>Session</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id}>
                    <td>{TYPE_LABELS[it.type] ?? it.type}</td>
                    <td>{it.status}</td>
                    <td style={{ maxWidth: "14rem", wordBreak: "break-word" }}>{it.context.fileName ?? "—"}</td>
                    <td style={{ fontSize: "0.85rem" }}>
                      {it.context.raw
                        ? `${it.context.raw.txnDate ?? "—"} · ${it.context.raw.description ?? "—"} · ${it.context.raw.amount != null ? `$${it.context.raw.amount.toFixed(2)}` : "—"}`
                        : "—"}
                    </td>
                    <td>
                      {it.context.sessionId ? (
                        <Link to={`/imports/${it.context.sessionId}`}>Import session</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p style={{ marginTop: "1rem" }}>
          <Link to="/transactions?needsReview=true">← Back to Transactions → Needs review</Link>
        </p>
      </div>
    </div>
  );
}
