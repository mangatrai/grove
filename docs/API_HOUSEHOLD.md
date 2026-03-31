# API: Household settings (Epic 7.1)

Base path: `/household`  
Auth: `Authorization: Bearer <JWT>` (requires authentication).

## `GET /household/settings`

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

- **`monthlySavingsTargetUsd`** — `null` when unset (safe-to-spend on cash summary).
- **`salaryDepositFinancialAccountId`** — optional FK to a household **`financial_account`** (where salary typically deposits). `null` when unset. Migration **`0017`**.
- **`employers`** — JSON array of employer stubs for payslip / income onboarding (v1: **`parserProfileId`** defaults to IBM payslip; **`parserMapping`** reserved for future ADP vs IBM routing). Empty array when none saved.

## `PATCH /household/settings`

Send **at least one** field. Partial updates are supported.

**Body (any subset):**

```json
{
  "monthlySavingsTargetUsd": 500,
  "salaryDepositFinancialAccountId": "40000000-0000-0000-0000-000000000001",
  "employers": [
    {
      "displayName": "Acme Corp",
      "parserProfileId": "ibm_pay_contributions_pdf",
      "parserMapping": {}
    }
  ]
}
```

- **`monthlySavingsTargetUsd`** — set to `null` to clear.
- **`salaryDepositFinancialAccountId`** — must reference an account in the same household, or `null`.
- **`employers`** — replaces the stored list. Each item may omit **`id`** (server assigns UUID). **`displayName`** required (1–200 chars). **`parserProfileId`** optional (defaults to **`ibm_pay_contributions_pdf`** on persist).

**200:** Same shape as `GET`.

**400** — invalid amount (`INVALID_AMOUNT`), invalid account (`INVALID_ACCOUNT`), invalid employers (`INVALID_EMPLOYERS`).

**401** — missing or invalid token.

**503** — migration **`0010`** and/or **`0017`** not applied (`MIGRATION_REQUIRED`).
