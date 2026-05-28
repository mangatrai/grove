import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Grid,
  Group,
  List,
  Paper,
  Popover,
  Progress,
  Select,
  Stack,
  Stepper,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconFileText,
  IconLink,
  IconPaperclip,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
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
type ChatResponse = { assistantMessage: string; strategyUpdated: boolean; compsAdded: number };

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

function propertyTypeLabel(value: PropertyRecord["propertyUse"]): string {
  if (value === "rental") return "Rental";
  if (value === "vacation") return "Vacation";
  return "Primary";
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

function attachmentChipLabel(type: AttachmentType): string {
  if (type === "pdf") return "📄 PDF text";
  if (type === "url") return "🔗 URL";
  return "📎 Text file attached";
}

function markdownLines(text: string): string[] {
  return text.split("\n").map((line) => line.trimEnd()).filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""));
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
  const [year, setYear] = useState<string>("2026");
  const [chat, setChat] = useState<ChatTurnUI[]>([]);
  const [message, setMessage] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [urlPopoverOpen, setUrlPopoverOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [hearingDraft, setHearingDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<ProtestStatus>("not_filed");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addToast = useCallback((color: Toast["color"], messageText: string) => {
    const next: Toast = { id: toastSeq, color, message: messageText };
    setToastSeq((n) => n + 1);
    setToasts((prev) => [...prev, next]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== next.id));
    }, 3000);
  }, [toastSeq]);

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
        setChat([]);
        return;
      }
      const qpProperty = searchParams.get("property");
      const chosen = qpProperty && props.some((p) => p.id === qpProperty) ? qpProperty : props[0].id;
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
      const [propRes, wsRes] = await Promise.all([
        apiJson<PropertyResponse>(`/household/properties/${encodeURIComponent(pid)}`),
        apiJson<WorksheetResponse>(`/api/protest/${encodeURIComponent(pid)}/worksheet?year=${selectedYear}`)
      ]);
      setProperty(propRes.property);
      setWorksheet(wsRes.worksheet);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat, thinking]);

  const subject = useMemo(() => asRecord(asRecord(property?.valuationDetail)?.subject), [property?.valuationDetail]);
  const estimate = useMemo(() => asRecord(asRecord(property?.valuationDetail)?.estimate), [property?.valuationDetail]);
  const assessment = useMemo(() => asRecord(asRecord(property?.valuationDetail)?.taxCurrent), [property?.valuationDetail]);

  const cadAssessed = asNumber(assessment?.assessedValue);
  const avm = asNumber(estimate?.value) ?? property?.latestValueUsd ?? null;
  const overPct = cadAssessed != null && avm != null && avm > 0 ? ((cadAssessed / avm) - 1) * 100 : null;
  const overAmt = cadAssessed != null && avm != null ? cadAssessed - avm : null;
  const annualSavings = overAmt != null && overAmt > 0 && (property?.state ?? "").toUpperCase() === "TX"
    ? overAmt * 0.02
    : null;

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
      const res = await apiJson<ChatResponse>(`/api/protest/${encodeURIComponent(propertyId)}/chat`, {
        method: "POST",
        body: JSON.stringify({
          message: bodyText,
          attachmentText: attachment?.text,
          attachmentType: attachment?.type,
          year: Number(year)
        })
      });
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
        const wsRes = await apiJson<WorksheetResponse>(`/api/protest/${encodeURIComponent(propertyId)}/worksheet?year=${Number(year)}`);
        setWorksheet(wsRes.worksheet);
      }
      if (res.compsAdded > 0) {
        addToast("green", `Fetched ${res.compsAdded} comparable properties from DCAD.`);
      }
    } catch (err) {
      setChat((prev) => prev.filter((t) => t.id !== optimistic.id));
      addToast("red", err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
      setThinking(false);
    }
  }, [propertyId, worksheet, message, pendingAttachment, year, addToast]);

  const updateWorksheet = useCallback(async (patch: { status?: ProtestStatus; hearingDate?: string | null }) => {
    if (!propertyId || !worksheet) return;
    try {
      const res = await apiJson<WorksheetResponse>(`/api/protest/${encodeURIComponent(propertyId)}/worksheet`, {
        method: "PATCH",
        body: JSON.stringify({
          year: Number(year),
          ...patch
        })
      });
      setWorksheet(res.worksheet);
      setStatusDraft(res.worksheet.status);
      setHearingDraft(res.worksheet.hearingDate ?? "");
    } catch (err) {
      addToast("red", err instanceof Error ? err.message : "Failed to update worksheet");
    }
  }, [propertyId, worksheet, year, addToast]);

  const onPickTextFile = useCallback((file: File) => {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      addToast("yellow", "PDF extraction coming soon — paste the text content from your PDF for now");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setPendingAttachment({ type: "text", text, label: file.name });
    };
    reader.onerror = () => addToast("red", "Could not read attachment");
    reader.readAsText(file);
  }, [addToast]);

  if (!token) return <Navigate to="/" replace />;
  if (loading) return <GrovePageLoader label="Loading protest assistant…" />;

  return (
    <Stack gap="md">
      {toasts.length > 0 ? (
        <Stack gap={6} style={{ position: "fixed", right: 18, top: 72, zIndex: 2000, width: 340 }}>
          {toasts.map((toast) => (
            <Alert key={toast.id} color={toast.color} withCloseButton onClose={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}>
              {toast.message}
            </Alert>
          ))}
        </Stack>
      ) : null}

      {error ? <Alert color="red">{error}</Alert> : null}

      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <div>
                  <Group gap={8}>
                    <Title order={2} style={{ fontSize: 20 }}>
                      {property?.addressLine1 ?? "Tax Protest Assistant"}
                    </Title>
                    <Badge variant="light">{propertyTypeLabel(property?.propertyUse ?? null)}</Badge>
                  </Group>
                  <Text c="dimmed" size="sm">{property?.city ?? "Example City"}, {property?.state ?? "TX"}</Text>
                </div>
                <Group>
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
                  <Tooltip label="ARB document export — coming soon." withArrow>
                    <Button leftSection={<IconFileText size={16} />} variant="default" disabled>
                      Generate Document
                    </Button>
                  </Tooltip>
                </Group>
              </Group>

              <Paper withBorder radius="md" p="sm" style={{ height: "58vh", display: "flex", flexDirection: "column" }}>
                <Box style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
                  <Stack gap="sm">
                    {chat.map((turn) => (
                      <Group key={turn.id} justify={turn.role === "user" ? "flex-end" : "flex-start"}>
                        <Paper
                          radius="md"
                          p="sm"
                          bg={turn.role === "user" ? "dark.8" : "gray.1"}
                          c={turn.role === "user" ? "white" : undefined}
                          maw="85%"
                        >
                          <Stack gap={4}>
                            {turn.role === "assistant"
                              ? markdownLines(turn.content).map((line, idx) => <Text key={idx} size="sm">{line || " "}</Text>)
                              : <Text size="sm">{turn.content}</Text>}
                            {turn.attachmentType ? (
                              <Chip checked readOnly size="xs" variant="light">
                                {attachmentChipLabel(turn.attachmentType)}
                              </Chip>
                            ) : null}
                          </Stack>
                        </Paper>
                      </Group>
                    ))}
                    {thinking ? (
                      <Group justify="flex-start">
                        <Paper radius="md" p="sm" bg="gray.1">
                          <Text size="sm" c="dimmed">Assistant is thinking…</Text>
                        </Paper>
                      </Group>
                    ) : null}
                    <div ref={bottomRef} />
                  </Stack>
                </Box>

                <Stack gap={8} mt="sm">
                  {pendingAttachment ? (
                    <Group>
                      <Chip checked readOnly>{pendingAttachment.label}</Chip>
                      <ActionIcon variant="subtle" color="gray" onClick={() => setPendingAttachment(null)} aria-label="Remove attachment">
                        <IconX size={14} />
                      </ActionIcon>
                    </Group>
                  ) : null}
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.currentTarget.value)}
                    autosize
                    minRows={2}
                    maxRows={6}
                    placeholder="Ask the protest assistant to draft arguments or analyze comps..."
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        if (!sending) {
                          void send();
                        }
                      }
                    }}
                  />
                  <Group justify="space-between">
                    <Group>
                      <input
                        ref={fileInputRef}
                        hidden
                        type="file"
                        accept=".txt,.json,.csv,.pdf"
                        onChange={(e) => {
                          const file = e.currentTarget.files?.[0];
                          e.currentTarget.value = "";
                          if (!file) return;
                          onPickTextFile(file);
                        }}
                      />
                      <Tooltip label="Attach text file" withArrow>
                        <ActionIcon variant="default" onClick={() => fileInputRef.current?.click()} aria-label="Attach text file">
                          <IconPaperclip size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Popover opened={urlPopoverOpen} onChange={setUrlPopoverOpen} position="top-start" withArrow>
                        <Popover.Target>
                          <ActionIcon variant="default" onClick={() => setUrlPopoverOpen((o) => !o)} aria-label="Attach URL">
                            <IconLink size={16} />
                          </ActionIcon>
                        </Popover.Target>
                        <Popover.Dropdown>
                          <Stack gap="xs">
                            <TextInput
                              placeholder="https://example.com/comp-listing"
                              value={urlDraft}
                              onChange={(e) => setUrlDraft(e.currentTarget.value)}
                            />
                            <Group justify="flex-end">
                              <Button
                                size="xs"
                                onClick={() => {
                                  const next = urlDraft.trim();
                                  if (!next) return;
                                  setPendingAttachment({ type: "url", text: next, label: next });
                                  setUrlDraft("");
                                  setUrlPopoverOpen(false);
                                }}
                              >
                                Attach URL
                              </Button>
                            </Group>
                          </Stack>
                        </Popover.Dropdown>
                      </Popover>
                    </Group>
                    <Button
                      leftSection={<IconSend size={16} />}
                      onClick={() => void send()}
                      loading={sending}
                      disabled={sending || message.trim().length === 0}
                    >
                      Send
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="md">
            <Card withBorder radius="md" p="md">
              <Stack gap="sm">
                <Select
                  label="Property"
                  value={propertyId}
                  data={properties.map((p) => ({
                    value: p.id,
                    label: `${p.addressLine1 ?? "Unnamed property"}${p.city ? `, ${p.city}` : ""}`
                  }))}
                  onChange={(next) => {
                    if (!next) return;
                    setPropertyId(next);
                    setSearchParams({ property: next });
                  }}
                />
              </Stack>
            </Card>

            <Card withBorder radius="md" p="md">
              <Stack gap={8}>
                <Group justify="space-between">
                  <Text fw={700}>{property?.addressLine1 ?? "123 Example St"}</Text>
                  <Badge variant="light">{propertyTypeLabel(property?.propertyUse ?? null)}</Badge>
                </Group>
                <Text c="dimmed" size="sm">{property?.city ?? "Example City"}, {property?.state ?? "TX"}</Text>
                <Grid>
                  <Grid.Col span={6}>
                    <Text size="xs" c="dimmed">CAD Assessed</Text>
                    <Text fw={700}>{money(cadAssessed)}</Text>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Text size="xs" c="dimmed">AVM</Text>
                    <Text fw={700}>{money(avm)}</Text>
                  </Grid.Col>
                </Grid>
                {overPct != null && overPct > 3 ? (
                  <Badge color="yellow" variant="light">
                    ~{overPct.toFixed(1)}% overassessed, est. {annualSavings != null ? money(annualSavings) : "--"} savings/yr
                  </Badge>
                ) : null}
                <Grid>
                  <Grid.Col span={6}><Text size="sm">Sqft: {asNumber(subject?.sqFt) ?? "—"}</Text></Grid.Col>
                  <Grid.Col span={6}><Text size="sm">Beds: {asNumber(subject?.beds) ?? "—"}</Text></Grid.Col>
                  <Grid.Col span={6}><Text size="sm">Baths: {asNumber(subject?.baths) ?? "—"}</Text></Grid.Col>
                  <Grid.Col span={6}><Text size="sm">Built: {asNumber(subject?.yearBuilt) ?? "—"}</Text></Grid.Col>
                </Grid>
              </Stack>
            </Card>

            {worksheet?.strategyJson ? (
              <Card withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Title order={4}>Strategy</Title>
                  <Text size="sm">Case strength</Text>
                  <Progress
                    value={Math.max(0, Math.min(100, (worksheet.strategyJson.caseStrength / 10) * 100))}
                    color={worksheet.strategyJson.caseStrength >= 7 ? "green" : worksheet.strategyJson.caseStrength >= 4 ? "yellow" : "red"}
                  />
                  <Text size="sm">Target value: <strong>{money(worksheet.strategyJson.targetValueUsd)}</strong></Text>
                  <Text size="sm">Primary strategy: {worksheet.strategyJson.primaryStrategy}</Text>
                  <div>
                    <Text size="sm" fw={600} mb={6}>Draft arguments</Text>
                    <List size="sm">
                      {worksheet.strategyJson.draftArguments.map((arg, idx) => (
                        <List.Item key={`${idx}-${arg.slice(0, 16)}`}>{arg}</List.Item>
                      ))}
                    </List>
                  </div>
                  {worksheet.strategyJson.redFlags.length > 0 ? (
                    <Alert color="orange">
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

            <Card withBorder radius="md" p="md">
              <Stack gap="sm">
                <Title order={4}>Protest Status</Title>
                <Stepper active={worksheet ? statusIndex(worksheet.status) : 0} orientation="vertical" size="xs" iconSize={20}>
                  <Stepper.Step label="Not Filed" />
                  <Stepper.Step label="Filed" />
                  <Stepper.Step label="Informal Offer" />
                  <Stepper.Step label="ARB Hearing" />
                  <Stepper.Step label="Resolved" />
                </Stepper>
                {worksheet?.hearingDate ? (
                  <Text size="sm">
                    Hearing: {formatDate(worksheet.hearingDate)}
                    {daysUntil(worksheet.hearingDate) != null ? ` · ${daysUntil(worksheet.hearingDate)} days away` : ""}
                  </Text>
                ) : null}
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
                <Select
                  label="Status"
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
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
