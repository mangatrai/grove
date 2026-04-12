# Operator FAQ

Short answers for support and on-call. Deeper setup: [`RUNBOOK.md`](RUNBOOK.md), production DB policy: [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md), Postgres roadmap: [`POSTGRES_CUTOVER.md`](POSTGRES_CUTOVER.md).

## Import sessions after finalize

- The app does **not** auto-delete or TTL import sessions.
- The list shows up to **40** sessions (newest first), **all statuses** (`created` through `finalized` / `failed`).
- After **finalize**, the session is **terminal** in the UI, but the row remains for **audit and wayfinding** (which files ran, links into Transactions filtered by session, etc.). It is not required for day-to-day work.

## “Re-apply rules to ledger” (`POST /categories/rules/recategorize`)

- Scope is the **whole posted ledger** for the **authenticated household** (`transaction_canonical` with `status = 'posted'`).
- **`uncategorized_only`** updates rows with `category_id IS NULL`. **`all`** can overwrite categories when a rule matches.
- It does **not** filter by import session. **Finalized** imports’ posted rows are included like any other posted transaction.

## Household data export + restore (ZIP)

### Export
- **Settings → Household → Export data** (owner/admin) queues `POST /exports/household`. The job runs async; the UI polls until complete, then shows a persistent **Download** link.
- The ZIP contains `manifest.json` + one JSON file per table (`transactions.json`, `accounts.json`, etc.) — **exportVersion 3** (split-file format). Tables included: household settings, app users (with bcrypt password hashes), financial accounts, categories, category rules, transactions, net worth balance snapshots, payslip snapshots, custom institutions, person profiles, household memberships.
- **`categories.json` and `category_rules.json` contain only household-custom rows** (those created by the user via the UI or CSV import). Global/builtin categories and rules have `household_id IS NULL` in the DB and are intentionally excluded — they are seeded from `db/seeds/` on every fresh instance and will already be present on the restore target after `db:seed`. An empty `categories.json` is expected and correct for a household that uses only the global seed category tree.
- Exports are **rate-limited** per user (10 per rolling hour).
- ZIP files are stored in `data/exports/` on the server. There is no automatic cleanup — delete old ZIPs manually if disk space is a concern.

### Restore
- **Settings → Household → Restore from backup** — upload a `.zip` produced by the export above.
- The restore is **destructive and irreversible**: all current household data is wiped and replaced from the ZIP.
- After restore, all users' `token_version` is incremented — every existing JWT is immediately invalidated. The user performing the restore is signed out automatically by the frontend after 3 seconds.
- `import_file_id` references in `account_balance_snapshot` and `payslip_snapshot` are set to NULL on restore (raw import files are not part of the bundle).
- **Backward-compatible:** the restore endpoint also accepts v1/v2 ZIPs (single `household-bundle.json`).
- API: `POST /exports/household/import` (multipart `file` field) → `{ jobId }` → poll `GET /exports/import/:jobId` → `{ status, stats }`.
- Restore ZIPs are staged in `data/imports-restore-upload/` (multer temp) then moved to `data/imports-restore/` for job processing.

## Postgres

- The app **persists in PostgreSQL** only. Set **`DATABASE_HOST`**, **`DATABASE_USER`**, **`DATABASE_NAME`**, and related fields (see [`.env.example`](../.env.example)). Use **`DATABASE_SSL=0`** for local Docker. See [`POSTGRES_CUTOVER.md`](POSTGRES_CUTOVER.md).
