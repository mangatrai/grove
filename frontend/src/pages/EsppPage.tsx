import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { Navigate } from "react-router-dom";

import { apiFetch, apiJson, useAuthToken } from "../api";
import { GrovePageLoader } from "../components/GroveLoader";
import { formatUsd } from "../utils/format";

const T = {
  pageBg: "#efebe3",
  surface: "#fdfcfb",
  surfaceAlt: "#f5f0e8",
  border: "#ddd6ce",
  text: "#1c1917",
  textMuted: "#78716c",
  forest: "#2d6a4f",
  forest2: "#4a8a6e",
  gold: "#c8860a",
  terracotta: "#8b3a26",
  sage: "#7a8a6e",
  accentSub: "#ebf5ef",
  goldSub: "#fef6e4",
  terrSub: "#f9ece8",
  shadow: "0 2px 12px rgba(28,25,23,0.07),0 1px 3px rgba(28,25,23,0.05)",
};

type EsppSale = {
  id: string;
  batchId: string;
  saleDate: string;
  sharesSold: number;
  salePricePerShare: number;
  proceeds: number;
  ordinaryIncome: number;
  capGainLoss: number;
};

type EsppBatch = {
  id: string;
  purchaseDate: string;
  sharesGranted: number;
  fmvPerShare: number;
  costBasisPerShare: number;
  discountPerShare: number;
  sharesTransferred: number;
  sharesSold: number;
  held: number;
  status: "Unsold" | "Partially Sold" | "Fully Sold";
  sales: EsppSale[];
};

type EsppSummary = {
  year: number;
  sharesPurchased: number;
  sharesTransferred: number;
  sharesSold: number;
  totalInvested: number;
  discountReceivedYtd: number;
  saleProceeds: number;
  realizedGainLoss: number;
  ordinaryIncomeYtd: number;
  capGainLossYtd: number;
};

type SaleRow = { id: number; batchId: string; qty: string; price: string };

const mono: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

