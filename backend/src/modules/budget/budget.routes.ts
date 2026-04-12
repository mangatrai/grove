import { Router } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  type BudgetSuggestionsResult,
  getBudgetSuggestions,
  getBudgetWithActuals,
  listBudgetMonths,
  saveBudget
} from "./budget.service.js";

export const budgetRouter = Router();
budgetRouter.use(requireAuth);

const monthParam = z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM");

// ── GET /budget/suggest?month=YYYY-MM ────────────────────────────────────────
// Returns pre-populated suggestions for setting up a month's budget.
// Sorted by last-month spend descending so the heaviest categories appear first.
budgetRouter.get("/suggest", async (req: AuthenticatedRequest, res) => {
  const result = monthParam.safeParse(req.query.month);
  if (!result.success) {
    res.status(400).json({ message: "month query param required (YYYY-MM)" });
    return;
  }
  const householdId = req.authUser!.householdId;
  const result2: BudgetSuggestionsResult = await getBudgetSuggestions(householdId, result.data);
  res.json(result2);
});

// ── GET /budget/months ───────────────────────────────────────────────────────
// Lists all months that have at least one budget entry, newest first.
budgetRouter.get("/months", async (req: AuthenticatedRequest, res) => {
  const householdId = req.authUser!.householdId;
  const months = await listBudgetMonths(householdId);
  res.json({ months });
});

// ── GET /budget/:month ───────────────────────────────────────────────────────
// Returns budget + actual spend for the given month.
// `exists: false` when no budget is set; the UI shows the setup form in that case.
budgetRouter.get("/:month", async (req: AuthenticatedRequest, res) => {
  const result = monthParam.safeParse(req.params.month);
  if (!result.success) {
    res.status(400).json({ message: "month path param must be YYYY-MM" });
    return;
  }
  const householdId = req.authUser!.householdId;
  const budget = await getBudgetWithActuals(householdId, result.data);
  res.json(budget);
});

// ── PUT /budget/:month ───────────────────────────────────────────────────────
// Replace the entire budget for the month.
// Body: { entries: [{ categoryId, amount }] }
// Passing an empty entries array clears the budget for that month.
budgetRouter.put("/:month", async (req: AuthenticatedRequest, res) => {
  const monthResult = monthParam.safeParse(req.params.month);
  if (!monthResult.success) {
    res.status(400).json({ message: "month path param must be YYYY-MM" });
    return;
  }

  const bodySchema = z.object({
    entries: z.array(
      z.object({
        categoryId: z.string().uuid(),
        amount: z.number().min(0)
      })
    )
  });

  const bodyResult = bodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ errors: bodyResult.error.issues });
    return;
  }

  const householdId = req.authUser!.householdId;
  await saveBudget(householdId, monthResult.data, bodyResult.data.entries);

  // Return the saved budget with actuals so the UI can transition directly to progress view
  const budget = await getBudgetWithActuals(householdId, monthResult.data);
  res.json(budget);
});
