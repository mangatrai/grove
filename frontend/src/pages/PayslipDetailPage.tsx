import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";

/** Mirrors `PayslipSnapshotRow` from the API (full detail). */
export type PayslipSnapshotDetail = {
  id: string;
  householdId: string;
  fileName: string;
  fileChecksum: string;
  parserProfileId: string;
  importFileId: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payDate: string | null;
  grossPayCurrent: number | null;
  grossPayYtd: number | null;
  employeeTaxesCurrent: number | null;
  employeeTaxesYtd: number | null;
  preTaxDeductionsCurrent: number | null;
  preTaxDeductionsYtd: number | null;
  postTaxDeductionsCurrent: number | null;
  postTaxDeductionsYtd: number | null;
  netPayCurrent: number | null;
  netPayYtd: number | null;
  hoursOrDaysCurrent: string | null;
  rawExtractJson: Record<string, unknown>;
  createdAt: string;
};

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

export function PayslipDetailPage() {
  const token = useAuthToken();
  const { payslipId } = useParams<{ payslipId: string }>();
  const [detail, setDetail] = useState<PayslipSnapshotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!payslipId) {
      return;
    }
    const res = await apiJson<PayslipSnapshotDetail>(`/payslips/${encodeURIComponent(payslipId)}`);
    setDetail(res);
  }, [payslipId]);

  useEffect(() => {
    if (!token || !payslipId) {
      return;
    }
    setLoading(true);
    setError(null);
    void load()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load payslip");
        setDetail(null);
      })
      .finally(() => setLoading(false));
  }, [token, payslipId, load]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  if (!payslipId) {
    return <Navigate to="/payslips" replace />;
  }

  return (
    <div className="payslips-page">
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <Link to="/payslips">← Payslips</Link>
        </p>
        <h1 style={{ marginTop: "0.25rem" }}>Payslip detail</h1>
        <p className="muted">Read-only summary from the stored snapshot (not merged into the bank ledger).</p>
      </div>

      {loading ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="muted">Loading…</p>
        </div>
      ) : null}

      {error ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="error">{error}</p>
          <p className="muted">
            <Link to="/payslips">Back to list</Link>
          </p>
        </div>
      ) : null}

      {!loading && !error && detail ? (
        <>
          <div className="card" style={{ marginTop: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Stub</h2>
            <dl className="payslip-detail-dl">
              <dt>File</dt>
              <dd>{detail.fileName}</dd>
              <dt>Uploaded</dt>
              <dd style={{ whiteSpace: "nowrap" }}>{detail.createdAt}</dd>
              <dt>Parser</dt>
              <dd>
                <code style={{ fontSize: "0.85rem" }}>{detail.parserProfileId}</code>
              </dd>
              {detail.importFileId ? (
                <>
                  <dt>Import file</dt>
                  <dd>
                    <code style={{ fontSize: "0.85rem" }}>{detail.importFileId}</code>
                  </dd>
                </>
              ) : null}
              <dt>Checksum</dt>
              <dd>
                <code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{detail.fileChecksum}</code>
              </dd>
            </dl>
          </div>

          <div className="card" style={{ marginTop: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Period</h2>
            <dl className="payslip-detail-dl">
              <dt>Pay period</dt>
              <dd>{periodLabel(detail)}</dd>
              <dt>Pay date</dt>
              <dd>{detail.payDate ?? "—"}</dd>
              <dt>Hours / days (current)</dt>
              <dd>{detail.hoursOrDaysCurrent ?? "—"}</dd>
            </dl>
          </div>

          <div className="card" style={{ marginTop: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Amounts</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th />
                    <th>Current</th>
                    <th>YTD</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Gross pay</td>
                    <td>{formatMoney(detail.grossPayCurrent)}</td>
                    <td>{formatMoney(detail.grossPayYtd)}</td>
                  </tr>
                  <tr>
                    <td>Employee taxes</td>
                    <td>{formatMoney(detail.employeeTaxesCurrent)}</td>
                    <td>{formatMoney(detail.employeeTaxesYtd)}</td>
                  </tr>
                  <tr>
                    <td>Pre-tax deductions</td>
                    <td>{formatMoney(detail.preTaxDeductionsCurrent)}</td>
                    <td>{formatMoney(detail.preTaxDeductionsYtd)}</td>
                  </tr>
                  <tr>
                    <td>Post-tax deductions</td>
                    <td>{formatMoney(detail.postTaxDeductionsCurrent)}</td>
                    <td>{formatMoney(detail.postTaxDeductionsYtd)}</td>
                  </tr>
                  <tr>
                    <td>Net pay</td>
                    <td>{formatMoney(detail.netPayCurrent)}</td>
                    <td>{formatMoney(detail.netPayYtd)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: "1rem" }}>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Parser diagnostics (raw JSON)</summary>
              <pre
                style={{
                  marginTop: "0.75rem",
                  fontSize: "0.75rem",
                  overflow: "auto",
                  maxHeight: "24rem",
                  padding: "0.75rem",
                  background: "var(--surface-muted, rgba(0,0,0,0.04))",
                  borderRadius: "6px"
                }}
              >
                {JSON.stringify(detail.rawExtractJson, null, 2)}
              </pre>
            </details>
          </div>
        </>
      ) : null}
    </div>
  );
}
