# API: Household settings (Epic 7.1)

Base path: `/household`  
Auth: `Authorization: Bearer <JWT>` (requires authentication).

## `GET /household/settings`

**200:**

```json
{
  "monthlySavingsTargetUsd": 500
}
```

`monthlySavingsTargetUsd` is `null` when unset (safe-to-spend on cash summary stays hidden until set).

## `PATCH /household/settings`

Update the household’s optional **monthly savings commitment** (USD), used by **`GET /reports/cash-summary`** → **`spendingPower`** (`docs/API_CASH_SUMMARY.md`).

**Body:**

```json
{ "monthlySavingsTargetUsd": 500 }
```

Set to `null` to clear.

**200:** `{ "monthlySavingsTargetUsd": 500 }` (or `null`)

**400** — invalid number (`INVALID_AMOUNT`).

**401** — missing or invalid token.
