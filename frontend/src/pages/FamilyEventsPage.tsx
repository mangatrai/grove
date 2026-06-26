import { useEffect, useState } from "react";

import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  Loader,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCalendarEvent, IconMapPin, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";

import { apiJson, apiFetch } from "../api";

type FamilyEvent = {
  id: string;
  recordType: "event" | "deadline";
  source: "gcal" | "tavily" | "manual";
  title: string;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  dueDate: string | null;
  location: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
  allDay: boolean;
  assigneeIds: string[];
  createdAt: string;
};

const SOURCE_LABELS: Record<string, string> = {
  gcal: "Google Calendar",
  tavily: "Agent",
  manual: "Manual",
};

const SOURCE_COLORS: Record<string, string> = {
  gcal: "blue",
  tavily: "violet",
  manual: "gray",
};

const RECURRENCE_DAY_NAMES: Record<string, string> = {
  "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat",
};

function formatRecurrenceRule(rule: string): string {
  const [freq, daysPart] = rule.split(":");
  const freqLabel = freq === "biweekly" ? "Biweekly" : freq === "monthly" ? "Monthly" : "Weekly";
  if (!daysPart) return freqLabel;
  const dayLabels = daysPart.split(",").map(d => RECURRENCE_DAY_NAMES[d] ?? d).join(", ");
  return `${freqLabel} · ${dayLabels}`;
}

function formatDateTime(iso: string | null, allDay: boolean): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString(undefined, { dateStyle: "medium" });
  return d.toLocaleDateString(undefined, { dateStyle: "medium" }) + " " +
    d.toLocaleTimeString(undefined, { timeStyle: "short" });
}

type EventRowProps = {
  event: FamilyEvent;
  onDelete: (id: string) => void;
};

function EventRow({ event, onDelete }: EventRowProps) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiFetch(`/api/family/events/${event.id}`, { method: "DELETE" });
      onDelete(event.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text fw={500} truncate>{event.title}</Text>
            <Badge size="xs" color={SOURCE_COLORS[event.source]} variant="light">
              {SOURCE_LABELS[event.source]}
            </Badge>
            {event.isRecurring ? <Badge size="xs" color="teal" variant="light">Recurring</Badge> : null}
            {event.allDay ? <Badge size="xs" color="orange" variant="light">All day</Badge> : null}
          </Group>
          <Group gap="sm">
            <Group gap={4}>
              <IconCalendarEvent size={13} stroke={1.5} />
              <Text size="xs" c="dimmed">
                {event.startAt ? formatDateTime(event.startAt, event.allDay) : "—"}
                {event.endAt && !event.allDay ? ` – ${formatDateTime(event.endAt, false)}` : ""}
              </Text>
            </Group>
            {event.location ? (
              <Group gap={4}>
                <IconMapPin size={13} stroke={1.5} />
                <Text size="xs" c="dimmed" truncate>{event.location}</Text>
              </Group>
            ) : null}
          </Group>
          {event.isRecurring && event.recurrenceRule ? (
            <Text size="xs" c="dimmed">{formatRecurrenceRule(event.recurrenceRule)}</Text>
          ) : null}
          {event.description ? (
            <Text size="sm" c="dimmed" lineClamp={2}>{event.description}</Text>
          ) : null}
        </Stack>
        <ActionIcon
          variant="subtle"
          color="red"
          size="sm"
          loading={deleting}
          onClick={() => void handleDelete()}
          aria-label="Delete event"
        >
          <IconTrash size={15} />
        </ActionIcon>
      </Group>
    </Paper>
  );
}

type AddEventFormProps = {
  onAdd: (event: FamilyEvent) => void;
  onClose: () => void;
};

