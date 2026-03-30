# API: Resolution queue (Epic 4.2 / Epic 6 precursor)

> **Progress:** Queue API + UI are 🟡 partial — see **`docs/CHECKPOINT.md`**.

Base path: `/resolution`  
Auth: `Authorization: Bearer <JWT>` (all routes require authentication).

Items are scoped to the caller’s **household** (`household_id` from the JWT).

## `GET /resolution`

Lists all **`resolution_item`** rows for the household, **newest first**.

Optional query:

- `status=all|open|in_review|resolved` (default: `all`)

**200:**

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "duplicate_ambiguity",
      "targetId": "uuid",
      "reason": "raw JSON string from server",
      "reasonDetail": { },
      "status": "open",
      "createdAt": "ISO-like timestamp from SQLite",
      "context": {
        "sessionId": "import-session-uuid-or-null",
        "fileId": "import-file-uuid-or-null",
        "fileName": "statement.csv or null",
        "raw": {
          "txnDate": "2026-04-01",
          "amount": -5,
          "description": "STARBUCKS COFFEE STORE",
          "referenceId": "optional-ref"
        },
        "classification": {
          "source": "db|default|none",
          "ruleId": "rule-id-or-null",
          "confidence": 0.85,
          "reason": "why category was assigned or unknown"
        }
      }
    }
  ],
  "status": "open"
}
```

- **reason** — stored text (often JSON from canonical ingest).
- **reasonDetail** — parsed JSON when `reason` is valid JSON; otherwise `null`.
- **context** — best-effort triage context from `targetId`/`reasonDetail.rawId` -> `transaction_raw` -> `import_file`.
- **context.classification** — explainability metadata from canonical classification when available.

**401:** missing or invalid token.

Near-duplicate rows from canonical ingest use **`type: duplicate_ambiguity`** and **`targetId`** referencing the **`transaction_raw`** row that was not posted.

## `PATCH /resolution/:id`

Update one resolution item status for the caller's household.

**Body:**

```json
{ "status": "in_review" }
```

Allowed statuses: `open` | `in_review` | `resolved`.

Transition rules:
- `open` -> `in_review` or `resolved`
- `in_review` -> `open` or `resolved`
- `resolved` -> `open` (reopen) or `resolved` (idempotent)
- any `from -> same from` is accepted (idempotent)

**200:** `{ "id": "uuid", "status": "resolved" }`

**400:** invalid payload.
**404:** item not found for this household.
**409:** invalid transition (`code: "INVALID_TRANSITION"` with `from`/`to`).

**Transactions → Needs review** (expand row context) uses this endpoint per open item for **In review**, **Resolve**, **Reopen**. The app route **`/resolution`** redirects to **`/transactions?needsReview=true`**; **`GET /resolution`** remains for API clients and tests.

## `POST /resolution/bulk`

Apply one target status to many items (same transition rules as `PATCH /resolution/:id`). **Best-effort:** updates every row that exists for the household and allows the transition; others are listed in **`errors`** without failing the whole request.

**Body:**

```json
{
  "ids": ["uuid", "uuid"],
  "status": "resolved"
}
```

- `ids` — non-empty array of UUIDs (duplicates are de-duplicated; max 200 per request).

**200:**

```json
{
  "updated": [{ "id": "uuid", "status": "resolved" }],
  "errors": [
    {
      "id": "uuid",
      "code": "NOT_FOUND",
      "message": "Resolution item not found"
    }
  ]
}
```

**400:** invalid body (e.g. empty `ids`).

**401:** missing or invalid token.

The Review queue UI uses this for **bulk In review / Resolve / Reopen** on selected rows.

## `POST /resolution/bulk-apply-category`

For **`unknown_category`** items only: sets **`category_id`** on the linked **`transaction_canonical`** row ( **`target_id`** ) and marks the resolution item **`resolved`**.

**Body:**

```json
{
  "ids": ["uuid", "uuid"],
  "categoryId": "uuid"
}
```

- `ids` — de-duplicated; max **200**.
- `categoryId` — must be usable by the household (`GET /categories`).

**200:**

```json
{
  "updated": [{ "id": "resolution-item-uuid" }],
  "errors": [{ "id": "uuid", "code": "WRONG_TYPE", "message": "…" }]
}
```

**400:** invalid body or category not available (`INVALID_CATEGORY`).

**401:** missing or invalid token.

Canonical ingest creates **`unknown_category`** rows when no default keyword rule assigns a category; **`context`** is filled from the posted transaction (and import file when `source_ref` links to `transaction_raw`).
