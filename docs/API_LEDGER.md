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
- `resolutionType` — optional filter, **only when `needsReview=true`** (otherwise **400**). Repeat the query key or use comma-separated values. Allowed values: **`unknown_category`**, **`duplicate_ambiguity`**, **`transfer_ambiguity`**, **`reconciliation_mismatch`**. Narrows the list to rows that have at least one **open** / **in_review** resolution item of one of the given types, using the **same link rules** as the overall needs-review predicate (canonical `target_id` vs `raw:` + duplicate pattern).
- `search` — optional string; matches rows where **`lower(merchant || memo)`** contains the query as a **substring**, **or** (when migration **`0011`** applied) the row matches **FTS5** **`MATCH`** on **`ledger_search_fts`** (Porter + Unicode61; multi-word queries are **AND**’d token phrases). Either path can match — substring helps when the FTS index is empty or out of sync. Results are ordered by **`txn_date` DESC**, **`created_at` DESC**. Migration **`0014`** rebuilds **`ledger_search_fts`** from **`transaction_canonical`** if you need to resync the index.
- `amountMin`, `amountMax` — optional numbers; filter on signed **`amount`** (inclusive).
- `dateFrom`, `dateTo` — `YYYY-MM-DD` inclusive bounds on **`txn_date`**.
- `accountId` — optional UUID; filter to that financial account.
- `returnTo` — optional relative app URL for context return affordance (frontend-only hint; ignored by backend filtering).
- `fromDashboard` — optional `true`/`false` frontend context hint used for drill-down UX.

**400:** `categoryId` and `uncategorizedOnly` both set; **`resolutionType` without `needsReview=true`**; unknown **`resolutionType`** value; or invalid query shape.

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
      "classificationMeta": {
        "source": "household",
        "ruleId": "uuid-or-null",
        "confidence": 0.85,
        "reason": "Matched contains household rule pattern \"…\"."
      },
      "sourceRef": "raw:…",
      "createdAt": "…",
      "reviewReasons": ["Uncategorized", "Open review: category"],
      "openReviewItems": [{ "id": "resolution-item-uuid", "type": "unknown_category", "status": "open" }],
      "importSessionId": "import-session-uuid-or-null"
    }
  ]
}
```

- **`categoryId` / `categoryName`** — from `LEFT JOIN category` on `transaction_canonical.category_id`. Both `null` when uncategorized.
- **`classificationMeta`** — parsed from `transaction_canonical.classification_meta` JSON set at **canonicalize** (import) or **manual** entry: **`source`** (`household` \| `builtin` \| `none` \| `manual`), **`ruleId`** (when a rule matched), **`confidence`** [0,1], **`reason`** (human-readable). **`null`** when absent or unparseable.
- **`reviewReasons`** — present only when **`needsReview=true`**; human-readable strings explaining why the row matches the needs-review predicate. Possible values: **`Uncategorized`** (category_id IS NULL), **`Exact duplicate`** (status = 'duplicate', from CR-080), **`Status: <value>`** (other non-posted statuses), **`Open review: near-duplicate`** (open duplicate_ambiguity item on a posted row), **`Open review: reconciliation`** (open reconciliation_mismatch item).
- **`openReviewItems`** — present only when **`needsReview=true`**; open / in_review resolution rows tied to this transaction (**`id`**, **`type`**, **`status`**: **`open`** or **`in_review`**), for **`POST /resolution/bulk`**, **`POST /resolution/bulk-apply-category`**, and **`PATCH /resolution/:id`** (same link rules as **`GET /resolution`**).
- **`importSessionId`** — present only when **`needsReview=true`**; import session id when the row’s **`source_ref`** links to **`transaction_raw`** → **`import_file`**, otherwise **`null`** (manual rows, etc.).

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

## `GET /transactions/:id/open-review`

**Auth:** Bearer JWT.

Returns **open** and **in_review** **`resolution_item`** rows linked to this canonical transaction, with the same **`context`** shape as **`GET /resolution`** (file name, session id, raw preview from staged payload when available, classification explainability when present). Used by **Transactions → Needs review** to show queue-style context without listing the full household queue.

**200:**

```json
{
  "items": [
    {
      "id": "resolution-item-uuid",
      "type": "unknown_category",
      "targetId": "canonical-txn-uuid",
      "reason": "{…}",
      "reasonDetail": { "kind": "unknown_category", "message": "…" },
      "status": "open",
      "createdAt": "…",
      "context": {
        "sessionId": "…",
        "fileId": "…",
        "fileName": "stmt.csv",
        "raw": {
          "txnDate": "2026-02-01",
          "amount": -12.34,
          "description": "…",
          "referenceId": null
        },
        "classification": { "source": "db", "ruleId": null, "confidence": 0.9, "reason": "…" }
      }
    }
  ]
}
```

**400:** `:id` is not a valid UUID.  
**404:** transaction not found for this household.  
**401:** missing or invalid token.
