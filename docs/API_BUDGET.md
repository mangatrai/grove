# API: Budget (CR-079 / UX-067)

Monthly per-category budgets: set targets, track actual spend, and get pre-populated suggestions from recent transaction history.

Base path: `/budget`
Auth: `Authorization: Bearer <JWT>` (all routes require authentication).

All routes are household-scoped (from JWT).

---

## `GET /budget/suggest?month=YYYY-MM`

Returns pre-populated budget suggestions for the given month, derived from recent categorised debit spend.

**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `month` | Yes | `YYYY-MM` — the month to generate suggestions for |

**Suggestion logic:**

- Finds the most recent calendar month within the past 24 months that has categorised debit activity (the "anchor"). This handles households whose imports lag the current date.
- For each category in the anchor month: `suggestedAmount = anchor month actual` (`basis: "last_month"`).
- For categories with activity in prior months but not the anchor: `suggestedAmount = 6-month average` (`basis: "three_month_avg"`).
- **Excluded:** Transfers, Income, and Investments parent categories (financial-flow, not household spending). Transfer-linked transactions are excluded.
- Results sorted by anchor-month actual descending (heaviest spenders first).

**200:**

```json
{
  "month": "2026-04",
  "dataAsOf": "2026-01",
  "suggestions": [
    {
      "categoryId": "uuid",
      "categoryName": "Dining out",
      "parentId": "uuid",
      "parentName": "Food",
      "suggestedAmount": 320.50,
      "basis": "last_month",
      "lastMonthActual": 320.50,
      "threeMonthAvg": 298.00
    }
  ]
}
```

- **`dataAsOf`** — the YYYY-MM anchor used for suggestions. `null` when no categorised debit data exists in the 24-month window.
- **`suggestions`** — empty array when no data.

**400:** `month` param missing or not `YYYY-MM`.

---

## `GET /budget/months`

Lists all months that have at least one budget entry for the household, newest first. Used for month navigation in the UI.

**200:**

```json
{
  "months": [
    { "month": "2026-04", "totalBudgeted": 3200.00 },
    { "month": "2026-03", "totalBudgeted": 3100.00 }
  ]
}
```

---

## `GET /budget/:month`

Returns the budget for the given month combined with actual spend to date.

**Path param:** `month` — `YYYY-MM`.

**200:**

```json
{
  "month": "2026-04",
  "exists": true,
  "summary": {
    "totalBudgeted": 3200.00,
    "totalSpent": 1850.25,
    "remaining": 1349.75,
    "unbudgetedSpend": 45.00
  },
  "categories": [
    {
      "categoryId": "uuid",
      "categoryName": "Dining out",
      "parentName": "Food",
      "budgeted": 320.00,
      "spent": 210.50,
      "remaining": 109.50,
      "percentUsed": 65.8
    }
  ]
}
```

- **`exists`** — `false` when no budget entries have been saved for the month (UI shows setup form).
- **`summary.unbudgetedSpend`** — debit outflows in categories not covered by any budget entry (neither directly nor via a parent-level entry).
- **`categories`** — one row per budget entry. Entries can be at the **leaf** level (specific sub-category) or at the **parent** level (entire group). For parent-level entries, `parentName` is `null` and `spent` is the sum of all child category actuals.
- **`percentUsed`** — `0` when `budgeted = 0`.

**400:** `:month` not `YYYY-MM`.

When `exists: false`, `summary` totals are all `0` and `categories` is `[]`.

---

## `PUT /budget/:month`

Replaces the entire budget for the month. Deletes all existing entries for that month and inserts the provided set in a single transaction. Passing an empty `entries` array clears the budget.

**Path param:** `month` — `YYYY-MM`.

**Body:**

```json
{
  "entries": [
    { "categoryId": "uuid", "amount": 320.00 },
    { "categoryId": "uuid", "amount": 150.00 }
  ]
}
```

- `categoryId` — must be a valid UUID (global or household category).
- `amount` — non-negative number.
- Empty `entries` array is valid (clears the budget).

**200:** Same shape as `GET /budget/:month` — returns the saved budget with actuals so the UI can transition directly to the progress view.

**400:** Invalid month param or invalid body (e.g. non-UUID categoryId, negative amount).

---

## Parent-level budgeting

Budget entries can target either a **leaf** category (e.g. "Dining out") or a **parent** category (e.g. "Food"). The two modes are mutually exclusive per group to avoid double-counting:

- **Leaf-level entry:** `spent` = actuals for that specific category.
- **Parent-level entry:** `spent` = sum of actuals for all leaf categories under that parent. An unbudgeted check for each leaf skips it if its parent is already budgeted.

The frontend `BudgetPage` uses a ▼ expand / ▲ collapse toggle per group: collapsed = single parent lump-sum input; expanded = individual leaf inputs.

---

## Schema

```sql
budget_category (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id),
  category_id  TEXT NOT NULL REFERENCES category(id),
  month        TEXT NOT NULL,           -- YYYY-MM
  amount       NUMERIC(12,2) NOT NULL,
  UNIQUE (household_id, category_id, month)
)
```

Migration: `0011_budget_category.sql`.
