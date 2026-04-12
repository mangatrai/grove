# Change history (CR, UX, fixes, PRD notes)

**Purpose:** Append-only log of **product tweaks**, **design fixes**, **engineering fixes**, and **explicit deviations** from the PRD / original design so future work (and AI sessions) can recover **why** something looks or behaves a certain way.

**Conventions**

| Prefix | Use for |
|--------|---------|
| **CR-** | Change request — explicit user/product direction (“make it do X”). |
| **UX-** | Design / UX polish — layout, visuals, affordances (not always a bug). |
| **FIX-** | Bug or correctness fix (backend, migrations, tests). |
| **DB-** | Schema / migration / seed semantics worth remembering. |
| **PRD-** | Documented deviation from historical PRD / backlog intent — *by design* after decision (archived: `docs/archive/FINANCE_APP_PRD.md`). |

**GitHub issues:** For work also tracked on GitHub, add a **`GitHub:`** line on the entry with links to the issue(s). Repo: **`https://github.com/mangatrai/household-finance-app`**. When a fix ships, **close or update** the issue (and adjust this entry if the scope changed).

Entries are **newest-first** within each calendar period. IDs are stable; do not renumber.

---

## 2026-04-11

### CR-077 — Household category rules expansion (live statement patterns)
- **Type:** CR / Data
- **What:** Appended 14 new rules to `fixtures/category-import/category-rules-house.csv` based on patterns from live statements not covered by the 120 global builtin rules. Rules are grouped by category:
  - **Groceries** (ethnic/specialty chains): `INDIA BAZAAR`, `PATEL BROTHERS`, `SWADESHI PLAZA`, `HARELI FRESH MARKET`, `PY *HARELI`, `TOM THUMB` → Shopping > Groceries
  - **EV charging**: `TESLA SUPERCHARGER` → Mobility > Fuel (priority 40, high confidence — specific enough)
  - **Credit card autopay/cashback**: `DIRECTPAY FULL BALANCE` → Transfers > Transfers out (Discover DirectPay); `CASHBACK BONUS REDEMPTION` → Income > Refunds (Discover cashback payout)
  - **FSA/benefits**: `ADVANTAGE FLEX T` → Healthcare > FSA / Benefits
  - **Retail**: `FIVE BELOW` → Shopping > General merchandise
  - **Indian/Asian restaurants**: `GWALIA SWEETS`, `SIMPLY SOUTH`, `ASIAN POT` → Food > Dining out
- **Skipped (already in house rules):** Wealthfront transfers, Goldman Sachs, FRONTIER, Fyle, NAVIA BENEFIT, PROTECTIVE LIFE, CITYOFLEWISVILLE, Fundrise rows, PRIMROSE SCHOOL
- **Skipped (covered by global builtins):** kroger, walmart, costco, whole foods, target, starbucks, shell/exxon/chevron, uber/lyft, mcdonald, irs
- **Files:** `fixtures/category-import/category-rules-house.csv` (88 → 102 data rows, +14 rules with blank separators).

### CR-075 — Settings: initial balance on account create, retirement account type, institution catalog
- **Type:** CR / Backend / UX
- **What:** Three related improvements to account setup.
  1. **Initial balance on account creation:** Settings → Accounts form now shows two optional fields when adding a new account: "Starting balance" (number) and "Balance as of" (date, defaults to today). On save, if a non-zero balance is provided, `upsertManualBalanceSnapshot` is called to create a manual balance snapshot — the same mechanism used by the Net Worth page. Fields are hidden when editing an existing account (existing balance data is managed via Net Worth). Backend: `accountUpsertSchema` extended with `initialBalance: number | null` and `initialBalanceDate: string | null` (YYYY-MM-DD); `POST /imports/accounts` handler calls `upsertManualBalanceSnapshot` after account creation if non-null.
  2. **Retirement account type:** New `'retirement'` type in `financial_account` (migration `0009`). Covers 401K, IRA, pension accounts. Added to the `accountUpsertSchema` enum and the Settings → Accounts type dropdown as "Retirement (401K / IRA / Pension)".
  3. **Institution catalog expansion:** Added 8 new institutions (alphabetically sorted) to both `frontend/src/import/institutionCatalog.ts` and `backend/src/modules/imports/institution-catalog.ts`: Betterment, Coinbase, E*TRADE, Fundrise, Robinhood, T. Rowe Price, Vanguard, Wealthfront.
- **Why:** Users adding investment, retirement, or crypto accounts had no institutions to pick and no account type for retirement accounts. Starting balance lets new accounts contribute to net worth immediately without needing to import a statement first.
- **Files:** `backend/db/migrations_pg/0009_account_type_retirement.sql` (new), `imports.routes.ts`, `institution-catalog.ts` (backend + frontend), `SettingsPage.tsx`.

### CR-074 — FITID dedup + OFX ledger balance auto-snapshot
- **Type:** CR / Backend / UX
- **What:** Two related improvements to the OFX import pipeline.
  1. **FITID-based deduplication:** Added `reference_id TEXT` column to `transaction_canonical` (migration `0008`) with a partial unique index `(account_id, reference_id) WHERE reference_id IS NOT NULL`. During canonical ingest, if the raw payload carries a `reference_id` (FITID from OFX), a FITID check runs *before* the fingerprint check: if the same `(account_id, reference_id)` already exists in `transaction_canonical`, the row is counted as a duplicate and skipped. A `seenReferenceIdsThisRun` set catches within-batch duplicates. Non-OFX rows (no FITID) are unaffected — the partial index allows unlimited `NULL` reference_ids.
  2. **OFX LEDGERBAL auto-snapshot:** Both OFX 1.x and OFX 2.x parsers now extract `<LEDGERBAL><BALAMT>` and `<LEDGERBAL><DTASOF>`. These fields are stored in `confidence_summary.ofxMeta` at upload time and returned via `GET /imports/sessions/:id/files/:fileId/ofx-suggestion` alongside the account match. During parse (`POST /imports/sessions/:id/parse`), if the OFX file has a non-null ledger balance with a valid ISO date, `upsertImportBalanceSnapshotFromStatement` is called to persist a balance snapshot (source = `ofx_transactions`) — same pathway as BoA CSV/e-statement balance capture. Frontend shows balance info in the OFX account hint: "Balance as of YYYY-MM-DD: $X,XXX.XX (from OFX ledger balance — auto-saved to net worth)".
- **Why:** Without FITID dedup, re-importing an OFX file after minor description edits could insert duplicates (fingerprint = SHA256 of normalised description). FITID is the authoritative dedup key for OFX files. LEDGERBAL is a free balance anchor in every Chase QFX tested — parsing it avoids a manual net-worth entry after each statement import.
- **Files:** `backend/db/migrations_pg/0008_canonical_reference_id.sql` (new), `canonical-ingest.service.ts`, `ofx-parser.ts`, `ofx-account-match.service.ts`, `import-parser.service.ts`, `imports.routes.ts`, `boa-checking-savings-csv.ts` (source union extended), `ImportWorkspacePage.tsx`.
- **Tests added:** `backend/tests/ofx-parser.test.ts` — 6 new tests for OFX 1.x and 2.x LEDGERBAL parsing (balance value, date conversion, null when absent).

### UX-073 — Replace all window.confirm/window.prompt with in-app dialogs
- **Type:** UX / FIX
- **What:** `window.confirm` in `PayslipsPage` and `PayslipDetailPage` (payslip delete) replaced with `ConfirmDialog` (already used throughout the rest of the app). `window.prompt` in `ImportWorkspacePage` for "Add institution…" replaced with an inline input row: click "Add institution…" → text input + Add/Cancel buttons appear; Enter submits, Escape cancels; new name saved via `POST /imports/institutions/custom`, catalog reloaded, value auto-selected. Inline create-account form layout also fixed from `flex+alignItems:flex-end` (staggered when Institution column was taller) to CSS grid so all labels/inputs align on the same baseline.
- **Why:** `window.confirm`/`window.prompt` show browser-native "localhost:3000 says" dialogs — visually inconsistent with the rest of the app. `ConfirmDialog` was already the app standard for confirmations; it just wasn't wired to payslip delete or institution add.
- **Files:** `PayslipsPage.tsx`, `PayslipDetailPage.tsx`, `ImportWorkspacePage.tsx`.

### FIX-072 — OFX import: Run Import disabled after account selection + institution text box
- **Type:** FIX / UX
- **What:** Two bugs in the CR-071 OFX import flow.
  1. **Run Import stays disabled after account selection:** `inferParserProfile` did not handle `.ofx` / `.qfx` / `.qbo` extensions, so `onAccountChange` inferred `null`, set `profileId: ""`, and skipped `persistBinding`. The server-side `financial_account_id` was never saved, so `allFilesBound` remained false and "Run import" stayed disabled. Fix: added OFX extension check at the top of `inferParserProfile` (before institution checks) returning `"ofx_transactions"`. Now `onAccountChange` calls `persistBinding` correctly for OFX files — same path as CSV/PDF.
  2. **Institution field was a free-text input:** The inline create-account form inside the OFX file table row used a plain `<input>` for institution. This let users type anything, producing inconsistent names ("Chase", "chase", "CHASE"). Fix: replaced with `HierarchicalSearchPicker` loaded lazily from `GET /imports/institutions` (same catalog as Settings → Accounts). "Add institution…" button calls `POST /imports/institutions/custom` and refreshes the picker. Catalog loads once when the form first opens (`ofxCreateAccountFileId` state transitions from null).
- **Why:** "Run Import" being disabled after following the new-account creation flow was a blocking regression. Free-text institution entry was creating naming inconsistencies across the household — same issue that motivated the picker in Settings.
- **Tests added:** `frontend/src/import/inferParserProfile.test.ts` — 4 new cases for `.ofx` / `.qfx` / `.qbo` extension inference. `backend/tests/ofx-parser.test.ts` — new test file covering OFX 1.x credit card (Chase QFX style), OFX 1.x checking, and OFX 2.x XML: transaction count, FITID → `reference_id`, date conversion, signed amounts, description join, account type detection, institution suppression for short/numeric ORG codes.
- **Files:** `frontend/src/import/inferParserProfile.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/import/inferParserProfile.test.ts`, `backend/tests/ofx-parser.test.ts`.

### DOC-068 — Hosting / home lab / $0 opex context
- **Type:** DOC
- **What:** New [`HOSTING_OPTIONS_AND_HOME_LAB.md`](HOSTING_OPTIONS_AND_HOME_LAB.md) — maintainer constraints (opex/capex), Pi vs cloud free tiers, Koyeb/OCI/AWS pointers, backup pattern (pg_dump, encryption, local + off-site, retention), hardware ≤ ~$100 notes; cross-links from [`CLAUDE.md`](../CLAUDE.md) and [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md).
- **Why:** Preserve hosting and backup discussion so future deploy decisions stay aligned.

### CR-071 — OFX/QFX/QBO parser + streamlined import confirm flow + payslip delete
- **Type:** CR / Backend / UX
- **What:** Three related changes.
  1. **OFX/QFX/QBO parser (`ofx_transactions` profile):** New parser `backend/src/modules/imports/profiles/ofx-parser.ts` handles both OFX 1.x (SGML-like unclosed leaf tags) and OFX 2.x (proper XML, via cheerio). Parses: FITID → `reference_id` (stronger dedup than fingerprint), DTPOSTED → ISO date, TRNAMT → amount (signed decimal), NAME + MEMO → description. Also extracts account header: ACCTID, ACCTTYPE, BANKID, FI/ORG. Profile ID `ofx_transactions` added to `PARSER_PROFILE_IDS`. Handles `.ofx`, `.qfx`, `.qbo` extensions.
  2. **Streamlined OFX import flow:** When an OFX/QFX/QBO file is uploaded, `persistSessionFiles` auto-detects the extension, sets `parser_profile_id = 'ofx_transactions'`, reads the account header, and stores it in `confidence_summary`. New service `ofx-account-match.service.ts` matches ACCTID last-4 against `financial_account.account_mask`. New endpoints: `GET /imports/sessions/:id/files/:fileId/ofx-suggestion` (returns matched account or null + account info), `POST /imports/sessions/:id/ofx-confirm` (bind + parse + canonicalize in one call). Frontend shows a dedicated **OFX / QFX / QBO — confirm account & import** card for any unbound OFX files: account picker pre-populated with suggestion, belongs-to picker, inline **Create account** form when no match, **Confirm & import** button. Non-OFX files keep the existing bind → Run import flow.
  3. **Payslip delete:** `DELETE /payslips/:id` backend endpoint. `deletePayslipSnapshotForHousehold` in `payslip.service.ts`. Delete button in `PayslipsPage` (list row) and `PayslipDetailPage` (header, navigates back on success). Uses `window.confirm` for confirmation.
- **Why:** OFX is a widely-supported open standard (QFX = OFX + Quicken header, QBO = OFX + QuickBooks header — one parser handles all three). FITID from OFX gives stronger deduplication than fingerprint alone. Streamlined import flow reduces required steps from Upload → Bind → Parse → Canonicalize → Undo → Finalize to Upload → Confirm → (Undo →) Finalize. Payslip delete was missing — no way to remove erroneous imports.
- **Future backlog:** CSV auto-detection from column headers (analogous to OFX auto-detection from extension) — not implemented in this CR; CSV stays with manual profile selection.
- **Files:** `ofx-parser.ts` (new), `ofx-account-match.service.ts` (new), `profile-ids.ts`, `import-parser.service.ts`, `import-session.service.ts`, `imports.routes.ts`, `payslip.service.ts`, `payslip.routes.ts`, `ImportWorkspacePage.tsx`, `PayslipsPage.tsx`, `PayslipDetailPage.tsx`.

## 2026-04-10

### CR-070 — Trash (soft delete) + remove transfer_ambiguity from Needs Review
- **Type:** CR / Schema / UX
- **What:** Three related changes shipped together.
  1. **Trash mechanism:** `transaction_canonical.status` gains a new valid value `'trashed'` (migration `0007`). Trashed rows are excluded from all reports and ledger views by a default `status != 'trashed'` filter added to `ledgerFilterClause`. New API: `PATCH /transactions/:id { status: "trashed" }` (soft-delete), `PATCH ... { status: "posted" }` (restore), `DELETE /transactions/:id` (hard delete, only when trashed), `POST /bulk-trash`, `POST /bulk-restore`, `POST /bulk-delete`. Frontend: new **Trash** tab (URL: `trashOnly=true`) with per-row Restore + Delete permanently buttons, select-all, and bulk bar.
  2. **Transfer ambiguity removed from Needs Review:** `transfer_ambiguity` type removed from `NEEDS_REVIEW_PREDICATE`, `OPEN_REVIEW_ITEMS_SUBQUERY`, `buildReviewReasons`, and the frontend resolution type filter. Transfer flags no longer surface to the user in Needs Review — they were generating false noise since both sides of an internal transfer net to zero in whole-household reporting.
  3. **Cash flow report fix:** `transferReportingExclusionClause` no longer hides rows with *suspected* (open `transfer_ambiguity`) flags — only confirmed transfer pairs (`transfer_group_id IS NOT NULL`) are excluded. Hiding suspected rows was silently dropping real expenses from reports.
