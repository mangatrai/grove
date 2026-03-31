# API: Household settings (Epic 7.1)

Base path: `/household`  
Auth: `Authorization: Bearer <JWT>` (requires authentication).

## `GET /household/settings`

Returns **household-level** savings target plus **person-level** income fields for the signed-in user (salary account + employers live on `person_profile` — see **`docs/API_HOUSEHOLD_PROFILE.md`**).

**200:**

```json
{
  "monthlySavingsTargetUsd": 500,
  "salaryDepositFinancialAccountId": "40000000-0000-0000-0000-000000000001",
  "employers": [
    {
      "id": "…",
      "displayName": "Acme Corp",
      "parserProfileId": "ibm_pay_contributions_pdf",
      "parserMapping": {}
    }
  ]
}
```

- **`monthlySavingsTargetUsd`** — `null` when unset (safe-to-spend on cash summary). Stored on **`household`**. Migration **`0010`**.
- **`salaryDepositFinancialAccountId`** — optional FK to a household **`financial_account`**. Stored on the signed-in user’s **`person_profile`**. Migration **`0020`**.
- **`employers`** — JSON array on the signed-in user’s **`person_profile`**. Empty array when none saved.

## `PATCH /household/settings`

**Owner/admin only** (members receive **403**).

Updates **only** the household savings target. Salary deposit and employers are **not** writable here — use **`PATCH /household/profile`** (see **`docs/API_HOUSEHOLD_PROFILE.md`**).

Send **at least one** field.

**Body:**

```json
{
  "monthlySavingsTargetUsd": 500
}
```

- **`monthlySavingsTargetUsd`** — set to `null` to clear.

**200:** Same shape as `GET`.

**400** — invalid amount (`INVALID_AMOUNT`).

**401** — missing or invalid token.

**403** — insufficient role.

**503** — migration **`0010`** not applied (`MIGRATION_REQUIRED`).
