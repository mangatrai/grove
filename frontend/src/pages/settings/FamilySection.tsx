import { useCallback, useEffect, useState } from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";

import { apiFetch, apiJson } from "../../api";
import { GroveLoader } from "../../components/GroveLoader";
import { GCalSection } from "./GCalSection";

type HouseholdMember = {
  profileId: string;
  fullName: string;
  relationship: string;
  age: number | null;
  linkedUserId: string | null;
  interestsJson: string[];
  notes: string | null;
};

type SlotType = "regular" | "one_off" | "unavailable";
type ServiceType = "nanny" | "babysitter" | "cleaner" | "activity_teacher" | "tutor" | "other";

type HelpAvailabilitySlot = {
  id: string;
  householdId: string;
  personProfileId: string;
  personName: string;
  slotType: SlotType;
  serviceType: ServiceType;
  daysOfWeek: number[];
  specificDate: string | null;
  startTime: string | null;
  endTime: string | null;
  label: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
};

type MemberDraft = {
  interestsJson: string[];
  notes: string;
  age: string;
  saving: boolean;
  error: string | null;
  success: boolean;
};

type SlotFormDraft = {
  personProfileId: string;
  slotType: string;
  serviceType: string;
  daysOfWeek: string[];
  specificDate: string;
  startTime: string;
  endTime: string;
  label: string;
  notes: string;
};

const EMPTY_SLOT_DRAFT: SlotFormDraft = {
  personProfileId: "",
  slotType: "regular",
  serviceType: "nanny",
  daysOfWeek: [],
  specificDate: "",
  startTime: "",
  endTime: "",
  label: "",
  notes: "",
};

const SERVICE_LABELS: Record<ServiceType, string> = {
  nanny: "Nanny",
  babysitter: "Babysitter",
  cleaner: "Cleaner",
  activity_teacher: "Activity Teacher",
  tutor: "Tutor",
  other: "Other",
};

const SLOT_TYPE_LABELS: Record<SlotType, string> = {
  regular: "Regular",
  one_off: "One-off",
  unavailable: "Unavailable",
};

const DAY_SELECT_DATA = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(day: number | null): string {
  if (day == null) return "—";
  return DAY_ABBR[day] ?? String(day);
}

function slotWhenLabel(slot: HelpAvailabilitySlot): string {
  const parts: string[] = [];
  if (slot.daysOfWeek.length > 0) parts.push(slot.daysOfWeek.map(dayLabel).join("/"));
  if (slot.specificDate) parts.push(slot.specificDate);
  if (slot.startTime || slot.endTime) {
    parts.push([slot.startTime, slot.endTime].filter(Boolean).join("–"));
  }
  return parts.join(", ") || "—";
}

const SERVICE_SELECT_DATA = [
  { value: "nanny", label: "Nanny" },
  { value: "babysitter", label: "Babysitter" },
  { value: "cleaner", label: "Cleaner" },
  { value: "activity_teacher", label: "Activity Teacher" },
  { value: "tutor", label: "Tutor" },
  { value: "other", label: "Other" },
];

const SLOT_TYPE_SELECT_DATA = [
  { value: "regular", label: "Regular" },
  { value: "one_off", label: "One-off" },
  { value: "unavailable", label: "Unavailable" },
];

function toSlotBody(f: SlotFormDraft, includePersonId: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    slotType: f.slotType,
    serviceType: f.serviceType,
    daysOfWeek: f.slotType !== "one_off" && f.daysOfWeek.length > 0 ? f.daysOfWeek.map(Number) : [],
    specificDate: f.slotType === "one_off" && f.specificDate ? f.specificDate : null,
    startTime: f.startTime.trim() || null,
    endTime: f.endTime.trim() || null,
    label: f.label.trim() || null,
    notes: f.notes.trim() || null,
  };
  if (includePersonId) {
    body.personProfileId = f.personProfileId;
  }
  return body;
}

