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

## Household data export (ZIP)

- **Settings → Household → Data export** (owner/admin) queues `POST /exports/household`. The download is a **ZIP** containing `manifest.json` and `household-bundle.json`.
- **`POST /exports/household/import`** returns **501** until restore is implemented.
- Exports are **rate-limited** per user (rolling window) to reduce abuse; see [`openapi/openapi.yaml`](../openapi/openapi.yaml).

## Postgres

- The app **persists in PostgreSQL** only. Set **`DATABASE_HOST`**, **`DATABASE_USER`**, **`DATABASE_NAME`**, and related fields (see [`.env.example`](../.env.example)). Use **`DATABASE_SSL=0`** for local Docker. See [`POSTGRES_CUTOVER.md`](POSTGRES_CUTOVER.md).
