import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { ALL_NOTIFICATION_TYPES } from "./notification.service.js";
import {
  getNotificationPreferences,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  upsertNotificationPreferences
} from "./notification.service.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

const prefsSchema = z.object({
  preferences: z.array(
    z.object({
      notificationType: z.enum(ALL_NOTIFICATION_TYPES as [string, ...string[]]) as z.ZodEnum<[string, ...string[]]>,
      enabledEmail: z.boolean(),
      enabledInapp: z.boolean()
    })
  )
});

/** GET /notifications — list (unread first, then last 10 read). */
notificationsRouter.get("/", requireRole(["owner", "admin", "member"]), async (req: AuthenticatedRequest, res) => {
  const { householdId, userId } = req.authUser!;
  const rows = await listNotifications(householdId, userId);
  res.json({ notifications: rows });
});

/** GET /notifications/unread-count — polled every 60s by frontend. */
notificationsRouter.get("/unread-count", requireRole(["owner", "admin", "member"]), async (req: AuthenticatedRequest, res) => {
  const { householdId, userId } = req.authUser!;
  const count = await getUnreadCount(householdId, userId);
  res.json({ count });
});

/** GET /notifications/preferences — full preference matrix for the authenticated user. */
notificationsRouter.get("/preferences", requireRole(["owner", "admin", "member"]), async (req: AuthenticatedRequest, res) => {
  const { householdId, userId } = req.authUser!;
  const prefs = await getNotificationPreferences(householdId, userId);
  res.json({ preferences: prefs });
});

/** PUT /notifications/preferences — bulk upsert preferences. */
notificationsRouter.put("/preferences", requireRole(["owner", "admin", "member"]), async (req: AuthenticatedRequest, res) => {
  const parsed = prefsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }
  const { householdId, userId } = req.authUser!;
  await upsertNotificationPreferences(householdId, userId, parsed.data.preferences as Parameters<typeof upsertNotificationPreferences>[2]);
  const prefs = await getNotificationPreferences(householdId, userId);
  res.json({ preferences: prefs });
});

/** POST /notifications/read-all — mark all as read. */
notificationsRouter.post("/read-all", requireRole(["owner", "admin", "member"]), async (req: AuthenticatedRequest, res) => {
  const { householdId, userId } = req.authUser!;
  await markAllNotificationsRead(householdId, userId);
  res.status(200).json({ ok: true });
});

/** PATCH /notifications/:id/read — mark single notification as read. */
notificationsRouter.patch("/:id/read", requireRole(["owner", "admin", "member"]), async (req: AuthenticatedRequest, res) => {
  const { householdId, userId } = req.authUser!;
  const notificationId = String(req.params.id ?? "").trim();
  if (!notificationId) {
    res.status(400).json({ message: "Missing notification id." });
    return;
  }
  const found = await markNotificationRead(householdId, userId, notificationId);
  if (!found) {
    res.status(404).json({ message: "Notification not found." });
    return;
  }
  res.status(200).json({ ok: true });
});
