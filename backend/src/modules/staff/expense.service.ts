import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";
import type { ExpenseStatus, StaffExpense, StaffExpenseInput, StaffExpenseSummary } from "./expense.types.js";

type ExpenseRow = {
  id: string;
  household_id: string;
  staff_profile_id: string;
  expense_date: string;
  category: string;
  amount_cents: number;
  description: string | null;
  status: ExpenseStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

const EXPENSE_SELECT = `
  SELECT id, household_id, staff_profile_id, expense_date, category, amount_cents,
         description, status, reviewed_by_user_id, reviewed_at, review_note, created_at
  FROM staff_expense
`;

function toExpense(row: ExpenseRow): StaffExpense {
  return {
    id: row.id,
    householdId: row.household_id,
    staffProfileId: row.staff_profile_id,
    expenseDate: row.expense_date,
    category: row.category,
    amountCents: row.amount_cents,
    description: row.description,
    status: row.status,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at
  };
}

export async function createExpense(
  householdId: string,
  staffProfileId: string,
  input: StaffExpenseInput
): Promise<StaffExpense> {
  const id = randomUUID();
  await qExec(
    `INSERT INTO staff_expense (id, household_id, staff_profile_id, expense_date, category, amount_cents, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    householdId,
    staffProfileId,
    input.expenseDate,
    input.category,
    input.amountCents,
    input.description ?? null
  );
  const created = await qGet<ExpenseRow>(`${EXPENSE_SELECT} WHERE id = ?`, id);
  return toExpense(created!);
}

export async function listMyExpenses(householdId: string, staffProfileId: string): Promise<StaffExpense[]> {
  const rows = await qAll<ExpenseRow>(
    `${EXPENSE_SELECT} WHERE household_id = ? AND staff_profile_id = ? ORDER BY expense_date DESC, created_at DESC`,
    householdId,
    staffProfileId
  );
  return rows.map(toExpense);
}

export async function listPendingExpenses(householdId: string): Promise<StaffExpenseSummary[]> {
  const rows = await qAll<ExpenseRow & { staff_full_name: string }>(
    `SELECT se.id, se.household_id, se.staff_profile_id, se.expense_date, se.category, se.amount_cents,
            se.description, se.status, se.reviewed_by_user_id, se.reviewed_at, se.review_note, se.created_at,
            p.full_name AS staff_full_name
     FROM staff_expense se
     JOIN staff_profile sp ON sp.id = se.staff_profile_id
     JOIN person_profile p ON p.id = sp.person_profile_id
     WHERE se.household_id = ? AND se.status = 'pending'
     ORDER BY se.expense_date ASC`,
    householdId
  );
  return rows.map((row) => ({ ...toExpense(row), staffFullName: row.staff_full_name }));
}

export async function approveExpense(
  householdId: string,
  expenseId: string,
  reviewerUserId: string
): Promise<{ ok: true; expense: StaffExpense } | { ok: false; code: "NOT_FOUND" | "NOT_PENDING" }> {
  const row = await qGet<ExpenseRow>(`${EXPENSE_SELECT} WHERE household_id = ? AND id = ?`, householdId, expenseId);
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status !== "pending") return { ok: false, code: "NOT_PENDING" };
  await qExec(
    `UPDATE staff_expense SET status = 'approved', reviewed_by_user_id = ?, reviewed_at = NOW(), review_note = NULL WHERE id = ?`,
    reviewerUserId,
    expenseId
  );
  const updated = await qGet<ExpenseRow>(`${EXPENSE_SELECT} WHERE id = ?`, expenseId);
  return { ok: true, expense: toExpense(updated!) };
}

export async function rejectExpense(
  householdId: string,
  expenseId: string,
  reviewerUserId: string,
  reviewNote: string
): Promise<{ ok: true; expense: StaffExpense } | { ok: false; code: "NOT_FOUND" | "NOT_PENDING" }> {
  const row = await qGet<ExpenseRow>(`${EXPENSE_SELECT} WHERE household_id = ? AND id = ?`, householdId, expenseId);
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status !== "pending") return { ok: false, code: "NOT_PENDING" };
  await qExec(
    `UPDATE staff_expense SET status = 'rejected', reviewed_by_user_id = ?, reviewed_at = NOW(), review_note = ? WHERE id = ?`,
    reviewerUserId,
    reviewNote,
    expenseId
  );
  const updated = await qGet<ExpenseRow>(`${EXPENSE_SELECT} WHERE id = ?`, expenseId);
  return { ok: true, expense: toExpense(updated!) };
}
