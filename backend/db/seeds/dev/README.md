# Dev-only seeds (optional)

These SQL files insert **sample `financial_account` rows** (Bank of America, Citi, Chase, Marcus) for local smoke testing and integration tests. The **payslip** import bucket is **not** seeded: the API creates/updates it from **Profile → Employer Setup** on `GET /imports/accounts` and when you save employers on your profile.

They run only when you pass **`--dev-seeds`** to `scripts/db.mjs` / `scripts/db.sh`, or use **`npm run db:seed:dev`** / **`npm run setup`**.

**`npm run db:seed`** (default) applies [`../0001_bootstrap.sql`](../0001_bootstrap.sql) (household, owner, category taxonomy, built-in global rules) — no bank accounts.

There is no separate “financial institutions” catalog table in SQLite; institution names on accounts are plain text. The curated institution list in the UI is shipped in frontend code, not seeded here.
