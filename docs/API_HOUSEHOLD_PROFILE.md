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
    "relationship": "self",
    "age": 37,
    "dateOfBirth": "1988-04-12",
    "hasDob": true,
    "sex": "female",
    "individualGrossIncomeUsd": 145000,
    "riskTolerance": "moderate",
    "financialGoals": ["Build emergency fund", "Invest for retirement"]
  }
}
```

- **`firstName` / `lastName`** are derived by splitting **`fullName`** on whitespace (first token vs remainder).
- **`age`** is the *effective* age — computed from **`dateOfBirth`** when set, otherwise the manually-entered age column.
- **`dateOfBirth`** is the **decrypted** DOB, returned **only** for the authenticated user's own profile. Member-list/detail responses (**`GET /household/members`**, **`GET/PATCH /household/members/{id}`**) always return **`dateOfBirth: null`** regardless of stored value, so admins cannot read other members' raw DOBs.
- **`hasDob`** is `true` whenever a DOB has been set, and is safe to return for any profile (used by the UI to decide whether to show the date picker or the manual age input).

## `PATCH /household/profile`

Send **at least one** field. Updates the current user’s linked `person_profile` (and **`app_user.email`** when **`email`** is set).

**Body (any subset):**

| Field | Notes |
|--------|--------|
| `firstName`, `lastName` | Optional; combined into `fullName` when provided |
| `fullName` | Alternative to first/last |
| `email` | `null` to clear (unique per `app_user`) |
| `phoneNumber`, `avatarKey` | |
| `age` | Manual age (1–129). Ignored when `dateOfBirth` is set — the row's age column is auto-cleared. |
| `dateOfBirth` | `YYYY-MM-DD` or `null`. Setting it stores an encrypted value and clears manual age (computed age replaces it). `null` clears the encrypted DOB and lets manual age be set again. |
| `sex`, `individualGrossIncomeUsd`, `riskTolerance`, `financialGoals` | Demographic / financial-profile fields. |
| `salaryDepositFinancialAccountId` | Must be a `financial_account` in the same household, or `null` |
| `employers` | Replaces the list; same shape as in **`GET /household/settings`** |

> Date of birth is encrypted at rest using AES-256-GCM with an instance-derived key (SHA-256 of `"household-finance:dob:" + JWT_SECRET`). It is excluded from `.hfb` exports — re-enter it after a restore, since the encryption key on the new instance won't match the source.

**200:** `{ "profile": { … } }`

**400** — invalid payload (`{ "errors": z.issues }`)

**401** — missing or invalid token

**404** — profile could not be resolved

**409** — email conflict (`EMAIL_CONFLICT`)
