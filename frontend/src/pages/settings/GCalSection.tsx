import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconBrandGoogle, IconCalendar, IconCheck, IconX } from "@tabler/icons-react";

import { apiFetch, apiJson } from "../../api";

type GCalStatus = {
  connected: boolean;
  needsReauth: boolean;
  connectedAt: string | null;
};

type CalendarItem = {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string | null;
};

type CalendarRole = "work" | "school" | "activities" | "other";

const ROLE_OPTIONS: { value: CalendarRole; label: string }[] = [
  { value: "work", label: "Work / personal" },
  { value: "school", label: "School (informational only)" },
  { value: "activities", label: "Kid activities" },
  { value: "other", label: "Other" },
];

type GCalCalendarsResponse = {
  calendars: CalendarItem[];
  selectedIds: string[];
  roles: Record<string, CalendarRole>;
};

type GCalSectionProps = {
  active: boolean;
};

export function GCalSection({ active }: GCalSectionProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<GCalStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<Record<string, CalendarRole>>({});
  const [calLoading, setCalLoading] = useState(false);
  const [calSaving, setCalSaving] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);
  const [calSaved, setCalSaved] = useState(false);

  const gcalParam = searchParams.get("gcal");
  const gcalMessage = searchParams.get("message");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<GCalStatus>("/gcal/status");
      setStatus(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Google Calendar status.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCalendars = useCallback(async () => {
    setCalLoading(true);
    setCalError(null);
    try {
      const res = await apiJson<GCalCalendarsResponse>("/gcal/calendars");
      setCalendars(res.calendars);
      setSelectedIds(res.selectedIds);
      setRoles(res.roles);
    } catch (e) {
      setCalError(e instanceof Error ? e.message : "Could not load calendar list.");
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadStatus();
  }, [active, loadStatus]);

  useEffect(() => {
    if (!active || !status?.connected || status.needsReauth) return;
    void loadCalendars();
  }, [active, status?.connected, status?.needsReauth, loadCalendars]);

  // Clear gcal callback params after reading on mount
  useEffect(() => {
    if (!gcalParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete("gcal");
    next.delete("message");
    setSearchParams(next, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await apiJson<{ url: string }>("/gcal/oauth/url");
      window.location.href = res.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Google Calendar connection.");
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      await apiFetch("/gcal/disconnect", { method: "DELETE" });
      setCalendars([]);
      setSelectedIds([]);
      setRoles({});
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function saveSelection() {
    if (selectedIds.length === 0) return;
    setCalSaving(true);
    setCalError(null);
    setCalSaved(false);
    try {
      await apiFetch("/gcal/calendars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIds }),
      });
      await apiFetch("/gcal/calendar-roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles }),
      });
      setCalSaved(true);
      setTimeout(() => setCalSaved(false), 3000);
    } catch (e) {
      setCalError(e instanceof Error ? e.message : "Could not save calendar selection.");
    } finally {
      setCalSaving(false);
    }
  }

  function toggleCalendar(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function setRole(id: string, role: CalendarRole) {
    setRoles(prev => ({ ...prev, [id]: role }));
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  }

  return (
    <Stack mt="md">
      <Title order={3}>Google Calendar</Title>
      <Text c="dimmed" size="sm">
        Connect your personal Google account so the Family Planner can read your calendar events.
        Each parent connects their own account independently.
      </Text>

      {gcalParam === "connected" ? (
        <Alert color="green" icon={<IconCheck size={16} />}>
          Google Calendar connected successfully.
        </Alert>
      ) : null}

      {gcalParam === "error" ? (
        <Alert color="red" icon={<IconX size={16} />}>
          {gcalMessage ? decodeURIComponent(gcalMessage) : "Google Calendar connection failed. Please try again."}
        </Alert>
      ) : null}

      {error ? <Alert color="red">{error}</Alert> : null}

      <Paper withBorder p="lg" radius="md">
        {loading ? (
          <Stack gap="sm">
            <Skeleton height={20} width={160} />
            <Skeleton height={14} width={240} />
          </Stack>
        ) : (
          <Stack gap="sm">
            <Group gap="sm">
              <IconCalendar size={20} stroke={1.5} />
              <Text fw={500}>Your Google Calendar</Text>
              {status?.connected ? (
                status.needsReauth ? (
                  <Badge color="yellow" variant="light">Needs re-authorization</Badge>
                ) : (
                  <Badge color="green" variant="light" leftSection={<IconCheck size={12} />}>Connected</Badge>
                )
              ) : (
                <Badge color="gray" variant="light">Not connected</Badge>
              )}
            </Group>

            {status?.connected && status.connectedAt ? (
              <Text size="xs" c="dimmed">Connected {formatDate(status.connectedAt)}</Text>
            ) : null}

            {status?.needsReauth ? (
              <Text size="sm" c="yellow.7">
                Your Google authorization expired or was revoked. Reconnect to restore calendar access.
              </Text>
            ) : null}

            <Divider mt="xs" />

            <Group mt="xs">
              {!status?.connected || status.needsReauth ? (
                <Button
                  leftSection={<IconBrandGoogle size={16} />}
                  loading={connecting}
                  onClick={() => void connect()}
                  variant={status?.needsReauth ? "filled" : "default"}
                  color={status?.needsReauth ? "yellow" : undefined}
                >
                  {status?.needsReauth ? "Reconnect Google Calendar" : "Connect Google Calendar"}
                </Button>
              ) : (
                <Button
                  variant="default"
                  color="red"
                  loading={disconnecting}
                  onClick={() => void disconnect()}
                >
                  Disconnect
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Paper>

      {/* Calendar picker — shown only when connected and not needing reauth */}
      {status?.connected && !status.needsReauth ? (
        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm">
            <Group gap="sm">
              <IconCalendar size={18} stroke={1.5} />
              <Text fw={500}>Calendars to sync</Text>
              {calSaved ? (
                <Badge color="green" variant="light" leftSection={<IconCheck size={12} />}>Saved</Badge>
              ) : null}
            </Group>
            <Text size="sm" c="dimmed">
              Choose which of your Google Calendars the family planner agent should read.
              If you select none, the agent reads all accessible calendars. Tag each calendar's
              role so the agent knows a school calendar's events are informational — not an
              actual parent commitment.
            </Text>

            {calError ? <Alert color="red">{calError}</Alert> : null}

            {calLoading ? (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">Loading calendars…</Text>
              </Group>
            ) : calendars.length === 0 ? (
              <Text size="sm" c="dimmed">No calendars found on this Google account.</Text>
            ) : (
              <Stack gap="xs">
                {calendars.map(cal => (
                  <Group key={cal.id} gap="sm" justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      {cal.backgroundColor ? (
                        <div
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            backgroundColor: cal.backgroundColor,
                            flexShrink: 0,
                          }}
                        />
                      ) : null}
                      <Checkbox
                        label={
                          <Text size="sm">
                            {cal.summary}
                            {cal.primary ? <Text component="span" size="xs" c="dimmed"> (primary)</Text> : null}
                          </Text>
                        }
                        checked={selectedIds.includes(cal.id)}
                        onChange={() => toggleCalendar(cal.id)}
                      />
                    </Group>
                    <Select
                      size="xs"
                      w={200}
                      data={ROLE_OPTIONS}
                      value={roles[cal.id] ?? "work"}
                      onChange={(value) => setRole(cal.id, (value as CalendarRole) ?? "work")}
                      allowDeselect={false}
                    />
                  </Group>
                ))}
              </Stack>
            )}

            {calendars.length > 0 ? (
              <Group mt="xs">
                <Button
                  size="sm"
                  loading={calSaving}
                  disabled={selectedIds.length === 0}
                  onClick={() => void saveSelection()}
                >
                  Save selection
                </Button>
                {selectedIds.length === 0 ? (
                  <Text size="xs" c="dimmed">Select at least one calendar</Text>
                ) : (
                  <Text size="xs" c="dimmed">{selectedIds.length} calendar{selectedIds.length !== 1 ? "s" : ""} selected</Text>
                )}
              </Group>
            ) : null}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}
