import { useCallback, useEffect, useState } from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
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

type PaPreferenceCategory = "preference" | "discovered_fact" | "decision_history";
type PaPreferenceSource = "manual" | "feedback" | "notes_extraction";
type PaPreferenceTopicTag =
  | "travel"
  | "school"
  | "health"
  | "finance"
  | "gifts"
  | "household"
  | "food"
  | "interests"
  | "other";

type PaPreference = {
  id: number;
  householdId: string;
  category: PaPreferenceCategory;
  factText: string;
  source: PaPreferenceSource;
  topicTag: PaPreferenceTopicTag | null;
  createdAt: string;
  updatedAt: string;
};

type PaPreferenceCandidate = {
  personName: string | null;
  category: PaPreferenceCategory;
  factText: string;
  topicTag: PaPreferenceTopicTag | null;
};

const PA_PREFERENCE_CATEGORY_LABELS: Record<PaPreferenceCategory, string> = {
  preference: "Preference",
  discovered_fact: "Discovered fact",
  decision_history: "Decision history",
};

const PA_PREFERENCE_SOURCE_LABELS: Record<PaPreferenceSource, string> = {
  manual: "Manual",
  feedback: "From feedback",
  notes_extraction: "From notes",
};

const PA_PREFERENCE_CATEGORY_SELECT_DATA = [
  { value: "preference", label: "Preference" },
  { value: "discovered_fact", label: "Discovered fact" },
  { value: "decision_history", label: "Decision history" },
];

const PA_PREFERENCE_TOPIC_TAG_LABELS: Record<PaPreferenceTopicTag, string> = {
  travel: "Travel",
  school: "School",
  health: "Health",
  finance: "Finance",
  gifts: "Gifts",
  household: "Household",
  food: "Food",
  interests: "Interests",
  other: "Other",
};

