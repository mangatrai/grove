import { useEffect, useState } from "react";

import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Drawer,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBell, IconCalendarDue, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";

import { apiJson, apiFetch } from "../api";

type Deadline = {
  id: string;
  recordType: "event" | "deadline";
  source: "gcal" | "tavily" | "manual";
  title: string;
  description: string | null;
  dueDate: string | null;
  createdAt: string;
};

const SOURCE_LABELS: Record<string, string> = {
  gcal: "Calendar",
  tavily: "Agent",
  manual: "Manual",
};

const SOURCE_COLORS: Record<string, string> = {
  gcal: "blue",
  tavily: "violet",
  manual: "gray",
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(iso);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyBadge(days: number | null) {
  if (days === null) return null;
  if (days < 0) return <Badge size="xs" color="red">Overdue</Badge>;
  if (days === 0) return <Badge size="xs" color="red">Today</Badge>;
  if (days <= 7) return <Badge size="xs" color="orange">{days}d</Badge>;
  if (days <= 30) return <Badge size="xs" color="yellow" variant="light">{days}d</Badge>;
  return <Badge size="xs" color="gray" variant="light">{days}d</Badge>;
}

type DeadlineRowProps = {
  deadline: Deadline;
  onDelete: (id: string) => void;
};

function DeadlineRow({ deadline, onDelete }: DeadlineRowProps) {
  const [deleting, setDeleting] = useState(false);
  const days = daysUntil(deadline.dueDate);

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiFetch(`/api/family/events/${deadline.id}`, { method: "DELETE" });
      onDelete(deadline.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text fw={500} truncate>{deadline.title}</Text>
            <Badge size="xs" color={SOURCE_COLORS[deadline.source]} variant="light">
              {SOURCE_LABELS[deadline.source]}
            </Badge>
            {urgencyBadge(days)}
          </Group>
          <Group gap={4}>
            <IconCalendarDue size={13} stroke={1.5} />
            <Text size="xs" c="dimmed">
              {deadline.dueDate
                ? new Date(deadline.dueDate).toLocaleDateString(undefined, { dateStyle: "medium" })
                : "No due date"}
            </Text>
          </Group>
          {deadline.description ? (
            <Text size="sm" c="dimmed" lineClamp={2}>{deadline.description}</Text>
          ) : null}
        </Stack>
        <ActionIcon
          variant="subtle"
          color="red"
          size="sm"
          loading={deleting}
          onClick={() => void handleDelete()}
          aria-label="Delete deadline"
        >
          <IconTrash size={15} />
        </ActionIcon>
      </Group>
    </Paper>
  );
}

type AddDeadlineFormProps = {
  onAdd: (deadline: Deadline) => void;
  onClose: () => void;
};

function AddDeadlineForm({ onAdd, onClose }: AddDeadlineFormProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiJson<{ event: Deadline }>("/api/family/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordType: "deadline",
          source: "manual",
          title: title.trim(),
          description: description.trim() || null,
          dueDate: dueDate || null,
        }),
      });
      onAdd(res.event);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save deadline.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="sm">
      <TextInput
        label="Title"
        placeholder="School registration, Camp signup…"
        value={title}
        onChange={e => setTitle(e.currentTarget.value)}
        required
        autoFocus
      />
      <TextInput
        label="Due date"
        type="date"
        value={dueDate}
        onChange={e => setDueDate(e.currentTarget.value)}
      />
      <Textarea
        label="Notes"
        placeholder="Optional details…"
        value={description}
        onChange={e => setDescription(e.currentTarget.value)}
        rows={3}
      />
      {error ? <Text c="red" size="sm">{error}</Text> : null}
      <Group justify="flex-end" mt="xs">
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button loading={submitting} onClick={() => void handleSubmit()}>Add deadline</Button>
      </Group>
    </Stack>
  );
}

export function FamilyDeadlinesPage() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);

  async function loadDeadlines() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ events: Deadline[] }>("/api/family/events?type=deadline");
      setDeadlines(res.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load deadlines.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDeadlines(); }, []);

  function handleAdd(deadline: Deadline) {
    setDeadlines(prev => [...prev, deadline].sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }));
  }

  function handleDelete(id: string) {
    setDeadlines(prev => prev.filter(d => d.id !== id));
  }

  return (
    <>
      <Stack p="xl" gap="lg" style={{ maxWidth: 800 }}>
        <Group justify="space-between" align="center">
          <div>
            <Title order={2}>Deadlines</Title>
            <Text c="dimmed" size="sm" mt={2}>
              Important dates — school registration, camp signups, appointments. Agent-found or added manually.
            </Text>
          </div>
          <Group gap="xs">
            <ActionIcon variant="subtle" onClick={() => void loadDeadlines()} disabled={loading} aria-label="Refresh">
              <IconRefresh size={18} stroke={1.5} />
            </ActionIcon>
            <Button leftSection={<IconPlus size={16} />} onClick={openDrawer}>
              Add deadline
            </Button>
          </Group>
        </Group>

        <Divider />

        {loading ? (
          <Group>
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading deadlines…</Text>
          </Group>
        ) : error ? (
          <Text c="red" size="sm">{error}</Text>
        ) : deadlines.length === 0 ? (
          <Stack align="center" py="xl" gap="sm">
            <IconBell size={40} stroke={1} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" size="sm" ta="center">
              No deadlines tracked yet. Add one manually — the agent will also surface relevant dates automatically.
            </Text>
            <Button variant="light" size="sm" leftSection={<IconPlus size={14} />} onClick={openDrawer}>
              Add first deadline
            </Button>
          </Stack>
        ) : (
          <Stack gap="sm">
            {deadlines.map(d => (
              <DeadlineRow key={d.id} deadline={d} onDelete={handleDelete} />
            ))}
          </Stack>
        )}
      </Stack>

      <Drawer
        opened={drawerOpen}
        onClose={closeDrawer}
        title="Add deadline"
        position="right"
        size="md"
      >
        <AddDeadlineForm onAdd={handleAdd} onClose={closeDrawer} />
      </Drawer>
    </>
  );
}
