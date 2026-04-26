import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@mantine/core";
import { Link, Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatAccountForSelect } from "../import/accountDisplay";

type ImportType = "bank" | "payslip";

type FinancialAccount = {
  id: string;
  type: string;
  institution: string;
  account_mask: string | null;
};

type Employer = { id: string; displayName: string };

type ImportHistoryItem = {
  id: string;
  type: "bank" | "payslip";
  createdAt: string;
  label: string;
  status: string;
  addedCount: number | null;
  duplicateCount: number | null;
  canUndo: boolean;
};

type ImportUploadBankResult = {
  type: "bank";
  sessionId: string;
  addedCount: number;
  duplicateCount: number;
  parserProfileId: string;
};

type ImportUploadPayslipResult = {
  type: "payslip";
  snapshotId: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  netPayCurrent: number | null;
  employerDisplayName: string | null;
};

function fmtDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
}

function fmtMoney(v: number | null): string {
  if (v == null || !Number.isFinite(v)) {
    return "—";
  }
  return `$${v.toFixed(2)}`;
}

export function ImportPage() {
  const token = useAuthToken();
  const [importType, setImportType] = useState<ImportType>("bank");
  const [file, setFile] = useState<File | null>(null);
  const [financialAccountId, setFinancialAccountId] = useState("");
  const [employerId, setEmployerId] = useState("");
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<ImportHistoryItem | null>(null);

  const bankAccounts = useMemo(() => accounts.filter((a) => a.type !== "payslip"), [accounts]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiJson<{ items: ImportHistoryItem[] }>("/imports/history");
      setHistory(res.items ?? []);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadLookups = useCallback(async () => {
    const [acc, settings] = await Promise.all([
      apiJson<{ accounts: FinancialAccount[] }>("/imports/accounts"),
      apiJson<{ employers: Employer[] }>("/household/settings")
    ]);
    setAccounts(acc.accounts ?? []);
    setEmployers(settings.employers ?? []);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadLookups().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to load import options");
    });
    void loadHistory().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to load import history");
    });
  }, [token, loadLookups, loadHistory]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!file) {
      setError("Please choose a file.");
      return;
    }
    if (importType === "bank" && !financialAccountId) {
      setError("Please choose an account for bank import.");
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("importType", importType);
      if (importType === "bank") {
        form.append("financialAccountId", financialAccountId);
      } else if (employerId) {
        form.append("employerId", employerId);
      }

      const res = await apiFetch("/imports/upload", { method: "POST", body: form });
      const text = await res.text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!res.ok) {
        const code = String((body.code ?? "") as string);
        if (code === "PROFILE_INFERENCE_FAILED") {
          setError("Could not infer a parser for this file/account. Use Advanced Import Workspace to bind profile manually.");
        } else {
          setError(String((body.message ?? `${res.status} ${res.statusText}`) as string));
        }
        return;
      }

      if ((body.type as string) === "bank") {
        const payload = body as unknown as ImportUploadBankResult;
        setSuccess(
          `Bank import complete. Added ${payload.addedCount} and marked ${payload.duplicateCount} duplicate transactions.`
        );
      } else {
        const payload = body as unknown as ImportUploadPayslipResult;
        setSuccess(
          `Payslip saved${payload.employerDisplayName ? ` for ${payload.employerDisplayName}` : ""}. Net pay: ${fmtMoney(payload.netPayCurrent)}.`
        );
      }
      setFile(null);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  async function confirmUndo(): Promise<void> {
    if (!undoTarget) {
      return;
    }
    const endpoint =
      undoTarget.type === "bank"
        ? `/imports/sessions/${undoTarget.id}/undo-import`
        : `/payslips/${undoTarget.id}`;
    const method = undoTarget.type === "bank" ? "POST" : "DELETE";

    const res = await apiFetch(endpoint, { method });
    if (!res.ok) {
      const text = await res.text();
      try {
        const parsed = JSON.parse(text) as { message?: string };
        throw new Error(parsed.message || "Undo failed");
      } catch {
        throw new Error(text || "Undo failed");
      }
    }
    setSuccess(undoTarget.type === "bank" ? "Import undone successfully." : "Payslip deleted successfully.");
    await loadHistory();
  }

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h1 style={{ marginTop: 0 }}>Import</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        One-shot upload for bank and payslip files.{" "}
        <Link to="/imports/workspace">Advanced Import -&gt;</Link>
      </p>

      {error ? <Alert color="red" mb="md">{error}</Alert> : null}
      {success ? <Alert color="green" mb="md">{success}</Alert> : null}

      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
        <label>
          Import type
          <select value={importType} onChange={(e) => setImportType(e.target.value as ImportType)}>
            <option value="bank">Bank transactions</option>
            <option value="payslip">Payslip</option>
          </select>
        </label>

        {importType === "bank" ? (
          <label>
            Account
            <select value={financialAccountId} onChange={(e) => setFinancialAccountId(e.target.value)}>
              <option value="">Select account</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAccountForSelect(a)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Employer (optional)
            <select value={employerId} onChange={(e) => setEmployerId(e.target.value)}>
              <option value="">Auto-select</option>
              {employers.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.displayName}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          File
          <input
            type="file"
            accept=".csv,.pdf,.ofx,.qfx"
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
          />
        </label>

        <div>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "Uploading..." : "Upload and import"}
          </button>
        </div>
      </form>

      <h2 style={{ marginBottom: "0.5rem" }}>Recent imports</h2>
      {historyLoading ? <p className="muted">Loading history…</p> : null}
      {!historyLoading && history.length === 0 ? <p className="muted">No imports yet.</p> : null}
      {!historyLoading && history.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table className="ledger-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Label</th>
                <th>Status</th>
                <th>Added</th>
                <th>Duplicates</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={`${item.type}-${item.id}`}>
                  <td>{fmtDate(item.createdAt)}</td>
                  <td>{item.type}</td>
                  <td>{item.label}</td>
                  <td>{item.status}</td>
                  <td>{item.addedCount ?? "—"}</td>
                  <td>{item.duplicateCount ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="secondary" disabled={!item.canUndo} onClick={() => setUndoTarget(item)}>
                      Undo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmDialog
        opened={Boolean(undoTarget)}
        title="Confirm undo"
        message={
          undoTarget?.type === "bank"
            ? "Undo this bank import session? This removes posted canonical rows for that session."
            : "Delete this payslip snapshot?"
        }
        confirmLabel="Undo"
        danger
        onClose={() => setUndoTarget(null)}
        onConfirm={confirmUndo}
      />
    </div>
  );
}
