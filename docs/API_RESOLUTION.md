# API: Resolution queue (Epic 4.2 / Epic 6 precursor)

> **Progress:** Queue API + UI are 🟡 partial — see **`docs/CHECKPOINT.md`**.

Base path: `/resolution`  
Auth: `Authorization: Bearer <JWT>` (all routes require authentication).

Items are scoped to the caller’s **household** (`household_id` from the JWT).

## `GET /resolution/summary`

Lightweight counts for dashboards and the Transactions **Needs review** banner.

**200:**

```json
{
  "openByType": { "unknown_category": 2, "duplicate_ambiguity": 1 },
  "totalOpen": 3,
  "openDuplicateAmbiguityNotOnLedger": 1
}
```

- **`openDuplicateAmbiguityNotOnLedger`** — open **`duplicate_ambiguity`** items whose **`target_id`** (raw row) has **no** matching `transaction_canonical.source_ref = 'raw:' || target_id`. These are **near-duplicate** rows (skipped at ingest — no canonical row created). They do **not** appear on **`GET /transactions?needsReview=true`**; access them via **`GET /resolution`**. Note: **exact-duplicate** rows (CR-080) DO have a canonical row (`status = 'duplicate'`) and therefore DO appear on the Needs Review ledger — they are not counted here.

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

**`duplicate_ambiguity`** items come from two paths:
- **Exact duplicate** (CR-080): same fingerprint or FITID as an existing posted row. A canonical row with `status = 'duplicate'` is inserted and linked via `source_ref = 'raw:' || targetId`. Appears in **`GET /transactions?needsReview=true`**. `reasonDetail.kind = 'exact_duplicate'`. Resolving this item promotes the canonical to `status = 'posted'` (fresh fingerprint assigned).
- **Near-duplicate**: same account/date/amount, similar description. **No canonical row inserted**; the `transaction_raw` row is not posted. `reasonDetail.kind = 'near_duplicate'`. Does **not** appear on the Needs Review ledger (see `openDuplicateAmbiguityNotOnLedger` in `/resolution/summary`).

In both cases `targetId` references the **`transaction_raw`** row.

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

**Side effects on resolve:** when `status` is set to `resolved` and the item type is `duplicate_ambiguity`, the backend also promotes any linked `transaction_canonical` with `status = 'duplicate'` to `status = 'posted'` (with a fresh fingerprint). This applies to both `PATCH /resolution/:id` and `POST /resolution/bulk`.

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
