import { qAll, qExec, qGet } from "../../db/query.js";
import { log } from "../../logger.js";
import { chatModel, getChatAdapter } from "../../llm/index.js";
import { z } from "zod";
import {
  type CreateAvailabilityInput,
  type CreatePaPreferenceInput,
  type HelpAvailabilitySlot,
  type HouseholdMember,
  type PaPreference,
  type PaPreferenceCandidate,
  type PaPreferenceCategory,
  type PaPreferenceRow,
  type PaPreferenceTopicTag,
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

  const hasProfileChanges = setClauses.length > 0;

  if (hasProfileChanges) {
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
  }

  if (input.relationship !== undefined) {
    await qExec(
      `UPDATE household_membership SET relationship = ?
       WHERE person_profile_id = ? AND household_id = ?`,
      input.relationship, profileId, householdId
    );
  }

  if (!hasProfileChanges && input.relationship === undefined) {
    return getMember(profileId, householdId);
  }

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

// ── PA preferences / memory store (#165, topic_tag + search_memory + notes-extraction #238) ──
// `preference` rows are full-inclusion (see buildCaptureContextHeader in family-agent.service.ts)
// and always have topic_tag = NULL. `discovered_fact`/`decision_history` rows carry a topic_tag
// so the PA loop can pull them on demand via the search_memory tool (pa-task-runner.ts) instead.

function normalizeFactText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function preferenceFromRow(row: PaPreferenceRow): PaPreference {
  return {
    id: row.id,
    householdId: row.household_id,
    category: row.category,
    factText: row.fact_text,
    source: row.source,
    topicTag: row.topic_tag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPreferences(
  householdId: string,
  category?: PaPreferenceCategory
): Promise<PaPreference[]> {
  const rows = await qAll<PaPreferenceRow>(
    `SELECT * FROM household_pa_preferences
     WHERE household_id = ?
       ${category ? "AND category = ?" : ""}
     ORDER BY category, created_at`,
    ...(category ? [householdId, category] : [householdId])
  );
  return rows.map(preferenceFromRow);
}

/**
 * Text-based dedup (ratified 2026-07-12): exact/near-exact match (case-insensitive, whitespace-
 * normalized) against existing rows in the same household+category updates in place instead of
 * inserting a duplicate.
 */
export async function createPreference(
  householdId: string,
  input: CreatePaPreferenceInput
): Promise<PaPreference> {
  const normalized = normalizeFactText(input.factText);
  const existing = await qAll<PaPreferenceRow>(
    `SELECT * FROM household_pa_preferences WHERE household_id = ? AND category = ?`,
    householdId,
    input.category
  );
  const match = existing.find((row) => normalizeFactText(row.fact_text) === normalized);
  const topicTag = input.topicTag ?? null;
  if (match) {
    const updated = await qGet<PaPreferenceRow>(
      `UPDATE household_pa_preferences SET fact_text = ?, topic_tag = ?, updated_at = NOW() WHERE id = ? RETURNING *`,
      input.factText,
      topicTag,
      match.id
    );
    return preferenceFromRow(updated!);
  }

  const row = await qGet<PaPreferenceRow>(
    `INSERT INTO household_pa_preferences (household_id, category, fact_text, source, topic_tag)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
    householdId,
    input.category,
    input.factText,
    input.source ?? "manual",
    topicTag
  );
  return preferenceFromRow(row!);
}

/**
 * #239: manual correction path for the "Edit" (pencil) icon. Deliberately no cross-row dedup
 * check here — createPreference's dedup already prevents most duplicates at creation time, and an
 * edit is a manual correction of one specific row, not a new-fact write path.
 */
export async function updatePreference(
  id: number,
  householdId: string,
  input: CreatePaPreferenceInput
): Promise<PaPreference | undefined> {
  const row = await qGet<PaPreferenceRow>(
    `UPDATE household_pa_preferences
     SET category = ?, fact_text = ?, topic_tag = ?, updated_at = NOW()
     WHERE id = ? AND household_id = ?
     RETURNING *`,
    input.category,
    input.factText,
    input.topicTag ?? null,
    id,
    householdId
  );
  return row ? preferenceFromRow(row) : undefined;
}

export async function deletePreference(id: number, householdId: string): Promise<boolean> {
  const row = await qGet<{ id: number }>(
    `DELETE FROM household_pa_preferences WHERE id = ? AND household_id = ? RETURNING id`,
    id,
    householdId
  );
  return row !== undefined;
}

/**
 * #238: on-demand lookup for the PA loop's search_memory tool. discovered_fact/decision_history
 * rows are deliberately NOT full-included in every prompt (unlike preference rows) — the loop
 * fetches them by topic_tag only when relevant, keeping prompt size bounded as the table grows.
 */
export async function searchMemory(
  householdId: string,
  topicTag: PaPreferenceTopicTag
): Promise<PaPreference[]> {
  const rows = await qAll<PaPreferenceRow>(
    `SELECT * FROM household_pa_preferences
     WHERE household_id = ? AND category IN ('discovered_fact', 'decision_history') AND topic_tag = ?
     ORDER BY created_at DESC
     LIMIT 10`,
    householdId,
    topicTag
  );
  return rows.map(preferenceFromRow);
}

const TOPIC_TAGS = ["travel", "school", "health", "finance", "gifts", "household", "food", "interests", "other"] as const;
const CATEGORIES = ["preference", "discovered_fact", "decision_history"] as const;

const SUGGEST_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          personName: { type: "string", description: "Full name of the household member this fact is about, or everyone it names if shared." },
          category: {
            type: "string",
            enum: CATEGORIES,
            description: "The RECORD TYPE, not the subject matter — always one of the three literal enum values. Never a topic word like 'school' or 'travel'.",
          },
          factText: { type: "string", description: "A short, standalone sentence stating the fact — not a copy-paste of the source note. Consolidated across any duplicate or overlapping notes. Roughly one clause, no more than ~140 characters." },
          topicTag: {
            type: "string",
            enum: TOPIC_TAGS,
            description: "The topic bucket this fact belongs to — separate from and unrelated to the category field above.",
          },
        },
        required: ["personName", "category", "factText", "topicTag"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

const candidateSchema = z.object({
  personName: z.string(),
  category: z.enum(CATEGORIES),
  factText: z.string().trim().min(1),
  topicTag: z.enum(TOPIC_TAGS),
});

const suggestSchema = z.object({
  candidates: z.array(z.unknown()),
});

const TOPIC_TAG_GUIDE = `- travel: trips, vacations, flights, visas/citizenship, transit restrictions
- school: enrollment, grade, teachers, homework, school-tied extracurriculars
- health: medical/dental appointments, allergies, medications, checkups
- finance: money, accounts, bills, insurance, budgeting facts
- gifts: gift ideas, sizes, wishlist items, past gifts given
- household: recurring chores, caregiving/nanny schedules, home logistics, vendors
- food: cuisine preferences, dietary likes/dislikes, restaurants, recipes
- interests: hobbies, entertainment, media, non-school activities
- other: durable and worth remembering, but doesn't fit any tag above`;

const SUGGEST_SYSTEM = `You extract durable household-planning facts from personal notes so they can be
saved as structured memory for a planning assistant.

For each note, propose zero or more candidate facts:
- "preference": an ABSOLUTE, always-relevant constraint the assistant must honor on every task,
  regardless of topic — allergies/medical restrictions, dietary restrictions, visa/citizenship
  travel restrictions, or a rule explicitly stated as non-negotiable ("never", "always", "must").
  This is a high bar — use it sparingly.
- "discovered_fact": everything else worth remembering — recurring schedules, caregiving/nanny
  hours, interests, cuisine preferences, vendor details. This is the default for anything that
  isn't an absolute constraint, even if it recurs regularly (e.g. a nanny's fixed weekly hours are
  a discovered_fact with topic "household", not a preference — the assistant looks it up when a
  scheduling task needs it, rather than carrying it on every unrelated task).
- "decision_history": a past decision worth remembering for consistency (e.g. "chose X over Y
  because...").

Every candidate needs a topicTag from this fixed set, including "preference" candidates (topicTag
is used for browsability there, not for lookup — the assistant always has full preference rows in
context regardless of tag):
${TOPIC_TAG_GUIDE}

Before finalizing, consolidate:
- If the same person has multiple facts about the same topic (e.g. two separate notes about their
  favorite cuisines), merge them into ONE candidate instead of near-duplicate entries.
- If multiple household members share the same fact or interest (e.g. both spouses enjoy the same
  cuisine or hobby), merge them into ONE candidate whose personName names everyone who shares it
  (e.g. "Owner Test Name and Sam Spouse"), instead of one candidate per person.

Only propose candidates that are clearly useful to remember — skip vague or trivial notes. If a
note has nothing worth extracting, propose nothing for that person.

factText must be a short, standalone sentence stating the fact or preference itself — never a
copy-paste of the source note. Roughly one clause, no more than ~140 characters. Distill; don't
transcribe (e.g. a note rambling about a child's school, grade transition, and start date becomes
"Starting 1st grade at Northfield Academy in August 2026.", not the full sentence it came from).

Respond with JSON only: {"candidates": [{"personName": string, "category": "preference"|"discovered_fact"|"decision_history", "factText": string, "topicTag": "travel"|"school"|"health"|"finance"|"gifts"|"household"|"food"|"interests"|"other"}]}`;

/**
 * #238: household-wide (not per-person) on-demand notes scan. Returns unpersisted candidates —
 * nothing is written until the household approves via POST /pa-preferences per accepted row.
 * Filters out candidates that already match an existing row so approved suggestions never
 * duplicate what's already stored (createPreference's own dedup is a second backstop).
 */
export async function suggestPreferencesFromNotes(householdId: string): Promise<PaPreferenceCandidate[]> {
  const members = await listHouseholdMembers(householdId);
  const withNotes = members.filter((m) => m.notes && m.notes.trim().length > 0);
  if (withNotes.length === 0) return [];

  const notesBlock = withNotes.map((m) => `${m.fullName}: ${m.notes}`).join("\n\n");

  const { content } = await getChatAdapter().complete(
    [
      { role: "system", content: SUGGEST_SYSTEM },
      { role: "user", content: notesBlock },
    ],
    {
      model: chatModel(),
      maxTokens: 1200,
      temperature: 0,
      responseFormat: "json",
      jsonSchema: SUGGEST_JSON_SCHEMA,
      jsonSchemaName: "pa_preference_candidates",
    }
  );

  let raw: unknown;
  try {
    raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  } catch {
    raw = undefined;
  }
  const envelope = suggestSchema.safeParse(raw);
  if (!envelope.success) {
    log.warn("family-profiles: suggestPreferencesFromNotes got an unparseable response, discarding", {
      householdId,
      issues: envelope.error.issues,
      rawContent: content.slice(0, 300),
    });
    return [];
  }

  // Validate per-candidate rather than the whole array at once — one malformed candidate
  // (e.g. the model putting a topic word in the category field) shouldn't discard every
  // other valid candidate in the same response (#239 live-testing regression).
  const candidates: PaPreferenceCandidate[] = [];
  for (const raw of envelope.data.candidates) {
    const parsed = candidateSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn("family-profiles: suggestPreferencesFromNotes skipped one malformed candidate", {
        householdId,
        issues: parsed.error.issues,
        candidate: raw,
      });
      continue;
    }
    candidates.push(parsed.data);
  }

  const existing = await qAll<PaPreferenceRow>(
    `SELECT * FROM household_pa_preferences WHERE household_id = ?`,
    householdId
  );
  const existingNormalized = new Set(existing.map((row) => normalizeFactText(row.fact_text)));

  return candidates
    .filter((c) => !existingNormalized.has(normalizeFactText(c.factText)))
    .map((c) => ({
      personName: c.personName,
      category: c.category,
      factText: c.factText,
      topicTag: c.topicTag,
    }));
}

const CLASSIFY_PREFERENCE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: CATEGORIES,
      description: "The RECORD TYPE, not the subject matter — always one of the three literal enum values. Never a topic word like 'school' or 'travel'.",
    },
    topicTag: {
      type: "string",
      enum: TOPIC_TAGS,
      description: "The topic bucket this fact belongs to — separate from and unrelated to the category field above.",
    },
    factText: {
      type: "string",
      description: "A short, standalone sentence stating the fact — not a copy-paste of the input text. Roughly one clause, no more than ~140 characters.",
    },
  },
  required: ["category", "topicTag", "factText"],
  additionalProperties: false,
};

const classifyPreferenceSchema = z.object({
  category: z.enum(CATEGORIES),
  topicTag: z.enum(TOPIC_TAGS),
  factText: z.string().min(1),
});

const CLASSIFY_PREFERENCE_SYSTEM = `Classify a single household-planning fact for storage, and
synthesize it into a short standalone sentence.

Category — one of:
- "preference": an ABSOLUTE, always-relevant constraint — allergies/medical restrictions, dietary
  restrictions, visa/citizenship travel restrictions, or a rule explicitly stated as non-negotiable
  ("never", "always", "must"). This is a high bar — use it sparingly.
- "discovered_fact": everything else worth remembering, including recurring schedules/logistics
  that aren't stated as an absolute rule (e.g. a caregiving schedule is a discovered_fact with
  topic "household", not a preference).
- "decision_history": a past decision worth remembering for consistency.

Also assign a topicTag from the fixed set (used for browsability even on "preference" rows):
${TOPIC_TAG_GUIDE}

Also produce factText: a short, standalone sentence stating the fact or preference itself — never
a copy-paste or trimmed excerpt of the input text. Roughly one clause, no more than ~140
characters. Distill the core fact; drop hedging, source framing, and any surrounding narration.

Respond with JSON only: {"category": "preference"|"discovered_fact"|"decision_history", "topicTag": "travel"|"school"|"health"|"finance"|"gifts"|"household"|"food"|"interests"|"other", "factText": string}`;

/**
 * #238: used by the "Save as preference" button — classifies one ad-hoc string (e.g. a PA task
 * result) and synthesizes it into a short fact, so the user has a sensible starting
 * category/tag/text instead of picking from scratch or saving a raw blob. The frontend always
 * shows the suggestion as editable before persisting.
 */
export async function classifyPreferenceText(
  factText: string
): Promise<{ category: PaPreferenceCategory; topicTag: PaPreferenceTopicTag | null; factText: string }> {
  const { content } = await getChatAdapter().complete(
    [
      { role: "system", content: CLASSIFY_PREFERENCE_SYSTEM },
      { role: "user", content: factText },
    ],
    {
      model: chatModel(),
      maxTokens: 200,
      temperature: 0,
      responseFormat: "json",
      jsonSchema: CLASSIFY_PREFERENCE_JSON_SCHEMA,
      jsonSchemaName: "pa_preference_classification",
    }
  );

  let raw: unknown;
  try {
    raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  } catch {
    raw = undefined;
  }
  const parsed = classifyPreferenceSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn("family-profiles: classifyPreferenceText failed validation, defaulting to discovered_fact/other", {
      issues: parsed.error.issues,
      rawContent: content.slice(0, 300),
    });
    return { category: "discovered_fact", topicTag: "other", factText };
  }
  return {
    category: parsed.data.category,
    topicTag: parsed.data.topicTag,
    factText: parsed.data.factText,
  };
}
