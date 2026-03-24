# API: Ledger (read-only canonical transactions)

Household-scoped read access to `transaction_canonical` (Epic 7 slice — trust path).

## `GET /transactions`

**Auth:** Bearer JWT (same as `/imports`).

**Query (optional):**

- `limit` — default `50`, max `200`
- `offset` — default `0`
- `sessionId` — if set (UUID), only transactions whose **`source_ref`** chain maps to **`transaction_raw`** → **`import_file`** in that import session (household must own the session).

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
      "sourceRef": "raw:…",
      "createdAt": "…"
    }
  ]
}
```

**401:** Missing or invalid token.
