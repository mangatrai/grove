# Grove — User Guide

Welcome to Grove, a self-hosted household finance app designed for families and small groups. This guide covers every major screen and workflow in the application. For installation and server management, see [ADMIN_GUIDE.md](ADMIN_GUIDE.md). For API documentation, see [API_REFERENCE.md](API_REFERENCE.md).

---

## Getting Started

### First Login

Grove runs on a single household. On a fresh installation, a default account is created during setup — check [ADMIN_GUIDE.md](ADMIN_GUIDE.md) §2 for the initial email and temporary password.

After your first successful login, you will land on the **Dashboard** (home page). Change your default password immediately.

#### Password Reset

If you forget your password, click **Forgot password?** on the login page. An administrator can send you a password reset link, or they can use **Settings > Household > Reset password** to generate a temporary password that you must change on your next login.

### Navigation Overview

The app has a sidebar on the left (collapsible on mobile) with links to major sections:

- **Home** — Cash flow dashboard and net worth snapshot
- **Transactions** — Ledger, search, bulk edit, and resolution queue
- **Imports** — Upload bank statements and payslips
- **Net Worth** — Balance sheet, asset/liability tracking, historical trends
- **Budget** — Set monthly spending goals and track progress
- **Payslips** — View, upload, and manage payslip records
- **Categories** — Define custom categories and rules for auto-classification
- **Settings** — Household profile, member roster, accounts, notifications, backups

Click the account menu in the top-right corner to access **Settings**, change password, or sign out.

### Household vs Individual Views

Grove is built for a household of multiple members (a spouse, children, roommates, etc.). Each person can have:

- A **household member profile** (used for attribution on accounts, transactions, and payslips).
- Optionally, a **login account** (so they can sign in and see personal data).

When you add a bank account or assign a transaction, you can tag it as belonging to the household as a whole, or to a specific person. Reports (Transactions, Net Worth, Payslips) can then be filtered by person.

For a single-user household, everything stays tagged as "household" and filters remain invisible.

---

## Dashboard (Home)

The Dashboard is your household snapshot in one view. It updates in real time and caches data to reduce refresh latency.

### Overview Cards

**Cash flow (top):** Shows the current month's net cash movement (inflows minus outflows). The display includes:

- Large net figure (green if positive, red if negative).
- Inflow and outflow totals.
- Savings rate or spending alert (e.g., "Saved 23% of income this month" or "Spending exceeded income").
- Number of posted transactions for the month.

**Refresh:** Click the refresh icon (top-right of the cash flow card) to reload dashboard data. Hover over the icon to see when data was last updated.

**Month selector:** Use the left/right arrows to browse previous months. You cannot navigate to future months; the current calendar month is always the rightmost option.

**Budget progress:** If a budget exists for the current month, a progress bar shows total spent vs budgeted. The bar is green below 80%, amber at 80-99%, and red when over budget. Click **Manage** to edit the budget.

### Alert Badges

When open resolution items exist, badges appear below the cash flow card:

- **Uncategorized** — transactions with unknown categories.
- **Transfers to pair** — transactions flagged as transfer-like (matching amount, date, opposite sign) but not yet confirmed as a pair.
- **Possible duplicates** — exact duplicate rows from separate import sessions.

Click any badge to jump directly to the Transactions page with that filter applied.

### Spending Breakdown

**Where money went (card):** A donut chart and table showing spending by category for the month. Click a category name or slice to open Transactions filtered to that category.

**By Account (card):** Lists the top 6 accounts (3 credit cards, 3 checking/savings) by outflow this month, with comparison arrows:

- First arrow = vs. last month (↑ spending up, ↓ spending down, → similar).
- Second arrow = vs. same month last year.

Hovering over an arrow shows the comparison period. Click the account name to jump to Transactions for that account.

### Net Worth Card

Displays current total assets, liabilities, and net worth (pulled from the Balance Sheet page). Shows a mini 6-month trend line. Click **View details →** to open the full Net Worth page.

### Recurring Payments Card

Grove detects recurring charges by analyzing transaction patterns over 6+ months:

- **Confirmed** recurring items appear first (marked with ●).
- **Suggested** items appear second (marked with ○); you can dismiss individual suggestions.

The card shows the total estimated monthly recurring spend and a count of distinct recurring charges. Click **+ N more** to expand the full list.

### Financial Health Card

Shows an AI-generated analysis of your household's financial situation (generated on-demand):

- Click **Generate analysis** to trigger an async job.
- On first run, generation takes ~30 seconds; subsequent visits are instant (cached).
- The card displays a short summary and expandable detail sections: what's working, concerns, spending patterns, investment gaps, and next steps.
- Analysis is scoped to the household by default; members see personal-only analysis.

### Period and Scope Filters

At the top of the dashboard:

