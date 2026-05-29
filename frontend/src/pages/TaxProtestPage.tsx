import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Drawer,
  Grid,
  Group,
  List,
  Paper,
  Progress,
  Select,
  Stack,
  Stepper,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconCalendarEvent,
  IconFileText,
  IconMessage,
  IconPaperclip,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { apiJson, getToken, useAuthToken } from "../api";
import { GrovePageLoader } from "../components/GroveLoader";

type ProtestStatus = "not_filed" | "filed" | "informal" | "arb" | "resolved";
type AttachmentType = "pdf" | "url" | "text";

type PropertyRecord = {
  id: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  propertyUse: "primary" | "rental" | "vacation" | null;
  latestValueUsd: number | null;
  latestValueAsOf: string | null;
  valuationDetail: unknown | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  monthlyRent: number | null;
  propertyNotes: string | null;
};

type ConversationTurn = {
  role: "user" | "assistant" | "tool";
  content: string;
  ts: string;
  attachmentType?: AttachmentType;
};

type StrategyJson = {
  caseStrength: number;
  targetValueUsd: number;
  primaryStrategy: string;
  draftArguments: string[];
  redFlags: string[];
};

type Worksheet = {
  id: string;
  propertyId: string;
  taxYear: number;
  status: ProtestStatus;
  hearingDate: string | null;
  conversationJson: ConversationTurn[];
  strategyJson: StrategyJson | null;
};

type CADComp = {
  dcadPropertyId: string;
  addressLine1: string | null;
  city: string | null;
  assessedValueUsd: number | null;
  marketValueUsd: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  perSqftUsd: number | null;
};

type SoldComp = {
  address: string | null;
  city: string | null;
  state: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  soldPrice: number | null;
  soldDate: string | null;
  pricePerSqft: number | null;
  listPrice: number | null;
};

type Toast = { id: number; color: "green" | "red" | "yellow"; message: string };
type ChatTurnUI = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  attachmentType?: AttachmentType;
  optimistic?: boolean;
};

type PendingAttachment = {
  type: AttachmentType;
  text: string;
  label: string;
};

type PropertiesResponse = { properties: PropertyRecord[] };
type PropertyResponse = { property: PropertyRecord };
type WorksheetResponse = { worksheet: Worksheet };
type CompsResponse = { comps: CADComp[] };
type SoldCompsResponse = { comps: SoldComp[] };
type ChatResponse = { assistantMessage: string; strategyUpdated: boolean; compsAdded: number; soldCompsRefreshed: boolean };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function ppsf(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(0)}/sf`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(iso: string): number | null {
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.ceil((dt.getTime() - Date.now()) / 86_400_000);
}

function statusIndex(status: ProtestStatus): number {
  if (status === "filed") return 1;
  if (status === "informal") return 2;
  if (status === "arb") return 3;
  if (status === "resolved") return 4;
  return 0;
}

function markdownLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""));
}

function vsSubjectColor(compPpsf: number | null, subjectPpsf: number | null): string | undefined {
  if (compPpsf == null || subjectPpsf == null || subjectPpsf === 0) return undefined;
  return compPpsf < subjectPpsf ? "green" : "red";
}

function vsSubjectLabel(compPpsf: number | null, subjectPpsf: number | null): string {
  if (compPpsf == null || subjectPpsf == null || subjectPpsf === 0) return "—";
  const diff = ((compPpsf / subjectPpsf) - 1) * 100;
  return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`;
}

