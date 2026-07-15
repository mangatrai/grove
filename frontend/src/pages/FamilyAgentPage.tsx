import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBell,
  IconBookmarkPlus,
  IconCalendarPlus,
  IconCheck,
  IconChevronDown,
  IconClipboard,
  IconMail,
  IconMessageCircle,
  IconNotes,
  IconPlayerPlay,
  IconRefresh,
  IconRobot,
  IconSend,
} from "@tabler/icons-react";

import { apiFetch, apiJson } from "../api";
import { useCurrentUser } from "../UserContext";

type AgentAlert = {
  id: string;
  detectedAt: string;
  alertType: "conflict" | "travel" | "coverage_gap" | "deadline_approaching" | "suggestion";
  reason: string;
  affectedDate: string | null;
  copyPasteText: string | null;
  recipientHint: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
  resolutionKind: "useful" | "not_relevant" | "already_knew" | null;
  actionType: string | null;
  actionPayload: { title: string; date: string; description: string } | null;
  /** FIX #215: verbatim excerpt the email-ingest extraction cited, for email-derived suggestions. */
  sourceQuote: string | null;
};

type DigestEntry = {
  id: string;
  runType: string;
  runAt: string;
  status: "sent" | "skipped" | "error";
  skipReason: string | null;
  alertsCreated: number;
  emailsSent: number;
  errorMessage: string | null;
  subjectLine: string | null;
  summaryText: string | null;
  recipients: string[] | null;
};

