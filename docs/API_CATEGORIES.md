# API: Categories (Epic 5.1)

> **Progress:** Taxonomy + rules + ledger wiring are 🟡 — **`docs/CHECKPOINT.md`**.

Base path: `/categories`  
Auth: `Authorization: Bearer <JWT>`.

Returns **global default** categories (`household_id` IS NULL) plus any **household-specific** rows.

## `GET /categories`

**200:**

```json
{
  "categories": [
    {
      "id": "uuid",
      "name": "Groceries",
      "parentId": null,
      "isDefault": true
    }
  ]
}
```

**401:** missing or invalid token.
