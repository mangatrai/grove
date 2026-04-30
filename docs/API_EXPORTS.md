# API: Household export and restore (.hfb)

Authenticated household backup as a **`.hfb`** file (async job), and **destructive** restore from that `.hfb` file (async job). Operator-oriented behavior (rate limits, bundle contents, staging paths) is summarized in [`RUNBOOK.md`](RUNBOOK.md) §11.

## `POST /exports/household`

**Auth:** Bearer JWT.

### Role / membership rules (CR-109 Slice 5)

| Role | Export scope |
|------|-------------|
| `owner`, `admin` | Full household export — all tables, all users, all transactions. |
| `member` (with linked profile) | Personal export — transactions/accounts/payslips/balance_snapshots filtered to their `owner_person_profile_id`. Shared reference data (categories, rules, custom institutions) included. Users and household rows omitted for privacy. |
| `member` (no profile) | 403. |

Queues an **export** job. Response is immediate (**202**); the `.hfb` backup is built in the background.

**429:** Rolling window limit — **10 export starts per user per hour** (see `exports.routes.ts`).

**202 body:**

```json
{
  "jobId": "uuid",
  "scope": "household",
  "message": "Export started. Poll GET /exports/:jobId until status is complete, then GET /exports/:jobId/download for the .hfb backup."
}
```

- **`scope`** — `"household"` for owner/admin exports; `"member"` for member-scoped exports.

## `GET /exports/{jobId}`

**Auth:** Bearer JWT.

Poll **export** job status until `status` indicates completion (exact strings match DB / service — typically a terminal state before download).

**200:** `{ "id", "status", "scope", "createdAt", "completedAt", "error" }` (shape aligns with `export_job`).

- **`scope`** — `"household"` or `"member"` depending on how the export was queued.

**404:** `EXPORT_JOB_NOT_FOUND` when the job id does not belong to this household.

## `GET /exports/{jobId}/download`

**Auth:** Bearer JWT.

Returns the backup file as a binary attachment when the job finished successfully and the file exists on disk.

**200:** binary file stream (`household-export-{jobId}.hfb`).

**404:** Export not ready, file missing, or job not found (payload includes `code`, `jobStatus`, `storagePath` for diagnostics).

**410 Gone:** `{ "code": "EXPORT_EXPIRED", "message": "..." }` — the backup file was automatically deleted after the 48-hour retention window. Start a new export.

## `POST /exports/household/import`

**Auth:** Bearer JWT. **Role:** `owner` only (admins and members receive 403). Restore wipes all household data — owner-only by design.

**Content-Type:** `multipart/form-data` with a single field **`file`** — must be a **`.hfb`** backup bundle (from download above).

Queues a **restore** job: **wipe household-scoped data in FK-safe order**, then reload from the bundle (remapping bundle `householdId` to the current household). **`import_file`** rows are not restored; **`import_file_id`** on balance snapshots and payslips is cleared (**NULL**) where those tables are restored.

**202 body:**

```json
{
  "jobId": "uuid",
  "message": "Restore started. Poll GET /exports/import/:jobId for status."
}
```

**400:** No file, or file is not accepted as `.hfb`.

**413:** Upload over **500 MB** (multer limit).

## `GET /exports/import/{jobId}`

**Auth:** Bearer JWT.

Poll **import (restore)** job status.

**200:** `{ "id", "status", "createdAt", "completedAt", "error", "stats" }` — **`stats`** is a per-table row count map when the job completed successfully (`stats_json` from `import_job`), otherwise often **`null`**.

**404:** `IMPORT_JOB_NOT_FOUND`.

## Bundle format notes

- Current exports use **`exportVersion` 4**: `manifest.json` plus **one JSON file per table**.
- Restore accepts **v4/v3** and legacy **v1/v2** (`household-bundle.json`).
- **Categories / rules** in the backup are **household** rows only (global built-ins are not duplicated in the bundle).
- **Member-scoped exports** set `scope: "member"` and `personProfileId` in `manifest.json`. Only the member's own data is included — these bundles are not suitable for full household restore.
- Export now uses **`SELECT *`** for all backed-up tables, so all columns present in the database at export time are captured automatically.
- Startup now runs an **export coverage check** that warns if any non-ephemeral DB table is missing from `EXPORT_REGISTRY` / `EXPORT_EPHEMERAL_TABLES`.

### Manifest schema (`manifest.json`)

```json
{
  "exportVersion": 4,
  "exportedAt": "2026-04-30T00:00:00.000Z",
  "householdId": "uuid",
  "format": "zip-split-v4",
  "encrypted": true,
  "tables": {
    "transaction_canonical": { "file": "transaction_canonical.json", "rows": 1234 }
  }
}
```

`encrypted` is `true` when `BACKUP_ENCRYPTION_KEY` is configured on the exporting server, otherwise `false`.

## Encryption

When `BACKUP_ENCRYPTION_KEY` is unset, `.hfb` files are unencrypted ZIP bytes.

When `BACKUP_ENCRYPTION_KEY` is set (64 hex characters, 32 bytes), export encrypts ZIP bytes using AES-256-GCM and writes the encrypted payload to the same `.hfb` file.

Encrypted `.hfb` binary layout:

- Bytes `0..3`: ASCII magic `HFB1`
- Bytes `4..15`: 12-byte random IV
- Bytes `16..31`: 16-byte GCM auth tag
- Bytes `32..N`: ciphertext (encrypted ZIP bytes)

Restore auto-detects encrypted files by checking the `HFB1` magic prefix.

Error scenarios:

- **Missing key:** If backup is encrypted but `BACKUP_ENCRYPTION_KEY` is not configured on restore server, import fails with a clear key-required message.
- **Wrong key / corrupted file:** If key does not match (or payload integrity fails), decrypt step throws and the import job fails with decryption error text.

## Tables in exportVersion 4

| Table key | Included in household export | Included in member export |
|------|-------------|-------------|
| `app_user` | Yes | No |
| `household` | Yes | No |
| `household_custom_institution` | Yes | No |
| `financial_account` | Yes | Yes (member-owned only) |
| `category` | Yes | Yes |
| `person_profile` | Yes | Yes (self only) |
| `household_membership` | Yes | No |
| `category_rule` | Yes | Yes |
| `budget_category` | Yes | No |
| `transaction_canonical` | Yes | Yes (member-owned only) |
| `account_balance_snapshot` | Yes | Yes (member-owned accounts only) |
| `payslip_snapshot` | Yes | Yes (member-owned only) |
| `payslip_line_item` | Yes | Yes (for member-owned payslips only) |
| `recurring_merchant_override` | Yes | No |
| `resolution_item` | Yes | No |
| `household_ai_insight` | Yes | No |

## After restore

All sessions for users in the household should treat tokens as invalid (**`token_version`** bump). The Settings UI signs the user out after a successful restore; API clients must **re-login**.