// #230: Quick Capture ask history (pa_task_run), merged into the same Run History table as digests.
type TaskRunEntry = {
  id: string;
  goal: string;
  origin: "user" | "scheduler";
  captureMode: "one_shot" | "research_loop" | null;
  status: string;
  iterationsUsed: number | null;
  resultSummary: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type RunHistoryRow = {
  key: string;
  when: string;
  source: "digest" | "ask";
  typeLabel: string;
  status: string;
  countLabel: string;
  recipients: string[] | null;
  summary: string | null;
  goal: string | null;
};

type CaptureActionType = "create_event" | "set_reminder" | "draft_message" | "note";

type CaptureAction = {
  type: CaptureActionType;
  title: string;
  summary: string;
  details: Record<string, unknown>;
};

type CaptureResult = {
  responseText: string;
  actions: CaptureAction[];
};

// #167: research-loop result shape (pa-task-runner.ts's PATaskResult) — a second, slower engine
// behind the same Quick Capture box, for asks that need live web research.
type PATaskResult = {
  goal: string;
  summary: string;
  actions: CaptureAction[];
  iterationsUsed: number;
  hitIterationCap: boolean;
};

type PATaskResponse =
  | { type: "one_shot"; result: CaptureResult }
  | { type: "research_loop"; result: PATaskResult; runId: string };

// #238: "Save as preference" — lets the household save a task result as durable PA memory.
type PaPreferenceCategory = "preference" | "discovered_fact" | "decision_history";
type PaPreferenceTopicTag = "travel" | "school" | "health" | "finance" | "gifts" | "household" | "other";

const PA_PREFERENCE_CATEGORY_SELECT_DATA = [
  { value: "preference", label: "Preference" },
  { value: "discovered_fact", label: "Discovered fact" },
  { value: "decision_history", label: "Decision history" },
];

const PA_PREFERENCE_TOPIC_TAG_SELECT_DATA = [
  { value: "travel", label: "Travel" },
  { value: "school", label: "School" },
  { value: "health", label: "Health" },
  { value: "finance", label: "Finance" },
  { value: "gifts", label: "Gifts" },
  { value: "household", label: "Household" },
  { value: "other", label: "Other" },
];

const ALERT_TYPE_LABELS: Record<string, string> = {
  conflict: "Schedule pressure",
  travel: "Travel",
  coverage_gap: "Coverage gap",
  deadline_approaching: "Deadline",
  suggestion: "Planning",
};

const ALERT_TYPE_COLORS: Record<string, string> = {
  conflict: "orange",
  travel: "blue",
  coverage_gap: "red",
  deadline_approaching: "yellow",
  suggestion: "teal",
};

const RUN_TYPE_LABELS: Record<string, string> = {
  sunday_preview: "Sunday preview",
  monday_digest: "Monday digest",
  daily_delta: "Daily delta",
  manual: "Manual run",
};

const STATUS_COLORS: Record<string, string> = {
  sent: "green",
  skipped: "gray",
  error: "red",
  succeeded: "green",
  failed: "red",
  running: "blue",
  refused_budget: "orange",
};

const ACTION_ICONS: Record<CaptureActionType, React.ReactNode> = {
  create_event: <IconCalendarPlus size={16} stroke={1.5} />,
  set_reminder: <IconBell size={16} stroke={1.5} />,
  draft_message: <IconMail size={16} stroke={1.5} />,
  note: <IconNotes size={16} stroke={1.5} />,
};

const ACTION_LABELS: Record<CaptureActionType, string> = {
  create_event: "Create event",
  set_reminder: "Set reminder",
  draft_message: "Draft message",
  note: "Note",
};

type AlertCardProps = {
  alert: AgentAlert;
  onResolve: (id: string) => void;
  onCompose: (alert: AgentAlert) => void;
};

function AlertCard({ alert, onResolve, onCompose }: AlertCardProps) {
  const [resolving, setResolving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [calAdding, setCalAdding] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);
  const [calLink, setCalLink] = useState<string | null>(null);
  const textRef = useRef<HTMLPreElement>(null);

  async function handleResolve(kind: "useful" | "not_relevant" | "already_knew" | null) {
    setResolving(true);
    try {
      await apiFetch(`/api/family/alerts/${alert.id}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({ kind }),
      });
      onResolve(alert.id);
    } finally {
      setResolving(false);
    }
  }

  async function handleAddToCalendar() {
    setCalAdding(true);
    setCalError(null);
    try {
      const res = await apiFetch(`/api/family/alerts/${alert.id}/approve`, { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { gcalEventLink?: string | null };
        setCalLink(data.gcalEventLink ?? null);
        onResolve(alert.id);
      } else {
        const err = await res.json().catch(() => ({})) as { code?: string; message?: string };
        if (err.code === "GCAL_NEEDS_REAUTH") {
          setCalError("Google Calendar needs to be reconnected. Go to Settings → Integrations.");
        } else if (err.code === "GCAL_NOT_CONNECTED") {
          setCalError("Google Calendar is not connected. Go to Settings → Integrations.");
        } else {
          setCalError(err.message ?? "Could not add to calendar. Try again.");
        }
      }
    } catch {
      setCalError("Could not add to calendar. Try again.");
    } finally {
      setCalAdding(false);
    }
  }

  function handleCopy() {
    if (alert.copyPasteText) {
      void navigator.clipboard.writeText(alert.copyPasteText).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  const detectedDate = new Date(alert.detectedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Paper withBorder p="md" radius="md" style={{ borderLeft: `4px solid var(--mantine-color-${ALERT_TYPE_COLORS[alert.alertType]}-6)` }}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="xs" align="center">
            <IconAlertTriangle size={18} stroke={1.5} color={`var(--mantine-color-${ALERT_TYPE_COLORS[alert.alertType]}-6)`} />
            <Badge size="sm" color={ALERT_TYPE_COLORS[alert.alertType]} variant="light">
              {ALERT_TYPE_LABELS[alert.alertType] ?? alert.alertType}
            </Badge>
            {alert.recipientHint ? (
              <Badge size="sm" variant="outline" color="gray">→ {alert.recipientHint}</Badge>
            ) : null}
            {alert.affectedDate ? (
              <Text size="xs" c="dimmed">
                {new Date(alert.affectedDate).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </Text>
            ) : null}
          </Group>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{detectedDate}</Text>
        </Group>

        <Text size="sm">{alert.reason}</Text>

        {alert.copyPasteText ? (
          <Box>
            <Group justify="space-between" mb={4}>
              <Text size="xs" c="dimmed" fw={500}>Suggested message to copy</Text>
              <Tooltip label={copied ? "Copied!" : "Copy to clipboard"} withArrow>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color={copied ? "green" : "gray"}
                  onClick={handleCopy}
                  aria-label="Copy message"
                >
                  {copied ? <IconCheck size={13} /> : <IconClipboard size={13} />}
                </ActionIcon>
              </Tooltip>
            </Group>
            <Code block ref={textRef} style={{ fontSize: 12, whiteSpace: "pre-wrap", cursor: "text" }}>
              {alert.copyPasteText}
            </Code>
          </Box>
        ) : null}

        {alert.sourceQuote ? (
          <Box>
            <Text size="xs" c="dimmed" fw={500} mb={4}>From the email</Text>
            <Code block style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
              {alert.sourceQuote}
            </Code>
          </Box>
        ) : null}

        <Group justify="flex-end">
          {alert.copyPasteText ? (
            <Button
              size="xs"
              variant="subtle"
              color="blue"
              leftSection={<IconMail size={13} />}
              onClick={() => onCompose(alert)}
            >
              Compose
            </Button>
          ) : null}
          {alert.actionType === "create_gcal_event" && !alert.isResolved ? (
            <Button
              size="xs"
              variant="light"
              color="blue"
              loading={calAdding}
              leftSection={<IconCalendarPlus size={13} />}
              onClick={() => void handleAddToCalendar()}
            >
              Add to Calendar
            </Button>
          ) : null}
          <Menu position="bottom-end" withinPortal disabled={resolving}>
            <Menu.Target>
              <Button
                size="xs"
                variant="subtle"
                color="green"
                loading={resolving}
                leftSection={<IconCheck size={13} />}
                rightSection={<IconChevronDown size={13} />}
              >
                Resolve
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => void handleResolve("useful")}>Useful</Menu.Item>
              <Menu.Item onClick={() => void handleResolve("not_relevant")}>Not relevant</Menu.Item>
              <Menu.Item onClick={() => void handleResolve("already_knew")}>Already knew</Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={() => void handleResolve(null)}>Dismiss (no feedback)</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
        {calError ? (
          <Text size="xs" c="red" mt={4}>{calError}</Text>
        ) : null}
        {calLink ? (
          <Text size="xs" c="dimmed" mt={4}>
            Added.{" "}
            <a href={calLink} target="_blank" rel="noreferrer" style={{ color: "var(--mantine-color-blue-6)" }}>
              Open in Google Calendar
            </a>
          </Text>
        ) : null}
      </Stack>
    </Paper>
  );
}

type RunButtonProps = {
  onRun: (runType: string) => void;
  running: boolean;
};

function RunButton({ onRun, running }: RunButtonProps) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button
          size="sm"
          leftSection={<IconPlayerPlay size={15} />}
          rightSection={<IconChevronDown size={14} />}
          loading={running}
        >
          Run now
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Agent run type</Menu.Label>
        <Menu.Item onClick={() => onRun("manual")}>Manual (full analysis)</Menu.Item>
        <Menu.Item onClick={() => onRun("monday_digest")}>Monday digest</Menu.Item>
        <Menu.Item onClick={() => onRun("sunday_preview")}>Sunday preview</Menu.Item>
        <Menu.Item onClick={() => onRun("daily_delta")}>Daily delta check</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

type ComposeModalProps = {
  opened: boolean;
  onClose: () => void;
  initial: { to: string; subject: string; body: string };
};

function ComposeModal({ opened, onClose, initial }: ComposeModalProps) {
  const [to, setTo] = useState(initial.to);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (opened) { setTo(initial.to); setSubject(initial.subject); setBody(initial.body); setResult(null); }
  }, [opened, initial.to, initial.subject, initial.body]);

  async function handleSend() {
    setSending(true);
    setResult(null);
    try {
      await apiJson("/api/family/compose/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body }),
      });
      setResult({ ok: true, message: "Email sent." });
      setTimeout(onClose, 1500);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Send failed." });
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Compose" size="lg">
      <Stack gap="sm">
        <TextInput label="To" value={to} onChange={e => setTo(e.currentTarget.value)} />
        <TextInput label="Subject" value={subject} onChange={e => setSubject(e.currentTarget.value)} />
        <Textarea label="Body" value={body} onChange={e => setBody(e.currentTarget.value)} autosize minRows={6} maxRows={18} />
        {result ? (
          <Text size="sm" c={result.ok ? "green" : "red"}>{result.message}</Text>
        ) : null}
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button leftSection={<IconSend size={15} />} onClick={() => void handleSend()} loading={sending} disabled={!to || !subject || !body}>
            Send
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type CaptureActionCardProps = {
  action: CaptureAction;
  onApprove: (action: CaptureAction) => void;
  onCompose: (action: CaptureAction) => void;
};

function CaptureActionCard({ action, onApprove, onCompose }: CaptureActionCardProps) {
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  async function handleApprove() {
    if (action.type === "draft_message") { onCompose(action); return; }
    setApproving(true);
    setApproveError(null);
    try {
      await onApprove(action);
      setApproved(true);
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="xs" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
          <Box mt={2} c="dimmed">{ACTION_ICONS[action.type]}</Box>
          <Stack gap={4}>
            <Group gap="xs">
              <Badge size="xs" variant="light" color="grape">{ACTION_LABELS[action.type]}</Badge>
              <Text size="sm" fw={500}>{action.title}</Text>
            </Group>
            <Text size="xs" c="dimmed">{action.summary}</Text>
            {approveError ? <Text size="xs" c="red">{approveError}</Text> : null}
          </Stack>
        </Group>
        {approved ? (
          <Badge size="sm" color="green" variant="filled" leftSection={<IconCheck size={11} />} style={{ flexShrink: 0 }}>Done</Badge>
        ) : (
          <Button
            size="xs"
            variant="light"
            color="indigo"
            loading={approving}
            leftSection={action.type === "draft_message" ? <IconMail size={13} /> : <IconCheck size={13} />}
            onClick={() => void handleApprove()}
            style={{ flexShrink: 0 }}
          >
            {action.type === "draft_message" ? "Compose" : "Approve"}
          </Button>
        )}
      </Group>
    </Paper>
  );
}

export function FamilyAgentPage() {
  const { role } = useCurrentUser();
  const isOwner = role === "owner";

  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const [digests, setDigests] = useState<DigestEntry[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [digestsLoading, setDigestsLoading] = useState(true);
  const [taskRuns, setTaskRuns] = useState<TaskRunEntry[]>([]);
  const [taskRunsLoading, setTaskRunsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedRunKey, setExpandedRunKey] = useState<string | null>(null);

  // Quick capture
  const [captureNote, setCaptureNote] = useState("");
  const [lastCaptureNote, setLastCaptureNote] = useState("");
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureResult, setCaptureResult] = useState<PATaskResponse | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Save as preference (#238)
  const [saveAsPrefOpen, setSaveAsPrefOpen] = useState(false);
  const [saveAsPrefClassifying, setSaveAsPrefClassifying] = useState(false);
  const [saveAsPrefDraft, setSaveAsPrefDraft] = useState<{ category: PaPreferenceCategory; topicTag: PaPreferenceTopicTag | null; factText: string }>({
    category: "discovered_fact",
    topicTag: "other",
    factText: "",
  });
  const [savingAsPref, setSavingAsPref] = useState(false);
  const [saveAsPrefError, setSaveAsPrefError] = useState<string | null>(null);

  // Compose modal
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState({ to: "", subject: "", body: "" });

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const res = await apiJson<{ alerts: AgentAlert[] }>(
        `/api/family/alerts${showResolved ? "?includeResolved=true" : ""}`
      );
      setAlerts(res.alerts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load alerts.");
    } finally {
      setAlertsLoading(false);
    }
  }, [showResolved]);

  const loadDigests = useCallback(async () => {
    setDigestsLoading(true);
    try {
      const res = await apiJson<{ entries: DigestEntry[] }>("/api/family/digests");
      setDigests(res.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load digest history.");
    } finally {
      setDigestsLoading(false);
    }
  }, []);

  const loadTaskRuns = useCallback(async () => {
    setTaskRunsLoading(true);
    try {
      const res = await apiJson<{ entries: TaskRunEntry[] }>("/api/family/agent/task/history");
      setTaskRuns(res.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load ask history.");
    } finally {
      setTaskRunsLoading(false);
    }
  }, []);

  useEffect(() => { void loadAlerts(); }, [loadAlerts]);
  useEffect(() => { void loadDigests(); }, [loadDigests]);
  useEffect(() => { void loadTaskRuns(); }, [loadTaskRuns]);

  const runHistoryRows = useMemo<RunHistoryRow[]>(() => {
    const digestRows: RunHistoryRow[] = digests.map(d => ({
      key: `digest:${d.id}`,
      when: d.runAt,
      source: "digest",
      typeLabel: RUN_TYPE_LABELS[d.runType] ?? d.runType,
      status: d.status,
      countLabel: String(d.alertsCreated),
      recipients: d.recipients,
      summary: d.summaryText ?? d.skipReason ?? d.errorMessage ?? null,
      goal: null,
    }));
    const askRows: RunHistoryRow[] = taskRuns.map(t => ({
      key: `ask:${t.id}`,
      when: t.createdAt,
      source: "ask",
      typeLabel: t.origin === "scheduler" ? "Gift research" : t.captureMode === "research_loop" ? "Research" : "One-shot",
      status: t.status,
      countLabel: t.captureMode === "research_loop" ? String(t.iterationsUsed ?? 0) : "—",
      recipients: null,
      // #246: summary is the real answer only (nullable) — never fall back to the goal here, or
      // a pending/failed run with no result would render its own question as if it were the
      // answer. The goal is still shown for context via `goal` below.
      summary: t.resultSummary,
      goal: t.goal,
    }));
    return [...digestRows, ...askRows]
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
      .slice(0, 30);
  }, [digests, taskRuns]);

  async function handleRun(runType: string) {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await apiJson<{ status: string; alertsCreated: number; emailsSent: number; message?: string }>(
        "/api/family/agent/run",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runType }),
        }
      );
      setRunResult(
        res.status === "sent"
          ? `Run complete — ${res.alertsCreated} alert${res.alertsCreated !== 1 ? "s" : ""} created, ${res.emailsSent} email${res.emailsSent !== 1 ? "s" : ""} sent.`
          : res.status === "skipped"
          ? `Skipped — ${res.message ?? "no action needed"}.`
          : `Error: ${res.message ?? "unknown"}.`
      );
      await Promise.all([loadAlerts(), loadDigests(), loadTaskRuns()]);
    } catch (e) {
      setRunResult(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  }

  function handleResolve(id: string) {
    if (!showResolved) {
      setAlerts(prev => prev.filter(a => a.id !== id));
    } else {
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, isResolved: true } : a));
    }
  }

  async function handleCapture() {
    if (!captureNote.trim()) return;
    setCaptureLoading(true);
    setCaptureResult(null);
    setCaptureError(null);
    setLastCaptureNote(captureNote);
    try {
      const res = await apiJson<PATaskResponse>("/api/family/agent/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: captureNote }),
      });
      setCaptureResult(res);
      setCaptureNote("");
      void loadTaskRuns();
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : "Capture failed.");
      void loadTaskRuns();
    } finally {
      setCaptureLoading(false);
    }
  }

  async function openSaveAsPreference(text: string) {
    setSaveAsPrefOpen(true);
    setSaveAsPrefError(null);
    setSaveAsPrefDraft({ category: "discovered_fact", topicTag: "other", factText: text });
    setSaveAsPrefClassifying(true);
    try {
      const res = await apiJson<{ category: PaPreferenceCategory; topicTag: PaPreferenceTopicTag | null; factText: string }>(
        "/api/family/pa-preferences/classify",
        { method: "POST", body: JSON.stringify({ factText: text }) }
      );
      setSaveAsPrefDraft({ category: res.category, topicTag: res.topicTag, factText: res.factText });
    } catch {
      // classification is a convenience suggestion; keep the fallback draft and let the user pick manually
    } finally {
      setSaveAsPrefClassifying(false);
    }
  }

  async function confirmSaveAsPreference() {
    if (!saveAsPrefDraft.factText.trim()) {
      setSaveAsPrefError("Enter a fact.");
      return;
    }
    if (saveAsPrefDraft.category !== "preference" && !saveAsPrefDraft.topicTag) {
      setSaveAsPrefError("Pick a topic tag.");
      return;
    }
    setSavingAsPref(true);
    setSaveAsPrefError(null);
    try {
      await apiJson("/api/family/pa-preferences", {
        method: "POST",
        body: JSON.stringify({
          category: saveAsPrefDraft.category,
          factText: saveAsPrefDraft.factText.trim(),
          topicTag: saveAsPrefDraft.category === "preference" ? undefined : saveAsPrefDraft.topicTag,
          source: "notes_extraction",
        }),
      });
      setSaveAsPrefOpen(false);
    } catch (e) {
      setSaveAsPrefError(e instanceof Error ? e.message : "Could not save preference");
    } finally {
      setSavingAsPref(false);
    }
  }

  async function handleActionApprove(action: CaptureAction) {
    await apiJson<{ ok: boolean; alertId: string; calEventId: string | null; calEventLink: string | null; calError: string | null }>(
      "/api/family/actions/approve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }
    );
    void loadAlerts();
  }

  function handleActionCompose(action: CaptureAction) {
    const d = action.details;
    setComposeInitial({
      to: typeof d.recipient === "string" ? d.recipient : "",
      subject: typeof d.subject === "string" ? d.subject : action.title,
      body: typeof d.body_draft === "string" ? d.body_draft : action.summary,
    });
    setComposeOpen(true);
  }

  function handleAlertCompose(alert: AgentAlert) {
    // Build a contextual subject from the first sentence of reason
    const firstSentence = (alert.reason ?? "").split(/(?<=[.!?])\s/)[0].trim();
    const subjectBase = firstSentence.length > 0 && firstSentence.length <= 100
      ? firstSentence
      : (alert.reason ?? "").slice(0, 80).replace(/\s\S*$/, "…");
    const subject = subjectBase || (ALERT_TYPE_LABELS[alert.alertType] ?? alert.alertType);

    // Build structured body: full context, then action, then deadline callout
    const bodyParts: string[] = [];
    if (alert.reason) bodyParts.push(alert.reason);
    if (alert.copyPasteText && alert.copyPasteText !== alert.reason) {
      bodyParts.push(`Action needed:\n${alert.copyPasteText}`);
    }
    if (alert.affectedDate) {
      const dateStr = new Date(alert.affectedDate).toLocaleDateString(undefined, { dateStyle: "long" });
      bodyParts.push(`Deadline: ${dateStr}`);
    }

    setComposeInitial({
      to: "",
      subject,
      body: bodyParts.join("\n\n"),
    });
    setComposeOpen(true);
  }

  const activeAlerts = alerts.filter(a => !a.isResolved);
  const resolvedAlerts = alerts.filter(a => a.isResolved);

  return (
    <Stack p="xl" gap="lg">
      {/* Header */}
      <Group justify="space-between" align="center">
        <div>
          <Title order={2}>Agent</Title>
          <Text c="dimmed" size="sm" mt={2}>
            Scheduled household assistant — runs Sunday evening, Monday morning, and daily after the 6am calendar sync.
          </Text>
        </div>
        <Group gap="xs">
          <ActionIcon
            variant="subtle"
            onClick={() => { void loadAlerts(); void loadDigests(); void loadTaskRuns(); }}
            disabled={alertsLoading || digestsLoading || taskRunsLoading}
            aria-label="Refresh"
          >
            <IconRefresh size={18} stroke={1.5} />
          </ActionIcon>
          {isOwner ? <RunButton onRun={runType => void handleRun(runType)} running={running} /> : null}
        </Group>
      </Group>

      {error ? <Text c="red" size="sm">{error}</Text> : null}
      {runResult ? (
        <Paper withBorder p="sm" radius="sm" bg="var(--mantine-color-dark-6)">
          <Text size="sm">{runResult}</Text>
        </Paper>
      ) : null}

      {/* Quick Capture */}
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group gap="xs">
            <IconMessageCircle size={18} stroke={1.5} />
            <Title order={5}>Quick capture</Title>
          </Group>
          <Text size="xs" c="dimmed">
            Send a note — the agent will parse it and suggest actions (create event, set reminder, draft message).
            Prefix with "research:" to force a deeper web-research pass.
          </Text>
          <Textarea
            placeholder="e.g. Find swim camps with summer openings, draft an absence note for Jake's school, remind me to follow up on Mia's referral next Monday…"
            value={captureNote}
            onChange={e => setCaptureNote(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={6}
            disabled={captureLoading}
          />
          {captureError ? <Text size="xs" c="red">{captureError}</Text> : null}
          <Group justify="space-between" align="center">
            {captureLoading ? (
              <Text size="xs" c="dimmed">Working on it — research asks can take up to 45s…</Text>
            ) : <span />}
            <Button
              size="sm"
              leftSection={<IconSend size={14} />}
              loading={captureLoading}
              disabled={!captureNote.trim()}
              onClick={() => void handleCapture()}
            >
              Ask
            </Button>
          </Group>

          {captureResult ? (
            <Stack gap="sm" mt="xs">
              {lastCaptureNote ? (
                <Stack gap={2}>
                  <Text size="xs" fw={600}>You asked:</Text>
                  <Text size="sm" c="dimmed">{lastCaptureNote}</Text>
                </Stack>
              ) : null}
              {captureResult.type === "research_loop" ? (
                <Badge size="sm" variant="light" color="grape" style={{ alignSelf: "flex-start" }}>
                  Researched · {captureResult.result.iterationsUsed} step{captureResult.result.iterationsUsed === 1 ? "" : "s"}
                </Badge>
              ) : null}
              <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                {captureResult.type === "one_shot" ? captureResult.result.responseText : captureResult.result.summary}
              </Text>
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconBookmarkPlus size={14} />}
                style={{ alignSelf: "flex-start" }}
                onClick={() =>
                  void openSaveAsPreference(
                    captureResult.type === "one_shot" ? captureResult.result.responseText : captureResult.result.summary
                  )
                }
              >
                Save as preference
              </Button>
              {captureResult.result.actions.map((action, i) => (
                <CaptureActionCard
                  key={i}
                  action={action}
                  onApprove={handleActionApprove}
                  onCompose={handleActionCompose}
                />
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      {/* Active alerts */}
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <IconBell size={18} stroke={1.5} />
            <Title order={4}>Active alerts</Title>
            {activeAlerts.length > 0 ? (
              <Badge size="sm" color="red" variant="filled">{activeAlerts.length}</Badge>
            ) : null}
          </Group>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={() => setShowResolved(v => !v)}
          >
            {showResolved ? "Hide resolved" : `Show resolved (${resolvedAlerts.length})`}
          </Button>
        </Group>

        {alertsLoading ? (
          <Group><Loader size="sm" /><Text size="sm" c="dimmed">Loading…</Text></Group>
        ) : activeAlerts.length === 0 && !showResolved ? (
          <Paper withBorder p="lg" radius="md">
            <Stack align="center" gap="sm" py="md">
              <IconCheck size={32} stroke={1.5} color="var(--mantine-color-green-6)" />
              <Text c="dimmed" size="sm">No active alerts — all clear.</Text>
            </Stack>
          </Paper>
        ) : (
          <Stack gap="sm">
            {activeAlerts.map(a => (
              <AlertCard key={a.id} alert={a} onResolve={handleResolve} onCompose={handleAlertCompose} />
            ))}
            {showResolved && resolvedAlerts.length > 0 ? (
              <>
                <Divider label="Resolved" labelPosition="left" />
                {resolvedAlerts.map(a => (
                  <Paper key={a.id} withBorder p="md" radius="md" opacity={0.55}>
                    <Group gap="xs">
                      <IconCheck size={14} color="var(--mantine-color-green-6)" />
                      <Text size="sm" c="dimmed">{a.reason}</Text>
                      <Badge size="xs" color="gray" variant="outline">resolved</Badge>
                    </Group>
                  </Paper>
                ))}
              </>
            ) : null}
          </Stack>
        )}
      </Stack>

      <Divider />

      {/* Digest history */}
      <Stack gap="sm">
        <Group gap="xs">
          <IconRobot size={18} stroke={1.5} />
          <Title order={4}>Run history</Title>
          <Text size="xs" c="dimmed">(last 30)</Text>
        </Group>

        {digestsLoading || taskRunsLoading ? (
          <Group><Loader size="sm" /><Text size="sm" c="dimmed">Loading…</Text></Group>
        ) : runHistoryRows.length === 0 ? (
          <Text c="dimmed" size="sm">No runs yet. Connect Google Calendar in Settings → Family, then trigger a manual run, or try Quick Capture below.</Text>
        ) : (
          <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
            <Table striped highlightOnHover withRowBorders={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th>
                  <Table.Th>Source</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Alerts</Table.Th>
                  <Table.Th>Recipients</Table.Th>
                  <Table.Th>Summary</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {runHistoryRows.map(row => {
                  const isExpanded = expandedRunKey === row.key;
                  // #246: hasResult gates expand/click affordance and the expanded answer panel —
                  // only a real result_summary counts. previewText is display-only, for the
                  // collapsed row when no result exists yet (e.g. still running), so the row
                  // isn't blank while it's in flight.
                  const hasResult = Boolean(row.summary);
                  const previewText = row.summary ?? row.goal ?? null;
                  return (
                    <Fragment key={row.key}>
                      <Table.Tr style={{ cursor: hasResult ? "pointer" : "default" }} onClick={() => hasResult && setExpandedRunKey(isExpanded ? null : row.key)}>
                        <Table.Td>
                          <Text size="xs">
                            {new Date(row.when).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" color={row.source === "digest" ? "grape" : "cyan"} variant="light">
                            {row.source === "digest" ? "Digest" : "Quick capture"}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{row.typeLabel}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" color={STATUS_COLORS[row.status] ?? "gray"} variant="light">{row.status}</Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c={row.source === "digest" && Number(row.countLabel) > 0 ? "red" : "dimmed"}>{row.countLabel}</Text>
                        </Table.Td>
                        <Table.Td>
                          {row.recipients && row.recipients.length > 0 ? (
                            <Stack gap={2}>
                              {row.recipients.map(r => (
                                <Text key={r} size="xs" c="dimmed">{r}</Text>
                              ))}
                            </Stack>
                          ) : (
                            <Text size="xs" c="dimmed">—</Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <Text size="xs" c="dimmed" lineClamp={isExpanded ? undefined : 1} style={{ flex: 1 }}>
                              {previewText ?? "—"}
                            </Text>
                            {hasResult && previewText && previewText.length > 60 ? (
                              <ActionIcon size="xs" variant="subtle" color="gray" aria-label={isExpanded ? "Collapse" : "Expand"}>
                                {isExpanded ? <IconCheck size={12} /> : <IconChevronDown size={12} />}
                              </ActionIcon>
                            ) : null}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                      {isExpanded && hasResult ? (
                        <Table.Tr>
                          <Table.Td colSpan={7}>
                            <Paper p="sm" radius="sm" bg="var(--mantine-color-dark-7)" mb={4}>
                              {row.goal ? (
                                <Text size="xs" fw={600} c="var(--mantine-color-gray-3)" mb={4}>Asked: {row.goal}</Text>
                              ) : null}
                              <Text size="xs" c="var(--mantine-color-gray-0)" style={{ whiteSpace: "pre-wrap" }}>{row.summary}</Text>
                            </Paper>
                          </Table.Td>
                        </Table.Tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </Stack>

      <ComposeModal
        opened={composeOpen}
        onClose={() => setComposeOpen(false)}
        initial={composeInitial}
      />

      <Modal
        opened={saveAsPrefOpen}
        onClose={() => setSaveAsPrefOpen(false)}
        title="Save as preference"
        centered
      >
        <Stack gap="sm">
          {saveAsPrefClassifying ? (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">Suggesting category…</Text>
            </Group>
          ) : null}
          <Textarea
            label="Fact"
            value={saveAsPrefDraft.factText}
            onChange={(e) => setSaveAsPrefDraft((d) => ({ ...d, factText: e.currentTarget.value }))}
            autosize
            minRows={2}
          />
          <Group align="end" grow>
            <Select
              label="Category"
              data={PA_PREFERENCE_CATEGORY_SELECT_DATA}
              value={saveAsPrefDraft.category}
              onChange={(v) => {
                const category = (v as PaPreferenceCategory) ?? "discovered_fact";
                setSaveAsPrefDraft((d) => ({ ...d, category, topicTag: category === "preference" ? null : d.topicTag ?? "other" }));
              }}
              allowDeselect={false}
            />
            {saveAsPrefDraft.category !== "preference" ? (
              <Select
                label="Topic"
                data={PA_PREFERENCE_TOPIC_TAG_SELECT_DATA}
                value={saveAsPrefDraft.topicTag}
                onChange={(v) => setSaveAsPrefDraft((d) => ({ ...d, topicTag: v as PaPreferenceTopicTag | null }))}
                placeholder="Pick a topic"
              />
            ) : null}
          </Group>
          {saveAsPrefError ? <Alert color="red" p="xs">{saveAsPrefError}</Alert> : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSaveAsPrefOpen(false)}>
              Cancel
            </Button>
            <Button loading={savingAsPref} onClick={() => void confirmSaveAsPreference()}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
