# API: Google Drive (BYOC service account)

Household-level **bring-your-own-credentials** link to a single Google Drive folder using a **service account JSON key**. The API never returns the stored key. Owners can queue an on-demand `.hfb` backup upload to that folder (`POST /gdrive/backup`), configure **automatic** backups and **Drive-side retention**, and inspect **local backup job history**.

**Auth:** Bearer JWT on all routes.

## Role matrix

| Route | `owner` | `admin` | `member` |
|-------|---------|---------|----------|
| `GET /gdrive/status` | Yes | Yes | **403** |
| `POST /gdrive/connect` | Yes | **403** | **403** |
| `DELETE /gdrive/disconnect` | Yes | **403** | **403** |
| `PATCH /gdrive/settings` | Yes | **403** | **403** |
| `POST /gdrive/backup` | Yes | **403** | **403** |
| `GET /gdrive/backup/:jobId` | Yes | Yes | **403** |
| `GET /gdrive/backups` | Yes | Yes | **403** |
| `GET /gdrive/backups/history` | Yes | Yes | **403** |
| `POST /gdrive/restore` | Yes | **403** | **403** |

## Automatic backup scheduler (server heartbeat)

When **`MODE` is not `TEST`**, the API starts a lightweight scheduler after DB startup: a **30 second** delay, then **`checkAndQueueDueBackups`** every **30 minutes**.

For each `household_gdrive_config` row with **`backup_frequency_hours` > 0**:

1. If any **`backup_job`** for that household is **`queued`** or **`running`**, skip (no duplicate queue).
2. Find the most recent **`complete`** job by **`completed_at`**. If none exists, the household is treated as **overdue** immediately.
3. If **`now - last_completed_at` ≥ `backup_frequency_hours` hours**, the server inserts a new **`backup_job`** with **`triggered_by_user_id` null** (automatic), sets **`household_gdrive_config.last_scheduled_backup_at = NOW()`**, and processes the job asynchronously (same pipeline as manual backup).
4. In **`MODE=PROD`**, if a completed job **does** exist and **`now - last_completed_at` > 2 × interval**, the server logs a **warning** (staleness / missed windows — e.g. Koyeb eco instance sleep). This does not block queuing when the interval in (3) is also exceeded.

**Retention:** After each successful upload, the server lists **`.hfb`** files in the connected folder (newest first) and deletes the oldest excess files so at most **`backup_retention_count`** remain. Prune list/delete failures are **`log.warn`** only and do **not** fail the backup.

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
  "lastError": null,
  "backupFrequencyHours": 24,
  "backupRetentionCount": 7,
  "lastScheduledBackupAt": "2026-05-01T03:00:00.000Z"
}
```

- **`connectedByUserId`** — Audit field; **`null`** if the connecting user was deleted (`ON DELETE SET NULL` on `household_gdrive_config.connected_by_user_id`).
- **`backupFrequencyHours`** — **0** disables automatic backups (manual only). Allowed non-zero values: **12, 24, 48, 72, 168**.
- **`backupRetentionCount`** — **1–30**; number of **`.hfb`** files to keep in Drive after each successful upload.
- **`lastScheduledBackupAt`** — Last time the **scheduler** queued a job (not updated for manual **`POST /gdrive/backup`**).

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

## `PATCH /gdrive/settings`

**Owner only.** Updates scheduler fields on the existing `household_gdrive_config` row.

**Body JSON**

```json
{
  "backupFrequencyHours": 24,
  "backupRetentionCount": 7
}
```

- **`backupFrequencyHours`** — **0, 12, 24, 48, 72, or 168** (integer).
- **`backupRetentionCount`** — **1–30** (integer).

**200** — `{ "backupFrequencyHours", "backupRetentionCount" }` (echo).

**400** — Zod validation (`issues`).

**409** — `{ "code": "GDRIVE_NOT_CONFIGURED", "message": "..." }` when Drive is not connected (or stored key cannot be loaded).

**403** — Non-owner.

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

## Restore from Drive

### `GET /gdrive/backups`

**Owner or admin.** Lists up to the **20** most recent files in the connected Drive folder whose names contain the substring `.hfb` (Drive query: `name contains '.hfb'`). Empty folder returns **`{ "files": [] }`** (not an error).

**200** — `{ "files": [ { "fileId", "fileName", "sizeBytes", "createdAt" } ] }`  
- **`sizeBytes`** may be `null` when Drive does not return a size.  
- **`createdAt`** is the Drive `createdTime` string (ISO 8601 when present).

**409** — `{ "code": "GDRIVE_NOT_CONFIGURED", "message": "..." }` when no Drive folder is connected for the household.

**502** — `{ "code": "DRIVE_LIST_FAILED", "message": "..." }` when the Drive API call fails (permissions, network, etc.).

### `GET /gdrive/backups/history`

**Owner or admin.** Returns up to **20** rows from the **`backup_job`** table for this household (newest `created_at` first). This reflects **what the server attempted** (queued, running, complete, failed), including automatic jobs (**`triggeredByUserId`** is **`null`**). It is **not** the live Drive file list (use **`GET /gdrive/backups`** for restore).

**200** — `{ "jobs": [ { "id", "householdId", "status", "driveFileId", "driveFileName", "sizeBytes", "errorText", "triggeredByUserId", "createdAt", "completedAt" } ] }` (camelCase).

**409** — `{ "code": "GDRIVE_NOT_CONFIGURED", "message": "..." }` when Drive is not connected.

### `POST /gdrive/restore`

**Owner only.** Body JSON: `{ "fileId": "<Drive file id>" }`. Downloads that file from Google Drive into staging under `data/gdrive-backup-staging/`, then **`queueHouseholdImport`** moves it into `data/imports-restore/` and starts the same async restore pipeline as `POST /exports/household/import`.

**409** — `{ "code": "GDRIVE_NOT_CONFIGURED", "message": "..." }` when no Drive folder is connected.

**502** — `{ "code": "DRIVE_DOWNLOAD_FAILED", "message": "..." }` when the download from Drive fails.

**202** — `{ "jobId", "message" }` — poll **`GET /exports/import/:jobId`** until `status` is `complete` or `failed`. After a successful restore, JWTs for users in the bundle are invalidated (e.g. `token_version`); the client should treat completion like a local restore and **sign out** / clear the stored token.

## See also

- OpenAPI: [`openapi/openapi.yaml`](../openapi/openapi.yaml) — `gdrive` tag.
- Route summary: [`API_INDEX.md`](API_INDEX.md).