- **Why:** (1) Users needed a way to remove clearly wrong/duplicate transactions without losing history. (2) Transfer ambiguity flags were confusing — they added items to Needs Review that the user couldn't meaningfully act on. (3) The suspected-transfer reporting exclusion was hiding real expenses.
- **Schema:** `backend/db/migrations_pg/0007_transaction_canonical_trashed_status.sql` — alters CHECK constraint to include `'trashed'`.
- **Files:** `ledger.service.ts` (trash functions + filter), `ledger.routes.ts` (new routes), `cash-summary.service.ts` (fix exclusion clause), `TransactionsPage.tsx` (Trash tab + row actions), migration `0007`.

### CR-069 — Simplify Needs Review: eliminate unknown_category resolution items
- **Type:** CR / UX / Backend
- **What:** Removed the dual-tracking problem where a transaction could have a category assigned yet still appear in Needs Review because a lingering `unknown_category` resolution_item existed. **Single source of truth: `category_id IS NULL` is sufficient.** Changes: (1) `canonical-ingest.service.ts` no longer creates `unknown_category` resolution_items. (2) `ledger.service.ts` `NEEDS_REVIEW_PREDICATE` drops `unknown_category` from the type filter; `buildReviewReasons()` updated accordingly. (3) `createManualCanonicalTransaction` no longer inserts `unknown_category` items. (4) `category-recategorize.service.ts` closes any lingering old `unknown_category` items when a rule match reassigns a category. (5) `ledger.routes.ts` removes `unknown_category` from `LEDGER_RESOLUTION_TYPES` and adds `POST /bulk-category` route. (6) `ledger.service.ts` adds `bulkUpdateCategory()`. (7) `TransactionsPage.tsx`: "Unknown category only" quick filter link removed; bulk bar simplified to a category picker + **Apply category** + conditional **Resolve flags (N)** button (for transfer/duplicate flags only); `openFlagCountInSelection` memo replaces two separate memos.
- **Why:** Adding a rule and running Re-apply would fix `category_id` but the `unknown_category` resolution_item remained open, so the transaction stayed in Needs Review — confusing and incorrect. The new model: Needs Review = uncategorized (`category_id IS NULL`) **or** open transfer/duplicate flag. Once a category is assigned via any path (manual, bulk, rule re-apply), the row self-heals out of Needs Review.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/src/modules/ledger/ledger.service.ts`, `backend/src/modules/ledger/ledger.routes.ts`, `backend/src/modules/category/category-recategorize.service.ts`, `frontend/src/pages/TransactionsPage.tsx`.

### CR-068 — Payslip detail: bank deposit match section
- **Type:** CR
- **What:** `GET /payslips/:id` now appends a `matchedDeposits` array to the response. The backend (`payslip.service.ts: findMatchedDeposits`) searches `transaction_canonical` for `credit` rows within ±3 days of `pay_date` whose `amount` is within 1% (min $0.50) of `net_pay_current`. If the payslip is person-scoped and that person has a `salary_deposit_financial_account_id` configured on their `person_profile`, the search is restricted to that account; otherwise all household accounts are searched. Up to 5 candidates are returned, closest amount match first. `PayslipDetailPage.tsx` shows a new **Bank deposit** card (between Period and Amounts) with a table of matched transactions and a **View** link that opens `/transactions` pre-filtered to the account and ±3-day window; if no match is found a muted "No matching deposit found" note is shown. The card is suppressed entirely when `pay_date` or `net_pay_current` is null.
- **Why:** Close the loop between employer-reported net pay and the actual deposit in the bank ledger — the most requested payslip feature after manual entry shipped. No schema changes required; uses existing `salary_deposit_financial_account_id` on `person_profile`.
- **Files:** `backend/src/modules/payslip/payslip.service.ts` (new `MatchedDeposit` type + `findMatchedDeposits`), `backend/src/modules/payslip/payslip.routes.ts` (`GET /:id` enrichment), `frontend/src/payslip/types.ts` (`MatchedDeposit` type + `matchedDeposits` field), `frontend/src/pages/PayslipDetailPage.tsx` (Bank deposit card).

### FIX-067 — Net worth: remove useBlocker under BrowserRouter (blank page)
- **Type:** FIX / UX
- **What:** **`useBlocker`** only works with a **data router** (`createBrowserRouter` + `RouterProvider`). This app uses **`BrowserRouter`**, so the hook threw on `/net-worth` and the page rendered blank. Removed the in-app navigation blocker dialog; **`beforeunload`** remains for tab close/refresh when a row edit is dirty; added a short on-page hint when edits are unsaved.
- **Why:** Restore Net worth; SPA navigations are not blocked without migrating the shell to a data router.
- **Files:** [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx).

### UX-066 — Net worth balance edit UX + payslip list trim + backlog alignment
- **Type:** UX / DOC
- **What:** **Net worth** page wrapper **`net-worth-page`**; balance sheet **Snapshot date** copy; bulk re-date in **details**; **pencil** icon for row edit; **`useBlocker`** + **`beforeunload`** when unsaved balance edits; **Saved stubs** table columns reduced (period start/end, gross, net, View). **Manual payslip:** Employer + Belongs-to on one row; amounts table header **Description**. **Import / Transactions:** **`import-workspace-page`** / **`transactions-page__control-band`** spacing hooks. **`BALANCE_SHEET_BACKLOG.md`** updated for **CR-064**/**UX-065**; **`PAYSLIP_V1.md`** clarifies **PATCH** vs read-only detail UI.
- **Why:** Less redundant navigation and clearer snapshot semantics; safer navigation away from dirty edits; accurate backlog story.
- **Files:** [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`PayslipsPage.tsx`](frontend/src/pages/PayslipsPage.tsx), [`PayslipManualPage.tsx`](frontend/src/pages/PayslipManualPage.tsx), [`ImportWorkspacePage.tsx`](frontend/src/pages/ImportWorkspacePage.tsx), [`TransactionsPage.tsx`](frontend/src/pages/TransactionsPage.tsx), [`index.css`](frontend/src/index.css), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md), [`PAYSLIP_V1.md`](docs/PAYSLIP_V1.md).

### UX-065 — Net worth + manual payslip layout polish
- **Type:** UX / DOC
- **What:** **Net worth** — trend controls grouped; **period summary** as a **ledger-table** with **Ledger** links (first/last sample = chart endpoints); **Reload** removed from the toolbar and replaced by **Retry load** when a fetch fails. **Manual payslip** — pay period and **Current / YTD** amounts in aligned **ledger-table** rows instead of a wide grid.
- **Why:** Easier scanning on large screens; clearer relationship between chart samples and ledger drill-downs; less redundant chrome.
- **Files:** [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`PayslipManualPage.tsx`](frontend/src/pages/PayslipManualPage.tsx), [`index.css`](frontend/src/index.css), [`USER_GUIDE.md`](docs/USER_GUIDE.md).

### CR-064 — Net worth v2 UI + balance sheet API filters + manual payslip fields
- **Type:** CR / API / UX / DOC / TEST
- **What:** **`GET /reports/balance-sheet`** and **`/history`** accept optional **`ownerScope`** / **`ownerPersonProfileId`** (belongs-to). **`/history`** accepts **`accountIds`** (comma-separated, max 8) and returns optional **`accounts`** slices per point. **Net worth** page: period presets, merged start/end summary, single signed balance table, inline edit + bulk as-of, belongs-to filter, chart account overlays, transaction drill-downs (including **`fileId`** deep link). **Manual payslip** form: Current/YTD grid, pre/post tax and employee taxes YTD, template under Advanced when no employers. **Transactions** honors **`fileId`** query param when loading the ledger.
- **Why:** One place to understand net worth, optional member-scoped views, and full manual payslip parity with API fields.
- **Files:** [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`reports.routes.ts`](backend/src/modules/reports/reports.routes.ts), [`app.test.ts`](backend/tests/app.test.ts), [`payslip-upload.test.ts`](backend/tests/payslip-upload.test.ts), [`ibm-payslip-pdf.ts`](backend/src/modules/payslip/profiles/ibm-payslip-pdf.ts), [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`TransactionsPage.tsx`](frontend/src/pages/TransactionsPage.tsx), [`PayslipManualPage.tsx`](frontend/src/pages/PayslipManualPage.tsx), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`openapi.yaml`](openapi/openapi.yaml), [`USER_GUIDE.md`](docs/USER_GUIDE.md).

## 2026-04-09

### DOC-063 — Operator docs: net worth in user guide + API index + CLAUDE reports/schema
- **Type:** DOC
- **What:** [`USER_GUIDE.md`](docs/USER_GUIDE.md) **Net worth** section; [`API_INDEX.md`](docs/API_INDEX.md) links [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md); [`CLAUDE.md`](CLAUDE.md) **`reports/`** module row and **`account_balance_snapshot`** in schema highlights.
- **Why:** Keep day-to-day and contributor docs aligned with shipped net worth / history / import snapshots.

### CR-062 — Net worth trend chart + GET /reports/balance-sheet/history
- **Type:** CR / API / UX / DOC
- **What:** **`GET /reports/balance-sheet/history`** with **`from`**, **`to`**, **`interval`** (`month` \| `week` \| `day`); samples up to **120** `asOf` dates using existing **`getBalanceSheet`** resolution. **Net worth** page **Trend** card (Recharts: assets, liabilities, net).
- **Why:** Ship charts/history from balance sheet backlog without new balance semantics.
- **Files:** [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`reports.routes.ts`](backend/src/modules/reports/reports.routes.ts), [`app.test.ts`](backend/tests/app.test.ts), [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md), [`openapi.yaml`](openapi/openapi.yaml).

### CR-061 — Import balance snapshots: persist on parse + prefer in balance sheet
- **Type:** CR / DB / API / DOC
- **What:** Migration **`0006`** partial unique index on import snapshots; bank parse upserts **`source = import`** `account_balance_snapshot` rows when **`statementBalances.ending`** and **`asOfEnd`** (`YYYY-MM-DD`) are present; **`GET /reports/balance-sheet`** resolves **manual → persisted import → confidence_summary hint**.
- **Why:** Normalized balances for net worth history and stable re-parse behavior.
- **Files:** [`0006_account_balance_import_unique.sql`](backend/db/migrations_pg/0006_account_balance_import_unique.sql), [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`import-parser.service.ts`](backend/src/modules/imports/import-parser.service.ts), [`app.test.ts`](backend/tests/app.test.ts), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md).

### UX-060 — Payslips list: Belongs-to label (replaces “View scope”)
- **Type:** UX / copy
- **What:** Payslip list filter uses the **Belongs-to** label and hint text aligned with **Transactions**; placeholder **All household activity**. No API or query changes.
- **Why:** “View scope” did not match household vs member semantics; consistent wording across ledger and payslip screens.
- **Files:** [`PayslipsPage.tsx`](frontend/src/pages/PayslipsPage.tsx), [`USER_GUIDE.md`](docs/USER_GUIDE.md).

### FIX-059 — Profile: persist per-employer salary deposit account + restore inference (replaces reverted WIP)
- **Type:** FIX / API / UX
- **What:** **`employers_json`** stores optional **`salaryDepositFinancialAccountId`** per employer; **`PATCH /household/profile`** validates accounts and syncs legacy **`person_profile.salary_deposit_financial_account_id`** from the first employer when the top-level field is omitted. **Settings → Profile** binds salary account **per employer row** (was incorrectly sharing one `select` across rows). **`inferParserProfile`** treats a checking account as the payslip target when it matches **any** employer’s salary account, not only the legacy column.
- **Why:** Uncommitted local fixes were dropped by a mistaken `git checkout --` during another commit; behavior matches existing API test intent (`per-employer salary deposit accounts`).
- **Files:** [`household.types.ts`](backend/src/modules/household/household.types.ts), [`household.service.ts`](backend/src/modules/household/household.service.ts), [`SettingsPage.tsx`](frontend/src/pages/SettingsPage.tsx), [`inferParserProfile.ts`](frontend/src/import/inferParserProfile.ts), [`ImportWorkspacePage.tsx`](frontend/src/pages/ImportWorkspacePage.tsx), [`inferParserProfile.test.ts`](frontend/src/import/inferParserProfile.test.ts).

### FIX-058 — Payslip mapper: infer OTHER DEDUCTION post-tax rows from line name when raw_section is blank
- **Type:** FIX / test / prompt
- **What:** **`sumOtherDeductionsMarkedAsPostTax`** also matches **`name` / `description`** with **`other deduction`**. Regression test + LLM prompt line clarifying **`line_items.other_deductions`** naming when **`raw_section`** is missing.
- **Why:** Epic 4 — some extractions omit **`raw_section`** on miscellaneous rows; post-tax totals were dropped.
- **Files:** [`payslip-canonical-map.ts`](backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts), [`extract-payslip-llm.ts`](backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts), [`payslip-canonical-map.test.ts`](backend/tests/payslip-canonical-map.test.ts).

### CR-057 — Net worth v1: account_balance_snapshot + balance-sheet APIs + /net-worth UI
- **Type:** CR / DB / API / UX / DOC
- **What:** Migration **`account_balance_snapshot`**; **`GET /reports/balance-sheet`**, **`POST/PATCH /reports/balance-sheet/manual`**; **Net worth** page and sidebar nav. Manual balances override import **`statementBalances`** hints per account.
- **Why:** Epic 2 minimal balance sheet — assets vs liabilities with manual entry; charts/history deferred in [`BALANCE_SHEET_BACKLOG.md`](BALANCE_SHEET_BACKLOG.md).
- **Files:** [`0005_account_balance_snapshot.sql`](backend/db/migrations_pg/0005_account_balance_snapshot.sql), [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`reports.routes.ts`](backend/src/modules/reports/reports.routes.ts), [`app.test.ts`](backend/tests/app.test.ts), [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`App.tsx`](frontend/src/App.tsx), [`AppSidebar.tsx`](frontend/src/layout/AppSidebar.tsx), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md), [`openapi.yaml`](openapi/openapi.yaml).

### CR-056 — Manual payslip: POST /payslips/manual + /payslips/new form
- **Type:** CR / API / UX / DOC
- **What:** **`POST /payslips/manual`** inserts **`payslip_snapshot`** with **`Manual entry`** file name and a **synthetic SHA-256 checksum** (`manual:` + UUID). **`/payslips/new`** form; list links **Add manually**. **`PATCH /payslips/:id`** remains the edit path.
- **Why:** Epic 1 / PAYSLIP_V1 §7 — income history without a parseable PDF.
- **Files:** [`payslip.service.ts`](backend/src/modules/payslip/payslip.service.ts), [`payslip.routes.ts`](backend/src/modules/payslip/payslip.routes.ts), [`payslip-upload.test.ts`](backend/tests/payslip-upload.test.ts), [`PayslipManualPage.tsx`](frontend/src/pages/PayslipManualPage.tsx), [`PayslipsPage.tsx`](frontend/src/pages/PayslipsPage.tsx), [`App.tsx`](frontend/src/App.tsx), [`PAYSLIP_V1.md`](docs/PAYSLIP_V1.md), [`openapi.yaml`](openapi/openapi.yaml).

### CR-055 — Cash summary: configurable custom range cap + maxCustomRangeDays in API; Dashboard alignment
- **Type:** CR / API / UX / DOC
- **What:** **`CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS`** env (default **1096**). **`GET /reports/cash-summary`** returns **`maxCustomRangeDays`** and enforces the limit. **Home** dashboard uses it for client-side validation and hint text.
- **Why:** Epic 7 follow-up — prior **366**-day cap was tight for multi-year analysis.
- **Files:** [`env.ts`](backend/src/config/env.ts), [`cash-summary.service.ts`](backend/src/modules/reports/cash-summary.service.ts), [`DashboardPage.tsx`](frontend/src/pages/DashboardPage.tsx), [`docs/API_CASH_SUMMARY.md`](docs/API_CASH_SUMMARY.md), [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md), [`.env.example`](.env.example), [`app.test.ts`](backend/tests/app.test.ts).

### CR-054 — Ledger list: expose classificationMeta; Transactions UI classification hint
- **Type:** API / UX / DOC
- **What:** **`GET /transactions`** responses include **`classificationMeta`** (rules audit: source, ruleId, confidence, reason). **Transactions** category column shows a short hint + link to **Category rules** for household rules.
- **Why:** Epic 5.1 explainability — data was already stored on **`transaction_canonical`**; list API omitted it.
- **Files:** [`ledger.service.ts`](backend/src/modules/ledger/ledger.service.ts), [`TransactionsPage.tsx`](frontend/src/pages/TransactionsPage.tsx), [`docs/API_LEDGER.md`](docs/API_LEDGER.md), [`backend/tests/app.test.ts`](backend/tests/app.test.ts).

### DOC-053 — Align async-canonicalize design note with current import behavior; deprioritize transfer-matcher follow-up in checkpoint
- **Type:** DOC
- **What:** **`docs/CANONICALIZE_ASYNC.md`** — added **Supersession / current reality**: payslip LLM uses **`reconcile-payslip-async`**; **`POST .../canonicalize`** remains synchronous; canonicalize does **not** call OpenAI (rules/fingerprinting only). Problem statement updated to large CSV/CPU/proxy timeouts. **`docs/archive/CHECKPOINT.md`** — **Good next picks**, **Sensible next steps**, and **Transfer matcher** table row now describe Epic 5.2 as **optional / low priority** if mispairing appears; classification scales via **household rules**.
- **Why:** Docs still implied “canonicalize + OpenAI” and mandatory post-MVP transfer tuning; product reality differs after payslip async reconcile and rules-first classification.

### CR-052 — Payslips: IBM OpenAI vision pipeline (parity with Deloitte) + Deloitte canonical/prompt hardening
- **Type:** CR / DOC / API
- **What:** **`ibm_pay_contributions_pdf`** now uses the **same** OpenAI vision + JSON-schema + Zod path as Deloitte (`extractPayslipFromPdf` → `mapCanonicalExtractToPersist` → **`payslip_snapshot`** with **canonical + hybrid** columns). Extraction accepts **`pdfPath`** (Import uses **`stored_path`** to avoid an extra temp copy) or **`pdfBuffer`** (upload). Missing **`OPENAI_API_KEY`** returns structured **`422`** on upload and marks import files failed (aligned with Deloitte). Legacy IBM regex parser (**`parseIbmPayslipPdf`**) remains in repo for tests/sniffing but is **not** the primary parse entry point. **Deloitte:** system prompt tightened for two-column Current/YTD grouping and **`OTHER DEDUCTION(S)`** semantics; canonical mapper derives post-tax from **`line_items.post_tax_deductions`** with a **narrow fallback** that sums **`line_items.other_deductions`** rows whose **`raw_section`** matches **`OTHER DEDUCTION(S)`** when post-tax current/YTD is still null (handles occasional LLM mis-bucketing). Follow-on prompt tweaks for mixed row shapes (YTD-only vs Current+YTD) in the same section.
- **Why:** IBM image-based or irregular PDF text made regex extraction unreliable; one extraction pipeline improves consistency and stored **`canonical_extract_json`**. Deloitte stubs vary by row layout; mapper + prompt reduce missing YTD without reintroducing broad `other_deductions` → post-tax coalescing.
- **Files:** `backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts`, `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts`, `backend/src/modules/payslip/payslip-parse.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/tests/payslip-canonical-map.test.ts`, `backend/tests/payslip-upload.test.ts`, `docs/PAYSLIP_V1.md`, `docs/API_IMPORT_SESSIONS.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/archive/CHECKPOINT.md`, `docs/archive/MVP_BACKLOG.md`.

## 2026-04-08

### CR-051 — Deloitte payslips: replace Unstructured Jobs with async OpenAI LLM extract + hybrid snapshot storage
- **Type:** CR / DB / API / UX / DOC
- **What:** Import `deloitte_payslip_pdf` now **queues** `openai_llm_payslip` on `import_file` (requires **`OPENAI_API_KEY`**). Background reconcile via **`POST /imports/sessions/:sessionId/reconcile-payslip-async`** runs vision + JSON-schema + Zod, maps to `payslip_snapshot`, and stores **canonical JSON + hybrid columns**. Added **`PATCH /payslip/:id`** for manual summary edits. UI auto-polls + “Check now” target that endpoint; messages updated. Legacy Unstructured Jobs client modules, Deloitte table parser, and the temporary **`reconcile-unstructured`** alias were removed after cutover.
- **Why:** Single high-fidelity extractor for Deloitte without Unstructured cost/latency; preserve IBM local parser; enable richer stored payload for future payslip UI.
- **Files:** `backend/db/migrations_pg/0004_payslip_llm_async_hybrid.sql`, `backend/src/config/env.ts`, `backend/src/modules/imports/payslip-async-import-reconcile.service.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/payslip/payslip.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`, `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts`, `backend/tests/payslip-canonical-map.test.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `docs/API_IMPORT_SESSIONS.md`, `docs/PAYSLIP_V1.md`, `.env.example`.

