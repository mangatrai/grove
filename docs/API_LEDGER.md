# API: Ledger (read-only canonical transactions)

> **Progress:** Read + category **PATCH** are 🟡 partial vs full edit/transfer story — **`docs/CHECKPOINT.md`**.

Household-scoped access to `transaction_canonical`: **GET** lists rows (Epic 7); **PATCH** updates **category** only (Epic 5.1).

## `GET /transactions`

**Auth:** Bearer JWT (same as `/imports`).

**Query (optional):**

- `limit` — default `50`, max `200`
- `offset` — default `0`
- `sessionId` — if set (UUID), only transactions whose **`source_ref`** chain maps to **`transaction_raw`** → **`import_file`** in that import session (household must own the session).
- `categoryId` — optional UUID; filters to that category, or — if it is a **parent** — to that parent and all its **child** categories.
- `uncategorizedOnly` — `true` / `false`; when `true`, only rows with **`category_id` IS NULL** (do not combine with `categoryId`).
- `dateFrom`, `dateTo` — `YYYY-MM-DD` inclusive bounds on **`txn_date`**.

**400:** `categoryId` and `uncategorizedOnly` both set.

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
      "createdAt": "…"
    }
  ]
}
```

- **`categoryId` / `categoryName`** — from `LEFT JOIN category` on `transaction_canonical.category_id`. Both `null` when uncategorized.

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
