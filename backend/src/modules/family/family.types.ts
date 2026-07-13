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

// ── Household members ──────────────────────────────────────────────────────

export type HouseholdMember = {
  profileId: string;
  fullName: string;
  relationship: string;
  age: number | null;
  linkedUserId: string | null;
  interestsJson: string[];
  notes: string | null;
};

export type UpdateMemberProfileInput = {
  interestsJson?: string[];
  notes?: string | null;
  age?: number | null;
  relationship?: "self" | "spouse" | "child" | "dependent" | "employee" | "other";
};

// ── Household help availability ────────────────────────────────────────────

export type SlotType = "regular" | "one_off" | "unavailable";
export type ServiceType = "nanny" | "babysitter" | "cleaner" | "activity_teacher" | "tutor" | "other";

export type HelpAvailabilitySlot = {
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

export type CreateAvailabilityInput = {
  personProfileId: string;
  slotType: SlotType;
  serviceType: ServiceType;
  daysOfWeek?: number[] | null;
  specificDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  label?: string | null;
  notes?: string | null;
};

// ── PA quick-capture ──────────────────────────────────────────────────────────

export type CaptureActionType = "create_event" | "set_reminder" | "draft_message" | "note";

export type CaptureAction = {
  type: CaptureActionType;
  title: string;
  summary: string;
  /** Type-specific payload — date/time for events, recipient for messages, etc. */
  details: Record<string, unknown>;
};

export type CaptureResult = {
  responseText: string;
  actions: CaptureAction[];
};

// ── PA task loop (#164) ───────────────────────────────────────────────────────

/**
 * Verbatim fact extracted by the compression step (#164 A1). A second, uncompressed
 * accumulator alongside the compressed loop history so prices/contacts/URLs survive
 * to final synthesis, which a 150-token summary would otherwise drop.
 */
export type PAFinding = {
  fact: string;
  entity: string | null;
  sourceUrl: string | null;
  /** ISO date the tool call that produced this fact ran. */
  dateObserved: string;
  kind: "price" | "contact" | "option" | "constraint" | "other";
};

export type PATaskResult = {
  goal: string;
  /** 2-5 sentence synthesis for the user. */
  summary: string;
  actions: CaptureAction[];
  iterationsUsed: number;
  hitIterationCap: boolean;
  promptTokens: number;
  completionTokens: number;
  tavilyCalls: number;
};

/** #167: response of POST /family/agent/task — classifier picks which engine answered the note. */
export type PATaskResponse =
  | { type: "one_shot"; result: CaptureResult }
  | { type: "research_loop"; result: PATaskResult; runId: string };

// ─────────────────────────────────────────────────────────────────────────────

export type UpdateAvailabilityInput = {
  slotType?: SlotType;
  serviceType?: ServiceType;
  daysOfWeek?: number[] | null;
  specificDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  label?: string | null;
  notes?: string | null;
  isActive?: boolean;
};
