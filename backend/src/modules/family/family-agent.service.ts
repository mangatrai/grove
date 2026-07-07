import { google } from "googleapis";

import { getChatAdapter, getToolUseAdapter, isLlmConfigured, strongModel } from "../../llm/index.js";
import { SEARCH_WEB_TOOL, tavilySearch } from "../../llm/tools/tavily.js";
import { log } from "../../logger.js";
import { env } from "../../config/env.js";
import { sendMail } from "../mailer/mailer.service.js";
import { qAll, qExec, qGet } from "../../db/query.js";
import {
  buildOAuth2Client,
  type CalendarRole,
  getCalendarRoles,
  getDecryptedRefreshToken,
  heuristicCalendarRole
} from "../gcal/gcal.service.js";
import type { CaptureResult, FamilyEvent, FamilyEventRow, HelpAvailabilitySlot, HouseholdMember } from "./family.types.js";
import { listAvailability, listHouseholdMembers } from "./family-profiles.service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRunType = "sunday_preview" | "monday_digest" | "daily_delta" | "manual";

type ConnectedParent = {
  userId: string;
  email: string;
  selectedCalendarIds: string[] | null;
  lastSyncedAt: string | null;
};

export type CalendarEvent = {
  summary: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  calendarId: string;
  calendarName: string;
  role: CalendarRole;
};

type AlertItem = {
  alertType: "conflict" | "travel" | "coverage_gap" | "deadline_approaching" | "suggestion";
  reason: string;
  affectedDate: string | null;
  copyPasteText: string;
  recipientHint: string;
  calendarEventPayload?: {
    title: string;
    date: string;
    description: string;
  } | null;
};

type AgentAnalysis = {
  conflicts: AlertItem[];
  parentADigest: { subject: string; body: string } | null;
  parentBDigest: { subject: string; body: string } | null;
  summaryText: string;
  hasOutput: boolean;
};

type CoverageGapResult = { hasOutput: boolean; gaps: AlertItem[] };
type NannyCoordResult  = { hasOutput: boolean; items: AlertItem[] };
type ResearchItem      = { title: string; summary: string; category: string };
type ResearchResult    = { hasOutput: boolean; items: ResearchItem[] };
type DeadlineResult    = { hasOutput: boolean; alerts: AlertItem[] };

type PipelineOutputs = {
  coverageGaps: CoverageGapResult;
  nannyCoord: NannyCoordResult;
  research: ResearchResult;
  deadlines: DeadlineResult;
};

export type FamilyContext = {
  location: string;
  today: string;
  todayIso: string;
  members: HouseholdMember[];
  caregiverSlots: HelpAvailabilitySlot[];
  parentEvents: Array<{ email: string; events: CalendarEvent[] }>;
  dbEvents: FamilyEvent[];
  openAlerts: AgentAlert[];
};

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getConnectedParents(householdId: string): Promise<ConnectedParent[]> {
  type Row = {
    user_id: string;
    app_email: string;
    selected_calendar_ids: string | null;
    gcal_last_synced_at: string | null;
  };
  const rows = await qAll<Row>(
    `SELECT oi.user_id, u.email AS app_email, oi.selected_calendar_ids, oi.gcal_last_synced_at
     FROM oauth_integrations oi
     JOIN app_user u ON u.id = oi.user_id
     WHERE oi.provider = 'google_calendar'
       AND oi.household_id = ?
       AND oi.needs_reauth = FALSE
       AND oi.refresh_token IS NOT NULL`,
    householdId
  );
  return rows.map(r => {
    let selectedCalendarIds: string[] | null = null;
    if (r.selected_calendar_ids) {
      try {
        const parsed = JSON.parse(r.selected_calendar_ids) as unknown;
        if (Array.isArray(parsed)) selectedCalendarIds = parsed as string[];
      } catch { /* ignore */ }
    }
    return {
      userId: r.user_id,
      email: r.app_email,
      selectedCalendarIds,
      lastSyncedAt: r.gcal_last_synced_at,
    };
  });
}

async function updateLastSyncedAt(userId: string): Promise<void> {
  await qExec(
    `UPDATE oauth_integrations SET gcal_last_synced_at = NOW()
     WHERE provider = 'google_calendar' AND user_id = ?`,
    userId
  );
}

/**
 * `days` must cover the widest window any caller needs (FIX #212: the deadline sweep's
 * "next 30 days" prompt text was silently truncated to 14 days of actual data).
 */
