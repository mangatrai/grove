# API: Ledger (canonical transactions)

Household-scoped access to `transaction_canonical`: **GET** lists rows with optional filters; **PATCH** updates **category** only; **POST** adds a single **posted** manual row (same fingerprint contract as import).

## `GET /transactions`

**Auth:** Bearer JWT (same as `/imports`).

**Query (optional):**

- `limit` — default `50`, max `200`
- `offset` — default `0`
- `sessionId` — if set (UUID), only transactions whose **`source_ref`** chain maps to **`transaction_raw`** → **`import_file`** in that import session (household must own the session).
- `categoryId` — optional UUID; filters to that category, or — if it is a **parent** — to that parent and all its **child** categories.
- `uncategorizedOnly` — `true` / `false`; when `true`, only rows with **`category_id` IS NULL** (do not combine with `categoryId`).
- `needsReview` — `true` / `false`; when `true`, only rows that need attention: **`category_id` IS NULL**, **`status` ≠ `posted`**, or an **open** / **in_review** **`resolution_item`** for this row (**`unknown_category`**, **`transfer_ambiguity`**, **`reconciliation_mismatch`** on canonical id, or **`duplicate_ambiguity`** when **`source_ref = 'raw:' || resolution target_id`**).
- `search` — optional string; case-insensitive substring match on **`merchant`** and **`memo`** concatenated (not ranked full-text search).
- `amountMin`, `amountMax` — optional numbers; filter on signed **`amount`** (inclusive).
- `dateFrom`, `dateTo` — `YYYY-MM-DD` inclusive bounds on **`txn_date`**.
- `accountId` — optional UUID; filter to that financial account.
- `returnTo` — optional relative app URL for context return affordance (frontend-only hint; ignored by backend filtering).
- `fromDashboard` — optional `true`/`false` frontend context hint used for drill-down UX.

**400:** `categoryId` and `uncategorizedOnly` both set, or invalid query shape.

**404:** `sessionId` does not exist for this household.

When `sessionId` is used, the response includes **`sessionId`** so clients can show an import-scoped view.

**200:**

```json
{
  "total": 42,
  "limit": 50,
  "offset": 0,
  "sessionId": "optional-uuid-when-filtering",
  "transactions": [
    {
      "id": "uuid",
      "txnDate": "2026-03-01",
      "amount": -4.5,
      "direction": "debit",
      "merchant": "Coffee",
      "memo": null,
      "status": "posted",
      "accountId": "uuid",
      "institution": "Bank of America",
      "accountType": "checking",
      "accountMask": "1001",
      "categoryId": "uuid-or-null",
      "categoryName": "Groceries",
      "sourceRef": "raw:…",
      "createdAt": "…",
      "reviewReasons": ["Uncategorized", "Open review: category"]
    }
  ]
}
```

- **`categoryId` / `categoryName`** — from `LEFT JOIN category` on `transaction_canonical.category_id`. Both `null` when uncategorized.
- **`reviewReasons`** — present only when **`needsReview=true`**; human-readable strings explaining why the row matches the needs-review predicate (e.g. **Uncategorized**, **Status: …**, **Open review: …**).

## `POST /transactions`

Insert one **posted** canonical row (manual entry). **`user_id`** is taken from the JWT. **`source_ref`** is `manual:<uuid>`; **`classification_meta`** records `{"source":"manual"}`. If **`categoryId`** is omitted or **`null`**, an **`unknown_category`** **`resolution_item`** is created (same attention path as import).

**Body:**

```json
{
  "accountId": "uuid",
  "txnDate": "YYYY-MM-DD",
  "amount": -42.5,
  "merchant": "Optional; default Manual entry",
  "memo": null,
  "categoryId": "uuid-or-null-or-omit"
}
```

- **`amount`** — must be non-zero; sign matches import convention (negative outflow / debit, positive inflow / credit). **`direction`** is derived from the sign.

**201:**

```json
{ "id": "uuid" }
```

**400:** invalid body; account not in household; category not available for household.  
**401:** missing or invalid token.  
**409:** **`DUPLICATE_FINGERPRINT`** — same dedupe fingerprint as an existing row for that household/account/date/amount/description.

## `PATCH /transactions/:id`

Update the **category** for one posted ledger row (household-scoped).

**Body:**

```json
{ "categoryId": "uuid" }
```

or clear the category:

```json
{ "categoryId": null }
```

- `categoryId` must be a category visible to the household (**global default** or **household-specific**).

**200:**

```json
{
  "id": "uuid",
  "categoryId": "uuid",
  "categoryName": "Groceries"
}
```

**400:** invalid body, or category not available for this household.  
**404:** transaction not found for this household.  
**401:** missing or invalid token.

When **`categoryId`** is set to a non-null value, any **`resolution_item`** with **`type = unknown_category`** and **`target_id`** equal to this transaction’s id is marked **`resolved`** (attention path).