export function TaxProtestPage() {
  const token = useAuthToken();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toastSeq, setToastSeq] = useState(1);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [comps, setComps] = useState<CADComp[]>([]);
  const [soldComps, setSoldComps] = useState<SoldComp[]>([]);
  const [year, setYear] = useState<string>("2026");
  const [chat, setChat] = useState<ChatTurnUI[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [hearingDraft, setHearingDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<ProtestStatus>("not_filed");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addToast = useCallback(
    (color: Toast["color"], messageText: string) => {
      const next: Toast = { id: toastSeq, color, message: messageText };
      setToastSeq((n) => n + 1);
      setToasts((prev) => [...prev, next]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== next.id));
      }, 3000);
    },
    [toastSeq]
  );

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propsRes = await apiJson<PropertiesResponse>("/household/properties");
      const props = propsRes.properties ?? [];
      setProperties(props);
      if (props.length === 0) {
        setPropertyId(null);
        setProperty(null);
        setWorksheet(null);
        setComps([]);
        setSoldComps([]);
        setChat([]);
        setLoading(false);
        return;
      }
      const qpProperty = searchParams.get("property");
      const chosen =
        qpProperty && props.some((p) => p.id === qpProperty) ? qpProperty : props[0].id;
      setPropertyId(chosen);
      if (!qpProperty || qpProperty !== chosen) {
        setSearchParams({ property: chosen });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load properties");
    } finally {
      setLoading(false);
    }
  }, [searchParams, setSearchParams]);

  const loadPropertyAndWorksheet = useCallback(async (pid: string, selectedYear: number) => {
    setError(null);
    try {
      const [propRes, wsRes, compsRes, soldCompsRes] = await Promise.all([
        apiJson<PropertyResponse>(`/household/properties/${encodeURIComponent(pid)}`),
        apiJson<WorksheetResponse>(
          `/api/protest/${encodeURIComponent(pid)}/worksheet?year=${selectedYear}`
        ),
        apiJson<CompsResponse>(
          `/api/protest/${encodeURIComponent(pid)}/comps?year=${selectedYear}`
        ).catch(() => ({ comps: [] as CADComp[] })),
        apiJson<SoldCompsResponse>(
          `/api/protest/${encodeURIComponent(pid)}/sold-comps`
        ).catch(() => ({ comps: [] as SoldComp[] }))
      ]);
      setProperty(propRes.property);
      setWorksheet(wsRes.worksheet);
      setComps(compsRes.comps);
      setSoldComps(soldCompsRes.comps);
      setHearingDraft(wsRes.worksheet.hearingDate ?? "");
      setStatusDraft(wsRes.worksheet.status);
      const turns: ChatTurnUI[] = (wsRes.worksheet.conversationJson ?? [])
        .filter((t) => t.role === "user" || t.role === "assistant")
        .map((t, idx) => ({
          id: `${wsRes.worksheet.id}-${idx}-${t.ts}`,
          role: t.role as "user" | "assistant",
          content: t.content,
          ts: t.ts,
          attachmentType: t.attachmentType
        }));
      setChat(turns);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worksheet");
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadBase();
  }, [token, loadBase]);

  useEffect(() => {
    if (!token || !propertyId) return;
    void loadPropertyAndWorksheet(propertyId, Number(year));
  }, [token, propertyId, year, loadPropertyAndWorksheet]);

  useEffect(() => {
    if (chatOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [chat, thinking, chatOpen]);

  const subject = useMemo(
    () => asRecord(asRecord(property?.valuationDetail)?.subject),
    [property?.valuationDetail]
  );
  const estimate = useMemo(
    () => asRecord(asRecord(property?.valuationDetail)?.estimate),
    [property?.valuationDetail]
  );
  const assessment = useMemo(
    () => asRecord(asRecord(property?.valuationDetail)?.taxCurrent),
    [property?.valuationDetail]
  );

  const cadAssessed = asNumber(assessment?.assessedValue);
  const avm = asNumber(estimate?.value) ?? property?.latestValueUsd ?? null;
  const subjectSqft = asNumber(subject?.sqFt);
  const overPct =
    cadAssessed != null && avm != null && avm > 0
      ? ((cadAssessed / avm) - 1) * 100
      : null;
  const overAmt = cadAssessed != null && avm != null ? cadAssessed - avm : null;
  const annualSavings =
    overAmt != null &&
    overAmt > 0 &&
    (property?.state ?? "").toUpperCase() === "TX"
      ? overAmt * 0.02
      : null;

  const subjectAssessedPpsf =
    cadAssessed != null && subjectSqft != null && subjectSqft > 0
      ? cadAssessed / subjectSqft
      : null;
  const subjectMarketPpsf =
    avm != null && subjectSqft != null && subjectSqft > 0 ? avm / subjectSqft : null;

  const hearingDays =
    worksheet?.hearingDate != null ? daysUntil(worksheet.hearingDate) : null;

  const send = useCallback(async () => {
    if (!propertyId || !worksheet) return;
    const bodyText = message.trim();
    if (!bodyText) return;
    const optimistic: ChatTurnUI = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      content: bodyText,
      ts: new Date().toISOString(),
      attachmentType: pendingAttachment?.type,
      optimistic: true
    };
    setChat((prev) => [...prev, optimistic]);
    setMessage("");
    const attachment = pendingAttachment;
    setPendingAttachment(null);
    setSending(true);
    setThinking(true);
    try {
      const res = await apiJson<ChatResponse>(
        `/api/protest/${encodeURIComponent(propertyId)}/chat`,
        {
          method: "POST",
          body: JSON.stringify({
            message: bodyText,
            attachmentText: attachment?.text,
            attachmentType: attachment?.type,
            year: Number(year)
          })
        }
      );
      setChat((prev) => [
        ...prev.map((t) => (t.id === optimistic.id ? { ...t, optimistic: false } : t)),
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: res.assistantMessage,
          ts: new Date().toISOString()
        }
      ]);
      if (res.strategyUpdated) {
        const wsRes = await apiJson<WorksheetResponse>(
          `/api/protest/${encodeURIComponent(propertyId)}/worksheet?year=${Number(year)}`
        );
        setWorksheet(wsRes.worksheet);
      }
      if (res.compsAdded > 0) {
        addToast("green", `Fetched ${res.compsAdded} comparable properties from DCAD.`);
        const compsRes = await apiJson<CompsResponse>(
          `/api/protest/${encodeURIComponent(propertyId)}/comps?year=${Number(year)}`
        ).catch(() => ({ comps: [] as CADComp[] }));
        setComps(compsRes.comps);
      }
      if (res.soldCompsRefreshed) {
        addToast("green", "Redfin data refreshed — comparable sold prices updated.");
        const soldCompsRes = await apiJson<SoldCompsResponse>(
          `/api/protest/${encodeURIComponent(propertyId)}/sold-comps`
        ).catch(() => ({ comps: [] as SoldComp[] }));
        setSoldComps(soldCompsRes.comps);
      }
    } catch (err) {
      setChat((prev) => prev.filter((t) => t.id !== optimistic.id));
      addToast("red", err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
      setThinking(false);
    }
  }, [propertyId, worksheet, message, pendingAttachment, year, addToast]);

  const updateWorksheet = useCallback(
    async (patch: { status?: ProtestStatus; hearingDate?: string | null }) => {
      if (!propertyId || !worksheet) return;
      try {
        const res = await apiJson<WorksheetResponse>(
          `/api/protest/${encodeURIComponent(propertyId)}/worksheet`,
          {
            method: "PATCH",
            body: JSON.stringify({ year: Number(year), ...patch })
          }
        );
        setWorksheet(res.worksheet);
        setStatusDraft(res.worksheet.status);
        setHearingDraft(res.worksheet.hearingDate ?? "");
      } catch (err) {
        addToast("red", err instanceof Error ? err.message : "Failed to update worksheet");
      }
    },
    [propertyId, worksheet, year, addToast]
  );

  const onPickTextFile = useCallback(
    (file: File) => {
      if (file.name.toLowerCase().endsWith(".pdf")) {
        addToast(
          "yellow",
          "PDF extraction coming soon — paste the text content from your PDF for now"
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        setPendingAttachment({ type: "text", text, label: file.name });
      };
      reader.onerror = () => addToast("red", "Could not read attachment");
      reader.readAsText(file);
    },
    [addToast]
  );

  const handleDownload = useCallback(async () => {
    if (!propertyId) return;
    setDownloading(true);
    try {
      const tok = getToken();
      const res = await fetch(`/api/protest/${propertyId}/evidence-packet?year=${year}`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {}
      });
      if (!res.ok) throw new Error(`PDF generation failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ARB_Evidence_${year}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast("red", err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setDownloading(false);
    }
  }, [propertyId, year, addToast]);

  if (!token) return <Navigate to="/" replace />;
  if (loading) return <GrovePageLoader label="Loading protest assistant…" />;

  const propertyLabel =
    property != null
      ? [property.addressLine1, property.city, property.state].filter(Boolean).join(", ")
      : "No property";

  return (
    <Stack gap="md">
      {/* Toast stack */}
      {toasts.length > 0 ? (
        <Stack
          gap={6}
          style={{ position: "fixed", right: 18, top: 72, zIndex: 2000, width: 340 }}
        >
          {toasts.map((toast) => (
            <Alert
              key={toast.id}
              color={toast.color}
              withCloseButton
              onClose={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            >
              {toast.message}
            </Alert>
          ))}
        </Stack>
      ) : null}

      {error ? <Alert color="red">{error}</Alert> : null}

      {/* Property switcher + year + export */}
      <Group justify="space-between" align="flex-end">
        <Group align="flex-end" gap="sm">
          <Select
            label="Property"
            value={propertyId}
            data={properties.map((p) => ({
              value: p.id,
              label: `${p.addressLine1 ?? "Unnamed"}${p.city ? `, ${p.city}` : ""}`
            }))}
            onChange={(next) => {
              if (!next) return;
              setPropertyId(next);
              setSearchParams({ property: next });
            }}
            w={280}
          />
          <Select
            label="Tax Year"
            value={year}
            onChange={(v) => setYear(v ?? "2026")}
            data={[
              { value: "2024", label: "2024" },
              { value: "2025", label: "2025" },
              { value: "2026", label: "2026" }
            ]}
            w={100}
          />
        </Group>
        <Button
          leftSection={<IconFileText size={16} />}
          variant="default"
          loading={downloading}
          disabled={!propertyId}
          onClick={handleDownload}
        >
          Generate Document
        </Button>
      </Group>

      {/* Deadline banner */}
      {worksheet?.hearingDate != null && hearingDays != null && hearingDays <= 30 ? (
        <Alert
          color={hearingDays <= 7 ? "red" : "yellow"}
          icon={<IconCalendarEvent size={16} />}
          title="Upcoming ARB Hearing"
        >
          {propertyLabel} · {formatDate(worksheet.hearingDate)} ·{" "}
          <strong>{hearingDays} days away</strong>
        </Alert>
      ) : null}

      {/* Signal card */}
      <Card withBorder radius="md" p="md">
        <Stack gap={8}>
          <Group justify="space-between">
            <div>
              <Title order={3} style={{ fontSize: 17 }}>
                {property?.addressLine1 ?? "Select a property"}
              </Title>
              <Text c="dimmed" size="sm">
                {[property?.city, property?.state, property?.zip].filter(Boolean).join(", ")}
              </Text>
            </div>
            {overPct != null ? (
              <Badge
                color={overPct > 3 ? "yellow" : "green"}
                variant="light"
                size="lg"
              >
                {overPct > 0 ? "+" : ""}
                {overPct.toFixed(1)}% vs AVM
              </Badge>
            ) : null}
          </Group>

          <Grid>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">CAD Assessed</Text>
              <Text fw={700} size="sm">{money(cadAssessed)}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">AVM (Redfin)</Text>
              <Text fw={700} size="sm">{money(avm)}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">Est. Annual Savings</Text>
              <Text fw={700} size="sm" c={annualSavings != null && annualSavings > 0 ? "green" : undefined}>
                {annualSavings != null ? money(annualSavings) + "/yr" : "—"}
              </Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">Sqft</Text>
              <Text fw={700} size="sm">
                {subjectSqft != null ? subjectSqft.toLocaleString() : "—"}
              </Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">Beds / Baths</Text>
              <Text fw={700} size="sm">
                {asNumber(subject?.beds) ?? "—"} / {asNumber(subject?.baths) ?? "—"}
              </Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4, md: 2 }}>
              <Text size="xs" c="dimmed">Year Built</Text>
              <Text fw={700} size="sm">{asNumber(subject?.yearBuilt) ?? "—"}</Text>
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>

      {/* Market Value Evidence table — Redfin comparable sold prices */}
      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>Market Value Evidence</Title>
            <Text size="xs" c="dimmed">
              {soldComps.length > 0
                ? `${soldComps.length} Redfin comparable sales`
                : "No Redfin comps loaded"}
            </Text>
          </Group>
          {soldComps.length > 0 ? (
            <>
              <Box style={{ overflowX: "auto" }}>
                <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Address</Table.Th>
                      <Table.Th>City</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Sqft</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Beds</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Baths</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Sold Price</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>$/sqft</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Sold Date</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>vs Subject</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {soldComps.map((comp, idx) => {
                      const color = vsSubjectColor(comp.pricePerSqft, subjectMarketPpsf);
                      return (
                        <Table.Tr key={`${comp.address ?? ""}-${idx}`}>
                          <Table.Td>{comp.address ?? "—"}</Table.Td>
                          <Table.Td>{comp.city ?? "—"}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            {comp.sqft != null ? comp.sqft.toLocaleString() : "—"}
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>{comp.beds ?? "—"}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>{comp.baths ?? "—"}</Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            {comp.soldPrice != null ? (
                              money(comp.soldPrice)
                            ) : comp.listPrice != null ? (
                              <Text size="xs" c="dimmed">Listed: {money(comp.listPrice)}</Text>
                            ) : (
                              "—"
                            )}
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            {ppsf(comp.pricePerSqft)}
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            {comp.soldDate ?? "—"}
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            <Text size="xs" c={color} fw={color ? 600 : undefined}>
                              {vsSubjectLabel(comp.pricePerSqft, subjectMarketPpsf)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                    {/* Subject row */}
                    <Table.Tr style={{ background: "var(--mantine-color-blue-light)" }}>
                      <Table.Td fw={700}>{property?.addressLine1 ?? "Subject"}</Table.Td>
                      <Table.Td fw={700}>{property?.city ?? "—"}</Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {subjectSqft != null ? subjectSqft.toLocaleString() : "—"}
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {asNumber(subject?.beds) ?? "—"}
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {asNumber(subject?.baths) ?? "—"}
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {money(avm)} <Text size="xs" c="dimmed" span>(AVM)</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }} fw={700}>
                        {ppsf(subjectMarketPpsf)}
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>—</Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Badge size="xs" variant="light">Subject</Badge>
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Box>
              <Text size="xs" c="dimmed">
                Comparable sold prices from Redfin. Texas is a non-disclosure state — sold prices may not be available for all properties. Ask the protest assistant to refresh Redfin data or search for additional evidence.
              </Text>
            </>
          ) : (
            <Paper withBorder p="md" radius="md">
              <Stack align="center" gap="xs">
                <Text size="sm" c="dimmed">No Redfin comparable sales loaded.</Text>
                <Text size="xs" c="dimmed" ta="center">
                  Redfin comps load from your property valuation data. Ask the protest assistant to refresh Redfin data.
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconMessage size={14} />}
                  onClick={() => {
                    setMessage("Please refresh my Redfin property data and show me comparable sold prices for market value evidence.");
                    setChatOpen(true);
                  }}
                >
                  Ask AI to refresh Redfin data
                </Button>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Card>

      {/* Unequal Appraisal Evidence table */}
      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>Unequal Appraisal Evidence</Title>
            <Text size="xs" c="dimmed">
              {comps.length > 0 ? `${comps.length} DCAD comparable properties` : "No comps loaded"}
            </Text>
          </Group>
          {comps.length > 0 ? (
            <Box style={{ overflowX: "auto" }}>
              <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Address</Table.Th>
                    <Table.Th>City</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Sqft</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Beds</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Baths</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>CAD Assessed</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>$/sqft</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>vs Subject</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {comps.map((comp) => {
                    const color = vsSubjectColor(comp.perSqftUsd, subjectAssessedPpsf);
                    return (
                      <Table.Tr key={comp.dcadPropertyId}>
                        <Table.Td>{comp.addressLine1 ?? "—"}</Table.Td>
                        <Table.Td>{comp.city ?? "—"}</Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          {comp.sqft != null ? comp.sqft.toLocaleString() : "—"}
                        </Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>{comp.beds ?? "—"}</Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>{comp.baths ?? "—"}</Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          {money(comp.assessedValueUsd)}
                        </Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>{ppsf(comp.perSqftUsd)}</Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          <Text size="xs" c={color} fw={color ? 600 : undefined}>
                            {vsSubjectLabel(comp.perSqftUsd, subjectAssessedPpsf)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                  {/* Subject row */}
                  <Table.Tr style={{ background: "var(--mantine-color-blue-light)" }}>
                    <Table.Td fw={700}>
                      {property?.addressLine1 ?? "Subject"}
                    </Table.Td>
                    <Table.Td fw={700}>{property?.city ?? "—"}</Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {subjectSqft != null ? subjectSqft.toLocaleString() : "—"}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {asNumber(subject?.beds) ?? "—"}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {asNumber(subject?.baths) ?? "—"}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {money(cadAssessed)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }} fw={700}>
                      {ppsf(subjectAssessedPpsf)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>
                      <Badge size="xs" variant="light">Subject</Badge>
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </Box>
          ) : (
            <Paper withBorder p="md" radius="md">
              <Stack align="center" gap="xs">
                <Text size="sm" c="dimmed">No DCAD comparable properties loaded.</Text>
                <Text size="xs" c="dimmed">
                  DCAD comps are fetched automatically for TX properties or can be requested via the protest assistant.
                </Text>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Card>

      {/* Strategy panel — only when AI has generated a strategy */}
      {worksheet?.strategyJson ? (
        <Card withBorder radius="md" p="md">
          <Stack gap="sm">
            <Title order={4}>AI Strategy Analysis</Title>
            <Group gap="xl">
              <div style={{ flex: 1 }}>
                <Text size="xs" c="dimmed" mb={4}>
                  Case strength ({worksheet.strategyJson.caseStrength.toFixed(1)}/10)
                </Text>
                <Progress
                  value={Math.max(
                    0,
                    Math.min(100, (worksheet.strategyJson.caseStrength / 10) * 100)
                  )}
                  color={
                    worksheet.strategyJson.caseStrength >= 7
                      ? "green"
                      : worksheet.strategyJson.caseStrength >= 4
                      ? "yellow"
                      : "red"
                  }
                  size="md"
                />
              </div>
              <div>
                <Text size="xs" c="dimmed">Target Value</Text>
                <Text fw={700}>{money(worksheet.strategyJson.targetValueUsd)}</Text>
              </div>
            </Group>
            <div>
              <Text size="sm" c="dimmed" mb={2}>Primary approach</Text>
              <Text size="sm">{worksheet.strategyJson.primaryStrategy}</Text>
            </div>
            <div>
              <Text size="sm" fw={600} mb={6}>Draft arguments</Text>
              <List size="sm" spacing={4}>
                {worksheet.strategyJson.draftArguments.map((arg, idx) => (
                  <List.Item key={`${idx}-${arg.slice(0, 16)}`}>{arg}</List.Item>
                ))}
              </List>
            </div>
            {worksheet.strategyJson.redFlags.length > 0 ? (
              <Alert color="orange" title="Red flags">
                <List size="sm">
                  {worksheet.strategyJson.redFlags.map((flag, idx) => (
                    <List.Item key={`${idx}-${flag.slice(0, 20)}`}>{flag}</List.Item>
                  ))}
                </List>
              </Alert>
            ) : null}
          </Stack>
        </Card>
      ) : null}

      {/* Protest tracker */}
      <Card withBorder radius="md" p="md">
        <Stack gap="md">
          <Title order={4}>Protest Status</Title>
          <Stepper
            active={worksheet ? statusIndex(worksheet.status) : 0}
            size="xs"
            iconSize={20}
          >
            <Stepper.Step label="Not Filed" />
            <Stepper.Step label="Filed" />
            <Stepper.Step label="Informal Offer" />
            <Stepper.Step label="ARB Hearing" />
            <Stepper.Step label="Resolved" />
          </Stepper>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Select
                label="Update status"
                value={statusDraft}
                data={[
                  { value: "not_filed", label: "Not Filed" },
                  { value: "filed", label: "Filed" },
                  { value: "informal", label: "Informal Offer" },
                  { value: "arb", label: "ARB Hearing" },
                  { value: "resolved", label: "Resolved" }
                ]}
                onChange={(v) => {
                  if (!v) return;
                  const next = v as ProtestStatus;
                  setStatusDraft(next);
                  void updateWorksheet({ status: next });
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="Hearing Date"
                type="date"
                value={hearingDraft}
                onChange={(e) => setHearingDraft(e.currentTarget.value)}
                onBlur={() => {
                  if (!worksheet) return;
                  const next = hearingDraft.trim() || null;
                  if ((worksheet.hearingDate ?? null) !== next) {
                    void updateWorksheet({ hearingDate: next });
                  }
                }}
              />
            </Grid.Col>
          </Grid>
          {worksheet?.hearingDate ? (
            <Text size="sm" c="dimmed">
              Hearing: {formatDate(worksheet.hearingDate)}
              {hearingDays != null ? ` · ${hearingDays} days away` : ""}
            </Text>
          ) : null}
        </Stack>
      </Card>

      {/* Floating chat FAB — hidden when drawer is open */}
      {!chatOpen && (
        <Tooltip label="Protest Assistant" withArrow position="left">
          <ActionIcon
            radius="xl"
            size={56}
            style={{ position: "fixed", bottom: 28, right: 28, zIndex: 300 }}
            onClick={() => setChatOpen(true)}
          >
            <IconMessage size={26} />
          </ActionIcon>
        </Tooltip>
      )}

      {/* Chat drawer */}
      <Drawer
        opened={chatOpen}
        onClose={() => setChatOpen(false)}
        position="right"
        size={400}
        title="Protest Assistant"
        styles={{ body: { display: "flex", flexDirection: "column", height: "calc(100% - 60px)", padding: "12px 16px" } }}
      >
        <Box style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
          <Stack gap="sm">
            {chat.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" mt="xl">
                Ask me to analyze your case, draft arguments, or fetch comparable properties.
              </Text>
            ) : null}
            {chat.map((turn) => (
              <Group key={turn.id} justify={turn.role === "user" ? "flex-end" : "flex-start"}>
                <Paper
                  radius="md"
                  p="sm"
                  bg={turn.role === "user" ? "dark.8" : "gray.1"}
                  c={turn.role === "user" ? "white" : undefined}
                  maw="88%"
                >
                  <Stack gap={4}>
                    {turn.role === "assistant"
                      ? markdownLines(turn.content).map((line, idx) => (
                          <Text key={idx} size="sm">
                            {line || " "}
                          </Text>
                        ))
                      : <Text size="sm">{turn.content}</Text>}
                    {turn.attachmentType ? (
                      <Chip checked readOnly size="xs" variant="light">
                        📎 Attachment
                      </Chip>
                    ) : null}
                  </Stack>
                </Paper>
              </Group>
            ))}
            {thinking ? (
              <Group justify="flex-start">
                <Paper radius="md" p="sm" bg="gray.1">
                  <Text size="sm" c="dimmed">Thinking…</Text>
                </Paper>
              </Group>
            ) : null}
            <div ref={bottomRef} />
          </Stack>
        </Box>

        <Stack gap={8} mt="sm" style={{ flexShrink: 0 }}>
          {pendingAttachment ? (
            <Group>
              <Chip checked readOnly size="xs">{pendingAttachment.label}</Chip>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => setPendingAttachment(null)}
                aria-label="Remove attachment"
                size="sm"
              >
                <IconX size={14} />
              </ActionIcon>
            </Group>
          ) : null}
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={5}
            placeholder="Ask about comps, arguments, strategy…"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!sending) void send();
              }
            }}
          />
          <Group justify="space-between">
            <Group gap={4}>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept=".txt,.json,.csv"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (!file) return;
                  onPickTextFile(file);
                }}
              />
              <Tooltip label="Attach text file" withArrow>
                <ActionIcon
                  variant="default"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach text file"
                >
                  <IconPaperclip size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Group gap="xs">
              <Text size="xs" c="dimmed">⌘↵</Text>
              <Button
                leftSection={<IconSend size={16} />}
                onClick={() => void send()}
                loading={sending}
                disabled={sending || message.trim().length === 0}
              >
                Send
              </Button>
            </Group>
          </Group>
        </Stack>
      </Drawer>
    </Stack>
  );
}
