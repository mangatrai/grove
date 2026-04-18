import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { MatchedDeposit, PayslipLineItemRow, PayslipLineItemSection, PayslipSnapshotDetail } from "../payslip/types";
import { SECTION_LABELS, SECTION_ORDER } from "../payslip/types";

export type { PayslipSnapshotDetail };

type EmployerRow = { id: string; displayName: string };

/** Keys that can be patched via PATCH /payslips/:id */
type PatchableAmountField =
  | "grossPayCurrent" | "grossPayYtd"
  | "taxableEarningsCurrent" | "taxableEarningsYtd"
  | "employeeTaxesCurrent" | "employeeTaxesYtd"
  | "preTaxDeductionsCurrent" | "preTaxDeductionsYtd"
  | "postTaxDeductionsCurrent" | "postTaxDeductionsYtd"
  | "otherInformationCurrent" | "otherInformationYtd"
  | "netPayCurrent" | "netPayYtd";

type AmountRowDef = {
  key: string;
  label: string;
  muted?: boolean;
  currentField: PatchableAmountField;
  ytdField: PatchableAmountField;
};

const AMOUNT_ROWS: AmountRowDef[] = [
  { key: "gross",    label: "Gross pay",           currentField: "grossPayCurrent",          ytdField: "grossPayYtd" },
  { key: "taxable",  label: "↳ Taxable earnings",  currentField: "taxableEarningsCurrent",   ytdField: "taxableEarningsYtd",   muted: true },
  { key: "taxes",    label: "Employee taxes",       currentField: "employeeTaxesCurrent",     ytdField: "employeeTaxesYtd" },
  { key: "pretax",   label: "Pre-tax deductions",   currentField: "preTaxDeductionsCurrent",  ytdField: "preTaxDeductionsYtd" },
  { key: "posttax",  label: "Post-tax deductions",  currentField: "postTaxDeductionsCurrent", ytdField: "postTaxDeductionsYtd" },
  { key: "otherinfo",label: "Other information",    currentField: "otherInformationCurrent",  ytdField: "otherInformationYtd", muted: true },
  { key: "net",      label: "Net pay",              currentField: "netPayCurrent",            ytdField: "netPayYtd" },
];

type EditState = { rowKey: string; currentVal: string; ytdVal: string };

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

