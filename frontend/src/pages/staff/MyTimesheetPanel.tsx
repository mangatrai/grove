import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

import { apiJson } from "../../api";
import { GroveLoader } from "../../components/GroveLoader";

type TimesheetPeriodStatus = "draft" | "submitted" | "approved" | "rejected";

type TimesheetEntry = {
  id: string;
  workDate: string;
  hoursWorked: number;
  note: string | null;
};

type TimesheetPeriod = {
  id: string;
  weekStartDate: string;
  status: TimesheetPeriodStatus;
  submittedAt: string | null;
  reviewNote: string | null;
  entries: TimesheetEntry[];
  totalHours: number;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_META: Record<TimesheetPeriodStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "gray" },
  submitted: { label: "Submitted — awaiting approval", color: "blue" },
  approved: { label: "Approved", color: "green" },
  rejected: { label: "Rejected — edit and resubmit", color: "red" },
};

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toMondayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatDayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type MyTimesheetPanelProps = {
  /** Omit for self-service (staff role, locked to own record). Owner/admin must pass the selected staff member's id. */
  staffId?: string;
};

export function MyTimesheetPanel({ staffId }: MyTimesheetPanelProps) {
  const [weekStart, setWeekStart] = useState(() => toMondayIso(new Date().toISOString().slice(0, 10)));
  const [period, setPeriod] = useState<TimesheetPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hoursByDate, setHoursByDate] = useState<Record<string, number | undefined>>({});
  const [noteByDate, setNoteByDate] = useState<Record<string, string>>({});

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ weekStart });
      if (staffId) params.set("staffId", staffId);
      const res = await apiJson<{ period: TimesheetPeriod; scheduledHours: Record<string, number> }>(
        `/staff/timesheets/me?${params.toString()}`
      );
      setPeriod(res.period);
      const hours: Record<string, number | undefined> = {};
      const notes: Record<string, string> = {};
      if (res.period.entries.length > 0) {
        for (const e of res.period.entries) {
          hours[e.workDate] = e.hoursWorked;
          notes[e.workDate] = e.note ?? "";
        }
      } else {
        weekDates.forEach((date) => {
          const scheduled = res.scheduledHours[date] ?? 0;
          if (scheduled > 0) hours[date] = scheduled;
        });
      }
      setHoursByDate(hours);
      setNoteByDate(notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load timesheet");
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekDates, staffId]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = !period || period.status === "draft" || period.status === "rejected";

  const totalHours = useMemo(
    () =>
      Math.round(
        Object.values(hoursByDate).reduce<number>((sum, h) => sum + (h ?? 0), 0) * 100
      ) / 100,
    [hoursByDate]
  );

  const entriesPayload = useMemo(
    () =>
      weekDates
        .map((date) => ({ workDate: date, hoursWorked: hoursByDate[date], note: noteByDate[date]?.trim() || null }))
        .filter(
          (e): e is { workDate: string; hoursWorked: number; note: string | null } =>
            typeof e.hoursWorked === "number" && e.hoursWorked > 0
        ),
    [weekDates, hoursByDate, noteByDate]
  );

  async function saveDraft() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiJson<{ period: TimesheetPeriod }>("/staff/timesheets/me", {
        method: "PUT",
        body: JSON.stringify({ weekStartDate: weekStart, entries: entriesPayload, staffId }),
      });
      setPeriod(res.period);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save timesheet");
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await apiJson("/staff/timesheets/me", {
        method: "PUT",
        body: JSON.stringify({ weekStartDate: weekStart, entries: entriesPayload, staffId }),
      });
      const res = await apiJson<{ period: TimesheetPeriod }>("/staff/timesheets/me/submit", {
        method: "POST",
        body: JSON.stringify({ weekStartDate: weekStart, staffId }),
      });
      setPeriod(res.period);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit timesheet");
    } finally {
      setSubmitting(false);
    }
  }

  const statusMeta = period ? STATUS_META[period.status] : null;

  return (
    <Stack mt="sm">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <ActionIcon variant="default" onClick={() => setWeekStart((w) => addDaysIso(w, -7))} title="Previous week">
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text fw={600} size="sm">
            Week of {weekStart}
          </Text>
          <ActionIcon variant="default" onClick={() => setWeekStart((w) => addDaysIso(w, 7))} title="Next week">
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
        <TextInput
          type="date"
          size="xs"
          value={weekStart}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v) setWeekStart(toMondayIso(v));
          }}
          aria-label="Jump to week"
        />
      </Group>

      {statusMeta ? (
        <Badge color={statusMeta.color} variant="light" w="fit-content">
          {statusMeta.label}
        </Badge>
      ) : null}
      {period?.status === "rejected" && period.reviewNote ? (
        <Alert color="red" title="Rejected">
          {period.reviewNote}
        </Alert>
      ) : null}

      {loading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading…</Text>
        </Group>
      ) : null}
      {error ? <Alert color="red">{error}</Alert> : null}

      {!loading ? (
        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Day</Table.Th>
              <Table.Th>Hours</Table.Th>
              <Table.Th>Note</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {weekDates.map((date, i) => (
              <Table.Tr key={date}>
                <Table.Td>
                  <Text size="sm">
                    {DAY_LABELS[i]} {formatDayLabel(date)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    size="xs"
                    min={0}
                    max={24}
                    step={0.5}
                    value={hoursByDate[date] ?? ""}
                    onChange={(v) => setHoursByDate((p) => ({ ...p, [date]: typeof v === "number" ? v : undefined }))}
                    disabled={!editable || saving || submitting}
                  />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    size="xs"
                    placeholder="Optional note"
                    value={noteByDate[date] ?? ""}
                    onChange={(e) => setNoteByDate((p) => ({ ...p, [date]: e.currentTarget.value }))}
                    disabled={!editable || saving || submitting}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : null}

      <Group justify="space-between">
        <Text fw={600}>Total: {totalHours}h</Text>
        {editable ? (
          <Group>
            <Button variant="default" size="sm" loading={saving} onClick={() => void saveDraft()}>
              Save draft
            </Button>
            <Button size="sm" loading={submitting} disabled={totalHours <= 0} onClick={() => void submit()}>
              Submit for approval
            </Button>
          </Group>
        ) : null}
      </Group>
    </Stack>
  );
}
