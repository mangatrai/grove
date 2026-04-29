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

---

## Member management (`/household/members`)

**Owner/admin only** for all write operations. Members receive **403**.
Validation errors on member IDs and request payloads return **`400 { "errors": z.issues }`**.

### `GET /household/members`

Returns all household members (person profiles + membership metadata).

**200:**
```json
{
  "members": [
    {
      "id": "uuid",
      "fullName": "Alex Doe",
      "firstName": "Alex",
      "lastName": "Doe",
      "email": "alex@example.com",
      "role": "head",
      "relationship": "self"
    }
  ]
}
```

### `POST /household/members`

Creates a new household member (`person_profile` + `household_membership`). Does **not** create a login account.

**Body:** `firstName` (required), `lastName`, `email`, `role` (`head` | `member`), `relationship` (`self` | `spouse` | `child` | `dependent` | `other`).

**201:** `{ "member": { … } }`  
**409** — email already in use (`EMAIL_CONFLICT`).

### `PATCH /household/members/:memberId`

Updates a member's name, email, role, or relationship. At least one field required.

**200:** `{ "member": { … } }`  
**404** — member not found.  
**409** — email already in use.

### `DELETE /household/members/:memberId`

Removes a household member. Deletes both the `household_membership` and `person_profile` rows.

**Constraint:** Cannot remove a member who has a linked login account (`linked_user_id` set). Returns **409** with code `HAS_LOGIN_ACCOUNT`.

**204** — deleted.  
**404** — member not found.  
**409** — member has a login account (`HAS_LOGIN_ACCOUNT`).

### `POST /household/members/:memberId/reset-password`

**Auth:** Bearer JWT. **Role:** `owner` or `admin`.

Generates a new random temporary password for a member's login account, stores it (bcrypt rounds 12), sets `force_password_change = true`, and invalidates all existing JWTs for that member (bumps `token_version`). Returns the plaintext temporary password **once** — it is not stored and cannot be retrieved again.

**200:**

```json
{ "tempPassword": "aB3x-Kp7z-M2wQ" }
```

**404:** member not found for this household.  
**409:** `NO_LOGIN` — member does not have a login account (use `POST /household/members/:memberId/create-login` first).

### `GET /household/members/:memberId/data-count`

Returns assignment counts used by the delete confirmation flow.

**200:** `{ "transactions": number, "payslips": number }`  
**400:** invalid `memberId` (`{ "errors": [...] }`).

### `POST /household/members/:memberId/create-login`

Creates login credentials for an existing member profile.

**201:** login created  
**400:** invalid `memberId` or member missing email (`EMAIL_REQUIRED`)  
**404:** member not found  
**409:** `ALREADY_HAS_LOGIN` or `EMAIL_CONFLICT`
