import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { resolveSpaOriginForGdriveRedirect } from "../gdrive/gdrive.service.js";
import {
  assertCanConnectCalendar,
  buildGCalConsentUrl,
  decodeGCalOAuthState,
  disconnectGCal,
  exchangeAndSaveCalendar,
  getCalendarSelection,
  getGCalStatus,
  listUpcomingEvents,
  listUserCalendars,
  saveCalendarSelection
} from "./gcal.service.js";

export const gcalRouter = Router();

const connectRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many connect attempts. Please try again later." },
  skip: () => env.MODE === "TEST"
});

const eventsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14)
});

// ---------------------------------------------------------------------------
// OAuth callback helpers (JS redirect for hash-router SPA — same pattern as Drive)
// ---------------------------------------------------------------------------

function buildGCalRedirectUrl(query: Record<string, string>): string {
  const qs = new URLSearchParams({ ...query, tab: "family" }).toString();
  const routePath = `/settings?${qs}`;
  const base = resolveSpaOriginForGdriveRedirect();
  return base ? `${base}${routePath}` : routePath;
}

function jsRedirect(res: import("express").Response, url: string): void {
  const encoded = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="refresh" content="0;url=${encoded}">` +
      `<title>Redirecting…</title></head><body><p>Redirecting…</p></body></html>`
  );
}

// ---------------------------------------------------------------------------
// Unauthenticated: OAuth callback from Google
// ---------------------------------------------------------------------------

/** GET /gcal/oauth/callback — Google redirects here after user grants consent */
gcalRouter.get("/oauth/callback", async (req, res) => {
  const errRedirect = (msg: string) =>
    jsRedirect(res, buildGCalRedirectUrl({ gcal: "error", message: msg.slice(0, 500) }));

  const code = String(req.query.code ?? "").trim();
  const state = String(req.query.state ?? "").trim();
  if (!code || !state) {
    errRedirect("Missing OAuth code or state.");
    return;
  }

  const decoded = decodeGCalOAuthState(state);
  if (!decoded.ok) {
    errRedirect(decoded.message);
    return;
  }

  const allowed = await assertCanConnectCalendar(decoded.userId, decoded.householdId);
  if (!allowed) {
    errRedirect("Invalid user for calendar connection.");
    return;
  }

  const result = await exchangeAndSaveCalendar(decoded.householdId, decoded.userId, code);
  if (!result.ok) {
    errRedirect(result.message);
    return;
  }

  jsRedirect(res, buildGCalRedirectUrl({ gcal: "connected" }));
});

// ---------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------

gcalRouter.use(requireAuth);

/** GET /gcal/oauth/url — returns Google consent URL for Calendar */
gcalRouter.get("/oauth/url", requireRole(["owner", "admin"]), connectRateLimit, (req: AuthenticatedRequest, res) => {
  if (!env.GOOGLE_CLIENT_ID.trim() || !env.GOOGLE_CLIENT_SECRET.trim() || !env.GOOGLE_CALENDAR_REDIRECT_URI.trim()) {
    res.status(400).json({
      code: "OAUTH_NOT_CONFIGURED",
      message: "Google OAuth is not configured on this server."
    });
    return;
  }
  const { householdId, userId } = req.authUser!;
  const url = buildGCalConsentUrl(householdId, userId);
  res.json({ url });
});

/** GET /gcal/status — per-user Calendar connection state */
gcalRouter.get("/status", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const status = await getGCalStatus(req.authUser!.userId);
  res.json(status);
});

/** POST /gcal/connect — direct code exchange (used by SPA after OAuth callback) */
gcalRouter.post(
  "/connect",
  requireRole(["owner", "admin"]),
  connectRateLimit,
  async (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ code: z.string().min(1) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
      return;
    }
    const { householdId, userId } = req.authUser!;
    const result = await exchangeAndSaveCalendar(householdId, userId, parsed.data.code);
    if (!result.ok) {
      log.warn("gcal connect failed", { userId, householdId, message: result.message });
      res.status(422).json({ code: "GCAL_CONNECTION_FAILED", message: result.message });
      return;
    }
    res.status(200).json({ connected: true });
  }
);

/** DELETE /gcal/disconnect — removes the requesting user's Calendar tokens */
gcalRouter.delete("/disconnect", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  await disconnectGCal(req.authUser!.userId);
  res.json({ connected: false });
});

/** GET /gcal/calendars — list the user's accessible Google Calendars */
gcalRouter.get("/calendars", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const result = await listUserCalendars(req.authUser!.userId);
  if (!result.ok) {
    const httpStatus = result.code === "GCAL_NOT_CONNECTED" ? 409 : result.code === "GCAL_NEEDS_REAUTH" ? 401 : 502;
    res.status(httpStatus).json({ code: result.code, message: result.message });
    return;
  }
  const selection = await getCalendarSelection(req.authUser!.userId);
  res.json({ calendars: result.calendars, selectedIds: selection ?? [] });
});

/** PATCH /gcal/calendars — save the user's calendar selection */
gcalRouter.patch(
  "/calendars",
  requireRole(["owner", "admin"]),
  async (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ selectedIds: z.array(z.string().min(1)).min(1) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "selectedIds must be a non-empty array of strings", issues: parsed.error.issues });
      return;
    }
    await saveCalendarSelection(req.authUser!.userId, parsed.data.selectedIds);
    res.json({ ok: true });
  }
);

/** GET /gcal/events?days=N — list upcoming events for the requesting user */
gcalRouter.get("/events", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = eventsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const result = await listUpcomingEvents(req.authUser!.userId, parsed.data.days);
  if (!result.ok) {
    const httpStatus = result.code === "GCAL_NOT_CONNECTED" ? 409 : result.code === "GCAL_NEEDS_REAUTH" ? 401 : 502;
    res.status(httpStatus).json({ code: result.code, message: result.message });
    return;
  }

  res.json({ events: result.events, count: result.events.length });
});
