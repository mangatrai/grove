import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet, qBegin, sqlBind } from "../../db/query.js";
import { log } from "../../logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type BudgetEntry = {
  categoryId: string;
  amount: number;
};

/** A single category row in the budget suggestion response. */
export type BudgetSuggestionRow = {
  categoryId: string;
  categoryName: string;
  parentName: string | null;
  /** Suggested starting amount for this month's budget. */
  suggestedAmount: number;
  /** Where the suggestion came from. */
  basis: "last_month" | "three_month_avg";
  lastMonthActual: number;
  threeMonthAvg: number;
};

export type BudgetSuggestionsResult = {
  /** The YYYY-MM month the suggestions were requested for. */
  month: string;
  /**
   * The most recent calendar month for which data was found (used as "last month" anchor).
   * Null when no categorized debit data exists at all.
   * May be earlier than calendar month-1 when imports lag behind the current date.
   */
  dataAsOf: string | null;
  suggestions: BudgetSuggestionRow[];
};

/** A single category row in the budget-vs-actual view. */
export type BudgetCategoryRow = {
  categoryId: string;
  categoryName: string;
  parentName: string | null;
  budgeted: number;
  spent: number;
  remaining: number;
  percentUsed: number;
};

export type BudgetResult = {
  month: string;
  exists: boolean;
  summary: {
    totalBudgeted: number;
    totalSpent: number;
    remaining: number;
    unbudgetedSpend: number;
  };
  categories: BudgetCategoryRow[];
};

