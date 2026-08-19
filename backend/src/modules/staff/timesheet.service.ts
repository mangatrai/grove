import { randomUUID } from "node:crypto";

import { qAll, qBegin, qExec, qGet } from "../../db/query.js";
import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { listAvailability } from "../family/family-profiles.service.js";
import { sendMail } from "../mailer/mailer.service.js";
import { renderStaffSubmissionTemplate } from "../mailer/templates/staff-submission.js";
import { renderStaffApprovedTemplate } from "../mailer/templates/staff-approved.js";
import type {
  TimesheetEntry,
  TimesheetEntryInput,
  TimesheetPeriod,
  TimesheetPeriodStatus,
  TimesheetPeriodSummary
} from "./timesheet.types.js";

/** rejected periods are edit-and-resubmit, same as draft — the schema distinguishes them so the
 * staff portal can show *why* it bounced without losing the reviewer's note on the next edit. */
const EDITABLE_STATUSES: TimesheetPeriodStatus[] = ["draft", "rejected"];

function toMondayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Household-local "today", per the env.TZ standing rule — never server/UTC time. */
export function currentWeekStart(): string {
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: env.TZ });
  return toMondayIso(todayIso);
}

export function weekDates(weekStartDate: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartDate, i));
}

function timeRangeHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return Math.max(0, Math.round((minutes / 60) * 100) / 100);
}

/** Prefill hint for the weekly timesheet grid — computed live from household_help_availability
 * (slot_type='regular'), the same table the Family Planner agent reads for scheduling context. */
export async function computeScheduledHours(
  householdId: string,
  personProfileId: string,
  weekStartDate: string
): Promise<Record<string, number>> {
  const slots = await listAvailability(householdId);
  const regularSlots = slots.filter(
    (s) => s.slotType === "regular" && s.personProfileId === personProfileId && s.startTime && s.endTime
  );
  const result: Record<string, number> = {};
  for (const date of weekDates(weekStartDate)) {
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    const hours = regularSlots
      .filter((s) => s.daysOfWeek.includes(dayOfWeek))
      .reduce((sum, s) => sum + timeRangeHours(s.startTime!, s.endTime!), 0);
    if (hours > 0) {
      result[date] = Math.round(hours * 100) / 100;
    }
  }
  return result;
}

