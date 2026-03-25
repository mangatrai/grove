# API: Categories (Epic 5.1 / 5.3)

> **Progress:** Hierarchy seed (migrations **`0006`**, **`0007`**), household CRUD, ledger **optgroup** picker, and **`/categories`** management UI — see **`docs/CHECKPOINT.md`**. **Planned:** richer taxonomy (transfers, taxes, income subtypes) and **ledger-first** category UX (inline add + hierarchical flyout) may reduce reliance on this page — **`docs/MVP_BACKLOG.md`** Epic 5, **`docs/DECISIONS_LOG.md`** D-014.

Base path: `/categories`  
Auth: `Authorization: Bearer <JWT>`.

Global defaults (`household_id` IS NULL) use a **two-level** tree: top-level parents (e.g. Shopping, Home & utilities) and leaf rows (`parent_id` set). Households may add **top-level** categories (`parentId: null`) or **subcategories** under any **top-level** parent they can use (global or household). Nesting deeper than parent → leaf is rejected (`MAX_DEPTH`).

## `GET /categories`

**200:**

```json
{
  "categories": [
    {
      "id": "uuid",
      "name": "Groceries",
      "parentId": "uuid-of-shopping-or-null",
      "isDefault": true,
      "householdScoped": false
    }
  ]
}
```

- **`householdScoped`** — `true` for rows created by the household (may be **PATCH**/**DELETE**); defaults are `false`.

**401:** missing or invalid token.

## `POST /categories`

Create a **household-owned** category.

**Body:**

```json
{ "name": "My subcategory", "parentId": "uuid-of-top-level-parent-or-null" }
```

- **`parentId`** — omit or `null` for a new top-level group; otherwise must reference a category with **`parent_id` IS NULL** (a top-level parent).

**201:** `{ "category": { ...same shape as GET... } }`

**400:** `INVALID_NAME`, `INVALID_PARENT`, `MAX_DEPTH`.

**401:** missing or invalid token.

## `PATCH /categories/:id`

Rename or reparent a **household-owned** row only.

**Body:** `{ "name": "…", "parentId": "uuid-or-null" }` (either field optional)

**200:** `{ "category": { … } }`

**400:** invalid parent / depth / cycle.

**403:** not a household-owned row (defaults are immutable).

**404:** unknown id.

## `DELETE /categories/:id`

Delete a **household-owned** category with **no** child rows and **no** `transaction_canonical` references.

**204:** success.

**403:** not household-owned.

**404:** unknown id.

**409:** `HAS_CHILDREN` or `IN_USE`.

**401:** missing or invalid token.

UI: **`/categories`** (manage — full-screen table + add parent/subcategory), ledger category picker (grouped **`optgroup`** by parent; not a hover menu). Inline “add category” from the ledger is **not** implemented yet (backlog).