async function getFamilyEventsForWeek(householdId: string, days = 14): Promise<FamilyEvent[]> {
  const rows = await qAll<FamilyEventRow>(
    `SELECT * FROM family_events
     WHERE household_id = ? AND is_active = TRUE
       AND (
         (start_at IS NOT NULL AND start_at >= NOW() AND start_at < NOW() + make_interval(days => ?::int))
         OR
         (due_date IS NOT NULL AND due_date::date >= CURRENT_DATE AND due_date::date < CURRENT_DATE + ?::int)
       )
     ORDER BY COALESCE(start_at, due_date::timestamptz) ASC NULLS LAST`,
    householdId,
    days,
    days
  );

  return rows.map(r => ({
    id: r.id,
    householdId: r.household_id,
    recordType: r.record_type,
    source: r.source,
    title: r.title,
    description: r.description,
    startAt: r.start_at,
    endAt: r.end_at,
    dueDate: r.due_date,
    location: r.location,
    isRecurring: r.is_recurring,
    recurrenceRule: r.recurrence_rule,
    allDay: r.all_day,
    assigneeIds: [],
    gcalEventId: r.gcal_event_id,
    gcalCalendarId: r.gcal_calendar_id,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

async function writeAlerts(
  householdId: string,
  digestId: string,
  conflicts: AgentAnalysis["conflicts"]
): Promise<void> {
  for (const c of conflicts) {
    const hasCalPayload = c.calendarEventPayload != null;
    await qExec(
      `INSERT INTO family_agent_alerts
         (household_id, alert_type, reason, affected_date, copy_paste_text, recipient_hint, source_digest_id, action_type, action_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      householdId,
      c.alertType,
      c.reason,
      c.affectedDate ?? null,
      c.copyPasteText,
      c.recipientHint,
      digestId,
      hasCalPayload ? "create_gcal_event" : null,
      hasCalPayload ? c.calendarEventPayload : null
    );
  }
}

async function writeDigestLog(
  householdId: string,
  runType: AgentRunType,
  status: "sent" | "skipped" | "error",
  opts: {
    skipReason?: string;
    alertsCreated?: number;
    emailsSent?: number;
    errorMessage?: string;
    subjectLine?: string;
    summaryText?: string;
  }
): Promise<string> {
  const row = await qGet<{ id: string }>(
    `INSERT INTO family_digest_log
       (household_id, run_type, status, skip_reason, alerts_created, emails_sent, error_message, subject_line, summary_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    householdId,
    runType,
    status,
    opts.skipReason ?? null,
    opts.alertsCreated ?? 0,
    opts.emailsSent ?? 0,
    opts.errorMessage ?? null,
    opts.subjectLine ?? null,
    opts.summaryText ?? null
  );
  return row!.id;
}

// ---------------------------------------------------------------------------
// GCal fetch
// ---------------------------------------------------------------------------

async function fetchCalendarEvents(
  parent: ConnectedParent,
  _opts: { fullFetch: boolean }
): Promise<CalendarEvent[]> {
  const refreshToken = await getDecryptedRefreshToken(parent.userId);
  if (!refreshToken) {
    log.warn("family-agent: refresh token missing or failed to decrypt", { userId: parent.userId });
    return [];
  }
  const auth = buildOAuth2Client(refreshToken);
  const calendar = google.calendar({ version: "v3", auth });

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch calendar list unconditionally — needed for names (role heuristic + prompt provenance),
  // not just to discover IDs when none were explicitly selected (FIX #212).
  const listRes = await calendar.calendarList.list({ minAccessRole: "reader" });
  const allCalendars = listRes.data.items ?? [];
  const nameById = new Map(allCalendars.map(c => [c.id ?? "", c.summary ?? c.id ?? "Calendar"]));

  const calendarIds = parent.selectedCalendarIds?.length
    ? parent.selectedCalendarIds
    : allCalendars.map(c => c.id).filter((id): id is string => !!id);

  const savedRoles = await getCalendarRoles(parent.userId);

  const events: CalendarEvent[] = [];

  for (const calId of calendarIds) {
    const calendarName = nameById.get(calId) ?? calId;
    const role: CalendarRole = savedRoles[calId] ?? heuristicCalendarRole(calendarName);
    try {
      const res = await calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 100,
      });
      for (const ev of res.data.items ?? []) {
        if (ev.status === "cancelled") continue;
        events.push({
          summary: ev.summary ?? "(no title)",
          start: ev.start?.dateTime ?? ev.start?.date ?? null,
          end: ev.end?.dateTime ?? ev.end?.date ?? null,
          allDay: !ev.start?.dateTime,
          location: ev.location ?? null,
          calendarId: calId,
          calendarName,
          role,
        });
      }
    } catch (err) {
      log.warn("family-agent: skipping calendar due to fetch error", { calId, err: String(err) });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Day grid (FIX #209 / #212) — deterministic day-by-day merge of parent
// commitments, school-calendar status, kid activities, and caregiver coverage.
// Computed in code (never left to the LLM) so weekday/date arithmetic and
// calendar-role exclusion are always correct, regardless of model behavior.
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localIsoDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: env.TZ }); // en-CA => YYYY-MM-DD
}

/** `iso` is a plain YYYY-MM-DD date (no time component) — safe to treat as UTC midnight for arithmetic. */
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayIndexOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function formatDateLabel(iso: string): string {
  const [, m, dd] = iso.split("-").map(Number);
  return `${DAY_NAMES[weekdayIndexOf(iso)]} ${MONTH_NAMES[m - 1]} ${dd}`;
}

function formatEventTime(ev: CalendarEvent): string {
  if (ev.allDay) return "all-day";
  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: env.TZ }) : "?";
  return `${fmt(ev.start)}–${fmt(ev.end)}`;
}

function eventCoversDate(ev: CalendarEvent, iso: string): boolean {
  if (!ev.start) return false;
  if (ev.allDay) {
    const startIso = ev.start.slice(0, 10);
    const endIso = ev.end ? ev.end.slice(0, 10) : addDaysIso(startIso, 1);
    return iso >= startIso && iso < endIso; // GCal all-day end date is exclusive
  }
  const startIso = localIsoDate(new Date(ev.start));
  const endIso = ev.end ? localIsoDate(new Date(ev.end)) : startIso;
  return iso >= startIso && iso <= endIso;
}

function dbEventCoversDate(ev: FamilyEvent, iso: string): boolean {
  if (ev.recordType !== "event" || !ev.startAt) return false;
  if (ev.allDay) {
    const startIso = ev.startAt.slice(0, 10);
    const endIso = ev.endAt ? ev.endAt.slice(0, 10) : addDaysIso(startIso, 1);
    return iso >= startIso && iso < endIso;
  }
  const startIso = localIsoDate(new Date(ev.startAt));
  const endIso = ev.endAt ? localIsoDate(new Date(ev.endAt)) : startIso;
  return iso >= startIso && iso <= endIso;
}

function caregiverActiveOnDate(slot: HelpAvailabilitySlot, iso: string, weekday: number): boolean {
  if (slot.slotType === "one_off") return slot.specificDate === iso;
  return slot.daysOfWeek.includes(weekday);
}

/**
 * Builds one text block per day covering `days` days starting today. Parent events tagged
 * role "school" are informational only (a school closure is not parent unavailability) and
 * are listed separately from actual parent commitments (FIX #212 calendar provenance).
 */
export function buildDayGrid(ctx: FamilyContext, days: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const iso = addDaysIso(ctx.todayIso, i);
    const weekday = weekdayIndexOf(iso);
    const parts: string[] = [`${formatDateLabel(iso)} (${iso}):`];

    ctx.parentEvents.forEach((p, idx) => {
      const dayEvents = p.events.filter(ev => ev.role !== "school" && eventCoversDate(ev, iso));
      if (dayEvents.length > 0) {
        parts.push(`  Parent ${String.fromCharCode(65 + idx)}: ` + dayEvents.map(ev => `${ev.summary} (${formatEventTime(ev)})`).join("; "));
      }
    });

    const schoolEvents = ctx.parentEvents.flatMap(p => p.events).filter(ev => ev.role === "school" && eventCoversDate(ev, iso));
    if (schoolEvents.length > 0) {
      parts.push(`  School (informational, not a parent commitment): ` + schoolEvents.map(ev => ev.summary).join("; "));
    }

    const caregiverToday = ctx.caregiverSlots.filter(s => caregiverActiveOnDate(s, iso, weekday));
    if (caregiverToday.length > 0) {
      parts.push(`  Caregiver: ` + caregiverToday.map(s => {
        const time = s.startTime && s.endTime ? ` ${s.startTime}–${s.endTime}` : "";
        return `${s.personName}${time}`;
      }).join("; "));
    }

    const activitiesToday = ctx.dbEvents.filter(ev => dbEventCoversDate(ev, iso));
    if (activitiesToday.length > 0) {
      parts.push(`  Activities: ` + activitiesToday.map(ev => ev.title).join("; "));
    }

    if (parts.length === 1) parts.push("  Nothing scheduled.");
    lines.push(parts.join("\n"));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// LLM analysis
// ---------------------------------------------------------------------------

async function buildFinanceContext(householdId: string): Promise<string> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since = thirtyDaysAgo.toISOString().slice(0, 10);

  const [spendRows, payslipRows] = await Promise.all([
    qAll<{ category: string; total: number }>(
      `SELECT COALESCE(c.name, 'Uncategorized') AS category, SUM(tc.amount) AS total
       FROM transaction_canonical tc
       LEFT JOIN category c ON c.id = tc.category_id
       WHERE tc.household_id = ? AND tc.direction = 'debit' AND tc.status = 'posted' AND tc.txn_date >= ?
       GROUP BY COALESCE(c.name, 'Uncategorized')
       ORDER BY total DESC
       LIMIT 5`,
      householdId, since
    ),
    qAll<{ pay_date: string; net_pay_current: number; employer_display_name: string | null }>(
      `SELECT pay_date, net_pay_current, employer_display_name
       FROM payslip_snapshot
       WHERE household_id = ?
       ORDER BY pay_date DESC
       LIMIT 2`,
      householdId
    ),
  ]);

  const spendLines = spendRows.length === 0
    ? "No spending data available (last 30 days)."
    : spendRows.map(r => `  ${r.category}: $${Number(r.total).toFixed(0)}`).join("\n");

  const payslipLines = payslipRows.length === 0
    ? "No payslips on file."
    : payslipRows.map(r => `  ${r.pay_date}: net $${Number(r.net_pay_current).toFixed(0)}${r.employer_display_name ? ` (${r.employer_display_name})` : ""}`).join("\n");

  return `Top spending categories (last 30 days):\n${spendLines}\n\nRecent payslips:\n${payslipLines}`;
}

// ---------------------------------------------------------------------------
// Household location helper
// ---------------------------------------------------------------------------

async function getHouseholdLocation(householdId: string): Promise<string> {
  const row = await qGet<{ city: string | null; state: string | null }>(
    `SELECT city, state FROM household WHERE id = ?`,
    householdId
  );
  if (!row?.city && !row?.state) return "";
  return [row.city, row.state].filter(Boolean).join(", ");
}

function getSeason(month: number): string {
  if (month >= 2 && month <= 4) return "Spring";
  if (month >= 5 && month <= 7) return "Summer";
  if (month >= 8 && month <= 10) return "Fall";
  return "Winter";
}

function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(cleaned) as T;
}

function buildMemberProfile(members: HouseholdMember[]): string {
  if (members.length === 0) return "No household members configured.";
  return members.map(m => {
    const parts = [`${m.fullName} (${m.relationship}${m.age != null ? `, age ${m.age}` : ""})`];
    if (m.interestsJson?.length) parts.push(`activities: ${m.interestsJson.join(", ")}`);
    if (m.notes) parts.push(m.notes);
    return parts.join(" — ");
  }).join("\n");
}

// ---------------------------------------------------------------------------
// Domain 1 — Coverage gap detection
// ---------------------------------------------------------------------------

async function analyzeCoverageGaps(ctx: FamilyContext, runType: AgentRunType): Promise<CoverageGapResult> {
  const children = ctx.members.filter(m => m.relationship === "child" || m.relationship === "dependent");
  if (children.length === 0) return { hasOutput: false, gaps: [] };

  const dayGrid = buildDayGrid(ctx, 14).join("\n\n");

  const caregiverLines = ctx.caregiverSlots.length === 0
    ? "No caregiver configured."
    : ctx.caregiverSlots.map(s => {
        const when = s.slotType === "one_off" && s.specificDate
          ? `one-off ${s.specificDate}`
          : s.daysOfWeek.length > 0 ? `every ${s.daysOfWeek.map(d => DAY_NAMES[d] ?? d).join("/")}` : "TBD";
        const time = s.startTime && s.endTime ? ` ${s.startTime}–${s.endTime}` : "";
        return `- ${s.personName} [${s.serviceType}]: ${when}${time}`;
      }).join("\n");

  const childLines = children.map(m => `- ${m.fullName}${m.age !== null ? ` (age ${m.age})` : ""}`).join("\n");
  const openGapAlerts = ctx.openAlerts
    .filter(a => a.alertType === "coverage_gap")
    .map(a => `- ${a.affectedDate ?? "no date"}: ${a.reason}`)
    .join("\n");

  const memberProfile = buildMemberProfile(ctx.members);

  const prompt = `Today: ${ctx.today}. Run: ${runType}.

Household members:
${memberProfile}
↑ Use these profiles when assessing gaps: check ages, school schedules in notes, and activity times — a child at school or a confirmed activity during a gap window is not at risk and should not be flagged.

Children needing care:
${childLines}

Caregiver schedule (CONFIRMED — these slots are already covered, do NOT ask to confirm them):
${caregiverLines}

Day-by-day schedule (next 14 days) — merges parent commitments (with start/end times), school-calendar
status (informational only — never counts as parent unavailability), caregiver coverage, and kid activities:
${dayGrid}

${openGapAlerts ? `Already flagged coverage gaps (DO NOT re-flag):\n${openGapAlerts}\n` : ""}
Identify GENUINE childcare gaps only — windows where a child has no adult present because ALL of the following are true:
1. BOTH parents are simultaneously unavailable (overlapping commitments on the SAME time window), AND
2. The caregiver is NOT scheduled during that window.

Rules you must follow:
- If the caregiver is scheduled during an event's time, that time is COVERED. Do not flag it.
- A parent taking a child to a doctor or dentist appointment is NOT a gap. The child is with the parent; other children remain with the caregiver as normal.
- If only one parent's calendar is shown (the other shows "No events"), assume the other parent is AVAILABLE — absence of calendar data does not mean unavailability.
- An event with a location far from home (e.g., a workshop or conference in another city) during a time when a child activity is scheduled IS worth flagging if it creates a pickup or dropoff gap outside caregiver hours.
- Only flag situations where children would genuinely have NO adult present. Err strongly toward returning an empty gaps array.

Respond with ONLY valid JSON: { "gaps": [ { "alertType": "coverage_gap", "reason": "...", "affectedDate": "YYYY-MM-DD or null", "copyPasteText": "ready-to-send message", "recipientHint": "Nanny"|"Spouse"|"Both"|"Self" } ] }
If no gaps, return { "gaps": [] }.`;

  const { content } = await getChatAdapter().complete(
    [
      { role: "system", content: "You are a careful childcare coverage analyst for a household PA. Identify genuine gaps where children have no adult present — use member ages, school schedules, and activity context from their profiles to reason precisely. A school-age child at school or at an activity during the flagged window is not at risk. Err strongly toward empty results. Return valid JSON only." },
      { role: "user", content: prompt },
    ],
    { model: strongModel(), maxTokens: 800 }
  );

  try {
    const parsed = parseJsonResponse<{ gaps: AlertItem[] }>(content);
    return { hasOutput: parsed.gaps.length > 0, gaps: parsed.gaps };
  } catch {
    log.warn("family-agent: Domain 1 coverage gap parse failed", { raw: content.slice(0, 200) });
    return { hasOutput: false, gaps: [] };
  }
}

// ---------------------------------------------------------------------------
// Domain 2 — Nanny coordination
// ---------------------------------------------------------------------------

async function assessNannyCoordination(ctx: FamilyContext, runType: AgentRunType): Promise<NannyCoordResult> {
  if (ctx.caregiverSlots.length === 0) return { hasOutput: false, items: [] };

  const dayGrid = buildDayGrid(ctx, 14).join("\n\n");

  const caregiverLines = ctx.caregiverSlots.map(s => {
    const when = s.slotType === "one_off" && s.specificDate
      ? `one-off ${s.specificDate}`
      : s.daysOfWeek.length > 0 ? `every ${s.daysOfWeek.map(d => DAY_NAMES[d] ?? d).join("/")}` : "TBD";
    const time = s.startTime && s.endTime ? ` ${s.startTime}–${s.endTime}` : "";
    return `- ${s.personName} [${s.serviceType}]: ${when}${time}${s.notes ? ` — ${s.notes}` : ""}`;
  }).join("\n");

  const memberProfile = buildMemberProfile(ctx.members);

  const prompt = `Today: ${ctx.today}. Run: ${runType}.

Household members:
${memberProfile}
↑ Use these profiles to assess whether coordination is genuinely needed: a school-age child at school during a gap does not need home coverage; an infant home full-time does.

Caregiver schedule (CONFIRMED regular hours — already arranged, no need to reconfirm):
${caregiverLines}

Day-by-day schedule (next 14 days) — merges parent commitments (with start/end times), school-calendar
status (informational only), caregiver coverage, and kid activities:
${dayGrid}

Flag ONLY genuine caregiver coordination needs that require action BEYOND the regular schedule above.
Flag these:
- Parent traveling overnight or to a multi-day conference requiring care on days the caregiver is not scheduled.
- Events that START before or END after the caregiver's scheduled hours on a given day, where a child needs to be present (e.g., early-morning school drop-off before caregiver arrives, or a late evening activity after caregiver leaves).
- Both parents simultaneously away on a day the caregiver is not scheduled.

Do NOT flag these:
- ANY appointment, meeting, or activity that falls WITHIN the caregiver's already-scheduled hours. The caregiver is present — no coordination needed.
- Parent working from home on a normal day.
- Medical appointments or child appointments during caregiver hours.
- "Busy" or "fully-booked" days where the caregiver is already on duty.
- Anything speculative or not directly evidenced by the calendar data above.

Respond with ONLY valid JSON: { "items": [ { "alertType": "coverage_gap"|"conflict"|"suggestion", "reason": "...", "affectedDate": "YYYY-MM-DD or null", "copyPasteText": "...", "recipientHint": "Nanny"|"Spouse"|"Both"|"Self" } ] }
If nothing actionable, return { "items": [] }.`;

  const { content } = await getChatAdapter().complete(
    [
      { role: "system", content: "You are a careful family coordination assistant for a household PA. Surface only genuine caregiver needs that require action beyond the confirmed schedule — use member ages, school hours from notes, and activity context to reason about whether a gap actually affects a child who needs supervision. Return valid JSON only." },
      { role: "user", content: prompt },
    ],
    { model: strongModel(), maxTokens: 700 }
  );

  try {
    const parsed = parseJsonResponse<{ items: AlertItem[] }>(content);
    return { hasOutput: parsed.items.length > 0, items: parsed.items };
  } catch {
    log.warn("family-agent: Domain 2 nanny coord parse failed", { raw: content.slice(0, 200) });
    return { hasOutput: false, items: [] };
  }
}

// ---------------------------------------------------------------------------
// Domain 3 — Proactive research
// ---------------------------------------------------------------------------

async function runProactiveResearch(ctx: FamilyContext, runType: AgentRunType): Promise<ResearchResult> {
  const queryCount = runType === "daily_delta" ? 2 : runType === "sunday_preview" ? 3 : 5;
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long" });
  const season = getSeason(now.getMonth());

  const memberProfile = buildMemberProfile(ctx.members);

  const activityLocations = ctx.parentEvents
    .flatMap(p => p.events)
    .filter(e => e.location)
    .map(e => `${e.summary} @ ${e.location}`)
    .slice(0, 8)
    .join("\n");

  const { content: queryJson } = await getChatAdapter().complete(
    [
      { role: "system", content: "You are a proactive personal assistant for a busy household. Before generating search queries, reason about what matters for this family — their kids' life stages, seasonal transitions, interest-based opportunities, and what a thoughtful PA who knows them well would proactively check. Return only a JSON array of query strings." },
      { role: "user", content: `Family location: ${ctx.location}. Today: ${ctx.today}. Month: ${month}. Season: ${season}.

Household members:
${memberProfile}

How to use these profiles — reason about each dimension before generating queries:
• Age & stage → What developmental milestones, school transitions, or age-typical opportunities are relevant right now?
• Activities/interests → Are there registration windows, competitive seasons, tryout cutoffs, or session starts coming up?
• Notes → The family added these deliberately — treat notes as high-priority signals that should directly shape query topics.
• Season + location → What does ${season} in ${ctx.location} mean for this family specifically?

Think as a PA who has worked with this family for a year: What would you proactively surface this ${month} that they haven't thought to ask about?

Calendar activity locations (for local context):
${activityLocations || "None noted."}

Generate exactly ${queryCount} targeted web search queries to surface things this family would genuinely want to know — registrations, deadlines, local events, seasonal prep, or opportunities specific to their ages and interests.

Return ONLY a JSON array: ["query 1", "query 2", ...]` },
    ],
    { model: strongModel(), maxTokens: 250 }
  );

  let queries: string[] = [];
  try {
    queries = parseJsonResponse<string[]>(queryJson);
    log.debug("family-agent: Domain 3 LLM query gen response", { raw: queryJson.slice(0, 500), queries });
  } catch {
    log.warn("family-agent: proactive research query parse failed");
    return { hasOutput: false, items: [] };
  }

  const sevenDaysAgo = new Date(new Date(ctx.todayIso).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const searchResults: Array<{ query: string; result: string }> = [];
  let tavilyUnavailable = false;
  for (const query of queries.slice(0, queryCount)) {
    try {
      log.debug("family-agent: Domain 3 Tavily query", { query, startDate: sevenDaysAgo });
      const result = await tavilySearch(query, { startDate: sevenDaysAgo });
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      if (resultStr.includes("TAVILY_API_KEY")) {
        log.warn("family-agent: Tavily not configured — Domain 3 falling back to LLM-only suggestions", { householdId: ctx.location });
        tavilyUnavailable = true;
        break;
      }
      searchResults.push({ query, result: resultStr });
    } catch (err) {
      log.warn("family-agent: tavily search failed", { query, err: String(err) });
    }
  }

  if (searchResults.length === 0) {
    // No live search data — fall back to LLM-only general suggestions from household profile + season
    const { content: fallbackJson } = await getChatAdapter().complete(
      [
        { role: "system", content: "You are a proactive household personal assistant. When live search is unavailable, draw on general knowledge to surface what matters for this family right now — based on their member profiles, location, and the season. Return valid JSON only." },
        { role: "user", content: `Family location: ${ctx.location || "DFW area, Texas"}. Today: ${ctx.today}. Month: ${month}. Season: ${season}.

Household members:
${memberProfile}

${tavilyUnavailable ? "No live web search available. Use general knowledge only." : "All web searches failed."}
Generate 2-3 genuinely useful suggestions for this household right now — seasonal activities for the kids, typical reminders for this time of year, or household tips relevant to their profile and location. Be specific to the season and location.
For activities, name REAL well-known providers in ${ctx.location || "DFW area, Texas"} only if you are confident in the name and they genuinely serve the child's age and interest. Include their website if you know it. If you are unsure of a specific business, describe the type of provider and suggest how to find one (e.g., "Search for [X] in [city] on Google").
Do NOT invent specific dates, prices, or event names you cannot verify.

Respond with ONLY valid JSON: { "items": [ { "title": "≤60 chars", "summary": "1-2 sentences", "category": "activity"|"suggestion" } ] }
If nothing useful to say, return { "items": [] }.` },
      ],
      { model: strongModel(), maxTokens: 400 }
    );
    try {
      const fb = parseJsonResponse<{ items: ResearchItem[] }>(fallbackJson);
      log.info("family-agent: Domain 3 LLM-only fallback produced items", { count: fb.items.length });
      return { hasOutput: fb.items.length > 0, items: fb.items };
    } catch {
      log.warn("family-agent: Domain 3 LLM fallback parse failed");
      return { hasOutput: false, items: [] };
    }
  }

  const searchContext = searchResults
    .map((r, i) => `Search ${i + 1}: "${r.query}"\n${r.result}`)
    .join("\n\n---\n");

  const { content: synthJson } = await getChatAdapter().complete(
    [
      { role: "system", content: "You are a household PA synthesizing search results into actionable intelligence. Your job is NOT to summarize — it is to compile exactly what a busy parent needs to act without Googling: full business/program name, website URL, pricing, and how to register. Vague summaries like 'enroll in swim lessons' or 'great summer activity' are rejected. If search results lack specifics, surface what you can and skip the rest. Return valid JSON only." },
      { role: "user", content: `Family: ${ctx.location}. Today: ${ctx.today}. Month: ${month}.

Household members:
${memberProfile}

Search results:
${searchContext}

TODAY is ${ctx.todayIso}. CRITICAL: Only include items dated on or after today. Discard any past events, expired registration windows, or deadlines that have already passed. If a result mentions a registration window or deadline, include it only if it is still open or upcoming.

Extract 2-4 specific, useful findings relevant to this family. For EACH item the summary MUST include everything available from the search results:
• Full official business/program name (not a generic category like "swim school")
• Website URL — link directly to registration page if possible
• Approximate cost or price range
• How to register — specific steps or the registration URL
• Why relevant to THIS family (reference the specific child's age, name, or activity interest)

BAD: "Balance Dance Studios has summer camps for ages 3-5."
GOOD: "Balance Dance Studios (balancedancestudios.com) — summer mini-camps for ages 3-5, ~$X/week; register at [URL] or call [number]. Matches Kid Two's dance interest."

Skip any item where you cannot produce at least the official name plus one concrete actionable detail (URL, price, or phone number).

Respond with ONLY valid JSON: { "items": [ { "title": "≤60 chars — include business name", "summary": "2-3 sentences: business name, website, pricing, registration steps, and why relevant to this specific child", "category": "event"|"deadline"|"restaurant"|"weather"|"activity"|"entertainment" } ] }
If nothing specific enough found, return { "items": [] }.` },
    ],
    { model: strongModel(), maxTokens: 600 }
  );

  log.debug("family-agent: Domain 3 LLM synthesis response", { raw: synthJson.slice(0, 1000) });
  try {
    const parsed = parseJsonResponse<{ items: ResearchItem[] }>(synthJson);
    return { hasOutput: parsed.items.length > 0, items: parsed.items };
  } catch {
    log.warn("family-agent: Domain 3 synthesis parse failed", { raw: synthJson.slice(0, 200) });
    return { hasOutput: false, items: [] };
  }
}

// ---------------------------------------------------------------------------
// Domain 4 — Deadline sweep
// ---------------------------------------------------------------------------

async function sweepDeadlines(ctx: FamilyContext, runType: AgentRunType): Promise<DeadlineResult> {
  const cutoffDays = runType === "daily_delta" ? 7 : 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + cutoffDays);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const upcomingDeadlines = ctx.dbEvents.filter(e => {
    if (e.recordType !== "deadline") return false;
    const date = e.dueDate ?? e.startAt?.slice(0, 10) ?? null;
    return date !== null && date >= ctx.todayIso && date <= cutoffStr;
  });

  const dbLines = upcomingDeadlines.length === 0
    ? "None in app."
    : upcomingDeadlines.map(e => `- ${e.title} | due: ${e.dueDate ?? e.startAt?.slice(0, 10)}`).join("\n");

  const openDeadlineAlerts = ctx.openAlerts
    .filter(a => a.alertType === "deadline_approaching")
    .map(a => `- ${a.affectedDate}: ${a.reason}`)
    .join("\n");

  let tavilyContext = "";
  if (runType !== "daily_delta" && ctx.location) {
    const month = new Date().toLocaleString("en-US", { month: "long" });
    const memberProfile = buildMemberProfile(ctx.members);

    const { content: queryJson } = await getChatAdapter().complete(
      [
        { role: "system", content: "You are a proactive personal assistant generating deadline search queries for a household. Think from this family's specific life stage and context — not from a generic checklist. Return valid JSON only." },
        { role: "user", content: `Today: ${ctx.today}. Month: ${month}. Location: ${ctx.location}.

Household members:
${memberProfile}

How to use these profiles — reason about each child's deadline landscape before generating queries:
• Age & stage → What enrollment windows, registration cutoffs, or age-milestone checkpoints are typical right now for a child this age?
• Activities/interests → Are there session registration deadlines, tryout windows, or competitive season signups approaching for these specific activities?
• Notes → Custom household context — treat as high-priority signals for what to search.
• ${month} in ${ctx.location} → What deadlines are seasonally typical for families here right now?

Think: What would a PA who knows this family proactively check — not just obvious school deadlines but activity cutoffs, medical milestones, financial windows, or local registration events they might miss?

Already tracked in app — do NOT generate queries for these:
${dbLines}

Already open alerts — do NOT re-search these:
${openDeadlineAlerts || "None."}

Generate 3-4 targeted Tavily search queries to surface PUBLIC deadlines this household might miss.

Respond with ONLY valid JSON: { "queries": ["query 1", "query 2", ...] }` },
      ],
      { model: strongModel(), maxTokens: 200 }
    );

    let deadlineQueries: string[] = [];
    try {
      deadlineQueries = parseJsonResponse<{ queries: string[] }>(queryJson).queries ?? [];
      log.debug("family-agent: Domain 4 LLM query gen response", { raw: queryJson.slice(0, 500), queries: deadlineQueries });
    } catch {
      log.warn("family-agent: Domain 4 query generation parse failed");
    }

    const d4SevenDaysAgo = new Date(new Date(ctx.todayIso).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const results: string[] = [];
    for (const q of deadlineQueries.slice(0, 4)) {
      try {
        log.debug("family-agent: Domain 4 Tavily query", { query: q, startDate: d4SevenDaysAgo });
        const r = await tavilySearch(q, { startDate: d4SevenDaysAgo });
        const rStr = typeof r === "string" ? r : JSON.stringify(r);
        if (rStr.includes("TAVILY_API_KEY")) break;
        results.push(`"${q}": ${rStr}`);
      } catch { /* ignore individual search failures */ }
    }
    if (results.length > 0) tavilyContext = results.join("\n\n");
  }

  const { content } = await getChatAdapter().complete(
    [
      { role: "system", content: "You are a household PA triaging deadline alerts. Flag only new items not already open. Be specific to this family's context — not generic advice. Every alert must answer: WHY does this matter, WHAT exactly needs to happen, and WHERE/HOW to do it. Return valid JSON only." },
      { role: "user", content: `Today: ${ctx.today}. Location: ${ctx.location}.

Deadlines in app (next ${cutoffDays} days):
${dbLines}

${tavilyContext ? `Public deadlines from web:\n${tavilyContext}\n` : ""}
${openDeadlineAlerts ? `Already flagged (DO NOT re-flag):\n${openDeadlineAlerts}\n` : ""}
Triage: critical (<2 days), urgent (<7 days), reminder (<14 days), advisory (≤${cutoffDays} days). Surface only new items.

TODAY is ${ctx.todayIso}. CRITICAL: Only output alerts where affectedDate is on or after today (${ctx.todayIso}). Never flag dates that have already passed.

Each alert MUST include ALL THREE of these in the reason field:
1. WHAT: the specific thing (school, program, business name, or document — not generic category)
2. WHY IT MATTERS: consequence of missing it (missed enrollment session, late fees, waitlist, school year impact)
3. HOW/WHERE: the exact first action (URL, phone, form name, or location to go to)

BAD example (reject this): "Complete the school supply order for 1st Grade by July 16 to ensure items are available."
GOOD example: "1st grade supply list is due by July 16 — without it teachers can't plan the classroom. Check your school's July email or the district's ParentPortal for the exact list, then order on Amazon or pick up at Target/Walmart."

Respond with ONLY valid JSON:
{ "alerts": [ {
  "alertType": "deadline_approaching",
  "reason": "WHAT + WHY IT MATTERS + HOW/WHERE — see format above",
  "affectedDate": "YYYY-MM-DD",
  "copyPasteText": "Ready-to-act 2-3 sentence note: full name of thing, deadline date, where/how to do it, what happens if missed.",
  "recipientHint": "Self"|"Both"|"Spouse",
  "calendarEventPayload": {
    "title": "≤80 char title, specific — e.g. '1st Grade Supply List Deadline' or 'Mighty Tiger Karate Fall Enrollment'",
    "date": "YYYY-MM-DD only — no other text",
    "time": "HH:MM — use 08:00 for morning deadlines, 09:00 if a business opens then",
    "description": "1-2 sentences: what to do and where/how, including URL or phone if known"
  }
} ] }
Include calendarEventPayload for any deadline that benefits from being on the calendar. Set to null only for vague or unactionable items.
If nothing new, return { "alerts": [] }.` },
    ],
    { model: strongModel(), maxTokens: 1500 }
  );

  log.debug("family-agent: Domain 4 LLM synthesis response", { raw: content.slice(0, 1000) });
  try {
    const parsed = parseJsonResponse<{ alerts: AlertItem[] }>(content);
    return { hasOutput: parsed.alerts.length > 0, alerts: parsed.alerts };
  } catch {
    log.warn("family-agent: Domain 4 deadline parse failed", { raw: content.slice(0, 200) });
    return { hasOutput: false, alerts: [] };
  }
}

// ---------------------------------------------------------------------------
// Domain 5 — Synthesis (per-parent digest)
// ---------------------------------------------------------------------------

async function synthesizeDigest(
  ctx: FamilyContext,
  domain: PipelineOutputs,
  runType: AgentRunType,
  parents: ConnectedParent[],
  financeContext: string
): Promise<AgentAnalysis> {
  // Research items stored as suggestion alerts so they appear in the UI, not just in email
  const researchSuggestions: AlertItem[] = domain.research.items.map(item => ({
    alertType: "suggestion" as const,
    reason: `[${item.category.toUpperCase()}] ${item.title} — ${item.summary}`,
    affectedDate: null,
    copyPasteText: item.summary,
    recipientHint: "Both",
  }));
  const allAlerts: AlertItem[] = [
    ...domain.coverageGaps.gaps,
    ...domain.nannyCoord.items,
    ...domain.deadlines.alerts,
    ...researchSuggestions,
  ];
  const hasOutput = allAlerts.length > 0 || domain.research.hasOutput;

  if (!hasOutput && runType === "daily_delta") {
    return { conflicts: [], parentADigest: null, parentBDigest: null, summaryText: "Nothing new to surface today.", hasOutput: false };
  }

  const alertSection = allAlerts.length === 0
    ? "No reactive alerts this run."
    : allAlerts.map(a => `[${a.alertType.toUpperCase()}] ${a.affectedDate ?? "no date"}: ${a.reason} → ${a.recipientHint}`).join("\n");

  const researchSection = domain.research.hasOutput
    ? "Proactive finds:\n" + domain.research.items.map(i => `- [${i.category}] ${i.title}: ${i.summary}`).join("\n")
    : "";

  const parentNames = parents.map((p, i) => `Parent ${String.fromCharCode(65 + i)}: ${p.email}`).join("; ");

  const { content } = await getChatAdapter().complete(
    [
      { role: "system", content: "You compose household digest emails. Concise, actionable per-parent content. Return valid JSON only." },
      { role: "user", content: `Today: ${ctx.today}. Run: ${runType}. Parents: ${parentNames}.

Reactive alerts:
${alertSection}

${researchSection}

Finance context:
${financeContext}

Write digest emails per parent. Parent A = primary household manager. Parent B = co-parent/spouse. Each digest: items they're responsible for, coordination needs, proactive finds. Mobile-readable, bullet points, no filler.

Respond with ONLY valid JSON:
{
  "summaryText": "3-5 sentence summary covering ALL domains in order: (1) childcare/scheduling status this week, (2) nanny coordination needs if any, (3) deadline alerts if any, (4) proactive research findings if any. If a domain has nothing to report, say so in one clause (e.g. 'No coverage issues this week.'). Be specific — name actual events, dates, or findings where available.",
  "parentADigest": { "subject": "...", "body": "..." },
  "parentBDigest": { "subject": "...", "body": "..." }
}` },
    ],
    { model: strongModel(), maxTokens: 3500 }
  );

  try {
    const parsed = parseJsonResponse<{
      summaryText: string;
      parentADigest: { subject: string; body: string };
      parentBDigest: { subject: string; body: string };
    }>(content);

    return {
      conflicts: allAlerts,
      parentADigest: parsed.parentADigest,
      parentBDigest: parsed.parentBDigest,
      summaryText: parsed.summaryText,
      hasOutput: true,
    };
  } catch {
    log.warn("family-agent: Domain 5 synthesis parse failed", { raw: content.slice(0, 200) });
    return {
      conflicts: allAlerts,
      parentADigest: null,
      parentBDigest: null,
      summaryText: "Digest synthesis failed — alerts were still generated.",
      hasOutput: allAlerts.length > 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Email HTML wrapper
// ---------------------------------------------------------------------------

function wrapDigestHtml(subject: string, body: string, parentEmail: string): string {
  const lines = body
    .split("\n")
    .map(l => l.startsWith("- ") ? `<li>${l.slice(2)}</li>` : `<p>${l}</p>`)
    .join("\n");
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px">
<h2 style="color:#2d6a4f">${subject}</h2>
${lines}
<hr style="margin-top:32px;border:none;border-top:1px solid #eee"/>
<p style="font-size:11px;color:#999">Sent by Grove household assistant to ${parentEmail}</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------

export async function runFamilyAgent(
  householdId: string,
  runType: AgentRunType
): Promise<{ status: "sent" | "skipped" | "error"; alertsCreated: number; emailsSent: number; message?: string }> {
  if (!isLlmConfigured()) {
    log.warn("family-agent: LLM not configured, skipping run", { householdId, runType });
    await writeDigestLog(householdId, runType, "skipped", { skipReason: "LLM not configured" });
    return { status: "skipped", alertsCreated: 0, emailsSent: 0, message: "LLM not configured" };
  }

  const parents = await getConnectedParents(householdId);
  if (parents.length === 0) {
    log.info("family-agent: no connected parents, skipping", { householdId, runType });
    await writeDigestLog(householdId, runType, "skipped", { skipReason: "No Google Calendar connections" });
    return { status: "skipped", alertsCreated: 0, emailsSent: 0, message: "No connected calendars" };
  }

  try {
    const parentEvents = await Promise.all(
      parents.map(async p => ({
        email: p.email,
        events: await fetchCalendarEvents(p, { fullFetch: true }),
        userId: p.userId,
      }))
    );

    // 30 days covers the widest window any domain needs (full-run deadline sweep); Domain 1/2's
    // day grid and daily_delta's shorter cutoffs simply use a prefix of the same fetched set.
    const dbEvents = await getFamilyEventsForWeek(householdId, 30);

    // For daily delta: fetch open alerts so the LLM can skip conflicts already surfaced.
    // For full digest runs: open alerts are irrelevant — the digest covers the whole week fresh.
    // delta: all open alerts (to avoid re-flagging); full runs: stale suggestions only (5+ days old)
    const openAlerts = runType === "daily_delta"
      ? await listAlerts(householdId, false)
      : await listStaleSuggestions(householdId, 5);

    const [members, caregiverSlots, financeContext, location] = await Promise.all([
      listHouseholdMembers(householdId),
      listAvailability(householdId),
      buildFinanceContext(householdId),
      getHouseholdLocation(householdId),
    ]);

    const now = new Date();
    // Household-local date (FIX #209) — env.TZ, never server/UTC time. A run kicked off at
    // 11pm UTC must still resolve "today" to the household's own calendar day.
    const today = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: env.TZ });
    const todayIso = now.toLocaleDateString("en-CA", { timeZone: env.TZ }); // en-CA => YYYY-MM-DD
    const ctx: FamilyContext = { location, today, todayIso, members, caregiverSlots, parentEvents, dbEvents, openAlerts };

    // Run domains 1–4 in parallel; domain 5 synthesizes their outputs
    const [coverageGaps, nannyCoord, research, deadlines] = await Promise.all([
      analyzeCoverageGaps(ctx, runType),
      assessNannyCoordination(ctx, runType),
      runProactiveResearch(ctx, runType),
      sweepDeadlines(ctx, runType),
    ]);

    const analysis = await synthesizeDigest(
      ctx,
      { coverageGaps, nannyCoord, research, deadlines },
      runType,
      parents,
      financeContext
    );

    // Daily delta: skip if no domain produced actionable output
    if (runType === "daily_delta" && !analysis.hasOutput) {
      await writeDigestLog(householdId, runType, "skipped", {
        skipReason: "No actionable output from any domain",
        summaryText: analysis.summaryText,
      });
      for (const p of parents) await updateLastSyncedAt(p.userId);
      return { status: "skipped", alertsCreated: 0, emailsSent: 0 };
    }

    // Write digest log first to get the ID
    const digestId = await writeDigestLog(householdId, runType, "sent", {
      alertsCreated: analysis.conflicts.length,
      summaryText: analysis.summaryText,
    });

    // Write alert records
    if (analysis.conflicts.length > 0) {
      await writeAlerts(householdId, digestId, analysis.conflicts);
    }

    // Send digest emails
    let emailsSent = 0;
    const recipientEmails: string[] = [];
    const digests: Array<{ parent: ConnectedParent; digest: { subject: string; body: string } }> = [];

    if (analysis.parentADigest && parentEvents[0]) {
      digests.push({ parent: parents[0], digest: analysis.parentADigest });
    }
    if (analysis.parentBDigest && parentEvents[1]) {
      digests.push({ parent: parents[1], digest: analysis.parentBDigest });
    }

    for (const { parent, digest } of digests) {
      const result = await sendMail({
        to: parent.email,
        subject: digest.subject,
        text: digest.body,
        html: wrapDigestHtml(digest.subject, digest.body, parent.email),
      });
      if (result.ok) {
        emailsSent++;
        recipientEmails.push(parent.email);
      } else {
        log.warn("family-agent: email send failed", { userId: parent.userId, reason: result.reason });
      }
    }

    // Update emails_sent and recipients in the log
    await qExec(
      `UPDATE family_digest_log SET emails_sent = ?, recipients_json = ? WHERE id = ?`,
      emailsSent,
      recipientEmails.length > 0 ? JSON.stringify(recipientEmails) : null,
      digestId
    );

    // Update gcal_last_synced_at for each parent
    for (const p of parents) await updateLastSyncedAt(p.userId);

    log.info("family-agent: run complete", {
      householdId, runType, alertsCreated: analysis.conflicts.length, emailsSent,
    });

    return {
      status: "sent",
      alertsCreated: analysis.conflicts.length,
      emailsSent,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("family-agent: run failed", { householdId, runType, err: msg });
    await writeDigestLog(householdId, runType, "error", { errorMessage: msg });
    return { status: "error", alertsCreated: 0, emailsSent: 0, message: msg };
  }
}

// ---------------------------------------------------------------------------
// Alert management
// ---------------------------------------------------------------------------

export type AgentAlert = {
  id: string;
  householdId: string;
  detectedAt: string;
  alertType: string;
  reason: string;
  affectedDate: string | null;
  copyPasteText: string | null;
  recipientHint: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
  sourceDigestId: string | null;
  actionType: string | null;
  actionPayload: { title: string; date: string; description: string } | null;
};

type AlertRow = {
  id: string;
  household_id: string;
  detected_at: string;
  alert_type: string;
  reason: string;
  affected_date: string | null;
  copy_paste_text: string | null;
  recipient_hint: string | null;
  is_resolved: boolean;
  resolved_at: string | null;
  source_digest_id: string | null;
  action_type: string | null;
  action_payload: unknown;
};

function rowToAlert(r: AlertRow): AgentAlert {
  return {
    id: r.id,
    householdId: r.household_id,
    detectedAt: r.detected_at,
    alertType: r.alert_type,
    reason: r.reason,
    affectedDate: r.affected_date,
    copyPasteText: r.copy_paste_text,
    recipientHint: r.recipient_hint,
    isResolved: r.is_resolved,
    resolvedAt: r.resolved_at,
    sourceDigestId: r.source_digest_id,
    actionType: r.action_type,
    actionPayload: r.action_payload as AgentAlert["actionPayload"],
  };
}

export async function listAlerts(householdId: string, includeResolved = false): Promise<AgentAlert[]> {
  const rows = includeResolved
    ? await qAll<AlertRow>(
        `SELECT * FROM family_agent_alerts WHERE household_id = ? ORDER BY detected_at DESC LIMIT 50`,
        householdId
      )
    : await qAll<AlertRow>(
        `SELECT * FROM family_agent_alerts WHERE household_id = ? AND is_resolved = FALSE ORDER BY detected_at DESC`,
        householdId
      );
  return rows.map(rowToAlert);
}

export async function listStaleSuggestions(householdId: string, olderThanDays: number): Promise<AgentAlert[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const rows = await qAll<AlertRow>(
    `SELECT * FROM family_agent_alerts
     WHERE household_id = ? AND alert_type = 'suggestion' AND is_resolved = FALSE
       AND detected_at < ?
     ORDER BY detected_at ASC`,
    householdId,
    cutoff.toISOString()
  );
  return rows.map(rowToAlert);
}

export async function resolveAlert(id: string, householdId: string, userId: string): Promise<boolean> {
  const row = await qGet<{ id: string }>(
    `UPDATE family_agent_alerts
     SET is_resolved = TRUE, resolved_at = NOW(), resolved_by_user_id = ?
     WHERE id = ? AND household_id = ? AND is_resolved = FALSE
     RETURNING id`,
    userId,
    id,
    householdId
  );
  return row !== null;
}

export type DigestLogEntry = {
  id: string;
  householdId: string;
  runType: string;
  runAt: string;
  status: string;
  skipReason: string | null;
  alertsCreated: number;
  emailsSent: number;
  errorMessage: string | null;
  subjectLine: string | null;
  summaryText: string | null;
  recipients: string[] | null;
};

type DigestLogRow = {
  id: string;
  household_id: string;
  run_type: string;
  run_at: string;
  status: string;
  skip_reason: string | null;
  alerts_created: number;
  emails_sent: number;
  error_message: string | null;
  subject_line: string | null;
  summary_text: string | null;
  recipients_json: string | null;
};

export async function listDigestLog(householdId: string): Promise<DigestLogEntry[]> {
  const rows = await qAll<DigestLogRow>(
    `SELECT * FROM family_digest_log WHERE household_id = ? ORDER BY run_at DESC LIMIT 30`,
    householdId
  );
  return rows.map(r => {
    let recipients: string[] | null = null;
    if (r.recipients_json) {
      try { recipients = JSON.parse(r.recipients_json) as string[]; } catch { /* ignore */ }
    }
    return {
      id: r.id,
      householdId: r.household_id,
      runType: r.run_type,
      runAt: r.run_at,
      status: r.status,
      skipReason: r.skip_reason,
      alertsCreated: r.alerts_created,
      emailsSent: r.emails_sent,
      errorMessage: r.error_message,
      subjectLine: r.subject_line,
      summaryText: r.summary_text,
      recipients,
    };
  });
}

// ---------------------------------------------------------------------------
// Household lookup — run agent for all households with connected calendars
// ---------------------------------------------------------------------------

export async function runFamilyAgentForAllHouseholds(runType: AgentRunType): Promise<void> {
  const rows = await qAll<{ household_id: string }>(
    `SELECT DISTINCT household_id FROM oauth_integrations
     WHERE provider = 'google_calendar' AND needs_reauth = FALSE AND refresh_token IS NOT NULL`
  );
  for (const row of rows) {
    await runFamilyAgent(row.household_id, runType);
  }
}

// ---------------------------------------------------------------------------
// PA quick-capture — parse freeform note into suggested actions
// ---------------------------------------------------------------------------

const CAPTURE_SYSTEM = `You are a household executive assistant (PA). The user has sent you a quick-capture note — a research request, reminder, draft request, or scheduling task. Return a JSON object with a friendly acknowledgement and one or more suggested actions.

WHEN TO USE search_web (do this first, before generating the response):
- Any question about external dates, deadlines, registration windows, program availability, locations, or business hours
- "find camps near [area]", "when does X registration open", "what's the deadline for Y", "is Z still enrolling"
- Always search before answering factual questions — do not guess at dates or availability

MULTI-STEP TASKS: If a task requires both research and an action (e.g. "find swim camps and add reminders"), return multiple actions — a "note" with research results plus a "set_reminder" or "create_event".

ACTION TYPES and what makes them good:
- "create_event": Calendar addition. Include specific date, time, duration_mins, title, description, and participants.
- "set_reminder": Future notification. Include date, time, and the exact message the user should see.
- "draft_message": Write a COMPLETE, send-ready message in body_draft — not a stub or template.
    - School / medical context: professional tone, formal salutation ("Dear Ms. [Last Name],"), clear subject line.
    - Nanny / coach / neighbors: warm and direct, no unnecessary formality.
    - recipient is a role name (e.g. "Nanny", "Jake's teacher") — user will supply the actual email.
- "note": Structured information. Use for research results, captured facts, or reference info. Format content clearly with labels.

JSON response format (valid JSON only, no prose outside):
{
  "responseText": "short friendly acknowledgement (1-2 sentences)",
  "actions": [
    {
      "type": "create_event" | "set_reminder" | "draft_message" | "note",
      "title": "short label (max 60 chars)",
      "summary": "one sentence describing what this action does",
      "details": {
        // create_event: { "date": "YYYY-MM-DD", "time": "HH:MM", "duration_mins": number, "title": string, "description": string, "participants": string[] }
        // set_reminder: { "date": "YYYY-MM-DD", "time": "HH:MM", "message": string }
        // draft_message: { "recipient": string, "subject": string, "body_draft": string }
        // note: { "content": string }
      }
    }
  ]
}`;

export async function processCaptureNote(note: string): Promise<CaptureResult> {
  const { finalResponse } = await getToolUseAdapter().runToolLoop(
    [
      { role: "system", content: CAPTURE_SYSTEM },
      { role: "user", content: note },
    ],
    [SEARCH_WEB_TOOL],
    async (name, args) => {
      if (name === "search_web") {
        const query = typeof args.query === "string" ? args.query : "";
        return tavilySearch(query);
      }
      return `Unknown tool: ${name}`;
    },
    { model: strongModel(), maxTokens: 1000, maxIterations: 3 }
  );

  const jsonStr = finalResponse.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(jsonStr) as CaptureResult;
  return parsed;
}