## 2026-04-07

### CR-050 — Deloitte payslips: Unstructured Jobs async pipeline (HTML-first parser), remove local Deloitte parser
- **Type:** CR / FIX / DOC / DB / UX
- **What:** Deloitte profile switched to **Import-only async** processing through Unstructured Jobs (`POST /jobs`, poll status, download JSON). Added `import_file` job-tracking columns (`unstructured_job_id`, `unstructured_input_file_id`, `unstructured_last_poll_at`) and new reconcile endpoint **`POST /imports/sessions/:sessionId/reconcile-unstructured`** (throttled; `force=true` bypass). Added Deloitte parser that reads Unstructured **`Table.metadata.text_as_html`** first (fallback to `Table.text`) and extracts stable totals (`TOTAL GROSS`, `NET PAY`) plus date hints. Removed local `deloitte-payslip-pdf.ts` (`pdf-parse` + IBM-merge heuristic path) to prevent dead code and false positives. Import UI now reports `unstructuredPending`, auto-polls ~2 minutes for pending Deloitte jobs, and adds “Check Unstructured now”.
- **Why:** Real Deloitte PDFs had unusable local text extraction and produced incorrect values with local heuristics; Unstructured output is reliable for these stubs while preserving constrained free-tier usage through fixture-based tests and throttled polling.
- **Files:** `backend/src/modules/imports/unstructured-jobs.service.ts`, `backend/src/modules/imports/unstructured-import-reconcile.service.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/payslip/profiles/deloitte-unstructured-parse.ts`, deleted `backend/src/modules/payslip/profiles/deloitte-payslip-pdf.ts`, `backend/db/migrations_pg/0003_import_file_unstructured.sql` (+ sqlite mirror), `frontend/src/pages/ImportWorkspacePage.tsx`, `docs/PAYSLIP_V1.md`, `docs/API_IMPORT_SESSIONS.md`, `docs/ENVIRONMENT_VARIABLES.md`.

---

## 2026-04-04

### DOC-049 — Production hygiene: README, user guide, docs archive, DB baseline, bootstrap seed
- **Type:** DOC / DB / CHORE
- **What:** Rewrote root **`README.md`** and added **`docs/USER_GUIDE.md`**. Moved planning/handoff/history docs into **`docs/archive/`** with **`docs/archive/README.md`**. Tracked sample CSVs under **`fixtures/category-import/`**. Replaced incremental migrations with **`backend/db/migrations/0001_baseline.sql`**; former **`0001`–`0032`** files live under **`backend/db/migrations_archive/`** (not run). Merged **`0001_seed_defaults`** + **`0002_seed_category_rule_global`** (+ former **`0003`** hook as comments) into **`backend/db/seeds/0001_bootstrap.sql`**. Updated **`gen-0026-migration.mjs`** to refresh only the global-rules section inside bootstrap. **`docs/RUNBOOK.md`**, **`PRODUCTION_SETUP`**, **`ENVIRONMENT_VARIABLES`**, **`backend/db/README`**, **`category-ids.ts`** comments, and dev seed README adjusted. Added **`docs/DEAD_CODE.md`** (keep optional AI; **`ts-prune`** pointer).
- **Why:** Leaner repo for first production deploy; single schema file for greenfield SQLite; one seed file for operator clarity; archived internal notebooks out of the primary doc set.
- **Files:** `README.md`, `docs/USER_GUIDE.md`, `docs/archive/*`, `fixtures/category-import/*`, `backend/db/migrations/0001_baseline.sql`, `backend/db/migrations_archive/*`, `backend/db/seeds/0001_bootstrap.sql`, removed `backend/db/seeds/0001_seed_defaults.sql`, `0002_seed_category_rule_global.sql`, `0003_seed_default_household_categories.sql`, `backend/scripts/gen-0026-migration.mjs`, `backend/src/modules/category/category-ids.ts`, `backend/db/README.md`, `docs/RUNBOOK.md`, `docs/PRODUCTION_SETUP.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/API_INDEX.md`, `docs/DEAD_CODE.md`, `backend/db/seeds/dev/README.md`.

## 2026-04-01 (classification + taxonomy expansion)

### FIX-047 — Fingerprint-aligned rule matching, five default leaves, rules UI, household rule delete
- **Type:** FIX / DB / UX / API / DOC
- **What:** **`contains`** / **`prefix`** classification now normalizes patterns with the same **fingerprint** rules as canonical import (so punctuation in bank text vs stored patterns no longer prevents matches). Added default leaves **Investments > IRA**, **Shopping > General merchandise**, **Taxes > Property tax**, **Taxes > Tax prep**, **Income > Reimbursements** (seed + migration **`0030`**, **`category-ids.ts`**). **`DELETE /categories/rules/:id`** for household rules; Category Rules page: section cards, grouped household **`<details>`**, split CSV export, horizontal Money In/Out on Add Transaction. **`data/imports/category-rules-house.csv`** paths aligned; duplicate mid-file header removed; ATT rule targets **Mobile phone**.
- **Why:** BOA-style descriptions failed many household rules; taxonomy gaps and UI density/export clarity from the rules roadmap.
- **Files:** `backend/src/modules/category/category-rules.ts`, `backend/tests/category-rules.test.ts`, `backend/db/seeds/0001_seed_defaults.sql`, `backend/db/migrations/0030_category_expansion_leaves.sql`, `backend/src/modules/category/category-ids.ts`, `backend/src/modules/category/category-rules.service.ts`, `category-rules.routes.ts`, `backend/tests/categories-resolve-leaf.test.ts`, `frontend/src/pages/CategoryRulesPage.tsx`, `frontend/src/pages/TransactionsPage.tsx` (modal), `frontend/src/index.css`, `data/imports/category-rules-house.csv`, `docs/API_CATEGORIES.md`, `openapi/openapi.yaml`.

## 2026-04-03

### FIX-048 — Household category rules honor `amount_scope`
- **Type:** FIX / DB / API / UX / DOC
- **What:** Migration **`0031_category_rule_household_amount_scope.sql`** adds **`amount_scope`** to **`category_rule`** (default `any`). API create/PATCH/bulk/from-ledger and CSV import/export persist scope; classifier uses stored values (parity with **`category_rule_global`**). **Category Rules** UI: household add/edit table includes amount scope; groups combine category + scope.
- **Why:** Credit vs debit often maps to different meanings; household rules previously ignored scope.
- **Files:** `backend/db/migrations/0031_category_rule_household_amount_scope.sql`, `backend/src/modules/category/category-rules.service.ts`, `category-rules.routes.ts`, `backend/tests/category-rules.test.ts`, `backend/tests/category-rules-api.test.ts`, `frontend/src/pages/CategoryRulesPage.tsx`, `docs/API_CATEGORIES.md`, `docs/IMPORT_CLASSIFICATION.md`, `openapi/openapi.yaml`.

### CR-047 — Delete all household classification rules
- **Type:** CR / API / UX / DOC
- **What:** **`DELETE /categories/rules/household`** returns **`{ deleted }`**; **Category Rules** import section adds **Delete all household rules** (confirm) for clean CSV re-import without duplicates.
- **Why:** Create-only bulk import has no dedupe; clearing the set is the practical workaround.
- **Files:** `category-rules.service.ts`, `category-rules.routes.ts`, `CategoryRulesPage.tsx`, `backend/tests/category-rules-api.test.ts`, `docs/API_CATEGORIES.md`, `openapi/openapi.yaml`.

### DOC-009 — Taxonomy seed alignment, built-in rule group summaries, PRD roadmap refresh
- **Type:** DB / DOC / UX
- **What:** Migration **`0029_sync_global_category_display_names.sql`** updates global **`category.name`** values to match current product copy for upgraded databases. **`0003_seed_default_household_categories.sql`** documents option B (household extensions) without duplicate global parents. **`docs/CATEGORIZATION_ROADMAP.md`** rewritten to match **`0001_seed_defaults`** + Loans/Travel/HOA; notes PRD vs CHECKPOINT as sources of shipped truth. **Classification rules UI:** built-in **`<details>`** group summary shows rule count and **min–max priority**. **`0002_seed_category_rule_global.sql`** unchanged (rules key by `category_id` only).
- **Why:** Keep seeds, migrations, and docs aligned; reduce built-in rule list noise with clearer group headers.
- **Files:** `backend/db/migrations/0029_sync_global_category_display_names.sql`, `backend/db/seeds/0003_seed_default_household_categories.sql`, `docs/CATEGORIZATION_ROADMAP.md`, `docs/CHECKPOINT.md`, `frontend/src/pages/CategoryRulesPage.tsx`.

## 2026-04-01

