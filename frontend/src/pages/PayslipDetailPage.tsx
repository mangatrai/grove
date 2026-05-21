import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Code,
  Collapse,
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
import { ContribBucket } from "../payslip/ContribBucket";
import type { ContribBucketItem } from "../payslip/ContribBucket";
import { groupContributions } from "../payslip/contributions";
import { KpiStrip } from "../payslip/KpiStrip";
import { SavingsRateBanner } from "../payslip/SavingsRateBanner";
import { SparklineMini } from "../payslip/SparklineMini";
import { TaxSufficiencyAlert } from "../payslip/TaxSufficiencyAlert";
import {
  computeFederalRateAnnualised,
  computeSavingsRate,
  computeSavingsRateYtd,
} from "../payslip/savingsUtils";
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

// ─── Constants ───────────────────────────────────────────────────────────────

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
  { value: "earnings",           label: "Earnings" },
  { value: "pre_tax_deductions", label: "Pre-tax deductions" },
  { value: "tax_deductions",     label: "Tax deductions" },
  { value: "post_tax_deductions",label: "Post-tax deductions" },
  { value: "other_information",  label: "Other information" },
  { value: "taxable_earnings",   label: "Taxable earnings" },
];

const PERSON_COLORS = ["#2d6a4f", "#c8860a", "#7a8a6e", "#8b3a26", "#4a8a6e", "#7c3aed"];

const CONTRIB_DOT_COLORS: Record<string, string> = {
  retirement: "var(--fs-gold)",
  health:     "var(--fs-sage)",
  equity:     "var(--fs-terracotta)",
  other:      "var(--color-text-muted)",
};

// ─── Types ───────────────────────────────────────────────────────────────────

