import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { MatchedDeposit, PayslipSnapshotDetail } from "../payslip/types";

export type { PayslipSnapshotDetail };

type EmployerRow = { id: string; displayName: string };

function accountLabel(d: MatchedDeposit): string {
  return d.accountMask ? `${d.institution} ···${d.accountMask}` : d.institution;
}

function depositWindowLink(accountId: string, payDate: string): string {
  const center = new Date(`${payDate}T00:00:00`);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  const minus3 = new Date(center);
  minus3.setDate(center.getDate() - 3);
  const plus3 = new Date(center);
  plus3.setDate(center.getDate() + 3);
  return `/transactions?accountId=${encodeURIComponent(accountId)}&dateFrom=${encodeURIComponent(fmt(minus3))}&dateTo=${encodeURIComponent(fmt(plus3))}`;
}

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
  const navigate = useNavigate();
  const [detail, setDetail] = useState<PayslipSnapshotDetail | null>(null);
  const [employers, setEmployers] = useState<EmployerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const load = useCallback(async () => {
    if (!payslipId) {
      return;
    }
    const res = await apiJson<PayslipSnapshotDetail>(`/payslips/${encodeURIComponent(payslipId)}`);
    setDetail(res);
  }, [payslipId]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void apiJson<{ employers: EmployerRow[] }>("/household/settings")
      .then((r) => setEmployers(r.employers ?? []))
      .catch(() => setEmployers([]));
  }, [token]);

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

  const deletePayslip = useCallback(async () => {
    if (!payslipId) {
      return;
    }
    setDeleting(true);
    try {
      const res = await apiFetch(`/payslips/${encodeURIComponent(payslipId)}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        let msg = text || res.statusText;
        try {
          const j = JSON.parse(text) as { message?: string };
          if (j.message) {
            msg = j.message;
          }
        } catch {
          /* use raw */
        }
        setError(msg);
        return;
      }
      navigate("/payslips", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [payslipId, navigate]);

  if (!payslipId) {
    return <Navigate to="/payslips" replace />;
  }

  return (
    <div className="payslips-page">
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <Link to="/payslips">← Payslips</Link>
        </p>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
          <h1 style={{ marginTop: "0.25rem", marginBottom: 0 }}>Payslip detail</h1>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: "0.85rem", alignSelf: "center" }}
            disabled={deleting || loading}
            onClick={() => setDeleteConfirm(true)}
          >
            {deleting ? "Deleting…" : "Delete payslip"}
          </button>
        </div>
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
              {detail.employerId ? (
                <>
                  <dt>Employer</dt>
                  <dd>
                    {employers.find((e) => e.id === detail.employerId)?.displayName ??
                      `${detail.employerId.slice(0, 8)}…`}
                  </dd>
                </>
              ) : null}
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
              <dt>Hours worked</dt>
              <dd>{detail.hoursOrDaysCurrent ?? "—"}</dd>
            </dl>
          </div>

          {detail.payDate != null && detail.netPayCurrent != null ? (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h2 style={{ marginTop: 0 }}>Bank deposit</h2>
              {detail.matchedDeposits && detail.matchedDeposits.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th>Account</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.matchedDeposits.map((d) => (
                        <tr key={d.id}>
                          <td style={{ whiteSpace: "nowrap" }}>{d.txnDate}</td>
                          <td>{d.merchant ?? d.memo ?? "—"}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatMoney(d.amount)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{accountLabel(d)}</td>
                          <td>
                            <Link to={depositWindowLink(d.accountId, detail.payDate!)} style={{ fontSize: "0.85rem" }}>
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  No matching deposit found near {detail.payDate} for {formatMoney(detail.netPayCurrent)}.
                </p>
              )}
            </div>
          ) : null}

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

      <ConfirmDialog
        opened={deleteConfirm}
        title="Delete payslip"
        message="Delete this payslip permanently? This cannot be undone."
        confirmLabel="Delete"
        danger
        onClose={() => setDeleteConfirm(false)}
        onConfirm={() => deletePayslip()}
      />
    </div>
  );
}
