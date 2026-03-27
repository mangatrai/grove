# API: Cash summary (Epic 7.1)

> **Progress:** KPI + category breakdown + monthly category outflows are 🟡 vs full reporting vision — **`docs/CHECKPOINT.md`**.

Base path: `/reports/cash-summary`  
Auth: `Authorization: Bearer <JWT>` (requires authentication).

Aggregates **posted** `transaction_canonical` rows for the household (optional **account** filter). Amounts use signed `amount`: credits (inflows) are positive sums, debits (outflows) use absolute magnitude for the outflow KPI. Optional **`categoryBreakdown`** adds per-category aggregates and a six-month **outflows-by-category** series (same window as monthly trend).

## `GET /reports/cash-summary`

### Query parameters

| Param | Description |
|-------|-------------|
| `preset` | `month` \| `ytd` \| `rolling_30` \| `rolling_90` (required) |
| `month` | `YYYY-MM` — **required** when `preset=month` |
| `asOf` | `YYYY-MM-DD` — end date for YTD / rolling windows, and month clip for trend; defaults to **today (UTC)** |
| `breakdown` | `true` \| `false` — include **`byAccount`** table for the KPI range (default `false`) |
| `categoryBreakdown` | `true` \| `false` — include **`byCategory`** for the KPI range and **`monthlyOutflowsByCategory`** for the six-month trend window (default `false`). Uses `LEFT JOIN category`; missing category shows as **Uncategorized**. |
| `categoryRollup` | `leaf` \| `parent` — when `categoryBreakdown` is true, aggregate by **leaf** `category_id` or roll up to **parent** group name (default **`parent`**). |
| `accountId` | Optional UUID — restrict KPIs, comparisons, breakdown, category breakdown, and monthly trend to one **financial_account** (must belong to household; otherwise **404**) |

### Date ranges (KPI)

- **month** — full calendar month of `month`.
- **ytd** — `year(asOf)-01-01` through `asOf` inclusive.
- **rolling_30** — `asOf` minus 29 days through `asOf` (30 days inclusive).
- **rolling_90** — 90 days inclusive ending `asOf`.

### Comparison blocks

Every response includes `comparison.previousPeriod` and may include `comparison.yearOverYear`:

- `month` preset: both **Previous month** and **Same month last year**.
- `ytd` preset: **YTD last year** as `previousPeriod`.
- `rolling_30` / `rolling_90`: immediately preceding same-length window as `previousPeriod`.

Each comparison includes:

- comparison range (`start`, `end`)
- baseline household totals for that range
- `delta` values (`inflows`, `outflows`, `net`) as **current KPI period minus comparison period**

### Monthly trend

Returns **6** calendar months ending in the month containing `range.end`, with the last month clipped to `range.end` where applicable. Same account filter as KPIs when `accountId` is set.

### Category breakdown (`categoryBreakdown=true`)

- **`byCategory`** — one row per distinct `category_id` in range: `categoryName`, `inflows`, `outflows` (debit magnitude), `net`, `transactionCount`.
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

- **400** — invalid query (e.g. `preset=month` without `month`).
- **404** — `accountId` not found for household (`code: ACCOUNT_NOT_FOUND`).
- **401** — missing or invalid token.

UI: authenticated **`/`** (home / cash dashboard; legacy **`/dashboard`** redirects to **`/`**).
