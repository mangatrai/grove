import { google } from "googleapis";

import { getChatAdapter, isLlmConfigured, strongModel } from "../../llm/index.js";
import { log } from "../../logger.js";
import { sendMail } from "../mailer/mailer.service.js";
import { qAll, qExec, qGet } from "../../db/query.js";
import { buildOAuth2Client, getDecryptedRefreshToken } from "../gcal/gcal.service.js";
import type { FamilyEvent, FamilyEventRow } from "./family.types.js";

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

type CalendarEvent = {
  summary: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  calendarId: string;
};

type AgentAnalysis = {
  conflicts: Array<{
    alertType: "conflict" | "travel" | "coverage_gap" | "deadline_approaching";
    reason: string;
    affectedDate: string | null;
    copyPasteText: string;
    recipientHint: string;
  }>;
  parentADigest: { subject: string; body: string } | null;
  parentBDigest: { subject: string; body: string } | null;
  summaryText: string;
  hasConflicts: boolean;
};

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getConnectedParents(householdId: string): Promise<ConnectedParent[]> {
  type Row = {
    user_id: string;
    provider_email: string;
    selected_calendar_ids: string | null;
    gcal_last_synced_at: string | null;
  };
  const rows = await qAll<Row>(
    `SELECT user_id, provider_email, selected_calendar_ids, gcal_last_synced_at
     FROM oauth_integrations
     WHERE provider = 'google_calendar'
       AND household_id = ?
       AND needs_reauth = FALSE
       AND refresh_token IS NOT NULL`,
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
      email: r.provider_email,
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

async function getFamilyEventsForWeek(householdId: string): Promise<FamilyEvent[]> {
  const rows = await qAll<FamilyEventRow>(
    `SELECT * FROM family_events
     WHERE household_id = ? AND is_active = TRUE
       AND (
         (start_at IS NOT NULL AND start_at >= NOW() AND start_at < NOW() + INTERVAL '14 days')
         OR
         (due_date IS NOT NULL AND due_date::date >= CURRENT_DATE AND due_date::date < CURRENT_DATE + 14)
       )
     ORDER BY COALESCE(start_at, due_date::timestamptz) ASC NULLS LAST`,
    householdId
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
    await qExec(
      `INSERT INTO family_agent_alerts
         (household_id, alert_type, reason, affected_date, copy_paste_text, recipient_hint, source_digest_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      householdId,
      c.alertType,
      c.reason,
      c.affectedDate ?? null,
      c.copyPasteText,
      c.recipientHint,
      digestId
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

  const calendarIds = parent.selectedCalendarIds?.length
    ? parent.selectedCalendarIds
    : await (async () => {
        const res = await calendar.calendarList.list({ minAccessRole: "reader" });
        return (res.data.items ?? []).map(c => c.id).filter((id): id is string => !!id);
      })();

  const events: CalendarEvent[] = [];

  for (const calId of calendarIds) {
    // Always do a full fetch — the LLM needs the complete picture to detect
    // conflicts between any events in the window, not just recently-changed ones.
    // "Delta" for daily runs is determined by the LLM output (hasConflicts),
    // not by filtering the input.
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
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// LLM analysis
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(
  runType: AgentRunType,
  parents: Array<{ email: string; events: CalendarEvent[] }>,
  dbEvents: FamilyEvent[],
  openAlerts: AgentAlert[]
): string {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const isDelta = runType === "daily_delta";
  const isPreview = runType === "sunday_preview";

  const parentLines = parents.map((p, i) =>
    `Parent ${String.fromCharCode(65 + i)} (${p.email}):\n` +
    (p.events.length === 0
      ? "  No calendar events in the next 14 days.\n"
      : p.events.map(ev =>
          `  - ${ev.summary} | ${ev.start ?? "no date"} | ${ev.allDay ? "all-day" : ""} | ${ev.location ?? ""}`
        ).join("\n") + "\n"
    )
  ).join("\n");

  const dbLines = dbEvents.length === 0
    ? "No family events or deadlines tracked in app."
    : dbEvents.map(e =>
        `[${e.recordType.toUpperCase()}] ${e.title} | ${e.startAt ?? e.dueDate ?? "no date"} | ${e.location ?? ""}`
      ).join("\n");

  // For daily delta: inject open unresolved alerts so the LLM doesn't re-flag
  // conflicts that have already been surfaced and are awaiting owner action.
  const openAlertsSection = isDelta && openAlerts.length > 0
    ? `\n=== Already open alerts this week (DO NOT re-flag these) ===\n` +
      openAlerts.map(a =>
        `- [${a.alertType}] ${a.affectedDate ?? "no date"}: ${a.reason}`
      ).join("\n") + "\n"
    : "";

  const taskDescription = isDelta
    ? "Check for NEW conflicts not already covered by the open alerts listed above. A conflict is 'new' if it involves a different date, different event, or a genuinely different situation from what is already flagged. If everything conflicted is already in the open alerts list, return hasConflicts: false."
    : isPreview
    ? "Provide a light Sunday evening preview: flag anything obviously conflicted for the week ahead. Keep it short."
    : "Provide the full Monday weekly digest: map out each day, assign coverage duties (who handles pickup/dropoff), flag travel, list activities and appointments per parent, note what Nanny should know.";

  return `Today is ${today}. Run type: ${runType}.

Task: ${taskDescription}
${openAlertsSection}
=== Calendar Events (next 14 days) ===
${parentLines}

=== Family Events & Deadlines (from app) ===
${dbLines}

Respond with ONLY valid JSON in this exact shape:
{
  "hasConflicts": boolean,
  "summaryText": "1-2 sentence plain text summary of the week",
  "conflicts": [
    {
      "alertType": "conflict" | "travel" | "coverage_gap" | "deadline_approaching",
      "reason": "short description of the conflict",
      "affectedDate": "YYYY-MM-DD or null",
      "copyPasteText": "pre-written message owner can copy and send to Nanny/Spouse",
      "recipientHint": "Nanny" | "Spouse" | "Both" | "Self"
    }
  ],
  "parentADigest": {
    "subject": "email subject line",
    "body": "plain text email body for Parent A"
  },
  "parentBDigest": {
    "subject": "email subject line",
    "body": "plain text email body for Parent B"
  }
}

Rules:
- A CONFLICT exists ONLY when children need care, transport, pickup, or dropoff and no parent or nanny can provide it. Parents both having meetings or appointments at the same time is NOT a conflict unless a child needs care at that exact window.
- The Nanny manages CHILDCARE ONLY — pickup, dropoff, and home care for children. She is not a parent's personal assistant or work scheduler. Only set recipientHint = "Nanny" when she specifically needs to: extend hours, arrive early, handle a pickup/dropoff, or change the childcare schedule.
- DO NOT generate alerts for: parents' overlapping work meetings, medical appointments that don't affect childcare windows, or generally busy days. Only flag when a child-care gap results.
- VALID conflict examples: school pickup at 3pm and both parents in meetings; nanny not scheduled but both parents have evening commitments; parent traveling on a day the other parent has a full-day conflict and kids need care.
- NOT conflicts: Parent A has a doctor appointment and also has a work meeting; both parents have morning meetings that overlap; one parent has a busy day; any adult scheduling issue that doesn't involve unmet childcare.
- recipientHint values: "Nanny" (she must change her childcare schedule), "Spouse" (spouse needs to know about a childcare decision), "Self" (owner needs to arrange something), "Both" (both parents need to see it).
- conflicts array must be empty [] if hasConflicts is false
- parentADigest and parentBDigest must be null if this is a daily_delta run with no conflicts
- Keep email bodies readable on mobile — short paragraphs, bullet points for activities
- copyPasteText must be about a childcare need only (e.g. "Hi [Nanny], we both have back-to-back meetings Tuesday 2–5pm — can you stay for school pickup at 3pm?")
- Do not include any text outside the JSON object`;
}

async function analyzeWithLlm(
  runType: AgentRunType,
  parents: Array<{ email: string; events: CalendarEvent[] }>,
  dbEvents: FamilyEvent[],
  openAlerts: AgentAlert[]
): Promise<AgentAnalysis> {
  const prompt = buildAnalysisPrompt(runType, parents, dbEvents, openAlerts);

  const { content } = await getChatAdapter().complete(
    [
      {
        role: "system",
        content: "You are a household coordination assistant for a family with young children and a nanny. Your sole focus is identifying CHILD-CARE coverage gaps — situations where children need care, pickup, dropoff, or supervision and no parent or nanny can provide it. You do NOT flag general adult scheduling conflicts. You always respond with valid JSON only — no prose, no markdown, no explanation outside the JSON.",
      },
      { role: "user", content: prompt },
    ],
    { model: strongModel(), maxTokens: 2000 }
  );

  const jsonStr = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(jsonStr) as AgentAnalysis;
  return parsed;
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

    const dbEvents = await getFamilyEventsForWeek(householdId);

    // For daily delta: fetch open alerts so the LLM can skip conflicts already surfaced.
    // For full digest runs: open alerts are irrelevant — the digest covers the whole week fresh.
    const openAlerts = runType === "daily_delta" ? await listAlerts(householdId, false) : [];

    const analysis = await analyzeWithLlm(runType, parentEvents, dbEvents, openAlerts);

    // Daily delta: skip if no conflicts found
    if (runType === "daily_delta" && !analysis.hasConflicts) {
      await writeDigestLog(householdId, runType, "skipped", {
        skipReason: "No conflicts detected",
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
