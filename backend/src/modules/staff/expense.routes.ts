import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { resolveAccessibleStaffMember } from "./staff.service.js";
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

const staffIdQuerySchema = z.object({ staffId: z.string().uuid().optional() });

/**
 * GET/POST /me[?staffId=]: staff callers always get their own expenses (staffId ignored/self-only);
 * owner/admin callers must supply staffId to select which household staff member's expenses to view/submit.
 */
expenseRouter.get("/me", requireRole(["staff", "owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const query = staffIdQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ errors: query.error.issues });
    return;
  }
  const member = await resolveAccessibleStaffMember(req, query.data.staffId);
  if (!member) {
    res.status(404).json({ message: "Staff member not found" });
    return;
  }
  const expenses = await listMyExpenses(req.authUser!.householdId, member.id);
  res.status(200).json({ expenses });
});

expenseRouter.post("/me", requireRole(["staff", "owner", "admin"]), async (req: AuthenticatedRequest, res) => {
  const parsed = createExpenseSchema.merge(staffIdQuerySchema).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const member = await resolveAccessibleStaffMember(req, parsed.data.staffId);
  if (!member) {
    res.status(404).json({ message: "Staff member not found" });
    return;
  }
  const expense = await createExpense(req.authUser!.householdId, member.id, parsed.data);
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
