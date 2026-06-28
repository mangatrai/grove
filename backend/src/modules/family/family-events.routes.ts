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
import { qExec } from "../../db/query.js";

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
      const result = await processCaptureNote(parsed.data.note);
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
      const gcalResult = await createCalendarEvent(userId, {
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
