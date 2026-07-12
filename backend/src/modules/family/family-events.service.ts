import { qAll, qGet } from "../../db/query.js";
import type { FamilyEvent, FamilyEventRecordType, FamilyEventRow, FamilyEventSource } from "./family.types.js";

function rowToEvent(row: FamilyEventRow): FamilyEvent {
  let assigneeIds: string[] = [];
  if (row.assignee_ids) {
    try {
      const parsed = JSON.parse(row.assignee_ids) as unknown;
      if (Array.isArray(parsed)) assigneeIds = parsed as string[];
    } catch {
      // ignore malformed JSON
    }
  }
  return {
    id: row.id,
    householdId: row.household_id,
    recordType: row.record_type,
    source: row.source,
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    dueDate: row.due_date,
    location: row.location,
    isRecurring: row.is_recurring,
    recurrenceRule: row.recurrence_rule,
    allDay: row.all_day,
    assigneeIds,
    gcalEventId: row.gcal_event_id,
    gcalCalendarId: row.gcal_calendar_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listFamilyEvents(
  householdId: string,
  recordType?: FamilyEventRecordType
): Promise<FamilyEvent[]> {
  const rows = recordType
    ? await qAll<FamilyEventRow>(
        `SELECT * FROM family_events
         WHERE household_id = ? AND record_type = ? AND is_active = TRUE
         ORDER BY COALESCE(start_at, due_date::timestamptz) ASC NULLS LAST, created_at ASC`,
        householdId,
        recordType
      )
    : await qAll<FamilyEventRow>(
        `SELECT * FROM family_events
         WHERE household_id = ? AND is_active = TRUE
         ORDER BY COALESCE(start_at, due_date::timestamptz) ASC NULLS LAST, created_at ASC`,
        householdId
      );
  return rows.map(rowToEvent);
}

export async function getFamilyEvent(
  id: string,
  householdId: string
): Promise<FamilyEvent | null> {
  const row = await qGet<FamilyEventRow>(
    `SELECT * FROM family_events WHERE id = ? AND household_id = ? AND is_active = TRUE`,
    id,
    householdId
  );
  return row ? rowToEvent(row) : null;
}

export type CreateFamilyEventInput = {
  recordType: FamilyEventRecordType;
  source?: FamilyEventSource;
  title: string;
  description?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  dueDate?: string | null;
  location?: string | null;
  isRecurring?: boolean;
  recurrenceRule?: string | null;
  allDay?: boolean;
  assigneeIds?: string[];
  gcalEventId?: string | null;
  gcalCalendarId?: string | null;
};

export async function createFamilyEvent(
  householdId: string,
  input: CreateFamilyEventInput
): Promise<FamilyEvent> {
  const row = await qGet<FamilyEventRow>(
    `INSERT INTO family_events
       (household_id, record_type, source, title, description,
        start_at, end_at, due_date, location, is_recurring, recurrence_rule, all_day,
        assignee_ids, gcal_event_id, gcal_calendar_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    householdId,
    input.recordType,
    input.source ?? "manual",
    input.title,
    input.description ?? null,
    input.startAt ?? null,
    input.endAt ?? null,
    input.dueDate ?? null,
    input.location ?? null,
    input.isRecurring ?? false,
    input.recurrenceRule ?? null,
    input.allDay ?? false,
    input.assigneeIds?.length ? JSON.stringify(input.assigneeIds) : null,
    input.gcalEventId ?? null,
    input.gcalCalendarId ?? null
  );
  return rowToEvent(row!);
}

export type UpdateFamilyEventInput = Partial<Omit<CreateFamilyEventInput, "recordType" | "source">>;

export async function updateFamilyEvent(
  id: string,
  householdId: string,
  input: UpdateFamilyEventInput
): Promise<FamilyEvent | null> {
  const setParts: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];

  if (input.title !== undefined) { setParts.push("title = ?"); params.push(input.title); }
  if (input.description !== undefined) { setParts.push("description = ?"); params.push(input.description ?? null); }
  if (input.startAt !== undefined) { setParts.push("start_at = ?"); params.push(input.startAt ?? null); }
  if (input.endAt !== undefined) { setParts.push("end_at = ?"); params.push(input.endAt ?? null); }
  if (input.dueDate !== undefined) { setParts.push("due_date = ?"); params.push(input.dueDate ?? null); }
  if (input.location !== undefined) { setParts.push("location = ?"); params.push(input.location ?? null); }
  if (input.isRecurring !== undefined) { setParts.push("is_recurring = ?"); params.push(input.isRecurring); }
  if (input.recurrenceRule !== undefined) { setParts.push("recurrence_rule = ?"); params.push(input.recurrenceRule ?? null); }
  if (input.allDay !== undefined) { setParts.push("all_day = ?"); params.push(input.allDay); }
  if (input.assigneeIds !== undefined) {
    setParts.push("assignee_ids = ?");
    params.push(input.assigneeIds?.length ? JSON.stringify(input.assigneeIds) : null);
  }

  if (setParts.length === 1) return getFamilyEvent(id, householdId);

  params.push(id, householdId);
  const row = await qGet<FamilyEventRow>(
    `UPDATE family_events SET ${setParts.join(", ")}
     WHERE id = ? AND household_id = ? AND is_active = TRUE
     RETURNING *`,
    ...params
  );
  return row ? rowToEvent(row) : null;
}

export async function deleteFamilyEvent(id: string, householdId: string): Promise<boolean> {
  const row = await qGet<{ id: string }>(
    `UPDATE family_events SET is_active = FALSE, updated_at = NOW()
     WHERE id = ? AND household_id = ? AND is_active = TRUE
     RETURNING id`,
    id,
    householdId
  );
  return row !== null;
}
