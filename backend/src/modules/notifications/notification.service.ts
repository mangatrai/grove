import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";
import { log } from "../../logger.js";
import { sendMail } from "../mailer/mailer.service.js";

export type NotificationType =
  | "import_complete"
  | "export_ready"
  | "restore_complete"
  | "backup_complete"
  | "backup_failed"
  | "property_valuation_updated"
  | "budget_threshold_80"
  | "budget_threshold_100"
  | "large_transaction"
  | "protest_filing_deadline_approaching"
  | "protest_hearing_approaching";

type NotificationDefault = {
  enabledEmail: boolean;
  enabledInapp: boolean;
  audience: "owner" | "triggering_user" | "all";
};

const NOTIFICATION_DEFAULTS: Record<NotificationType, NotificationDefault> = {
  import_complete:                     { enabledEmail: false, enabledInapp: true,  audience: "triggering_user" },
  export_ready:                        { enabledEmail: true,  enabledInapp: true,  audience: "triggering_user" },
  restore_complete:                    { enabledEmail: true,  enabledInapp: true,  audience: "owner"            },
  backup_complete:                     { enabledEmail: false, enabledInapp: true,  audience: "owner"            },
  backup_failed:                       { enabledEmail: true,  enabledInapp: true,  audience: "owner"            },
  property_valuation_updated:          { enabledEmail: false, enabledInapp: true,  audience: "owner"            },
  budget_threshold_80:                 { enabledEmail: false, enabledInapp: true,  audience: "all"              },
  budget_threshold_100:                { enabledEmail: true,  enabledInapp: true,  audience: "all"              },
  large_transaction:                   { enabledEmail: false, enabledInapp: true,  audience: "all"              },
  protest_filing_deadline_approaching: { enabledEmail: true,  enabledInapp: true,  audience: "owner"            },
  protest_hearing_approaching:         { enabledEmail: true,  enabledInapp: true,  audience: "owner"            },
};

export const ALL_NOTIFICATION_TYPES = Object.keys(NOTIFICATION_DEFAULTS) as NotificationType[];

