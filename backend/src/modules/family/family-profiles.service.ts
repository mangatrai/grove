import { qAll, qExec, qGet } from "../../db/query.js";
import {
  type CreateAvailabilityInput,
  type HelpAvailabilitySlot,
  type HouseholdMember,
  type UpdateAvailabilityInput,
  type UpdateMemberProfileInput,
} from "./family.types.js";

// ── Household members ──────────────────────────────────────────────────────

type MemberRow = {
  profile_id: string;
  full_name: string;
  relationship: string;
  age: number | null;
  linked_user_id: string | null;
  interests_json: string;
  notes: string | null;
};

function memberFromRow(row: MemberRow): HouseholdMember {
  let interestsJson: string[] = [];
  try {
    const parsed = JSON.parse(row.interests_json) as unknown;
    if (Array.isArray(parsed)) interestsJson = parsed as string[];
  } catch {
    // malformed JSON → empty array
  }
  return {
    profileId: row.profile_id,
    fullName: row.full_name,
    relationship: row.relationship,
    age: row.age,
    linkedUserId: row.linked_user_id,
    interestsJson,
    notes: row.notes,
  };
}

export async function listHouseholdMembers(householdId: string): Promise<HouseholdMember[]> {
  const rows = await qAll<MemberRow>(
    `SELECT pp.id AS profile_id,
            pp.full_name,
            hm.relationship,
            pp.age,
            pp.linked_user_id,
            pp.interests_json,
            pp.notes
     FROM person_profile pp
     JOIN household_membership hm ON hm.person_profile_id = pp.id
     WHERE hm.household_id = ?
     ORDER BY hm.relationship, pp.full_name`,
    householdId
  );
  return rows.map(memberFromRow);
}

export async function updateMemberProfile(
  profileId: string,
  householdId: string,
  input: UpdateMemberProfileInput
): Promise<HouseholdMember | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (input.interestsJson !== undefined) {
    setClauses.push("interests_json = ?");
    params.push(JSON.stringify(input.interestsJson));
  }
  if (input.notes !== undefined) {
    setClauses.push("notes = ?");
    params.push(input.notes);
  }
  if (input.age !== undefined) {
    setClauses.push("age = ?");
    params.push(input.age);
  }

  if (setClauses.length === 0) return getMember(profileId, householdId);

  params.push(profileId, householdId);
  await qExec(
    `UPDATE person_profile pp
     SET ${setClauses.join(", ")}
     FROM household_membership hm
     WHERE hm.person_profile_id = pp.id
       AND pp.id = ?
       AND hm.household_id = ?`,
    ...params
  );

  return getMember(profileId, householdId);
}

async function getMember(profileId: string, householdId: string): Promise<HouseholdMember | null> {
  const row = await qGet<MemberRow>(
    `SELECT pp.id AS profile_id,
            pp.full_name,
            hm.relationship,
            pp.age,
            pp.linked_user_id,
            pp.interests_json,
            pp.notes
     FROM person_profile pp
     JOIN household_membership hm ON hm.person_profile_id = pp.id
     WHERE pp.id = ? AND hm.household_id = ?`,
    profileId,
    householdId
  );
  return row ? memberFromRow(row) : null;
}

// ── Household help availability ────────────────────────────────────────────

