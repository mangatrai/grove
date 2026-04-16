# User guide

How to use the Household Finance app day to day. For installing the software on a machine or server, see [`RUNBOOK.md`](RUNBOOK.md). For deployment and database policy, see [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md).

## Sign in

Use the email and password for your account. On a fresh install from the default seed, the first user is created by the database seed (see [`RUNBOOK.md`](RUNBOOK.md) “First sign-in” for the default email and password). **Change the default password** as soon as you are set up.

After sign-in you land on **Home**, with cash summaries and shortcuts into the ledger.

## Net worth

Open **Net worth** from the sidebar for **assets vs liabilities** (non–payslip accounts).

- **Trend:** choose a **period** (last 3 / 6 / 12 months, year-to-date, or custom dates) and an **interval** (month-end, weekly, or daily samples). Each chart point uses the same balance rules as the table below: **manual balance** first, then a balance saved from an **import**, then a **statement** hint when nothing else exists. The chart shows total assets, liabilities, and net; you can **overlay** a few accounts on the same chart. The **period summary** table lists the **first** and **last** sample dates on the chart (same endpoints as the line); **Ledger** opens **Transactions** for that calendar day only. **Belongs to** optionally limits the sheet to household-owned accounts or one member’s accounts.
- **Balance sheet:** one table for all accounts. Account type classification: **assets** = checking, savings, investment, **retirement** (401K/IRA/pension); **liabilities** = credit card, loan, mortgage. Accounts of other types (e.g. payslip) are excluded. **Liability balances** are stored as **positive magnitudes** (what you owe); net worth = total assets − total liabilities. When you import a statement (OFX, BoA CSV/PDF, Marcus PDF, Wealthfront PDF) the **statement ending balance** is automatically saved as an import snapshot — it appears on the balance sheet immediately without manual entry. **Table as of** picks the snapshot date; use **Edit** on a row to post a manual balance (or **Bulk set as-of** to re-date manual snapshots). Account names link to **Transactions** for the balance as-of day; when a balance came from an import, an extra link opens transactions for that **import file**.
- **Retry load** appears only if the trend or balance sheet failed to load; it refetches both.

Details and API behavior: [`API_BALANCE_SHEET.md`](API_BALANCE_SHEET.md), backlog notes in [`BALANCE_SHEET_BACKLOG.md`](BALANCE_SHEET_BACKLOG.md).

## Home (dashboard)

The dashboard gives you a full household snapshot in one view.

- **Net worth widget** — shows current total assets, liabilities, and net worth pulled from the balance sheet, with a link to the full Net Worth page. Only appears once you have at least one account with a balance.
- **Budget progress bar** — shows this calendar month's spend vs budget (color-coded: green → amber at 85% → red when over). Only appears when a budget exists for the current month. Links to the Budget page.
- **Cash KPIs** — inflows, outflows, net, safe-to-spend, and savings rate for the selected period, with previous-period and year-over-year comparison chips. Use the period preset to switch between last 30 days, calendar month, YTD, etc.
- **Safe to spend / savings target** — set a monthly savings target with the slider; safe-to-spend updates live (prorated by days in the selected period). Click **Save target** to persist it.
- **Uncategorized / review alerts** — if there are open resolution items (unknown categories, transfers needing pairing, or possible duplicates), the dashboard shows a line for each type with a direct "Review" link.
- **Outflows by category (pie)** — donut chart for the selected period. Click a slice to open Transactions filtered to that category.
- **Top inflow sources (table)** — ranked inflow totals by category for the period, with View links.
- **By category (table)** — full parent-level rollup with inflows / outflows / net / transaction count and comparison deltas.
- **Stacked monthly outflows bar** and **monthly net bar** — always show the trailing 6 calendar months regardless of the period preset above (labeled accordingly).
- **By account (table)** — per-account breakdown with View links.
- **Scope filters** — Account and Belongs-to filters at the top apply to all KPIs and charts on the page.

