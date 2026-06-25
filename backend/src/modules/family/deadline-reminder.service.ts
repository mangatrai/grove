import { qAll, qExec } from "../../db/query.js";
import { log } from "../../logger.js";
import { sendMail } from "../mailer/mailer.service.js";
import { renderDeadlineReminderTemplate } from "../mailer/templates/deadline-reminder.js";
import type { DeadlineReminderItem, ReminderHorizon } from "../mailer/templates/deadline-reminder.js";

type DeadlineRow = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  due_date: string;
  reminder_30d_sent_at: string | null;
  reminder_7d_sent_at: string | null;
  reminder_1d_sent_at: string | null;
};

type MemberEmailRow = {
  email: string;
  full_name: string;
};

function daysUntil(dueDateIso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDateIso}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function pendingHorizons(row: DeadlineRow, days: number): ReminderHorizon[] {
  const pending: ReminderHorizon[] = [];
  if (row.reminder_30d_sent_at === null && days <= 30) pending.push("30d");
  if (row.reminder_7d_sent_at === null && days <= 7) pending.push("7d");
  if (row.reminder_1d_sent_at === null && days <= 1) pending.push("1d");
  return pending;
}

export async function sendDeadlineReminders(): Promise<void> {
  // All active upcoming deadlines within 30-day window with at least one unsent reminder
  const deadlines = await qAll<DeadlineRow>(
    `SELECT id, household_id, title, description, due_date,
            reminder_30d_sent_at, reminder_7d_sent_at, reminder_1d_sent_at
     FROM family_events
     WHERE record_type = 'deadline'
       AND is_active = TRUE
       AND due_date IS NOT NULL
       AND due_date::date >= CURRENT_DATE
       AND due_date::date <= CURRENT_DATE + 30
       AND (
         reminder_30d_sent_at IS NULL
         OR (reminder_7d_sent_at IS NULL AND due_date::date <= CURRENT_DATE + 7)
         OR (reminder_1d_sent_at IS NULL AND due_date::date <= CURRENT_DATE + 1)
       )`
  );

  if (deadlines.length === 0) {
    log.debug("deadline-reminders: no pending reminders");
    return;
  }

  // Group by household
  const byHousehold = new Map<string, DeadlineRow[]>();
  for (const d of deadlines) {
    const list = byHousehold.get(d.household_id) ?? [];
    list.push(d);
    byHousehold.set(d.household_id, list);
  }

  for (const [householdId, rows] of byHousehold) {
    const members = await qAll<MemberEmailRow>(
      `SELECT DISTINCT p.email, p.full_name
       FROM person_profile p
       JOIN household_membership m ON m.person_profile_id = p.id
       WHERE p.household_id = ? AND p.linked_user_id IS NOT NULL AND p.email IS NOT NULL`,
      householdId
    );

    if (members.length === 0) {
      log.warn("deadline-reminders: no member emails for household", { householdId });
      continue;
    }

    // Build the consolidated item list for this household
    const items: DeadlineReminderItem[] = [];
    const toMark: Array<{ id: string; horizons: ReminderHorizon[] }> = [];

    for (const row of rows) {
      const days = daysUntil(row.due_date);
      const horizons = pendingHorizons(row, days);
      if (horizons.length === 0) continue;

      // Use the tightest pending horizon for display
      const tightest = horizons[horizons.length - 1];
      items.push({
        title: row.title,
        description: row.description,
        dueDate: row.due_date,
        daysUntil: days,
        horizon: tightest,
      });
      toMark.push({ id: row.id, horizons });
    }

    if (items.length === 0) continue;

    // Sort: tightest first (1d → 7d → 30d)
    items.sort((a, b) => a.daysUntil - b.daysUntil);

    const { subject, html, text } = renderDeadlineReminderTemplate({ items });

    let sent = 0;
    for (const member of members) {
      const result = await sendMail({ to: member.email, subject, html, text });
      if (result.ok) {
        sent++;
      } else {
        log.warn("deadline-reminders: email send failed", { householdId, email: member.email, reason: result.reason });
      }
    }

    if (sent === 0) continue;

    // Mark reminders sent
    for (const { id, horizons } of toMark) {
      for (const h of horizons) {
        const col =
          h === "1d" ? "reminder_1d_sent_at" :
          h === "7d" ? "reminder_7d_sent_at" :
                       "reminder_30d_sent_at";
        if (col === "reminder_1d_sent_at") {
          await qExec(`UPDATE family_events SET reminder_1d_sent_at = NOW() WHERE id = ?`, id);
        } else if (col === "reminder_7d_sent_at") {
          await qExec(`UPDATE family_events SET reminder_7d_sent_at = NOW() WHERE id = ?`, id);
        } else {
          await qExec(`UPDATE family_events SET reminder_30d_sent_at = NOW() WHERE id = ?`, id);
        }
      }
    }

    log.info("deadline-reminders: sent", {
      householdId,
      deadlineCount: items.length,
      recipientCount: sent,
    });
  }
}
