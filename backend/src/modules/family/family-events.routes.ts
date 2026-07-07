import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import {
  createFamilyEvent,
  deleteFamilyEvent,
  getFamilyEvent,
  listFamilyEvents,
  updateFamilyEvent,
} from "./family-events.service.js";
import {
  listAlerts,
  listDigestLog,
  processCaptureNote,
  resolveAlert,
  runFamilyAgent,
} from "./family-agent.service.js";
import { createCalendarEvent } from "../gcal/gcal.service.js";
import { sendMail } from "../mailer/mailer.service.js";
import { qBegin, qExec, qGet, sqlBind } from "../../db/query.js";
import { log } from "../../logger.js";

export const familyEventsRouter = Router();
familyEventsRouter.use(requireAuth);

const createSchema = z.object({
  recordType: z.enum(["event", "deadline"]),
  source: z.enum(["gcal", "tavily", "manual"]).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  startAt: z.string().datetime({ offset: true }).nullish(),
  endAt: z.string().datetime({ offset: true }).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  location: z.string().max(500).nullish(),
  isRecurring: z.boolean().optional(),
  recurrenceRule: z.string().max(500).nullish(),
  allDay: z.boolean().optional(),
  assigneeIds: z.array(z.string()).optional(),
});

const updateSchema = createSchema
  .omit({ recordType: true, source: true })
  .partial();

/** GET /family/events?type=event|deadline — list events or deadlines for the household */
familyEventsRouter.get("/events", requireRole(["owner", "admin", "member"]), async (req: AuthenticatedRequest, res) => {
  const { type } = req.query as Record<string, string | undefined>;
  const recordType = type === "event" || type === "deadline" ? type : undefined;
  const events = await listFamilyEvents(req.authUser!.householdId, recordType);
  res.json({ events });
});

/** GET /family/events/:id */
familyEventsRouter.get("/events/:id", requireRole(["owner", "admin", "member"]), async (req: AuthenticatedRequest, res) => {
  const event = await getFamilyEvent(req.params.id, req.authUser!.householdId);
  if (!event) { res.status(404).json({ message: "Event not found." }); return; }
  res.json({ event });
});

/** POST /family/events — owner/admin only (staff can view, not create) */
familyEventsRouter.post("/events", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }
  const event = await createFamilyEvent(req.authUser!.householdId, parsed.data);
  res.status(201).json({ event });
});

/** PATCH /family/events/:id */
familyEventsRouter.patch("/events/:id", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }
  const event = await updateFamilyEvent(req.params.id, req.authUser!.householdId, parsed.data);
  if (!event) { res.status(404).json({ message: "Event not found." }); return; }
  res.json({ event });
});

/** DELETE /family/events/:id */
familyEventsRouter.delete("/events/:id", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const deleted = await deleteFamilyEvent(req.params.id, req.authUser!.householdId);
  if (!deleted) { res.status(404).json({ message: "Event not found." }); return; }
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Agent alerts + digest log
// ---------------------------------------------------------------------------

/** GET /family/alerts?includeResolved=true */
familyEventsRouter.get("/alerts", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const includeResolved = req.query.includeResolved === "true";
  const alerts = await listAlerts(req.authUser!.householdId, includeResolved);
  res.json({ alerts });
});

/** PATCH /family/alerts/:id/resolve */
familyEventsRouter.patch(
  "/alerts/:id/resolve",
  requireRole(["owner", "admin"]),
  async (req: AuthenticatedRequest, res) => {
    const ok = await resolveAlert(req.params.id, req.authUser!.householdId, req.authUser!.userId);
    if (!ok) { res.status(404).json({ message: "Alert not found or already resolved." }); return; }
    res.json({ ok: true });
  }
);

/** POST /family/alerts/:alertId/approve — execute the alert's action (currently only create_gcal_event) */
familyEventsRouter.post(
  "/alerts/:alertId/approve",
  requireRole(["owner", "admin"]),
  async (req: AuthenticatedRequest, res) => {
    const { householdId, userId } = req.authUser!;
    const { alertId } = req.params;

    type AlertActionRow = {
      id: string;
      is_resolved: boolean;
      action_type: string | null;
      action_payload: unknown;
      affected_date: string | null;
    };
    const alert = await qGet<AlertActionRow>(
      `SELECT id, is_resolved, action_type, action_payload, affected_date FROM family_agent_alerts WHERE id = ? AND household_id = ?`,
      alertId, householdId
    );
    if (!alert) { res.status(404).json({ error: "Alert not found" }); return; }
    if (alert.is_resolved) { res.status(400).json({ error: "Alert already resolved" }); return; }
    if (!alert.action_type) { res.status(400).json({ error: "No action defined for alert" }); return; }
    if (alert.action_type !== "create_gcal_event") {
      res.status(422).json({ code: "UNSUPPORTED_ACTION_TYPE", message: `Action type '${alert.action_type}' is not supported yet.` });
      return;
    }

    const rawPayload = alert.action_payload as Record<string, unknown>;
    log.debug("family-events: approving calendar alert payload", {
      alertId,
      rawPayload: JSON.stringify(rawPayload),
      affectedDate: alert.affected_date,
    });

    // Fall back to affected_date if LLM omits date from calendarEventPayload.
    const resolvedDate =
      typeof rawPayload.date === "string" ? rawPayload.date : alert.affected_date ?? null;

    if (!resolvedDate) {
      log.warn("family-events: no usable date in payload or alert row", { alertId, rawPayload: JSON.stringify(rawPayload) });
      res.status(422).json({ code: "GCAL_INVALID_DATE", message: "No date found in alert payload — re-run the agent to regenerate this alert." });
      return;
    }

    const payload = {
      title: typeof rawPayload.title === "string" ? rawPayload.title : String(rawPayload.title ?? ""),
      date: resolvedDate,
      description: typeof rawPayload.description === "string" ? rawPayload.description : "",
    };
    const gcalResult = await createCalendarEvent(userId, householdId, {
      title: payload.title,
      date: payload.date,
      description: payload.description,
      time: typeof rawPayload.time === "string" ? rawPayload.time : "08:00",
      durationMins: 15,
    });

    if (!gcalResult.ok) {
      log.warn("family-events: calendar event creation failed", {
        alertId,
        code: gcalResult.code,
        message: gcalResult.message,
        resolvedDate: payload.date,
      });
      const status = gcalResult.code === "GCAL_WRITE_ERROR" ? 500 : 422;
      res.status(status).json({ code: gcalResult.code, message: gcalResult.message });
      return;
    }

    const newEventId = crypto.randomUUID();
    const { text: insertText, values: insertValues } = sqlBind(
      `INSERT INTO family_events (id, household_id, record_type, source, title, description, due_date, all_day, gcal_event_id, is_active, created_at, updated_at)
       VALUES (?, ?, 'deadline', 'gcal', ?, ?, ?, TRUE, ?, TRUE, NOW(), NOW())`,
      [newEventId, householdId, payload.title, payload.description, payload.date, gcalResult.eventId]
    );
    await qBegin(async (tx) => {
      await tx.unsafe(insertText, insertValues as never[]);
      const { text: resolveText, values: resolveValues } = sqlBind(
        `UPDATE family_agent_alerts SET is_resolved = TRUE, resolved_at = NOW(), resolved_by_user_id = ? WHERE id = ?`,
        [userId, alertId]
      );
      await tx.unsafe(resolveText, resolveValues as never[]);
    });

    res.json({ ok: true, gcalEventId: gcalResult.eventId, gcalEventLink: gcalResult.eventLink, familyEventId: newEventId });
  }
);

