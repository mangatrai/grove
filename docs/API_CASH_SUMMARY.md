# API: Cash summary (Epic 7.1)

> **Progress:** Shipped — KPI + category breakdown + spending power (safe-to-spend, savings rate) + monthly category outflows. Set **`household.monthly_savings_target_usd`** via **`GET/PATCH /household/settings`** (see **`docs/API_HOUSEHOLD.md`**).

> **Client-side cache:** The frontend caches this endpoint's response in `localStorage` under cache scope `dashboard`. The cache is invalidated automatically when any ledger mutation or import canonicalize succeeds (see `docs/CACHING.md`). If you add a new write endpoint whose result is reflected in cash-summary output, add it to `CACHE_INVALIDATION_MAP` in `frontend/src/cache.ts`.

Base path: `/reports/cash-summary`  
Auth: `Authorization: Bearer <JWT>` (requires authentication).

Aggregates **posted** `transaction_canonical` rows for the household (optional **account** filter). Amounts use signed `amount`: credits (inflows) are positive sums, debits (outflows) use absolute magnitude for the outflow KPI. Optional **`categoryBreakdown`** adds per-category aggregates and a six-month **outflows-by-category** series (same window as monthly trend).

## `GET /reports/cash-summary`

### Query parameters

| Param | Description |
|-------|-------------|
| `preset` | `month` \| `ytd` \| `rolling_30` \| `rolling_90` — **required** unless both **`dateFrom`** and **`dateTo`** are set |
| `month` | `YYYY-MM` — **required** when `preset=month` (not used for custom range) |
| `asOf` | `YYYY-MM-DD` — end date for YTD / rolling windows, and month clip for trend; defaults to **today (UTC)** (ignored when using **`dateFrom`** / **`dateTo`**) |
| `dateFrom` | `YYYY-MM-DD` — inclusive start of a **custom** KPI range; must appear together with **`dateTo`** |
| `dateTo` | `YYYY-MM-DD` — inclusive end of a **custom** KPI range; must appear together with **`dateFrom`** |
| `breakdown` | `true` \| `false` — include **`byAccount`** table for the KPI range (default `false`) |
| `categoryBreakdown` | `true` \| `false` — include **`byCategory`** for the KPI range and **`monthlyOutflowsByCategory`** for the six-month trend window (default `false`). Uses `LEFT JOIN category`; missing category shows as **Uncategorized**. |
| `categoryRollup` | `leaf` \| `parent` — when `categoryBreakdown` is true, aggregate by **leaf** `category_id` or roll up to **parent** group name (default **`parent`**). |
| `accountId` | Optional UUID — restrict KPIs, comparisons, breakdown, category breakdown, and monthly trend to one **financial_account** (must belong to household; otherwise **404**) |

### Date ranges (KPI)

- **month** — full calendar month of `month`.
- **ytd** — `year(asOf)-01-01` through `asOf` inclusive.
- **rolling_30** — `asOf` minus 29 days through `asOf` (30 days inclusive).
- **rolling_90** — 90 days inclusive ending `asOf`.
- **Custom** — when **`dateFrom`** and **`dateTo`** are both valid calendar dates: that inclusive window. Maximum span is **`CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS`** from the server environment (default **1096** ≈ three years); `dateFrom` must be ≤ `dateTo`. Response `range.preset` is **`custom`**, **`maxCustomRangeDays`** echoes the limit, and `asOf` equals **`dateTo`** (trend windows still anchor on `range.end`). If both dates are sent, they define the range even if `preset` is also present.

When **`categoryBreakdown=true`**, **`byCategory[]`** also includes per-category prior-window totals/deltas using the same **`previousPeriod`** rules as `comparison.previousPeriod`:
- `previousInflows`, `previousOutflows`, `previousNet`
- `deltaInflows`, `deltaOutflows`, `deltaNet`

### Comparison blocks

Every response includes `comparison.previousPeriod` and may include `comparison.yearOverYear`:

- `month` preset: both **Previous month** and **Same month last year**.
- `ytd` preset: **YTD last year** as `previousPeriod`.
- `rolling_30` / `rolling_90` / **`custom`**: immediately preceding same-length window as `previousPeriod` (no `yearOverYear`).

Each comparison includes:

- comparison range (`start`, `end`)
- baseline household totals for that range
- `delta` values (`inflows`, `outflows`, `net`) as **current KPI period minus comparison period**

### `spendingPower` (always present)

Derived from the same **`household` KPI row** and optional **`monthly_savings_target_usd`** on the **`household`** row:

| Field | Meaning |
|-------|---------|
| `monthlySavingsTargetUsd` | Household setting, or `null` if unset |
| `savingsTargetApplied` | Target scaled to this report window: `monthly × (days in range ÷ 30.437)` |
| `safeToSpend` | `household.net − savingsTargetApplied` when a monthly target is set; else `null` |
| `savingsRate` | `(inflows − outflows) / inflows` when `inflows > 0`; else `null` |
| `explanation` | Short copy for UI (formula summary) |