type EmployerRow = { id: string; displayName: string };
type HouseholdMemberResponse = { id: string; fullName?: string; firstName?: string; lastName?: string };
type HouseholdMembersPayload = { members: HouseholdMemberResponse[] };
type HouseholdProfileResponse = { profile: { id: string; fullName?: string; firstName?: string; lastName?: string } };
type PersonInfo = { id: string; name: string; initials: string; color: string };
type ListResponse = { items: PayslipSnapshotDetail[] };

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
  { key: "gross",    label: "Gross pay",          currentField: "grossPayCurrent",          ytdField: "grossPayYtd" },
  { key: "taxable",  label: "↳ Taxable earnings", currentField: "taxableEarningsCurrent",   ytdField: "taxableEarningsYtd",   muted: true },
  { key: "pretax",   label: "Pre-tax deductions",  currentField: "preTaxDeductionsCurrent",  ytdField: "preTaxDeductionsYtd" },
  { key: "taxes",    label: "Employee taxes",      currentField: "employeeTaxesCurrent",     ytdField: "employeeTaxesYtd" },
  { key: "posttax",  label: "Post-tax deductions", currentField: "postTaxDeductionsCurrent", ytdField: "postTaxDeductionsYtd" },
  { key: "otherinfo",label: "Other information",   currentField: "otherInformationCurrent",  ytdField: "otherInformationYtd", muted: true },
  { key: "net",      label: "Net pay",             currentField: "netPayCurrent",            ytdField: "netPayYtd" },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return "?";
}

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
  if (a && b) return `${a} – ${b}`;
  if (a) return a;
  if (b) return b;
  return "—";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const parsed = new Date(`${d}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

// ─── Sub-components ───────────────────────────────────────────────────────────

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
          Use "Edit" to correct amounts and line items. Warnings are non-blocking.
        </Text>
      </Stack>
    </Alert>
  );
}

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
              <Button type="button" onClick={onSave} disabled={saving} size="xs">
                {saving ? "..." : "Save"}
              </Button>
              <Button type="button" variant="default" onClick={onCancel} disabled={saving} size="xs">
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

  const colSpan = 2 + (showHours ? 1 : 0) + (showRate ? 1 : 0) + (showAuthority ? 1 : 0) + 1;

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
              <Button type="button" onClick={() => ctx.onSaveEdit(row.id)} disabled={ctx.saving} size="xs">
                {ctx.saving ? "..." : "Save"}
              </Button>
              <Button type="button" variant="default" onClick={ctx.onCancelEdit} disabled={ctx.saving} size="xs">
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
        {row.dateRaw ? <Text span c="dimmed" size="xs" ml={6}>{row.dateRaw}</Text> : null}
      </Table.Td>
      {showAuthority ? <Table.Td><Text size="sm" c="dimmed">{row.authority ?? "—"}</Text></Table.Td> : null}
      {showHours ? <Table.Td>{row.hoursOrDaysCurrent != null ? row.hoursOrDaysCurrent : "—"}</Table.Td> : null}
      {showRate ? <Table.Td>{row.rate != null ? formatMoney(row.rate) : "—"}</Table.Td> : null}
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

// ─── View-mode line item row ──────────────────────────────────────────────────

const mono: CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

function LiViewRow({ row, indent }: { row: PayslipLineItemRow; indent?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "3px 0",
        fontSize: 12.5,
        color: "var(--color-text-secondary)",
      }}
    >
      <span style={{ flex: 1, paddingLeft: indent ? 12 : 0 }}>{row.name ?? "—"}</span>
      <span style={{ ...mono, fontSize: 12, minWidth: 72, textAlign: "right" }} role="text">
        {formatMoney(row.amountCurrent)}
      </span>
      <span
        style={{ ...mono, fontSize: 11.5, color: "var(--color-text-muted)", minWidth: 72, textAlign: "right" }}
        role="text"
      >
        {formatMoney(row.amountYtd)}
      </span>
    </div>
  );
}

function SectionHdr({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 0 4px",
        marginTop: 10,
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: 10.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--color-text-muted)",
        }}
      >
        {label}
      </span>
      <span style={{ ...mono, fontSize: 10.5, color: "var(--color-text-muted)", minWidth: 72, textAlign: "right" }}>
        Current
      </span>
      <span style={{ ...mono, fontSize: 10.5, color: "var(--color-text-muted)", minWidth: 72, textAlign: "right" }}>
        YTD
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

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

  // Deposit confirm/unlink state
  const [depositSaving, setDepositSaving] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  // Manual search modal
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TxnSearchRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Edit mode toggle
  const [editMode, setEditMode] = useState(false);

  // Collapsible sections
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [stubInfoOpen, setStubInfoOpen] = useState(false);

  // Person payslips (for sparkline + prior values) + person map
  const [personPayslips, setPersonPayslips] = useState<PayslipSnapshotDetail[]>([]);
  const [personMap, setPersonMap] = useState<Map<string, PersonInfo>>(new Map());

  // ── Data loading ──────────────────────────────────────────────────────────

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

  // Debounced transaction search
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(() => {
      if (!token) { setSearchLoading(false); return; }
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

  // Fetch person payslips (sparkline + prior values)
  useEffect(() => {
    if (!detail?.ownerPersonProfileId || !token) return;
    void apiJson<ListResponse>(
      `/payslips?ownerScope=person&ownerPersonProfileId=${encodeURIComponent(detail.ownerPersonProfileId)}&limit=10`
    )
      .then((r) => setPersonPayslips(r.items ?? []))
      .catch(() => setPersonPayslips([]));
  }, [detail?.ownerPersonProfileId, token]);

  // Fetch household members for person display names
  useEffect(() => {
    if (!token) return;
    void Promise.all([
      apiJson<HouseholdMembersPayload>("/household/members").catch(() => ({ members: [] as HouseholdMemberResponse[] })),
      apiJson<HouseholdProfileResponse>("/household/profile").catch(() => ({ profile: { id: "", fullName: "Household" } })),
    ]).then(([membersRes, profileRes]) => {
      const members = (membersRes as HouseholdMembersPayload).members ?? [];
      const profile = (profileRes as HouseholdProfileResponse).profile;
      const allMembers: HouseholdMemberResponse[] = [...members];
      if (profile?.id && !allMembers.some((m) => m.id === profile.id)) {
        allMembers.unshift(profile);
      }
      const map = new Map<string, PersonInfo>();
      allMembers.forEach((m, idx) => {
        const name =
          [m.fullName, [m.firstName, m.lastName].filter(Boolean).join(" ").trim()].find(
            (x) => x?.trim()
          ) || m.id;
        map.set(m.id, {
          id: m.id,
          name,
          initials: getInitials(name),
          color: PERSON_COLORS[idx % PERSON_COLORS.length]!,
        });
      });
      setPersonMap(map);
    });
  }, [token]);

  // ── Callbacks ─────────────────────────────────────────────────────────────

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
        ? { ...data.snapshot, lineItems: prev.lineItems, confirmedDeposits: prev.confirmedDeposits, suggestedDeposits: prev.suggestedDeposits, validationWarnings: data.validationWarnings }
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

  type LiMutationResponse = {
    snapshot: PayslipSnapshotDetail;
    lineItems: PayslipLineItemsGrouped;
    validationWarnings?: ValidationWarning[];
  };

  const applyLineItemMutation = useCallback((res: LiMutationResponse) => {
    setDetail((prev) => prev
      ? { ...res.snapshot, lineItems: res.lineItems, confirmedDeposits: prev.confirmedDeposits, suggestedDeposits: prev.suggestedDeposits, validationWarnings: res.validationWarnings }
      : { ...res.snapshot, lineItems: res.lineItems, confirmedDeposits: [], suggestedDeposits: [], validationWarnings: res.validationWarnings }
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

  const confirmDeposit = useCallback(async (canonicalId: string) => {
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
      const data = (await res.json()) as { snapshot: PayslipSnapshotDetail; confirmedDeposits: MatchedDeposit[] };
      setDetail((prev) => {
        const next: PayslipSnapshotDetail = { ...data.snapshot, confirmedDeposits: data.confirmedDeposits, suggestedDeposits: [] };
        if (!prev) return next;
        return { ...next, lineItems: prev.lineItems, validationWarnings: prev.validationWarnings };
      });
      setSearchOpen(false);
    } finally {
      setDepositSaving(false);
    }
  }, [payslipId]);

  const removeDeposit = useCallback(async (canonicalId: string) => {
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
      const data = (await res.json()) as { snapshot: PayslipSnapshotDetail; confirmedDeposits: MatchedDeposit[] };
      setDetail((prev) => {
        if (!prev) return { ...data.snapshot, lineItems: EMPTY_LINE_ITEMS, validationWarnings: [], confirmedDeposits: data.confirmedDeposits, suggestedDeposits: [] };
        return { ...data.snapshot, lineItems: prev.lineItems, validationWarnings: prev.validationWarnings, confirmedDeposits: data.confirmedDeposits, suggestedDeposits: [] };
      });
      if (data.confirmedDeposits.length === 0) void load();
    } finally {
      setDepositSaving(false);
    }
  }, [payslipId, load]);

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
      const body: Record<string, unknown> = {
        name: f.name.trim() || null,
        authority: f.authority.trim() || null,
        amountCurrent: f.amountCurrent.trim() === "" ? null : parseAmountInput(f.amountCurrent),
        amountYtd: f.amountYtd.trim() === "" ? null : parseAmountInput(f.amountYtd),
        hoursOrDaysCurrent: f.hoursOrDaysCurrent.trim() === "" ? null : parseAmountInput(f.hoursOrDaysCurrent),
        rate: f.rate.trim() === "" ? null : parseAmountInput(f.rate),
      };
      void callLineItemApi(`/payslips/${encodeURIComponent(payslipId)}/line-items/${encodeURIComponent(rowId)}`, "PATCH", body);
    },
    onCancelEdit: () => { setLiEditingId(null); setLiEditFields(null); setLiSaveError(null); },
    onStartDelete: (rowId) => { setLiEditingId(null); setLiEditFields(null); setLiSaveError(null); setLiDeletingId(rowId); },
    onConfirmDelete: (rowId) => {
      if (!payslipId) return;
      void callLineItemApi(`/payslips/${encodeURIComponent(payslipId)}/line-items/${encodeURIComponent(rowId)}`, "DELETE");
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

  // ── Derived computations ──────────────────────────────────────────────────

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

  // Prior values from the person payslips list (list endpoint has LAG results)
  const priorValues = useMemo(
    () => personPayslips.find((p) => p.id === payslipId)?.prior ?? null,
    [personPayslips, payslipId]
  );

  // Sparkline data — person payslips sorted chronologically
  const sparklineData = useMemo(
    () =>
      [...personPayslips]
        .sort((a, b) => {
          const da = a.payDate ?? a.payPeriodEnd ?? a.createdAt;
          const db = b.payDate ?? b.payPeriodEnd ?? b.createdAt;
          return da < db ? -1 : 1;
        })
        .map((p) => p.netPayCurrent ?? 0),
    [personPayslips]
  );

  // Person display info
  const personInfo = detail?.ownerPersonProfileId ? personMap.get(detail.ownerPersonProfileId) : null;
  const personName = personInfo?.name ?? "—";
  const personInitials = personInfo?.initials ?? getInitials(personName);
  const personColor = personInfo?.color ?? "#2d6a4f";
  const employerLabel =
    (detail?.employerId
      ? (employers.find((e) => e.id === detail.employerId)?.displayName ?? null)
      : null) ??
    "—";

  // PS-3 savings rate
  const savingsRate = detail ? computeSavingsRate(detail) : null;
  const savingsRateYtd = detail ? computeSavingsRateYtd(detail) : null;

  // PS-4 federal rate
  const federalRate = detail
    ? computeFederalRateAnnualised(detail, detail.payPeriodCountYtd ?? 1)
    : null;

  // Contribution groups for PS-2
  const contribGroups = useMemo(
    () =>
      mergedLineItems
        ? groupContributions(mergedLineItems.pre_tax_deductions ?? [])
        : null,
    [mergedLineItems]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Stack gap={12}>
      {/* Breadcrumb + action row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Group gap={4} style={{ flex: 1, fontSize: 12, color: "var(--color-text-muted)" }}>
          <Anchor component={Link} to="/payslips" size="sm">Payslips</Anchor>
          <Text span c="dimmed" size="sm">›</Text>
          <Text span size="sm" fw={500} c="var(--color-text-secondary)">{personName}</Text>
          <Text span c="dimmed" size="sm">›</Text>
          <Text span size="sm" fw={500} c="var(--color-text)">{detail ? periodLabel(detail) : "…"}</Text>
        </Group>
        <Group gap={7} wrap="nowrap">
          {!loading && detail ? (
            <Button
              type="button"
              size="xs"
              variant={editMode ? "filled" : "default"}
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? "Done editing" : "Edit"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant="default"
            onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchOpen(true); }}
            disabled={loading || !detail}
          >
            Match Deposit
          </Button>
          <Button
            type="button"
            size="xs"
            variant="subtle"
            color="red"
            disabled={deleting || loading}
            onClick={() => setDeleteConfirm(true)}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </Group>
      </div>

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
          {/* Person header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "10px 0 4px",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: personColor,
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
                fontFamily: "'Inter Tight', 'Inter', sans-serif",
              }}
              aria-hidden
            >
              {personInitials}
            </span>
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  fontFamily: "'Inter Tight', 'Inter', sans-serif",
                  color: "var(--color-text)",
                }}
              >
                {personName}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                {employerLabel}
                {detail.payDate ? ` · Pay date ${fmtDate(detail.payDate)}` : ""}
                {detail.employmentRateType ? ` · ${detail.employmentRateType}` : ""}
              </div>
            </div>
          </div>

          {/* Validation warnings */}
          <ValidationWarningsBanner warnings={validationWarnings} />

          {/* KPI strip (PS-1) */}
          <KpiStrip
            kpis={[
              { label: "Gross Pay",    value: detail.grossPayCurrent,         prior: priorValues?.grossPayCurrent },
              { label: "Net Pay",      value: detail.netPayCurrent,           prior: priorValues?.netPayCurrent,           accent: true },
              { label: "Taxes",        value: detail.employeeTaxesCurrent,    prior: priorValues?.employeeTaxesCurrent,    inverseSign: true },
              { label: "Pre-Tax Ded.", value: detail.preTaxDeductionsCurrent, prior: priorValues?.preTaxDeductionsCurrent },
            ]}
          />

          {/* Banners */}
          <SavingsRateBanner rate={savingsRate} rateYtd={savingsRateYtd} />
          <TaxSufficiencyAlert rate={federalRate} />

          {/* 2-column body */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 215px",
              gap: 14,
              alignItems: "start",
            }}
          >
            {/* Left: line items card */}
            <div
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 9,
                padding: "14px 16px",
              }}
            >
              {/* Earnings */}
              {(mergedLineItems?.earnings?.length ?? 0) > 0 ? (
                <>
                  <SectionHdr label="Earnings" />
                  {mergedLineItems!.earnings.map((r) => (
                    <LiViewRow key={r.id} row={r} />
                  ))}
                </>
              ) : null}

              {/* Pre-tax contributions (PS-2) */}
              {contribGroups ? (
                <>
                  <SectionHdr label="Pre-Tax Contributions" />
                  {(["retirement", "health", "equity", "other"] as const).map((key) => {
                    const rows = contribGroups[key] ?? [];
                    if (rows.length === 0) return null;
                    const items: ContribBucketItem[] = rows.map((r) => ({
                      name: r.name ?? "—",
                      amountCurrent: r.amountCurrent,
                      amountYtd: r.amountYtd,
                    }));
                    return (
                      <ContribBucket
                        key={key}
                        label={key.charAt(0).toUpperCase() + key.slice(1)}
                        colorDot={CONTRIB_DOT_COLORS[key] ?? "var(--color-text-muted)"}
                        items={items}
                      />
                    );
                  })}
                </>
              ) : null}

              {/* Post-tax deductions */}
              {(mergedLineItems?.post_tax_deductions?.length ?? 0) > 0 ? (
                <>
                  <SectionHdr label="Post-Tax Deductions" />
                  {mergedLineItems!.post_tax_deductions.map((r) => (
                    <LiViewRow key={r.id} row={r} />
                  ))}
                </>
              ) : null}

              {/* Tax deductions */}
              {(mergedLineItems?.tax_deductions?.length ?? 0) > 0 ? (
                <>
                  <SectionHdr label="Tax Deductions" />
                  {mergedLineItems!.tax_deductions.map((r) => (
                    <LiViewRow key={r.id} row={r} />
                  ))}
                </>
              ) : null}

              {/* Other sections */}
              {(["other_information", "taxable_earnings"] as const).map((sec) => {
                const rows = mergedLineItems?.[sec] ?? [];
                if (rows.length === 0) return null;
                return (
                  <div key={sec}>
                    <SectionHdr label={SECTION_LABELS[sec]} />
                    {rows.map((r) => <LiViewRow key={r.id} row={r} />)}
                  </div>
                );
              })}

              {/* Net Pay total row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "7px 0 2px",
                  marginTop: 6,
                  borderTop: `2px solid var(--color-border)`,
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: "var(--fs-forest)",
                }}
              >
                <span style={{ flex: 1 }}>Net Pay</span>
                <span style={{ ...mono, minWidth: 72, textAlign: "right" }} role="text">
                  {formatMoney(detail.netPayCurrent)}
                </span>
                <span
                  style={{ ...mono, fontSize: 12, color: "var(--color-text-muted)", minWidth: 72, textAlign: "right" }}
                  role="text"
                >
                  {formatMoney(detail.netPayYtd)}
                </span>
              </div>
            </div>

            {/* Right: sidebar */}
            <Stack gap={10}>
              {/* YTD totals card */}
              <div
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 9,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    color: "var(--color-text-muted)",
                    marginBottom: 8,
                  }}
                >
                  YTD Totals
                </div>
                {[
                  { label: "Gross",    value: detail.grossPayYtd },
                  { label: "Net",      value: detail.netPayYtd },
                  { label: "Taxes",    value: detail.employeeTaxesYtd },
                  { label: "Pre-Tax",  value: detail.preTaxDeductionsYtd },
                  { label: "Post-Tax", value: detail.postTaxDeductionsYtd },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "3px 0",
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
                    <span style={{ ...mono, fontSize: 12, fontWeight: 500, color: "var(--color-text)" }} role="text">
                      {formatMoney(value)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Contributions YTD */}
              {contribGroups && Object.values(contribGroups).some((g) => g.length > 0) ? (
                <div
                  style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 9,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: "var(--color-text-muted)",
                      marginBottom: 8,
                    }}
                  >
                    Contributions YTD
                  </div>
                  {(mergedLineItems?.pre_tax_deductions ?? []).map((r) => (
                    <div
                      key={r.id}
                      style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11.5 }}
                    >
                      <span style={{ color: "var(--color-text-secondary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name ?? "—"}
                      </span>
                      <span style={{ ...mono, fontSize: 11.5, color: "var(--color-text-muted)", marginLeft: 6 }} role="text">
                        {formatMoney(r.amountYtd)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Net pay sparkline */}
              {sparklineData.length >= 2 ? (
                <div
                  style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 9,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: "var(--color-text-muted)",
                      marginBottom: 8,
                    }}
                  >
                    Net Pay Trend
                  </div>
                  <SparklineMini data={sparklineData} width={183} height={36} color={personColor} />
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                    Last {sparklineData.length} payslips
                  </div>
                </div>
              ) : null}
            </Stack>
          </div>

          {/* Bank deposit card */}
          <Paper withBorder p="md">
            <Group justify="space-between" mb="xs" align="center">
              <Title order={5} m={0}>Bank deposit</Title>
              <Button
                type="button"
                size="xs"
                variant="subtle"
                onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchOpen(true); }}
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
                      Total: ${formatUsd((detail.confirmedDeposits ?? []).reduce((s, d) => s + d.amount, 0))}
                      {detail.netPayCurrent != null ? ` of $${formatUsd(detail.netPayCurrent)} net pay` : ""}
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
                          <Anchor component={Link} to={depositWindowLink(d.accountId, detail.payDate ?? detail.payPeriodEnd ?? d.txnDate)}>
                            {d.txnDate}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>{d.merchant ?? d.memo ?? "—"}</Table.Td>
                        <Table.Td>${formatUsd(d.amount)}</Table.Td>
                        <Table.Td>{accountLabel(d)}</Table.Td>
                        <Table.Td>
                          <Button type="button" size="xs" color="gray" variant="subtle" disabled={depositSaving} onClick={() => void removeDeposit(d.id)}>
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
                      <Table.Th>Match</Table.Th>
                      <Table.Th w={90} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(detail.suggestedDeposits ?? []).map((d) => (
                      <Table.Tr key={d.id}>
                        <Table.Td>
                          <Anchor component={Link} to={depositWindowLink(d.accountId, detail.payDate ?? detail.payPeriodEnd ?? d.txnDate)}>
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
                          <Button type="button" size="xs" disabled={depositSaving} onClick={() => void confirmDeposit(d.id)}>
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
                Use "Search ledger…" to link manually.
              </Text>
            ) : null}
          </Paper>

          {/* Edit mode panel */}
          <Collapse in={editMode}>
            <Stack gap={10}>
              <Paper withBorder p="md">
                <Title order={5} mb="sm">Edit amounts</Title>
                <Text c="dimmed" size="xs" mb="sm">Click ✏ to correct extracted values. Line item edits cascade to summary columns.</Text>
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

              <Paper withBorder p="md">
                <Group justify="space-between" mb={nonEmptySections.length > 0 ? "xs" : 0}>
                  <Title order={5} m={0}>Edit line items</Title>
                  {!addFormOpen ? (
                    <Button type="button" variant="default" size="xs" onClick={() => { setAddFormOpen(true); setAddError(null); }}>
                      + Add row
                    </Button>
                  ) : null}
                </Group>
                {nonEmptySections.length === 0 ? (
                  <Text c="dimmed" size="sm" mt="xs" mb="sm">No line items yet. Use "+ Add row" to enter individual earnings and deduction rows.</Text>
                ) : null}
                {nonEmptySections.map((section) => (
                  <LineItemsSection key={section} section={section} rows={mergedLineItems![section]} ctx={liCtx} />
                ))}
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
            </Stack>
          </Collapse>

          {/* Stub info (collapsible) */}
          <div
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 9,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setStubInfoOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "10px 16px",
                width: "100%",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-muted)",
                fontSize: 12.5,
                minHeight: 44,
              }}
            >
              {stubInfoOpen ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
              Payslip details
            </button>
            <Collapse in={stubInfoOpen}>
              <div style={{ padding: "0 16px 14px", fontSize: 12.5 }}>
                <Stack gap={5}>
                  <Group gap={8}>
                    <Text fw={600} miw={100} size="sm">Pay period</Text>
                    <Text size="sm">{periodLabel(detail)}</Text>
                  </Group>
                  <Group gap={8}>
                    <Text fw={600} miw={100} size="sm">Pay date</Text>
                    <Text size="sm">{detail.payDate ?? "—"}</Text>
                  </Group>
                  <Group gap={8}>
                    <Text fw={600} miw={100} size="sm">Hours worked</Text>
                    <Text size="sm">
                      {detail.hoursOrDaysCurrent ?? "—"}
                      {detail.hoursOrDaysYtd != null ? ` · YTD: ${detail.hoursOrDaysYtd}` : ""}
                    </Text>
                  </Group>
                  {detail.employmentRate != null ? (
                    <Group gap={8}>
                      <Text fw={600} miw={100} size="sm">Salary / Rate</Text>
                      <Text size="sm">
                        {formatMoney(detail.employmentRate)}
                        {detail.employmentRateType ? ` (${detail.employmentRateType})` : ""}
                      </Text>
                    </Group>
                  ) : null}
                  <Group gap={8}>
                    <Text fw={600} miw={100} size="sm">File</Text>
                    <Text size="sm">{detail.fileName}</Text>
                  </Group>
                  <Group gap={8}>
                    <Text fw={600} miw={100} size="sm">Uploaded</Text>
                    <Text size="sm">{detail.createdAt}</Text>
                  </Group>
                  <Group gap={8}>
                    <Text fw={600} miw={100} size="sm">Parser</Text>
                    <Code>{detail.parserProfileId}</Code>
                  </Group>
                  {detail.importFileId ? (
                    <Group gap={8}>
                      <Text fw={600} miw={100} size="sm">Import file</Text>
                      <Code>{detail.importFileId}</Code>
                    </Group>
                  ) : null}
                </Stack>
              </div>
            </Collapse>
          </div>

          {/* Parser diagnostics */}
          <div
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 9,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setDiagnosticsOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "10px 16px",
                width: "100%",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-muted)",
                fontSize: 12.5,
                minHeight: 44,
              }}
            >
              {diagnosticsOpen ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
              Parser diagnostics (raw JSON)
            </button>
            <Collapse in={diagnosticsOpen}>
              <Box p="md">
                <Code block>{JSON.stringify(detail.rawExtractJson, null, 2)}</Code>
              </Box>
            </Collapse>
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

      <Modal opened={searchOpen} onClose={() => setSearchOpen(false)} title="Link bank deposit" size="xl">
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
                  <Table.Td>{t.accountMask ? `${t.institution} ···${t.accountMask}` : t.institution}</Table.Td>
                  <Table.Td>
                    <Button type="button" size="xs" disabled={depositSaving} onClick={() => void confirmDeposit(t.id)}>
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
          <Text c="dimmed" size="sm">Type to search transactions. Only credit transactions are shown.</Text>
        )}
      </Modal>
    </Stack>
  );
}
