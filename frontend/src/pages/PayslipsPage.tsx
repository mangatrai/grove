import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [res, hs] = await Promise.all([
      apiJson<ListResponse>("/payslips?limit=200&offset=0"),
      apiJson<{ employers: EmployerRow[] }>("/household/settings").catch(() => ({ employers: [] as EmployerRow[] }))
    ]);
    setData(res);
    setEmployers(hs.employers ?? []);
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

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="payslips-page">
      <div className="card">
        <h1>Payslips</h1>
        <p className="muted">
          Employer pay summaries are added through <strong>New import</strong> (same intake as other files). Parser and
          employer binding come from <Link to="/settings/profile">Settings → Profile → Employer Setup</Link> (IBM
          supported; ADP registered but not parsed yet). See <Link to="/transactions">Transactions</Link> for bank cash;{" "}
          <code>docs/PAYSLIP_V1.md</code>.
        </p>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Add payslip PDFs</h2>
        <p className="muted" style={{ margin: 0 }}>
          Start an import from <Link to="/imports">Imports</Link>, attach your payslip PDF, and route it to the payslip
          placeholder account for your employer’s parser. Configure employers under{" "}
          <Link to="/settings/profile">Settings → Profile</Link> before importing if you have more than one employer.
        </p>
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