function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function parseAmountInput(s: string): number | null {
  const v = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

function periodLabel(r: PayslipSnapshotDetail): string {
  const a = r.payPeriodStart;
  const b = r.payPeriodEnd;
  if (a && b) return `${a} → ${b}`;
  if (a) return a;
  if (b) return b;
  return "—";
}

/**
 * Determine whether to show the Hours column for a section.
 * Only the Earnings section carries meaningful hours values.
 */
function sectionHasHours(section: PayslipLineItemSection, rows: PayslipLineItemRow[]): boolean {
  if (section !== "earnings") return false;
  return rows.some((r) => r.hoursOrDaysCurrent != null || r.hoursOrDaysYtd != null);
}

function sectionHasRate(rows: PayslipLineItemRow[]): boolean {
  return rows.some((r) => r.rate != null);
}

function LineItemsSection({ section, rows }: { section: PayslipLineItemSection; rows: PayslipLineItemRow[] }) {
  const showHours = sectionHasHours(section, rows);
  const showRate = sectionHasRate(rows);
  return (
    <details style={{ marginBottom: "0.75rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, padding: "0.4rem 0" }}>
        {SECTION_LABELS[section]}
        <span className="muted" style={{ fontWeight: 400, marginLeft: "0.5rem", fontSize: "0.85rem" }}>
          ({rows.length} row{rows.length !== 1 ? "s" : ""})
        </span>
      </summary>
      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table className="ledger-table" style={{ fontSize: "0.85rem" }}>
          <thead>
            <tr>
              <th style={{ minWidth: "12rem" }}>Name</th>
              {showHours ? <th>Hours</th> : null}
              {showRate ? <th>Rate</th> : null}
              <th>Current</th>
              <th>YTD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.name ?? <span className="muted">—</span>}
                  {row.dateRaw ? (
                    <span className="muted" style={{ fontSize: "0.78rem", marginLeft: "0.35rem" }}>
                      {row.dateRaw}
                    </span>
                  ) : null}
                </td>
                {showHours ? (
                  <td style={{ whiteSpace: "nowrap" }}>
                    {row.hoursOrDaysCurrent != null ? row.hoursOrDaysCurrent : "—"}
                  </td>
                ) : null}
                {showRate ? (
                  <td style={{ whiteSpace: "nowrap" }}>{row.rate != null ? formatMoney(row.rate) : "—"}</td>
                ) : null}
                <td style={{ whiteSpace: "nowrap" }}>{formatMoney(row.amountCurrent)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatMoney(row.amountYtd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** A single editable row in the Amounts summary table. */
function SummaryAmountRow({
  def,
  currentVal,
  ytdVal,
  editState,
  saving,
  saveError,
  onStartEdit,
  onEditChange,
  onSave,
  onCancel,
}: {
  def: AmountRowDef;
  currentVal: number | null | undefined;
  ytdVal: number | null | undefined;
  editState: EditState | null;
  saving: boolean;
  saveError: string | null;
  onStartEdit: () => void;
  onEditChange: (s: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isEditing = editState?.rowKey === def.key;
  const currentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      currentInputRef.current?.select();
    }
  }, [isEditing]);

  const labelStyle: React.CSSProperties = def.muted
    ? { color: "var(--color-text-muted, #666)", fontSize: "0.9rem" }
    : {};

  if (isEditing) {
    return (
      <>
        <tr>
          <td style={labelStyle}>{def.label}</td>
          <td>
            <input
              ref={currentInputRef}
              type="number"
              step="0.01"
              value={editState!.currentVal}
              onChange={(e) => onEditChange({ ...editState!, currentVal: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
              style={{ width: "7.5rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
              disabled={saving}
              placeholder="null"
            />
          </td>
          <td>
            <input
              type="number"
              step="0.01"
              value={editState!.ytdVal}
              onChange={(e) => onEditChange({ ...editState!, ytdVal: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
              style={{ width: "7.5rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
              disabled={saving}
              placeholder="null"
            />
          </td>
          <td style={{ whiteSpace: "nowrap" }}>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              style={{ fontSize: "0.8rem", padding: "0.15rem 0.5rem", marginRight: "0.3rem" }}
              title="Save"
            >
              {saving ? "…" : "✓"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={onCancel}
              disabled={saving}
              style={{ fontSize: "0.8rem", padding: "0.15rem 0.5rem" }}
              title="Cancel"
            >
              ✗
            </button>
          </td>
        </tr>
        {saveError ? (
          <tr>
            <td colSpan={4}>
              <span className="error" style={{ fontSize: "0.8rem" }}>{saveError}</span>
            </td>
          </tr>
        ) : null}
      </>
    );
  }

  return (
    <tr>
      <td style={labelStyle}>{def.label}</td>
      <td style={{ whiteSpace: "nowrap" }}>{formatMoney(currentVal)}</td>
      <td style={{ whiteSpace: "nowrap" }}>{formatMoney(ytdVal)}</td>
      <td>
        <button
          type="button"
          className="secondary"
          onClick={onStartEdit}
          title={`Edit ${def.label}`}
          style={{ fontSize: "0.75rem", padding: "0.1rem 0.4rem", opacity: 0.45 }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.45"; }}
        >
          ✏
        </button>
      </td>
    </tr>
  );
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

  // Inline edit state for Amounts table
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!payslipId) return;
    const res = await apiJson<PayslipSnapshotDetail>(`/payslips/${encodeURIComponent(payslipId)}`);
    setDetail(res);
  }, [payslipId]);

  useEffect(() => {
    if (!token) return;
    void apiJson<{ employers: EmployerRow[] }>("/household/settings")
      .then((r) => setEmployers(r.employers ?? []))
      .catch(() => setEmployers([]));
  }, [token]);

  useEffect(() => {
    if (!token || !payslipId) return;
    setLoading(true);
    setError(null);
    void load()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load payslip");
        setDetail(null);
      })
      .finally(() => setLoading(false));
  }, [token, payslipId, load]);

  const patchPayslip = useCallback(async (fields: Record<string, number | null>) => {
    if (!payslipId) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch(`/payslips/${encodeURIComponent(payslipId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = text || res.statusText;
        try {
          const j = JSON.parse(text) as { message?: string };
          if (j.message) msg = j.message;
        } catch { /* use raw */ }
        setSaveError(msg);
        return false;
      }
      const data = await res.json() as { snapshot: PayslipSnapshotDetail };
      // Preserve lineItems + matchedDeposits — PATCH response only returns the snapshot row
      setDetail((prev) => prev
        ? { ...data.snapshot, lineItems: prev.lineItems, matchedDeposits: prev.matchedDeposits }
        : data.snapshot
      );
      setEditState(null);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }, [payslipId]);

  const handleSaveRow = useCallback(async (def: AmountRowDef, es: EditState) => {
    const currentV = es.currentVal.trim() === "" ? null : parseAmountInput(es.currentVal);
    const ytdV = es.ytdVal.trim() === "" ? null : parseAmountInput(es.ytdVal);
    if (
      (es.currentVal.trim() !== "" && currentV === null) ||
      (es.ytdVal.trim() !== "" && ytdV === null)
    ) {
      setSaveError("Enter a valid number or leave blank to clear.");
      return;
    }
    await patchPayslip({ [def.currentField]: currentV, [def.ytdField]: ytdV });
  }, [patchPayslip]);

  if (!token) return <Navigate to="/" replace />;

  const deletePayslip = async () => {
    if (!payslipId) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/payslips/${encodeURIComponent(payslipId)}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        let msg = text || res.statusText;
        try {
          const j = JSON.parse(text) as { message?: string };
          if (j.message) msg = j.message;
        } catch { /* use raw */ }
        setError(msg);
        return;
      }
      navigate("/payslips", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  if (!payslipId) return <Navigate to="/payslips" replace />;

  // Build display-time merged line items:
  //
  // 1. Dedup Earnings: Deloitte imputed-income rows (e.g. "Imp Inc Core Life") appear in BOTH
  //    the PDF's GROSS EARNINGS block AND the OTHER DEDUCTION(S) block. Filter them out of
  //    Earnings when they are already present in other_deductions.
  //
  // 2. Merge other_deductions into post_tax_deductions: semantically identical to post-tax.
  const mergedLineItems = detail?.lineItems
    ? (() => {
        const otherDeductionNames = new Set<string>(
          (detail.lineItems!.other_deductions ?? [])
            .map((r) => r.name)
            .filter((n): n is string => n != null)
        );
        return {
          ...detail.lineItems!,
          earnings: (detail.lineItems!.earnings ?? []).filter(
            (r) => r.name == null || !otherDeductionNames.has(r.name)
          ),
          post_tax_deductions: [
            ...(detail.lineItems!.post_tax_deductions ?? []),
            ...(detail.lineItems!.other_deductions ?? [])
          ],
          other_deductions: [] as typeof detail.lineItems.other_deductions
        };
      })()
    : detail?.lineItems;

  const nonEmptySections = mergedLineItems
    ? SECTION_ORDER.filter((s) => (mergedLineItems[s]?.length ?? 0) > 0)
    : [];

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
        <p className="muted">Summary from the stored snapshot. Click ✏ on any amount row to correct a value.</p>
      </div>

      {loading ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="muted">Loading…</p>
        </div>
      ) : null}

      {error ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="error">{error}</p>
          <p className="muted"><Link to="/payslips">Back to list</Link></p>
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
              <dd><code style={{ fontSize: "0.85rem" }}>{detail.parserProfileId}</code></dd>
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
                  <dd><code style={{ fontSize: "0.85rem" }}>{detail.importFileId}</code></dd>
                </>
              ) : null}
              <dt>Checksum</dt>
              <dd><code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{detail.fileChecksum}</code></dd>
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
              <dd>
                {detail.hoursOrDaysCurrent ?? "—"}
                {detail.hoursOrDaysYtd != null ? (
                  <span className="muted" style={{ marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                    YTD: {detail.hoursOrDaysYtd}
                  </span>
                ) : null}
              </dd>
              {detail.employmentRate != null ? (
                <>
                  <dt>Salary / Rate</dt>
                  <dd>
                    {formatMoney(detail.employmentRate)}
                    {detail.employmentRateType ? (
                      <span className="muted" style={{ marginLeft: "0.4rem", fontSize: "0.85rem" }}>
                        ({detail.employmentRateType})
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
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
                    <th style={{ width: "2.5rem" }} />
                  </tr>
                </thead>
                <tbody>
                  {AMOUNT_ROWS.map((def) => (
                    <SummaryAmountRow
                      key={def.key}
                      def={def}
                      currentVal={detail[def.currentField as keyof PayslipSnapshotDetail] as number | null}
                      ytdVal={detail[def.ytdField as keyof PayslipSnapshotDetail] as number | null}
                      editState={editState?.rowKey === def.key ? editState : null}
                      saving={saving}
                      saveError={editState?.rowKey === def.key ? saveError : null}
                      onStartEdit={() => {
                        setSaveError(null);
                        const cv = detail[def.currentField as keyof PayslipSnapshotDetail] as number | null;
                        const yv = detail[def.ytdField as keyof PayslipSnapshotDetail] as number | null;
                        setEditState({
                          rowKey: def.key,
                          currentVal: cv != null ? String(cv) : "",
                          ytdVal: yv != null ? String(yv) : "",
                        });
                      }}
                      onEditChange={setEditState}
                      onSave={() => { if (editState) void handleSaveRow(def, editState); }}
                      onCancel={() => { setEditState(null); setSaveError(null); }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {nonEmptySections.length > 0 ? (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h2 style={{ marginTop: 0 }}>Line items</h2>
              <p className="muted" style={{ marginTop: 0, marginBottom: "1rem", fontSize: "0.9rem" }}>
                Individual rows extracted from the payslip PDF, grouped by section.
              </p>
              {nonEmptySections.map((section) => (
                <LineItemsSection
                  key={section}
                  section={section}
                  rows={mergedLineItems![section]}
                />
              ))}
            </div>
          ) : null}

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
        onConfirm={() => void deletePayslip()}
      />
    </div>
  );
}