function formatSignedUsd(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}$${formatUsd(Math.abs(n))}`;
}

function formatShares(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptySummary(year: number): EsppSummary {
  return {
    year,
    sharesPurchased: 0,
    sharesTransferred: 0,
    sharesSold: 0,
    totalInvested: 0,
    discountReceivedYtd: 0,
    saleProceeds: 0,
    realizedGainLoss: 0,
    ordinaryIncomeYtd: 0,
    capGainLossYtd: 0,
  };
}

function statusBadgeStyle(status: EsppBatch["status"]): { color: string; background: string } {
  switch (status) {
    case "Unsold":
      return { color: T.sage, background: T.surfaceAlt };
    case "Partially Sold":
      return { color: T.gold, background: T.goldSub };
    case "Fully Sold":
      return { color: T.forest, background: T.accentSub };
  }
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "pos" | "neg" | "gold" | "neu";
}) {
  const toneColor =
    tone === "pos" ? T.forest : tone === "neg" ? T.terracotta : tone === "gold" ? T.gold : T.text;
  const toneBg =
    tone === "pos"
      ? T.accentSub
      : tone === "neg"
        ? T.terrSub
        : tone === "gold"
          ? T.goldSub
          : "transparent";

  return (
    <div
      style={{
        padding: "10px 12px",
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        minHeight: 72,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: T.textMuted,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...mono,
          fontSize: 18,
          fontWeight: 700,
          color: toneColor,
          background: toneBg,
          display: "inline-block",
          padding: toneBg === "transparent" ? 0 : "2px 6px",
          borderRadius: 4,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>{sub}</div>
      ) : null}
    </div>
  );
}

function YearSelector({
  year,
  onPrev,
  onNext,
  min,
  max,
}: {
  year: number;
  onPrev: () => void;
  onNext: () => void;
  min: number;
  max: number;
}) {
  return (
    <Group gap={4}>
      <ActionIcon variant="subtle" disabled={year <= min} onClick={onPrev} aria-label="Previous year">
        ‹
      </ActionIcon>
      <Text
        fw={700}
        ff="Inter Tight, Inter, sans-serif"
        fz={15}
        style={{
          padding: "4px 16px",
          borderRadius: 999,
          border: `1px solid ${T.border}`,
          background: T.pageBg,
        }}
      >
        {year}
      </Text>
      <ActionIcon variant="subtle" disabled={year >= max} onClick={onNext} aria-label="Next year">
        ›
      </ActionIcon>
    </Group>
  );
}

function SaleHistoryTable({ sales }: { sales: EsppSale[] }) {
  if (sales.length === 0) {
    return (
      <Text size="sm" c="dimmed" py="xs">
        No sales recorded for this batch.
      </Text>
    );
  }

  return (
    <Table horizontalSpacing="sm" verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Sale Date</Table.Th>
          <Table.Th>Shares Sold</Table.Th>
          <Table.Th>Sale Price / sh</Table.Th>
          <Table.Th>Proceeds</Table.Th>
          <Table.Th>Ordinary Income</Table.Th>
          <Table.Th>Cap Gain / Loss</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sales.map((sale) => (
          <Table.Tr key={sale.id}>
            <Table.Td>{sale.saleDate}</Table.Td>
            <Table.Td style={mono}>{formatShares(sale.sharesSold)}</Table.Td>
            <Table.Td style={mono}>${formatUsd(sale.salePricePerShare)}</Table.Td>
            <Table.Td style={mono}>${formatUsd(sale.proceeds)}</Table.Td>
            <Table.Td style={{ ...mono, color: T.gold }}>${formatUsd(sale.ordinaryIncome)}</Table.Td>
            <Table.Td
              style={{
                ...mono,
                color: sale.capGainLoss >= 0 ? T.forest : T.terracotta,
              }}
            >
              {formatSignedUsd(sale.capGainLoss)}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function FileDropZone({
  label,
  hint,
  accept,
  file,
  onFile,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFile(next: File | null) {
    if (!next) {
      onFile(null);
      return;
    }
    const ext = accept.replace(".", "").toLowerCase();
    if (!next.name.toLowerCase().endsWith(`.${ext}`)) {
      return;
    }
    onFile(next);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0] ?? null;
    pickFile(dropped);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{
        flex: 1,
        minHeight: 140,
        padding: 16,
        borderRadius: 8,
        border: `2px dashed ${dragOver ? T.forest : T.border}`,
        background: dragOver ? T.accentSub : T.surfaceAlt,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        textAlign: "center",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
      />
      <IconUpload size={22} color={T.forest} stroke={1.5} />
      <Text fw={600} size="sm">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        {hint}
      </Text>
      {file ? (
        <Group gap={6} mt={4}>
          <Text size="xs" fw={500} style={{ ...mono }}>
            {file.name}
          </Text>
          <ActionIcon
            size="xs"
            variant="subtle"
            aria-label={`Remove ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
              if (inputRef.current) {
                inputRef.current.value = "";
              }
            }}
          >
            <IconX size={12} />
          </ActionIcon>
        </Group>
      ) : (
        <Text size="xs" c="dimmed">
          Drop file or click to browse
        </Text>
      )}
    </div>
  );
}

