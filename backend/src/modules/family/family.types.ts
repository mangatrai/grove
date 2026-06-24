export type FamilyEventRecordType = "event" | "deadline";
export type FamilyEventSource = "gcal" | "tavily" | "manual";

export type FamilyEvent = {
  id: string;
  householdId: string;
  recordType: FamilyEventRecordType;
  source: FamilyEventSource;
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
  gcalEventId: string | null;
  gcalCalendarId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FamilyEventRow = {
  id: string;
  household_id: string;
  record_type: FamilyEventRecordType;
  source: FamilyEventSource;
  title: string;
  description: string | null;
  start_at: string | null;
  end_at: string | null;
  due_date: string | null;
  location: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  all_day: boolean;
  assignee_ids: string | null;
  gcal_event_id: string | null;
  gcal_calendar_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