export type NotificationRow = {
  id: string;
  householdId: string;
  userId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPreferenceRow = {
  userId: string;
  notificationType: NotificationType;
  enabledEmail: boolean;
  enabledInapp: boolean;
};

function mapNotificationRow(r: Record<string, unknown>): NotificationRow {
  return {
    id: r.id as string,
    householdId: r.household_id as string,
    userId: (r.user_id as string) ?? null,
    type: r.type as NotificationType,
    title: r.title as string,
    body: r.body as string,
    actionUrl: (r.action_url as string) ?? null,
    readAt: r.read_at ? String(r.read_at) : null,
    createdAt: String(r.created_at)
  };
}

function mapPrefRow(r: Record<string, unknown>): NotificationPreferenceRow {
  return {
    userId: r.user_id as string,
    notificationType: r.notification_type as NotificationType,
    enabledEmail: Boolean(r.enabled_email),
    enabledInapp: Boolean(r.enabled_inapp)
  };
}

/**
 * Get effective preference for a user/type pair.
 * Returns stored value if present, otherwise returns type default.
 */
async function getEffectivePref(
  userId: string,
  type: NotificationType
): Promise<NotificationDefault> {
  const row = await qGet<Record<string, unknown>>(
    `SELECT enabled_email, enabled_inapp FROM notification_preference
       WHERE user_id = ? AND notification_type = ?`,
    userId,
    type
  );
  if (row) {
    return { enabledEmail: Boolean(row.enabled_email), enabledInapp: Boolean(row.enabled_inapp), audience: NOTIFICATION_DEFAULTS[type].audience };
  }
  return NOTIFICATION_DEFAULTS[type];
}

/**
 * Create a notification for a user (or broadcast to all household members when userId is omitted).
 * Respects per-user preferences for in-app and email delivery.
 */
export async function createNotification(opts: {
  householdId: string;
  userId?: string;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl?: string;
}): Promise<void> {
  const { householdId, type, title, body, actionUrl } = opts;

  let targets: Array<{ userId: string; email: string }>;
  const audience = NOTIFICATION_DEFAULTS[type].audience;
  if (opts.userId) {
    const row = await qGet<{ email: string }>(
      `SELECT email FROM app_user WHERE id = ? AND household_id = ?`,
      opts.userId,
      householdId
    );
    targets = row ? [{ userId: opts.userId, email: row.email }] : [];
  } else if (audience === "owner") {
    const ownerRow = await qGet<{ id: string; email: string }>(
      `SELECT id, email FROM app_user WHERE household_id = ? AND role = 'owner' LIMIT 1`,
      householdId
    );
    targets = ownerRow ? [{ userId: ownerRow.id, email: ownerRow.email }] : [];
  } else if (audience === "triggering_user") {
    log.warn("createNotification: triggering_user type called without userId — skipped", { type });
    return;
  } else {
    const rows = await qAll<{ id: string; email: string }>(
      `SELECT id, email FROM app_user WHERE household_id = ? ORDER BY id`,
      householdId
    );
    targets = rows.map((r) => ({ userId: r.id, email: r.email }));
  }

  for (const target of targets) {
    const pref = await getEffectivePref(target.userId, type);

    if (pref.enabledInapp) {
      await qExec(
        `INSERT INTO notification (id, household_id, user_id, type, title, body, action_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        householdId,
        target.userId,
        type,
        title,
        body,
        actionUrl ?? null
      );
    }

    if (pref.enabledEmail && target.email) {
      void sendMail({
        to: target.email,
        subject: title,
        html: `<p>${body}</p>`,
        text: body
      }).then((result) => {
        if (!result.ok) {
          log.warn("notification email send failed", { type, userId: target.userId, reason: result.reason });
        }
      });
    }
  }
}

/** List notifications for a user — unread first, then up to 10 most recent read. Max 50 total. */
export async function listNotifications(
  householdId: string,
  userId: string
): Promise<NotificationRow[]> {
  const unread = await qAll<Record<string, unknown>>(
    `SELECT id, household_id, user_id, type, title, body, action_url, read_at, created_at
       FROM notification
       WHERE household_id = ? AND user_id = ? AND read_at IS NULL
       ORDER BY created_at DESC
       LIMIT 40`,
    householdId,
    userId
  );
  const read = await qAll<Record<string, unknown>>(
    `SELECT id, household_id, user_id, type, title, body, action_url, read_at, created_at
       FROM notification
       WHERE household_id = ? AND user_id = ? AND read_at IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 10`,
    householdId,
    userId
  );
  return [...unread, ...read].map(mapNotificationRow);
}

export async function getUnreadCount(householdId: string, userId: string): Promise<number> {
  const row = await qGet<{ count: string }>(
    `SELECT COUNT(*) AS count FROM notification
       WHERE household_id = ? AND user_id = ? AND read_at IS NULL`,
    householdId,
    userId
  );
  return Number(row?.count ?? 0);
}

export async function markNotificationRead(
  householdId: string,
  userId: string,
  notificationId: string
): Promise<boolean> {
  const existing = await qGet<{ id: string }>(
    `SELECT id FROM notification WHERE id = ? AND household_id = ? AND user_id = ?`,
    notificationId,
    householdId,
    userId
  );
  if (!existing) return false;
  await qExec(
    `UPDATE notification SET read_at = NOW() WHERE id = ? AND read_at IS NULL`,
    notificationId
  );
  return true;
}

export async function markAllNotificationsRead(householdId: string, userId: string): Promise<void> {
  await qExec(
    `UPDATE notification SET read_at = NOW()
       WHERE household_id = ? AND user_id = ? AND read_at IS NULL`,
    householdId,
    userId
  );
}

/**
 * Return full preference matrix for a user — one entry per notification type.
 * Missing stored rows fall back to type defaults.
 */
export async function getNotificationPreferences(
  householdId: string,
  userId: string
): Promise<NotificationPreferenceRow[]> {
  const rows = await qAll<Record<string, unknown>>(
    `SELECT user_id, notification_type, enabled_email, enabled_inapp
       FROM notification_preference
       WHERE household_id = ? AND user_id = ?`,
    householdId,
    userId
  );
  const stored = new Map(rows.map((r) => [r.notification_type as string, mapPrefRow(r)]));

  return ALL_NOTIFICATION_TYPES.map((type) => {
    if (stored.has(type)) return stored.get(type)!;
    const d = NOTIFICATION_DEFAULTS[type];
    return { userId, notificationType: type, enabledEmail: d.enabledEmail, enabledInapp: d.enabledInapp };
  });
}

export async function upsertNotificationPreferences(
  householdId: string,
  userId: string,
  prefs: Array<{ notificationType: NotificationType; enabledEmail: boolean; enabledInapp: boolean }>
): Promise<void> {
  for (const p of prefs) {
    await qExec(
      `INSERT INTO notification_preference (id, household_id, user_id, notification_type, enabled_email, enabled_inapp)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, notification_type) DO UPDATE SET
           enabled_email = EXCLUDED.enabled_email,
           enabled_inapp = EXCLUDED.enabled_inapp`,
      randomUUID(),
      householdId,
      userId,
      p.notificationType,
      p.enabledEmail,
      p.enabledInapp
    );
  }
}

/**
 * After an import finishes, check each budgeted category for the current month.
 * Fires budget_threshold_80 or budget_threshold_100 notifications (at most once per
 * category per month — deduped by checking for an existing notification this month).
 */
export async function checkBudgetThresholds(householdId: string): Promise<void> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const budgets = await qAll<{ category_id: string; amount: number; category_name: string }>(
    `SELECT bc.category_id, bc.amount, COALESCE(c.name, bc.category_id) AS category_name
       FROM budget_category bc
       LEFT JOIN category c ON c.id = bc.category_id
       WHERE bc.household_id = ? AND bc.month = ?`,
    householdId,
    yearMonth
  );
  if (budgets.length === 0) return;

  const nextMonth = now.getMonth() === 11
    ? `${now.getFullYear() + 1}-01-01`
    : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, "0")}-01`;

  const actuals = await qAll<{ category_id: string; total: string }>(
    `SELECT category_id, SUM(ABS(amount)) AS total
       FROM transaction_canonical
       WHERE household_id = ?
         AND txn_date >= ? AND txn_date < ?
         AND status = 'posted'
         AND direction = 'debit'
         AND category_id IS NOT NULL
       GROUP BY category_id`,
    householdId,
    `${yearMonth}-01`,
    nextMonth
  );

  const spendMap = new Map(actuals.map((a) => [a.category_id, Number(a.total)]));

  for (const b of budgets) {
    const spent = spendMap.get(b.category_id) ?? 0;
    const limit = Number(b.amount);
    if (limit <= 0) continue;
    const pct = (spent / limit) * 100;

    if (pct >= 100) {
      const alreadySent = await qGet<{ id: string }>(
        `SELECT id FROM notification
           WHERE household_id = ? AND type = 'budget_threshold_100'
             AND body LIKE ? AND created_at >= ?`,
        householdId,
        `%${b.category_id}%`,
        `${yearMonth}-01`
      );
      if (!alreadySent) {
        await createNotification({
          householdId,
          type: "budget_threshold_100",
          title: "Budget limit reached",
          body: `You've reached 100% of your monthly budget for ${b.category_name} (${pct.toFixed(0)}% spent).`,
          actionUrl: "/budget"
        });
      }
    } else if (pct >= 80) {
      const alreadySent = await qGet<{ id: string }>(
        `SELECT id FROM notification
           WHERE household_id = ? AND type = 'budget_threshold_80'
             AND body LIKE ? AND created_at >= ?`,
        householdId,
        `%${b.category_id}%`,
        `${yearMonth}-01`
      );
      if (!alreadySent) {
        await createNotification({
          householdId,
          type: "budget_threshold_80",
          title: "Budget threshold warning",
          body: `You've used ${pct.toFixed(0)}% of your monthly budget for ${b.category_name}.`,
          actionUrl: "/budget"
        });
      }
    }
  }
}

/**
 * Check protest deadlines for all non-resolved worksheets in a household.
 * Fires deadline notifications at 30/7/1 days before filing_deadline and hearing_date.
 * Deduped — skips if a notification of the same type + action_url was created in the last 2 days.
 * Call fire-and-forget when loading a protest worksheet.
 */
export async function checkProtestDeadlines(householdId: string, userId: string): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  type WorksheetDeadlineRow = {
    id: string;
    property_id: string;
    tax_year: number;
    filing_deadline: string | Date | null;
    hearing_date: string | Date | null;
  };

  const worksheets = await qAll<WorksheetDeadlineRow>(
    `SELECT id, property_id, tax_year, filing_deadline, hearing_date
       FROM protest_worksheet
       WHERE household_id = ? AND status != 'resolved'`,
    householdId
  );
  if (worksheets.length === 0) return;

  const THRESHOLDS = [30, 7, 1];

  for (const ws of worksheets) {
    const actionUrl = `/tax-protest?propertyId=${ws.property_id}&year=${ws.tax_year}`;

    const deadlines: Array<{ date: string | Date | null; type: NotificationType; label: string }> = [
      { date: ws.filing_deadline, type: "protest_filing_deadline_approaching", label: "Filing deadline" },
      { date: ws.hearing_date,    type: "protest_hearing_approaching",         label: "ARB hearing"      },
    ];

    for (const { date, type, label } of deadlines) {
      if (!date) continue;
      const d = typeof date === "string" ? new Date(date) : date;
      d.setUTCHours(0, 0, 0, 0);
      const daysUntil = Math.round((d.getTime() - today.getTime()) / 86_400_000);
      if (daysUntil < 0 || daysUntil > 30) continue;

      const matchedThreshold = THRESHOLDS.find((t) => daysUntil <= t);
      if (!matchedThreshold) continue;

      const alreadySent = await qGet<{ id: string }>(
        `SELECT id FROM notification
           WHERE household_id = ? AND user_id = ? AND type = ? AND action_url = ?
             AND created_at > NOW() - INTERVAL '2 days'
           LIMIT 1`,
        householdId,
        userId,
        type,
        actionUrl
      );
      if (alreadySent) continue;

      const dateStr = typeof date === "string" ? date.slice(0, 10) : d.toISOString().slice(0, 10);
      const daysLabel = daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
      await createNotification({
        householdId,
        userId,
        type,
        title: `${label} ${daysLabel === "today" ? "is today" : `${daysLabel}`}`,
        body: `${label} for your property tax protest (year ${ws.tax_year}) is on ${dateStr} — ${daysLabel}.`,
        actionUrl
      });
    }
  }
}

/** Purge notifications older than 90 days. Call once on server startup. */
export async function purgeOldNotifications(): Promise<void> {
  const r = await qGet<{ count: string }>(
    `SELECT COUNT(*) AS count FROM notification WHERE created_at < NOW() - INTERVAL '90 days'`
  );
  const count = Number(r?.count ?? 0);
  if (count === 0) return;
  await qExec(`DELETE FROM notification WHERE created_at < NOW() - INTERVAL '90 days'`);
  log.info(`Purged ${count} notifications older than 90 days.`);
}
