import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  MultiSelect,
  Paper,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";

import { apiJson } from "../../api";
import { CurrencyInput } from "../../components/CurrencyInput";
import { GroveLoader } from "../../components/GroveLoader";
import { formatUsd } from "../../utils/format";

type StaffMember = {
  id: string;
  personProfileId: string;
  fullName: string;
  email: string | null;
  phoneNumber: string | null;
  employmentStartDate: string;
  isActive: boolean;
  hourlyRateCents: number;
  hasLogin: boolean;
};

type HelpAvailabilitySlot = {
  personProfileId: string;
  slotType: "regular" | "one_off" | "unavailable";
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
};

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scheduleSummary(slots: HelpAvailabilitySlot[], personProfileId: string): string | null {
  const regular = slots.filter((s) => s.personProfileId === personProfileId && s.slotType === "regular");
  if (regular.length === 0) return null;
  return regular
    .map((s) => {
      const days = s.daysOfWeek.map((d) => DAY_ABBR[d] ?? String(d)).join("/");
      const time = [s.startTime, s.endTime].filter(Boolean).join("–");
      return [days, time].filter(Boolean).join(" ");
    })
    .join("; ");
}

const DAY_SELECT_DATA = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

type NewStaffDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;
  employmentStartDate: string;
  hourlyRateUsd: number | undefined;
  schedule: { daysOfWeek: string[]; startTime: string; endTime: string };
};

const EMPTY_DRAFT: NewStaffDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  dateOfBirth: "",
  employmentStartDate: "",
  hourlyRateUsd: undefined,
  schedule: { daysOfWeek: [], startTime: "", endTime: "" },
};

type PendingTimesheet = {
  id: string;
  staffProfileId: string;
  staffFullName: string;
  weekStartDate: string;
  submittedAt: string | null;
  totalHours: number;
};