### CR-046 — Classification rules CSV, bulk APIs, built-in form grid, Home HOA Fees leaf
- **Type:** CR / UX / API / DB / DOC
- **What:** **`/categories/rules`** built-in add form uses CSS Grid (full-width intro + pattern). **CSV** export/import on the same page; **`POST /categories/rules/bulk`** and **`POST /categories/rules/builtin/bulk`** with per-row errors and **`categoryPath`** resolution (`Parent > Child`). Default taxonomy: **Home > HOA Fees** (**migration `0028`**, seed update, **`category-ids.ts`**).
- **Why:** Predictable rule authoring layout, safe bulk onboarding from spreadsheets, and a dedicated HOA leaf for imports/rules.
- **Files:** `frontend/src/pages/CategoryRulesPage.tsx`, `frontend/src/import/rulesCsv.ts`, `frontend/src/index.css`, `backend/src/modules/category/categories.service.ts`, `category-rules.service.ts`, `category-rules.routes.ts`, `backend/db/migrations/0028_category_hoa_fees.sql`, `backend/db/seeds/0001_seed_defaults.sql`, `docs/API_CATEGORIES.md`, `openapi/openapi.yaml`, `backend/tests/category-rules-api.test.ts`, `backend/tests/categories-resolve-leaf.test.ts`.

## 2026-04-02

### CR-045 — Connected accounts institutions, picker harmonization, import docs, OpenAPI, prod seeds
- **Type:** CR / UX / DOC / DB
- **What:** **Connected accounts:** curated U.S. institution list + searchable picker, **`POST /imports/institutions/custom`** for household names, **`GET /imports/institutions`**; removed default-parser UI (mapping remains automatic via `inferParserProfile`). **Migration `0023`** — `household_custom_institution`. **Categories:** shared `categoryPickerGroups` — filter vs **leaf-only** assignment aligned with rules. **Transactions:** Mantine `MultiSelect` for review types; Add Transaction **Money In / Money Out** radios and single **Description** field. **Docs:** `IMPORT_CLASSIFICATION.md`, `PRODUCTION_SETUP.md`, `API_INDEX.md`; **`openapi/openapi.yaml`**; **`PROJECT_CONTEXT`** doc map. **Seeds:** dev fixtures moved to **`seeds/dev/`** (second pass in `db.mjs`). **Copy:** shorter Home + Settings blurbs.
- **Why:** Reduce cognitive load, align assignment UX with category rules, document full import automation vs `/categories/rules`, and clarify production vs dev seeding.
- **Files:** `backend/db/migrations/0023_household_custom_institution.sql`, `backend/src/modules/imports/institution-catalog.ts`, `infer-parser-profile.ts`, `household-institutions.service.ts`, `imports.routes.ts`, `scripts/db.mjs`, `frontend/src/import/institutionCatalog.ts`, `SettingsPage.tsx`, `categoryPickerGroups.ts`, `LedgerCategoryPicker.tsx`, `TransactionsPage.tsx`, `index.css`, `openapi/openapi.yaml`, `docs/*`, `backend/db/README.md`.

