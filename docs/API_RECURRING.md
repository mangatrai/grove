# API: Recurring Merchant Overrides

Routes in this document are mounted at `/recurring-overrides` and require a valid bearer token.

## GET `/recurring-overrides`

List all recurring merchant overrides for the signed-in user's household.

Response `200`:

```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "merchantKey": "netflix",
      "displayName": "Netflix",
      "verdict": "confirmed",
      "amountAnchor": 18.99,
      "amountTolerancePct": 15,
      "taggedByUserId": "uuid",
      "createdAt": "2026-04-28T00:00:00.000Z",
      "updatedAt": "2026-04-28T00:00:00.000Z"
    }
  ]
}
```

Error codes:
- `401` when Authorization header is missing or invalid.

---

## POST `/recurring-overrides`

Create or update one override keyed by `(household_id, merchant_key)`.

Request body (Zod schema):

```ts
z.object({
  merchantKey: z.string().min(1),
  displayName: z.string().optional(),
  verdict: z.enum(["confirmed", "dismissed"]),
  amountAnchor: z.number().finite().optional(),
  amountTolerancePct: z.number().finite().optional().default(15)
});
```

Response `200`:

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "householdId": "uuid",
    "merchantKey": "netflix",
    "displayName": "Netflix",
    "verdict": "confirmed",
    "amountAnchor": 18.99,
    "amountTolerancePct": 15,
    "taggedByUserId": "uuid",
    "createdAt": "2026-04-28T00:00:00.000Z",
    "updatedAt": "2026-04-28T00:00:00.000Z"
  }
}
```

Error codes:
- `400` invalid request body (`{ errors: z.issues }`).
- `401` unauthorized.

---

## DELETE `/recurring-overrides/:id`

Delete one override by id, scoped to the signed-in household.

Response `200`:

```json
{ "ok": true }
```

Response `404`:

```json
{ "ok": false, "code": "NOT_FOUND" }
```

Error codes:
- `401` unauthorized.