## Settings

Open **Account → Settings** from the top bar.

- **Profile:** name, avatar, visibility, and related preferences.
- **Password:** change your own password (existing sessions are invalidated after a successful change). Owners and admins can also **reset a member's password** from the Household tab — useful when a member forgets theirs.
- **Household / finances:** monthly savings target, household member roster, income and employer setup (used for payslips), and other household-level options.
- **Connected accounts:** add or edit **financial accounts** (bank, card, etc.). Pick an institution label, parser profile where applicable, account mask (e.g. last four digits), and **belongs-to** (household vs a specific member) so imports and reports attribute activity correctly.
- **Custom institutions:** you can add household-specific institution names that complement the built-in list.
- **Household backup (ZIP):** request an **export** of the household database slice (async job, then download the ZIP). **Restore from backup** uploads that ZIP and replaces household data (**destructive**); after a successful restore you are signed out because existing login tokens are invalidated. Prefer export → restore on a **fresh** instance or when you intentionally want to replace everything in the household. Details for operators: [`OPERATOR_FAQ.md`](OPERATOR_FAQ.md); API: [`API_EXPORTS.md`](API_EXPORTS.md).

### Household members

The **Household** tab lets you maintain a roster of the people who live in and share the household. Each member has a **name**, optional **email**, a **role** (`head` or `member`), and a **relationship** (`self`, `spouse`, `child`, `dependent`, `other`).

**Why this matters:** member profiles drive the **belongs-to** attribution throughout the app. When you add a bank account, a transaction, or a payslip, you can assign it to a specific person rather than the household as a whole. Reports (Transactions, Net Worth, Payslips) can then be filtered by person to show each member's slice.

**Adding a member:** fill in at least a first name, choose a role and relationship, and click **Save household**. Click **Add another row** to stage multiple new members before saving. Each saved member row shows a trash icon — click it to remove that member (a confirmation dialog appears; removal is permanent).

**Removing a member:** uses the trash icon at the right of each saved row. A confirmation dialog appears; removal is permanent. If the member has a login account, check **Also delete their login account** to remove it at the same time.

**Login accounts:** Each saved member row shows whether they have a login account ("✓ Has login account"). From this row, owners and admins can:
- **Create login** — creates a login account with a default temporary password; the member must change it on first login.
- **Reset password** — generates a new temporary password, immediately invalidates the member's current session, and sets `force_password_change`. Use this when a member forgets their password. Share the temporary password with them out-of-band; they will be prompted to change it on next login. This is also what the **Forgot password?** link on the login page directs users to request.

**Roles:**
- `head` — household head; has ownership semantics over accounts and income attributed to them.
- `member` — any other household member.

> **Note on login accounts vs household members:** These are separate concepts. A household _member_ is a person profile used for attribution. A _login user_ is an account that can authenticate to the app. Login accounts are managed from **Settings → Household** — no database access required.

## Importing statements

1. Click **New import** in the header.
2. Create or continue an **import session**, then **upload** your files (CSV, PDF, etc., depending on supported profiles).
3. For each file, **bind** it to the correct **financial account** and owner if prompted.
4. Run **parse**, review any parser warnings, then **canonicalize** to write rows into the ledger—or use **Run import** in the workspace to run **parse** and then **canonicalize** in one go.

### What each step does

- **Parse** reads the staged files and inserts **parsed rows** into the database (`transaction_raw`). It does not compare against your existing ledger yet.
- **Canonicalize** maps those parsed rows into **ledger transactions** (`transaction_canonical`): it applies **fingerprint dedupe**, classifies categories, and creates **Needs review** items as needed. Exact fingerprint duplicates from a previous import appear in Needs Review with the label **"Exact duplicate"** so you can decide to keep or trash them — nothing is silently dropped. Near-duplicates (same amount, different description) are flagged similarly. Unknown categories surface as uncategorized items to resolve.

