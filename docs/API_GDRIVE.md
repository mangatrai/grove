# API: Google Drive (BYOC service account)

Household-level **bring-your-own-credentials** link to a single Google Drive folder using a **service account JSON key**. The API never returns the stored key. Upload/backup automation is planned separately (CR-130+).

**Auth:** Bearer JWT on all routes.

## Role matrix

| Route | `owner` | `admin` | `member` |
|-------|---------|---------|----------|
| `GET /gdrive/status` | Yes | Yes | **403** |
| `POST /gdrive/connect` | Yes | **403** | **403** |
| `DELETE /gdrive/disconnect` | Yes | **403** | **403** |

## `GET /gdrive/status`

Returns connection metadata for the authenticated household. The service account JSON is **never** included.

**200 — not configured**

```json
{ "connected": false }
```

**200 — configured**

```json
{
  "connected": true,
  "folderId": "…",
  "folderName": "Household backups",
  "connectedAt": "2026-05-01T12:00:00.000Z",
  "connectedByUserId": "uuid-or-null",
  "lastVerifiedAt": "2026-05-01T12:00:00.000Z",
  "lastError": null
}
```

- **`connectedByUserId`** — Audit field; **`null`** if the connecting user was deleted (`ON DELETE SET NULL` on `household_gdrive_config.connected_by_user_id`).

## `POST /gdrive/connect`

**Owner only.** Body JSON:

```json
{
  "serviceAccountKeyJson": "{ … full service account key file … }",
  "folderId": "Drive folder ID from the URL"
}
```

1. Validates JSON shape (`type`, `project_id`, `private_key`, `client_email`).
2. Calls the Google Drive API (`files.get`) to confirm the folder exists, is a folder, and is accessible to the service account.
3. On success, upserts `household_gdrive_config` for the household (including `last_verified_at`).

**400** — `INVALID_KEY_JSON` (unparseable string), `INVALID_KEY_FORMAT` (wrong shape), or Zod `Invalid payload` with `issues`.

**422** — `DRIVE_CONNECTION_FAILED` when the Drive API check fails (permissions, wrong ID, not a folder, invalid key, etc.).

**429** — Too many connect attempts in a rolling window (disabled when `MODE=TEST`).

## `DELETE /gdrive/disconnect`

**Owner only.** Deletes the household’s `household_gdrive_config` row if present.

**200**

```json
{ "connected": false }
```

Idempotent when already disconnected.

## See also

- OpenAPI: [`openapi/openapi.yaml`](../openapi/openapi.yaml) — `gdrive` tag.
- Route summary: [`API_INDEX.md`](API_INDEX.md).
