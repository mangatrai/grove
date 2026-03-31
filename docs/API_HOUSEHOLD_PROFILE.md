# API: Household profile (Epic 12)

Base path: `/household`  
Auth: `Authorization: Bearer <JWT>` (requires authentication).

Salary deposit and employer list are stored on the **signed-in user’s** `person_profile` (not on the `household` row). Use **`GET/PATCH /household/profile`** to read and update them.

## `GET /household/profile`

**200:**

```json
{
  "profile": {
    "id": "…",
    "householdId": "…",
    "linkedUserId": "…",
    "firstName": "Jane",
    "lastName": "Doe",
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "phoneNumber": "+1 …",
    "avatarKey": "person",
    "role": "head",
    "relationship": "self"
  }
}
```

- **`firstName` / `lastName`** are derived by splitting **`fullName`** on whitespace (first token vs remainder).

## `PATCH /household/profile`

Send **at least one** field. Updates the current user’s linked `person_profile` (and **`app_user.email`** when **`email`** is set).

**Body (any subset):**

| Field | Notes |
|--------|--------|
| `firstName`, `lastName` | Optional; combined into `fullName` when provided |
| `fullName` | Alternative to first/last |
| `email` | `null` to clear (unique per `app_user`) |
| `phoneNumber`, `avatarKey` | |
| `salaryDepositFinancialAccountId` | Must be a `financial_account` in the same household, or `null` |
| `employers` | Replaces the list; same shape as in **`GET /household/settings`** |

**200:** `{ "profile": { … } }`

**400** — invalid payload

**401** — missing or invalid token

**404** — profile could not be resolved

**409** — email conflict (`EMAIL_CONFLICT`)
