# User guide

How to use the Household Finance app day to day. For installing the software on a machine or server, see [`RUNBOOK.md`](RUNBOOK.md). For deployment and database policy, see [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md).

## Sign in

Use the email and password for your account. On a fresh install from the default seed, the first user is created by the database seed (see [`RUNBOOK.md`](RUNBOOK.md) “First sign-in” for the default email and password). **Change the default password** as soon as you are set up.

After sign-in you land on **Home**, with cash summaries and shortcuts into the ledger.

## Net worth

Open **Net worth** from the sidebar for **assets vs liabilities** (non–payslip accounts).

- **Trend:** choose a **period** (last 3 / 6 / 12 months, year-to-date, or custom dates) and an **interval** (month-end, weekly, or daily samples). Each chart point uses the same balance rules as the table below: **manual balance** first, then a balance saved from an **import**, then a **statement** hint when nothing else exists. The chart shows total assets, liabilities, and net; you can **overlay** a few accounts on the same chart. The **period summary** table lists the **first** and **last** sample dates on the chart (same endpoints as the line); **Ledger** opens **Transactions** for that calendar day only. **Belongs to** optionally limits the sheet to household-owned accounts or one member’s accounts.
- **Balance sheet:** one table for all accounts. **Liabilities** are shown as **negative** balances so they read consistently with net worth. **Table as of** picks the snapshot date; use **Edit** on a row to post a manual balance (or **Bulk set as-of** to re-date manual snapshots). Account names link to **Transactions** for the balance as-of day; when a balance came from an import, an extra link opens transactions for that **import file**.
- **Retry load** appears only if the trend or balance sheet failed to load; it refetches both.

Details and API behavior: [`API_BALANCE_SHEET.md`](API_BALANCE_SHEET.md), backlog notes in [`BALANCE_SHEET_BACKLOG.md`](BALANCE_SHEET_BACKLOG.md).

## Home (dashboard)

- Review **cash KPIs**, period comparisons, and optional **safe-to-spend** / savings hints when you have set a monthly savings target in Settings.
- Use filters or drill-downs where the UI offers them to open **Transactions** with the same scope.

## Settings

Open **Account → Settings** from the top bar.

- **Profile:** name, avatar, visibility, and related preferences.
- **Password:** change your password (existing sessions are invalidated after a successful change).
- **Household / finances:** monthly savings target, income and employer setup (used for payslips), and other household-level options.
- **Connected accounts:** add or edit **financial accounts** (bank, card, etc.). Pick an institution label, parser profile where applicable, account mask (e.g. last four digits), and **belongs-to** (household vs a specific member) so imports and reports attribute activity correctly.
- **Custom institutions:** you can add household-specific institution names that complement the built-in list.

## Importing statements

1. Click **New import** in the header.
2. Create or continue an **import session**, then **upload** your files (CSV, PDF, etc., depending on supported profiles).
3. For each file, **bind** it to the correct **financial account** and owner if prompted.
4. Run **parse**, review any parser warnings, then **canonicalize** to write rows into the ledger—or use **Run import** in the workspace to run **parse** and then **canonicalize** in one go.

### What each step does

- **Parse** reads the staged files and inserts **parsed rows** into the database (`transaction_raw`). It does not compare against your existing ledger yet.
- **Canonicalize** maps those parsed rows into **ledger transactions** (`transaction_canonical`): it applies **fingerprint dedupe** (exact duplicates are skipped), may create **review queue** items for near-duplicates or unknown categories, and assigns categories where rules or defaults apply.

**Important:** Ledger rows are created **as soon as canonicalize succeeds**. Finalizing the import session is about **closing that session** (no more uploads, workflow complete)—it is **not** a separate “commit to ledger” step. While the session is still in **review**, **Undo import** can remove the ledger rows that came from this session’s parsed lines and clear related review items, while keeping the parsed rows so you can canonicalize again.

**Sessions:** While a session is in **review**, you fix issues and apply categories; after you are done, start a **new import session** for the next batch rather than reusing a finalized workflow in ways the UI discourages.

**Staging files:** Uploaded bytes live under `data/imports/<sessionId>/` during processing. After a successful canonicalize, the app normally **removes** those staged files. Keep your own copies of originals if you need long-term archives outside the app.

## Transactions

- **All:** browse and search posted (and other) ledger rows. Assign or change **categories**, adjust **belongs-to**, and use row actions as needed.
- **Needs review:** rows that need attention (unknown category, duplicates, transfer ambiguity, reconciliation hints, etc.). Expand a row for context, then **resolve** individually or use **bulk** actions where available.

**Review queue statuses (bulk bar):** **In review** marks selected resolution items as *in progress*; **Resolve** marks them *resolved* (cleared from the open queue); **Reopen** sends them back to *open*. Applying a **category** updates the underlying transaction where the item type allows it (for example unknown-category items). The ledger row already exists; the queue tracks what still needs a human decision.

**Search:** Use the search field where provided; merchant and memo text may be indexed for full-text search depending on setup.

### Ledger edits (planned)

Today, for **posted** transactions, the product focuses on **category** (and belongs-to where exposed). The following are **not implemented yet** but are on the product backlog:

- Edit **description / memo** (and related fields) on finalized ledger rows.
- **Delete** a single transaction, or **bulk delete** selected rows.
- **Bulk recategorize** on the **All** tab for rows that are not tied to an open “unknown category” resolution item (the Needs review bulk category flow is aimed at that queue).

## Categories and rules

- **Categories:** browse the taxonomy, add household-specific subcategories under top-level groups where the product allows it.
- **Category rules (household):** define patterns (contains, prefix, etc.) that map bank text to a **leaf** category. Rules have priority and optional **money in / out** scope. You can **import** and **export** CSV for bulk edit; sample templates live under [`fixtures/category-import/`](../fixtures/category-import/) in the repo (see that folder’s README for column formats).
- **Built-in rules:** global keyword rules ship with the app; household rules are evaluated in an order documented for operators in [`IMPORT_CLASSIFICATION.md`](IMPORT_CLASSIFICATION.md) and related API docs.

## Payslips

If your deployment uses payslip import: configure **employer** and deposit account linkage in Settings / profile flows as guided by the UI, then upload payslip PDFs through the payslip workflow. Parsed summaries are separate from normal bank **canonical** transactions; see [`PAYSLIP_V1.md`](PAYSLIP_V1.md) for product scope and limitations.

On the **Payslips** list, use **Belongs-to** (same idea as Transactions) to narrow rows to household-attributed payslips, a single member, or clear the filter to see all.

## Where to read more

| Topic | Document |
|--------|-----------|
| Net worth / balance sheet API | [`API_BALANCE_SHEET.md`](API_BALANCE_SHEET.md) |
| Environment variables | [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) |
| Logging | [`LOGGING.md`](LOGGING.md) |
| API routes (machine-readable) | [`openapi/openapi.yaml`](../openapi/openapi.yaml) |
| API topic index | [`API_INDEX.md`](API_INDEX.md) |
| Change and release notes | [`CHANGE_HISTORY.md`](CHANGE_HISTORY.md) |
