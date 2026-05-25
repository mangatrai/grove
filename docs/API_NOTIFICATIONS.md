# API — Notifications

Base path: `/notifications`

All routes require `Authorization: Bearer <jwt>`. All household members (`owner`, `admin`, `member`) can read and manage their own notifications and preferences.

---

## GET /notifications

Returns the authenticated user's notification list: up to 40 unread (newest first) + last 10 read.

**Response 200**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "householdId": "uuid",
      "userId": "uuid",
      "type": "backup_failed",
      "title": "Google Drive backup failed",
      "body": "Backup failed: Permission denied.",
      "actionUrl": "/settings?tab=data",
      "readAt": null,
      "createdAt": "2026-05-25T12:00:00Z"
    }
  ]
}
```

**Notification types**

| type | trigger |
|------|---------|
| `import_complete` | Bank statement import finishes (inserted > 0) |
| `export_ready` | Export job completes |
| `restore_complete` | Household restore finishes |
| `backup_complete` | Google Drive backup succeeds |
| `backup_failed` | Google Drive backup fails |
| `property_valuation_updated` | Monthly auto-valuation scheduler fires |
| `budget_threshold_80` | Category spend reaches 80% of monthly budget |
| `budget_threshold_100` | Category spend reaches or exceeds 100% of budget |
| `large_transaction` | Transaction exceeds `large_txn_threshold_usd` |

---

## GET /notifications/unread-count

Lightweight poll endpoint (60s interval in frontend).

**Response 200**
```json
{ "count": 3 }
```

---

## PATCH /notifications/:id/read

Mark a single notification as read.

**Response 200** `{ "ok": true }`
**Response 404** notification not found or belongs to another user

---

## POST /notifications/read-all

Mark all unread notifications as read for the authenticated user.

**Response 200** `{ "ok": true }`

---

## GET /notifications/preferences

Return the full preference matrix for the authenticated user — one entry per notification type. Missing rows in the database return system defaults.

**Response 200**
```json
{
  "preferences": [
    {
      "userId": "uuid",
      "notificationType": "backup_failed",
      "enabledEmail": true,
      "enabledInapp": true
    }
  ]
}
```

**System defaults**

| type | email | in-app |
|------|-------|--------|
| `export_ready` | ✓ | ✓ |
| `restore_complete` | ✓ | ✓ |
| `backup_complete` | ✗ | ✓ |
| `backup_failed` | ✓ | ✓ |
| `property_valuation_updated` | ✗ | ✓ |
| `budget_threshold_80` | ✗ | ✓ |
| `budget_threshold_100` | ✓ | ✓ |
| `large_transaction` | ✗ | ✓ |

---

## PUT /notifications/preferences

Bulk upsert preferences. Partial updates are supported — send only the types you want to change.

**Request body**
```json
{
  "preferences": [
    { "notificationType": "backup_failed", "enabledEmail": false, "enabledInapp": true }
  ]
}
```

**Response 200** — returns updated full preference matrix (same shape as GET /preferences)

**Response 400** — invalid payload

---

## Notes

- Notifications are auto-deleted after 90 days on server startup.
- Budget threshold notifications are deduped: at most one `budget_threshold_80` and one `budget_threshold_100` per category per calendar month.
- `large_transaction` threshold is configured per-household via `PATCH /household/settings` (`largeTxnThresholdUsd`; null = disabled).
- Broadcast notifications (no specific user, e.g. `backup_failed`, `restore_complete`) insert one row per household member so each user has their own `read_at` state.
