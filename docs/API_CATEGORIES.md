# API: Categories (Epic 5.1 / 5.3)

> **Progress:** Hierarchy seed (migrations **`0006`**, **`0007`**, **`0008`**), **`0009`** (**`category_rule`** + **`classification_meta`**), household CRUD, **`LedgerCategoryPicker`** (inline create + hierarchical flyout), **`/categories`** and **`/categories/rules`** UIs — see **`docs/CHECKPOINT.md`**, **`docs/CHANGE_HISTORY.md`**. **IA:** **D-014** — keep **Transactions** as primary categorization; **`/categories`** + **`/categories/rules`** stay as secondary taxonomy + rules authoring (**DOC-008**).

Base path: `/categories` and `/categories/rules`  
Auth: `Authorization: Bearer <JWT>`.

Global defaults (`household_id` IS NULL) use a **two-level** tree: top-level parents (e.g. Shopping, Home, Utilities) and leaf rows (`parent_id` set). Households may add **top-level** categories (`parentId: null`) or **subcategories** under any **top-level** parent they can use (global or household). Nesting deeper than parent → leaf is rejected (`MAX_DEPTH`).

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

- **`householdScoped`** — `true` for rows created by the household (may be **PATCH**/**DELETE**); built-in defaults are `false` but **owners and admins** may **PATCH** (rename / reparent) installation default rows; **members** cannot edit built-ins.

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

Rename or reparent a category the household can use.

- **Household-owned** (`householdScoped`): any authenticated member may update (same rules as before: `parentId` must be a top-level parent or `null`, max depth two levels).
- **Built-in** (`household_id` IS NULL): **owner** or **admin** only. Changes apply to **this database** (all households sharing the same SQLite file see the same names). Classification rules still reference **`category_id`** — renaming a category does not change rule rows.

**Body:** `{ "name": "…", "parentId": "uuid-or-null" }` (either field optional)

**200:** `{ "category": { … } }`

**400:** invalid parent / depth / cycle.

**403:** not allowed — e.g. **member** editing a built-in row, or not a category visible to this household.

**404:** unknown id.

**400** with code **`INVALID_REPARENT`:** cannot move a top-level group under another parent while it still has subcategories (remove or reassign children first).

**401:** missing or invalid token.

## `DELETE /categories/:id`

Delete a **household-owned** category with **no** child rows and **no** `transaction_canonical` references.

**204:** success.

**403:** not household-owned, or **built-in** (`code`: **`BUILTIN_READONLY`**) — built-in categories cannot be deleted; rename them instead.

**404:** unknown id.

**409:** `HAS_CHILDREN` or `IN_USE` (reassign transactions or remove subcategories first).

**401:** missing or invalid token.

UI: **`/categories`** (full-screen table + add parent/subcategory + **Edit** for household rows; **Edit** for built-ins when owner/admin); **`/categories/rules`** (household pattern → category rules; link from Categories). **Ledger:** **`LedgerCategoryPicker`** — hierarchical columns + **inline `POST /categories`** for new parent/subcategory.

## Category Rules MVP (`/categories/rules`)

**Household** rules in `category_rule` are evaluated first, then **global** rows in `category_rule_global` (built-in defaults for this installation). Within each group:
1) `priority` ascending  
2) `createdAt` ascending  
3) `id` ascending

Both **household** (`category_rule`) and **global** (`category_rule_global`) rules store **`amountScope`**: `any` | `credit_only` | `debit_only` (signed amount: credits &gt; 0, debits &lt; 0). Omitted values on create default to **`any`**. CSV **`amount_scope`** is persisted for household imports.

**Matching (import and re-apply):** canonical ingest builds a **fingerprint-normalized** description (lowercase, collapsed spaces, **non-alphanumeric characters stripped**, then truncated). For **`contains`** and **`prefix`**, the classifier compares that normalized text to the rule pattern **after the same normalization**, so patterns may include punctuation in storage but still match bank text that loses `:` / `*` / etc. **`regex`** rules are matched against the **fingerprint-normalized** description; authors should assume that normalized form (not raw bank punctuation).

Each rule targets one assignable category (leaf) and supports:
- `matchType`: `contains` | `prefix` | `regex`
- `pattern`: stored lower-case with spaces normalized on write; **`contains`/`prefix`** matching uses fingerprint normalization as above (see **Matching**)
- `amountScope` (household and built-in): `any` | `credit_only` | `debit_only`
- `confidence`: `0..1`
- `enabled`: `true|false`

### `GET /categories/rules`

Returns **`builtinRules`** (global `category_rule_global` rows, each with `origin: "builtin"`, `ruleKey`, `amountScope`, …) and **`rules`** (household `category_rule` rows).

**200:**

```json
{
  "builtinRules": [
    {
      "origin": "builtin",
      "id": "uuid",
      "ruleKey": "groceries_7_walmart",
      "pattern": "walmart",
      "matchType": "contains",
      "categoryId": "uuid",
      "amountScope": "debit_only",
      "confidence": 0.7,
      "priority": 240,
      "enabled": true,
      "createdAt": "timestamp",
      "updatedAt": "timestamp"
    }
  ],
  "rules": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "pattern": "whole foods",
      "matchType": "contains",
      "categoryId": "uuid",
      "amountScope": "any",
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
  "amountScope": "any",
  "confidence": 0.85,
  "priority": 100,
  "enabled": true
}
```

- **`amountScope`** — optional; defaults to `any`. Multi-pattern create (`patterns` body field) applies the same scope to every generated rule.

**201:** `{ "rule": { ... } }`

**400:** invalid payload or validation (`INVALID_PATTERN`, `INVALID_CATEGORY`, `INVALID_CONFIDENCE`, `INVALID_PRIORITY`, `INVALID_AMOUNT_SCOPE`).

### `POST /categories/rules/bulk`

Create many **household** rules in one request. **Best-effort:** each row is validated and inserted independently; the response always includes what succeeded and what failed.

**Body:**

```json
{
  "rules": [
    {
      "pattern": "costco",
      "matchType": "contains",
      "categoryId": "uuid",
      "amountScope": "debit_only",
      "confidence": 0.85,
      "priority": 100,
      "enabled": true
    },
    {
      "pattern": "whole foods",
      "matchType": "contains",
      "categoryPath": "Shopping > Groceries"
    }
  ]
}
```

- Each element needs **`pattern`**, **`matchType`**, and either **`categoryId`** or **`categoryPath`** (non-empty). Optional **`amountScope`** (defaults to `any`).
- **`categoryPath`** — human-readable path: top-level parent name, then `>` or `|` (trimmed segments), then leaf name (e.g. `Home > HOA Fees`). Case-insensitive name matching. Single-segment path resolves a **unique** leaf by name among categories the household can use; ambiguous or unknown names fail that row.
- Omitted **`confidence`** / **`priority`** / **`enabled`** use the same defaults as single-row create (`0.85`, `100`, `true`).

**200:**

```json
{
  "created": [ { "...": "same shape as GET rules[]" } ],
  "errors": [ { "index": 1, "message": "…", "code": "INVALID_PATTERN" } ]
}
```

### `PATCH /categories/rules/:id`

Update rule fields (including enable/disable).

**Body:** any subset of create fields.

**200:** `{ "rule": { ... } }`

**404:** `NOT_FOUND`  
**400:** same validation codes as create

### `DELETE /categories/rules/:id`

Delete a **household** rule permanently (not the same as disabling via **PATCH**).

**204:** empty body on success.

**404:** unknown id or rule not in this household.

### `POST /categories/rules/builtin` (owner / admin)

Create a global built-in rule. Category must be a **default** leaf (`household_id` NULL) without children.

**Body:** `ruleKey` (optional), `pattern`, `matchType`, `categoryId`, `amountScope`, `confidence`, `priority`, `enabled`.

**201:** `{ "rule": { ... } }`  
**403:** member role

### `PATCH /categories/rules/builtin/:id` (owner / admin)

Update a global rule (same fields as create, partial).

### `DELETE /categories/rules/builtin/:id` (owner / admin)

**204:** empty body on success.

**UI:** authenticated **`/categories/rules`** (household rules + built-in rules; owner/admin can edit globals; linked from **`/categories`**). **CSV:** export/import from the same page — columns include `origin`, `id`, `rule_key`, `pattern`, `match_type`, `amount_scope`, `category_id`, `category_path`, `priority`, `confidence`, `enabled` (export is round-trip friendly for `category_path`; import is create-only and ignores exported `id`).

### CSV column notes (rules)

| Column | Notes |
|--------|--------|
| `origin` | `builtin` or `household` — used by the UI to filter rows when importing. |
| `id` | Export only; import does not update existing rules. |
| `rule_key` | Built-in rules only; optional on import (auto from pattern if empty). |
| `amount_scope` | `any` / `credit_only` / `debit_only` — stored for both built-in and household rules; defaults to `any` when omitted on import. |
| `category_path` | e.g. `Shopping > Groceries`; alternative to `category_id`. |
