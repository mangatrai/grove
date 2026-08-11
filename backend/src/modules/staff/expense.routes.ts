import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { getStaffMemberForUser } from "./staff.service.js";
import { EXPENSE_CATEGORIES } from "./expense.types.js";
import { approveExpense, createExpense, listMyExpenses, listPendingExpenses, rejectExpense } from "./expense.service.js";

export const expenseRouter = Router();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

const createExpenseSchema = z.object({
  expenseDate: dateSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  amountCents: z.number().int().positive(),
  description: z.string().max(500).nullable().optional()
});

async function requireStaffContext(
  req: AuthenticatedRequest
): Promise<{ householdId: string; staffProfileId: string } | null> {
  const { householdId, personProfileId } = req.authUser!;
  if (!personProfileId) return null;
  const member = await getStaffMemberForUser(householdId, personProfileId);
  if (!member) return null;
  return { householdId, staffProfileId: member.id };
}

expenseRouter.get("/me", requireRole(["staff"]), async (req: AuthenticatedRequest, res) => {
  const ctx = await requireStaffContext(req);
  if (!ctx) {
    res.status(404).json({ message: "Staff profile not found" });
    return;
  }
  const expenses = await listMyExpenses(ctx.householdId, ctx.staffProfileId);
  res.status(200).json({ expenses });
});

expenseRouter.post("/me", requireRole(["staff"]), async (req: AuthenticatedRequest, res) => {
  const ctx = await requireStaffContext(req);
  if (!ctx) {
    res.status(404).json({ message: "Staff profile not found" });
    return;
  }
  const parsed = createExpenseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const expense = await createExpense(ctx.householdId, ctx.staffProfileId, parsed.data);
  res.status(201).json({ expense });
});

expenseRouter.get("/pending", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const expenses = await listPendingExpenses(req.authUser!.householdId);
  res.status(200).json({ expenses });
});

expenseRouter.post("/:expenseId/approve", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ expenseId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const out = await approveExpense(req.authUser!.householdId, params.data.expenseId, req.authUser!.userId);
  if (!out.ok) {
    res.status(out.code === "NOT_FOUND" ? 404 : 409).json({ message: "Cannot approve", code: out.code });
    return;
  }
  res.status(200).json({ expense: out.expense });
});

const rejectSchema = z.object({ reviewNote: z.string().min(1).max(1000) });

expenseRouter.post("/:expenseId/reject", requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const params = z.object({ expenseId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const body = rejectSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ errors: body.error.issues });
    return;
  }
  const out = await rejectExpense(
    req.authUser!.householdId,
    params.data.expenseId,
    req.authUser!.userId,
    body.data.reviewNote
  );
  if (!out.ok) {
    res.status(out.code === "NOT_FOUND" ? 404 : 409).json({ message: "Cannot reject", code: out.code });
    return;
  }
  res.status(200).json({ expense: out.expense });
});