export type BudgetMonthSummary = {
  month: string;
  totalBudgeted: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Validate and return a YYYY-MM string or throw. */
function assertMonth(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid month format: "${month}". Expected YYYY-MM.`);
  }
  return month;
}

/** Return first and last day of a YYYY-MM month as YYYY-MM-DD strings. */
function monthBounds(yyyyMm: string): { start: string; end: string } {
  const [y, m] = yyyyMm.split("-").map(Number);
  const start = `${yyyyMm}-01`;
  // Last day: first day of next month minus one day
  const lastDay = new Date(Date.UTC(y, m, 0)); // month is 1-based; Date rolls back correctly
  const end = lastDay.toISOString().slice(0, 10);
  return { start, end };
}

/** Return the YYYY-MM string for the calendar month immediately before the given month. */
function prevMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1)); // first of given month
  d.setUTCMonth(d.getUTCMonth() - 1); // go back one month
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Return a YYYY-MM that is `n` calendar months before the given month. */
function shiftMonthBack(yyyyMm: string, n: number): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Return suggested budget amounts for `month`.
 *
 * Rather than anchoring to "calendar month - 1", this function finds the most
 * recent calendar month that contains categorised debit spend and uses that as
 * the "last month" anchor.  This handles the common case where imported bank
 * statements lag several months behind the current date — so a household whose
 * most recent import covers January 2026 still gets useful suggestions when
 * setting up an April 2026 budget.
 *
 * Suggestion logic per category:
 *  - If it had spend in the anchor month → basis: "last_month"
 *  - Else if it had spend in the prior 5 months → basis: "three_month_avg" (6-month window / 6)
 *
 * Only debit (outflow) transactions are included. Transfer-linked rows and
 * uncategorised transactions are excluded.
 */
export async function getBudgetSuggestions(
  householdId: string,
  month: string
): Promise<BudgetSuggestionsResult> {
  assertMonth(month);

  // ── Step 1: Find the most recent month with categorised debit spend ──────
  // Cap the lookback to 24 months before `month` to avoid matching arbitrarily
  // old data (e.g. dev-seed rows dated 1999 or 2099).
  const cap = shiftMonthBack(month, 1);   // never go future of month-1
  const floor = shiftMonthBack(month, 24); // never go further back than 2 years

  const anchorRow = await qGet<{ anchor: string }>(
    `SELECT LEFT(MAX(txn_date::text), 7) AS anchor
     FROM transaction_canonical
     WHERE household_id     = ?
       AND status           = 'posted'
       AND direction        = 'debit'
       AND transfer_group_id IS NULL
       AND category_id      IS NOT NULL
       AND txn_date         <= ?
       AND txn_date         >= ?`,
    householdId,
    monthBounds(cap).end,
    monthBounds(floor).start
  );

  if (!anchorRow?.anchor) {
    log.info(`getBudgetSuggestions: no categorised debit data found for household ${householdId} in last 24 months`);
    return { month, dataAsOf: null, suggestions: [] };
  }

  const anchor = anchorRow.anchor; // YYYY-MM of the most recent active month

  // ── Step 2: Build 6-month window ending at anchor ─────────────────────────
  const anchorBounds = monthBounds(anchor);
  const windowStart = monthBounds(shiftMonthBack(anchor, 5)).start;
  const windowEnd = anchorBounds.end;

  type ActualRow = {
    category_id: string;
    category_name: string;
    parent_name: string | null;
    anchor_month_total: string;
    window_total: string;
    window_months: string; // count of distinct months with spend (for accurate avg)
  };

  const rows = await qAll<ActualRow>(
    `SELECT
       tc.category_id,
       c.name                                            AS category_name,
       parent.name                                       AS parent_name,
       SUM(CASE
         WHEN tc.txn_date >= ? AND tc.txn_date <= ?
         THEN tc.amount ELSE 0
       END)                                              AS anchor_month_total,
       SUM(tc.amount)                                    AS window_total,
       COUNT(DISTINCT LEFT(tc.txn_date::text, 7))        AS window_months
     FROM transaction_canonical tc
     JOIN category c      ON c.id = tc.category_id
     LEFT JOIN category parent ON parent.id = c.parent_id
     WHERE tc.household_id   = ?
       AND tc.status         = 'posted'
       AND tc.direction      = 'debit'
       AND tc.transfer_group_id IS NULL
       AND tc.category_id    IS NOT NULL
       AND tc.txn_date       >= ?
       AND tc.txn_date       <= ?
     GROUP BY tc.category_id, c.name, parent.name
     HAVING SUM(tc.amount) > 0
     ORDER BY anchor_month_total DESC, window_total DESC`,
    anchorBounds.start,
    anchorBounds.end,
    householdId,
    windowStart,
    windowEnd
  );

  const suggestions: BudgetSuggestionRow[] = rows.map((r) => {
    const anchorActual = parseFloat(r.anchor_month_total) || 0;
    const windowTotal = parseFloat(r.window_total) || 0;
    const months = parseInt(r.window_months, 10) || 1;
    const windowAvg = Math.round((windowTotal / months) * 100) / 100;
    const basis: BudgetSuggestionRow["basis"] = anchorActual > 0 ? "last_month" : "three_month_avg";
    const suggestedAmount = anchorActual > 0 ? Math.round(anchorActual * 100) / 100 : windowAvg;

    return {
      categoryId: r.category_id,
      categoryName: r.category_name,
      parentName: r.parent_name ?? null,
      suggestedAmount,
      basis,
      lastMonthActual: Math.round(anchorActual * 100) / 100,
      threeMonthAvg: windowAvg
    };
  });

  log.info(
    `getBudgetSuggestions: household ${householdId} month=${month} anchor=${anchor} suggestions=${suggestions.length}`
  );

  return { month, dataAsOf: anchor, suggestions };
}

/**
 * Return the budget for `month` combined with actual spend to date.
 * Categories with a budget but zero spend are included (remaining = full budget).
 * Actual spend in unbudgeted categories rolls into `summary.unbudgetedSpend`.
 */
export async function getBudgetWithActuals(
  householdId: string,
  month: string
): Promise<BudgetResult> {
  assertMonth(month);
  const { start, end } = monthBounds(month);

  type BudgetRow = {
    category_id: string;
    amount: string;
    category_name: string;
    parent_name: string | null;
  };

  type ActualRow = {
    category_id: string;
    spent: string;
  };

  const [budgetRows, actualRows] = await Promise.all([
    qAll<BudgetRow>(
      `SELECT bc.category_id, bc.amount,
              c.name AS category_name,
              parent.name AS parent_name
       FROM budget_category bc
       JOIN category c ON c.id = bc.category_id
       LEFT JOIN category parent ON parent.id = c.parent_id
       WHERE bc.household_id = ? AND bc.month = ?
       ORDER BY parent.name NULLS LAST, c.name`,
      householdId,
      month
    ),
    qAll<ActualRow>(
      `SELECT category_id, SUM(amount) AS spent
       FROM transaction_canonical
       WHERE household_id = ?
         AND status = 'posted'
         AND direction = 'debit'
         AND transfer_group_id IS NULL
         AND txn_date >= ? AND txn_date <= ?
         AND category_id IS NOT NULL
       GROUP BY category_id`,
      householdId,
      start,
      end
    )
  ]);

  const exists = budgetRows.length > 0;
  const actualMap = new Map(actualRows.map((r) => [r.category_id, parseFloat(r.spent) || 0]));
  const budgetedCategoryIds = new Set(budgetRows.map((r) => r.category_id));

  const categories: BudgetCategoryRow[] = budgetRows.map((r) => {
    const budgeted = parseFloat(r.amount) || 0;
    const spent = actualMap.get(r.category_id) ?? 0;
    const remaining = Math.round((budgeted - spent) * 100) / 100;
    const percentUsed = budgeted > 0 ? Math.round((spent / budgeted) * 1000) / 10 : 0;
    return {
      categoryId: r.category_id,
      categoryName: r.category_name,
      parentName: r.parent_name ?? null,
      budgeted: Math.round(budgeted * 100) / 100,
      spent: Math.round(spent * 100) / 100,
      remaining,
      percentUsed
    };
  });

  const totalBudgeted = categories.reduce((s, c) => s + c.budgeted, 0);
  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);

  // Spend that falls outside the budgeted categories
  let unbudgetedSpend = 0;
  for (const [catId, spent] of actualMap) {
    if (!budgetedCategoryIds.has(catId)) {
      unbudgetedSpend += spent;
    }
  }

  return {
    month,
    exists,
    summary: {
      totalBudgeted: Math.round(totalBudgeted * 100) / 100,
      totalSpent: Math.round(totalSpent * 100) / 100,
      remaining: Math.round((totalBudgeted - totalSpent) * 100) / 100,
      unbudgetedSpend: Math.round(unbudgetedSpend * 100) / 100
    },
    categories
  };
}

/**
 * Replace the entire budget for `month`.
 * Deletes all existing entries for that month then inserts the provided set.
 * Passing an empty `entries` array effectively clears the month's budget.
 */
export async function saveBudget(
  householdId: string,
  month: string,
  entries: BudgetEntry[]
): Promise<void> {
  assertMonth(month);

  await qBegin(async (tx) => {
    const txExec = async (sqlStr: string, ...params: unknown[]): Promise<void> => {
      const { text, values } = sqlBind(sqlStr, params);
      await tx.unsafe(text, values as never[]);
    };

    await txExec(
      `DELETE FROM budget_category WHERE household_id = ? AND month = ?`,
      householdId,
      month
    );

    for (const entry of entries) {
      await txExec(
        `INSERT INTO budget_category (id, household_id, category_id, month, amount)
         VALUES (?, ?, ?, ?, ?)`,
        randomUUID(),
        householdId,
        entry.categoryId,
        month,
        entry.amount
      );
    }
  });
}

/**
 * Return the list of months that have at least one budget entry for the household,
 * newest first. Used for history navigation in the UI.
 */
export async function listBudgetMonths(householdId: string): Promise<BudgetMonthSummary[]> {
  type Row = { month: string; total_budgeted: string };
  const rows = await qAll<Row>(
    `SELECT month, SUM(amount) AS total_budgeted
     FROM budget_category
     WHERE household_id = ?
     GROUP BY month
     ORDER BY month DESC`,
    householdId
  );
  return rows.map((r) => ({
    month: r.month,
    totalBudgeted: parseFloat(r.total_budgeted) || 0
  }));
}

/**
 * Return a single budget entry for a specific category + month, or null if none exists.
 * Used internally; not directly exposed as an endpoint.
 */
export async function getBudgetEntry(
  householdId: string,
  categoryId: string,
  month: string
): Promise<{ amount: number } | null> {
  const row = await qGet<{ amount: string }>(
    `SELECT amount FROM budget_category
     WHERE household_id = ? AND category_id = ? AND month = ?`,
    householdId,
    categoryId,
    month
  );
  return row ? { amount: parseFloat(row.amount) || 0 } : null;
}