### UX-013 — Cascade submenu pickers + add-transaction clarity pass
- **Type:** UX / FIX
- **What:** Reworked shared picker behavior from flat `Parent > Child` text to a hybrid cascade menu with search (left menu + right submenu) and consistent rendering for category/account/belongs-to across Transactions, Dashboard, Import, and Settings. Category creation affordance moved from confusing side `+ +` buttons into in-menu footer actions (`Add group`, `Add subcategory`). Dashboard Home scope controls now render account + belongs-to side-by-side in one horizontal row. Add Transaction modal now uses explicit `Money In` / `Money Out`, positive amount entry, required `Belongs-to`, and fixed picker layering so category dropdown renders above the modal.
- **Why:** Reduce cognitive load, align with expected menu/submenu interaction, remove ambiguous affordances, and fix blocking add-transaction modal picker bug.
- **GitHub (closed):** [#1](https://github.com/mangatrai/household-finance-app/issues/1) cascade picker parity · [#2](https://github.com/mangatrai/household-finance-app/issues/2) add-transaction category dropdown layering · [#3](https://github.com/mangatrai/household-finance-app/issues/3) horizontal Home scope · [#4](https://github.com/mangatrai/household-finance-app/issues/4) money direction + required belongs-to — all addressed in **UX-013** (see **What** above).
- **Files:** `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/components/LedgerCategoryPicker.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/index.css`.

### UX-012 — Picker UX modernization with searchable hierarchy across core workflows
- **Type:** UX
- **What:** Introduced a shared hierarchical searchable picker foundation in frontend and migrated core selectors in Transactions, Dashboard, Import, and Settings to it. Category/account/belongs-to pickers now support in-picker search and hierarchy labels (e.g., `Parent > Child`, `Household > Member`). Replaced the legacy Transactions row category portlet-style chooser with an inline searchable picker and kept quick category creation actions available from Transactions.
- **Why:** Improve selection speed as categories/accounts/members grow, preserve hierarchy clarity, and reduce friction from modal/portlet interactions.
- **Files:** `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/components/LedgerCategoryPicker.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/main.tsx`, `frontend/package.json`.

### UX-011 — Ownership wording refinement to Belongs-to with hierarchical selectors
- **Type:** UX
- **What:** Refined ownership wording across Settings Connected Accounts, Import file binding, Transactions/Needs Review, and Dashboard from owner/scope-style labels to **`Belongs-to`**. Replaced two-step scope/person controls with a single hierarchical selector pattern: top-level **Household** and member children as **`Household > <Name>`** using profile names.
- **Why:** Improve clarity and reduce harsh ownership language while keeping household/member attribution explicit and consistent.
- **Files:** `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`.

### CR-044 — MVP closure: connected accounts + member ownership attribution across import/ledger/dashboard
- **Type:** CR / DB / UX / FIX
- **What:** Added migration **`0022_member_ownership_connected_accounts.sql`** introducing ownership primitives on `financial_account`, `import_file`, and `transaction_canonical` (`owner_scope`, `owner_person_profile_id`) plus `financial_account.default_parser_profile_id`. Implemented manual connected-account onboarding in **Settings → Connected accounts** (create/edit account, institution/type/mask, owner assignment, parser default metadata). Import file binding now supports owner tagging at file level and carries owner metadata into canonicalized ledger rows. Transactions now support owner filtering (`ownerScope`, `ownerPersonProfileId`) and inline owner retagging while preserving existing category flows. Dashboard/cash summary now supports owner filters and drill-down parity to transactions with owner context preserved.
- **Why:** Close the last MVP gap for air-gapped onboarding and household-member attribution without adding online bank integrations; keep model split-ready for post-MVP allocation enhancements.
- **Files:** `backend/db/migrations/0022_member_ownership_connected_accounts.sql`, `backend/src/modules/imports/*`, `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/src/modules/ledger/*`, `backend/src/modules/reports/*`, `backend/tests/app.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `docs/NEXT_SESSION_PROMPT.md`.

### CR-040 — Remove household-level salary/employer writes; employer resolution uses signed-in user profile
- **Type:** CR / **DOC** / **FIX**
- **What:** **`PATCH /household/settings`** now updates **only** **`monthlySavingsTargetUsd`**. Salary deposit and employers are read/written via **`person_profile`** (**`PATCH /household/profile`**). Removed legacy read fallback from **`household`** columns for salary/employers. Payslip employer lists and import binding resolve employers using **`getHouseholdSettings(householdId, userId)`** (threaded through upload, sniff, parse, import file binding). Updated **`docs/API_HOUSEHOLD.md`**, added **`docs/API_HOUSEHOLD_PROFILE.md`**, tests, and **`PAYSLIP_V1`** / **`MVP_BACKLOG`** pointers.
- **Why:** Completes Epic **12.5** cleanup — single source of truth on profile storage without silent household fallbacks.
- **Files:** `backend/src/modules/household/household.service.ts`, `household.routes.ts`, `payslip-employer-resolve.service.ts`, `payslip.routes.ts`, `payslip-sniff.service.ts`, `import-parser.service.ts`, `import-file-binding.service.ts`, `imports.routes.ts`, `backend/tests/app.test.ts`, `docs/API_HOUSEHOLD.md`, `docs/API_HOUSEHOLD_PROFILE.md`, `docs/PAYSLIP_V1.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `frontend/src/pages/SettingsPage.tsx` (avatar preview copy).

### CR-039 — Settings profile split fields + single household save; move salary/employers to profile ownership
- **Type:** CR / UX / DB
- **What:** **Settings → Profile** now captures **First name**, **Last name**, **Email**, **Phone**, avatar, salary deposit account, and employer rows (parser format). **Settings → Household** member rows now use **First name / Last name / Email** and a single **Save household** action (no per-row save). Added migration **`0020_profile_income_settings.sql`** to store salary deposit + employers on **`person_profile`**; household settings read path now sources these values from the signed-in user profile with legacy household fallback for compatibility.
- **Why:** Salary/employer data is person-specific, not household-global; member editing flow needed a simpler batch save UX.
- **Files:** `backend/db/migrations/0020_profile_income_settings.sql`, `backend/src/modules/household/household.service.ts`, `household.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/CHANGE_HISTORY.md`.

### CR-038 — Settings Household RBAC: member tab hidden; backend 403 on management routes
- **Type:** CR / **UX**
- **What:** Enforced Household management RBAC so **owner/admin** can manage household settings/members while **member** cannot. Backend adds role guards on household management routes (members receive **403** on household settings mutation and members list/create/update). Frontend `Settings` hides the **Household** tab for members and redirects away if opened directly.
- **Why:** Household structure is an admin concern; member UX should avoid edit affordances they cannot use.
- **Files:** `backend/src/modules/household/household.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/FINANCE_APP_PRD.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### DOC-013 — Epic 12/13 phase plan with first two sprints
- **Type:** DOC
- **What:** Added **`docs/EPIC_12_13_EXECUTION_PLAN.md`** with dependency-first sequence across Epics **12** and **13**, phase gates (A-D), explicit scope guardrails, and constrained **Sprint 1 / Sprint 2** definition of done to avoid oversizing the initiative. Added discoverability links from **`docs/MVP_BACKLOG.md`** and **`docs/CHECKPOINT.md`**.
- **Why:** Convert broad settings/account/security direction into an executable, low-risk rollout plan that can be delivered incrementally.
- **Files:** `docs/EPIC_12_13_EXECUTION_PLAN.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### DOC-012 — Settings/Auth direction: separate `user_account` and `person_profile`
- **Type:** DOC / PRD
- **What:** Updated **`docs/FINANCE_APP_PRD.md`** and **`docs/MVP_BACKLOG.md`** to lock architecture choice: **Option B** with separate auth identity (**`user_account`**) and human profile (**`person_profile`**), plus **`household_membership`** role/relationship model. Added backlog epics for identity/membership ownership attribution (**Epic 12**) and credentials lifecycle/security settings (**Epic 13**). Updated **`docs/CHECKPOINT.md`** planned rows + next-step priorities accordingly.
- **Why:** Household workflows need profile-only members (e.g., children/dependents), person-level attribution for documents/transactions, and long-term maintainable auth boundaries.
- **Files:** `docs/FINANCE_APP_PRD.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### CR-037 — Epic 3.3+: employer-driven parser, ADP profile stub, PDF sniff, `employer_id`
- **Type:** CR / **DB**  
- **What:** Migration **`0018_payslip_employer_ref.sql`** — nullable **`employer_id`** on **`payslip_snapshot`** and **`import_file`**. **Settings → Household:** per-employer **payslip format** (**IBM** vs **ADP** placeholder **`adp_payslip_pdf`**); **`resolvePayslipUploadContext`** — 0 employers → IBM default; 1 → that employer’s parser; 2+ → **`employerId`** required on **`POST /payslips/upload`** and payslip import parse unless file already has **`employer_id`**. **`POST /payslips/sniff`** — optional PDF text signals to suggest parser/employer before upload/binding. **Import:** **`PATCH`** import file accepts **`employerId`** for payslip profiles; parse routes **`parsePayslipPdfByProfile`** (ADP returns **`unsupported_parser`** until implemented). **Canonicalize:** payslip rows for any payslip profile linked to session. **UI:** employer column / dropdown on **`/payslips`** and Import when multiple employers; detail shows **Employer** when set. **Out of scope:** linking stub to bank deposit.  
- **Why:** Product-shaped multi-employer households without guessing parser; sniff reduces wrong-profile uploads.  
- **Files:** `backend/db/migrations/0018_payslip_employer_ref.sql`, `backend/src/modules/payslip/*`, `import-parser.service.ts`, `import-file-binding.service.ts`, `imports.routes.ts`, `canonical-ingest.service.ts`, `household.service.ts`, `frontend/src/pages/PayslipsPage.tsx`, `PayslipDetailPage.tsx`, `ImportWorkspacePage.tsx`, `SettingsPage.tsx`, `profileLabels.ts`, `inferParserProfile.ts`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`.

### UX-010 — Payslip charts: merge same pay date; clarify day vs month
- **Type:** UX  
- **What:** **Gross & net by pay date** — one chart point per **calendar day**; multiple stubs on the same day have **combined** totals (tooltip shows count). Renamed from “by paycheck”; **Totals by calendar month** copy explains **monthly budgeting** vs **per-payday** timeline. **`docs/PAYSLIP_V1.md`** — chart behavior note.  
- **Why:** Duplicate x-axis labels and flat lines when several uploads shared one date; users asked how the two charts differ.  
- **Files:** `frontend/src/payslip/payslipChartsModel.ts`, `PayslipIncomeCharts.tsx`, `payslipChartsModel.test.ts`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`.

### CR-036 — Epic 3.3: Payslips income charts (gross / net / taxes / MoM)
- **Type:** CR / **UX**  
- **What:** **`/payslips`** — **Recharts** section **Income & payroll**: line series **gross**, **net**, **employee taxes withheld** by paycheck (chronological); **calendar month** line chart (sums per month); **donut** of latest stub **current** buckets (net, taxes, pre/post deductions). Shared **`PayslipSnapshotDetail`** type in **`frontend/src/payslip/types.ts`**. List fetch **`limit=200`**. **`docs/PAYSLIP_V1.md`** — Story **3.3** UI progress.  
- **Why:** Move payslip UI from table-only to basic payment analytics without ledger merge.  
- **Files:** `frontend/src/payslip/types.ts`, `payslipChartsModel.ts`, `PayslipIncomeCharts.tsx`, `PayslipsPage.tsx`, `PayslipDetailPage.tsx`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`, `docs/CHECKPOINT.md`.

### CR-035 — Wire salary account / employers into payslip inference and snapshot `parser_profile_id`
- **Type:** CR  
- **What:** **`payslipParserProfileIdForHousehold`** — first employer’s **`parserProfileId`** when supported (v1: IBM only); **`POST /payslips/upload`** and import payslip parse use it for **`payslip_snapshot.parser_profile_id`**. **`inferParserProfile`** — optional **`IncomeInferenceContext`** from **`GET /household/settings`**: salary deposit account + ≥1 employer + PDF whose name does **not** look like a bank statement (**`filenameLooksLikeBankStatementPdf`**) → employer’s parser (IBM default). **Import workspace** loads settings and passes context; copy updated.  
- **Why:** Settings onboarding affects real behavior, not only storage.  
- **Files:** `backend/src/modules/payslip/payslip-profile-hints.ts`, `payslip.routes.ts`, `import-parser.service.ts`, `frontend/src/import/inferParserProfile.ts`, `ImportWorkspacePage.tsx`, `inferParserProfile.test.ts`, `docs/CHANGE_HISTORY.md`.

### CR-034 — Income onboarding (household settings); resolution queue + orphan banner; dashboard cash UX
- **Type:** CR / **DB** / **UX**  
- **What:** Migration **`0017_household_income_onboarding.sql`** — **`salary_deposit_financial_account_id`**, **`employers_json`** (default **`[]`**). **`GET/PATCH /household/settings`** — optional salary account + employer stubs (**IBM** parser id default); validate account belongs to household. **Settings → Household** UI. **`countOpenDuplicateAmbiguityNotOnLedger`** + **`GET /resolution/summary`** field **`openDuplicateAmbiguityNotOnLedger`** (DOC-005). **`/resolution-queue`** page lists **`GET /resolution?status=open`**; **Transactions → Needs review** banner when raw-only near-duplicates exist. **Dashboard:** friendlier **366-day** limit messaging, **safe-to-spend** tooltip clarification. **Docs:** **`API_HOUSEHOLD.md`**, **`API_RESOLUTION.md`**, **`PAYSLIP_V1.md`**.  
- **Why:** Close gaps on payslip/product story, invisible near-duplicate review items, and perceived cash-summary polish without new pipelines.  
- **Files:** `backend/db/migrations/0017_household_income_onboarding.sql`, `backend/src/modules/household/*`, `backend/src/modules/resolution/resolution.service.ts`, `resolution.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `ResolutionQueuePage.tsx`, `App.tsx`, `TransactionsPage.tsx`, `DashboardPage.tsx`, `docs/API_HOUSEHOLD.md`, `docs/API_RESOLUTION.md`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`.

### FIX-009 — Import: auto-create payslip placeholder account if missing (dev DBs / no seed)
- **Type:** FIX  
- **What:** **`GET /imports/accounts`** calls **`ensurePayslipImportPlaceholderAccount(householdId, userId)`** before listing — idempotent **`payslip`** row with institution **`Employer payslip (IBM) — placeholder`** when the signed-in user has none (so UI instructions match without re-running seeds). Account list **`ORDER BY`** puts **`type = payslip`** first.  
- **Why:** Seed **`0004`** only applies on **`--seed`**; existing **`MODE=PROD`** DBs often never got the row; dropdown looked empty for the copy added in **CR-032**.  
- **Files:** `backend/src/modules/imports/import-file-binding.service.ts`, `imports.routes.ts`, `docs/CHANGE_HISTORY.md`.

### CR-032 — `financial_account.type` **payslip** + IBM placeholder; inference for generic PDF names
- **Type:** CR / **DB**  
- **What:** Migration **`0016_financial_account_type_payslip.sql`** — **`type`** may be **`payslip`** (table recreated for expanded **`CHECK`**). Seed **`0004_seed_payslip_placeholder_account.sql`** — **`Employer payslip (IBM) — placeholder`** for seed household **owner** (`owner_user_id`); import UI lists it like other accounts. **`inferParserProfile`:** **`payslip`** + **`.pdf`** → **`ibm_pay_contributions_pdf`** before institution rules so generic filenames are not mistaken for bank e-statements. **`formatAccountForSelect`** — institution-only label for payslip rows. **Follow-on (not shipped):** onboarding **N employers** + per-employer payslip accounts and **parser mapping** (IBM vs ADP vs …); multi-job households need that layer on top of this placeholder.  
- **Why:** Direction **A** — a dedicated bucket account for payslip imports without pretending the PDF is a bank statement; v1 single IBM stub until onboarding defines multiple employers/parsers.  
- **Files:** `backend/db/migrations/0016_financial_account_type_payslip.sql`, `backend/db/seeds/0004_seed_payslip_placeholder_account.sql`, `frontend/src/import/inferParserProfile.ts`, `accountDisplay.ts`, `inferParserProfile.test.ts`, `ImportWorkspacePage.tsx`, `docs/CHANGE_HISTORY.md`.

### CR-031 — Payslip: `GET /payslips/:id` + detail route; Epic 5.2 deferred post-MVP
- **Type:** CR  
- **What:** **`GET /payslips/:id`** — household-scoped read of full **`payslip_snapshot`** (invalid UUID → **400**, missing → **404** **`NOT_FOUND`**). **`PayslipDetailPage`** at **`/payslips/:payslipId`** — period, Current/YTD table, import file id when present, collapsible **`rawExtractJson`**. List links pay period / file / **View** to detail. **Docs:** **Epic 5.2** (**transfer matcher** continuation) marked **post-MVP / backlog** — further pattern work waits on **real-world statement validation** vs fixtures (**`MVP_BACKLOG`**, **`CHECKPOINT`**, **`PROJECT_CONTEXT`**).  
- **Why:** Complete the payslip **read path** after list + upload; align planning with deprioritizing transfer-matcher tuning until production-like data.  
- **Files:** `backend/src/modules/payslip/payslip.service.ts`, `payslip.routes.ts`, `backend/tests/payslip-upload.test.ts`, `frontend/src/pages/PayslipDetailPage.tsx`, `PayslipsPage.tsx`, `App.tsx`, `frontend/src/index.css`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/PROJECT_CONTEXT.md`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`.

### CR-030 — Epic 5.2: transfer matcher CARD / HELOC / loan outgoing payment tokens
- **Type:** CR  
- **What:** **`transferPairScore`** — **`outgoingPaymentTokens`** adds specific **card / HELOC / loan** payoff memos that omit directional **“PAYMENT TO”** phrasing: **`CARD PAYMENT`**, **`HELOC PAYMENT`**, **`LOAN PAYMENT`**, **`MORTGAGE PAYMENT`**, **`INSTALLMENT PAYMENT`** (still gated with existing **PAYMENT** + card/loan context so generic ACH + **THANK YOU** pairs are not loosened). Tests extended in **`canonical-ingest.test.ts`**.  
- **Why:** More bank statements encode payoffs as **“… CARD PAYMENT”** / **“… HELOC PAYMENT”** rather than **“PAYMENT TO …”**; scoring the debit leg as **outgoing payment** improves auto-**`transfer_group_id`** linking for those cases.  
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/canonical-ingest.test.ts`, `docs/CHANGE_HISTORY.md`.

### CR-029 — Cash summary: byCategory prior-window totals/deltas
- **Type:** CR
- **What:** `GET /reports/cash-summary` now includes per-category previous-window totals and deltas in `byCategory[]` when `categoryBreakdown=true`:
  - `previousInflows`, `previousOutflows`, `previousNet`
  - `deltaInflows`, `deltaOutflows`, `deltaNet`
  using the same `comparison.previousPeriod` date rules as household KPIs.
- **Why:** Make category drill-down comparisons consistent with the dashboard’s KPI deltas.
- **Files:** `backend/src/modules/reports/cash-summary.service.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/DashboardPage.tsx` (types), `docs/API_CASH_SUMMARY.md`.

### DOC-011 — Docs sync: unified payslip import, migration **0015**, import API
- **Type:** DOC  
- **What:** **`docs/CHECKPOINT.md`** (payslip + import status, next steps), **`docs/API_IMPORT_SESSIONS.md`** (**`ibm_pay_contributions_pdf`**, parse/canonicalize behavior for payslip-only sessions), **`docs/PAYSLIP_V1.md`** (§1 progress — **`import_file`** link), **`docs/NEXT_SESSION_PROMPT.md`** (handoff bullets), **`docs/PROJECT_CONTEXT.md`** (immediate next focus). **`docs/API_CASH_SUMMARY.md`** — Epic **7** backlog pointer for per-category comparison fields (aligns with TODO in service).  
- **Why:** Repo behavior for unified Import + payslip was ahead of written contracts.  
- **Files:** those docs, **`docs/CHANGE_HISTORY.md`**.

### CR-028 — Import: IBM payslip through session pipeline + filename heuristic
- **Type:** CR  
- **What:** Migration **`0015_payslip_import_file.sql`** — **`payslip_snapshot.import_file_id`** → **`import_file`**. Parse profile **`ibm_pay_contributions_pdf`**: writes **`payslip_snapshot`**, **`parsedRows` 0**, no **`transaction_raw`**. Canonicalize: payslip-only IBM session completes (**`inserted: 0`**, staging purge) instead of **`NO_RAW_ROWS`**. **`inferParserProfile`** (frontend) suggests **`ibm_pay_contributions_pdf`** for **`.pdf`** files whose names look like employer payslips (paystub, payslip, SuccessFactors, pay and contribution, etc.) before institution PDF rules.  
- **Why:** Single Import intake for employer PDFs; less manual profile picking; **`GET /payslips`** shows **`importFileId`**.  
- **Files:** backend migrations/services (already shipped); **`frontend/src/import/inferParserProfile.ts`**, **`frontend/src/pages/ImportWorkspacePage.tsx`**, **`frontend/src/import/inferParserProfile.test.ts`**, Vitest in **`frontend/`**.

### UX-009 — Import workspace: payslip (IBM) guidance
- **Type:** UX  
- **What:** **Import session** — short callout under **Files & account**: choose **Employer payslip (IBM)** when the PDF is a pay stub; **parse** shows **0** ledger lines; **canonicalize** still finishes and clears staging; data appears under **Payslips**. **Last import** summary adds a line when **`parsedRows === 0`** and nothing posted, pointing to payslips.  
- **Why:** Reduces confusion for payslip-only sessions.  
- **Files:** **`frontend/src/pages/ImportWorkspacePage.tsx`**, **`docs/CHANGE_HISTORY.md`**.

---

## 2026-04-01

### UX-014 — Classification rules + import UX: session wayfinding, matcher preview on import, built-in category scope
- **Type:** UX / FIX
- **What:** **`GET /imports/sessions`** lists recent sessions for the household. **`/imports`** is an **Import** hub (recent sessions, **Continue**, **New import session**, deep link **`/imports?sessionId=`**). Header control opens the hub instead of silently starting a session. Session page adds **Copy id** and moves the read-only **classification matcher preview** from Classification Rules into the import workspace. **Built-in rule** forms only offer **global default leaves**; grouped built-in rules table by category + amount scope. API: invalid built-in category returns **`BUILTIN_REQUIRES_GLOBAL_LEAF`** with a clear message.
- **Why:** Align UI with the mental model (preview is a matcher dry-run; parsing persists in DB; global rules cannot target household-created categories).
- **Files:** `backend/src/modules/imports/import-session.service.ts`, `imports.routes.ts`, `category-rules.service.ts`, `category-rules.routes.ts`, `backend/tests/app.test.ts`, `backend/tests/category-rules-api.test.ts`, `frontend/src/App.tsx`, `frontend/src/layout/AppTopBar.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/CategoryRulesPage.tsx`, `docs/IMPORT_CLASSIFICATION.md`, `docs/CHANGE_HISTORY.md`.

### DOC-010 — Docs sync: payslip progress, checkpoint, next-session prompt
- **Type:** DOC  
- **What:** **`docs/CHECKPOINT.md`**, **`docs/PROJECT_CONTEXT.md`**, **`docs/PAYSLIP_V1.md`**, **`docs/NEXT_SESSION_PROMPT.md`** — reflect **FIX-006**–**FIX-008**, **UX-008**, IBM SuccessFactors parser behavior, dev **`/payslips`** proxy, and prioritized **next build** themes (unified import vs payslip-only UX).  
- **Why:** Single handoff for humans and AI sessions after payslip hardening.  
- **Files:** those docs, `docs/CHANGE_HISTORY.md`.

### UX-008 — Payslips upload: success path after async (form reset)
- **Type:** UX  
- **What:** **`PayslipsPage`** — capture **`HTMLFormElement`** before **`await`**; call **`form.reset()`** after successful upload + reload instead of touching **`e.currentTarget.elements`** (React synthetic event **`currentTarget`** is **`null`** after await → *Cannot read properties of null (reading 'elements')*).  
- **Why:** Upload succeeded server-side but UI threw; poor UX.  
- **Files:** `frontend/src/pages/PayslipsPage.tsx`, `docs/CHANGE_HISTORY.md`.

### FIX-008 — Vite dev proxy: `/payslips` → API
- **Type:** FIX  
- **What:** **`frontend/vite.config.ts`** — proxy **`/payslips`** to backend (same as **`/imports`**, **`/transactions`**). Without it, **`fetch('/payslips/...')`** in dev hit the Vite server and failed.  
- **Why:** Payslip list/upload appeared broken in **`npm run dev:frontend`** until proxy added.  
- **Files:** `frontend/vite.config.ts`, `docs/CHANGE_HISTORY.md`.

---

## 2026-03-31

### CR-043 — MVP final hardening: broader reconciliation balance-key support, bulk review throughput, and KPI drill-down parity
- **Type:** CR / UX / FIX
- **What:** Reconciliation diagnostics now detect running balance from any parsed `source_row` key containing `balance` (not only `source_row.balance`), including parenthesized negatives. Transactions bulk toolbar adds a high-throughput **Apply + resolve** action for unknown-category selections, plus mixed-selection guardrail copy. Dashboard unknown-category CTA now preserves current date/account scope, and by-account drill-down links preserve dashboard return context. Added integration tests for balance-key reconciliation and mixed `bulk-apply-category` behavior.
- **Why:** Close remaining P0 monthly-close friction by increasing reconciliation coverage across feasible parser outputs, reducing per-row review clicks, and keeping dashboard-to-ledger navigation consistent.
- **Files:** `backend/src/modules/imports/session-summary.service.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `backend/tests/app.test.ts`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `docs/NEXT_SESSION_PROMPT.md`.

### CR-042 — Import reconciliation diagnostics + file-scoped review links + custom-range guardrails
- **Type:** CR / UX / FIX
- **What:** Import session summary now includes per-file **reconciliation diagnostics** (when running balance is available in parsed rows): opening, net activity, expected closing, actual closing, variance, and status (`ok`/`mismatch`/`insufficient_data`). Import workspace surfaces session/file reconciliation stats and details in **Outcomes by file**. Added file-scoped review reliability: ledger API now supports **`fileId`** filter, and import outcome links use `sessionId+fileId` for both all-rows and needs-review drill-down. Dashboard custom range now validates client-side (date order and 366-day cap) before apply.
- **Why:** Tighten monthly-close trust checks, remove dead-end review navigation in multi-file sessions, and prevent avoidable custom-range UX errors.
- **Files:** `backend/src/modules/imports/session-summary.service.ts`, `backend/src/modules/ledger/ledger.routes.ts`, `backend/src/modules/ledger/ledger.service.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `docs/NEXT_SESSION_PROMPT.md`.

### CR-041 — Token-version session invalidation, top-bar avatar/name, and import employer guardrails
- **Type:** CR / FIX / UX
- **What:** Added migration **`0021_user_token_version.sql`** (`app_user.token_version` default `0`). JWTs now carry `tokenVersion`; auth verification rejects tokens when DB version differs. **`POST /auth/change-password`** now rotates password hash and increments token version so existing sessions are invalidated immediately. Added integration assertion in auth test that old token returns **401** after password change. UI shell now shows profile identity in top bar (`avatarKey` emoji + first name) by loading **`GET /household/profile`**. Import workspace now blocks parse/run-import when multi-employer payslip files are missing employer selection and shows actionable file-level guidance. Updated stale copy from **Settings → Household** to **Settings → Profile / Employer Setup** in payslip/import pages.
- **Why:** Complete practical Epic 13 security behavior (session invalidation on credential change), close visible profile continuity gap, and prevent avoidable multi-employer payslip import failures.
- **Files:** `backend/db/migrations/0021_user_token_version.sql`, `backend/src/modules/auth/auth.service.ts`, `backend/tests/app.test.ts`, `frontend/src/layout/AppTopBar.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/PayslipsPage.tsx`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `docs/NEXT_SESSION_PROMPT.md`.

### FIX-007 — IBM payslip: multiline PDF text (real SuccessFactors layout)
- **Type:** FIX  
- **What:** **`parseIbmPayslipFromText`** — pay period from first **`MM/DD/YYYY-MM/DD/YYYY`** range; **Gross Pay** / **Hours** Current+YTD read from **same line** or **following** money-only lines; **Net Pay** Current+YTD from lines **above** the **`Net Pay`** label (IBM layout). **Pay date** from **Payment Information** block (`Pay Date` / `…USD`). Regression test with anonymized multiline extract.  
- **Why:** User PDFs (`Feb_Regular_paycheck.pdf`, `Feb_Commission_PayCheck.pdf`) extracted text with labels and amounts on **different lines**, so the old single-line regex never saw gross/net and returned **`PARSE_FAILED`**.  
- **Files:** `backend/src/modules/payslip/profiles/ibm-payslip-pdf.ts`, `backend/tests/pdf-parsers.test.ts`, `docs/CHANGE_HISTORY.md`.

### FIX-006 — Payslip PDF: broader label matching + clearer 422 reasons
- **Type:** FIX  
- **What:** **`parseIbmPayslipFromText`** — normalize NBSP; match **Total Earnings**, **Pay Begin/End Date**, and other common payroll labels; fallbacks when a line has two money columns. **`parseIbmPayslipPdf`** returns **`empty_pdf_text` / `no_summary_fields` / `pdf_read_error`** so **`422`** responses distinguish **scanned PDFs** from **unknown layouts**. **`PayslipsPage`** shows **`message`** from JSON errors.  
- **Why:** Real uploads often failed **`PARSE_FAILED`** despite readable PDFs; users need to know if the file is image-only vs unsupported wording.  
- **Files:** `backend/src/modules/payslip/profiles/ibm-payslip-pdf.ts`, `payslip.routes.ts`, `backend/tests/pdf-parsers.test.ts`, `frontend/src/pages/PayslipsPage.tsx`, `docs/CHANGE_HISTORY.md`.

---

## 2026-03-27

### CR-025 — Needs review UX: bulk category guardrails + clearer “why” copy
- **Type:** CR + UX  
- **What:** **Transactions → Needs review** — selection summary shows how many open **Unknown category** items apply to bulk **Apply category**; button disabled when none; error text explains transfer/duplicate/other flags. Toolbar link **Show unknown category only** sets **`resolutionType=unknown_category`**. Intro copy clarifies categorized rows can remain for non-category review. **`buildReviewReasons`** adds a line when a category is set but other resolution types remain.  
- **Why:** **`docs/CHECKPOINT.md`** pickup — reduce confusion when bulk apply appears inert or rows look “already categorized.”  
- **Files:** `frontend/src/pages/TransactionsPage.tsx`, `backend/src/modules/ledger/ledger.service.ts`, `docs/CHANGE_HISTORY.md`.

### CR-026 — Epic 3.3b starter: `GET /payslips` + Payslips page
- **Type:** CR  
- **What:** **`GET /payslips?limit&offset`** — household-scoped list (newest first) with **`total` / `items`**. **`PayslipsPage`** at **`/payslips`**: upload + table (period, pay date, gross, net, file, uploaded, parser). Sidebar **Payslips**. Integration test for list after upload.  
- **Why:** Read path for **`payslip_snapshot`**; basic UI for pay stubs without merging into ledger.  
- **Files:** `backend/src/modules/payslip/payslip.service.ts`, `payslip.routes.ts`, `frontend/src/pages/PayslipsPage.tsx`, `frontend/src/App.tsx`, `frontend/src/layout/AppSidebar.tsx`, `backend/tests/payslip-upload.test.ts`, `docs/CHANGE_HISTORY.md`.

### CR-027 — Epic 5.2: bill-pay memo pairing for transfer score
- **Type:** CR  
- **What:** **`transferPairScore`** — when **both** legs match bill-pay phrasing (**`BILL PAY`**, **`BILLPAY`**, **`ONLINE BILL PAY`**, **`BILL PAYMENT`**), score **77** (ordered before generic **TRANSFER** at 80). Unit tests.  
- **Why:** Stronger pairing for common bank bill-pay memos vs ambiguous amount/date matches.  
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/canonical-ingest.test.ts`, `docs/CHANGE_HISTORY.md`.

---

## 2026-03-30

### DOC-014 — CHECKPOINT handoff (next session context)
- **Type:** DOC
- **What:** Refreshed **`docs/CHECKPOINT.md`** — **Last updated** line, new **Handoff — next session** block (CR-040 stability summary, **`avatarKey`** preview vs top bar, suggested next picks, branch reminder), **Epic 12** row moved to **partial** (**0019**/**0020** + profile endpoints), **UI shell** row notes **`avatarKey`** not wired in **`AppTopBar`** yet. Updated **`docs/PROJECT_CONTEXT.md`** (recent shipped + immediate next focus) and **`docs/NEXT_SESSION_PROMPT.md`** (read list + summary prompt for **`0020`** / **CR-040**).
- **Why:** Preserve resume context after a stopping point without re-reading the full diff.
- **Files:** `docs/CHECKPOINT.md`, `docs/PROJECT_CONTEXT.md`, `docs/NEXT_SESSION_PROMPT.md`, `docs/CHANGE_HISTORY.md`.

