import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { IconChevronDown, IconChevronRight, IconPencil, IconTrash } from "@tabler/icons-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GroveCardLoader } from "../components/GroveLoader";
import type {
  MatchedDeposit,
  PayslipLineItemRow,
  PayslipLineItemSection,
  PayslipLineItemsGrouped,
  PayslipSnapshotDetail,
  ValidationWarning
} from "../payslip/types";
import { SECTION_LABELS, SECTION_ORDER } from "../payslip/types";
import { formatUsd } from "../utils/format";

export type { PayslipSnapshotDetail };

const EMPTY_LINE_ITEMS: PayslipLineItemsGrouped = {
  earnings: [],
  pre_tax_deductions: [],
  post_tax_deductions: [],
  tax_deductions: [],
  other_deductions: [],
  other_information: [],
  taxable_earnings: []
};

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
  return `$${formatUsd(n)}`;
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
    <Alert color="fsGold" variant="light" mb="sm">
      <Stack gap={4}>
        <Text fw={600} size="sm">Data quality issues</Text>
        {warnings.map((w, i) => (
          <Text key={i} size="sm" c={w.code === "ARITHMETIC_IMBALANCE" ? "red" : "dimmed"}>
            {w.message}
          </Text>
        ))}
        <Text size="xs" c="dimmed">
          Edit or delete line items below, or correct the summary amounts directly. Warnings are non-blocking.
        </Text>
      </Stack>
    </Alert>
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

  if (isEditing) {
    return (
      <>
        <Table.Tr>
          <Table.Td>
            <Text size="sm" c={def.muted ? "dimmed" : undefined}>{def.label}</Text>
          </Table.Td>
          <Table.Td>
            <NumberInput
              ref={currentInputRef}
              value={editState!.currentVal}
              onChange={(v) => onEditChange({ ...editState!, currentVal: String(v ?? "") })}
              onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
              disabled={saving}
              placeholder="null"
              decimalScale={2}
              maw={150}
            />
          </Table.Td>
          <Table.Td>
            <NumberInput
              value={editState!.ytdVal}
              onChange={(v) => onEditChange({ ...editState!, ytdVal: String(v ?? "") })}
              onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
              disabled={saving}
              placeholder="null"
              decimalScale={2}
              maw={150}
            />
          </Table.Td>
          <Table.Td>
            <Group gap={6} wrap="nowrap">
              <Button type="button" onClick={onSave} disabled={saving} size="xs" title="Save">
                {saving ? "..." : "Save"}
              </Button>
              <Button type="button" variant="default" onClick={onCancel} disabled={saving} size="xs" title="Cancel">
                Cancel
              </Button>
            </Group>
          </Table.Td>
        </Table.Tr>
        {saveError ? (
          <Table.Tr>
            <Table.Td colSpan={4}><Text size="sm" c="red">{saveError}</Text></Table.Td>
          </Table.Tr>
        ) : null}
      </>
    );
  }

  return (
    <Table.Tr>
      <Table.Td><Text size="sm" c={def.muted ? "dimmed" : undefined}>{def.label}</Text></Table.Td>
      <Table.Td><Text size="sm">{formatMoney(currentVal)}</Text></Table.Td>
      <Table.Td><Text size="sm">{formatMoney(ytdVal)}</Text></Table.Td>
      <Table.Td>
        <ActionIcon type="button" variant="subtle" onClick={onStartEdit} title={`Edit ${def.label}`} aria-label={`Edit ${def.label}`}>
          <IconPencil size={14} />
        </ActionIcon>
      </Table.Td>
    </Table.Tr>
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
      <Table.Tr>
        <Table.Td colSpan={colSpan}>
          <Group gap="sm" wrap="wrap">
            <Text size="sm" c="red">Delete <strong>{row.name ?? "this row"}</strong>?</Text>
            <Button type="button" color="red" onClick={() => ctx.onConfirmDelete(row.id)} disabled={ctx.saving} size="xs">
              {ctx.saving ? "..." : "Delete"}
            </Button>
            <Button type="button" variant="default" onClick={ctx.onCancelDelete} disabled={ctx.saving} size="xs">
              Cancel
            </Button>
            {ctx.saveError ? <Text size="sm" c="red">{ctx.saveError}</Text> : null}
          </Group>
        </Table.Td>
      </Table.Tr>
    );
  }

  if (isEditing && ctx.editFields) {
    const f = ctx.editFields;
    return (
      <>
        <Table.Tr>
          <Table.Td>
            <TextInput ref={nameInputRef} value={f.name}
              onChange={(e) => ctx.onEditChange({ ...f, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Escape") ctx.onCancelEdit(); }}
              disabled={ctx.saving} placeholder="Name" />
          </Table.Td>
          {showAuthority ? (
            <Table.Td>
              <TextInput value={f.authority}
                onChange={(e) => ctx.onEditChange({ ...f, authority: e.target.value })}
                disabled={ctx.saving} placeholder="Authority" />
            </Table.Td>
          ) : null}
          {showHours ? (
            <Table.Td>
              <NumberInput decimalScale={2} value={f.hoursOrDaysCurrent}
                onChange={(v) => ctx.onEditChange({ ...f, hoursOrDaysCurrent: String(v ?? "") })}
                disabled={ctx.saving} placeholder="Hours" />
            </Table.Td>
          ) : null}
          {showRate ? (
            <Table.Td>
              <NumberInput decimalScale={2} value={f.rate}
                onChange={(v) => ctx.onEditChange({ ...f, rate: String(v ?? "") })}
                disabled={ctx.saving} placeholder="Rate" />
            </Table.Td>
          ) : null}
          <Table.Td>
            <NumberInput decimalScale={2} value={f.amountCurrent}
              onChange={(v) => ctx.onEditChange({ ...f, amountCurrent: String(v ?? "") })}
              onKeyDown={(e) => { if (e.key === "Enter") ctx.onSaveEdit(row.id); if (e.key === "Escape") ctx.onCancelEdit(); }}
              disabled={ctx.saving} placeholder="Current" />
          </Table.Td>
          <Table.Td>
            <NumberInput decimalScale={2} value={f.amountYtd}
              onChange={(v) => ctx.onEditChange({ ...f, amountYtd: String(v ?? "") })}
              onKeyDown={(e) => { if (e.key === "Enter") ctx.onSaveEdit(row.id); if (e.key === "Escape") ctx.onCancelEdit(); }}
              disabled={ctx.saving} placeholder="YTD" />
          </Table.Td>
          <Table.Td>
            <Group gap={6} wrap="nowrap">
              <Button type="button" onClick={() => ctx.onSaveEdit(row.id)} disabled={ctx.saving} size="xs" title="Save">
                {ctx.saving ? "..." : "Save"}
              </Button>
              <Button type="button" variant="default" onClick={ctx.onCancelEdit} disabled={ctx.saving} size="xs" title="Cancel">
                Cancel
              </Button>
            </Group>
          </Table.Td>
        </Table.Tr>
        {ctx.saveError ? (
          <Table.Tr>
            <Table.Td colSpan={colSpan}><Text size="sm" c="red">{ctx.saveError}</Text></Table.Td>
          </Table.Tr>
        ) : null}
      </>
    );
  }

  return (
    <Table.Tr>
      <Table.Td>
        {row.name ?? <Text span c="dimmed">—</Text>}
        {row.dateRaw ? (
          <Text span c="dimmed" size="xs" ml={6}>{row.dateRaw}</Text>
        ) : null}
      </Table.Td>
      {showAuthority ? (
        <Table.Td><Text size="sm" c="dimmed">{row.authority ?? "—"}</Text></Table.Td>
      ) : null}
      {showHours ? (
        <Table.Td>
          {row.hoursOrDaysCurrent != null ? row.hoursOrDaysCurrent : "—"}
        </Table.Td>
      ) : null}
      {showRate ? (
        <Table.Td>{row.rate != null ? formatMoney(row.rate) : "—"}</Table.Td>
      ) : null}
      <Table.Td>{formatMoney(row.amountCurrent)}</Table.Td>
      <Table.Td>{formatMoney(row.amountYtd)}</Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <ActionIcon type="button" variant="subtle" onClick={() => ctx.onStartEdit(row)} title="Edit row" aria-label="Edit row">
            <IconPencil size={14} />
          </ActionIcon>
          <ActionIcon type="button" variant="subtle" color="red" onClick={() => ctx.onStartDelete(row.id)} title="Delete row" aria-label="Delete row">
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
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
  const [open, setOpen] = useState(false);

  return (
    <Stack mb="sm">
      <Group>
        <Button
          type="button"
          variant="subtle"
          onClick={() => setOpen((v) => !v)}
          leftSection={open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        >
          {SECTION_LABELS[section]}
        </Button>
        <Text c="dimmed" size="sm">
          ({rows.length} row{rows.length !== 1 ? "s" : ""})
        </Text>
      </Group>
      {open ? (
        <Table withTableBorder striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th miw={160}>Name</Table.Th>
              {showAuthority ? <Table.Th miw={90}>Authority</Table.Th> : null}
              {showHours ? <Table.Th>Hours</Table.Th> : null}
              {showRate ? <Table.Th>Rate</Table.Th> : null}
              <Table.Th>Current</Table.Th>
              <Table.Th>YTD</Table.Th>
              <Table.Th w={64} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
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
          </Table.Tbody>
        </Table>
      ) : null}
    </Stack>
  );
}

type TxnSearchRow = {
  id: string;
  txnDate: string;
  amount: number;
  direction: string;
  merchant: string | null;
  memo: string | null;
  accountId: string;
  institution: string;
  accountMask: string | null;
};

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
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  // Deposit confirm/unlink state
  const [depositSaving, setDepositSaving] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  // Manual search modal
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TxnSearchRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

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

  // Debounced transaction search for deposit manual-link modal
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      if (!token) {
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      void apiJson<{ transactions: TxnSearchRow[] }>(
        `/transactions?search=${encodeURIComponent(searchQuery.trim())}&limit=20&amountMin=0.01`
      )
        .then((r) => {
          const rows = r.transactions ?? [];
          setSearchResults(rows.filter((t) => t.direction === "credit"));
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, token]);

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
        ? {
            ...data.snapshot,
            lineItems: prev.lineItems,
            confirmedDeposits: prev.confirmedDeposits,
            suggestedDeposits: prev.suggestedDeposits,
            validationWarnings: data.validationWarnings
          }
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
      ? {
          ...res.snapshot,
          lineItems: res.lineItems,
          confirmedDeposits: prev.confirmedDeposits,
          suggestedDeposits: prev.suggestedDeposits,
          validationWarnings: res.validationWarnings
        }
      : {
          ...res.snapshot,
          lineItems: res.lineItems,
          confirmedDeposits: [],
          suggestedDeposits: [],
          validationWarnings: res.validationWarnings
        }
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

  const confirmDeposit = useCallback(
    async (canonicalId: string) => {
      if (!payslipId) return;
      setDepositSaving(true);
      setDepositError(null);
      try {
        const res = await apiFetch(
          `/payslips/${encodeURIComponent(payslipId)}/deposits/${encodeURIComponent(canonicalId)}`,
          { method: "PUT" }
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          setDepositError(j.message ?? "Failed to link deposit");
          return;
        }
        const data = (await res.json()) as {
          snapshot: PayslipSnapshotDetail;
          confirmedDeposits: MatchedDeposit[];
        };
        setDetail((prev) => {
          const next: PayslipSnapshotDetail = {
            ...data.snapshot,
            confirmedDeposits: data.confirmedDeposits,
            suggestedDeposits: []
          };
          if (!prev) return next;
          return {
            ...next,
            lineItems: prev.lineItems,
            validationWarnings: prev.validationWarnings
          };
        });
        setSearchOpen(false);
      } finally {
        setDepositSaving(false);
      }
    },
    [payslipId]
  );

  const removeDeposit = useCallback(
    async (canonicalId: string) => {
      if (!payslipId) return;
      setDepositSaving(true);
      setDepositError(null);
      try {
        const res = await apiFetch(
          `/payslips/${encodeURIComponent(payslipId)}/deposits/${encodeURIComponent(canonicalId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          setDepositError(j.message ?? "Failed to unlink deposit");
          return;
        }
        const data = (await res.json()) as {
          snapshot: PayslipSnapshotDetail;
          confirmedDeposits: MatchedDeposit[];
        };
        const confirmedEmpty = data.confirmedDeposits.length === 0;
        setDetail((prev) => {
          if (!prev) {
            return {
              ...data.snapshot,
              lineItems: EMPTY_LINE_ITEMS,
              validationWarnings: [],
              confirmedDeposits: data.confirmedDeposits,
              suggestedDeposits: []
            };
          }
          return {
            ...data.snapshot,
            lineItems: prev.lineItems,
            validationWarnings: prev.validationWarnings,
            confirmedDeposits: data.confirmedDeposits,
            suggestedDeposits: []
          };
        });
        if (confirmedEmpty) {
          void load();
        }
      } finally {
        setDepositSaving(false);
      }
    },
    [payslipId, load]
  );

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
    <Stack>
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
          <GroveCardLoader label="Loading payslip…" />
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
            <Stack gap={6}>
              <Group><Text fw={600} miw={110}>File</Text><Text>{detail.fileName}</Text></Group>
              <Group><Text fw={600} miw={110}>Uploaded</Text><Text>{detail.createdAt}</Text></Group>
              <Group><Text fw={600} miw={110}>Parser</Text><Code>{detail.parserProfileId}</Code></Group>
              {detail.employerId ? (
                <Group>
                  <Text fw={600} miw={110}>Employer</Text>
                  <Text>{employers.find((e) => e.id === detail.employerId)?.displayName ?? `${detail.employerId.slice(0, 8)}…`}</Text>
                </Group>
              ) : null}
              {detail.importFileId ? (
                <Group><Text fw={600} miw={110}>Import file</Text><Code>{detail.importFileId}</Code></Group>
              ) : null}
              <Group align="flex-start"><Text fw={600} miw={110}>Checksum</Text><Code>{detail.fileChecksum}</Code></Group>
            </Stack>
          </Paper>

          <Paper withBorder p="lg">
            <Title order={4} mt={0}>Period</Title>
            <Stack gap={6}>
              <Group><Text fw={600} miw={110}>Pay period</Text><Text>{periodLabel(detail)}</Text></Group>
              <Group><Text fw={600} miw={110}>Pay date</Text><Text>{detail.payDate ?? "—"}</Text></Group>
              <Group>
                <Text fw={600} miw={110}>Hours worked</Text>
                <Text>
                {detail.hoursOrDaysCurrent ?? "—"}
                {detail.hoursOrDaysYtd != null ? (
                  <Text span c="dimmed" size="sm" ml={8}>YTD: {detail.hoursOrDaysYtd}</Text>
                ) : null}
                </Text>
              </Group>
              {detail.employmentRate != null ? (
                <Group>
                  <Text fw={600} miw={110}>Salary / Rate</Text>
                  <Text>
                  {formatMoney(detail.employmentRate)}
                  {detail.employmentRateType ? (
                    <Text span c="dimmed" size="sm" ml={6}>({detail.employmentRateType})</Text>
                  ) : null}
                  </Text>
                </Group>
              ) : null}
            </Stack>
          </Paper>

          <Paper withBorder p="lg">
            <Group justify="space-between" mb="xs" align="center">
              <Title order={4} mt={0} mb={0}>Bank deposit</Title>
              <Button
                type="button"
                size="xs"
                variant="subtle"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                  setSearchOpen(true);
                }}
              >
                {(detail.confirmedDeposits?.length ?? 0) > 0 ? "Link another…" : "Search ledger…"}
              </Button>
            </Group>

            {depositError ? (
              <Alert color="red" mb="sm" withCloseButton onClose={() => setDepositError(null)}>
                {depositError}
              </Alert>
            ) : null}

            {(detail.confirmedDeposits?.length ?? 0) > 0 ? (
              <Stack gap="xs">
                <Group gap="xs" mb={4}>
                  <Badge color="green" variant="light" size="sm">Confirmed</Badge>
                  {(detail.confirmedDeposits?.length ?? 0) > 1 ? (
                    <Text size="xs" c="dimmed">
                      Total linked: $
                      {formatUsd(
                        (detail.confirmedDeposits ?? []).reduce((s, d) => s + d.amount, 0)
                      )}
                      {detail.netPayCurrent != null
                        ? ` of $${formatUsd(detail.netPayCurrent)} net pay`
                        : ""}
                    </Text>
                  ) : null}
                </Group>
                <Table withTableBorder striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Description</Table.Th>
                      <Table.Th>Amount</Table.Th>
                      <Table.Th>Account</Table.Th>
                      <Table.Th w={80} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(detail.confirmedDeposits ?? []).map((d) => (
                      <Table.Tr key={d.id}>
                        <Table.Td>
                          <Anchor
                            component={Link}
                            to={depositWindowLink(
                              d.accountId,
                              detail.payDate ?? detail.payPeriodEnd ?? d.txnDate
                            )}
                          >
                            {d.txnDate}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>{d.merchant ?? d.memo ?? "—"}</Table.Td>
                        <Table.Td>${formatUsd(d.amount)}</Table.Td>
                        <Table.Td>{accountLabel(d)}</Table.Td>
                        <Table.Td>
                          <Button
                            type="button"
                            size="xs"
                            color="gray"
                            variant="subtle"
                            disabled={depositSaving}
                            onClick={() => void removeDeposit(d.id)}
                          >
                            Remove
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            ) : null}

            {(detail.confirmedDeposits?.length ?? 0) === 0 && (detail.suggestedDeposits?.length ?? 0) > 0 ? (
              <Stack gap="xs">
                <Text size="xs" c="dimmed">Suggestions — not confirmed yet</Text>
                <Table withTableBorder striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Description</Table.Th>
                      <Table.Th>Amount</Table.Th>
                      <Table.Th>Account</Table.Th>
                      <Table.Th>Match quality</Table.Th>
                      <Table.Th w={90} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(detail.suggestedDeposits ?? []).map((d) => (
                      <Table.Tr key={d.id}>
                        <Table.Td>
                          <Anchor
                            component={Link}
                            to={depositWindowLink(
                              d.accountId,
                              detail.payDate ?? detail.payPeriodEnd ?? d.txnDate
                            )}
                          >
                            {d.txnDate}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>{d.merchant ?? d.memo ?? "—"}</Table.Td>
                        <Table.Td>${formatUsd(d.amount)}</Table.Td>
                        <Table.Td>{accountLabel(d)}</Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {d.dateDelta === 0 ? "Same day" : `${d.dateDelta}d off`}
                            {d.amountDelta > 0 ? `, $${formatUsd(d.amountDelta)} diff` : ""}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            type="button"
                            size="xs"
                            disabled={depositSaving}
                            onClick={() => void confirmDeposit(d.id)}
                          >
                            Confirm
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            ) : null}

            {(detail.confirmedDeposits?.length ?? 0) === 0 && (detail.suggestedDeposits?.length ?? 0) === 0 ? (
              <Text c="dimmed" size="sm" mt="xs">
                No matching deposit found.{" "}
                {detail.payDate
                  ? `Searched near ${detail.payDate}`
                  : detail.payPeriodEnd
                    ? `Searched near period end ${detail.payPeriodEnd}`
                    : "Add a pay date to enable automatic suggestions."}{" "}
                {`Use the "Search ledger…" button to link manually.`}
              </Text>
            ) : null}

            <Modal
              opened={searchOpen}
              onClose={() => setSearchOpen(false)}
              title="Link bank deposit"
              size="xl"
            >
              <TextInput
                placeholder="Search by description, merchant, or amount…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                mb="sm"
                autoFocus
              />
              {searchLoading ? (
                <Group justify="center" py="md"><Loader size="sm" /></Group>
              ) : searchResults.length > 0 ? (
                <Table withTableBorder striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Description</Table.Th>
                      <Table.Th>Amount</Table.Th>
                      <Table.Th>Account</Table.Th>
                      <Table.Th w={80} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {searchResults.map((t) => (
                      <Table.Tr key={t.id}>
                        <Table.Td>{t.txnDate}</Table.Td>
                        <Table.Td>{t.merchant ?? t.memo ?? "—"}</Table.Td>
                        <Table.Td>${formatUsd(t.amount)}</Table.Td>
                        <Table.Td>
                          {t.accountMask
                            ? `${t.institution} ···${t.accountMask}`
                            : t.institution}
                        </Table.Td>
                        <Table.Td>
                          <Button
                            type="button"
                            size="xs"
                            disabled={depositSaving}
                            onClick={() => void confirmDeposit(t.id)}
                          >
                            Link
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : searchQuery.trim() ? (
                <Text c="dimmed" size="sm">{`No results for "${searchQuery}"`}</Text>
              ) : (
                <Text c="dimmed" size="sm">
                  Type to search transactions. Only credit transactions are shown.
                </Text>
              )}
            </Modal>
          </Paper>

          <Paper withBorder p="lg">
            <Title order={4} mt={0}>Amounts</Title>
            <ValidationWarningsBanner warnings={validationWarnings} />
            <Table withTableBorder striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th /><Table.Th>Current</Table.Th><Table.Th>YTD</Table.Th><Table.Th w={48} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
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
              </Table.Tbody>
            </Table>
          </Paper>

          <Paper withBorder p="lg">
            <Group justify="space-between" mb={nonEmptySections.length > 0 ? "xs" : 0}>
              <Title order={4} mt={0} mb={0}>Line items</Title>
              {!addFormOpen ? (
                <Button type="button" variant="default" size="xs"
                  onClick={() => { setAddFormOpen(true); setAddError(null); }}
                >
                  + Add row
                </Button>
              ) : null}
            </Group>
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
              <Paper withBorder p="md" mt={nonEmptySections.length > 0 ? "md" : 0}>
                <Text fw={600} size="sm" mb="sm">Add line item</Text>
                <Group gap="sm" align="flex-end" wrap="wrap">
                  <Select
                    label="Section"
                    value={addSection}
                    onChange={(value) => value && setAddSection(value as PayslipLineItemSection)}
                    data={ADD_SECTION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    disabled={addSaving}
                    maw={220}
                  />
                  <TextInput
                    label="Name"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="e.g. Regular Pay"
                    disabled={addSaving}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleAddLineItem(); if (e.key === "Escape") setAddFormOpen(false); }}
                    miw={220}
                  />
                  <NumberInput
                    label="Current"
                    decimalScale={2}
                    value={addAmountCurrent}
                    onChange={(v) => setAddAmountCurrent(String(v ?? ""))}
                    placeholder="0.00"
                    disabled={addSaving}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleAddLineItem(); if (e.key === "Escape") setAddFormOpen(false); }}
                    maw={120}
                  />
                  <NumberInput
                    label="YTD"
                    decimalScale={2}
                    value={addAmountYtd}
                    onChange={(v) => setAddAmountYtd(String(v ?? ""))}
                    placeholder="0.00"
                    disabled={addSaving}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleAddLineItem(); if (e.key === "Escape") setAddFormOpen(false); }}
                    maw={120}
                  />
                  <Group gap={6}>
                    <Button type="button" size="xs" onClick={() => void handleAddLineItem()} disabled={addSaving}>
                      {addSaving ? "..." : "Add"}
                    </Button>
                    <Button type="button" variant="default" size="xs" onClick={() => { setAddFormOpen(false); setAddError(null); }} disabled={addSaving}>
                      Cancel
                    </Button>
                  </Group>
                </Group>
                {addError ? <Text c="red" size="sm" mt="sm">{addError}</Text> : null}
              </Paper>
            ) : null}
          </Paper>

          <Paper withBorder p="lg">
            <Button
              type="button"
              variant="subtle"
              onClick={() => setDiagnosticsOpen((v) => !v)}
              leftSection={diagnosticsOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            >
              Parser diagnostics (raw JSON)
            </Button>
            {diagnosticsOpen ? (
              <Box mt="md">
                <Code block>{JSON.stringify(detail.rawExtractJson, null, 2)}</Code>
              </Box>
            ) : null}
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
