# API: Google Drive (BYOC service account)

Household-level **bring-your-own-credentials** link to a single Google Drive folder using a **service account JSON key**. The API never returns the stored key. Owners can queue an on-demand `.hfb` backup upload to that folder (`POST /gdrive/backup`).

**Auth:** Bearer JWT on all routes.

## Role matrix

| Route | `owner` | `admin` | `member` |
|-------|---------|---------|----------|
| `GET /gdrive/status` | Yes | Yes | **403** |
| `POST /gdrive/connect` | Yes | **403** | **403** |
| `DELETE /gdrive/disconnect` | Yes | **403** | **403** |
| `POST /gdrive/backup` | Yes | **403** | **403** |
| `GET /gdrive/backup/:jobId` | Yes | Yes | **403** |

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

## On-demand backup

### `POST /gdrive/backup`

**Owner only.** Queues an async job that builds a full-household `.hfb` (same bundle as a household export), uploads it to the connected Drive folder using the stored service account, then removes the local staging file.

**409** — `{ "code": "GDRIVE_NOT_CONFIGURED", "message": "..." }` when no Drive folder is connected.

**202** — `{ "jobId": "…", "message": "Backup started. Poll GET /gdrive/backup/:jobId for status." }`

**429** — Too many backup starts per user in a rolling window (disabled when `MODE=TEST`).

### `GET /gdrive/backup/:jobId`

**Owner or admin.** Poll until `status` is `complete` or `failed`.

**200** — `{ "id", "status", "driveFileId?", "driveFileName?", "sizeBytes?", "errorText?", "createdAt", "completedAt?" }` (camelCase JSON).

**404** — `{ "code": "BACKUP_JOB_NOT_FOUND", "message": "Backup job not found." }` when the id does not belong to this household.

`backup_job` rows are **ephemeral** (not included in `.hfb` exports). Retention and history UI are handled separately (CR-132).

## See also

- OpenAPI: [`openapi/openapi.yaml`](../openapi/openapi.yaml) — `gdrive` tag.
- Route summary: [`API_INDEX.md`](API_INDEX.md).