### DOC-009 — Handoff: Needs review bulk category + “categorized on review” semantics
- **Type:** DOC  
- **What:** **`docs/CHECKPOINT.md`** new section **“Next session pickup — Needs review / bulk category”** — documents why bulk **Apply category** can show *Select rows with an open “Unknown category” review item* (UI sends only **`unknown_category`** **`resolution_item`** ids from **`openReviewItems`**; **`TransactionsPage`** **`collectUnknownCategoryResolutionIds`**); and why rows **with categories** can still appear (**`NEEDS_REVIEW_PREDICATE`** / open non-unknown resolution types). **`docs/PROJECT_CONTEXT.md`**, **`docs/NEXT_SESSION_PROMPT.md`** updated to point here.  
- **Why:** Resume after pause without re-discovering behavior in code.  
- **Files:** `docs/CHECKPOINT.md`, `docs/PROJECT_CONTEXT.md`, `docs/NEXT_SESSION_PROMPT.md`, `docs/CHANGE_HISTORY.md`.

---

## 2026-03-29

### FIX-005 — Ledger `search`: hybrid substring + FTS; rebuild migration `0014`
- **Type:** FIX  
- **What:** **`GET /transactions?search=`** no longer requires an **INNER JOIN** on **`ledger_search_fts`** only (empty or stale FTS returned **no rows**). Filter is **`instr(...)` substring OR `EXISTS` … `ledger_search_fts MATCH ?`** (SQLite requires **`MATCH`** on the **virtual table name**, not an alias — alias caused **500**). List order is **date** (newest first), not BM25. Migration **`0014_rebuild_ledger_search_fts`** re-syncs the FTS table from **`transaction_canonical`**. UI copy updated on **Transactions** toolbar.  
- **Why:** Search appeared “broken” when FTS was empty/out of sync or migrations were missing **`0011`**.  
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `backend/db/migrations/0014_rebuild_ledger_search_fts.sql`, `backend/tests/app.test.ts`, `docs/API_LEDGER.md`, `README.md`, `frontend/src/pages/TransactionsPage.tsx`, `docs/CHANGE_HISTORY.md`.

### CR-024 — Ledger search: SQLite FTS5 + BM25 (`0011`, `0013`)
- **Type:** CR + DB  
- **What:** Migration **`0011_ledger_search_fts`** — **`ledger_search_fts`** (body = merchant + memo), backfill, triggers; **`0013`** fixes delete/update trigger bodies for **`undo-import`** / row deletes. **`GET /transactions?search=`** uses **`MATCH`** with token **AND** semantics, **`ORDER BY bm25(...)`** then date.  
- **Why:** Epic **8.3** / **D-010** — ranked full-text search vs substring-only.  
- **Files:** `backend/db/migrations/0011_ledger_search_fts.sql`, `0013_fix_ledger_search_fts_triggers.sql`, `backend/src/modules/ledger/ledger.service.ts`, `backend/tests/app.test.ts`, `docs/API_LEDGER.md`, `frontend/src/pages/TransactionsPage.tsx` (toolbar copy).

### CR-023 — Epic 3.3a: payslip snapshot storage + IBM summary parser + upload API
- **Type:** CR + DB + FIX  
- **What:** Migration **`0012_payslip_snapshot`** (household-scoped payslip rows; **`raw_extract_json`** for parser diagnostics). **`POST /payslips/upload`** (multipart field **`file`**, auth) runs **`parseIbmPayslipPdf`** → **`parseIbmPayslipFromText`** (regex on Current/YTD summary lines); profile id **`ibm_pay_contributions_pdf`**. Dedupe on **`(household_id, file_checksum)`** → **409** **`DUPLICATE_PAYSLIP`** with existing snapshot. Unit tests on **`backend/tests/fixtures/ibm-payslip-sample.txt`**; integration test mocks PDF text extraction to exercise upload + DB. **FIX:** Migration **`0013`** replaces FTS5 delete/update triggers that used invalid **`INSERT … VALUES('delete', rowid)`** (undo-import and canonical **`DELETE`** failed with SQL logic error); **`ledger.service`** FTS join uses **`ledger_search_fts MATCH`** on the table name (no alias) so SQLite accepts the clause.  
- **Why:** Ship **3.3a** (parse + persist + API + tests) without payslip dashboard UI; keep payslip data separate from bank ledger.  
- **Files:** `backend/db/migrations/0012_payslip_snapshot.sql`, `0013_fix_ledger_search_fts_triggers.sql`, `backend/src/modules/payslip/*`, `backend/src/app.ts`, `backend/src/modules/ledger/ledger.service.ts`, `backend/tests/fixtures/ibm-payslip-sample.txt`, `backend/tests/pdf-parsers.test.ts`, `backend/tests/payslip-upload.test.ts`, `docs/PAYSLIP_V1.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### CR-022 — Import workspace: finalize session (review → finalized)
- **Type:** CR  
- **What:** When **`sessionStatus === review`**, **Finalize session** calls **`PATCH /imports/sessions/:sessionId/status`** with **`{ "status": "finalized" }`**. Confirm dialog states finalized sessions are immutable (no undo import). On success: reload session, success message, undo block hidden (not **`review`**). **409** **`INVALID_TRANSITION`** surfaced with readable copy (includes **`from`** / **`to`** when present). Placed next to **Undo ledger posting**.  
- **Why:** Expose session finalize in the UI instead of API-only; align with **CR-021** undo-before-finalize flow.  
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/index.css` (minimal), `docs/API_IMPORT_SESSIONS.md`, `docs/CHANGE_HISTORY.md`.

### CR-021 — Epic 6.3: undo import before finalize + D-014 Categories copy
- **Type:** CR + UX  
- **What:** **`POST /imports/sessions/:sessionId/undo-import`** — while **`status === review`**, delete **`transaction_canonical`** rows sourced from this session’s **`transaction_raw`** (`source_ref`), clear affected **`transfer_group_id`** values, delete related **`resolution_item`** rows (including partner rows in those groups). **`finalized`** → **409** `SESSION_NOT_REVIEW`. Import workspace: **Remove posted transactions from this import**. **`CategoriesPage`:** short **D-014** copy — primary categorization on **Transactions**; this page + rules for taxonomy / automation. Tests: undo + re-canonicalize; finalized rejection. Docs: **`API_IMPORT_SESSIONS.md`**, **`MVP_BACKLOG.md`** Story **6.3**, **`CHECKPOINT.md`**.  
- **Why:** Epic **6.3** acceptance — safe rollback before session finalize; reinforce two-tier category IA.  
- **Files:** `backend/src/modules/imports/import-session-rollback.service.ts`, `imports.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `CategoriesPage.tsx`, `docs/API_IMPORT_SESSIONS.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### DOC-008 — D-014 accepted: two-tier category IA (ledger primary; Categories + Rules secondary)
- **Type:** DOC  
- **What:** **`docs/DECISIONS_LOG.md` D-014** moved from **proposed / partial** to **Accepted**. **Decision:** **Transactions** remain the **primary** categorization surface (**`LedgerCategoryPicker`**, inline create). **`/categories`** and **`/categories/rules`** stay as **secondary** routes — taxonomy browse/add and **pattern-rule** authoring are distinct jobs from row assignment; **no** single merged “ledger hub” for those in MVP. Optional future consolidation (e.g. rules as a tab under Categories) explicitly **out of scope** until usage warrants it.  
- **Why:** Unblock IA ambiguity before real-data rule tuning; aligns with holistic category strategy (ledger for assignment, dedicated surfaces for taxonomy + automation).  
- **Files:** `docs/DECISIONS_LOG.md`, `docs/CHECKPOINT.md`, `docs/MVP_BACKLOG.md`, `docs/API_CATEGORIES.md`, `docs/NEXT_SESSION_PROMPT.md`, `docs/PROJECT_CONTEXT.md`, `docs/CHANGE_HISTORY.md`.

### CR-018 — Epic 11 Story 11.5: Needs review parity + retire `/resolution` UI
- **Type:** CR + IA (**DOC-005**)  
- **What:** **`GET /transactions/:id/open-review`** — open / in_review **`resolution_item`** rows for one canonical id with the same **`context`** enrichment as **`GET /resolution`**. Ledger list (**`needsReview=true`**) **`openReviewItems`** now include **`status`**. **Transactions → Needs review:** **Show** row expansion loads context; per-item **In review / Resolve / Reopen** via **`PATCH /resolution/:id`**; inline category for **`unknown_category`** items in the panel. **Sidebar:** removed **Review queue**. **`/resolution`** route → **`Navigate`** to **`/transactions?needsReview=true`**. **Home** unknown-category banner and **Import** near-duplicate CTA link to Needs review (Import preserves **`sessionId`**). **Deleted** **`ResolutionQueuePage.tsx`**. Tests: ledger **`openReviewItems`** **`status`**, **`open-review`** integration. Docs: **`API_LEDGER.md`**, **`API_RESOLUTION.md`**, **`CHECKPOINT.md`**, **`MVP_BACKLOG.md`**.  
- **Why:** Close **Story 11.5** / **DOC-005** — one primary review surface without maintaining a second queue page.  
- **Intentional gaps:** Near-duplicate **`resolution_item`** rows whose **`target_id`** is a skipped raw line may still not appear under **`needsReview`** until link rules are extended; duplicate/transfer **special-case** UX beyond status/category may still trail the old queue.  
- **Files:** `backend/src/modules/resolution/resolution.service.ts`, `backend/src/modules/ledger/ledger.service.ts`, `ledger.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/App.tsx`, `AppSidebar.tsx`, `DashboardPage.tsx`, `ImportWorkspacePage.tsx`, deleted `ResolutionQueuePage.tsx`, `frontend/src/index.css`, `docs/API_LEDGER.md`, `docs/API_RESOLUTION.md`, `docs/CHECKPOINT.md`, `docs/MVP_BACKLOG.md`, `docs/CHANGE_HISTORY.md`.

