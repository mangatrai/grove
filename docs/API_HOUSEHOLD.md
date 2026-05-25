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
- **`largeTxnThresholdUsd`** — `null` when not configured. When set, any imported transaction exceeding this amount triggers a `large_transaction` notification. Migration **`0051`**.

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
- **`largeTxnThresholdUsd`** — set to `null` to disable the large-transaction alert. Must be positive when provided.

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

---

## Account enrichment fields (CR-169)

These columns live on **`financial_account`** (see migration **`0041`**) and appear on **`GET /imports/accounts`** responses (`sub_type`, `memo`, `liquidity`, `linked_account_id`, `property_id`) and in **`GET /reports/balance-sheet`** asset rows (`liquidity` only on the balance-sheet DTO).

| Field | Meaning |
|--------|---------|
| **`sub_type`** | Subtype key from the account type hierarchy (e.g. `mortgage_primary` under `loan`). |
| **`memo`** | Free-text note; surfaced to AI insights context. |
| **`liquidity`** | `liquid` \| `semi_liquid` \| `restricted` — auto-set by `defaultLiquidity()` from type+subtype at save unless the user overrides (nullable for liability types). |
| **`linked_account_id`** | Self-referential UUID FK to another **`financial_account`** (future HELOC ↔ mortgage pairing, **D-5**). Read-only from the API today; not writable on **`POST/PATCH /imports/accounts`**. |
| **`property_id`** | UUID FK to **`property`** on mortgage/loan accounts. Set only via **`POST /household/properties`** with **`accountId`** — not writable on account upsert. |

**`POST/PATCH /imports/accounts`** writable enrichment: camelCase **`subType`**, **`memo`**, **`liquidity`** (plus existing account fields). **`property_id`** and **`linked_account_id`** appear on **`GET /imports/accounts`** as read-only columns when present.

---

## Property routes

All routes require **`Authorization: Bearer <JWT>`**. Responses use camelCase for JSON property names.

### `GET /household/properties`

Returns every **`property`** row for the caller’s household, including **`latestValueUsd`** / **`latestValueAsOf`** from the most recent snapshot (any date).

**200:**

```json
{
  "properties": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "addressLine1": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "zip": "78701",
      "country": "US",
      "propertyUse": "primary",
      "apiProvider": null,
      "apiPropertyId": null,
      "latestValueUsd": 450000,
      "latestValueAsOf": "2026-01-01",
      "createdAt": "2026-05-10T12:00:00.000Z",
      "updatedAt": "2026-05-10T12:00:00.000Z"
    }
  ]
}
```

### `POST /household/properties`

**Owner/admin only.** Creates a **`property`** and optionally links it to an existing mortgage **`financial_account`** when **`accountId`** is supplied (sets that account’s **`property_id`**).

**Body (all fields optional):** `addressLine1`, `city`, `state`, `zip`, `propertyUse` (`primary` \| `rental` \| `vacation`), `accountId` (UUID of mortgage account), `initialValueUsd` (≥ 0), `initialValueAsOf` (`YYYY-MM-DD`, used with initial value).

**201:** `{ "id": "<new property uuid>" }`

**400** — Zod validation (`{ errors: [...] }`).

**404** — `accountId` not found for household (`ACCOUNT_NOT_FOUND`).

### `GET /household/properties/:propertyId`

**200:** `{ "property": { ...PropertyRecord } }`

**404** — property not in household.

### `PATCH /household/properties/:propertyId`

**Owner/admin only.** Updates address / use fields. **Body:** at least one of `addressLine1`, `city`, `state`, `zip`, `propertyUse`.

**200:** `{ "updated": true }`

**400** / **404** as usual.

### `GET /household/properties/:propertyId/values`

Lists all **`property_value_snapshot`** rows for the property, **ascending** by **`asOfDate`**.

**200:**

```json
{
  "snapshots": [
    {
      "id": "uuid",
      "propertyId": "uuid",
      "asOfDate": "2026-01-01",
      "marketValueUsd": 450000,
      "source": "manual",
      "apiProvider": null,
      "createdAt": "2026-05-10T12:00:00.000Z"
    }
  ]
}
```

**404** — property not found.

### `POST /household/properties/:propertyId/values`

**Owner/admin only.** Creates or **upserts** (same calendar **`asOfDate`**) a market value snapshot.

**Body:** `marketValueUsd` (number, ≥ 0), `asOfDate` (`YYYY-MM-DD`), optional `source` (`manual` \| `api`, default `manual`).

**201:** `{ "id": "<snapshot uuid>" }`

**400** — validation or business rule (`INVALID_VALUE`).

**404** — property not found.

### `DELETE /household/properties/:propertyId`

**Owner/admin only.** Permanently removes a property record and all its value snapshots. If any `financial_account` has `property_id` pointing to this property, the FK (`ON DELETE SET NULL`) clears those references automatically; the number of unlinked accounts is reported in the response.

**200:** `{ "unlinkedAccounts": N }` — N is the count of mortgage/loan accounts whose `property_id` was cleared (0 when no accounts were linked).

**400** — `propertyId` is not a valid UUID.

**401** — missing or invalid token.

**403** — caller is not owner or admin.

**404** — property not found in household (`NOT_FOUND`).
