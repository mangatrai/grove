import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { PayslipIncomeCharts } from "../payslip/PayslipIncomeCharts";
import type { PayslipSnapshotDetail } from "../payslip/types";

type ListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: PayslipSnapshotDetail[];
};

type EmployerRow = { id: string; displayName: string };

function formatMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) {
    return "—";
  }
  return `$${n.toFixed(2)}`;
}

function periodLabel(r: PayslipSnapshotDetail): string {
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
  const [employers, setEmployers] = useState<EmployerRow[]>([]);
  const [employerId, setEmployerId] = useState("");
  const [sniffNote, setSniffNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const [res, hs] = await Promise.all([
      apiJson<ListResponse>("/payslips?limit=200&offset=0"),
      apiJson<{ employers: EmployerRow[] }>("/household/settings").catch(() => ({ employers: [] as EmployerRow[] }))
    ]);
    setData(res);
    setEmployers(hs.employers ?? []);
    if ((hs.employers?.length ?? 0) === 1 && hs.employers[0]) {
      setEmployerId(hs.employers[0].id);
    }
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

  async function onFilePicked(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    setSniffNote(null);
    if (!file) {
      return;
    }
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch("/payslips/sniff", { method: "POST", body: fd });
      const text = await res.text();
      if (!res.ok) {
        return;
      }
      const j = JSON.parse(text) as {
        suggestedEmployerId?: string | null;
        note?: string | null;
        confidence?: string;
      };
      if (j.suggestedEmployerId) {
        setEmployerId(j.suggestedEmployerId);
      }
      if (j.note) {
        setSniffNote(j.note);
      }
    } catch {
      /* sniff is optional */
    }
  }

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
    if (employers.length > 1 && !employerId) {
      setUploadError("Choose which employer this payslip is from (Settings → Household).");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", input);
      if (employers.length > 1 && employerId) {
        fd.append("employerId", employerId);
      }
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
      setSniffNote(null);
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
          Upload employer pay summaries — parser is chosen from <strong>Settings → Household → Employers</strong>{" "}
          (IBM supported; ADP registered but not parsed yet). Optional <strong>sniff</strong> reads PDF text to suggest
          employer/parser. See <Link to="/transactions">Transactions</Link> for bank cash;{" "}
          <code>docs/PAYSLIP_V1.md</code>.
        </p>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Upload</h2>
        <form className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }} onSubmit={(ev) => void onUpload(ev)}>
          <label>
            <span className="muted">PDF</span>{" "}
            <input
              name="payslip"
              type="file"
              accept="application/pdf,.pdf"
              disabled={uploading}
              onChange={(ev) => void onFilePicked(ev)}
            />
          </label>
          {employers.length > 1 ? (
            <label>
              <span className="muted">Employer</span>{" "}
              <select
                value={employerId}
                onChange={(e) => {
                  setEmployerId(e.target.value);
                }}
                disabled={uploading}
              >
                <option value="">— choose —</option>
                {employers.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="submit" disabled={uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
        {sniffNote ? (
          <p className="muted" style={{ marginTop: "0.65rem", fontSize: "0.9rem" }}>
            {sniffNote}
          </p>
        ) : null}
        {uploadError ? <p className="error">{uploadError}</p> : null}
      </div>

      {!loading && data && data.items.length > 0 ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Income &amp; payroll</h2>
          <PayslipIncomeCharts items={data.items} />
        </div>
      ) : null}

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
                  <th>Employer</th>
                  <th>File</th>
                  <th>Uploaded</th>
                  <th>Parser</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/payslips/${r.id}`}>{periodLabel(r)}</Link>
                    </td>
                    <td>{r.payDate ?? "—"}</td>
                    <td>{formatMoney(r.grossPayCurrent)}</td>
                    <td>{formatMoney(r.netPayCurrent)}</td>
                    <td>
                      {r.employerId
                        ? employers.find((e) => e.id === r.employerId)?.displayName ?? r.employerId.slice(0, 8) + "…"
                        : "—"}
                    </td>
                    <td style={{ maxWidth: "14rem", wordBreak: "break-word" }}>
                      <Link to={`/payslips/${r.id}`}>{r.fileName}</Link>
                    </td>
                    <td style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>{r.createdAt}</td>
                    <td>
                      <code style={{ fontSize: "0.8rem" }}>{r.parserProfileId}</code>
                    </td>
                    <td>
                      <Link to={`/payslips/${r.id}`}>View</Link>
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
