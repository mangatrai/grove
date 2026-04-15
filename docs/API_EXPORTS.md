# API: Household export and restore (ZIP)

Authenticated household backup as a **ZIP** (async job), and **destructive** restore from that ZIP (async job). Operator-oriented behavior (rate limits, bundle contents, staging paths) is summarized in [`OPERATOR_FAQ.md`](OPERATOR_FAQ.md).

## `POST /exports/household`

**Auth:** Bearer JWT.

Queues an **export** job. Response is immediate (**202**); the ZIP is built in the background.

**429:** Rolling window limit — **10 export starts per user per hour** (see `exports.routes.ts`).

**202 body:**

```json
{
  "jobId": "uuid",
  "message": "Export started. Poll GET /exports/:jobId until status is complete, then GET /exports/:jobId/download for the ZIP."
}
```

## `GET /exports/{jobId}`

**Auth:** Bearer JWT.

Poll **export** job status until `status` indicates completion (exact strings match DB / service — typically a terminal state before download).

**200:** `{ "id", "status", "createdAt", "completedAt", "error" }` (shape aligns with `export_job`).

**404:** `EXPORT_JOB_NOT_FOUND` when the job id does not belong to this household.

## `GET /exports/{jobId}/download`

**Auth:** Bearer JWT.

Returns **`application/zip`** when the job finished successfully and the file exists on disk.

**200:** `application/zip` stream.

**404:** Export not ready, file missing, or job not found (payload includes `code`, `jobStatus`, `storagePath` for diagnostics).

**410 Gone:** `{ "code": "EXPORT_EXPIRED", "message": "..." }` — the ZIP was automatically deleted after the 48-hour retention window. Start a new export.

## `POST /exports/household/import`

**Auth:** Bearer JWT.

**Content-Type:** `multipart/form-data` with a single field **`file`** — must be a **`.zip`** export bundle (from download above or a compatible older bundle).

Queues a **restore** job: **wipe household-scoped data in FK-safe order**, then reload from the bundle (remapping bundle `householdId` to the current household). **`import_file`** rows are not restored; **`import_file_id`** on balance snapshots and payslips is cleared (**NULL**) where those tables are restored.

**202 body:**

```json
{
  "jobId": "uuid",
  "message": "Restore started. Poll GET /exports/import/:jobId for status."
}
```

**400:** No file, or file is not accepted as ZIP (extension / MIME check).

**413:** Upload over **500 MB** (multer limit).

## `GET /exports/import/{jobId}`

**Auth:** Bearer JWT.

Poll **import (restore)** job status.

**200:** `{ "id", "status", "createdAt", "completedAt", "error", "stats" }` — **`stats`** is a per-table row count map when the job completed successfully (`stats_json` from `import_job`), otherwise often **`null`**.

**404:** `IMPORT_JOB_NOT_FOUND`.

## Bundle format notes

- Current exports use **`exportVersion` 3**: `manifest.json` plus **one JSON file per table** (see **CR-078 v2** in [`CHANGE_HISTORY.md`](CHANGE_HISTORY.md)).
- Restore accepts **v3** and legacy **v1/v2** (`household-bundle.json`).
- **Categories / rules** in the ZIP are **household** rows only (global built-ins are not duplicated in the bundle).

## After restore

All sessions for users in the household should treat tokens as invalid (**`token_version`** bump). The Settings UI signs the user out after a successful restore; API clients must **re-login**.