function ImportModal({
  opened,
  onClose,
  onSuccess,
}: {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) {
      setPdfFile(null);
      setCsvFile(null);
      setError(null);
      setSubmitting(false);
    }
  }, [opened]);

  const canSubmit = Boolean(pdfFile || csvFile);

  async function handleImport() {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    const formData = new FormData();
    if (pdfFile) {
      formData.append("pdf", pdfFile);
    }
    if (csvFile) {
      formData.append("csv", csvFile);
    }
    try {
      const res = await apiFetch("/espp/import", { method: "POST", body: formData });
      if (!res.ok) {
        const text = await res.text();
        let message = text || res.statusText;
        try {
          const parsed = JSON.parse(text) as { message?: string };
          if (parsed.message) {
            message = parsed.message;
          }
        } catch {
          /* use raw */
        }
        throw new Error(message);
      }
      onClose();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Import ESPP Data" size="md">
      <Stack gap="md">
        <Group align="stretch" gap="md" wrap="nowrap">
          <FileDropZone
            label="Purchase PDF"
            hint="EquatePlus purchase confirmation PDF"
            accept=".pdf"
            file={pdfFile}
            onFile={setPdfFile}
          />
          <FileDropZone
            label="Allocation CSV"
            hint="EquatePlus allocation export (CSV)"
            accept=".csv"
            file={csvFile}
            onFile={setCsvFile}
          />
        </Group>
        {error ? (
          <Alert variant="light" color="red">
            {error}
          </Alert>
        ) : null}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleImport()} loading={submitting} disabled={!canSubmit}>
            Import
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RecordSaleModal({
  opened,
  onClose,
  batches,
  onSuccess,
}: {
  opened: boolean;
  onClose: () => void;
  batches: EsppBatch[];
  onSuccess: () => void;
}) {
  const availableBatches = useMemo(() => batches.filter((b) => b.held > 0), [batches]);
  const defaultBatchId = availableBatches[0]?.id ?? "";

  const [saleDate, setSaleDate] = useState(todayIso());
  const [rows, setRows] = useState<SaleRow[]>([{ id: 1, batchId: defaultBatchId, qty: "", price: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextRowId = useRef(2);

  useEffect(() => {
    if (!opened) {
      setSaleDate(todayIso());
      setRows([{ id: 1, batchId: defaultBatchId, qty: "", price: "" }]);
      setError(null);
      setSubmitting(false);
      nextRowId.current = 2;
    }
  }, [opened, defaultBatchId]);

  function updateRow(id: number, patch: Partial<SaleRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { id: nextRowId.current++, batchId: defaultBatchId, qty: "", price: "" },
    ]);
  }

  function removeRow(id: number) {
    if (rows.length <= 1) {
      return;
    }
    setRows((prev) => prev.filter((row) => row.id !== id));
  }

  const batchOptions = availableBatches.map((b) => ({
    value: b.id,
    label: `${b.purchaseDate} — ${formatShares(b.held)} sh avail.`,
  }));

  function getBatch(batchId: string): EsppBatch | undefined {
    return availableBatches.find((b) => b.id === batchId);
  }

  function validateRows(): boolean {
    return rows.every((row) => {
      const qty = Number(row.qty);
      const price = Number(row.price);
      return row.batchId && qty > 0 && price > 0;
    });
  }

  async function handleSubmit() {
    if (!validateRows()) {
      setError("Each row needs a batch, shares > 0, and price > 0.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiJson<EsppSale[]>("/espp/sales", {
        method: "POST",
        body: JSON.stringify({
          saleDate,
          rows: rows.map((row) => ({
            batchId: row.batchId,
            sharesSold: Number(row.qty),
            salePricePerShare: Number(row.price),
          })),
        }),
      });
      onClose();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record sale");
    } finally {
      setSubmitting(false);
    }
  }

  const gridTemplate = "7fr 90px 120px 120px 110px 120px 34px";

  return (
    <Modal opened={opened} onClose={onClose} title="Record Sale" size="lg">
      <Stack gap="md">
        <div>
          <Text size="sm" fw={500} mb={4}>
            Sale Date
          </Text>
          <input
            type="date"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: `1px solid ${T.border}`,
              background: T.surface,
              fontFamily: "inherit",
            }}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridTemplate,
            gap: 8,
            alignItems: "center",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: T.textMuted,
            fontWeight: 600,
          }}
        >
          <span>Batch</span>
          <span>Shares</span>
          <span>Price / share</span>
          <span>Proceeds</span>
          <span>OI</span>
          <span>Cap Gain/Loss</span>
          <span />
        </div>

        {rows.map((row) => {
          const batch = getBatch(row.batchId);
          const shares = Number(row.qty) || 0;
          const price = Number(row.price) || 0;
          const proceeds = shares * price;
          const oi = batch ? batch.discountPerShare * shares : 0;
          const capGain = batch ? (price - batch.fmvPerShare) * shares : 0;

          return (
            <div
              key={row.id}
              style={{
                display: "grid",
                gridTemplateColumns: gridTemplate,
                gap: 8,
                alignItems: "center",
              }}
            >
              <Select
                data={batchOptions}
                value={row.batchId || null}
                onChange={(v) => updateRow(row.id, { batchId: v ?? "" })}
                placeholder="Select batch"
                searchable={false}
              />
              <NumberInput
                min={1}
                step={1}
                allowDecimal={false}
                value={row.qty === "" ? "" : Number(row.qty)}
                onChange={(v) => updateRow(row.id, { qty: v === "" || v == null ? "" : String(v) })}
              />
              <NumberInput
                min={0}
                step={0.01}
                decimalScale={2}
                value={row.price === "" ? "" : Number(row.price)}
                onChange={(v) => updateRow(row.id, { price: v === "" || v == null ? "" : String(v) })}
              />
              <Text size="sm" style={mono}>
                ${formatUsd(proceeds)}
              </Text>
              <Text size="sm" style={{ ...mono, color: T.gold }}>
                ${formatUsd(oi)}
              </Text>
              <Text
                size="sm"
                style={{ ...mono, color: capGain >= 0 ? T.forest : T.terracotta }}
              >
                {formatSignedUsd(capGain)}
              </Text>
              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={rows.length <= 1}
                onClick={() => removeRow(row.id)}
                aria-label="Remove row"
              >
                <IconX size={16} />
              </ActionIcon>
            </div>
          );
        })}

        <Button variant="light" onClick={addRow} style={{ alignSelf: "flex-start" }}>
          + Add Row
        </Button>

        {error ? (
          <Alert variant="light" color="red">
            {error}
          </Alert>
        ) : null}

        <Group justify="space-between" align="center" mt="xs">
          <Text size="xs" c="dimmed">
            Ordinary income &amp; capital gain/loss calculated on submit.
          </Text>
          <Group gap="sm">
            <Button variant="default" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} loading={submitting} disabled={!validateRows()}>
              Record Sales
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