type SlotRow = {
  id: string;
  household_id: string;
  person_profile_id: string;
  person_name: string;
  slot_type: string;
  service_type: string;
  days_of_week: string | null;
  specific_date: string | null;
  start_time: string | null;
  end_time: string | null;
  label: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

function parseDaysOfWeek(raw: string | null): number[] {
  if (!raw) return [];
  return raw.split(",").map(Number).filter(n => !isNaN(n));
}

function serializeDaysOfWeek(days: number[] | null | undefined): string | null {
  if (!days || days.length === 0) return null;
  return [...new Set(days)].sort((a, b) => a - b).join(",");
}

function slotFromRow(row: SlotRow): HelpAvailabilitySlot {
  return {
    id: row.id,
    householdId: row.household_id,
    personProfileId: row.person_profile_id,
    personName: row.person_name,
    slotType: row.slot_type as HelpAvailabilitySlot["slotType"],
    serviceType: row.service_type as HelpAvailabilitySlot["serviceType"],
    daysOfWeek: parseDaysOfWeek(row.days_of_week),
    specificDate: row.specific_date,
    startTime: row.start_time,
    endTime: row.end_time,
    label: row.label,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

const SLOT_SELECT = `
  SELECT hha.id,
         hha.household_id,
         hha.person_profile_id,
         pp.full_name AS person_name,
         hha.slot_type,
         hha.service_type,
         hha.days_of_week,
         hha.specific_date,
         hha.start_time,
         hha.end_time,
         hha.label,
         hha.notes,
         hha.is_active,
         hha.created_at
  FROM household_help_availability hha
  JOIN person_profile pp ON pp.id = hha.person_profile_id
`;

export async function listAvailability(
  householdId: string,
  includeInactive = false
): Promise<HelpAvailabilitySlot[]> {
  const rows = await qAll<SlotRow>(
    `${SLOT_SELECT}
     WHERE hha.household_id = ?
       ${includeInactive ? "" : "AND hha.is_active = TRUE"}
     ORDER BY hha.service_type, hha.slot_type, hha.specific_date NULLS LAST`,
    householdId
  );
  return rows.map(slotFromRow);
}

export async function createAvailability(
  householdId: string,
  input: CreateAvailabilityInput
): Promise<HelpAvailabilitySlot> {
  const id = crypto.randomUUID();
  await qExec(
    `INSERT INTO household_help_availability
       (id, household_id, person_profile_id, slot_type, service_type,
        days_of_week, specific_date, start_time, end_time, label, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    householdId,
    input.personProfileId,
    input.slotType,
    input.serviceType,
    serializeDaysOfWeek(input.daysOfWeek ?? null),
    input.specificDate ?? null,
    input.startTime ?? null,
    input.endTime ?? null,
    input.label ?? null,
    input.notes ?? null
  );

  const row = await qGet<SlotRow>(
    `${SLOT_SELECT} WHERE hha.id = ?`,
    id
  );
  return slotFromRow(row!);
}

export async function updateAvailability(
  id: string,
  householdId: string,
  input: UpdateAvailabilityInput
): Promise<HelpAvailabilitySlot | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  const fieldMap: [keyof UpdateAvailabilityInput, string][] = [
    ["slotType", "slot_type"],
    ["serviceType", "service_type"],
    ["specificDate", "specific_date"],
    ["startTime", "start_time"],
    ["endTime", "end_time"],
    ["label", "label"],
    ["notes", "notes"],
    ["isActive", "is_active"],
  ];

  if ("daysOfWeek" in input) {
    setClauses.push("days_of_week = ?");
    params.push(serializeDaysOfWeek(input.daysOfWeek ?? null));
  }

  for (const [key, col] of fieldMap) {
    if (key in input) {
      setClauses.push(`${col} = ?`);
      params.push(input[key] ?? null);
    }
  }

  if (setClauses.length === 0) {
    const row = await qGet<SlotRow>(`${SLOT_SELECT} WHERE hha.id = ? AND hha.household_id = ?`, id, householdId);
    return row ? slotFromRow(row) : null;
  }

  params.push(id, householdId);
  await qExec(
    `UPDATE household_help_availability
     SET ${setClauses.join(", ")}
     WHERE id = ? AND household_id = ?`,
    ...params
  );

  const row = await qGet<SlotRow>(`${SLOT_SELECT} WHERE hha.id = ?`, id);
  return row ? slotFromRow(row) : null;
}

export async function deleteAvailability(id: string, householdId: string): Promise<boolean> {
  const existing = await qGet<{ id: string }>(
    `SELECT id FROM household_help_availability WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  if (!existing) return false;
  await qExec(
    `DELETE FROM household_help_availability WHERE id = ? AND household_id = ?`,
    id,
    householdId
  );
  return true;
}