const PA_PREFERENCE_TOPIC_TAG_SELECT_DATA = [
  { value: "travel", label: "Travel" },
  { value: "school", label: "School" },
  { value: "health", label: "Health" },
  { value: "finance", label: "Finance" },
  { value: "gifts", label: "Gifts" },
  { value: "household", label: "Household" },
  { value: "food", label: "Food" },
  { value: "interests", label: "Interests" },
  { value: "other", label: "Other" },
];

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

  const [occasionNudgesEnabled, setOccasionNudgesEnabled] = useState(true);
  const [occasionSettingsLoading, setOccasionSettingsLoading] = useState(false);
  const [occasionSettingsSaving, setOccasionSettingsSaving] = useState(false);
  const [occasionSettingsError, setOccasionSettingsError] = useState<string | null>(null);

  // ── PA Preferences ──────────────────────────────────────────────────────────
  const [preferences, setPreferences] = useState<PaPreference[]>([]);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);

  const [newPreference, setNewPreference] = useState<{ category: PaPreferenceCategory; factText: string; topicTag: PaPreferenceTopicTag | null }>({
    category: "preference",
    factText: "",
    topicTag: null,
  });
  const [addingPreference, setAddingPreference] = useState(false);
  const [addPreferenceError, setAddPreferenceError] = useState<string | null>(null);

  const [deletePreferenceId, setDeletePreferenceId] = useState<number | null>(null);
  const [deletingPreference, setDeletingPreference] = useState(false);

  const [editPreference, setEditPreference] = useState<
    (Pick<PaPreference, "category" | "factText" | "topicTag"> & { id: number }) | null
  >(null);
  const [editPreferenceSaving, setEditPreferenceSaving] = useState(false);
  const [editPreferenceError, setEditPreferenceError] = useState<string | null>(null);
  const [deletePreferenceError, setDeletePreferenceError] = useState<string | null>(null);

  // ── PA Preferences: suggest-from-notes approval ─────────────────────────────
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PaPreferenceCandidate[]>([]);
  const [checkedCandidates, setCheckedCandidates] = useState<Set<number>>(new Set());
  const [approvingCandidates, setApprovingCandidates] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

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

  const loadOccasionSettings = useCallback(async () => {
    setOccasionSettingsLoading(true);
    setOccasionSettingsError(null);
    try {
      const res = await apiJson<{ settings: { enabled: boolean } }>("/api/family/occasion-settings");
      setOccasionNudgesEnabled(res.settings.enabled);
    } catch (e) {
      setOccasionSettingsError(e instanceof Error ? e.message : "Failed to load occasion nudge settings");
    } finally {
      setOccasionSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadOccasionSettings();
  }, [active, loadOccasionSettings]);

  const toggleOccasionNudges = useCallback(async (enabled: boolean) => {
    const prev = occasionNudgesEnabled;
    setOccasionNudgesEnabled(enabled);
    setOccasionSettingsSaving(true);
    setOccasionSettingsError(null);
    try {
      const res = await apiFetch("/api/family/occasion-settings", {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`Failed to save (${res.status})`);
    } catch (e) {
      setOccasionNudgesEnabled(prev);
      setOccasionSettingsError(e instanceof Error ? e.message : "Failed to save occasion nudge settings");
    } finally {
      setOccasionSettingsSaving(false);
    }
  }, [occasionNudgesEnabled]);

  const loadPreferences = useCallback(async () => {
    setPreferencesLoading(true);
    setPreferencesError(null);
    try {
      const res = await apiJson<{ preferences: PaPreference[] }>("/api/family/pa-preferences");
      setPreferences(res.preferences);
    } catch (e) {
      setPreferencesError(e instanceof Error ? e.message : "Failed to load PA preferences");
    } finally {
      setPreferencesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadPreferences();
  }, [active, loadPreferences]);

  async function addPreference() {
    if (!newPreference.factText.trim()) {
      setAddPreferenceError("Enter a fact.");
      return;
    }
    if (newPreference.category !== "preference" && !newPreference.topicTag) {
      setAddPreferenceError("Pick a topic tag.");
      return;
    }
    setAddingPreference(true);
    setAddPreferenceError(null);
    try {
      await apiJson<{ preference: PaPreference }>("/api/family/pa-preferences", {
        method: "POST",
        body: JSON.stringify({
          category: newPreference.category,
          factText: newPreference.factText.trim(),
          topicTag: newPreference.topicTag,
        }),
      });
      await loadPreferences();
      setNewPreference((prev) => ({ ...prev, factText: "", topicTag: null }));
    } catch (e) {
      setAddPreferenceError(e instanceof Error ? e.message : "Could not add preference");
    } finally {
      setAddingPreference(false);
    }
  }

  async function suggestFromNotes() {
    setSuggestModalOpen(true);
    setSuggesting(true);
    setSuggestError(null);
    setApproveError(null);
    try {
      const res = await apiJson<{ candidates: PaPreferenceCandidate[] }>("/api/family/pa-preferences/suggest", {
        method: "POST",
      });
      setCandidates(res.candidates);
      setCheckedCandidates(new Set(res.candidates.map((_, i) => i)));
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Could not fetch suggestions");
    } finally {
      setSuggesting(false);
    }
  }

  function updateCandidate(index: number, patch: Partial<PaPreferenceCandidate>) {
    setCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function toggleCandidate(index: number) {
    setCheckedCandidates((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function approveCandidates() {
    setApprovingCandidates(true);
    setApproveError(null);
    try {
      const selected = candidates.filter((_, i) => checkedCandidates.has(i));
      for (const c of selected) {
        await apiJson<{ preference: PaPreference }>("/api/family/pa-preferences", {
          method: "POST",
          body: JSON.stringify({
            category: c.category,
            factText: c.factText.trim(),
            topicTag: c.topicTag,
            source: "notes_extraction",
          }),
        });
      }
      await loadPreferences();
      setSuggestModalOpen(false);
      setCandidates([]);
      setCheckedCandidates(new Set());
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : "Could not save selected preferences");
    } finally {
      setApprovingCandidates(false);
    }
  }

  async function deletePreferenceRow() {
    if (deletePreferenceId === null) return;
    setDeletingPreference(true);
    setDeletePreferenceError(null);
    try {
      const res = await apiFetch(`/api/family/pa-preferences/${deletePreferenceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPreferences((prev) => prev.filter((p) => p.id !== deletePreferenceId));
      setDeletePreferenceId(null);
    } catch (e) {
      setDeletePreferenceError(e instanceof Error ? e.message : "Could not remove preference");
    } finally {
      setDeletingPreference(false);
    }
  }

  function openEditPreference(pref: PaPreference) {
    setEditPreference({
      id: pref.id,
      category: pref.category,
      factText: pref.factText,
      topicTag: pref.topicTag,
    });
    setEditPreferenceError(null);
  }

  async function saveEditPreference() {
    if (!editPreference) return;
    if (!editPreference.factText.trim()) {
      setEditPreferenceError("Enter a fact.");
      return;
    }
    if (editPreference.category !== "preference" && !editPreference.topicTag) {
      setEditPreferenceError("Pick a topic tag.");
      return;
    }
    setEditPreferenceSaving(true);
    setEditPreferenceError(null);
    try {
      await apiJson<{ preference: PaPreference }>(
        `/api/family/pa-preferences/${editPreference.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            category: editPreference.category,
            factText: editPreference.factText.trim(),
            topicTag: editPreference.topicTag,
          }),
        }
      );
      await loadPreferences();
      setEditPreference(null);
    } catch (e) {
      setEditPreferenceError(e instanceof Error ? e.message : "Could not save preference");
    } finally {
      setEditPreferenceSaving(false);
    }
  }

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

      {/* ── PA Preferences ────────────────────────────────────────────────── */}
      <Group justify="space-between" align="center">
        <Title order={3}>PA Preferences</Title>
        <Button size="xs" variant="light" onClick={() => void suggestFromNotes()}>
          Suggest from notes
        </Button>
      </Group>
      <Text c="dimmed" size="sm">
        Standing facts and constraints the planning assistant should always take into account —
        e.g. dietary restrictions, travel rules, recurring decisions. Discovered facts and decision
        history carry a topic tag so the assistant can look them up on demand instead of reading
        every fact on every run.
      </Text>
      {preferencesError ? <Alert color="red">{preferencesError}</Alert> : null}
      {preferencesLoading ? (
        <Group gap="sm">
          <GroveLoader size="sm" color="muted" />
          <Text size="sm" c="dimmed">Loading preferences…</Text>
        </Group>
      ) : null}
      {!preferencesLoading && preferences.length > 0 ? (
        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Fact</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Topic</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th style={{ width: 64 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {preferences.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.factText}</Table.Td>
                <Table.Td>{PA_PREFERENCE_CATEGORY_LABELS[p.category] ?? p.category}</Table.Td>
                <Table.Td>{p.topicTag ? PA_PREFERENCE_TOPIC_TAG_LABELS[p.topicTag] ?? p.topicTag : "—"}</Table.Td>
                <Table.Td>{PA_PREFERENCE_SOURCE_LABELS[p.source] ?? p.source}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      onClick={() => openEditPreference(p)}
                      title="Edit preference"
                      aria-label="Edit preference"
                    >
                      <IconEdit size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => setDeletePreferenceId(p.id)}
                      title="Remove preference"
                      aria-label="Remove preference"
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
      {!preferencesLoading && preferences.length === 0 ? (
        <Text size="sm" c="dimmed">No preferences saved yet.</Text>
      ) : null}

      {/* Add preference form */}
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group gap="xs" align="center">
            <IconPlus size={14} />
            <Text fw={600} size="sm">Add preference</Text>
          </Group>
          <Group align="end" grow>
            <Select
              label="Category"
              data={PA_PREFERENCE_CATEGORY_SELECT_DATA}
              value={newPreference.category}
              onChange={(v) =>
                setNewPreference((p) => ({ ...p, category: (v as PaPreferenceCategory) ?? "preference" }))
              }
              disabled={addingPreference}
              allowDeselect={false}
            />
            <Select
              label={newPreference.category === "preference" ? "Topic (optional)" : "Topic"}
              data={PA_PREFERENCE_TOPIC_TAG_SELECT_DATA}
              value={newPreference.topicTag}
              onChange={(v) => setNewPreference((p) => ({ ...p, topicTag: v as PaPreferenceTopicTag | null }))}
              disabled={addingPreference}
              placeholder="Pick a topic"
              clearable={newPreference.category === "preference"}
            />
          </Group>
          <Textarea
            label="Fact"
            placeholder="e.g. No Schengen transit — visa risk"
            value={newPreference.factText}
            onChange={(e) => setNewPreference((p) => ({ ...p, factText: e.currentTarget.value }))}
            disabled={addingPreference}
            autosize
            minRows={2}
          />
          {addPreferenceError ? <Alert color="red" p="xs">{addPreferenceError}</Alert> : null}
          <Group>
            <Button size="sm" loading={addingPreference} onClick={() => void addPreference()}>
              {addingPreference ? "Adding…" : "Add preference"}
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Divider my="lg" />

      {/* ── Google Calendar ────────────────────────────────────────────────── */}
      <GCalSection active={active} />

      <Divider my="lg" />

      {/* ── Occasion nudges ───────────────────────────────────────────────── */}
      <Paper p="md" withBorder radius="md">
        <Stack gap="sm">
          <Title order={3} size="h5">Occasion nudges</Title>
          <Text c="dimmed" size="sm">
            Birthday and holiday reminders in your weekly digest, with lead time to plan a gift.
          </Text>
          <Switch
            label="Enable occasion nudges"
            checked={occasionNudgesEnabled}
            disabled={occasionSettingsLoading || occasionSettingsSaving}
            onChange={(e) => void toggleOccasionNudges(e.currentTarget.checked)}
          />
          {occasionSettingsError ? <Alert color="red" p="xs">{occasionSettingsError}</Alert> : null}
        </Stack>
      </Paper>

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

      <Modal
        opened={editPreference !== null}
        onClose={() => { setEditPreference(null); setEditPreferenceError(null); }}
        title="Edit preference"
        centered
      >
        {editPreference ? (
          <Stack gap="sm">
            <Textarea
              label="Fact"
              value={editPreference.factText}
              onChange={(e) =>
                setEditPreference((p) => (p ? { ...p, factText: e.currentTarget.value } : null))
              }
              disabled={editPreferenceSaving}
              autosize
              minRows={2}
            />
            <Group align="end" grow>
              <Select
                label="Category"
                data={PA_PREFERENCE_CATEGORY_SELECT_DATA}
                value={editPreference.category}
                onChange={(v) =>
                  setEditPreference((p) => (p ? { ...p, category: (v as PaPreferenceCategory) ?? "preference" } : null))
                }
                disabled={editPreferenceSaving}
                allowDeselect={false}
              />
              <Select
                label={editPreference.category === "preference" ? "Topic (optional)" : "Topic"}
                data={PA_PREFERENCE_TOPIC_TAG_SELECT_DATA}
                value={editPreference.topicTag}
                onChange={(v) =>
                  setEditPreference((p) => (p ? { ...p, topicTag: v as PaPreferenceTopicTag | null } : null))
                }
                disabled={editPreferenceSaving}
                placeholder="Pick a topic"
                clearable={editPreference.category === "preference"}
              />
            </Group>
            {editPreferenceError ? <Alert color="red" p="xs">{editPreferenceError}</Alert> : null}
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => { setEditPreference(null); setEditPreferenceError(null); }} disabled={editPreferenceSaving}>
                Cancel
              </Button>
              <Button loading={editPreferenceSaving} onClick={() => void saveEditPreference()}>
                Save
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      <Modal
        opened={deletePreferenceId !== null}
        onClose={() => { setDeletePreferenceId(null); setDeletePreferenceError(null); }}
        title="Remove preference?"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">This preference will no longer be included in planning assistant context.</Text>
          {deletePreferenceError ? <Alert color="red" p="xs">{deletePreferenceError}</Alert> : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setDeletePreferenceId(null); setDeletePreferenceError(null); }}>
              Cancel
            </Button>
            <Button color="red" loading={deletingPreference} onClick={() => void deletePreferenceRow()}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={suggestModalOpen}
        onClose={() => { setSuggestModalOpen(false); setCandidates([]); setCheckedCandidates(new Set()); }}
        title="Suggest preferences from notes"
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Scanned each household member&apos;s notes for durable facts worth remembering. Review,
            edit, and uncheck anything that isn&apos;t useful before saving.
          </Text>
          {suggesting ? (
            <Group gap="sm">
              <GroveLoader size="sm" color="muted" />
              <Text size="sm" c="dimmed">Scanning notes…</Text>
            </Group>
          ) : null}
          {suggestError ? <Alert color="red" p="xs">{suggestError}</Alert> : null}
          {!suggesting && !suggestError && candidates.length === 0 ? (
            <Text size="sm" c="dimmed">No new facts found in current notes.</Text>
          ) : null}
          {candidates.map((c, i) => (
            <Paper key={i} withBorder p="sm" radius="md">
              <Stack gap="xs">
                <Group justify="space-between" align="flex-start">
                  <Checkbox
                    checked={checkedCandidates.has(i)}
                    onChange={() => toggleCandidate(i)}
                    label={c.personName ?? "Household"}
                  />
                </Group>
                <Textarea
                  value={c.factText}
                  onChange={(e) => updateCandidate(i, { factText: e.currentTarget.value })}
                  autosize
                  minRows={2}
                />
                <Group align="end" grow>
                  <Select
                    label="Category"
                    data={PA_PREFERENCE_CATEGORY_SELECT_DATA}
                    value={c.category}
                    onChange={(v) => {
                      const category = (v as PaPreferenceCategory) ?? "discovered_fact";
                      updateCandidate(i, { category });
                    }}
                    allowDeselect={false}
                  />
                  <Select
                    label={c.category === "preference" ? "Topic (optional)" : "Topic"}
                    data={PA_PREFERENCE_TOPIC_TAG_SELECT_DATA}
                    value={c.topicTag}
                    onChange={(v) => updateCandidate(i, { topicTag: v as PaPreferenceTopicTag | null })}
                    placeholder="Pick a topic"
                    clearable={c.category === "preference"}
                  />
                </Group>
              </Stack>
            </Paper>
          ))}
          {approveError ? <Alert color="red" p="xs">{approveError}</Alert> : null}
          {candidates.length > 0 ? (
            <Group justify="flex-end">
              <Button variant="default" onClick={() => { setSuggestModalOpen(false); setCandidates([]); setCheckedCandidates(new Set()); }}>
                Cancel
              </Button>
              <Button
                loading={approvingCandidates}
                disabled={checkedCandidates.size === 0}
                onClick={() => void approveCandidates()}
              >
                Approve selected ({checkedCandidates.size})
              </Button>
            </Group>
          ) : null}
        </Stack>
      </Modal>

    </Stack>
  );
}