function AddEventForm({ onAdd, onClose }: AddEventFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [location, setLocation] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFreq, setRecurrenceFreq] = useState<string | null>(null);
  const [recurrenceDays, setRecurrenceDays] = useState<string[]>([]);
  const [allDay, setAllDay] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiJson<{ event: FamilyEvent }>("/api/family/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordType: "event",
          source: "manual",
          title: title.trim(),
          description: description.trim() || null,
          startAt: startAt ? new Date(startAt).toISOString() : null,
          endAt: endAt ? new Date(endAt).toISOString() : null,
          location: location.trim() || null,
          isRecurring,
          recurrenceRule: isRecurring && recurrenceFreq
            ? recurrenceDays.length > 0
              ? `${recurrenceFreq}:${recurrenceDays.join(",")}`
              : recurrenceFreq
            : null,
          allDay,
        }),
      });
      onAdd(res.event);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save event.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="sm">
      <TextInput
        label="Title"
        placeholder="Swimming lessons, Doctor appointment…"
        value={title}
        onChange={e => setTitle(e.currentTarget.value)}
        required
        autoFocus
      />
      <Checkbox
        label="All-day event"
        checked={allDay}
        onChange={e => setAllDay(e.currentTarget.checked)}
      />
      <Group grow>
        <TextInput
          label={allDay ? "Date" : "Start"}
          type={allDay ? "date" : "datetime-local"}
          value={startAt}
          onChange={e => setStartAt(e.currentTarget.value)}
        />
        {!allDay ? (
          <TextInput
            label="End"
            type="datetime-local"
            value={endAt}
            onChange={e => setEndAt(e.currentTarget.value)}
          />
        ) : null}
      </Group>
      <TextInput
        label="Location"
        placeholder="Swim school, 123 Main St…"
        value={location}
        onChange={e => setLocation(e.currentTarget.value)}
      />
      <Checkbox
        label="Recurring"
        checked={isRecurring}
        onChange={e => setIsRecurring(e.currentTarget.checked)}
      />
      {isRecurring ? (
        <Group grow align="flex-start">
          <Select
            label="Frequency"
            placeholder="Pick frequency"
            value={recurrenceFreq}
            onChange={val => { setRecurrenceFreq(val); setRecurrenceDays([]); }}
            data={[
              { value: "weekly", label: "Weekly" },
              { value: "biweekly", label: "Biweekly" },
              { value: "monthly", label: "Monthly" },
            ]}
            allowDeselect={false}
          />
          {recurrenceFreq !== "monthly" ? (
            <MultiSelect
              label="Days of week"
              placeholder="Select days…"
              value={recurrenceDays}
              onChange={setRecurrenceDays}
              data={[
                { value: "1", label: "Mon" },
                { value: "2", label: "Tue" },
                { value: "3", label: "Wed" },
                { value: "4", label: "Thu" },
                { value: "5", label: "Fri" },
                { value: "6", label: "Sat" },
                { value: "0", label: "Sun" },
              ]}
            />
          ) : null}
        </Group>
      ) : null}
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
        <Button loading={submitting} onClick={() => void handleSubmit()}>Add event</Button>
      </Group>
    </Stack>
  );
}

export function FamilyEventsPage() {
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ events: FamilyEvent[] }>("/api/family/events?type=event");
      setEvents(res.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load events.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadEvents(); }, []);

  function handleAdd(event: FamilyEvent) {
    setEvents(prev => [event, ...prev]);
  }

  function handleDelete(id: string) {
    setEvents(prev => prev.filter(e => e.id !== id));
  }

  return (
    <>
      <Stack p="xl" gap="lg">
        <Group justify="space-between" align="center">
          <div>
            <Title order={2}>Events</Title>
            <Text c="dimmed" size="sm" mt={2}>
              Kid activities, appointments, and one-off events. Agent-synced from Google Calendar or added manually.
            </Text>
          </div>
          <Group gap="xs">
            <ActionIcon variant="subtle" onClick={() => void loadEvents()} disabled={loading} aria-label="Refresh">
              <IconRefresh size={18} stroke={1.5} />
            </ActionIcon>
            <Button leftSection={<IconPlus size={16} />} onClick={openDrawer}>
              Add event
            </Button>
          </Group>
        </Group>

        <Divider />

        {loading ? (
          <Group>
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading events…</Text>
          </Group>
        ) : error ? (
          <Text c="red" size="sm">{error}</Text>
        ) : events.length === 0 ? (
          <Stack align="center" py="xl" gap="sm">
            <IconCalendarEvent size={40} stroke={1} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" size="sm" ta="center">
              No events yet. Add one manually or connect Google Calendar in Settings → Family to let the agent sync.
            </Text>
            <Button variant="light" size="sm" leftSection={<IconPlus size={14} />} onClick={openDrawer}>
              Add first event
            </Button>
          </Stack>
        ) : (
          <Stack gap="sm">
            {events.map(ev => (
              <EventRow key={ev.id} event={ev} onDelete={handleDelete} />
            ))}
          </Stack>
        )}
      </Stack>

      <Drawer
        opened={drawerOpen}
        onClose={closeDrawer}
        title="Add event"
        position="right"
        size="md"
      >
        <AddEventForm onAdd={handleAdd} onClose={closeDrawer} />
      </Drawer>
    </>
  );
}
