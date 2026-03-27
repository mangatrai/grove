# API: Categories (Epic 5.1 / 5.3)

> **Progress:** Hierarchy seed (migrations **`0006`**, **`0007`**, **`0008`**), **`0009`** (**`category_rule`** + **`classification_meta`**), household CRUD, **`LedgerCategoryPicker`** (inline create + hierarchical flyout), **`/categories`** and **`/categories/rules`** UIs — see **`docs/CHECKPOINT.md`**, **`docs/CHANGE_HISTORY.md`**. Open product question: **D-014** — balance **`/categories`** vs ledger-only flows.

Base path: `/categories` and `/categories/rules`  
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

UI: **`/categories`** (full-screen table + add parent/subcategory); **`/categories/rules`** (household pattern → category rules; link from Categories). **Ledger:** **`LedgerCategoryPicker`** — hierarchical columns + **inline `POST /categories`** for new parent/subcategory.

## Category Rules MVP (`/categories/rules`)

Household-managed classification rules are evaluated in deterministic order before built-in defaults:
1) `priority` ascending  
2) `createdAt` ascending  
3) `id` ascending

Each rule targets one assignable category (leaf) and supports:
- `matchType`: `contains` | `prefix` | `regex`
- `pattern`: normalized lower-case string (regex compiled/validated on write)
- `confidence`: `0..1`
- `enabled`: `true|false`

### `GET /categories/rules`

Returns household-owned rules.

**200:**

```json
{
  "rules": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "pattern": "whole foods",
      "matchType": "contains",
      "categoryId": "uuid",
      "confidence": 0.9,
      "priority": 10,
      "enabled": true,
      "createdAt": "timestamp",
      "updatedAt": "timestamp"
    }
  ]
}
```

### `POST /categories/rules`

Create a rule.

**Body:**

```json
{
  "pattern": "starbucks",
  "matchType": "contains",
  "categoryId": "uuid",
  "confidence": 0.85,
  "priority": 100,
  "enabled": true
}
```

**201:** `{ "rule": { ... } }`

**400:** invalid payload or validation (`INVALID_PATTERN`, `INVALID_CATEGORY`, `INVALID_CONFIDENCE`, `INVALID_PRIORITY`).

### `PATCH /categories/rules/:id`

Update rule fields (including enable/disable).

**Body:** any subset of create fields.

**200:** `{ "rule": { ... } }`

**404:** `NOT_FOUND`  
**400:** same validation codes as create

**UI:** authenticated **`/categories/rules`** (household rules table + add/edit; linked from **`/categories`**).