type PeriodRow = {
  id: string;
  household_id: string;
  staff_profile_id: string;
  week_start_date: string;
  status: TimesheetPeriodStatus;
  submitted_at: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

type EntryRow = {
  id: string;
  work_date: string;
  hours_worked: string;
  note: string | null;
};

const PERIOD_SELECT = `
  SELECT id, household_id, staff_profile_id, week_start_date, status,
         submitted_at, reviewed_by_user_id, reviewed_at, review_note
  FROM timesheet_period
`;

function toEntry(row: EntryRow): TimesheetEntry {
  return { id: row.id, workDate: row.work_date, hoursWorked: Number(row.hours_worked), note: row.note };
}

async function loadEntries(periodId: string): Promise<TimesheetEntry[]> {
  const rows = await qAll<EntryRow>(
    `SELECT id, work_date, hours_worked, note FROM timesheet_entry WHERE timesheet_period_id = ? ORDER BY work_date`,
    periodId
  );
  return rows.map(toEntry);
}

function sumHours(entries: TimesheetEntry[]): number {
  return Math.round(entries.reduce((sum, e) => sum + e.hoursWorked, 0) * 100) / 100;
}

async function toPeriod(row: PeriodRow): Promise<TimesheetPeriod> {
  const entries = await loadEntries(row.id);
  return {
    id: row.id,
    householdId: row.household_id,
    staffProfileId: row.staff_profile_id,
    weekStartDate: row.week_start_date,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    entries,
    totalHours: sumHours(entries)
  };
}

export async function getOrCreateDraftPeriod(
  householdId: string,
  staffProfileId: string,
  weekStartDate: string
): Promise<TimesheetPeriod> {
  const existing = await qGet<PeriodRow>(
    `${PERIOD_SELECT} WHERE staff_profile_id = ? AND week_start_date = ?`,
    staffProfileId,
    weekStartDate
  );
  if (existing) {
    return toPeriod(existing);
  }
  const id = randomUUID();
  await qExec(
    `INSERT INTO timesheet_period (id, household_id, staff_profile_id, week_start_date) VALUES (?, ?, ?, ?)`,
    id,
    householdId,
    staffProfileId,
    weekStartDate
  );
  const created = await qGet<PeriodRow>(`${PERIOD_SELECT} WHERE id = ?`, id);
  return toPeriod(created!);
}

export async function getPeriodById(householdId: string, periodId: string): Promise<TimesheetPeriod | undefined> {
  const row = await qGet<PeriodRow>(`${PERIOD_SELECT} WHERE household_id = ? AND id = ?`, householdId, periodId);
  return row ? toPeriod(row) : undefined;
}

export async function saveEntries(
  householdId: string,
  staffProfileId: string,
  weekStartDate: string,
  entries: TimesheetEntryInput[]
): Promise<{ ok: true; period: TimesheetPeriod } | { ok: false; code: "NOT_EDITABLE" | "INVALID_DATE" }> {
  const period = await getOrCreateDraftPeriod(householdId, staffProfileId, weekStartDate);
  if (!EDITABLE_STATUSES.includes(period.status)) {
    return { ok: false, code: "NOT_EDITABLE" };
  }
  const validDates = new Set(weekDates(weekStartDate));
  for (const e of entries) {
    if (!validDates.has(e.workDate)) {
      return { ok: false, code: "INVALID_DATE" };
    }
  }

  await qBegin(async (tx) => {
    await tx.unsafe(`DELETE FROM timesheet_entry WHERE timesheet_period_id = $1`, [period.id] as never[]);
    for (const e of entries) {
      await tx.unsafe(
        `INSERT INTO timesheet_entry (id, household_id, timesheet_period_id, work_date, hours_worked, note)
  VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), householdId, period.id, e.workDate, e.hoursWorked, e.note ?? null] as never[]
      );
    }
  });

  const updated = await getPeriodById(householdId, period.id);
  return { ok: true, period: updated! };
}

export async function submitPeriod(
  householdId: string,
  staffProfileId: string,
  weekStartDate: string
): Promise<{ ok: true; period: TimesheetPeriod } | { ok: false; code: "NOT_EDITABLE" | "EMPTY" }> {
  const period = await getOrCreateDraftPeriod(householdId, staffProfileId, weekStartDate);
  if (!EDITABLE_STATUSES.includes(period.status)) {
    return { ok: false, code: "NOT_EDITABLE" };
  }
  if (period.entries.length === 0) {
    return { ok: false, code: "EMPTY" };
  }
  await qExec(
    `UPDATE timesheet_period
     SET status = 'submitted', submitted_at = NOW(), reviewed_by_user_id = NULL, reviewed_at = NULL, review_note = NULL
     WHERE id = ?`,
    period.id
  );
  const updated = await getPeriodById(householdId, period.id);
  void notifyTimesheetSubmitted(householdId, staffProfileId, updated!);
  return { ok: true, period: updated! };
}

async function notifyTimesheetSubmitted(
  householdId: string,
  staffProfileId: string,
  period: TimesheetPeriod
): Promise<void> {
  try {
    const staff = await qGet<{ full_name: string }>(
      `SELECT p.full_name FROM staff_profile sp JOIN person_profile p ON p.id = sp.person_profile_id WHERE sp.id = ?`,
      staffProfileId
    );
    const recipients = await qAll<{ email: string }>(
      `SELECT email FROM app_user WHERE household_id = ? AND role IN ('owner', 'admin')`,
      householdId
    );
    if (!staff || recipients.length === 0) return;
    const template = renderStaffSubmissionTemplate({
      kind: "timesheet",
      staffName: staff.full_name,
      detail: `Week of ${period.weekStartDate} — ${period.totalHours} hour${period.totalHours === 1 ? "" : "s"}.`,
      reviewUrl: `${env.PUBLIC_BASE_URL}/staff-admin/timesheets`
    });
    for (const recipient of recipients) {
      void sendMail({ to: recipient.email, ...template });
    }
  } catch (err) {
    log.warn(`Timesheet submission notification failed for staff ${staffProfileId}: ${String(err)}`);
  }
}

export async function listPendingPeriods(householdId: string): Promise<TimesheetPeriodSummary[]> {
  const rows = await qAll<{
    id: string;
    staff_profile_id: string;
    staff_full_name: string;
    week_start_date: string;
    status: TimesheetPeriodStatus;
    submitted_at: string | null;
    total_hours: string | null;
  }>(
    `SELECT tp.id, tp.staff_profile_id, p.full_name AS staff_full_name, tp.week_start_date,
            tp.status, tp.submitted_at,
            (SELECT COALESCE(SUM(te.hours_worked), 0) FROM timesheet_entry te WHERE te.timesheet_period_id = tp.id) AS total_hours
     FROM timesheet_period tp
     JOIN staff_profile sp ON sp.id = tp.staff_profile_id
     JOIN person_profile p ON p.id = sp.person_profile_id
     WHERE tp.household_id = ? AND tp.status = 'submitted'
     ORDER BY tp.submitted_at ASC`,
    householdId
  );
  return rows.map((row) => ({
    id: row.id,
    staffProfileId: row.staff_profile_id,
    staffFullName: row.staff_full_name,
    weekStartDate: row.week_start_date,
    status: row.status,
    submittedAt: row.submitted_at,
    totalHours: Math.round(Number(row.total_hours ?? 0) * 100) / 100
  }));
}

export async function approvePeriod(
  householdId: string,
  periodId: string,
  reviewerUserId: string
): Promise<{ ok: true; period: TimesheetPeriod } | { ok: false; code: "NOT_FOUND" | "NOT_SUBMITTED" }> {
  const period = await getPeriodById(householdId, periodId);
  if (!period) return { ok: false, code: "NOT_FOUND" };
  if (period.status !== "submitted") return { ok: false, code: "NOT_SUBMITTED" };
  await qExec(
    `UPDATE timesheet_period SET status = 'approved', reviewed_by_user_id = ?, reviewed_at = NOW(), review_note = NULL WHERE id = ?`,
    reviewerUserId,
    periodId
  );
  const updated = await getPeriodById(householdId, periodId);
  void notifyTimesheetApproved(updated!);
  return { ok: true, period: updated! };
}

async function notifyTimesheetApproved(period: TimesheetPeriod): Promise<void> {
  try {
    const staff = await qGet<{ email: string | null }>(
      `SELECT p.email FROM staff_profile sp JOIN person_profile p ON p.id = sp.person_profile_id WHERE sp.id = ?`,
      period.staffProfileId
    );
    if (!staff?.email) return;
    const template = renderStaffApprovedTemplate({
      kind: "timesheet",
      detail: `Your timesheet for the week of ${period.weekStartDate} (${period.totalHours} hour${period.totalHours === 1 ? "" : "s"}) has been approved.`,
      portalUrl: `${env.PUBLIC_BASE_URL}/staff`
    });
    void sendMail({ to: staff.email, ...template });
  } catch (err) {
    log.warn(`Timesheet approval notification failed for period ${period.id}: ${String(err)}`);
  }
}

export async function rejectPeriod(
  householdId: string,
  periodId: string,
  reviewerUserId: string,
  reviewNote: string
): Promise<{ ok: true; period: TimesheetPeriod } | { ok: false; code: "NOT_FOUND" | "NOT_SUBMITTED" }> {
  const period = await getPeriodById(householdId, periodId);
  if (!period) return { ok: false, code: "NOT_FOUND" };
  if (period.status !== "submitted") return { ok: false, code: "NOT_SUBMITTED" };
  await qExec(
    `UPDATE timesheet_period SET status = 'rejected', reviewed_by_user_id = ?, reviewed_at = NOW(), review_note = ? WHERE id = ?`,
    reviewerUserId,
    reviewNote,
    periodId
  );
  const updated = await getPeriodById(householdId, periodId);
  return { ok: true, period: updated! };
}
