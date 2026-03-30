import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";

type PayslipRow = {
  id: string;
  fileName: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payDate: string | null;
  grossPayCurrent: number | null;
  netPayCurrent: number | null;
  createdAt: string;
  parserProfileId: string;
};

type ListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: PayslipRow[];
};

function formatMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) {
    return "—";
  }
  return `$${n.toFixed(2)}`;
}

function periodLabel(r: PayslipRow): string {
  const a = r.payPeriodStart;
  const b = r.payPeriodEnd;
  if (a && b) {
    return `${a} → ${b}`;
  }
  if (a) {
    return a;
  }
  if (b) {
    return b;
  }
  return "—";
}

export function PayslipsPage() {
  const token = useAuthToken();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const res = await apiJson<ListResponse>("/payslips?limit=100&offset=0");
    setData(res);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    void load()
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : "Failed to load payslips");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, load]);

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("payslip");
    const input =
      fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : undefined;
    if (!input) {
      setUploadError("Choose a PDF file.");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", input);
      const res = await apiFetch("/payslips/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const text = await res.text();
        let detail = text;
        try {
          const j = JSON.parse(text) as { message?: string; code?: string };
          if (typeof j.message === "string") {
            detail = j.code ? `${j.message} (${j.code})` : j.message;
          }
        } catch {
          /* keep raw */
        }
        throw new Error(`${res.status}: ${detail}`);
      }
      await load();
      if (form.isConnected) {
        form.reset();
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="payslips-page">
      <div className="card">
        <h1>Payslips</h1>
        <p className="muted">
          Upload employer pay summaries (IBM “Pay and Contributions” PDF supported). Stored separately from bank
          imports — see <Link to="/transactions">Transactions</Link> for cash activity. Product notes:{" "}
          <code>docs/PAYSLIP_V1.md</code>.
        </p>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Upload</h2>
        <form className="row" onSubmit={(ev) => void onUpload(ev)}>
          <label>
            <span className="muted">PDF</span>{" "}
            <input name="payslip" type="file" accept="application/pdf,.pdf" disabled={uploading} />
          </label>
          <button type="submit" disabled={uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
        {uploadError ? <p className="error">{uploadError}</p> : null}
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Saved stubs</h2>
        {loadError ? <p className="error">{loadError}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && data && data.items.length === 0 ? (
          <p className="muted">No payslips uploaded yet.</p>
        ) : null}
        {!loading && data && data.items.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Pay period</th>
                  <th>Pay date</th>
                  <th>Gross (current)</th>
                  <th>Net (current)</th>
                  <th>File</th>
                  <th>Uploaded</th>
                  <th>Parser</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>{periodLabel(r)}</td>
                    <td>{r.payDate ?? "—"}</td>
                    <td>{formatMoney(r.grossPayCurrent)}</td>
                    <td>{formatMoney(r.netPayCurrent)}</td>
                    <td style={{ maxWidth: "14rem", wordBreak: "break-word" }}>{r.fileName}</td>
                    <td style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>{r.createdAt}</td>
                    <td>
                      <code style={{ fontSize: "0.8rem" }}>{r.parserProfileId}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
