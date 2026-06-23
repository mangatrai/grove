import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Alert, Badge, Button, Divider, Group, Paper, Skeleton, Stack, Text, Title } from "@mantine/core";
import { IconBrandGoogle, IconCalendar, IconCheck, IconX } from "@tabler/icons-react";

import { apiFetch, apiJson } from "../../api";

type GCalStatus = {
  connected: boolean;
  needsReauth: boolean;
  connectedAt: string | null;
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

  useEffect(() => {
    if (!active) return;
    void loadStatus();
  }, [active, loadStatus]);

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
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setDisconnecting(false);
    }
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
    </Stack>
  );
}