### Monthly trend

Returns **6** calendar months ending in the month containing `range.end`, with the last month clipped to `range.end` where applicable. Same account filter as KPIs when `accountId` is set.

### Category breakdown (`categoryBreakdown=true`)

- **`byCategory`** — one row per distinct `category_id` in range: `categoryName`, `inflows`, `outflows` (debit magnitude), `net`, `transactionCount`, plus per-category comparison fields: `previousInflows`, `previousOutflows`, `previousNet`, `deltaInflows`, `deltaOutflows`, `deltaNet`.
- **`monthlyOutflowsByCategory`** — for each of the same **6** months as `monthlyTrend`, `segments[]` of `{ categoryName, categoryId, outflows }` for categories with debit activity that month (omits categories with only credits).

### Response `200`

```json
{
  "range": {
    "start": "2025-03-01",
    "end": "2025-03-31",
    "preset": "month",
    "label": "March 2025"
  },
  "asOf": "2025-03-24",
  "household": {
    "inflows": 5000,
    "outflows": 3200.5,
    "net": 1799.5,
    "transactionCount": 42
  },
  "comparison": {
    "previousPeriod": {
      "label": "Previous month",
      "range": { "start": "2025-02-01", "end": "2025-02-28" },
      "household": {
        "inflows": 4800,
        "outflows": 3000,
        "net": 1800,
        "transactionCount": 40
      },
      "delta": { "inflows": 200, "outflows": 200.5, "net": -0.5 }
    },
    "yearOverYear": {
      "label": "Same month last year",
      "range": { "start": "2024-03-01", "end": "2024-03-31" },
      "household": {
        "inflows": 4600,
        "outflows": 2900,
        "net": 1700,
        "transactionCount": 39
      },
      "delta": { "inflows": 400, "outflows": 300.5, "net": 99.5 }
    }
  },
  "spendingPower": {
    "monthlySavingsTargetUsd": 500,
    "savingsTargetApplied": 511.23,
    "safeToSpend": 1288.27,
    "savingsRate": 0.3599,
    "explanation": "Safe-to-spend = net cashflow for this period minus your monthly savings commitment…"
  },
  "byAccount": [
    {
      "accountId": "uuid",
      "institution": "Bank of America",
      "accountType": "checking",
      "accountMask": "1001",
      "inflows": 5000,
      "outflows": 3200.5,
      "net": 1799.5,
      "transactionCount": 42
    }
  ],
  "byCategory": [
    {
      "categoryId": "uuid-or-null",
      "categoryName": "Groceries",
      "inflows": 0,
      "outflows": 400,
      "net": -400,
      "previousInflows": 0,
      "previousOutflows": 0,
      "previousNet": 0,
      "deltaInflows": 0,
      "deltaOutflows": 400,
      "deltaNet": -400,
      "transactionCount": 5
    }
  ],
  "monthlyTrend": [
    { "month": "2024-10", "inflows": 0, "outflows": 0, "net": 0 },
    { "month": "2025-03", "inflows": 5000, "outflows": 1000, "net": 4000 }
  ],
  "monthlyOutflowsByCategory": [
    {
      "month": "2025-03",
      "segments": [
        { "categoryId": "uuid-or-null", "categoryName": "Groceries", "outflows": 400 }
      ]
    }
  ]
}
```

- **`byAccount`** is `null` when `breakdown` is not `true`. When `accountId` is set, breakdown lists only that account.
- **`byCategory`** and **`monthlyOutflowsByCategory`** are `null` when `categoryBreakdown` is not `true`.

### Errors

- **400** — invalid query (e.g. `preset=month` without `month`, only one of `dateFrom`/`dateTo`, missing `preset` when no custom dates). Body `message` may be: `INVALID_DATE_FORMAT`, `INVALID_DATE_ORDER`, `CUSTOM_RANGE_TOO_LONG`, `dateFrom and dateTo must both be provided…`, etc.
- **404** — `accountId` not found for household (`code: ACCOUNT_NOT_FOUND`).
- **401** — missing or invalid token.

UI: authenticated **`/`** (home / cash dashboard; legacy **`/dashboard`** redirects to **`/`**). Period control includes **Custom range** (from/to + Apply) using `dateFrom` / `dateTo`.

### CHANGE_HISTORY

- **CR-015:** `GET /reports/cash-summary` — optional inclusive **`dateFrom`** / **`dateTo`** (`YYYY-MM-DD`) for a custom window (max 366 days); **`preset`** optional when both are set; response `range.preset` may be **`custom`**; prior-period comparison matches rolling windows (same-length previous window).
