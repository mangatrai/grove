import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
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
  fullName: string;
  email: string | null;
  phoneNumber: string | null;
  employmentStartDate: string;
  regularScheduleJson: Record<string, number>;
  isActive: boolean;
  hourlyRateCents: number;
  hasLogin: boolean;
};

const DAYS: Array<{ key: string; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

type NewStaffDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;
  employmentStartDate: string;
  hourlyRateUsd: number | undefined;
  schedule: Record<string, number>;
};

const EMPTY_DRAFT: NewStaffDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  dateOfBirth: "",
  employmentStartDate: "",
  hourlyRateUsd: undefined,
  schedule: {},
};

function scheduleSummary(schedule: Record<string, number>): string {
  const entries = DAYS.filter((d) => (schedule[d.key] ?? 0) > 0);
  if (entries.length === 0) return "No regular schedule set";
  return entries.map((d) => `${d.label} ${schedule[d.key]}h`).join(", ");
}

type StaffSectionProps = { active: boolean };

export function StaffSection({ active }: StaffSectionProps) {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<NewStaffDraft>({ ...EMPTY_DRAFT });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ members: StaffMember[] }>("/staff");
      setMembers(res.members);
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
          regularScheduleJson: draft.schedule,
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
      <Title order={3}>Household Staff</Title>
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
                  <Text size="xs" c="dimmed">{scheduleSummary(m.regularScheduleJson)}</Text>
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
          <Text size="sm" fw={500}>Regular schedule (hours per day)</Text>
          <Group align="end" grow>
            {DAYS.map((d) => (
              <NumberInput
                key={d.key}
                label={d.label}
                min={0}
                max={24}
                step={0.5}
                value={draft.schedule[d.key] ?? 0}
                onChange={(value) =>
                  setDraft((p) => ({
                    ...p,
                    schedule: { ...p.schedule, [d.key]: typeof value === "number" ? value : 0 },
                  }))
                }
                disabled={adding}
              />
            ))}
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