/** GET /family/digests */
familyEventsRouter.get("/digests", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const entries = await listDigestLog(req.authUser!.householdId);
  res.json({ entries });
});

/** POST /family/agent/run — manual trigger (owner only) */
familyEventsRouter.post(
  "/agent/run",
  requireRole(["owner"]),
  async (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ runType: z.enum(["sunday_preview", "monday_digest", "daily_delta", "manual"]).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }
    const runType = parsed.data.runType ?? "manual";
    const result = await runFamilyAgent(req.authUser!.householdId, runType);
    res.json(result);
  }
);

/** POST /family/agent/capture — quick-capture inbox: parse freeform note into action suggestions */
familyEventsRouter.post(
  "/agent/capture",
  requireRole(["owner", "admin"]),
  async (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ note: z.string().min(1).max(2000) }).safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }
    try {
      const result = await processCaptureNote(parsed.data.note, req.authUser!.householdId);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: "CAPTURE_FAILED", message: err instanceof Error ? err.message : "LLM processing failed" });
    }
  }
);

const approveActionSchema = z.object({
  action: z.object({
    type: z.enum(["create_event", "set_reminder", "draft_message", "note"]),
    title: z.string().min(1).max(200),
    summary: z.string(),
    details: z.record(z.unknown()).default({}),
  }),
});

/** POST /family/actions/approve — approve a suggested action (store alert + optional GCal write-back) */
familyEventsRouter.post(
  "/actions/approve",
  requireRole(["owner", "admin"]),
  async (req: AuthenticatedRequest, res) => {
    const parsed = approveActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }

    const { action } = parsed.data;
    const { householdId, userId } = req.authUser!;

    const alertId = crypto.randomUUID();
    await qExec(
      `INSERT INTO family_agent_alerts (id, household_id, detected_at, alert_type, reason, affected_date, copy_paste_text, recipient_hint, is_resolved, source_digest_id)
       VALUES (?, ?, NOW(), 'suggestion', ?, ?, ?, ?, FALSE, NULL)`,
      alertId,
      householdId,
      action.summary,
      typeof action.details.date === "string" ? action.details.date : null,
      action.title,
      null
    );

    let calEventId: string | null = null;
    let calEventLink: string | null = null;
    let calError: string | null = null;

    if (action.type === "create_event") {
      const d = action.details;
      const gcalResult = await createCalendarEvent(userId, householdId, {
        title: action.title,
        date: typeof d.date === "string" ? d.date : new Date().toISOString().slice(0, 10),
        time: typeof d.time === "string" ? d.time : undefined,
        durationMins: typeof d.duration_mins === "number" ? d.duration_mins : undefined,
        description: typeof d.description === "string" ? d.description : undefined,
        attendees: Array.isArray(d.participants) ? (d.participants as string[]) : undefined,
      });
      if (gcalResult.ok) {
        calEventId = gcalResult.eventId;
        calEventLink = gcalResult.eventLink;
      } else {
        calError = gcalResult.message;
      }
    }

    res.json({ ok: true, alertId, calEventId, calEventLink, calError });
  }
);

/** POST /family/compose/send — send a pre-composed email from the agent compose panel */
familyEventsRouter.post(
  "/compose/send",
  requireRole(["owner", "admin"]),
  async (req: AuthenticatedRequest, res) => {
    const parsed = z.object({
      to: z.string().email(),
      subject: z.string().min(1).max(500),
      body: z.string().min(1).max(10_000),
    }).safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }

    const { to, subject, body } = parsed.data;
    const html = `<div style="font-family:sans-serif;white-space:pre-wrap">${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
    const result = await sendMail({ to, subject, html, text: body });
    if (!result.ok) {
      res.status(502).json({ error: "SEND_FAILED", message: result.reason });
      return;
    }
    res.json({ ok: true });
  }
);
