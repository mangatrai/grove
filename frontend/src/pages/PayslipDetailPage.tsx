import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Anchor, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type {
  MatchedDeposit,
  PayslipLineItemRow,
  PayslipLineItemSection,
  PayslipLineItemsGrouped,
  PayslipSnapshotDetail,
  ValidationWarning
} from "../payslip/types";
import { SECTION_LABELS, SECTION_ORDER } from "../payslip/types";

export type { PayslipSnapshotDetail };

const ADD_SECTION_OPTIONS: { value: PayslipLineItemSection; label: string }[] = [
  { value: "earnings",            label: "Earnings" },
  { value: "pre_tax_deductions",  label: "Pre-tax deductions" },
  { value: "tax_deductions",      label: "Tax deductions" },
  { value: "post_tax_deductions", label: "Post-tax deductions" },
  { value: "other_information",   label: "Other information" },
  { value: "taxable_earnings",    label: "Taxable earnings" },
];

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
  { key: "pretax",   label: "Pre-tax deductions",   currentField: "preTaxDeductionsCurrent",  ytdField: "preTaxDeductionsYtd" },
  { key: "taxes",    label: "Employee taxes",       currentField: "employeeTaxesCurrent",     ytdField: "employeeTaxesYtd" },
  { key: "posttax",  label: "Post-tax deductions",  currentField: "postTaxDeductionsCurrent", ytdField: "postTaxDeductionsYtd" },
  { key: "otherinfo",label: "Other information",    currentField: "otherInformationCurrent",  ytdField: "otherInformationYtd", muted: true },
  { key: "net",      label: "Net pay",              currentField: "netPayCurrent",            ytdField: "netPayYtd" },
];

type SummaryEditState = { rowKey: string; currentVal: string; ytdVal: string };

type LineItemEditFields = {
  name: string;
  authority: string;
  amountCurrent: string;
  amountYtd: string;
  hoursOrDaysCurrent: string;
  rate: string;
};

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

function sectionHasHours(section: PayslipLineItemSection, rows: PayslipLineItemRow[]): boolean {
  if (section !== "earnings") return false;
  return rows.some((r) => r.hoursOrDaysCurrent != null || r.hoursOrDaysYtd != null);
}

function sectionHasRate(rows: PayslipLineItemRow[]): boolean {
  return rows.some((r) => r.rate != null);
}

function sectionHasAuthority(rows: PayslipLineItemRow[]): boolean {
  return rows.some((r) => r.authority != null);
}

