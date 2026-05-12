# API: Ledger (canonical transactions)

Household-scoped access to `transaction_canonical`: **GET** lists rows with optional filters; **PATCH** updates **category** only; **POST** adds a single **posted** manual row (same fingerprint contract as import).

### Role / membership rules (CR-109 Slice 4)

| Role | Ledger write access |
|------|---------------------|
| `owner`, `admin` | Full access — create, update, and delete any transaction in the household. |
| `member` (with linked profile) | May only write/modify/delete transactions where `owner_person_profile_id` matches their profile. Manual entry restricted to accounts they own. Bulk ops skip non-owned rows and return `skippedNotOwned`. May not reassign ownership (`bulk-reassign-owner` is owner/admin only). |
| `member` (no profile) | 403 on all write ops. |

## `GET /transactions`

**Auth:** Bearer JWT (same as `/imports`).

**Query (optional):**

- `limit` — default `50`, max `200`
- `offset` — default `0`
- `sessionId` — if set (UUID), only transactions whose **`source_ref`** chain maps to **`transaction_raw`** → **`import_file`** in that import session (household must own the session).
- `categoryId` — optional UUID; filters to that category, or — if it is a **parent** — to that parent and all its **child** categories (legacy single-value; dashboard deep-links).
- `categoryIds` — optional UUID, repeatable; multi-select filter. When more than one ID is sent, matches any listed category **without** parent/child expansion (the picker sends explicit IDs). Singular `categoryId` and `categoryIds` may be combined; duplicates are ignored.
- `uncategorizedOnly` — `true` / `false`; when `true`, only rows with **`category_id` IS NULL** (do not combine with `categoryId`).
- `needsReview` — `true` / `false`; when `true`, only rows that need attention: **`category_id` IS NULL**, **`status` ≠ `posted`**, or an **open** / **in_review** **`resolution_item`** for this row (**`unknown_category`**, **`transfer_ambiguity`**, **`reconciliation_mismatch`** on canonical id, or **`duplicate_ambiguity`** when **`source_ref = 'raw:' || resolution target_id`**).
- `resolutionType` — optional filter, **only when `needsReview=true`** (otherwise **400**). Repeat the query key or use comma-separated values. Allowed values: **`unknown_category`**, **`duplicate_ambiguity`**, **`transfer_ambiguity`**, **`reconciliation_mismatch`**. Narrows the list to rows that have at least one **open** / **in_review** resolution item of one of the given types, using the **same link rules** as the overall needs-review predicate (canonical `target_id` vs `raw:` + duplicate pattern).
- `search` — optional string; matches rows where **`lower(merchant || memo)`** contains the query as a **substring**, **or** (when migration **`0011`** applied) the row matches **FTS5** **`MATCH`** on **`ledger_search_fts`** (Porter + Unicode61; multi-word queries are **AND**’d token phrases). Either path can match — substring helps when the FTS index is empty or out of sync. Results are ordered by **`txn_date` DESC**, **`created_at` DESC**. Migration **`0014`** rebuilds **`ledger_search_fts`** from **`transaction_canonical`** if you need to resync the index.
- `amountMin`, `amountMax` — optional numbers; filter on signed **`amount`** (inclusive).
- `dateFrom`, `dateTo` — `YYYY-MM-DD` inclusive bounds on **`txn_date`**.
- `accountId` — optional UUID; filter to that financial account (legacy single-value).
- `accountIds` — optional UUID, repeatable; multi-select account filter. Singular `accountId` and `accountIds` may be combined.
- `ownerScope` — optional `household` or `person`.
- `ownerPersonProfileId` — optional UUID when `ownerScope=person` (legacy single-value).
- `ownerPersonProfileIds` — optional UUID, repeatable; multi-select person profile filter when `ownerScope=person`. Singular and array params may be combined.
- `belongsTo` — optional, repeatable; multi-select belongs-to filter. Values are `household` and/or person profile UUIDs. When present, takes precedence over `ownerScope` / `ownerPersonProfileId` / `ownerPersonProfileIds`. Mixed household + person IDs match household-scoped rows **or** rows owned by any listed profile.
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

## `GET /transactions/aggregate`

**Auth:** Bearer JWT (same as **`GET /transactions`**).

**Query:** Same optional filters as **`GET /transactions`** except **`limit`** and **`offset`** are not accepted. Supports the same multi-select params (`categoryIds`, `accountIds`, `ownerPersonProfileIds`) and legacy singular params.

**200:** Headline totals and capped breakdown arrays for the **entire** filtered set (not the current page).

```json
{
  "count": 124,
  "net": -4821.33,
  "inflows": 8200,
  "outflows": 13021.33,
  "avgAbsolute": 105.05,
  "dateFirst": "2025-01-03",
  "dateLast": "2025-12-31",
  "byCategory": [{ "label": "Groceries", "value": 420.5, "categoryId": "uuid" }],
  "byMerchant": [{ "label": "costco", "value": 310 }],
  "byAccount": [{ "label": "Bank of America checking •1001", "value": -120.5, "accountId": "uuid" }],
  "byMonth": [{ "label": "2025-01", "value": 900, "net": -40 }]
}
```

- **`byCategory` / `byMerchant` / `byAccount` / `byMonth`** — each capped at 50 rows server-side (120 months max for **`byMonth`**). Merchant keys are normalized (trim, lowercase, collapsed whitespace).
- **`byAccount.value`** — signed net (credits minus debits) per account.

**400 / 401 / 404:** Same validation and session-not-found rules as **`GET /transactions`**.

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

## `POST /transactions/bulk-category`

Set the category on up to **200** transactions at once.

**Body:** `{ "ids": ["uuid", …], "categoryId": "uuid" }`

**200:** `{ "updated": N, "skipped": N, "skippedNotOwned": N }`

- `skippedNotOwned` — present for members only; IDs that don't belong to the member's profile are silently skipped and counted here.

**400:** invalid body or category not available for this household.

## `POST /transactions/bulk-trash`

Soft-delete (trash) up to **500** transactions. Only `posted` rows are moved to `trashed`; already-trashed rows are skipped.

**Body:** `{ "ids": ["uuid", …] }`

**200:** `{ "trashed": N, "skipped": N, "skippedNotOwned": N }`

## `POST /transactions/bulk-restore`

Restore up to **500** trashed transactions back to `posted`.

**Body:** `{ "ids": ["uuid", …] }`

**200:** `{ "restored": N, "skipped": N, "skippedNotOwned": N }`

## `POST /transactions/bulk-delete`

Hard-delete up to **500** transactions. Rows must be in `trashed` status first; posted rows are skipped.

**Body:** `{ "ids": ["uuid", …] }`

**200:** `{ "deleted": N, "skipped": N, "skippedNotOwned": N }`

**Member restriction (all four bulk ops above):** members without a linked profile receive **403**. Members with a profile only affect rows where `owner_person_profile_id` matches their profile; non-owned IDs are skipped and counted in `skippedNotOwned`.

## `POST /transactions/bulk-reassign-owner`

**Auth:** Bearer JWT. **Role:** `owner` or `admin` only.

Reassign all transactions from one person profile to another within the household. Useful when merging profiles or correcting bulk mis-attribution.

**Body:** `{ "fromPersonProfileId": "uuid", "toPersonProfileId": "uuid" }`

- `from` and `to` must be different.

**200:** `{ "updated": N }`

**400:** invalid body or `from === to`.  
**403:** caller is not owner or admin.
