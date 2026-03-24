# Import staging purge (Epic 2.4)

Uploaded bytes are written under **`data/imports/<sessionId>/`** while a session is being processed. **After a successful canonical ingest** (`POST /imports/sessions/:id/canonicalize`), the backend **deletes those staged files** and clears **`import_file.stored_path`** so the tree stays small. You typically do **not** need this script for day-to-day cleanup anymore.

The purge script remains useful for **legacy folders**, **failed** or **abandoned** sessions (parse never ran or canonicalize never succeeded), or **manual** recovery.

## What it does

- Deletes the session directory under **`{repo}/data/imports/<sessionId>/`** (when present).  
  This is the **same** tree the API uses (`backend` resolves paths under the **repository root**, not `backend/data/imports` — see `backend/src/paths.ts`).
- Sets **`import_file.stored_path`** to **`NULL`** for rows in that session so the DB does not reference missing paths.

**It does not** delete `import_session`, `import_file`, `transaction_raw`, or `transaction_canonical` rows. **No “clean database”** — ledger and metadata stay; only staged **files** on disk and the **`stored_path`** pointer are cleared.

**Re-parse:** In normal operation, staged files are already removed **after successful canonicalize** (see top of this doc). This script is for paths where files **still exist** (failed/abandoned session, or legacy). After purge, **parse** cannot read bytes again until you **re-upload** those files.

### Which database? (TEST vs PROD)

The script picks the SQLite file the same way the backend does (`.env`: `MODE`, `DB_PATH`, `DB_PATH_TEST`, `DB_PATH_PROD`). Your log line **`Database: .../household-finance-test.sqlite`** means **`MODE=TEST`** (or default).

- **`--all-sessions`** only lists session IDs from **that** database file.
- **TEST and PROD share one `data/imports/` tree** but use **different** SQLite files. If the app created the session in **`household-finance-prod.sqlite`** but you run purge with **`MODE=TEST`**, that session’s folder will **not** be targeted — it will look like the script “did nothing” for that UUID.
- **Prefer** passing **`--mode=PROD`** or **`--mode=TEST`** so the CLI matches the DB your imports use (no need to edit `.env` for one-off runs):

  ```bash
  npm run import:purge -- --mode=PROD --all-sessions --dry-run
  npm run import:purge -- --mode=PROD --all-sessions --execute --i-understand
  ```

Folders under `data/imports/` that belong to sessions **only** in the other DB will **not** be removed until you purge using **`--mode`** / `MODE` for that DB.

### Orphan directories (`--orphan-dirs` / `--also-orphans`)

After a normal purge, you may still see UUID-named folders listed. If the problem was **wrong `MODE`**, fix **`--mode`** first.

**Optional:** **`--orphan-dirs`** (alone) removes only **UUID-shaped** directories under `data/imports/` that are **not** present in **`import_session` in either** `household-finance-test.sqlite` or `household-finance-prod.sqlite`. It does **not** remove `custom/`. Use dry-run first.

**Optional:** **`--also-orphans`** after **`--all-sessions`** (or another session scope) runs the same orphan pass **after** the main work.

If a UUID folder **still** exists because the session row lives in prod, **`--orphan-dirs` will not delete it** (it is not an orphan).

### Leftover folders

If something still appears under `data/imports/`, it may be:

1. **Wrong `MODE` / `--mode`** — session exists only in the other SQLite file; use **`--mode=PROD`** (or TEST) to match.
2. **True orphan** — no `import_session` row in **either** local DB; use **`--orphan-dirs --dry-run`** to preview removal.
3. **Reserved `custom/`** — never removed by this script.
4. **Wrong path** — you are inspecting `backend/data/imports` or another copy; the app uses **`{repo}/data/imports`** at the monorepo root.

## Safety

- **Default behavior is dry-run** (or pass `--dry-run`): prints what would happen, changes nothing.
- **Destructive** runs require **`--execute`** and **`--i-understand`**.
- Pick **exactly one** main scope: `--session=…` **or** `--older-than-days=N` **or** `--all-sessions`, **or** use **`--orphan-dirs`** alone (no session list; only removes dirs not in either DB).
- **`--also-orphans`** can be added after a main scope (not with `--orphan-dirs` alone).

## Database selection

The script resolves the DB path like the backend (`.env`: `MODE`, `DB_PATH`, `DB_PATH_TEST`, `DB_PATH_PROD`). Point `MODE` / `DB_PATH` at the database you intend to modify.

## Examples

```bash
# Preview deleting one session’s staging folder + DB pointer cleanup (uses .env MODE)
node scripts/purge-import-staging.mjs --session=<uuid> --dry-run

# Same but force prod DB file (recommended when app uses prod)
node scripts/purge-import-staging.mjs --mode=PROD --session=<uuid> --dry-run

# Preview all sessions older than 90 days (by import_session.started_at)
node scripts/purge-import-staging.mjs --older-than-days=90 --dry-run

# Preview every session listed in import_session for the chosen DB
node scripts/purge-import-staging.mjs --mode=PROD --all-sessions --dry-run

# Preview UUID dirs under data/imports/ that are not in either DB’s import_session
node scripts/purge-import-staging.mjs --orphan-dirs --dry-run

# After purging all sessions for this DB, also remove true orphan UUID dirs
node scripts/purge-import-staging.mjs --mode=PROD --all-sessions --also-orphans --dry-run
```

Apply (after reviewing dry-run output):

```bash
node scripts/purge-import-staging.mjs --session=<uuid> --execute --i-understand
```

## npm script

From repo root:

```bash
npm run import:purge -- --session=<uuid> --dry-run
```

## When to run

- **Abandoned or failed imports** — parse never succeeded or canonicalize never ran; staging folders remain.
- **Legacy** folders left over from older behavior or DB restore mismatch.
- Before **compressing backups** that should exclude large PDFs (you may still keep DB-only backups).
- **Not** required after every successful import in the current app — canonicalize already clears staging for completed sessions.

## Backup warning

Successful imports **do not** keep raw files on disk by default. If you need **long-term** proof of source documents, export or archive **before** canonicalize completes, or keep separate backups of originals outside `data/imports/`.