**Important:** Ledger rows are created **as soon as canonicalize succeeds**. Finalizing the import session is about **closing that session** (no more uploads, workflow complete)—it is **not** a separate “commit to ledger” step. While the session is still in **review**, **Undo import** can remove the ledger rows that came from this session’s parsed lines and clear related review items, while keeping the parsed rows so you can canonicalize again.

**Sessions:** While a session is in **review**, you fix issues and apply categories; after you are done, start a **new import session** for the next batch rather than reusing a finalized workflow in ways the UI discourages.

**Staging files:** Uploaded bytes live under `data/imports/<sessionId>/` during processing. After a successful canonicalize, the app normally **removes** those staged files. Keep your own copies of originals if you need long-term archives outside the app.

## Transactions

- **All:** browse and search posted (and other) ledger rows. Assign or change **categories**, adjust **belongs-to**, and use row actions as needed.
- **Needs review:** rows that need attention — **unknown category**, **exact duplicate** (same transaction from a previous import), **near-duplicate** (same amount, similar description), **transfer ambiguity**, **reconciliation hints**, etc. Expand a row to see why it's flagged; use **Resolve** (keep / acknowledge), **Trash** (discard), or **bulk** actions on a selection. Resolving an exact duplicate promotes it to **posted**; trashing removes it from reports.

**Review queue statuses (bulk bar):** **In review** marks selected resolution items as *in progress*; **Resolve** marks them *resolved* (cleared from the open queue); **Reopen** sends them back to *open*. Applying a **category** updates the underlying transaction where the item type allows it (for example unknown-category items). The ledger row already exists; the queue tracks what still needs a human decision.

**Resolve all by merchant name** — when you have many unknown-category items for the same merchant (e.g. 40 rows for "WHOLEFDS"), click **"Resolve all by merchant name…"** in the Needs Review tab to expand an inline form. Type the merchant name or fragment; the app shows a live count of how many items match. Pick a category and click **Apply to all** — all matching open unknown-category items are categorized and resolved in one step. No row selection required.

**Rule learning** — after you change a transaction's category in the ledger table, the app offers to **create a classification rule** from that transaction's description pattern (owner/admin only). Accepting creates a `contains` rule so future imports with similar descriptions are classified automatically, without visiting Category Rules. Tap "Not now" to skip — the category change is saved either way.

**Search:** Use the search field where provided; merchant and memo text may be indexed for full-text search depending on setup.

### Ledger edits

For **posted** transactions you can:

- **Edit memo** — hover over any row to reveal a pencil icon next to the description. Click to enter inline edit mode; Enter saves, Escape cancels. The memo is an annotation field and does not affect the dedup fingerprint. (CR-107)
- **Delete (single)** — move a row to Trash with the trash icon, then permanently delete it from the Trash tab.
- **Bulk delete** — select rows on the Trash tab and use “Delete permanently”.
- **Bulk recategorize (All tab)** — check one or more rows on the All (Ledger) tab to reveal a bulk action bar. Choose a category and click “Apply category” to reassign all selected rows at once. Useful after rule changes or when correcting a batch of miscategorised imports. (CR-113)
- **Bulk recategorize (Needs Review tab)** — same bulk bar is available on the Needs Review tab, targeted at unknown-category resolution items.

## Categories and rules

- **Categories:** browse the taxonomy, add household-specific subcategories under top-level groups where the product allows it.
- **Category rules (household):** define patterns (contains, prefix, etc.) that map bank text to a **leaf** category. Rules have priority and optional **money in / out** scope. You can **import** and **export** CSV for bulk edit; sample templates live under [`fixtures/category-import/`](../fixtures/category-import/) in the repo (see that folder’s README for column formats).
- **Quick rule from transaction:** when you categorize a transaction in the ledger, the app offers to create a rule from that transaction’s description automatically. This is the fastest way to build up household rules — no need to visit Category Rules at all for the common case. The rule uses a `contains` match on the normalized description.
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