// ---------------------------------------------------------------------------
// Validation warnings banner
// ---------------------------------------------------------------------------
function ValidationWarningsBanner({ warnings }: { warnings: ValidationWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div style={{
      marginBottom: "0.75rem",
      padding: "0.6rem 0.8rem",
      background: "rgba(234, 179, 8, 0.07)",
      border: "1px solid rgba(234, 179, 8, 0.45)",
      borderRadius: 6
    }}>
      <div style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.25rem", color: "var(--color-text)" }}>
        Data quality issues
      </div>
      {warnings.map((w, i) => (
        <div
          key={i}
          style={{
            fontSize: "0.82rem",
            marginTop: "0.2rem",
            color: w.code === "ARITHMETIC_IMBALANCE" ? "var(--color-danger, #dc2626)" : "#92400e"
          }}
        >
          {w.message}
        </div>
      ))}
      <div style={{ fontSize: "0.78rem", marginTop: "0.4rem", color: "var(--color-text-muted)" }}>
        Edit or delete line items below, or correct the summary amounts directly. Warnings are non-blocking.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary row editor
// ---------------------------------------------------------------------------
function SummaryAmountRow({
  def, currentVal, ytdVal, editState, saving, saveError,
  onStartEdit, onEditChange, onSave, onCancel,
}: {
  def: AmountRowDef;
  currentVal: number | null | undefined;
  ytdVal: number | null | undefined;
  editState: SummaryEditState | null;
  saving: boolean;
  saveError: string | null;
  onStartEdit: () => void;
  onEditChange: (s: SummaryEditState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isEditing = editState?.rowKey === def.key;
  const currentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) currentInputRef.current?.select();
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
              type="number" step="0.01"
              value={editState!.currentVal}
              onChange={(e) => onEditChange({ ...editState!, currentVal: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
              style={{ width: "7.5rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
              disabled={saving} placeholder="null"
            />
          </td>
          <td>
            <input
              type="number" step="0.01"
              value={editState!.ytdVal}
              onChange={(e) => onEditChange({ ...editState!, ytdVal: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
              style={{ width: "7.5rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
              disabled={saving} placeholder="null"
            />
          </td>
          <td style={{ whiteSpace: "nowrap" }}>
            <button type="button" onClick={onSave} disabled={saving}
              style={{ fontSize: "0.8rem", padding: "0.15rem 0.5rem", marginRight: "0.3rem" }}
              title="Save">{saving ? "…" : "✓"}</button>
            <button type="button" className="secondary" onClick={onCancel} disabled={saving}
              style={{ fontSize: "0.8rem", padding: "0.15rem 0.5rem" }}
              title="Cancel">✗</button>
          </td>
        </tr>
        {saveError ? (
          <tr><td colSpan={4}><span className="error" style={{ fontSize: "0.8rem" }}>{saveError}</span></td></tr>
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
        <button type="button" className="secondary payslip-inline-edit-btn" onClick={onStartEdit} title={`Edit ${def.label}`}
          style={{ fontSize: "0.75rem", padding: "0.1rem 0.4rem" }}>
          ✏
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Line items section with inline edit + delete
// ---------------------------------------------------------------------------
type LineItemEditCtx = {
  editingRowId: string | null;
  editFields: LineItemEditFields | null;
  deletingRowId: string | null;
  saving: boolean;
  saveError: string | null;
  onStartEdit: (row: PayslipLineItemRow) => void;
  onEditChange: (fields: LineItemEditFields) => void;
  onSaveEdit: (rowId: string) => void;
  onCancelEdit: () => void;
  onStartDelete: (rowId: string) => void;
  onConfirmDelete: (rowId: string) => void;
  onCancelDelete: () => void;
};

function LineItemRow({
  row, showHours, showRate, showAuthority, ctx,
}: {
  row: PayslipLineItemRow;
  section?: PayslipLineItemSection;
  showHours: boolean;
  showRate: boolean;
  showAuthority: boolean;
  ctx: LineItemEditCtx;
}) {
  const isEditing = ctx.editingRowId === row.id;
  const isDeleting = ctx.deletingRowId === row.id;
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) nameInputRef.current?.focus();
  }, [isEditing]);

  const colSpan = 2 + (showHours ? 1 : 0) + (showRate ? 1 : 0) + (showAuthority ? 1 : 0) + 1; // name + current + ytd + optionals + actions

  if (isDeleting) {
    return (
      <tr style={{ background: "rgba(220, 38, 38, 0.04)" }}>
        <td colSpan={colSpan} style={{ fontSize: "0.85rem", padding: "0.4rem 0.5rem" }}>
          <span style={{ marginRight: "0.75rem", color: "var(--color-danger, #dc2626)" }}>
            Delete <strong>{row.name ?? "this row"}</strong>?
          </span>
          <button type="button"
            onClick={() => ctx.onConfirmDelete(row.id)}
            disabled={ctx.saving}
            style={{ fontSize: "0.8rem", padding: "0.15rem 0.6rem", marginRight: "0.35rem",
              background: "var(--color-danger, #dc2626)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
            {ctx.saving ? "…" : "Delete"}
          </button>
          <button type="button" className="secondary" onClick={ctx.onCancelDelete} disabled={ctx.saving}
            style={{ fontSize: "0.8rem", padding: "0.15rem 0.5rem" }}>
            Cancel
          </button>
          {ctx.saveError ? <span className="error" style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>{ctx.saveError}</span> : null}
        </td>
      </tr>
    );
  }

  if (isEditing && ctx.editFields) {
    const f = ctx.editFields;
    return (
      <>
        <tr style={{ background: "rgba(0,0,0,0.02)" }}>
          <td>
            <input ref={nameInputRef} type="text" value={f.name}
              onChange={(e) => ctx.onEditChange({ ...f, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Escape") ctx.onCancelEdit(); }}
              style={{ width: "100%", minWidth: "9rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
              disabled={ctx.saving} placeholder="Name" />
          </td>
          {showAuthority ? (
            <td>
              <input type="text" value={f.authority}
                onChange={(e) => ctx.onEditChange({ ...f, authority: e.target.value })}
                style={{ width: "6rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
                disabled={ctx.saving} placeholder="Authority" />
            </td>
          ) : null}
          {showHours ? (
            <td>
              <input type="number" step="0.01" value={f.hoursOrDaysCurrent}
                onChange={(e) => ctx.onEditChange({ ...f, hoursOrDaysCurrent: e.target.value })}
                style={{ width: "5rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
                disabled={ctx.saving} placeholder="Hours" />
            </td>
          ) : null}
          {showRate ? (
            <td>
              <input type="number" step="0.01" value={f.rate}
                onChange={(e) => ctx.onEditChange({ ...f, rate: e.target.value })}
                style={{ width: "6rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
                disabled={ctx.saving} placeholder="Rate" />
            </td>
          ) : null}
          <td>
            <input type="number" step="0.01" value={f.amountCurrent}
              onChange={(e) => ctx.onEditChange({ ...f, amountCurrent: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") ctx.onSaveEdit(row.id); if (e.key === "Escape") ctx.onCancelEdit(); }}
              style={{ width: "7rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
              disabled={ctx.saving} placeholder="Current" />
          </td>
          <td>
            <input type="number" step="0.01" value={f.amountYtd}
              onChange={(e) => ctx.onEditChange({ ...f, amountYtd: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") ctx.onSaveEdit(row.id); if (e.key === "Escape") ctx.onCancelEdit(); }}
              style={{ width: "7rem", fontSize: "0.85rem", padding: "0.2rem 0.3rem" }}
              disabled={ctx.saving} placeholder="YTD" />
          </td>
          <td style={{ whiteSpace: "nowrap" }}>
            <button type="button" onClick={() => ctx.onSaveEdit(row.id)} disabled={ctx.saving}
              style={{ fontSize: "0.8rem", padding: "0.15rem 0.5rem", marginRight: "0.3rem" }}
              title="Save">{ctx.saving ? "…" : "✓"}</button>
            <button type="button" className="secondary" onClick={ctx.onCancelEdit} disabled={ctx.saving}
              style={{ fontSize: "0.8rem", padding: "0.15rem 0.5rem" }}
              title="Cancel">✗</button>
          </td>
        </tr>
        {ctx.saveError ? (
          <tr><td colSpan={colSpan}><span className="error" style={{ fontSize: "0.8rem" }}>{ctx.saveError}</span></td></tr>
        ) : null}
      </>
    );
  }

  return (
    <tr>
      <td>
        {row.name ?? <span className="muted">—</span>}
        {row.dateRaw ? (
          <span className="muted" style={{ fontSize: "0.78rem", marginLeft: "0.35rem" }}>{row.dateRaw}</span>
        ) : null}
      </td>
      {showAuthority ? (
        <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
          {row.authority ?? "—"}
        </td>
      ) : null}
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
      <td style={{ whiteSpace: "nowrap" }}>
        <button type="button" className="secondary payslip-inline-edit-btn"
          onClick={() => ctx.onStartEdit(row)}
          title="Edit row"
          style={{ fontSize: "0.73rem", padding: "0.1rem 0.35rem", marginRight: "0.25rem" }}>
          ✏
        </button>
        <button type="button" className="secondary payslip-inline-edit-btn"
          onClick={() => ctx.onStartDelete(row.id)}
          title="Delete row"
          style={{ fontSize: "0.73rem", padding: "0.1rem 0.35rem", color: "var(--color-danger, #dc2626)" }}>
          ✕
        </button>
      </td>
    </tr>
  );
}

function LineItemsSection({
  section, rows, ctx,
}: {
  section: PayslipLineItemSection;
  rows: PayslipLineItemRow[];
  ctx: LineItemEditCtx;
}) {
  const showHours = sectionHasHours(section, rows);
  const showRate = sectionHasRate(rows);
  const showAuthority = sectionHasAuthority(rows);

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
              <th style={{ minWidth: "10rem" }}>Name</th>
              {showAuthority ? <th style={{ minWidth: "5rem" }}>Authority</th> : null}
              {showHours ? <th>Hours</th> : null}
              {showRate ? <th>Rate</th> : null}
              <th>Current</th>
              <th>YTD</th>
              <th style={{ width: "4rem" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <LineItemRow
                key={row.id}
                row={row}
                showHours={showHours}
                showRate={showRate}
                showAuthority={showAuthority}
                ctx={ctx}
              />
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
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

  // Summary row edit state
  const [summaryEdit, setSummaryEdit] = useState<SummaryEditState | null>(null);
  const [summarySaving, setSummarySaving] = useState(false);
  const [summarySaveError, setSummarySaveError] = useState<string | null>(null);

  // Line item edit/delete state
  const [liEditingId, setLiEditingId] = useState<string | null>(null);
  const [liEditFields, setLiEditFields] = useState<LineItemEditFields | null>(null);
  const [liDeletingId, setLiDeletingId] = useState<string | null>(null);
  const [liSaving, setLiSaving] = useState(false);
  const [liSaveError, setLiSaveError] = useState<string | null>(null);

  // Add line item form
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addSection, setAddSection] = useState<PayslipLineItemSection>("earnings");
  const [addName, setAddName] = useState("");
  const [addAmountCurrent, setAddAmountCurrent] = useState("");
  const [addAmountYtd, setAddAmountYtd] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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

  // --- Summary PATCH ---
  const patchSummary = useCallback(async (fields: Record<string, number | null>) => {
    if (!payslipId) return false;
    setSummarySaving(true);
    setSummarySaveError(null);
    try {
      const res = await apiFetch(`/payslips/${encodeURIComponent(payslipId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = text || res.statusText;
        try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* raw */ }
        setSummarySaveError(msg);
        return false;
      }
      const data = await res.json() as { snapshot: PayslipSnapshotDetail; validationWarnings?: ValidationWarning[] };
      setDetail((prev) => prev
        ? { ...data.snapshot, lineItems: prev.lineItems, matchedDeposits: prev.matchedDeposits, validationWarnings: data.validationWarnings }
        : data.snapshot
      );
      setSummaryEdit(null);
      return true;
    } catch (e) {
      setSummarySaveError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSummarySaving(false);
    }
  }, [payslipId]);

  const handleSaveSummaryRow = useCallback(async (def: AmountRowDef, es: SummaryEditState) => {
    const currentV = es.currentVal.trim() === "" ? null : parseAmountInput(es.currentVal);
    const ytdV = es.ytdVal.trim() === "" ? null : parseAmountInput(es.ytdVal);
    if (
      (es.currentVal.trim() !== "" && currentV === null) ||
      (es.ytdVal.trim() !== "" && ytdV === null)
    ) {
      setSummarySaveError("Enter a valid number or leave blank to clear.");
      return;
    }
    await patchSummary({ [def.currentField]: currentV, [def.ytdField]: ytdV });
  }, [patchSummary]);

  // --- Line item mutation helper ---
  type LiMutationResponse = {
    snapshot: PayslipSnapshotDetail;
    lineItems: PayslipLineItemsGrouped;
    validationWarnings?: ValidationWarning[];
  };

  const applyLineItemMutation = useCallback((res: LiMutationResponse) => {
    setDetail((prev) => prev
      ? { ...res.snapshot, lineItems: res.lineItems, matchedDeposits: prev.matchedDeposits, validationWarnings: res.validationWarnings }
      : { ...res.snapshot, lineItems: res.lineItems, validationWarnings: res.validationWarnings }
    );
    setLiEditingId(null);
    setLiEditFields(null);
    setLiDeletingId(null);
    setLiSaveError(null);
  }, []);

  const callLineItemApi = useCallback(async (url: string, method: string, body?: unknown) => {
    setLiSaving(true);
    setLiSaveError(null);
    try {
      const res = await apiFetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = text || res.statusText;
        try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* raw */ }
        setLiSaveError(msg);
        return;
      }
      const data = await res.json() as LiMutationResponse;
      applyLineItemMutation(data);
    } catch (e) {
      setLiSaveError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLiSaving(false);
    }
  }, [applyLineItemMutation]);

  // --- Add line item handler ---
  const handleAddLineItem = useCallback(async () => {
    if (!payslipId) return;
    setAddSaving(true);
    setAddError(null);
    try {
      const body = {
        section: addSection,
        name: addName.trim() || null,
        amountCurrent: addAmountCurrent.trim() === "" ? null : parseAmountInput(addAmountCurrent),
        amountYtd: addAmountYtd.trim() === "" ? null : parseAmountInput(addAmountYtd),
      };
      const res = await apiFetch(`/payslips/${encodeURIComponent(payslipId)}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = text || res.statusText;
        try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* raw */ }
        setAddError(msg);
        return;
      }
      const data = await res.json() as { snapshot: PayslipSnapshotDetail; lineItems: PayslipLineItemsGrouped; validationWarnings?: ValidationWarning[] };
      applyLineItemMutation(data);
      // Reset form
      setAddFormOpen(false);
      setAddName("");
      setAddAmountCurrent("");
      setAddAmountYtd("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setAddSaving(false);
    }
  }, [payslipId, addSection, addName, addAmountCurrent, addAmountYtd, applyLineItemMutation]);

  // --- Line item edit handlers ---
  const liCtx: LineItemEditCtx = {
    editingRowId: liEditingId,
    editFields: liEditFields,
    deletingRowId: liDeletingId,
    saving: liSaving,
    saveError: liSaveError,
    onStartEdit: (row) => {
      setLiDeletingId(null);
      setLiSaveError(null);
      setLiEditingId(row.id);
      setLiEditFields({
        name: row.name ?? "",
        authority: row.authority ?? "",
        amountCurrent: row.amountCurrent != null ? String(row.amountCurrent) : "",
        amountYtd: row.amountYtd != null ? String(row.amountYtd) : "",
        hoursOrDaysCurrent: row.hoursOrDaysCurrent != null ? String(row.hoursOrDaysCurrent) : "",
        rate: row.rate != null ? String(row.rate) : "",
      });
    },
    onEditChange: setLiEditFields,
    onSaveEdit: (rowId) => {
      if (!payslipId || !liEditFields) return;
      const f = liEditFields;
      const body: Record<string, unknown> = {};
      body.name = f.name.trim() || null;
      body.authority = f.authority.trim() || null;
      body.amountCurrent = f.amountCurrent.trim() === "" ? null : parseAmountInput(f.amountCurrent);
      body.amountYtd = f.amountYtd.trim() === "" ? null : parseAmountInput(f.amountYtd);
      body.hoursOrDaysCurrent = f.hoursOrDaysCurrent.trim() === "" ? null : parseAmountInput(f.hoursOrDaysCurrent);
      body.rate = f.rate.trim() === "" ? null : parseAmountInput(f.rate);
      void callLineItemApi(
        `/payslips/${encodeURIComponent(payslipId)}/line-items/${encodeURIComponent(rowId)}`,
        "PATCH",
        body
      );
    },
    onCancelEdit: () => { setLiEditingId(null); setLiEditFields(null); setLiSaveError(null); },
    onStartDelete: (rowId) => { setLiEditingId(null); setLiEditFields(null); setLiSaveError(null); setLiDeletingId(rowId); },
    onConfirmDelete: (rowId) => {
      if (!payslipId) return;
      void callLineItemApi(
        `/payslips/${encodeURIComponent(payslipId)}/line-items/${encodeURIComponent(rowId)}`,
        "DELETE"
      );
    },
    onCancelDelete: () => { setLiDeletingId(null); setLiSaveError(null); },
  };

  if (!token) return <Navigate to="/" replace />;

  const deletePayslip = async () => {
    if (!payslipId) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/payslips/${encodeURIComponent(payslipId)}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        let msg = text || res.statusText;
        try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* raw */ }
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

  // UI-side merge: dedupe Deloitte imputed-income rows + fold other_deductions into post_tax
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

  const validationWarnings = detail?.validationWarnings ?? [];

  return (
    <Stack className="payslips-page">
      <Paper withBorder p="lg">
        <Anchor component={Link} to="/payslips">← Payslips</Anchor>
        <Group justify="space-between" align="flex-start" wrap="wrap" mt="xs">
          <Title order={2} m={0}>Payslip detail</Title>
          <Button type="button" variant="default"
            disabled={deleting || loading}
            onClick={() => setDeleteConfirm(true)}>
            {deleting ? "Deleting…" : "Delete payslip"}
          </Button>
        </Group>
        <Text c="dimmed" mt="xs">Click ✏ on any amount row or line item to correct it. Changes to line items auto-update the matching summary bucket.</Text>
      </Paper>

      {loading ? (
        <Paper withBorder p="lg">
          <Text c="dimmed">Loading…</Text>
        </Paper>
      ) : null}

      {error ? (
        <Paper withBorder p="lg">
          <Alert color="red" mb="sm">{error}</Alert>
          <Anchor component={Link} to="/payslips">Back to list</Anchor>
        </Paper>
      ) : null}

      {!loading && !error && detail ? (
        <>
          <Paper withBorder p="lg">
            <Title order={4} mt={0}>Stub</Title>
            <dl className="payslip-detail-dl">
              <dt>File</dt><dd>{detail.fileName}</dd>
              <dt>Uploaded</dt><dd style={{ whiteSpace: "nowrap" }}>{detail.createdAt}</dd>
              <dt>Parser</dt><dd><code style={{ fontSize: "0.85rem" }}>{detail.parserProfileId}</code></dd>
              {detail.employerId ? (
                <><dt>Employer</dt>
                <dd>{employers.find((e) => e.id === detail.employerId)?.displayName ?? `${detail.employerId.slice(0, 8)}…`}</dd></>
              ) : null}
              {detail.importFileId ? (
                <><dt>Import file</dt><dd><code style={{ fontSize: "0.85rem" }}>{detail.importFileId}</code></dd></>
              ) : null}
              <dt>Checksum</dt>
              <dd><code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{detail.fileChecksum}</code></dd>
            </dl>
          </Paper>

          <Paper withBorder p="lg">
            <Title order={4} mt={0}>Period</Title>
            <dl className="payslip-detail-dl">
              <dt>Pay period</dt><dd>{periodLabel(detail)}</dd>
              <dt>Pay date</dt><dd>{detail.payDate ?? "—"}</dd>
              <dt>Hours worked</dt>
              <dd>
                {detail.hoursOrDaysCurrent ?? "—"}
                {detail.hoursOrDaysYtd != null ? (
                  <span className="muted" style={{ marginLeft: "0.5rem", fontSize: "0.85rem" }}>YTD: {detail.hoursOrDaysYtd}</span>
                ) : null}
              </dd>
              {detail.employmentRate != null ? (
                <><dt>Salary / Rate</dt>
                <dd>
                  {formatMoney(detail.employmentRate)}
                  {detail.employmentRateType ? (
                    <span className="muted" style={{ marginLeft: "0.4rem", fontSize: "0.85rem" }}>({detail.employmentRateType})</span>
                  ) : null}
                </dd></>
              ) : null}
            </dl>
          </Paper>

          {detail.payDate != null && detail.netPayCurrent != null ? (
            <Paper withBorder p="lg">
              <Title order={4} mt={0}>Bank deposit</Title>
              {detail.matchedDeposits && detail.matchedDeposits.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>Date</th><th>Description</th><th>Amount</th><th>Account</th><th />
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
                            <Link to={depositWindowLink(d.accountId, detail.payDate!)} style={{ fontSize: "0.85rem" }}>View</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Text c="dimmed" m={0}>
                  No matching deposit found near {detail.payDate} for {formatMoney(detail.netPayCurrent)}.
                </Text>
              )}
            </Paper>
          ) : null}

          <Paper withBorder p="lg">
            <Title order={4} mt={0}>Amounts</Title>
            <ValidationWarningsBanner warnings={validationWarnings} />
            <div style={{ overflowX: "auto" }}>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th /><th>Current</th><th>YTD</th><th style={{ width: "2.5rem" }} />
                  </tr>
                </thead>
                <tbody>
                  {AMOUNT_ROWS.map((def) => (
                    <SummaryAmountRow
                      key={def.key}
                      def={def}
                      currentVal={detail[def.currentField as keyof PayslipSnapshotDetail] as number | null}
                      ytdVal={detail[def.ytdField as keyof PayslipSnapshotDetail] as number | null}
                      editState={summaryEdit?.rowKey === def.key ? summaryEdit : null}
                      saving={summarySaving}
                      saveError={summaryEdit?.rowKey === def.key ? summarySaveError : null}
                      onStartEdit={() => {
                        setSummarySaveError(null);
                        const cv = detail[def.currentField as keyof PayslipSnapshotDetail] as number | null;
                        const yv = detail[def.ytdField as keyof PayslipSnapshotDetail] as number | null;
                        setSummaryEdit({ rowKey: def.key, currentVal: cv != null ? String(cv) : "", ytdVal: yv != null ? String(yv) : "" });
                      }}
                      onEditChange={setSummaryEdit}
                      onSave={() => { if (summaryEdit) void handleSaveSummaryRow(def, summaryEdit); }}
                      onCancel={() => { setSummaryEdit(null); setSummarySaveError(null); }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Paper>

          <Paper withBorder p="lg">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: nonEmptySections.length > 0 ? "0.5rem" : 0 }}>
              <Title order={4} mt={0} mb={0}>Line items</Title>
              {!addFormOpen ? (
                <Button type="button" variant="default" size="xs"
                  onClick={() => { setAddFormOpen(true); setAddError(null); }}
                >
                  + Add row
                </Button>
              ) : null}
            </div>
            {nonEmptySections.length > 0 ? (
              <Text c="dimmed" mt="xs" mb="md" size="sm">
                Edit or delete rows to correct extraction errors — summary totals update automatically.
              </Text>
            ) : (
              <Text c="dimmed" mt="xs" mb="md" size="sm">
                No line items. Use "+ Add row" to enter individual earnings and deduction rows.
              </Text>
            )}
            {nonEmptySections.map((section) => (
              <LineItemsSection
                key={section}
                section={section}
                rows={mergedLineItems![section]}
                ctx={liCtx}
              />
            ))}

            {/* Inline add form */}
            {addFormOpen ? (
              <div style={{ marginTop: nonEmptySections.length > 0 ? "0.75rem" : 0, padding: "0.75rem", background: "rgba(0,0,0,0.025)", borderRadius: 6, border: "1px solid var(--color-border)" }}>
                <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.5rem" }}>Add line item</div>
                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label className="field" style={{ flex: "0 0 auto", marginBottom: 0 }}>
                    <span style={{ fontSize: "0.8rem" }}>Section</span>
                    <select value={addSection} onChange={(e) => setAddSection(e.target.value as PayslipLineItemSection)}
                      style={{ fontSize: "0.85rem", padding: "0.2rem 0.4rem" }} disabled={addSaving}>
                      {ADD_SECTION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ flex: "1 1 10rem", marginBottom: 0 }}>
                    <span style={{ fontSize: "0.8rem" }}>Name</span>
                    <input type="text" value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      placeholder="e.g. Regular Pay"
                      style={{ width: "100%", fontSize: "0.85rem", padding: "0.2rem 0.4rem" }}
                      disabled={addSaving}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleAddLineItem(); if (e.key === "Escape") setAddFormOpen(false); }}
                    />
                  </label>
                  <label className="field" style={{ flex: "0 0 7rem", marginBottom: 0 }}>
                    <span style={{ fontSize: "0.8rem" }}>Current</span>
                    <input type="number" step="0.01" value={addAmountCurrent}
                      onChange={(e) => setAddAmountCurrent(e.target.value)}
                      placeholder="0.00"
                      style={{ width: "100%", fontSize: "0.85rem", padding: "0.2rem 0.4rem" }}
                      disabled={addSaving}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleAddLineItem(); if (e.key === "Escape") setAddFormOpen(false); }}
                    />
                  </label>
                  <label className="field" style={{ flex: "0 0 7rem", marginBottom: 0 }}>
                    <span style={{ fontSize: "0.8rem" }}>YTD</span>
                    <input type="number" step="0.01" value={addAmountYtd}
                      onChange={(e) => setAddAmountYtd(e.target.value)}
                      placeholder="0.00"
                      style={{ width: "100%", fontSize: "0.85rem", padding: "0.2rem 0.4rem" }}
                      disabled={addSaving}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleAddLineItem(); if (e.key === "Escape") setAddFormOpen(false); }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "0.4rem", paddingBottom: "0.05rem" }}>
                    <Button type="button" size="xs" onClick={() => void handleAddLineItem()} disabled={addSaving}>
                      {addSaving ? "…" : "Add"}
                    </Button>
                    <Button type="button" variant="default" size="xs" onClick={() => { setAddFormOpen(false); setAddError(null); }} disabled={addSaving}>
                      Cancel
                    </Button>
                  </div>
                </div>
                {addError ? <p className="error" style={{ marginTop: "0.4rem", marginBottom: 0, fontSize: "0.82rem" }}>{addError}</p> : null}
              </div>
            ) : null}
          </Paper>

          <Paper withBorder p="lg">
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Parser diagnostics (raw JSON)</summary>
              <pre style={{
                marginTop: "0.75rem", fontSize: "0.75rem", overflow: "auto", maxHeight: "24rem",
                padding: "0.75rem", background: "var(--surface-muted, rgba(0,0,0,0.04))", borderRadius: "6px"
              }}>
                {JSON.stringify(detail.rawExtractJson, null, 2)}
              </pre>
            </details>
          </Paper>
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
    </Stack>
  );
}
