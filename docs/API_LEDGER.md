# API: Ledger (read-only canonical transactions)

Household-scoped read access to `transaction_canonical` (Epic 7 slice — trust path).

## `GET /transactions`

**Auth:** Bearer JWT (same as `/imports`).

**Query (optional):**

- `limit` — default `50`, max `200`
- `offset` — default `0`

**200:**

```json
{
  "total": 42,
  "limit": 50,
  "offset": 0,
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