export function TimesheetApprovalQueue() {
  const [periods, setPeriods] = useState<PendingTimesheet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ periods: PendingTimesheet[] }>("/staff/timesheets/pending");
      setPeriods(res.periods);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load timesheets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiJson(`/staff/timesheets/${encodeURIComponent(id)}/approve`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve timesheet");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject(id: string) {
    if (!reviewNote.trim()) return;
    setBusyId(id);
    setError(null);
    try {
      await apiJson(`/staff/timesheets/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        body: JSON.stringify({ reviewNote: reviewNote.trim() }),
      });
      setRejectingId(null);
      setReviewNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reject timesheet");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Stack mt="lg">
      <Title order={4}>Timesheets awaiting approval</Title>
      {error ? <Alert color="red">{error}</Alert> : null}
      {loading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading…</Text>
        </Group>
      ) : null}
      {!loading && periods.length === 0 ? (
        <Text size="sm" c="dimmed">No timesheets awaiting approval.</Text>
      ) : null}
      {!loading && periods.length > 0 ? (
        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Staff</Table.Th>
              <Table.Th>Week of</Table.Th>
              <Table.Th>Hours</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {periods.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.staffFullName}</Table.Td>
                <Table.Td>{p.weekStartDate}</Table.Td>
                <Table.Td>{p.totalHours}h</Table.Td>
                <Table.Td>
                  {rejectingId === p.id ? (
                    <Group gap="xs" wrap="nowrap">
                      <TextInput
                        size="xs"
                        placeholder="Reason for rejecting"
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.currentTarget.value)}
                        disabled={busyId === p.id}
                      />
                      <Button
                        size="xs"
                        color="red"
                        disabled={!reviewNote.trim()}
                        loading={busyId === p.id}
                        onClick={() => void confirmReject(p.id)}
                      >
                        Confirm
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        disabled={busyId === p.id}
                        onClick={() => {
                          setRejectingId(null);
                          setReviewNote("");
                        }}
                      >
                        Cancel
                      </Button>
                    </Group>
                  ) : (
                    <Group gap="xs">
                      <Button size="xs" loading={busyId === p.id} onClick={() => void approve(p.id)}>
                        Approve
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        color="red"
                        disabled={busyId === p.id}
                        onClick={() => {
                          setRejectingId(p.id);
                          setReviewNote("");
                        }}
                      >
                        Reject
                      </Button>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : null}
    </Stack>
  );
}

type PendingExpense = {
  id: string;
  staffProfileId: string;
  staffFullName: string;
  expenseDate: string;
  category: string;
  amountCents: number;
  description: string | null;
};

export function ExpenseApprovalQueue() {
  const [expenses, setExpenses] = useState<PendingExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ expenses: PendingExpense[] }>("/staff/expenses/pending");
      setExpenses(res.expenses);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiJson(`/staff/expenses/${encodeURIComponent(id)}/approve`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve expense");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject(id: string) {
    if (!reviewNote.trim()) return;
    setBusyId(id);
    setError(null);
    try {
      await apiJson(`/staff/expenses/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        body: JSON.stringify({ reviewNote: reviewNote.trim() }),
      });
      setRejectingId(null);
      setReviewNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reject expense");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Stack mt="lg">
      <Title order={4}>Expenses awaiting approval</Title>
      {error ? <Alert color="red">{error}</Alert> : null}
      {loading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading…</Text>
        </Group>
      ) : null}
      {!loading && expenses.length === 0 ? (
        <Text size="sm" c="dimmed">No expenses awaiting approval.</Text>
      ) : null}
      {!loading && expenses.length > 0 ? (
        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Staff</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Amount</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {expenses.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>{e.staffFullName}</Table.Td>
                <Table.Td>{e.expenseDate}</Table.Td>
                <Table.Td>{e.category}</Table.Td>
                <Table.Td>{formatUsd(e.amountCents / 100)}</Table.Td>
                <Table.Td>{e.description ?? "—"}</Table.Td>
                <Table.Td>
                  {rejectingId === e.id ? (
                    <Group gap="xs" wrap="nowrap">
                      <TextInput
                        size="xs"
                        placeholder="Reason for rejecting"
                        value={reviewNote}
                        onChange={(ev) => setReviewNote(ev.currentTarget.value)}
                        disabled={busyId === e.id}
                      />
                      <Button
                        size="xs"
                        color="red"
                        disabled={!reviewNote.trim()}
                        loading={busyId === e.id}
                        onClick={() => void confirmReject(e.id)}
                      >
                        Confirm
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        disabled={busyId === e.id}
                        onClick={() => {
                          setRejectingId(null);
                          setReviewNote("");
                        }}
                      >
                        Cancel
                      </Button>
                    </Group>
                  ) : (
                    <Group gap="xs">
                      <Button size="xs" loading={busyId === e.id} onClick={() => void approve(e.id)}>
                        Approve
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        color="red"
                        disabled={busyId === e.id}
                        onClick={() => {
                          setRejectingId(e.id);
                          setReviewNote("");
                        }}
                      >
                        Reject
                      </Button>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : null}
    </Stack>
  );
}

type StaffDirectoryProps = { active: boolean };

export function StaffDirectory({ active }: StaffDirectoryProps) {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<NewStaffDraft>({ ...EMPTY_DRAFT });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [slots, setSlots] = useState<HelpAvailabilitySlot[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [staffRes, slotsRes] = await Promise.all([
        apiJson<{ members: StaffMember[] }>("/staff"),
        apiJson<{ slots: HelpAvailabilitySlot[] }>("/api/family/availability"),
      ]);
      setMembers(staffRes.members);
      setSlots(slotsRes.slots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  async function addStaff() {
    setAddError(null);
    setAddSuccess(null);
    if (!draft.firstName.trim() || !draft.email.trim() || !draft.employmentStartDate || !draft.hourlyRateUsd) {
      setAddError("First name, email, employment start date, and hourly rate are required.");
      return;
    }
    setAdding(true);
    try {
      const res = await apiJson<{ inviteSent: boolean }>("/staff", {
        method: "POST",
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim() || undefined,
          email: draft.email.trim(),
          phoneNumber: draft.phoneNumber.trim() || null,
          dateOfBirth: draft.dateOfBirth || null,
          employmentStartDate: draft.employmentStartDate,
          schedule:
            draft.schedule.daysOfWeek.length > 0 && draft.schedule.startTime && draft.schedule.endTime
              ? {
                  daysOfWeek: draft.schedule.daysOfWeek.map(Number),
                  startTime: draft.schedule.startTime,
                  endTime: draft.schedule.endTime,
                }
              : null,
          hourlyRateCents: Math.round(draft.hourlyRateUsd * 100),
        }),
      });
      setAddSuccess(
        res.inviteSent
          ? "Staff member added. An invite email was sent."
          : "Staff member added. Email is not configured — share the default password (ChangeMe123!) with them directly."
      );
      setDraft({ ...EMPTY_DRAFT });
      await load();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Could not add staff member");
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(member: StaffMember) {
    setTogglingId(member.id);
    try {
      await apiJson<{ member: StaffMember }>(`/staff/${encodeURIComponent(member.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !member.isActive }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update staff member");
    } finally {
      setTogglingId(null);
    }
  }

  if (!active) return null;

  return (
    <Stack mt="md">
      <Title order={2}>Household Staff</Title>
      <Text c="dimmed" size="sm">
        Onboard nannies or household employees for timesheet, expense, and pay tracking. No tax
        withholding is calculated — see the Admin Guide for details.
      </Text>
      {error ? <Alert color="red">{error}</Alert> : null}
      {loading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading staff…</Text>
        </Group>
      ) : null}
      {!loading && members.length > 0 ? (
        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Employment start</Table.Th>
              <Table.Th>Rate</Table.Th>
              <Table.Th>Schedule</Table.Th>
              <Table.Th>Login</Table.Th>
              <Table.Th>Active</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {members.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  <Text fw={600}>{m.fullName}</Text>
                  <Text size="xs" c="dimmed">{m.email}</Text>
                </Table.Td>
                <Table.Td>{m.employmentStartDate}</Table.Td>
                <Table.Td>{formatUsd(m.hourlyRateCents / 100)}/hr</Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    <Text size="xs">{scheduleSummary(slots, m.personProfileId) ?? "Not set"}</Text>
                    <Anchor size="xs" component={Link} to="/settings?tab=family">
                      Edit in Family tab
                    </Anchor>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  {m.hasLogin ? (
                    <Badge variant="light" color="green" size="sm">Has login</Badge>
                  ) : (
                    <Badge variant="light" color="gray" size="sm">No login</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Switch
                    checked={m.isActive}
                    disabled={togglingId === m.id}
                    onChange={() => void toggleActive(m)}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : null}
      {!loading && members.length === 0 ? (
        <Text size="sm" c="dimmed">No staff members added yet.</Text>
      ) : null}

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group gap="xs" align="center">
            <IconPlus size={14} />
            <Text fw={600} size="sm">Add staff member</Text>
          </Group>
          <Group align="end" grow>
            <TextInput
              label="First name"
              value={draft.firstName}
              onChange={(e) => setDraft((p) => ({ ...p, firstName: e.currentTarget.value }))}
              disabled={adding}
              placeholder="Jane"
            />
            <TextInput
              label="Last name"
              value={draft.lastName}
              onChange={(e) => setDraft((p) => ({ ...p, lastName: e.currentTarget.value }))}
              disabled={adding}
              placeholder="Doe"
            />
            <TextInput
              label="Email"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft((p) => ({ ...p, email: e.currentTarget.value }))}
              disabled={adding}
              placeholder="jane@example.com"
            />
          </Group>
          <Group align="end" grow>
            <TextInput
              label="Phone (optional)"
              type="tel"
              value={draft.phoneNumber}
              onChange={(e) => setDraft((p) => ({ ...p, phoneNumber: e.currentTarget.value }))}
              disabled={adding}
              placeholder="+1 555 000 0000"
            />
            <TextInput
              label="Date of birth (optional)"
              type="date"
              value={draft.dateOfBirth}
              onChange={(e) => setDraft((p) => ({ ...p, dateOfBirth: e.currentTarget.value }))}
              disabled={adding}
            />
            <TextInput
              label="Employment start date"
              type="date"
              value={draft.employmentStartDate}
              onChange={(e) => setDraft((p) => ({ ...p, employmentStartDate: e.currentTarget.value }))}
              disabled={adding}
            />
            <CurrencyInput
              label="Hourly rate (USD)"
              placeholder="e.g. 25.00"
              value={draft.hourlyRateUsd}
              onChange={(value) => setDraft((p) => ({ ...p, hourlyRateUsd: value }))}
              disabled={adding}
            />
          </Group>
          <Text size="sm" fw={500}>Regular schedule (optional)</Text>
          <Group align="end" grow>
            <MultiSelect
              label="Days of week"
              data={DAY_SELECT_DATA}
              value={draft.schedule.daysOfWeek}
              onChange={(value) => setDraft((p) => ({ ...p, schedule: { ...p.schedule, daysOfWeek: value } }))}
              disabled={adding}
            />
            <TextInput
              label="Start time"
              type="time"
              value={draft.schedule.startTime}
              onChange={(e) => setDraft((p) => ({ ...p, schedule: { ...p.schedule, startTime: e.currentTarget.value } }))}
              disabled={adding}
            />
            <TextInput
              label="End time"
              type="time"
              value={draft.schedule.endTime}
              onChange={(e) => setDraft((p) => ({ ...p, schedule: { ...p.schedule, endTime: e.currentTarget.value } }))}
              disabled={adding}
            />
          </Group>
          {addError ? <Alert color="red" p="xs">{addError}</Alert> : null}
          {addSuccess ? <Alert color="green" p="xs">{addSuccess}</Alert> : null}
          <Group>
            <Button size="sm" loading={adding} onClick={() => void addStaff()}>
              {adding ? "Adding…" : "Add staff member"}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}