- **Month selector** — browse months (forward/back arrows).
- **Refresh button** — reload all dashboard data.
- **Year-in-Review (seasonal)** — In February and March, a button appears to generate a personalized annual summary (see [Year-in-Review](#year-in-review) section below).

### 6-Month Trend Chart

Scrolling to the bottom of the dashboard, a 6-month stacked bar chart shows income (inflows) and spending (outflows) for the trailing 6 calendar months. This chart is independent of the month selector above.

---

## Transactions

The **Transactions** page is where you browse, search, filter, categorize, and edit the ledger.

### Tabs and Filters

**All:** The complete ledger of posted transactions.

**Needs Review:** Transactions and review items awaiting human decisions:
- Unknown categories
- Exact duplicates (marked "Exact duplicate" — same row imported twice)
- Near-duplicates (same amount, similar description; transaction may not exist yet)
- Transfer ambiguity (two transactions that look paired but not confirmed)
- Reconciliation hints (balance mismatches)

Expand any row to see why it's flagged.

### Search and Filter Controls

**Search field** — Free-text search on merchant/description.

**Category filter** — Hierarchical picker. Choose parent categories or drill into subcategories.

**Account filter** — Select accounts by institution and type.

**Date range** — Start and end dates (defaults to current month).

**Belongs to** — Filter by household or a specific member.

**Status** — "Posted" (canonical, live) or "Trash" (soft-deleted).

**Uncategorized only** — Show transactions with no category assigned.

Filters can be combined; results update instantly.

### Transaction Rows

Each row in the ledger shows:

- **Date** — posted date.
- **Merchant** — business name or description.
- **Amount** — signed number (negative = outflow, positive = inflow).
- **Category** — assigned category name.
- **Account** — linked bank/card account.
- **Status** — posted, duplicate, trashed, or in review.

Hovering over a row reveals:

- **Pencil icon** — inline edit memo (separate annotation field, not part of dedup fingerprint).
- **More actions menu** (•••) — delete, recategorize, or other options.

### Categorizing Transactions

**Single transaction:** Click the category field in a row and select from the hierarchical picker. Saves instantly. If you change a posted row's category, the app offers to **create a classification rule** (owner/admin only) that auto-categorizes similar future imports by description pattern. Click **Create rule** or **Not now** — either way, the category change is saved.

**Bulk recategorize:** Check one or more rows in the ledger to reveal a bulk action bar at the bottom. Select a category and click **Apply category**. All selected rows are recategorized at once. Useful after rule changes or when correcting a batch of mis-classified imports.

### Resolve All by Merchant Name

When you have many unknown-category items for the same merchant (e.g., 40 uncategorized "WHOLEFDS" rows), use the **Needs Review** tab:

1. Click **Resolve all by merchant name…** to expand an inline form.
2. Type the merchant name or fragment. The app shows a live count of matching open items.
3. Pick a category.
4. Click **Apply to all** — all matching open unknown-category items are categorized and resolved in one step.

No row selection required.

### Ledger Edits

**Edit memo:** Hover over any transaction's merchant/description to reveal a pencil icon. Click to inline-edit the memo (annotation text). Press Enter to save, Escape to cancel. The memo is separate from the dedup fingerprint and does not affect duplicate detection.

**Delete single:** Click the trash icon on any row to move it to the Trash tab. Rows in Trash can be permanently deleted via **Trash tab > Delete permanently** after selecting them.

**Bulk delete:** Switch to the **Trash tab**, check rows, and click **Delete permanently** in the bulk action bar.

### Review Item Resolution

In the **Needs Review** tab, each item has an **Expand** button that shows:

- Type (exact duplicate, near-duplicate, unknown category, transfer ambiguity, etc.)
- Reason and context
- Suggested actions

**Status bar (below selection):**

- **In review** — mark selected items as "in progress" (optional workflow state).
- **Resolve** — mark selected items as "resolved" and remove them from the open queue.
- **Reopen** — send resolved items back to "open" status.

**Apply category** — when available for unknown-category items, updates the underlying transaction.

---

## Importing Bank Statements

The **Imports** page (accessible via **New import** button in the top bar or the sidebar) manages file uploads and statement parsing.

### Import Workflow

**Step 1: Create or continue a session**

Click **New import** to start fresh, or continue an existing import session if one is in progress.

**Step 2: Upload files**

- Drag and drop or click to upload CSV, PDF, OFX, QFX, or Excel files depending on your banks and configured parser profiles.
- Multiple files can be uploaded in one session.
- Uploads are staged to disk (in `data/imports/<sessionId>/`).

**Step 3: Bind each file to an account**

For each file, a form appears:

- **Financial Account** — pick the correct bank account (hierarchically grouped by institution).
- **Parser Profile** — the app auto-detects the format (e.g., "Bank of America CSV", "OFX") but you can override manually if needed.
- **Belongs to** — household or a specific member (for correct attribution).

**Step 4: Parse**

Click **Parse** (or use **Run import** to parse and canonicalize in one step).

- Reads raw bytes from each file and normalizes to `transaction_raw` in the database.
- May show warnings (e.g., balance mismatch, unreadable PDF).
- No ledger rows are created yet.

**Step 5: Review parsed rows**

The import workspace shows:

- **Raw rows** — normalized transactions extracted from files (not yet in the ledger).
- **Parse summary** — file-level success/failure, row counts.

**Step 6: Canonicalize**

Click **Canonicalize** to create ledger rows:

- Applies dedup fingerprint; exact duplicates are inserted as `duplicate` status and flagged in **Needs Review**.
- Classifies categories using built-in rules, household rules, and optional AI.
- Creates resolution items for unknown categories, transfer ambiguities, and near-duplicates.
- **Ledger rows are now live** and appear in the Transactions page.

**Step 7: Resolve**

While the import session is **in review**, go to **Transactions > Needs Review** to resolve open items. You can:

- Assign categories to unknown-category items.
- Confirm or reject duplicates.
- Pair transfer candidates.

**Step 8: Finalize**

Once all issues are resolved (or you're ready to move on), the import session moves to a terminal state. No further edits to this session are possible via the UI.

**Step 9: Undo (optional)**

While a session is still **in review**, you can use **Undo import** to delete all canonical rows created from that session's parsed rows and clear related resolution items. Parsed rows are preserved, so you can re-canonicalize if needed.

### Key Concepts

**Duplicate detection:** The app compares each new row against existing posted transactions using:

1. **FITID** (bank-supplied reference ID) if available (strongest check).
2. **Fingerprint** (SHA256 hash of account + date + amount + normalized description).

Exact matches are inserted as `duplicate` status and surfaced in **Needs Review** for user decision. Users can promote duplicates to `posted` (keep) or move to `trashed` (discard). Nothing is silently dropped.

**Near-duplicates:** Same account/date/amount but different description (e.g., description edited by user at the bank). These create a review item but no canonical row; user decides if a new row should be added.

**File cleanup:** After a successful canonicalize, Grove normally removes staged files from disk. Keep your own copies of originals if you need long-term archives.

### Supported Formats

- **OFX/QFX** — standard banking format (Chase, Discover, most banks).
- **Bank of America CSV/PDF** — checking and credit card.
- **Marcus PDF** — savings accounts.
- **Wealthfront PDF** — investment accounts.
- **IBM, Deloitte, ADP payslip PDFs** — if configured (see [Payslips](#payslips)).
- **Custom CSV** — if parser profiles have been set up by the operator.

Not all formats are enabled on every deployment. Disabled formats will not appear in the file picker.

---

## Net Worth

The **Net Worth** page tracks your total assets and liabilities over time.

### Balance Sheet View

**Assets table:** Rows for every account tagged as an asset (checking, savings, investment, retirement, etc.). Each row shows:

- **Account name** and account mask (e.g., last four digits).
- **Type** (e.g., checking, 401k, brokerage).
- **Balance** (most recent snapshot; may be manual or imported).
- **As of date** — when the balance was recorded.
- **Source** — "manual" (you entered it), "import" (from a bank statement), or null (no balance yet).

Click an account name to view transactions on that account for the balance-as-of date. If the balance came from an import, a second link opens transactions filtered to that specific import file.

**Liabilities table:** Same structure but for credit cards, loans, and mortgages. Balances are stored as positive numbers (what you owe).

**Totals summary:** Total assets, total liabilities, and net worth (assets − liabilities). Shows as of the current snapshot date.

### Adding / Updating Balances

**Manual balance entry:** Click **Edit** on any account row (or use the edit icon) to enter a balance and date.

**Bulk set as-of:** Use the **Bulk set as-of** button to re-date multiple manual balance snapshots at once (useful when you want all balances as of month-end).

**Import automatic balances:** When you import a statement (OFX, CSV, PDF), the statement ending balance is automatically captured and stored as an import snapshot on the account. Balances appear immediately without manual entry.

### Historical Trend Chart

**Trend tab:** Select a time period (last 3/6/12 months, year-to-date, or custom dates) and an interval (day, week, month-end, or custom).

- Chart shows total assets, liabilities, and net worth as three lines.
- You can overlay individual accounts on the same chart for detailed tracking.
- Hover over a point to see exact values and the date range sampled.

**Period summary table:** Lists the first and last sample dates on the chart (the endpoints). For each, shows balances and transaction count. Click **Ledger** to view transactions on that calendar day.

### Account Types and Liquidity

Accounts are classified as:

- **Assets:** checking, savings, investment, retirement, health (HSA/FSA), education (529/Coverdell), cash.
- **Liabilities:** credit card, loan, mortgage.
- **Other:** payslip accounts (income records, excluded from net worth).

An optional **Liquidity** enrichment (F-1 feature) labels accounts as:

- **Liquid** — readily accessible (checking, savings, HYSA).
- **Semi-liquid** — slower to convert (brokerage, investment).
- **Restricted** — locked up (retirement, education).

### Retry Load

If the trend or balance sheet fails to load, a **Retry load** button appears to refetch both.

---

## Payslips

Payslips are income records separate from bank transactions. They capture earnings, taxes, and deductions from pay stubs.

### Uploading a Payslip PDF

1. Click **+ Add payslip** or **New payslip** in the Payslips list.
2. Upload a PDF from your payroll system.
3. Select the **Employee** (person the payslip belongs to) and **Employer**.
4. The app extracts line items:
   - Gross pay (current + year-to-date).
   - Pre-tax deductions (401k, health insurance, etc.).
   - Taxes (federal, state, FICA, etc.).
   - Post-tax deductions.
   - Net pay.
5. You can edit extracted values if the PDF parser misread anything.
6. Click **Save** to store the payslip.

### Payslips List

The **Payslips** page shows all uploaded payslips, grouped by month:

- **Belongs to** filter — show all, household, or a specific member.
- **TrendCard per person** — for each person with payslips:
  - Latest net pay.
  - Year-to-date net pay.
  - 10-period net pay sparkline (trend).
  - Total YTD tax rate (%) with warning if suspiciously low (< 24% total ≈ < 16% federal after FICA).

Click any payslip row to open the detail page.

### Payslip Detail View

**KPI Strip (top):** Shows key figures from this payslip:

- Gross pay (current, YTD).
- Net pay (current, YTD).
- Total tax rate (current, YTD, %).
- Savings rate (if linked to a deposit account).

**Line Items Table:** Organized by section:

- **Earnings** — wages, bonuses, overtime.
- **Pre-tax deductions** — 401k, health insurance, dependent care FSA.
- **Tax deductions** — federal withholding, state, local, FICA (Social Security + Medicare).
- **Post-tax deductions** — 529, adoption assistance.
- **Other deductions and information** — company-specific fields.

Each row shows current and YTD amounts, plus hours or rate if applicable. You can:

- **Edit** individual line items (click pencil icon).
- **Delete** unnecessary rows (trash icon).
- **Add** rows via the **Add line item** button (select section and fill in name, authority, amount).

**Matched Deposits:** If the payslip deposit account is linked in Settings, the page shows matched transactions in the ±3-day window around the pay date. Click a matched deposit to view that transaction in the Transactions page.

**Validation Alerts:** Warnings appear for:

- Missing gross or net pay.
- Suspiciously low tax withholding.
- Unmatched salary deposit.

These do not prevent saving; they are informational.

---

## ESPP (Employee Stock Purchase Plan)

The **ESPP** page tracks IBM ESPP purchase batches, stock disposals, and year-to-date tax exposure (ordinary income vs. capital gain/loss). Access it via **ESPP** in the sidebar.

### IBM Stock Price Chip

The page header displays a live IBM stock quote chip — **IBM · $XXX.XX · close YYYY-MM-DD** — next to the ESPP title. The price is the last confirmed closing price, fetched from Yahoo Finance. It updates automatically at ~4:15 PM ET on weekdays; at other times it shows the most recently cached value. The chip is absent only if the backend has not yet fetched a quote since its last restart.

### Year Summary Strip

Ten KPI cards across two rows display the current year's activity:

- **Shares Purchased YTD** — total shares allocated in purchase batches
- **Transferred to Broker** — shares released to your brokerage account
- **Outstanding (EquatePlus)** — shares still held in the EquatePlus platform
- **Shares Sold YTD** — total shares you have recorded as sold
- **Total Invested** — cost basis × shares purchased
- **Discount Received YTD** *(ⓘ)* — (FMV − cost basis) × shares transferred; falls back to computed value when no payslip is linked
- **Sale Proceeds YTD** — total proceeds from recorded sales
- **Realized Gain / Loss** — OI + cap gain/loss combined
- **Ordinary Income YTD** *(ⓘ)* — discount × shares sold; this amount appears on your W-2
- **Capital Gain / Loss** *(ⓘ)* — (sale price − FMV at purchase) × shares sold; taxed at capital gains rates

Hover the ⓘ icon on a card to see the formula.

Use the **‹ ›** year selector to navigate between years.

### Purchase Batch Table

Each row is one purchase batch (one EquatePlus purchase date). Columns:

| Column | Description |
|--------|-------------|
| Purchase Date | YYYY-MM-DD of the purchase |
| Shares | Shares allocated (from PDF) |
| FMV / sh | Fair market value per share at purchase |
| Cost / sh | Your cost basis per share (after IBM discount) |
| Disc / sh | Discount per share (FMV − cost) |
| Transferred | Shares released to broker (from CSV) |
| Outstanding | Shares still in EquatePlus (Shares − Transferred) |
| Sold | Shares you have sold |
| Held | Shares in broker not yet sold (Transferred − Sold) |
| Status | Unsold / Partially Sold / Fully Sold badge |

Click any batch row to expand its **Sale History** — a sub-table of every recorded disposal with date, shares, price, proceeds, OI, and cap gain/loss.

CSV-only batches (no PDF uploaded yet) show **—** for FMV and Discount.

### Importing from EquatePlus

Click **Import** to open the import modal. Drag or browse to upload:

- **Purchase PDF** — the EquatePlus purchase confirmation PDF (provides FMV, discount rate, allocated/distributed counts)
- **Allocation CSV** — the EquatePlus allocation export CSV (provides the full list of purchase dates and shares for the year)

You can upload both together or separately. The CSV defines all purchase dates for the year; the PDF enriches the matching date with FMV and discount data. If you upload only the CSV, FMV will be blank until you import the PDF for that date.

Re-importing the same files is safe — the backend upserts (no duplicates). If a matching payslip exists (pay date = purchase date), the IBM-authoritative ESPP discount amount is pulled in automatically.

### Recording a Sale

Click **Record Sale** to log a stock disposal. The button is disabled until at least one batch with a positive held quantity and FMV data exists.

For each row in the modal:

1. **Batch** — select the purchase date you are selling from
2. **Shares** — number of shares sold
3. **Price / share** — sale price

Below the Proceeds box, **OI** (ordinary income) and **CG** (capital gain/loss) are shown live as you type — OI in gold, CG in forest/terracotta. These are informational; the server recomputes them on submit.

Click **+ Add Row** to record multiple lots in one session (same sale date). The backend rejects the submission if any row exceeds the available held quantity for that batch.

---

## Tax Protest

The **Tax Protest** feature helps you build and submit an Appraisal Review Board (ARB) protest for any owned property. Access it from a property's detail page via the **Prepare Tax Protest** button, or directly from the sidebar under **Real Estate**.

### Selecting a Property and Year

Use the **Property** and **Year** dropdowns at the top of the page to load (or create) a protest worksheet for that property and tax year. A new worksheet starts with status **Not Filed**.

### Chat Assistant

The chat panel on the right side drives the workflow. The AI assistant has access to:

- **Your property facts** — address, beds/baths, sqft, CAD assessed value, and AVM from your linked Redfin data.
- **DCAD comparable sales** — comparable properties from the county appraisal district, fetched via the **Fetch DCAD comps** tool.
- **Redfin sold comps** — recent market sale prices near your property, refreshed on demand.
- **Live web search** — the AI can search for recent sold prices and market trends via Tavily (requires `TAVILY_API_KEY` in the server environment).

Type in plain language: "What is my case strength?", "Find recent comparable sales near my address", "How should I open the hearing?" The AI responds with analysis and updates the strategy panel.

The assistant also searches **indexed supporting documents** (uploaded PDFs and photos) for relevant passages on each message. Long chat histories are summarized automatically so context stays within model limits. When you close a protest with an outcome, a short **cycle summary** is saved for reference in the next tax year.

### CAD Evidence and Supporting Documents

In the **CAD Evidence Packet** card:

- **Upload Evidence PDF** — the official DCAD evidence packet; the app parses comps for tables and indexes the full text for chat.
- **Supporting Documents** — upload additional PDFs or photos (roof damage, lot photos, repair estimates). Images are described by vision AI, then indexed like PDF text. Each file appears in a list with a delete control.

### Strategy Panel

The left panel shows the AI's structured assessment:

- **Target value** — the value the AI recommends requesting at the hearing.
- **Case strength** — a 0–100 score with a colour-coded bar (green ≥ 70, amber 40–69, red < 40).
- **Arguments** — bullet points for your strongest protest grounds.
- **Red flags** — weaknesses in the case the AI has identified.

The strategy panel is updated automatically when the AI calls `update_strategy` during a chat turn.

### DCAD Comps and Redfin Comps

You can view fetched comps in the **DCAD Comps** and **Redfin Comps** tabs below the chat. Click **Fetch DCAD comps** (or ask the AI to do it) to pull the county's own comparable pool. Redfin comps are refreshed by asking the AI or clicking the refresh button.

### Generating the ARB Evidence Packet

Once you have comps and a strategy, select a format using the **PDF / Word** toggle next to the **Generate Document** button, then click the button to download the packet.

**PDF** — a print-ready multi-page document:

- **Cover page** — property address, tax year, hearing date, valuation summary boxes (CAD assessed, AVM, target ask, savings), and the AI strategy panel.
- **DCAD comps table** — the county's own comps with your property highlighted in yellow; comps below your assessed value highlighted green.
- **Redfin sold comps table** — recent market sales near your property.
- **Horizontal bar chart** — visual comparison of $/sqft across subject and all comps (subject in blue, comps green if below subject or red if above).

**Word (.docx)** — an editable document with two sections you can hand-edit before submitting:

- **Section 1 — ARB Board Packet** (hand to the panel): valuation summary table, property facts, DCAD unequal-appraisal comps table, Redfin market-sales comps table, and the AI's key arguments as bullet points.
- **Section 2 — Protestor Reference Sheet** (keep for yourself): an oral script from the AI's strategy, a blank negotiation table (CAD Offer / Your Counter / Notes), and a quick-reference card of key facts.

Print the PDF packet and bring it to your hearing. Use the Word version when you need to hand-edit arguments or paste content into your CAD's own submission template.

### ARB Oral Script

When your protest status is set to **ARB** (formal hearing scheduled), an **ARB Oral Script** card appears on the protest page.

Click **Generate ARB Script** to have GPT-4o write a step-by-step presentation for your ARB panel, using all available evidence: the CAD evidence packet, your equity comps and their annotation notes, Redfin sold comp research notes, and your AI-derived strategy.

The script includes:

- **Negotiation Guide** — three thresholds: *Open Ask* (your first offer to the panel), *Ideal Settle*, and *Walk-Away Min* (below which you accept the panel's decision), with a brief rationale.
- **6 presentation steps** — Opening Statement, §41.41 Market Value Argument, §41.43 Unequal Appraisal Argument, Supporting Evidence, Closing Ask, and Panel Questions. Each step shows your spoken text and, where relevant, the most likely appraiser objection and your rebuttal.

Use **Copy Script** to copy the full script as plain text. Click **Regenerate** after adding more evidence or comp notes to get an updated version. The last generated script is saved to your worksheet and survives page reloads.

### Filing Deadline and CAD Portal

In the **Protest Status** section, two additional fields help you stay on top of your protest timeline:

- **Filing Deadline** — enter the county's protest filing deadline (YYYY-MM-DD). The app will send in-app and email notifications at 30, 7, and 1 day(s) before this date and before the hearing date. A **red alert banner** appears on the protest page if the deadline is within 7 days and the protest has not yet been resolved.
- **CAD Portal URL** — paste the URL of your county appraisal district's online portal. An external-link icon next to the field opens it in a new tab so you can file directly from the protest page.

### Protest Status

Use the **Status** dropdown to track progress through the workflow:

| Status | Meaning |
|--------|---------|
| Not Filed | Worksheet created, no protest submitted yet |
| Filed | Protest formally submitted to the CAD |
| Informal Pending | Informal hearing scheduled (pre-ARB settlement attempt) |
| Informal Settled | Settled before formal ARB hearing |
| ARB Scheduled | Formal ARB hearing date set |
| ARB Won | Protest succeeded — assessed value reduced |
| ARB Lost | Protest denied at the ARB level |
| Withdrawn | Protest withdrawn by owner |

---

## Categories and Rules

The **Categories** page lets you manage the expense and income taxonomy and set up auto-classification rules.

### Categories Tab

Browse the hierarchical category tree:

- Parent categories (e.g., "Housing", "Dining", "Utilities").
- Subcategories within each parent (e.g., "Dining > Restaurants", "Dining > Coffee").

You can:

- **Add custom subcategories** under any parent group (click **+ Add** in the parent row).
- **View transaction counts** — each category shows the number of transactions assigned.

Built-in categories are provided; custom categories are household-specific.

### Category Rules Tab

Define patterns that auto-classify transactions:

**Built-in rules:** Global keyword rules ship with Grove. You see them listed but cannot edit them.

**Household rules (custom):** Create rules to classify transactions by merchant description:

- **Pattern type:** "contains" (merchant name includes this text), or other operators.
- **Pattern value:** the text to match (case-insensitive, normalized).
- **Target category:** the leaf category this rule assigns.
- **Scope (optional):** money in, money out, or both.
- **Priority:** lower priority numbers are checked first; useful for override rules.

Once saved, rules auto-classify future imports. Example: a rule "contains WHOLEFDS → Groceries" will classify any merchant with "WHOLEFDS" in the name as "Groceries".

**Quick rule from transaction:** When you categorize a transaction in the ledger, the app offers to **create a classification rule** from that transaction's description. This is the fastest way to build household rules — no need to visit this page for the common case. The rule uses `contains` pattern matching on the normalized description.

**Import/Export:** Use the import/export CSV buttons to bulk-edit rules. Sample templates are provided in the repo under `fixtures/category-import/`.

---

## Budget

The **Budget** page allows you to set spending limits and track progress by category.

### Setting a Budget

1. Choose a month.
2. Click **Edit** or use the form to assign budget amounts to categories.
3. Save. The budget is stored per household per month.

### Tracking Progress

- **Progress bar** — shows total spent vs. total budgeted for the month.
- **Per-category breakdown** — table lists each budgeted category with budgeted, spent, remaining, and % used.
- **Alert colors:** Green (0-80%), amber (80-99%), red (100%+).

The **Dashboard > Budget progress** card also shows a live bar for the current month.

---

## Settings

Access via the account menu (top-right) → **Settings**.

### Profile Tab

- **Name** — your display name.
- **Avatar / initials** — optional profile picture.
- **Email** — email address (for password reset notifications).
- **Visibility** — role-based (owner, admin, member).

### Password Tab

- **Change password** — enter your current password and new password.
- **Reset a member's password** (owners/admins only) — use **Household tab** instead; see below.

### Household Tab

Manage household members and settings:

**Household settings:**

- **Monthly savings target** — slider to set a target savings goal; updates "Safe to spend" on the Dashboard.
- **Salary deposit account** — link the account where payslip deposits land (for deposit matching).
- **Large transaction threshold** — optional; flag transactions above this amount for review.
- **City / State** — household location (optional).
- **Combined gross income** — household total annual income (used for AI insights).

**Employer setup** (for payslips):

- Add employers with display name and parser profile.
- Link each employer to a salary deposit account.

**Member roster:**

- Table of household members with name, role (head/member), relationship (self/spouse/child/dependent/other).
- **Add another row** button to stage new members.
- **Save household** to persist changes.
- **Trash icon** on saved rows to delete a member. Confirm the deletion in the dialog. Optionally also delete the member's login account if they have one.

**Member login accounts:**

- Shows "✓ Has login account" or "—" for each member.
- **Create login** (owners/admins) — generates a login account with a temporary password; the member must change it on first login.
- **Reset password** (owners/admins) — generates a new temporary password and invalidates the member's current session. Share the temporary password with them out-of-band; they will be prompted to change it on next login.

### Accounts Tab

Add and manage financial accounts (banks, credit cards, investment accounts, etc.):

- **Institution** — pick from a built-in list (Chase, BOA, Discover, etc.) or add a custom institution.
- **Account type** — checking, savings, credit card, loan, mortgage, investment, retirement, health, education, cash, payslip. Also supports hierarchical subtypes (e.g., "retirement/401k_roth").
- **Account mask** — last four digits or other identifier (for display only).
- **Currency** — USD or other (defaults to USD).
- **Sub-type** — optional breakdown (e.g., "savings/high_yield" for a HYSA).
- **Memo** — optional note (e.g., "joint account").
- **Liquidity** (F-1 feature, optional) — liquid, semi-liquid, or restricted (for balance sheet enrichment).
- **Belongs to** — household or a specific member.
- **Default parser profile** — (optional) auto-detect is usually sufficient, but you can override.
- **Property ID** — (optional) if the account is a mortgage, link to a property (real estate tracking).

**Last uploaded** — timestamp of the most recent import.

**Status** — active or closed (closed accounts do not appear in import dropdowns).

### Recurring Tab

View and manage recurring payment overrides:

- **Confirmed recurring** — payments you have explicitly marked as recurring (marked with ●).
- **Dismiss** — hide a suggested recurring payment.

The Dashboard detects recurring patterns automatically; use this tab to confirm or dismiss suggestions.

### Notifications Tab

Configure how and when the app alerts you:

- **Email notifications** (optional) — alerts for large transactions, missing categories, etc.
- **In-app alerts** — badges and notifications in the app UI.
- **Frequency** — daily, weekly, or monthly.

### Family Tab

Available to owners and admins. Three subsections:

**Household Members**

Edit profile metadata for each member in the household:

- **Age** — update age manually (or leave blank if set via Date of Birth on the Profile tab).
- **Interests** — free-form tags (hobbies, activities, subjects). Used by the Family Planner agent for scheduling context. Up to 30 tags.
- **Notes** — free-form text (allergies, school details, preferences, anything useful for the agent). Up to 2,000 characters.
- Click **Save** on each card to persist changes.

**Care & Help Schedule**

Track regular and one-off care arrangements for any household member:

- **Person** — which household member this slot is for.
- **Service** — Nanny, Babysitter, Cleaner, Activity Teacher, Tutor, or Other.
- **Type** — Regular (weekly recurring), One-off (specific date), or Unavailable (block-out).
- **Day of week** (for Regular/Unavailable) or **Date** (for One-off).
- **Start / End time** — optional time window.
- **Label** — optional short description (e.g. "Regular hours").
- Click **Add entry** to save. Use the pencil icon to edit or the trash icon to delete an entry.

**Google Calendar**

Connect or disconnect your Google Calendar account. Once connected:

- **Select calendars** — check which of your Google Calendars the family planner agent should read. Leave none checked to include all accessible calendars.
- **Calendar role** — tag each calendar as *Work / personal*, *School (informational only)*, *Kid activities*, or *Other*. The agent treats *School* events as informational — e.g. a school closure is never treated as a parent being unavailable, unlike a *Work / personal* event at the same time. Role defaults to a name-based guess (a calendar named "…ISD" or "…School" defaults to School) until you set it explicitly. Click **Save selection** to persist both the calendar selection and the roles.

### Data Tab

**AI Insights history:** View historical analyses generated on the Dashboard. Useful for trend checks and comparing old advice vs. new recommendations.

### Backup Tab

**Export household (`.hfb` bundle):**

1. Click **Request export**.
2. The app generates a compressed backup of all household data (async job; you'll see a notification when done).
3. Click **Download** to save the `.hfb` file to your computer.

Keep backups in a secure, separate location (e.g., cloud storage, external drive).

**Restore from backup:**

1. Click **Choose file** and select a previously exported `.hfb` file.
2. Click **Restore**. This is **destructive** — all current household data is replaced with the backup contents.
3. After restore succeeds, you are signed out (because login tokens are invalidated).

Use restore when:

- Setting up a fresh instance and migrating data.
- You intentionally want to roll back to a prior state.

Operator details: see [ADMIN_GUIDE.md](ADMIN_GUIDE.md) §5.3; API: [API_REFERENCE.md](API_REFERENCE.md) §Export.

---

## Year-in-Review

In **February and March**, a **Year in Review** button appears on the Dashboard. Clicking it generates a personalized summary of the prior year:

- **Cash flow summary** — total income, spending, savings.
- **Spending patterns** — largest categories, month-to-month trends.
- **Recurring charges** — detected automatic payments.
- **Net worth change** — year-over-year net worth progression.
- **Insights** — narrative analysis (on first run, ~30 seconds; cached on return visits).

The review includes an AI-generated narrative summarizing financial highlights and patterns. This is the household-level view; members see personal-only summaries.

---

## Tips and Common Tasks

### Finding a Specific Transaction

1. Go to **Transactions**.
2. Use the search field to find merchant/description text.
3. Use date filters to narrow the range.
4. Use category, account, or "belongs to" filters to slice by person or type.
5. Click the transaction row to view details or edit.

### Categorizing a Batch of Old Transactions

1. Go to **Transactions > All**.
2. Check multiple rows for the same merchant or category.
3. Select a category from the bulk action bar.
4. Click **Apply category**. All selected rows are recategorized at once.

### Setting Up Auto-Classification Rules

**Option A (quick):** In the ledger, categorize a transaction manually. The app offers to **create a rule** from that description — accept to auto-classify future similar imports.

**Option B (detailed):** Go to **Categories > Rules** and manually define a rule with pattern and target category.

### Reviewing Imports

1. Upload statements via **Imports > New import**.
2. Bind each file to the correct account.
3. Click **Run import** to parse and canonicalize.
4. Go to **Transactions > Needs Review** to resolve open items.
5. Assign unknown categories, confirm/reject duplicates, pair transfers.
6. Once resolved, the import session is automatically finalized.

### Tracking Net Worth Over Time

1. Go to **Net Worth**.
2. Ensure at least one account has a balance (manual or imported).
3. Switch to the **Trend** tab.
4. Select a period (3/6/12 months, YTD, or custom).
5. (Optional) Overlay individual accounts for detailed tracking.
6. View the historical chart and summary table.

### Uploading and Reviewing Payslips

1. Go to **Payslips > + Add payslip** (or **New payslip**).
2. Upload a PDF.
3. Select employee and employer.
4. Review extracted line items. Edit if the parser misread.
5. Click **Save**.
6. On the Payslips list, view YTD summaries and compare across pay periods.

### Resetting a Member's Password

1. Go to **Settings > Household**.
2. Find the member's row.
3. Click **Reset password** (owners/admins only).
4. A temporary password is generated. Share it with the member via a secure channel.
5. On next login, they are forced to change it.

### Exporting and Restoring Backup

**Export:**

1. Go to **Settings > Data > Backup**.
2. Click **Request export**. Wait for the async job to complete.
3. Click **Download** to save the `.hfb` file.

**Restore:**

1. Go to **Settings > Data > Backup** on a fresh or target instance.
2. Click **Choose file** and select the `.hfb` file.
3. Click **Restore**. You will be signed out after the destructive restore completes.

---

## Troubleshooting

### Transactions Not Appearing After Import

Check the **Transactions > Needs Review** tab. Open items may be flagged as duplicates, with unknown categories, or for transfer pairing. Resolve or dismiss them to move them to the ledger.

### Balance Not Matching Statement

Go to **Net Worth** and check:

1. Is the account balance up-to-date? Update manually if needed.
2. Are all transactions imported? Search the ledger for the statement date range.
3. Is there a reconciliation mismatch? Check import warnings during canonicalize.

For detailed diagnosis, see [API_REFERENCE.md](API_REFERENCE.md) §Balance Sheet.

### Parser Failed or Misread Data

1. Go to **Imports > [session]**.
2. Check the parse summary for errors or warnings.
3. If the parser misread, you can manually fix individual line items in the canonicalize review step.
4. If a file is unsupported, contact your operator to add a new parser profile.

### Forgot Password

Click **Forgot password?** on the login page. An administrator can reset your password via **Settings > Household > Reset password** (members) or use the password reset flow.

### Session Expired

If you are signed out unexpectedly, go back to the login page. This can happen if:

- Your password was changed (old tokens invalidated immediately).
- The server restarted.
- Your session timed out.

Simply log in again.

---

## Additional Resources

| Topic | Document |
|-------|----------|
| Balance Sheet API & behavior | [API_REFERENCE.md](API_REFERENCE.md) §Balance Sheet |
| All API routes | [API_REFERENCE.md](API_REFERENCE.md) |
| Payslip design & limitations | [PRD_AND_CRS.md](PRD_AND_CRS.md) §3.5 |
| Category classification logic | [ADMIN_GUIDE.md](ADMIN_GUIDE.md) §6 |
| All API endpoints (machine-readable) | [openapi/openapi.yaml](../openapi/openapi.yaml) |
| Change history & release notes | [CHANGE_HISTORY.md](CHANGE_HISTORY.md) |
| Environment variables & logging | [ADMIN_GUIDE.md](ADMIN_GUIDE.md) §4 |
| Installation & server setup | [ADMIN_GUIDE.md](ADMIN_GUIDE.md) §2–3 |
| Backup & restore API | [API_REFERENCE.md](API_REFERENCE.md) §Export |
