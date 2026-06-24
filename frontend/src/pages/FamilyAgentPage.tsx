import { useCallback, useEffect, useRef, useState } from "react";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Menu,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBell,
  IconCheck,
  IconChevronDown,
  IconClipboard,
  IconPlayerPlay,
  IconRefresh,
  IconRobot,
} from "@tabler/icons-react";

import { apiFetch, apiJson } from "../api";
import { useCurrentUser } from "../UserContext";

type AgentAlert = {
  id: string;
  detectedAt: string;
  alertType: "conflict" | "travel" | "coverage_gap" | "deadline_approaching";
  reason: string;
  affectedDate: string | null;
  copyPasteText: string | null;
  recipientHint: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
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
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  conflict: "Schedule conflict",
  travel: "Travel detected",
  coverage_gap: "Coverage gap",
  deadline_approaching: "Deadline",
};

const ALERT_TYPE_COLORS: Record<string, string> = {
  conflict: "red",
  travel: "blue",
  coverage_gap: "orange",
  deadline_approaching: "yellow",
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
};

type AlertCardProps = {
  alert: AgentAlert;
  onResolve: (id: string) => void;
};

function AlertCard({ alert, onResolve }: AlertCardProps) {
  const [resolving, setResolving] = useState(false);
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);

  async function handleResolve() {
    setResolving(true);
    try {
      await apiFetch(`/api/family/alerts/${alert.id}/resolve`, { method: "PATCH" });
      onResolve(alert.id);
    } finally {
      setResolving(false);
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

        <Group justify="flex-end">
          <Button
            size="xs"
            variant="subtle"
            color="green"
            loading={resolving}
            leftSection={<IconCheck size={13} />}
            onClick={() => void handleResolve()}
          >
            Dismiss
          </Button>
        </Group>
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

export function FamilyAgentPage() {
  const { role } = useCurrentUser();
  const isOwner = role === "owner";

  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const [digests, setDigests] = useState<DigestEntry[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [digestsLoading, setDigestsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

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

  useEffect(() => { void loadAlerts(); }, [loadAlerts]);
  useEffect(() => { void loadDigests(); }, [loadDigests]);

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
      await Promise.all([loadAlerts(), loadDigests()]);
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

  const activeAlerts = alerts.filter(a => !a.isResolved);
  const resolvedAlerts = alerts.filter(a => a.isResolved);

  return (
    <Stack p="xl" gap="lg" style={{ maxWidth: 820 }}>
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
            onClick={() => { void loadAlerts(); void loadDigests(); }}
            disabled={alertsLoading || digestsLoading}
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
              <AlertCard key={a.id} alert={a} onResolve={handleResolve} />
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

        {digestsLoading ? (
          <Group><Loader size="sm" /><Text size="sm" c="dimmed">Loading…</Text></Group>
        ) : digests.length === 0 ? (
          <Text c="dimmed" size="sm">No runs yet. Connect Google Calendar in Settings → Family, then trigger a manual run.</Text>
        ) : (
          <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
            <Table striped highlightOnHover withRowBorders={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Alerts</Table.Th>
                  <Table.Th>Emails</Table.Th>
                  <Table.Th>Summary</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {digests.map(d => (
                  <Table.Tr key={d.id}>
                    <Table.Td>
                      <Text size="xs">
                        {new Date(d.runAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{RUN_TYPE_LABELS[d.runType] ?? d.runType}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" color={STATUS_COLORS[d.status]} variant="light">{d.status}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c={d.alertsCreated > 0 ? "red" : "dimmed"}>{d.alertsCreated}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">{d.emailsSent}</Text>
                    </Table.Td>
                    <Table.Td style={{ maxWidth: 260 }}>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {d.summaryText ?? d.skipReason ?? d.errorMessage ?? "—"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </Stack>
    </Stack>
  );
}