export function EsppPage() {
  const token = useAuthToken();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [batches, setBatches] = useState<EsppBatch[]>([]);
  const [summary, setSummary] = useState<EsppSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);

  const loadData = useCallback(() => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      apiJson<EsppBatch[]>(`/espp/batches?year=${year}`),
      apiJson<EsppSummary>(`/espp/summary?year=${year}`),
    ])
      .then(([b, s]) => {
        setBatches(b);
        setSummary(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load ESPP data"))
      .finally(() => setLoading(false));
  }, [token, year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summaryData = summary ?? emptySummary(year);
  const batchesWithHeld = useMemo(() => batches.filter((b) => b.held > 0), [batches]);
  const canRecordSale = batchesWithHeld.length > 0;

  function toggleExpanded(batchId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) {
        next.delete(batchId);
      } else {
        next.add(batchId);
      }
      return next;
    });
  }

  if (!token) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return <GrovePageLoader label="Loading ESPP data…" />;
  }

  return (
    <Stack gap="lg" p="lg" style={{ background: T.pageBg, minHeight: "100%" }}>
      <Group justify="space-between" align="center">
        <Title order={2}>ESPP</Title>
        <Group gap="sm">
          <Button variant="light" leftSection={<IconUpload size={16} />} onClick={() => setImportOpen(true)}>
            Import
          </Button>
          <Button disabled={!canRecordSale} onClick={() => setSaleOpen(true)}>
            Record Sale
          </Button>
        </Group>
      </Group>

      {error ? (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      ) : null}

      <Paper
        p="md"
        radius="md"
        style={{ background: T.surface, border: `1px solid ${T.border}`, boxShadow: T.shadow }}
      >
        <Group justify="space-between" align="center" mb="md" wrap="wrap">
          <YearSelector
            year={year}
            min={2025}
            max={currentYear + 1}
            onPrev={() => setYear((y) => Math.max(2025, y - 1))}
            onNext={() => setYear((y) => Math.min(currentYear + 1, y + 1))}
          />
          <Text size="sm" c="dimmed">
            Company Stock (ESPP) · {year} year summary
          </Text>
        </Group>

        <SimpleGrid cols={5} spacing="sm">
          <StatCard label="Shares Purchased YTD" value={formatShares(summaryData.sharesPurchased)} />
          <StatCard label="Transferred to Broker" value={formatShares(summaryData.sharesTransferred)} />
          <StatCard
            label="Outstanding (EquatePlus)"
            value={formatShares(summaryData.sharesTransferred - summaryData.sharesSold)}
          />
          <StatCard label="Shares Sold YTD" value={formatShares(summaryData.sharesSold)} />
          <StatCard label="Total Invested" value={`$${formatUsd(summaryData.totalInvested)}`} />
          <StatCard
            label="Discount Received YTD"
            value={`$${formatUsd(summaryData.discountReceivedYtd)}`}
            tone="gold"
            sub="FMV − cost basis × shares"
          />
          <StatCard label="Sale Proceeds YTD" value={`$${formatUsd(summaryData.saleProceeds)}`} />
          <StatCard
            label="Realized Gain / Loss"
            value={formatSignedUsd(summaryData.realizedGainLoss)}
            tone={summaryData.realizedGainLoss >= 0 ? "pos" : "neg"}
          />
          <StatCard
            label="Ordinary Income YTD"
            value={`$${formatUsd(summaryData.ordinaryIncomeYtd)}`}
            sub="discount × shares sold"
          />
          <StatCard
            label="Capital Gain / Loss"
            value={formatSignedUsd(summaryData.capGainLossYtd)}
            tone={summaryData.capGainLossYtd >= 0 ? "pos" : "neg"}
            sub="sale price vs FMV at purchase"
          />
        </SimpleGrid>
      </Paper>

      <Paper
        radius="md"
        style={{ background: T.surface, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: "hidden" }}
      >
        <Group
          justify="space-between"
          align="center"
          px="md"
          py="sm"
          style={{ borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }}
        >
          <Text fw={600}>Purchase Batches</Text>
          <Text size="sm" c="dimmed">
            {batches.length} batches · click a row to expand sale history
          </Text>
        </Group>

        {batches.length === 0 ? (
          <Text c="dimmed" p="md">
            No ESPP batches yet. Import a purchase PDF or allocation CSV to get started.
          </Text>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <Table horizontalSpacing="sm" verticalSpacing="xs" style={{ minWidth: 900 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Purchase Date</Table.Th>
                  <Table.Th>Shares</Table.Th>
                  <Table.Th>FMV / sh</Table.Th>
                  <Table.Th>Cost / sh</Table.Th>
                  <Table.Th>Disc / sh</Table.Th>
                  <Table.Th>Transferred</Table.Th>
                  <Table.Th>Outstanding</Table.Th>
                  <Table.Th>Sold</Table.Th>
                  <Table.Th>Held</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th w={28} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {batches.map((batch) => {
                  const expanded = expandedIds.has(batch.id);
                  const outstanding = batch.sharesGranted - batch.sharesTransferred;
                  const badge = statusBadgeStyle(batch.status);

                  return (
                    <Fragment key={batch.id}>
                      <Table.Tr
                        onClick={() => toggleExpanded(batch.id)}
                        style={{ cursor: "pointer" }}
                      >
                        <Table.Td>{batch.purchaseDate}</Table.Td>
                        <Table.Td style={mono}>{formatShares(batch.sharesGranted)}</Table.Td>
                        <Table.Td style={mono}>${formatUsd(batch.fmvPerShare)}</Table.Td>
                        <Table.Td style={mono}>${formatUsd(batch.costBasisPerShare)}</Table.Td>
                        <Table.Td style={{ ...mono, color: T.gold }}>
                          ${formatUsd(batch.discountPerShare)}
                        </Table.Td>
                        <Table.Td style={mono}>{formatShares(batch.sharesTransferred)}</Table.Td>
                        <Table.Td style={mono}>{formatShares(outstanding)}</Table.Td>
                        <Table.Td style={mono}>{formatShares(batch.sharesSold)}</Table.Td>
                        <Table.Td style={mono}>{formatShares(batch.held)}</Table.Td>
                        <Table.Td>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 600,
                              color: badge.color,
                              background: badge.background,
                            }}
                          >
                            {batch.status}
                          </span>
                        </Table.Td>
                        <Table.Td>
                          {expanded ? (
                            <IconChevronDown size={16} color={T.textMuted} />
                          ) : (
                            <IconChevronRight size={16} color={T.textMuted} />
                          )}
                        </Table.Td>
                      </Table.Tr>
                      {expanded ? (
                        <Table.Tr>
                          <Table.Td colSpan={11} style={{ background: T.accentSub, padding: "12px 16px" }}>
                            <Text size="sm" fw={600} mb="xs">
                              Sale History · {batch.purchaseDate} batch · {formatShares(batch.sharesSold)} of{" "}
                              {formatShares(batch.sharesGranted)} shares disposed
                            </Text>
                            <SaleHistoryTable sales={batch.sales} />
                          </Table.Td>
                        </Table.Tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Paper>

      <ImportModal opened={importOpen} onClose={() => setImportOpen(false)} onSuccess={loadData} />
      <RecordSaleModal
        opened={saleOpen}
        onClose={() => setSaleOpen(false)}
        batches={batches}
        onSuccess={loadData}
      />
    </Stack>
  );
}