type FamilySectionProps = { active: boolean };

export function FamilySection({ active }: FamilySectionProps) {
  // ── Members ──────────────────────────────────────────────────────────────
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>({});

  // ── Slots ─────────────────────────────────────────────────────────────────
  const [slots, setSlots] = useState<HelpAvailabilitySlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [newSlot, setNewSlot] = useState<SlotFormDraft>({ ...EMPTY_SLOT_DRAFT });
  const [addingSlot, setAddingSlot] = useState(false);
  const [addSlotError, setAddSlotError] = useState<string | null>(null);

  const [editSlot, setEditSlot] = useState<(SlotFormDraft & { id: string }) | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function initDrafts(ms: HouseholdMember[]) {
    const map: Record<string, MemberDraft> = {};
    for (const m of ms) {
      map[m.profileId] = {
        interestsJson: m.interestsJson,
        notes: m.notes ?? "",
        age: m.age == null ? "" : String(m.age),
        saving: false,
        error: null,
        success: false,
      };
    }
    setDrafts(map);
  }

  const load = useCallback(async () => {
    setMembersLoading(true);
    setSlotsLoading(true);
    setMembersError(null);
    setSlotsError(null);
    try {
      const [mRes, sRes] = await Promise.all([
        apiJson<{ members: HouseholdMember[] }>("/api/family/members"),
        apiJson<{ slots: HelpAvailabilitySlot[] }>("/api/family/availability"),
      ]);
      setMembers(mRes.members);
      initDrafts(mRes.members);
      setSlots(sRes.slots);
      setNewSlot((prev) => ({
        ...prev,
        personProfileId: prev.personProfileId || mRes.members[0]?.profileId || "",
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load family data";
      setMembersError(msg);
      setSlotsError(msg);
    } finally {
      setMembersLoading(false);
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  function setDraftField<K extends keyof MemberDraft>(profileId: string, key: K, value: MemberDraft[K]) {
    setDrafts((prev) => ({
      ...prev,
      [profileId]: { ...prev[profileId], [key]: value },
    }));
  }

  async function saveMember(profileId: string) {
    const draft = drafts[profileId];
    if (!draft) return;
    setDraftField(profileId, "saving", true);
    setDraftField(profileId, "error", null);
    setDraftField(profileId, "success", false);
    try {
      const ageVal = draft.age.trim() === "" ? null : Number(draft.age);
      await apiJson<{ member: HouseholdMember }>(
        `/api/family/members/${encodeURIComponent(profileId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            interestsJson: draft.interestsJson,
            notes: draft.notes.trim() || null,
            age: ageVal,
          }),
        }
      );
      setDraftField(profileId, "success", true);
      setTimeout(() => setDraftField(profileId, "success", false), 3000);
    } catch (e) {
      setDraftField(profileId, "error", e instanceof Error ? e.message : "Could not save");
    } finally {
      setDraftField(profileId, "saving", false);
    }
  }

  async function reloadSlots() {
    const sRes = await apiJson<{ slots: HelpAvailabilitySlot[] }>("/api/family/availability");
    setSlots(sRes.slots);
  }

  async function addSlot() {
    if (!newSlot.personProfileId) {
      setAddSlotError("Select a person.");
      return;
    }
    setAddingSlot(true);
    setAddSlotError(null);
    try {
      await apiJson<{ slot: HelpAvailabilitySlot }>("/api/family/availability", {
        method: "POST",
        body: JSON.stringify(toSlotBody(newSlot, true)),
      });
      await reloadSlots();
      setNewSlot((prev) => ({ ...EMPTY_SLOT_DRAFT, personProfileId: prev.personProfileId }));
    } catch (e) {
      setAddSlotError(e instanceof Error ? e.message : "Could not add entry");
    } finally {
      setAddingSlot(false);
    }
  }

  function openEdit(slot: HelpAvailabilitySlot) {
    setEditSlot({
      id: slot.id,
      personProfileId: slot.personProfileId,
      slotType: slot.slotType,
      serviceType: slot.serviceType,
      daysOfWeek: slot.daysOfWeek.map(String),
      specificDate: slot.specificDate ?? "",
      startTime: slot.startTime ?? "",
      endTime: slot.endTime ?? "",
      label: slot.label ?? "",
      notes: slot.notes ?? "",
    });
    setEditError(null);
  }

  async function saveEdit() {
    if (!editSlot) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await apiJson<{ slot: HelpAvailabilitySlot }>(
        `/api/family/availability/${encodeURIComponent(editSlot.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(toSlotBody(editSlot, false)),
        }
      );
      await reloadSlots();
      setEditSlot(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteSlot() {
    if (!deleteId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await apiFetch(`/api/family/availability/${encodeURIComponent(deleteId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSlots((prev) => prev.filter((s) => s.id !== deleteId));
      setDeleteId(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not remove entry");
    } finally {
      setDeleting(false);
    }
  }

  const memberSelectData = members.map((m) => ({ value: m.profileId, label: m.fullName }));
  const loading = membersLoading || slotsLoading;

  if (!active) return null;

  return (
    <Stack mt="md">

      {/* ── Household Members ──────────────────────────────────────────────── */}
      <Title order={3}>Household Members</Title>
      <Text c="dimmed" size="sm">Edit interests, notes, and age for each household member.</Text>
      {membersError ? <Alert color="red">{membersError}</Alert> : null}
      {membersLoading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading members…</Text>
        </Group>
      ) : null}
      {!membersLoading && members.length === 0 ? (
        <Text size="sm" c="dimmed">
          No household members found. Add members under the Household tab first.
        </Text>
      ) : null}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {members.map((m) => {
          const d = drafts[m.profileId];
          if (!d) return null;
          return (
            <Paper key={m.profileId} withBorder p="md" radius="md">
              <Stack gap="sm">
                <Group gap="xs" align="center">
                  <Text fw={600}>{m.fullName}</Text>
                  <Badge variant="light" color="gray" size="sm" tt="capitalize">
                    {m.relationship}
                  </Badge>
                </Group>
                <Group gap="sm" align="flex-end">
                  <TextInput
                    label="Age"
                    inputMode="numeric"
                    placeholder="e.g. 0"
                    value={d.age}
                    onChange={(e) => setDraftField(m.profileId, "age", e.currentTarget.value)}
                    disabled={d.saving}
                    style={{ width: 80 }}
                  />
                </Group>
                <TagsInput
                  label="Interests"
                  description="Hobbies, activities, subjects — up to 30 tags"
                  placeholder="Type and press Enter"
                  value={d.interestsJson}
                  onChange={(val) => setDraftField(m.profileId, "interestsJson", val.slice(0, 30))}
                  maxTags={30}
                  disabled={d.saving}
                  clearable
                />
                <Textarea
                  label="Notes"
                  placeholder="Allergies, preferences, school details, anything useful for the agent…"
                  value={d.notes}
                  onChange={(e) => setDraftField(m.profileId, "notes", e.currentTarget.value)}
                  disabled={d.saving}
                  maxLength={2000}
                  autosize
                  minRows={2}
                  maxRows={5}
                />
                {d.error ? <Alert color="red" p="xs">{d.error}</Alert> : null}
                {d.success ? <Alert color="green" p="xs">Saved.</Alert> : null}
                <Group>
                  <Button size="sm" loading={d.saving} onClick={() => void saveMember(m.profileId)}>
                    {d.saving ? "Saving…" : "Save"}
                  </Button>
                </Group>
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>

      <Divider my="lg" />

      {/* ── Care & Help Schedule ───────────────────────────────────────────── */}
      <Title order={3}>Care &amp; Help Schedule</Title>
      <Text c="dimmed" size="sm">
        Track regular and one-off care arrangements — nanny, babysitter, tutor, cleaner, and more.
      </Text>
      {slotsError ? <Alert color="red">{slotsError}</Alert> : null}
      {slotsLoading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading schedule…</Text>
        </Group>
      ) : null}
      {!slotsLoading && slots.length > 0 ? (
        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Person</Table.Th>
              <Table.Th>Service</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>When</Table.Th>
              <Table.Th>Label</Table.Th>
              <Table.Th style={{ width: 64 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {slots.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>{s.personName}</Table.Td>
                <Table.Td>{SERVICE_LABELS[s.serviceType] ?? s.serviceType}</Table.Td>
                <Table.Td>{SLOT_TYPE_LABELS[s.slotType] ?? s.slotType}</Table.Td>
                <Table.Td>{slotWhenLabel(s)}</Table.Td>
                <Table.Td>{s.label ?? "—"}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      onClick={() => openEdit(s)}
                      title="Edit entry"
                      aria-label="Edit entry"
                    >
                      <IconEdit size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => setDeleteId(s.id)}
                      title="Remove entry"
                      aria-label="Remove entry"
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : null}
      {!slotsLoading && slots.length === 0 ? (
        <Text size="sm" c="dimmed">No schedule entries yet.</Text>
      ) : null}

      {/* Add slot form */}
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group gap="xs" align="center">
            <IconPlus size={14} />
            <Text fw={600} size="sm">Add schedule entry</Text>
          </Group>
          <Group align="end" grow>
            <Select
              label="Person"
              data={memberSelectData}
              value={newSlot.personProfileId || null}
              onChange={(v) => setNewSlot((p) => ({ ...p, personProfileId: v ?? "" }))}
              disabled={addingSlot || loading || memberSelectData.length === 0}
              placeholder="Select person"
              allowDeselect={false}
            />
            <Select
              label="Service"
              data={SERVICE_SELECT_DATA}
              value={newSlot.serviceType}
              onChange={(v) => setNewSlot((p) => ({ ...p, serviceType: v ?? "nanny" }))}
              disabled={addingSlot}
              allowDeselect={false}
            />
            <Select
              label="Type"
              data={SLOT_TYPE_SELECT_DATA}
              value={newSlot.slotType}
              onChange={(v) => setNewSlot((p) => ({ ...p, slotType: v ?? "regular" }))}
              disabled={addingSlot}
              allowDeselect={false}
            />
          </Group>
          <Group align="end" grow>
            {newSlot.slotType !== "one_off" ? (
              <MultiSelect
                label="Days of week"
                data={DAY_SELECT_DATA}
                value={newSlot.daysOfWeek}
                onChange={(v) => setNewSlot((p) => ({ ...p, daysOfWeek: v }))}
                disabled={addingSlot}
                placeholder="Select days…"
                clearable
              />
            ) : (
              <TextInput
                label="Date"
                type="date"
                value={newSlot.specificDate}
                onChange={(e) => setNewSlot((p) => ({ ...p, specificDate: e.currentTarget.value }))}
                disabled={addingSlot}
              />
            )}
            <TextInput
              label="Start time"
              type="time"
              value={newSlot.startTime}
              onChange={(e) => setNewSlot((p) => ({ ...p, startTime: e.currentTarget.value }))}
              disabled={addingSlot}
            />
            <TextInput
              label="End time"
              type="time"
              value={newSlot.endTime}
              onChange={(e) => setNewSlot((p) => ({ ...p, endTime: e.currentTarget.value }))}
              disabled={addingSlot}
            />
            <TextInput
              label="Label (optional)"
              placeholder="e.g. Regular hours"
              value={newSlot.label}
              onChange={(e) => setNewSlot((p) => ({ ...p, label: e.currentTarget.value }))}
              disabled={addingSlot}
              maxLength={200}
            />
          </Group>
          {addSlotError ? <Alert color="red" p="xs">{addSlotError}</Alert> : null}
          <Group>
            <Button size="sm" loading={addingSlot} onClick={() => void addSlot()}>
              {addingSlot ? "Adding…" : "Add entry"}
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Divider my="lg" />

      {/* ── Google Calendar ────────────────────────────────────────────────── */}
      <GCalSection active={active} />

      {/* ── Edit slot modal ───────────────────────────────────────────────── */}
      <Modal
        opened={editSlot !== null}
        onClose={() => setEditSlot(null)}
        title="Edit schedule entry"
        centered
      >
        {editSlot ? (
          <Stack gap="sm">
            <Group align="end" grow>
              <Select
                label="Service"
                data={SERVICE_SELECT_DATA}
                value={editSlot.serviceType}
                onChange={(v) => setEditSlot((p) => p ? { ...p, serviceType: v ?? "nanny" } : null)}
                disabled={editSaving}
                allowDeselect={false}
              />
              <Select
                label="Type"
                data={SLOT_TYPE_SELECT_DATA}
                value={editSlot.slotType}
                onChange={(v) => setEditSlot((p) => p ? { ...p, slotType: v ?? "regular" } : null)}
                disabled={editSaving}
                allowDeselect={false}
              />
            </Group>
            <Group align="end" grow>
              {editSlot.slotType !== "one_off" ? (
                <MultiSelect
                  label="Days of week"
                  data={DAY_SELECT_DATA}
                  value={editSlot.daysOfWeek}
                  onChange={(v) => setEditSlot((p) => p ? { ...p, daysOfWeek: v } : null)}
                  disabled={editSaving}
                  placeholder="Select days…"
                  clearable
                />
              ) : (
                <TextInput
                  label="Date"
                  type="date"
                  value={editSlot.specificDate}
                  onChange={(e) =>
                    setEditSlot((p) => p ? { ...p, specificDate: e.currentTarget.value } : null)
                  }
                  disabled={editSaving}
                />
              )}
              <TextInput
                label="Start time"
                type="time"
                value={editSlot.startTime}
                onChange={(e) =>
                  setEditSlot((p) => p ? { ...p, startTime: e.currentTarget.value } : null)
                }
                disabled={editSaving}
              />
              <TextInput
                label="End time"
                type="time"
                value={editSlot.endTime}
                onChange={(e) =>
                  setEditSlot((p) => p ? { ...p, endTime: e.currentTarget.value } : null)
                }
                disabled={editSaving}
              />
            </Group>
            <TextInput
              label="Label (optional)"
              value={editSlot.label}
              onChange={(e) =>
                setEditSlot((p) => p ? { ...p, label: e.currentTarget.value } : null)
              }
              disabled={editSaving}
              maxLength={200}
            />
            <Textarea
              label="Notes (optional)"
              value={editSlot.notes}
              onChange={(e) =>
                setEditSlot((p) => p ? { ...p, notes: e.currentTarget.value } : null)
              }
              disabled={editSaving}
              maxLength={2000}
              autosize
              minRows={2}
            />
            {editError ? <Alert color="red" p="xs">{editError}</Alert> : null}
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setEditSlot(null)} disabled={editSaving}>
                Cancel
              </Button>
              <Button loading={editSaving} onClick={() => void saveEdit()}>
                Save
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      {/* ── Delete confirm modal ──────────────────────────────────────────── */}
      <Modal
        opened={deleteId !== null}
        onClose={() => { setDeleteId(null); setDeleteError(null); }}
        title="Remove schedule entry"
        centered
        size="sm"
      >
        <Stack>
          <Text size="sm">This entry will be permanently removed.</Text>
          {deleteError ? <Alert color="red" p="xs">{deleteError}</Alert> : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => { setDeleteId(null); setDeleteError(null); }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button color="red" loading={deleting} onClick={() => void deleteSlot()}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>

    </Stack>
  );
}