### CR-019 — Epic 6: file-level import drill-down (summary API + workspace UI)
- **Type:** CR  
- **What:** **`GET /imports/sessions/:id/summary`** adds per-file and session totals: **`nearDuplicatesFlagged`**, **`openItemsNeedingReview`**, **`notPostedExactDuplicateOrSkipped`** (grouped SQL, no N+1). Import workspace shows **Outcomes by file** — cards with parsed / posted / near-duplicate / not-posted / open-review stats, **View in ledger** (`/transactions?sessionId=…`), **Needs review** when **`openItemsNeedingReview` > 0**.  
- **Why:** Per-file outcomes visible in one place after import.  
- **Files:** `backend/src/modules/imports/session-summary.service.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/index.css`, `docs/API_IMPORT_SESSIONS.md`, `docs/CHANGE_HISTORY.md`.

### CR-020 — Epic 5.2: internal / mobile / EFT / RTP transfer memo scoring
- **Type:** CR  
- **What:** Additional **`transferPairScore`** paths: directional internal transfer memos (**74**), symmetric **mobile/app transfer** (**76**), **book transfer / EFT** (**73**), **RTP / real-time pay** (**72**), **Apple Cash / Google Pay** (**71**); ordering avoids generic `TRANSFER` swallowing specialized lines. New unit + integration tests.  
- **Why:** Fewer **`transfer_ambiguity`** rows for common bank/P2P phrasing without lowering global thresholds.  
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/canonical-ingest.test.ts`, `backend/tests/app.test.ts`.

---

## 2026-03-28

### DOC-007 — PFM competitive UX reference (Simplifi, Rocket Money, Mint)
- **Type:** DOC  
- **What:** Added **`docs/PFM_COMPETITIVE_UX_REFERENCE.md`** — analysis of public positioning/UX from [Quicken Simplifi](https://www.quicken.com/products/simplifi/), [Rocket Money](https://www.rocketmoney.com/), and [Mint](https://mint.intuit.com/) (transition to Credit Karma). **Adopt / adapt / reject** table vs self-hosted scope; backlog-friendly notes; **non-goals** (bank linking, subscription-first hero, SaaS metrics). **`docs/PROJECT_CONTEXT.md`** section + **`docs/DECISIONS_LOG.md`** **D-018**.  
- **Why:** Ground external PFM inspiration in explicit product boundaries so roadmap stays honest.  
- **Files:** `docs/PFM_COMPETITIVE_UX_REFERENCE.md`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS_LOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### CR-017 — Guest home: merged landing + sign-in (retire `/login` page)
- **Type:** CR + UX (IA)  
- **What:** **`/`** for guests is a single **hero landing** with inline **sign-in** form (fintech-style split layout: value props + credential card). Removed standalone **`LoginPage`**; **`/login`** redirects to **`/`**. **`RequireAuth`** and pages that required login now navigate to **`/`** instead of **`/login`**.  
- **Why:** One entry URL; fewer hops; aligns with common consumer finance products that combine marketing and access on one screen.  
- **PRD / backlog:** **PRD** does not mandate a separate login route; **MVP backlog** described “login” as a capability, not a dedicated route — **no PRD deviation** recorded; treat as **IA consolidation** (see **`docs/MVP_BACKLOG.md`** Epic **2.3** wording if updated).  
- **Files:** `frontend/src/pages/HomePage.tsx`, deleted `LoginPage.tsx`, `frontend/src/App.tsx`, `frontend/src/auth/RequireAuth.tsx`, `TransactionsPage.tsx`, `CategoriesPage.tsx`, `CategoryRulesPage.tsx`, `SettingsPage.tsx`, `frontend/src/index.css`, `frontend/README.md`, `README.md`, `docs/CHECKPOINT.md`.

### CR-014 — Epic 11 Story 11.5 (slice): Transactions → Needs review + ledger API
- **Type:** CR  
- **What:** **`GET /transactions`** supports optional **`resolutionType`** (with **`needsReview=true`**) using the same open-item link rules as the queue; when **`needsReview=true`**, each row includes **`openReviewItems`** (`id` + `type`) for **`POST /resolution/bulk`** / **`bulk-apply-category`**, and **`importSessionId`** when derivable from **`raw:`** **`source_ref`**. **Transactions** UI: **Needs review** tab — multi-select type filter, row checkboxes + select-all, bulk status/category, session link column; **Review queue** banner pointing at **`/transactions?needsReview=true`**.  
- **Why:** **DOC-005** / Story **11.5** — one review surface without removing **`/resolution`** yet.  
- **Superseded by CR-018:** standalone **`ResolutionQueuePage`** removed; **`/resolution`** redirects to **`/transactions?needsReview=true`**.  
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `ledger.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/TransactionsPage.tsx`, `ResolutionQueuePage.tsx` *(deleted CR-018)*, `frontend/src/index.css`, `docs/API_LEDGER.md`, `docs/MVP_BACKLOG.md`, `docs/CHANGE_HISTORY.md`.

### CR-015 — Epic 7: cash summary custom date range
- **Type:** CR  
- **What:** **`GET /reports/cash-summary`** accepts inclusive **`dateFrom`** / **`dateTo`** (`YYYY-MM-DD`, max **366** days); **`preset`** optional when both set; **`range.preset`** may be **`custom`**; prior-window comparison uses the same-length previous window (like rolling presets). **Home:** **Custom** period + from/to + **Apply**, URL sync.  
- **Why:** Epic **7.2** gap — presets-only was too limiting for analysis.  
- **Files:** `backend/src/modules/reports/cash-summary.service.ts`, `reports.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/DashboardPage.tsx`, `docs/API_CASH_SUMMARY.md`.

### CR-016 — Epic 5.2: transfer matcher payment / loan tokens
- **Type:** CR  
- **What:** Richer **`transferPairScore`** tokens (e-payment, loan/HELOC/mortgage cues, card networks, asymmetric **card payoff** when credit leg lacks `PAYMENT` but has incoming cues); **`transferPairScore` exported** for unit tests. Integration tests: card payoff + HELOC-style pairing.  
- **Why:** Fewer missed auto-**`transfer_group_id`** links for common payment memos without loosening generic ACH+`THANK YOU` matches.  
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/canonical-ingest.test.ts`, `backend/tests/app.test.ts`.

### FIX-004 — `POST /transactions`: TypeScript narrowing for manual create handler
- **Type:** FIX  
- **What:** **`ledger.routes.ts`** success path structured so **`tsc --noEmit`** accepts **`out.id`** after **`createManualCanonicalTransaction`**.  
- **Files:** `backend/src/modules/ledger/ledger.routes.ts`.

---

## 2026-03-27

### DOC-006 — Handoff: resume context aligned (wrap-up)
- **Type:** DOC  
- **What:** Refreshed **`README.md`** (API ledger line, Epic **11** / shell status — sidebar **Transactions**, **CR-013**), **`docs/NEXT_SESSION_PROMPT.md`** starter bullets, **`docs/PROJECT_CONTEXT.md`** recent shipped + next focus, **`docs/CHECKPOINT.md`** quick file map (**ledger** modules + **`TransactionsPage`**), **`docs/REQUIREMENTS_TRACEABILITY.md`** §13 / Epic **11** line (🟡 partial vs ⬜). Use **`CHECKPOINT.md`** + **`NEXT_SESSION_PROMPT.md`** to resume.  
- **Why:** Clean pickup after a dev session without re-deriving state from code.  
- **Files:** `README.md`, `docs/NEXT_SESSION_PROMPT.md`, `docs/PROJECT_CONTEXT.md`, `docs/CHECKPOINT.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/CHANGE_HISTORY.md`.

