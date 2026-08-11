export type ExpenseStatus = "pending" | "approved" | "rejected";

export const EXPENSE_CATEGORIES = [
  "Transportation/Mileage",
  "Groceries & Kids' Supplies",
  "Activities & Outings",
  "Parking & Tolls",
  "Medical/First Aid",
  "Other"
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type StaffExpenseInput = {
  expenseDate: string;
  category: string;
  amountCents: number;
  description?: string | null;
};

export type StaffExpense = {
  id: string;
  householdId: string;
  staffProfileId: string;
  expenseDate: string;
  category: string;
  amountCents: number;
  description: string | null;
  status: ExpenseStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export type StaffExpenseSummary = StaffExpense & { staffFullName: string };
