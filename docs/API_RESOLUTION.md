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

Current UI at `/resolution` uses this endpoint for per-row actions: **In review**, **Resolve**, **Reopen**.

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