### DOC-005 — IA: one review surface (Transactions → Needs review); dual nav until port complete
- **Type:** DOC  
- **What:** Recorded **long-term direction:** all review work should live in **one place** — **`/transactions`**, **Needs review** tab — so items that need attention after import (and other flows) show there instead of treating **`/resolution`** as a separate product area. **Near term:** keep **Review queue** in the sidebar and both routes; backend **`needsReview`** already overlaps much of the queue definition. **Tracked follow-up:** **Epic 11 Story 11.5** in **`docs/MVP_BACKLOG.md`** — port **bulk status**, **bulk category**, type filters, duplicate/transfer/reconciliation actions, raw/session context, and dashboard deep-links; then remove or redirect **`/resolution`** and drop the extra nav item.  
- **Superseded (CR-018):** redirect **`/resolution`** → **`/transactions?needsReview=true`**, sidebar **Review queue** removed, standalone **`ResolutionQueuePage`** deleted — direction above is **done** for the primary IA; residual gaps remain in **`CHECKPOINT.md`**.  
- **Why:** User direction — single command center for transactions + review; avoid losing scope of remaining **`ResolutionQueuePage`** work.  
- **Files:** `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### CR-013 — Epic 11.2: Transactions command center (needs review, filters, manual POST)
- **Type:** CR  
- **What:** **GET `/transactions`** supports **`needsReview`**, **`search`** (substring on merchant+memo), **`amountMin` / `amountMax`**, and returns optional **`reviewReasons`** when **`needsReview=true`**. **POST `/transactions`** creates a **posted** manual canonical row (fingerprint dedupe, optional **`unknown_category`** resolution when uncategorized). **Transactions** UI: **All | Needs review** tabs, sticky filter toolbar (search, account, dates, category, **More filters** for amounts + FTS note), **Why** column on the review tab, **+ Add transaction** modal. Open resolution types for **`reviewReasons`** use a **`SELECT DISTINCT` subquery + `group_concat`** (SQLite rejects **`group_concat(DISTINCT col, sep)`**).  
- **Why:** PRD §13 — ledger as hub; one backend definition for “needs review” with visible reasons per row.  
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `ledger.routes.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/index.css`, `backend/tests/app.test.ts`, `docs/API_LEDGER.md`.

### UX-007 — Epic 11.1 + 11.3 + 11.4: sidebar shell, dashboard scope, Settings
- **Type:** UX + CR (IA)  
- **What:** **Collapsible left sidebar** (collapse persisted `hf_sidebar_collapsed`), **vertical nav** (Home, **Transactions**, Categories, Review queue), **top bar** with **New import** + **Account** dropdown (**Settings** → **`/settings`**, **Sign out**). Mobile drawer + backdrop. **Home:** **Scope** strip — account dropdown at top of dashboard (removed duplicate from period row). **`/settings`** — tabbed **Profile** (stub), **Household** (**`GET/PATCH /household/settings`**), **Accounts** / **Notifications** / **Security** (stubs). User-facing **“Transactions”** replaces **“Ledger”** in nav and primary copy (**`TransactionsPage`** `<h1>`, links from Categories / Rules / Resolution / Home guest card). Removed **`AppHeader`** — replaced by **`AppSidebar`** + **`AppTopBar`**.  
- **As of CR-018:** **Review queue** is no longer a nav item; review is **Transactions → Needs review** (same **`/resolution`** APIs still used from that surface).  
- **Why:** **PRD §13** Phases A, C, D delivery slice.  
- **Files:** `frontend/src/layout/ShellLayout.tsx`, `AppSidebar.tsx`, `AppTopBar.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/pages/DashboardPage.tsx`, `TransactionsPage.tsx`, assorted link text; deleted `AppHeader.tsx`.

### DOC-004 — PRD §13 + Epic 11: Stessa-aligned shell, transactions hub, settings (phased)
- **Type:** DOC  
- **What:** **`docs/FINANCE_APP_PRD.md`** new **§13** (*Application shell, ledger hub, and settings*) — Phases **A–D** (collapsible nav, user menu, Transactions-first IA, **All \| Needs review** with one-sentence definition, sticky filters, **+ Add**, prominent dashboard account scope, **`/settings`** tabs, dual entry for savings target). **Data density** called out as intentional for analysis. **Trash** explicitly **deferred** without soft-delete. Renumbered former §13–§16 to **§14–§17**. **`docs/MVP_BACKLOG.md`** new **Epic 11** (Stories **11.1–11.4**), **P1** Trash note, dependency graph **#9**; planning note under **7.1** points to §13 / **11.4**. **`docs/CHECKPOINT.md`** Epic **11** row + key-doc link + next steps.  
- **Why:** User direction — document target IA before implementation.  

### UX-006 — Monthly savings target: slider + live safe-to-spend preview
- **Type:** UX  
- **What:** Replaced the number field with a **range** control ($0–dynamic max). **Safe to spend** and prorated commitment update **live** from the same formula as **`cash-summary.service.ts`** (`~30.437` days/month, inclusive calendar days). **Save target** is enabled only when the value differs from the server; **Clear** still **`PATCH`es** `null`.  
- **Why:** User direction — explore how the KPI moves before committing.  
- **Files:** `frontend/src/pages/DashboardPage.tsx`, `frontend/src/index.css`.

### PRD-002 — §8 Spending power + savings rate: shipped vs PRD shortcut
- **Type:** PRD  
- **Source:** `docs/FINANCE_APP_PRD.md` §8 (*Spending Power* first-release line: MTD income − MTD expense − monthly target; *Savings Rate* as ratio without rounding detail).  
- **Shipped behavior:** **Safe-to-spend** = **net for the cash-summary window** (not MTD-only) minus **monthly savings target prorated** by **inclusive calendar days ÷ ~30.437**; requires **`household.monthly_savings_target_usd`**. **Savings rate** = **(inflows − outflows) ÷ inflows** when inflows > 0, **two-decimal ratio** via `roundMoney` before UI percent. **Income/expense** in the UI = **posted inflows/outflows** for the preset (transfer exclusions per **CR-004**).  
- **Why:** One API serves rolling 30/90, calendar month, and YTD; avoids a separate “expected income” model in MVP.  
- **PRD updated:** §8 **MVP shipped formulas** + §11 **`monthly_savings_target_usd`**.  
- **Files:** `backend/src/modules/reports/cash-summary.service.ts`, `backend/src/modules/household/*`, `docs/FINANCE_APP_PRD.md`.

### UX-005 — Home KPI definitions: (i) tooltips instead of body copy
- **Type:** UX  
- **What:** Removed the always-visible **`spendingPower.explanation`** paragraph under the KPI grid. **Inflows**, **Outflows**, **Net**, **Safe to spend**, and **Savings rate** labels include a small **(i)** control; **hover** or **keyboard focus** shows a concise tooltip (see **`frontend/src/index.css`** `.kpi-info*`).  
- **Why:** User direction — definitions should feel like optional help, not clutter under the numbers.  
- **Files:** `frontend/src/pages/DashboardPage.tsx`, `frontend/src/index.css`.

### FIX-003 — Migration `0010` not applied: avoid 500 on Home / cash summary
- **Type:** FIX  
- **What:** If SQLite reports **no such column** **`monthly_savings_target_usd`**, **`getHouseholdMonthlySavingsTarget`** returns **null** so **`GET /reports/cash-summary`** still returns **200** (safe-to-spend empty). **`PATCH /household/settings`** returns **503** with **`MIGRATION_REQUIRED`** and a message to run **`npm run db:init`** with the same **`MODE`/`DB_PATH`**.  
- **Why:** Operators may start the API before applying **`0010`**; Home should not hard-fail.  
- **Files:** `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`.

### CR-012 — Safe-to-spend + savings rate on cash summary (Epic 7.1)
- **Type:** CR  
- **What:** **`household.monthly_savings_target_usd`** (migration **`0010`**); **`GET/PATCH /household/settings`**; **`GET /reports/cash-summary`** includes **`spendingPower`**: prorated savings commitment for the report window (~30.437 days/month), **safe-to-spend** = net − commitment, **savings rate** = (inflows − outflows) / inflows. Home dashboard: KPI cards + target form. *(UI copy for definitions: see **UX-005**; PRD alignment: **PRD-002**.)*  
- **Why:** PRD spending-power metric with an explicit, documented formula.  
- **Files:** `backend/db/migrations/0010_household_savings_target.sql`, `backend/src/modules/household/*`, `backend/src/modules/reports/cash-summary.service.ts`, `frontend/src/pages/DashboardPage.tsx`, `docs/API_CASH_SUMMARY.md`, `docs/API_HOUSEHOLD.md`.

### DOC-003 — Docs corrected: resolution queue bulk category already shipped
- **Type:** DOC  
- **What:** At the time, **`ResolutionQueuePage.tsx`** implemented row checkboxes, **`POST /resolution/bulk-apply-category`**, and bulk status via **`POST /resolution/bulk`**. **`docs/CHECKPOINT.md`**, **`docs/MVP_BACKLOG.md`**, **`README.md`**, **`docs/REQUIREMENTS_TRACEABILITY.md`**, **`docs/NEXT_SESSION_PROMPT.md`**, **`frontend/README.md`** had incorrectly listed “bulk category” as missing.  
- **As of CR-018:** that page is **removed**; the same bulk APIs are used from **Transactions → Needs review**. **`GET /resolution`** remains for API clients.  
- **Why:** Align backlog/checkpoint with code + **`docs/API_RESOLUTION.md`**.

### DOC-002 — Epic 10 (P1) — design system, branding, UI polish in backlog
- **Type:** DOC  
- **What:** Added **`docs/MVP_BACKLOG.md`** **Epic 10** with stories: design tokens, optional light/dark (or theme toggle), screen consistency pass, lightweight **`docs/UI_BRAND.md`**. **`docs/CHECKPOINT.md`** row marks ⬜ until shipped.  
- **Why:** Track deliberate branding/beautification work instead of only ad hoc **UX-** entries in **`CHANGE_HISTORY.md`**.

### DOC-001 — Documentation reconciliation (resume context)
- **Type:** DOC  
- **What:** Aligned **`docs/CHECKPOINT.md`**, **`docs/MVP_BACKLOG.md`** (Stories 5.1, 5.2, 7.2), **`README.md`**, **`docs/PROJECT_CONTEXT.md`**, **`docs/REQUIREMENTS_TRACEABILITY.md`**, **`docs/NEXT_SESSION_PROMPT.md`**, **`docs/API_CATEGORIES.md`** with shipped behavior: **classification rules** UI + API, **transfer matcher env** tuning, **cash-summary** comparisons, resolution flows.  
- **Why:** So the next session can rely on **`CHECKPOINT.md`** + **`CHANGE_HISTORY.md`** without re-deriving state from code.

### CR-010 — Classification rules management UI
- **Type:** CR + UX  
- **What:** Authenticated page **`/categories/rules`** — list household rules, add (pattern, match type, leaf category, priority, confidence, enabled), edit row, toggle enabled. Linked from **`/categories`**. Uses **`GET/POST/PATCH /categories/rules`**.  
- **Why:** Close Epic 5.1 loop without API-only rule maintenance.  
- **Files:** `frontend/src/pages/CategoryRulesPage.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/CategoriesPage.tsx`, `frontend/src/index.css`.

### CR-011 — Transfer matcher thresholds configurable via environment
- **Type:** CR + CONFIG  
- **What:** **`MIN_AUTO_TRANSFER_PAIR_SCORE`** and multi-candidate disambiguation thresholds moved from hardcoded constants to **`backend/src/config/env.ts`** (`TRANSFER_*` variables). **`.env`** loaded from **repo root** in `env.ts` for consistent overrides.  
- **Why:** Operators can tune matcher strictness without code changes.  
- **Files:** `backend/src/config/env.ts`, `.env.example`, `backend/src/modules/canonical/canonical-ingest.service.ts`.

---

## 2025-03-25

### UX-003 — Ledger: category column density + status column
- **Type:** UX + CR  
- **What:** Removed the **Status** column from the Ledger (`TransactionsPage`) so the table is less noisy. Category control shows **one line** only: the **selected category’s own name** (leaf or parent), not “Parent / Child” stacked.  
- **Differentiation:** **Leaf** (subcategory): strong text + **blue** left accent. **Parent-only** selection: **slate** text + **neutral gray** left accent. **Uncategorized:** dashed border + muted text.  
- **Why:** User feedback — rows felt too tall; status was not useful on the ledger; single-line label matches mental model (“what I picked”) while still signaling parent vs leaf.  
- **PRD / backlog note:** `MVP_BACKLOG.md` Story 5.3 originally suggested optional “Parent › Child” display; we **deviate** from that for the ledger row **readout** (see **PRD-001**).

### UX-002 — Category picker: modal-style overlay, branding, layout
- **Type:** UX + FIX (layout)  
- **What:** Replaced in-table absolute flyout with **`createPortal` to `document.body`**, **fixed** positioning, viewport clamping, scroll/resize listeners, **dimmed backdrop** (no bleed-through from ledger rows), **three-column** layout (Groups | Subcategories | New category), **DM Sans** + refreshed global accent tokens.  
- **Why:** Prior implementation was clipped by horizontal scroll, required horizontal scroll to see actions, and looked visually thin/transparent over the table.  
- **Reference:** `frontend/src/components/LedgerCategoryPicker.tsx`, `frontend/src/index.css`, `frontend/index.html`.

### FIX-002 — Migration `0008` foreign key on fresh init
- **Type:** FIX  
- **What:** `0008_income_taxes_transfers_taxonomy.sql` inserts rows with `parent_id` = **Income** before seeds run; **migrations execute before seeds**, so Income did not exist → `SQLITE_CONSTRAINT_FOREIGNKEY` during `npm test` / `db.sh --init --seed`. Fixed by **`INSERT OR IGNORE`** for Income at the top of `0008`.  
- **Why:** Ordering invariant (migrations vs seeds) — documented so future migrations that reference seed-only parents repeat the same pattern.  
- **See also:** DB-001.

### DB-001 — Taxonomy migration `0008` (Income, Taxes, Transfers)
- **Type:** DB  
- **What:** `backend/db/migrations/0008_income_taxes_transfers_taxonomy.sql` adds Income **leaves** (Salary, Interest, Dividends, Refunds), reparents **Rental income** under Income, adds **Taxes** and **Transfers** parents + leaves. **Income parent row** must exist in migration for FK integrity.  
- **Aligned code:** `category-ids.ts`, `category-rules.ts`, tests in `category-rules.test.ts`.

### CR-004 — Cash summary: exclude transfer-linked rows from aggregates
- **Type:** CR  
- **What:** Reporting treats **transfer** rows as non-P&L for income/expense/category buckets when `transfer_group_id` is set or an open `transfer_ambiguity` resolution item targets the row. Implemented in `cash-summary.service.ts` + tests.  
- **Why:** Avoid double-counting income/expense when moving money between accounts.  
- **PRD alignment:** Matches D-006 (transfer semantics) in spirit.

### CR-003 — Transfer matcher (minimal) + ambiguity queue
- **Type:** CR  
- **What:** After canonical ingest, **minimal** pairing of debit/credit across accounts (amount match, date window, distinct accounts) sets **`transfer_group_id`**; ambiguous cases create **`resolution_item`** `type = transfer_ambiguity`.  
- **Why:** Foundation for Story 5.2; conservative automation with human escape hatch.  
- **Backlog:** `MVP_BACKLOG.md` Story 5.2 — still **partial** (not all payment patterns).

### CR-002 — Taxonomy: Income children, Taxes, Transfers
- **Type:** CR  
- **What:** Expand default taxonomy per **Income** subtypes and **Taxes** / **Transfers** groups (see DB-001). Rules map inflows to **leaf** income categories where appropriate.  
- **Why:** User direction — real-world buckets and reporting clarity.

### CR-001 — Ledger-first category UX (flyout + inline create)
- **Type:** CR  
- **What:** **`LedgerCategoryPicker`** on ledger rows: parent groups + subcategories, **Clear selection**, **`POST /categories`** for new parent or subcategory without leaving the page. **Supplements** `/categories` (not removed yet).  
- **Why:** Aligns with **D-014** — primary categorization from the ledger.  
- **See:** `frontend/src/components/LedgerCategoryPicker.tsx`, `frontend/src/pages/TransactionsPage.tsx`.

---
## 2026-03-25

### CR-009 — Transfer matcher: payment-pattern coverage + ambiguity guardrails
- **Type:** CR + FIX
- **What:** Extended transfer matching to score explicit **credit-card/loan payment** wording variants (`payment to`, `payment received`, `ach payment`, `autopay`, `loan`, etc.) while keeping conservative thresholds. Added tests for unambiguous payment pairing with date skew + memo variants, multi-candidate ambiguity queue behavior, and cash-summary exclusion for `transfer_ambiguity` rows.
- **Why:** Reduce `transfer_ambiguity` noise for common payment flows without increasing false positives.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/app.test.ts`.

### CR-005 — Resolution queue: type filter + unknown_category surfaced
- **Type:** CR + UX
- **What:** Added **resolution item type filtering** to `GET /resolution` (unknown_category, duplicate_ambiguity, transfer_ambiguity, etc.) and a **dashboard banner** that counts open `unknown_category` items and links to the queue.
- **Why:** “We don’t know this merchant” must become a first-class action path.
- **As of CR-018:** banner links target **Transactions → Needs review**; no dedicated queue page.
- **Files:** `backend/src/modules/resolution/resolution.routes.ts`, `backend/src/modules/resolution/resolution.service.ts`, `frontend/src/pages/ResolutionQueuePage.tsx` *(removed CR-018)*, `frontend/src/pages/DashboardPage.tsx`.

### UX-004 — Resolution queue: inline category assignment for unknown_category
- **Type:** UX
- **What:** For `unknown_category` rows, users can assign a category inline (using the same ledger category picker). The flow updates the linked ledger transaction (`PATCH /transactions/:id`) and resolves the resolution item.
- **Why:** Keep review + assignment in one workflow (don’t bounce between screens).
- **As of CR-018:** same flow on **Transactions → Needs review** (**`ResolutionQueuePage`** removed).
- **Files:** `frontend/src/pages/ResolutionQueuePage.tsx` *(removed CR-018)*, `frontend/src/pages/TransactionsPage.tsx` *(current)*.

### CR-006 — Transfer matcher: description/merchant+memo scoring
- **Type:** CR
- **What:** Extended the minimal transfer matcher to use **description-based scoring** (merchant/memo patterns like TRANSFER/XFER/ZELLE/WIRE/WEB PAY plus normalized description match) to pick the best match when multiple candidates exist; also widened the date tolerance slightly (still conservative).
- **Why:** Reduce the number of rows that end up as `transfer_ambiguity` while avoiding aggressive false positives.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`.

### CR-007 — Dashboard drill-down into ledger (category + account)
- **Type:** CR + UX
- **What:** Added chart/table drill-downs from the cash dashboard into the ledger:
  - Pie slices and “By category (period)” rows navigate to `/transactions` with `dateFrom/dateTo` plus `categoryId` (or `uncategorizedOnly=true`).
  - “By account” table includes a **View** link into `/transactions` with the same date window and `accountId`.
- **Why:** Connect aggregates to underlying ledger rows for fast validation and correction.
- **Files:** `frontend/src/pages/DashboardPage.tsx`.

### CR-008 — Ledger list filters: support `accountId`
- **Type:** CR
- **What:** Added `accountId` as an optional filter on `GET /transactions` so dashboard drill-down can pre-filter to a single account.
- **Files:** `backend/src/modules/ledger/ledger.routes.ts`, `backend/src/modules/ledger/ledger.service.ts`, `frontend/src/pages/TransactionsPage.tsx`.

### CR-009 — Transfer matcher hardening: anti-false-positive guardrails
- **Type:** CR + FIX
- **What:** Tightened transfer matching so generic “payment” words alone do not auto-match; matcher now requires directional complement or card/loan context for payment-style pairing. Added ambiguity telemetry (`candidateScores`) in `transfer_ambiguity.reason` JSON for easier triage/debugging.
- **Why:** Reduce false positives while preserving useful auto-match for genuine card/loan settlement flows.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/app.test.ts`.

---

## PRD / design deviations (rolling)

### PRD-002 — Cash-summary safe-to-spend + savings rate vs §8 shortcut (summary)
- **Source:** `docs/FINANCE_APP_PRD.md` §8.  
- **Current behavior:** Windowed **net** minus **prorated monthly savings target**; **savings rate** from **ledger inflows/outflows** with **two-decimal** ratio rounding; **transfer exclusions** on aggregates (**CR-004**).  
- **Why:** Single reporting API for all date presets; explicit formulas in **`docs/API_CASH_SUMMARY.md`** and PRD §8 **MVP shipped formulas**.  
- **Full entry:** Dated block **PRD-002** above (2026-03-27).

### PRD-001 — Ledger category cell display vs Story 5.3 wording
- **Source:** `MVP_BACKLOG.md` Story 5.3 (optional “Parent › Child” in table).  
- **Current behavior:** **Single line** — show only the **name of the assigned `category_id`** (whether that ID is a parent or a leaf). Visual cues distinguish parent vs leaf (**UX-003**).  
- **Why:** Usability and row height; user preference.  
- **If we change later:** Drill-down or tooltip could show full path without widening rows.

---

## How to use this file

- When you ship a user-visible tweak or fix a surprising behavior, add a **short entry** with ID, **what**, **why**, and file pointers if non-obvious.  
- When a decision **contradicts** the PRD or backlog text, add or update a **PRD-** bullet here and optionally a one-line pointer in **`docs/DECISIONS_LOG.md`**.  
- **Implementation status** was summarized in **`docs/archive/CHECKPOINT.md`** (archived); this file remains the **audit trail** for shipped changes.
