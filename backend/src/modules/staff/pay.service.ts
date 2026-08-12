import { qAll, qGet } from "../../db/query.js";
import { ensureEmployeeCategoryTree } from "./staff.service.js";
import type { PaySummary } from "./pay.types.js";

export async function getPaySummary(
  householdId: string,
  staffProfileId: string,
  personProfileId: string,
  createdByUserId: string,
  from: string,
  to: string
): Promise<PaySummary> {
  const categoryIds = await ensureEmployeeCategoryTree(householdId, createdByUserId);

  const timesheetRow = await qGet<{ cents: string | null }>(
    `SELECT ROUND(COALESCE(SUM(te.hours_worked * r.hourly_rate_cents), 0)) AS cents
     FROM timesheet_entry te
     JOIN timesheet_period tp ON tp.id = te.timesheet_period_id
     JOIN LATERAL (
       SELECT hourly_rate_cents FROM staff_rate
       WHERE staff_profile_id = tp.staff_profile_id AND effective_date <= te.work_date
       ORDER BY effective_date DESC LIMIT 1
     ) r ON true
     WHERE tp.staff_profile_id = ? AND tp.status = 'approved' AND te.work_date BETWEEN ? AND ?`,
    staffProfileId,
    from,
    to
  );

  const expenseRow = await qGet<{ cents: string | null }>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM staff_expense
     WHERE staff_profile_id = ? AND status = 'approved' AND expense_date BETWEEN ? AND ?`,
    staffProfileId,
    from,
    to
  );

  const paidRows = await qAll<{ category_id: string; cents: string | null }>(
    `SELECT category_id, COALESCE(SUM(-amount), 0) AS cents
     FROM transaction_canonical
     WHERE household_id = ? AND status = 'posted' AND owner_scope = 'person' AND owner_person_profile_id = ?
       AND category_id IN (?, ?, ?) AND txn_date BETWEEN ? AND ?
     GROUP BY category_id`,
    householdId,
    personProfileId,
    categoryIds.salaryCategoryId,
    categoryIds.bonusCategoryId,
    categoryIds.reimbursementCategoryId,
    from,
    to
  );
  const paidByCategory = new Map(paidRows.map((r) => [r.category_id, Math.round(Number(r.cents ?? 0))]));

  const timesheetCents = Math.round(Number(timesheetRow?.cents ?? 0));
  const expenseCents = Math.round(Number(expenseRow?.cents ?? 0));
  const earnedTotalCents = timesheetCents + expenseCents;

  const salaryCents = paidByCategory.get(categoryIds.salaryCategoryId) ?? 0;
  const bonusCents = paidByCategory.get(categoryIds.bonusCategoryId) ?? 0;
  const reimbursementCents = paidByCategory.get(categoryIds.reimbursementCategoryId) ?? 0;
  const paidTotalCents = salaryCents + bonusCents + reimbursementCents;

  return {
    staffProfileId,
    from,
    to,
    earned: {
      timesheetCents,
      expenseCents,
      totalCents: earnedTotalCents
    },
    paid: {
      salaryCents,
      bonusCents,
      reimbursementCents,
      totalCents: paidTotalCents
    },
    balanceDueCents: earnedTotalCents - paidTotalCents
  };
}
