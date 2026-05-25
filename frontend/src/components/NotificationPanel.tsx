import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Indicator,
  Paper,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconBell,
  IconBellOff,
  IconCheck,
  IconExternalLink,
} from "@tabler/icons-react";

import { apiJson, useAuthToken } from "../api";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 60_000;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NotificationPanel() {
  const token = useAuthToken();
  const navigate = useNavigate();

  const [opened, setOpened] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiJson<{ count: number }>("/notifications/unread-count");
      setUnreadCount(r.count);
    } catch {
      /* silently ignore poll failures */
    }
  }, [token]);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await apiJson<{ notifications: NotificationRow[] }>("/notifications");
      setNotifications(r.notifications);
      setUnreadCount(r.notifications.filter((n) => !n.readAt).length);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Start polling on mount
  useEffect(() => {
    if (!token) return;
    void fetchUnreadCount();
    pollRef.current = setInterval(() => void fetchUnreadCount(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token, fetchUnreadCount]);

  // Load full list when panel opens
  useEffect(() => {
    if (opened) {
      void fetchNotifications();
    }
  }, [opened, fetchNotifications]);

  async function markRead(id: string) {
    try {
      await apiJson(`/notifications/${id}/read`, { method: "PATCH" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    try {
      await apiJson("/notifications/read-all", { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  }

  function handleActionClick(n: NotificationRow) {
    if (!n.readAt) void markRead(n.id);
    if (n.actionUrl) {
      setOpened(false);
      navigate(n.actionUrl);
    }
  }

  if (!token) return null;

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      width={360}
      shadow="md"
      withArrow
    >
      <Popover.Target>
        <Indicator
          label={unreadCount > 99 ? "99+" : String(unreadCount)}
          size={16}
          disabled={unreadCount === 0}
          color="red"
          processing={unreadCount > 0}
        >
          <Tooltip label="Notifications" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              aria-label="Notifications"
              onClick={() => setOpened((o) => !o)}
            >
              <IconBell size={18} />
            </ActionIcon>
          </Tooltip>
        </Indicator>
      </Popover.Target>

      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py="sm">
          <Text fw={600} size="sm">Notifications</Text>
          {unreadCount > 0 ? (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconCheck size={12} />}
              onClick={() => void markAllRead()}
            >
              Mark all read
            </Button>
          ) : null}
        </Group>

        <Divider />

        {loading ? (
          <Text c="dimmed" size="sm" ta="center" py="xl">Loading…</Text>
        ) : notifications.length === 0 ? (
          <Stack align="center" gap="xs" py="xl">
            <IconBellOff size={28} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" size="sm">No notifications yet</Text>
          </Stack>
        ) : (
          <ScrollArea.Autosize mah={400}>
            {notifications.map((n) => (
              <Paper
                key={n.id}
                px="md"
                py="sm"
                style={{
                  cursor: n.actionUrl ? "pointer" : "default",
                  backgroundColor: n.readAt ? undefined : "var(--mantine-color-blue-light)",
                  borderBottom: "1px solid var(--mantine-color-default-border)"
                }}
                onClick={() => handleActionClick(n)}
              >
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap={6} wrap="nowrap">
                      {!n.readAt ? <Badge size="xs" color="blue" variant="dot" p={0} /> : null}
                      <Text size="sm" fw={n.readAt ? 400 : 600} truncate>
                        {n.title}
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {n.body}
                    </Text>
                    <Text size="xs" c="dimmed">{timeAgo(n.createdAt)}</Text>
                  </Stack>
                  {n.actionUrl ? <IconExternalLink size={14} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} /> : null}
                </Group>
              </Paper>
            ))}
          </ScrollArea.Autosize>
        )}

        <Divider />
        <Group justify="center" py="xs">
          <Button
            variant="subtle"
            size="xs"
            color="gray"
            onClick={() => { setOpened(false); navigate("/settings?tab=notifications"); }}
          >
            Notification settings →
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}
