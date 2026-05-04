# API: Google Drive (OAuth2 user-delegated)

Household-level link to a single Google Drive folder using **OAuth2** with a **user refresh token** (files are owned by the user and use their Drive quota). The API **never** returns refresh or access tokens. Owners start connect via **`GET /gdrive/oauth/url`** (then Google redirect + **`GET /gdrive/oauth/callback`**) or **`POST /gdrive/connect`** with an authorization `code`. On-demand **`.hfb`** upload (`POST /gdrive/backup`), **automatic** backups, **Drive-side retention**, and **local backup job history** behave as before.

**Auth:** Bearer JWT on all routes **except** **`GET /gdrive/oauth/callback`** (browser redirect from Google; no `Authorization` header).

**Server env:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (must match the OAuth client’s authorized redirect URI, e.g. `https://api.example.com/gdrive/oauth/callback`). **`JWT_SECRET`** also signs the OAuth `state` payload. **`PUBLIC_BASE_URL`** (optional) should be your SPA origin so the callback can redirect to `https://your-app/#/settings?...` when the API and UI run on different hosts.

## Server logging (Drive API failures)

When Google returns an HTTP error, the backend logs **`httpStatus`**, **`httpStatusText`**, and **`responseBody`** (Google’s JSON `error` object, including `errors[].reason`) with a short **`context`** label (for example `Backup job … upload(files.create)`). Connection tests use **`log.warn`**; backup upload, list, download, and prune failures use **`log.error`**. These details are **not** included in API JSON responses; **`backup_job.error_text`** stays a short, user-facing summary.

## Role matrix

| Route | `owner` | `admin` | `member` |
|-------|---------|---------|----------|
| `GET /gdrive/oauth/callback` | Public (no JWT) | Public | Public |
| `GET /gdrive/oauth/url` | Yes | **403** | **403** |
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

Returns connection metadata for the authenticated household. OAuth tokens are **never** included.

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

## `GET /gdrive/oauth/url`

**Owner only.** Query: **`folderId`** (required).

**200** — `{ "url": "<https://accounts.google.com/...>" }` — open in the browser (`window.location.href = url`).

**400** — Zod validation (`issues`) if `folderId` missing, or **`OAUTH_NOT_CONFIGURED`** when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` are not set on the server.

## `GET /gdrive/oauth/callback`

**Public.** Query: **`code`**, **`state`** (both required). `state` is HMAC-signed and includes `householdId`, `userId`, `folderId`, and expiry; the handler verifies the signing user is an **owner** of that household, exchanges `code` for tokens, verifies folder access, then upserts `household_gdrive_config` (**scheduler fields are not reset** on reconnect).

**302** — Redirect to **`/#/settings?tab=data&gdrive=connected`** on success, or **`...&gdrive=error&message=<encoded>`** on failure. If **`PUBLIC_BASE_URL`** is set, the redirect is absolute under that origin.

## `POST /gdrive/connect`

**Owner only.** Body JSON:

```json
{
  "code": "authorization code from Google",
  "folderId": "Drive folder ID from the URL"
}
```

1. Exchanges `code` for OAuth tokens (`refresh_token` required).
2. Calls the Drive API (`files.get`) to confirm the folder exists, is a folder, and is accessible to the **authenticated Google user**.
3. On success, upserts `household_gdrive_config` (including `last_verified_at`; **`backup_frequency_hours`** / **`backup_retention_count`** preserved on conflict).

**400** — Zod `Invalid payload` with `issues`, or **`OAUTH_NOT_CONFIGURED`** when Google OAuth env is missing on the server.

**422** — `DRIVE_CONNECTION_FAILED` when token exchange or the Drive API check fails.

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

**409** — `{ "code": "GDRIVE_NOT_CONFIGURED", "message": "..." }` when Drive is not connected (or stored refresh token is missing).

**403** — Non-owner.

## On-demand backup

### `POST /gdrive/backup`

**Owner only.** Queues an async job that builds a full-household `.hfb` (same bundle as a household export), uploads it to the connected Drive folder using the stored OAuth refresh token, then removes the local staging file.

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
