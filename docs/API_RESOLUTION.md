# API: Resolution queue (Epic 4.2 / Epic 6 precursor)

Base path: `/resolution`  
Auth: `Authorization: Bearer <JWT>` (all routes require authentication).

Items are scoped to the caller’s **household** (`household_id` from the JWT).

## `GET /resolution`

Lists all **`resolution_item`** rows for the household, **newest first**.

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
      "createdAt": "ISO-like timestamp from SQLite"
    }
  ]
}
```

- **reason** — stored text (often JSON from canonical ingest).
- **reasonDetail** — parsed JSON when `reason` is valid JSON; otherwise `null`.

**401:** missing or invalid token.

Near-duplicate rows from canonical ingest use **`type: duplicate_ambiguity`** and **`targetId`** referencing the **`transaction_raw`** row that was not posted.
