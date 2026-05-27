# Grove — Product Backlog

Board-style reference for shipped, active, and deferred items. Status: Shipped | Active | Deferred | Dropped. Priority: P1 (critical/quick) | P2 (high value) | P3 (nice to have).

---

## Shipped — V4 (2026-05-15 to 2026-05-25)

All items shipped in V4 release cycle with their reference IDs.

| ID | Title | Type | Description |
|---|---|---|---|
| **R-1** | Post-restore `force_password_change` | Security | After household restore, all sessions invalidated via token_version bump. Users forced to change password on next login. Shipped 2026-05-17. |
| **R-2** | BY ACCOUNT card — add YoY delta arrow alongside MoM | UX | Each account row now shows two arrows: existing MoM (vs prior month) and new YoY (with year label). Same ±5% threshold and `count < 3` guard. Shipped 2026-05-18. |
| **R-3** | Remove `checking` from `LIABILITY_ACCOUNT_TYPES` | Bug fix | Checking is liquid asset, not liability. Fix on dashboard BY ACCOUNT card: removes `"checking"` from constant at line 175. Shows gold ↑ (neutral) not terracotta (bad) for checking outflow increase. Shipped 2026-05-18. |
| **F-6** | Dashboard + Net Worth caching with session refresh icon | Performance | Cache `GET /reports/cash-summary` and `GET /reports/balance-sheet` in sessionStorage. Refresh icon (top-right KPI card) triggers fresh fetch + tooltip "Last updated X min ago." Invalidates on import finalize. Shipped 2026-05-19. |
| **F-6b** | Net Worth snapshot + per-account row-expansion history cache | Performance | Extends F-6: caches balance-sheet snapshot (1-hour TTL) and per-account history (7-day TTL). Uses existing refresh icon and "networth" scope from F-6 — no new UI. Shipped 2026-05-20. |
| **TM-1** | Transfer matching — bump date tolerance from 2 → 4 days | Bug fix | ACH transfers routinely take 3 days. Widened window from ±2 to ±4 days without increasing false-pair risk. Same-account exclusion and pair score threshold (45) still apply. Integration test added. Shipped 2026-05-19. |
| **F-1** | In-app notification system + budget/operation alerts | Feature | Unified notification center: bell icon in top bar, dropdown panel, Settings → Notifications tab. Per-type preferences (email + in-app). Triggers: export ready, restore complete, backup success/fail, property valuation refresh, budget threshold (80%, 100%), large transaction. Migration 0047, `notification.service.ts`, `notification.routes.ts`. Shipped 2026-05-25. |
| **F-2** | Balance sheet member subtotals | Feature | Summary section at bottom of Net Worth page showing ALL members simultaneously: table with Member | Assets | Liabilities | Net Worth. Collapsible, renders only when 2+ members. Grouped by `owner_person_profile_id`. Shipped 2026-05-19. |
| **F-3** | Payslip enhancement pass | Feature | **PS-1:** MoM delta badges (net, gross, taxes, deductions vs prior payslip). **PS-2:** Investment contribution grouping (retirement, equity, health) with YTD totals. **PS-3:** Savings / wealth-building rate (% gross to pre-tax contributions, YTD). **PS-4:** Tax sufficiency signal (annualised federal withholding rate vs 20% benchmark). Shipped 2026-05-22. |
| **PS-2b** | Post-tax contribution grouping (ESPP, after-tax 401k, mega backdoor Roth) | Feature | Extends PS-2: groups post_tax_deductions (ESPP, after-tax 401k, Roth In-Plan) into buckets. Displays "Post-Tax Savings" card alongside pre-tax breakdown. Extends `computeSavingsRate` to optionally include post-tax in wealth-building rate. Shipped 2026-05-24. |
| **PS-5 Phase 1** | Tax filing profile — stored effective federal rate | Feature | Stores `effective_federal_rate_ytd` and `effective_total_tax_rate_ytd` on `payslip_snapshot` at import time. `TaxSufficiencyAlert` prefers stored values with fallback. Eliminates fragile runtime line-item detection. Migration 0048. No LLM changes. Shipped 2026-05-23. |
| **TM-2** | Transfer pair visibility + manual pair/unpair UI | Feature | **Transactions page:** "Transfer status" filter (Paired, Unpaired transfer). Paired transactions show "↔ Transfer" badge. Manual pair: select two transactions → "Mark as transfer pair" → `POST /transactions/pair`. Unpair: "Remove transfer pair" → `DELETE /transactions/pair/:groupId`. Shipped 2026-05-22. |
| **TM-4** | Near-duplicate detection — remove description gate | Bug fix | BoA CSV (masked digits) vs BoA PDF (real digits) fail substring check. Option 1 (selected): remove `descriptionsCompatibleForNearDuplicate()` gate. Same-account + same-date + same-amount + different fingerprint → `status = 'duplicate'` with `duplicate_ambiguity` item. False positives (two same-price same-day coffees) acceptable in resolution queue. Shipped 2026-05-22. |
| **F-4** | Delete property | Feature | Remove property record and snapshot history. Cascades snapshots via FK. `DELETE /household/properties/:propertyId` auto-unlinks mortgage with warning. Returns `{ unlinkedAccounts: N }`. Frontend: trash icon + ConfirmDialog. Shipped 2026-05-22. |
| **F-5** | Account closed/inactive status | Feature | Mark account as closed. Closed accounts: excluded from import binding dropdowns, excluded from AI insights net-worth context, show "Closed" badge in Settings (collapsed by default), still appear in Net Worth with last snapshot (historical accuracy), still in Transactions ledger. Migration 0047. `GET /imports/accounts?includeClosedAccounts=true`. Shipped 2026-05-22. |
| **F-8** | BY ACCOUNT card — full redesign pass | UX | **Account types:** credit_card, checking, savings only (loan/investment/retirement excluded). **Row cap:** top 3 credit cards + top 3 checking/savings = 6 max. **Metric:** transaction outflow (thisMonthOutflow) not balance. **Arrows:** MoM + YoY after R-2. R-3 color fix prerequisite. Shipped 2026-05-18. |
| **I-10** | App-wide error logging audit | Reliability | Audit all Express async route handlers for missing try-catch (unhandled rejections crash process). Audit service functions for silent early returns. Audit external API calls (RealtyAPI, OpenAI, Google Drive, SMTP) for consistent logging: on start (info), on success (info), on failure (error). Audit scheduler functions. Add log line at every background operation start. Shipped 2026-05-24. |
| **I-12** | "Other" category hyperlink on WHERE MONEY WENT card | UX | Top-5 spending categories are Anchor links to Transactions filtered by category. "Other" catch-all bucket was plain Text (non-clickable). Fix: carry constituent category IDs on Other slice, build URL with `categoryIds[]=...` params. Transactions page already supports multi-value filter. Shipped 2026-05-19. |
| **I-8** | Playwright E2E test suite | Reliability/Test | 13 tests across 3 suites: auth flow (login/logout/guard), navigation/layout (sidebar links, page titles), transactions ledger (filter, date range, aggregate strip). Runs against live dev stack with `e2e@example.com` test user. `npm run test:e2e` command. Shipped 2026-05-25 (CR-226). |
| **ESPP-1** | IBM ESPP Equity Tracker | Feature | Full ESPP tracker: EquatePlus PDF/CSV import (multi-batch CSV support), purchase batch table with expandable sale history, Record Sale modal with live OI/CG preview, year summary strip (10 KPIs). OI and cap gain/loss computed server-side. Payslip auto-linkage for IBM-authoritative discount. Migration 0052. GitHub issue #31. Shipped 2026-05-27. |
| **F-7** | AI Year-End "Wrapped" financial summary | Feature | Manual "Generate Year Summary" button (Jan–Mar visible). Surfaces: full-year income/spending/net savings/savings rate + YoY, top 5 categories, best/worst month, net worth change, investment growth, largest transaction, top merchant. LLM narrative (2–3 paragraphs). Email delivery via F-1 notification. Shipped 2026-05-24. |
| **F-9** | Recurring payments — display name field in tag modal | UX | `RecurringTagModal` has no `displayName` input, so confirmed rules always show raw merchantKey. Add optional "Display name" TextInput. Frontend-only, no backend change. Both TransactionsPage and SettingsPage pass `displayName` in POST body. Shipped 2026-05-22. |
| **F-10** | Cash account — auto-update balance snapshot on manual transaction | Feature | When manual transaction recorded against cash account, auto-compute and upsert balance snapshot. `POST /ledger` (create): `snapshot + amount`. `DELETE` (delete): `snapshot - amount`. `PATCH` (edit): `snapshot - old + new`. No schema migration (manual-source snapshots already exist). Cash-only scope. Shipped 2026-05-22. |

---

## Shipped — V3 (2026-04-15 to 2026-05-14)

Major feature release with infrastructure, enrichment, and reporting.

| ID | Title | Type | Description |
|---|---|---|---|
| **B-1** | Transfer confirm button missing after partial candidate dismissal | Bug | Confirm button never appeared: ingest wrote `creditCandidateIds` (array) but confirm required `creditId` (singular). Fix: debit-only resolution items; UI radio picker for candidate selection; one confirm button regardless of count. Shipped 2026-05-10. |
| **B-2** | Dismissed transfer items re-surface on every import | Bug | Canonical row had no memory of dismissal. Migration 0040: add `transfer_excluded BOOLEAN` to `transaction_canonical`. Dismiss path sets flag. Ingest skips excluded rows. Shipped 2026-05-10. |
| **B-3** | Multi-day same-amount transfers create cross-match ambiguity | Bug | Two $10k transfers (Sep 30, Oct 1) each claimed same two credit candidates. Debit-only model solves naturally: each debit gets own item with full candidate list. First debit to confirm claims credit; other debit shows "no candidates" on next load. Shipped 2026-05-10. |
| **B-4** | Marcus PDF parser — ACH deposits silently dropped | Bug | PDF columnar layout with wrapped description text breaks `pdf-parse` text extraction. `pendingLine` state machine accumulates lines until ≥2 amounts appear, then joins and parses. Pre-scan extracts Beginning/Ending Balance. Shipped 2026-05-08. |
| **B-5** | Import "Belongs To" not auto-set when account selected | Bug | `onAccountChange` read `ownerScope` from draft instead of from account object. Fix: read `account.owner_scope` first, fall back to draft. Same fix in OFX auto-detect block. Frontend-only. Shipped 2026-05-08. |
| **B-6** | Transactions page — incomplete Mantine migration + non-clickable subcategory picker | Bug | Category picker custom CSS, group/sub-group alert custom class, "Add subcategory" non-clickable (z-index/focus-trap). Completed Mantine migration, fixed subcategory picker interaction. Shipped 2026-05-08. |
| **B-7** | AI insight cooldown — in-memory → DB-backed | Security | Rate-limit Map resets on restart, allows unbounded API cost. Replaced with DB query on `insight_job` table; 5-min window check. Shipped 2026-05-09. |
| **B-8** | Settings — Add custom institution uses `window.prompt` | Bug | Native browser prompt for institution name — outlier in app using custom modals. Replaced with Mantine modal. Fixed rendering z-index by extending `HierarchicalSearchPicker` footer prop. Shipped 2026-05-12. |
| **F-1** | Account enrichment (sub_type, memo, liquidity, linked_account_id, health/education types) | Feature | Migration 0041: adds `memo`, `sub_type`, `liquidity` (liquid/semi_liquid/restricted), `linked_account_id` (self-ref), `property_id` FK. Expanded types: health (HSA/FSA/HRA/ABLE), education (529/Coverdell). Removed `mortgage` top-level. UI: HierarchicalSearchPicker for type→subtype picker, memo Textarea, liquidity Select. Shipped 2026-05-10. |
| **F-2** | Real estate account type + home equity display | Feature | No new `real_estate` account type; property data on dedicated `property` table linked to mortgage via FK. `property` table: address, property_use (primary/rental/vacation), api_provider, api_property_id. `property_value_snapshot` table: time-series. Backend: property CRUD routes. UI: `+ Property` button on mortgage accounts, address modal, market value entry. Net Worth display (CR-171): Real Estate subsection with expand-on-click value history chart. Shipped 2026-05-10. |
| **F-3** | Net worth — liquidity breakdown | Feature | Summary section on net worth page: Liquid, Semi-liquid, Restricted, Uncategorized tiers. Computed from `liquidity` field on each account + property market values (always restricted). Shows when 1+ assets tagged or any property has value. Shipped 2026-05-10. |
| **F-4** | Per-account balance history chart (expand-on-click) | Feature | Click account row → inline expand reveals Recharts LineChart of balance over time. Backend API already built (`GET /reports/balance-sheet/history?accountIds=X`). Frontend-only. Shipped 2026-05-09. |
| **F-5** | Payslip deposit matching — stored pairing + improved matching logic | Feature | Migration 0045: `payslip_deposit_match` join table (1-to-N per payslip). `GET /payslips/:id` returns `confirmedDeposits` + `suggestedDeposits` (dynamic only when no confirmed). `PUT`/`DELETE /payslips/:id/deposits/:canonicalId` mutate links. Search window ±7 calendar days + `pay_period_end` fallback (±10); `status = 'posted'` filter. UI: confirmed with Remove buttons, suggestions with Confirm + confidence, "Search ledger..." modal for manual link. Shipped 2026-05-14. |
| **F-7** | AI insights — fix transfer and flow pollution in spending data | Feature | Insight queries filter `transfer_group_id IS NULL`. Extended: exclude `transfer-category` transactions, separate tax/income fields, annotate prompt. Completed in I-3. Shipped 2026-05-10+. |
| **F-8** | Money flow classification in reports | Feature | Category tree already encodes semantics. Query filters exclude Transfers, Loans, Borrowing, Investments from lifestyle spend. Split outflow/inflow by flow class. Completed in I-3. Shipped 2026-05-14. |
| **F-9** | Date of birth — encrypted at rest, computed age | Feature | Migration 0042: add `date_of_birth_encrypted TEXT` to `person_profile`. AES-256-GCM encryption (JWT_SECRET-derived key). `decryptDob` on read. API: write `dateOfBirth`, read computed `age`. Profiles without DOB fallback to manual `age`. Export strips DOB (instance-specific key). AI insights decrypts for household-level age. Shipped 2026-05-10. |
| **F-10** | Transaction aggregation strip | Feature | **Transactions page:** server-backed totals + breakdowns over full filtered ledger (not page). `GET /transactions/aggregate` mirrors list filters. Headline: Net / Inflows / Outflows / Avg / Date span. Context stats (category/account/month counts when >1). By-month tab (last 6 months). Frontend: HierarchicalSearchPicker multi-select (category, account, belongs-to), TransactionAggregateSummary strip. Shipped 2026-05-11. |
| **F-11** | Record cash payments (manual ledger entry) | Feature | New `cash` account type (not institution, not account side). Reuses account + manual ledger + balance snapshot. "Cash & Wallet" built-in institution. `type='cash'` → `defaultLiquidity='liquid'`. AI insights rolls into `checkingSavingsTotal`. Shipped 2026-05-12. |
| **I-1** | Personal loan tracker | Enhancement | Decided: category-based tracking sufficient. `Loans > Personal` = informal lending (not discretionary or bank obligation). AI system prompt updated to explain distinction. No new schema. Shipped 2026-05-14. |
| **I-3** | Category / reimbursement taxonomy cleanup | Maintenance | `Income > Reimbursements` stays under Income (genuine cash-positive inflows). Zelle rule removed (too broad). Builtin rules fixed: gas→Fuel, parking/toll→Parking & Tolls. `APPLE` rule narrowed to `APPLE STORE` (fixed 40 Apple Pay miscats). Household master CSV fully audited + synced; 12 new rules added. `Bonds` and `Rental Prop` added to bootstrap. Shipped 2026-05-14. |
| **I-4** | Password reset token cleanup | Maintenance | `purgeStalePasswordResetTokens` runs on hourly export purge schedule. Shipped 2026-05-12. |
| **I-5** | Export/restore housekeeping | Maintenance | Restore staging `.hfb` deleted in `finally`. Successful restore shows yellow alert to reconnect Google Drive. Shipped 2026-05-12. |
| **I-6** | Drive query string escaping | Security | `listHfbFilesInFolder` validates `folderId` with `^[\w-]+$` before Drive API `q` interpolation. Shipped 2026-05-12. |
| **UX-166** | Consistent currency display — comma-separated thousands | UX | Shared `formatUsd` utility; dollar display (toFixed(2)) replaced across payslips, dashboard, import reconciliation, settings, recurring anchor. Shipped 2026-05-12. |
| **UX-167** | Cash register input for dollar amount fields | UX | `CurrencyInput` wrapper on `react-currency-input-field` with Mantine Input.Wrapper. Wired into net worth balance, settings, budget, payslip manual, manual transaction. Shipped 2026-05-12. |
| **UX-174** | Forest Studio — design tokens, terracotta money semantics | UX | CSS `--fs-*` palette + `chartPalette.ts`. Mantine `fsForest` / `fsTerracotta` / `fsGold`. Dashboard/net worth/budget/payslips/transactions badge colors updated. Sidebar **Daily / Reports / Setup** groups. Warm-cream active nav. Removed `DashboardPage` shim. Shipped 2026-05-10. |
| **UX-175** | Forest Studio prompt #2 — dashboard badges, forest sweep, gold alerts, brand, bars | UX | Dashboard badges → gray + Tabler icons. Positive `c="green"` / greens → `fsForest`. Informational alerts → `fsGold variant="light"`. Sidebar collapse hides brand. Spending card → ranked horizontal bars. Shipped 2026-05-11. |
| **UX-176** | Forest Studio Phase F — authed shell width cap + Inter Tight typography | UX | Main column capped at 1500px centered. **Inter Tight** on Google Fonts for `h1`–`h4` / Mantine Title. Larger `.kpi-value`. Shipped 2026-05-11. |
| **D-2** | Real estate auto-valuation (market value API) | Enhancement | Provider: Redfin via RealtyAPI.io (250 req/month free tier). Backend: `/properties/preview-valuation` + `/properties/:id/refresh-valuation` + monthly scheduler + `ValuationDetail` JSON (AVM, last sold, tax history, 6 comps). Migration 0046. Settings modal: "Retrieve/Update Redfin estimate" button. Net Worth: refresh icon button. Shipped 2026-05-15. |

---

## Shipped — Earlier (Ongoing)

Ongoing features and infrastructure shipped before V3/V4 planning cycles.

| ID | Title | Type | Description |
|---|---|---|---|
| **CR-121/122/123** | Recurring payments phases 1–3 | Feature | Override store, transaction tagging, dashboard dismiss/confirm, Settings recurring management. `recurring_merchant_override` table. Merchant string + amount anchor matching. Shipped pre-V3. |
| **CR-109** | RBAC redesign (owner/admin/member roles) | Feature | Multiuser household support with role-based access control. Shipped 2026-04-15. |
| **SEC-153/154** | Pre-release security hardening | Security | `storagePath` removed from 404, crypto.randomBytes for temp passwords, JWT_SECRET required in PROD, GDrive token encrypted (AES-256-GCM), scope narrowed to `drive.file`. Shipped 2026-05-06. |

---

## Active Items — Planned

Features and improvements in active design/planning phase for V4+.

### High Priority (P1/P2)

(All V4 P1/P2 items are shipped. Next active planning in V5.)

### Medium Priority (P3)

| ID | Title | Status | Description | Priority |
|---|---|---|---|---|
| **I-2** | Async payslip upload + import parse/canonicalize | Deferred | Apply 202/poll pattern to long-running ops: `POST /payslips/upload` (OpenAI risk), `POST /imports/sessions/:id/parse`, `POST /imports/sessions/:id/canonicalize`. Export/restore already async + proven. | P3 |
| **I-7** | Recurring payments — phases 4+ | Deferred | Annual subscription detection (CV + 2-month gate misses annuals). Upcoming bill prediction. Per-transaction exclusion from recurring pattern. Enhancement to shipped phases 1–3. | P3 |
| **T-1** | Documentation consolidation | ✅ SHIPPED (DOC-217, 2026-05-25) | Reduced 40+ markdown files to 5 canonical docs: `USER_GUIDE.md` (enhanced), `ADMIN_GUIDE.md` (new — consolidates RUNBOOK, PRODUCTION_SETUP, HOSTING_OPTIONS, DATABASE_ARCHITECTURE, ENVIRONMENT_VARIABLES, ARCHITECTURE, CACHING, IMPORT_CLASSIFICATION, EMAIL_INFRASTRUCTURE, OCI_DEPLOYMENT), `BACKLOG.md` (new Jira-style board — consolidates all backlog files, V3/V4 history), `PRD_AND_CRS.md` (new — consolidates all archive docs), `CHANGE_HISTORY.md` (unchanged). API docs and openapi.yaml untouched. README and CLAUDE.md updated. | P3 |

---

## Deferred Items — Future Versions

Items explicitly deferred with decision reasoning.

| ID | Title | Version | Reasoning | Notes |
|---|---|---|---|---|
| **D-1** | Data archival + encrypted Drive archive | V5+ | Foundational reporting (F-7/F-8) must ship first. Pays off at 2+ years of data. Postgres free tier (500MB) sufficient now. Design `monthly_report` schema with archival in mind first; no implementation yet. | Pre-compute monthly summaries; prune raw data on user-configured window. |
| **D-4** | Multi-household support | V5+ | Email canonical identity; `user_household_membership` join table. RBAC already works for single-household (target use case). Migration touches auth, JWT, every service query — risk outweighs benefit for v1. Full design captured in Feature Backlog §Multi-Household Support below. | Invite codes, create-your-own household, household switcher in top bar. |
| **D-3** | Rental income tracking | ~~Deferred~~ **DROPPED** | Scope creep — app is not a rental property management tool. `linked_account_id` schema hook already in place for future HELOC if ever needed. Removed from backlog permanently 2026-05-15. | — |
| **D-5** | HELOC modeling | ~~Deferred~~ **DROPPED** | User does not have a HELOC. `financial_account.linked_account_id` (added F-1) supports future pairing. No code needed beyond existing column. Removed permanently 2026-05-15. | — |
| **PT-1** | Property tax protest assistant (ARB) | V5+ (needs grooming) | User's Denton County ARB hearing June 8, 2026 (may do manually this year). **Subject property extraction shipped** as CR-187/CR-188 (part of D-2). CAD data integration (unequal appraisal evidence) remains deferred. Full design in Feature Backlog §Property Tax Protest below. | Data collection, storage, protest tracking, LLM strategy layer. DCAD has JSON API. |
| **FR-15** | Household staff module (timesheets, expenses, payments) | V5/V6 candidate | Full timesheet + expense + payment for household employees (nanny, cleaner, au pair). `staff` RBAC role. Admin review, approval, payment recording with ledger posting. No code yet. Target delivery ~Q3/Q4 2026. See PRD_AND_CRS.md §3.10. | Schema (designed): `staff_profile`, `timesheet_entry`, `timesheet_period`, `staff_expense`, `staff_payment`. |
| **PS-5 Phase 2** | Tax filing profile — full computation | ❌ NOT DOING (decision 2026-05-24) | Computing "are you under-withheld?" requires household total income, deductions, credits — tax software territory. Not every payslip has W-4 data (Deloitte doesn't); auto-population partial. Phase 1 (stored effective_federal_rate_ytd) is the right stopping point. Year-end Wrapped (F-7) can surface rough "your federal withholding was X% of gross" flag. | — |
| **I-11** | PWA file-input hang — File System Access API fallback | Deferred (post-V4) | Chrome installed-app (PWA) mode blocks `<input type="file">.click()`. Safari PWA works correctly. File System Access API (`window.showOpenFilePicker`) works in PWA mode as fallback. Affected flows: import file upload, backup/restore upload, category rules CSV import. Revisit if Safari PWA adoption increases or Chrome PWA adoption forces the issue. | — |
| **ESPP-1** | ESPP equity tracker | V5 | IBM ESPP purchase, transfer, and sale tracking for tax and P&L visibility. One PDF + one CSV uploaded together per transfer event. Two DB tables: `espp_batch` (purchase date, shares granted, FMV/share, cost basis/share, discount/share, shares_transferred) + `espp_sale` (time-series: batch_id, sale_date, shares_sold, sale_price). Batches upserted by allocation date so CSV rows from multiple periods update the right record. Multi-batch sale form (one date, N rows). Year summary strip: shares purchased/transferred/outstanding/sold, total invested, discount YTD, proceeds YTD, realized gain/loss, ordinary income YTD, cap gain/loss YTD. Tax: disqualifying disposition — ordinary income = discount × shares sold; cap gain = (sale price − FMV) × shares sold. Full design spec in Feature Backlog Detail below. | — |

---

## Dropped Items — Permanently Removed

Items removed from active backlog with explicit reasoning.

| Item | Reason | Decision Date |
|---|---|---|
| **TM-3** | Transfer matching — same-institution score boost | Premise false: OFX parser never produces truly empty memo (`"OFX Transaction"` fallback = identical-memo pairs score 100 and auto-pair). No evidence of failure mode in 3,500 production transactions. Transfer resolution queue healthy. Complexity outweighs benefit. | 2026-05-19 |
| **I-9** | Fuzzy match categorization (Tier B) | Problem already solved: `contains` rules match trailing-code variants without fuzzy matching. Rule-from-assignment popup + recategorization backfill covers merchant memory. Jaro-Winkler on short messy bank strings prone to false positives. Complexity outweighs benefit. | 2026-05-23 |
| **ADP payslip / Capital One CSV parsers** | No personal value; vestigial. Revisit only if employer/bank changes. | Pre-V3 |
| **OneDrive backup (Phase 2)** | Google Drive works; OneDrive adds complexity for no personal gain. | Pre-V3 |
| **CR-095a: Self-service signup** | Personal home app only; no public release planned. | Pre-V3 |
| **I-2 legacy (Async 202 for import/parse/canonicalize)** | Import already async + stateful. 504s not a live problem. Deprioritized. (Note: I-2 remains as deferred enhancement for future.) | Pre-V3 |
| **Import pipeline API consolidation** | Works well; consolidation is polish with no user-visible benefit. | Pre-V3 |
| **Transfer pair dissolution** | No transfer pair UI; building it requires significant new surface. (Note: unpair now shipped in TM-2 2026-05-22.) | Pre-V3 |
| **Category memory (Tier A)** | Household rules + "create rule" popup already serve need. Tier B (fuzzy) dropped. | Pre-V3 |
| **Login 8-char password minimum** | Acceptable; seed users have forced change on first login. Password strength 12+ enforced on change/reset. | Pre-V3 |
| **Export TTL SQL INTERVAL style** | Style-only; no correctness or security issue. Hardcoded constant, so no real injection risk. | Pre-V3 |
| **vitest --coverage script** | No CI pipeline; no coverage gate needed at this stage. Optional script can be added later. | Pre-V3 |
| **HttpOnly JWT cookies** | Not worth complexity for single-household self-host. JWT in Authorization header is current pattern. Acceptable accepted risk. | Pre-V3 |
| **Manual dedup fuzzy matching** | Same date+amount+slightly different description is niche case. Manual resolution acceptable. Character-level fuzzy doesn't handle token-level insertions. Complexity outweighs benefit. | Pre-V3 |
| **Rental income tracking (D-3)** | App is not a rental property management tool. Scope creep. | 2026-05-15 |
| **HELOC modeling (D-5)** | User doesn't have HELOC. `linked_account_id` schema hook future-proofs. No code needed. | 2026-05-15 |
| **D-3 vs PT-1 distinction** | D-3 (rental income tracking) is about managing rental properties. PT-1 (property tax protest) is about property tax compliance — distinct feature, applies to any owned property. No overlap. | Design note |

---

## Feature Backlog Detail Specs

Full design notes for major systems from source files.

### Notification System (F-1, V4)

**Status:** Shipped 2026-05-25.

**Schema:**
- `notification` table: id, household_id, user_id (NULL = all members), type, title, body, action_url, read_at, created_at
- `notification_preference` table: user_id, notification_type, enabled_email, enabled_inapp (per-type toggles)
- Index: `(household_id, user_id, read_at, created_at DESC)`

**Notification types (v1):**
- `export_ready` — export job completes (email ✓, in-app ✓)
- `restore_complete` — household restore finishes (email ✓, in-app ✓)
- `backup_complete` — Google Drive backup succeeds (email ✗, in-app ✓)
- `backup_failed` — backup fails (email ✓, in-app ✓)
- `property_valuation_updated` — monthly auto-refresh (email ✗, in-app ✓)
- `budget_threshold_80` — category spend ≥80% of budget (email ✗, in-app ✓)
- `budget_threshold_100` — category spend ≥100% of budget (email ✓, in-app ✓)
- `large_transaction` — transaction exceeds household `large_txn_threshold_usd` (email ✗, in-app ✓)

**API routes:**
- `GET /notifications` — list unread first + last 10 read (max 50)
- `GET /notifications/unread-count` — polled every 60s
- `PATCH /notifications/:id/read` — mark single read
- `POST /notifications/read-all` — mark all read for user
- `GET /notifications/preferences` — array of NotificationPreference
- `PUT /notifications/preferences` — bulk update

**Frontend:**
- Bell icon in AppTopBar with red unread badge (max "99+")
- Click opens NotificationPanel (Popover/Drawer on mobile)
- Settings → Notifications tab: toggle grid (types × in-app/email), master email toggle
- Cache invalidation: clear on import finalize via CustomEvent

**Budget threshold:** Fire on import finalize (after canonicalize). Check per category vs `budget_category` rows. Fire `80` once per month per category. Fire `100` when breached. Check `notification` for existing un-dismissed entry to avoid duplicates.

### Payslip Enhancement Pass (F-3, V4)

**Status:** Shipped 2026-05-22.

**PS-1 — Month-over-month delta badges:**
- Service: `getPriorPayslip(personProfileId, currentPayPeriodEnd)` queries prior payslip
- Response: `priorPayslip: { net, gross, totalTax, totalPreTaxDeductions } | null`
- UI: `<DeltaBadge>` components below headline figures (↑/↓/— icons, green for improvement, red for increase in tax)

**PS-2 — Investment contribution grouping:**
- Buckets: Retirement (401k/403b/457/Roth 401k), Equity (ESPP/RSU), Health (HSA/FSA/DCFSA), Other
- Already extracted by LLM; group and display on detail page
- YTD totals per bucket from `payslip_line_item` rows same calendar year

**PS-3 — Savings / wealth-building rate:**
- `(pre_tax_contributions / gross_pay)` per payslip; running YTD
- Pure computation, no schema change
- Display: "X% this period / Y% YTD" KPI on detail page

**PS-4 — Tax sufficiency signal:**
- Annualise federal withholding: `(federal_withheld_ytd / gross_ytd) × 100`
- Compare to 20% general benchmark
- Show subtle Alert if < 20% federal: "Your annualised federal withholding rate is X%. Consider reviewing your W-4 if your effective tax rate is typically higher."
- Not full tax calculation, just data-derived signal

### Balance Sheet Member Subtotals (F-2, V4)

**Status:** Shipped 2026-05-19.

**Backend:**
- `GET /reports/balance-sheet` groups accounts by `owner_person_profile_id`
- For each person: sum asset accounts, sum liability accounts
- Include "Shared / Household" row for accounts with no owner
- Return `memberSummary[]` when household has 2+ profiles

**Frontend:**
- Collapsible "Household Breakdown" section at bottom of NetWorthPage
- Table: Member | Assets | Liabilities | Net Worth
- Collapsed by default; renders only when `memberSummary.length > 1`

### Transfer Matching Improvements (TM-1/TM-2/TM-4, V4)

**Status:** Shipped 2026-05-19 (TM-1), 2026-05-22 (TM-2, TM-4).

**TM-1 — Date tolerance bump:**
- Changed ±2 days → ±4 days in `canonical-ingest.service.ts` lines 922, 1004
- Catches 3-day ACH lag without increasing false-pair risk
- Integration test added (3-day gap correctly paired)

**TM-2 — Manual pair/unpair:**
- Transactions page: "Transfer status" filter (Paired, Unpaired transfer)
- Paired transactions show "↔ Transfer" badge; click reveals paired transaction inline
- `POST /transactions/pair` (body: debitId, creditId; validates different accounts, opposite signs)
- `DELETE /transactions/pair/:groupId` (nulls transfer_group_id on both rows)

**TM-4 — Near-duplicate detection:**
- Problem: BoA CSV (masked digits `XXXXX50542835`) vs PDF (real `1049950542835`) fail substring check
- Solution (Option 1): Remove `descriptionsCompatibleForNearDuplicate()` gate
- Same-account + same-date + same-amount + different fingerprint → `status = 'duplicate'` with `duplicate_ambiguity` item
- Trade-off: Two same-price same-day transactions occasionally queue to resolution (acceptable for household app)

### Recurring Payments System (Phases 1–3 shipped, 4+ deferred)

**Status:** Phases 1–3 shipped pre-V3. Phase 4+ deferred.

**Data model:**
- `recurring_merchant_override` table: household_id, merchant_key, display_name (optional), verdict (confirmed/dismissed), amount_anchor (nullable), amount_tolerance_pct (default 15%), created_at
- Unique constraint: `(household_id, merchant_key)`

**Matching logic:**
- Stage 1: merchant string contains check (normalized)
- Stage 2: amount proximity when anchor set (`|txn_amount - anchor| / anchor <= tolerance%`)
- A transaction matches if it passes Stage 1 AND Stage 2

**Dashboard integration:**
- Confirmed overrides always shown (top)
- Heuristic candidates (below, labeled "Suggested")
- Dismiss button on heuristics → writes dismissed override
- Filter in transaction view: "Recurring only"

**UI flow:**
- Click recurring icon on transaction → tagging popup
- Popup: merchant_key (editable), live match count, amount_anchor (overridable), tolerance %
- Confirm / Cancel

**Future phases (4+):**
- Annual subscription detection (CV + 2-month gate misses annuals)
- Upcoming bill prediction
- Per-transaction exclusion from recurring pattern

### Multi-Household Support (Deferred D-4)

**Current constraint:** `app_user.household_id` is a single column; one user = one household.

**Target shape:**
- `user_household_membership` join table: user_id, household_id, role, joined_at
- `app_user` carries only login identity: email, password_hash, token_version
- JWT includes *active* household (switchable post-login)

**Deferred features:**
- Invite-code join flow (admin generates short-lived code; user enters on first login)
- Create-your-own household (self-service on "no household" screen)
- Household switcher in top bar (once multi-household is viable)

**Email as canonical identity:**
- `app_user.email` is unique anchor
- When adding person_profile to household, look up app_user by email first
- Avoids duplicate accounts for same person across households

### Mobile UX + PWA Backlog (Partially shipped, ongoing)

**Status:** Viewport audit, Recharts sizing, form responsive props, payslip touch affordances, manifest.json, PWA meta tags, icons shipped (UX-R01/R04–06, UX-P01–P03, 2026-04-25). Remaining: drawer nav (UX-R02), card-per-row ledger (UX-R03), service worker (UX-P04).

**Shipped items:**
- UX-P01: `frontend/public/manifest.json` (display: standalone, theme_color, icons)
- UX-P02: `index.html` meta tags (apple-mobile-web-app-*, manifest link)
- UX-P03: 192×512 app icons in `frontend/public/icons/`
- UX-R01/R04–R06: Viewport audit completed; Recharts ResponsiveContainer verified; form Grid→Stack on mobile; payslip touch affordances

**Remaining (deferred post-V4):**
- UX-R02: AppShell hamburger + drawer nav on `<md` viewports (Mantine `navbar.collapsed.mobile`)
- UX-R03: Ledger table → card-per-row on phones (`useMediaQuery` conditional or Table `visibleFrom`)
- UX-P04: Service worker (optional; vite-plugin-pwa; defer until P01–P03 validated)

**Target:** All 13 pages usable at 390px viewport, PWA installable, drawer nav on mobile.

### Export / Import / Backup

**Status:** Export and restore already async (202/poll pattern proven). Optional API consolidation deferred.

**Shipped (v3):**
- Migration 0040: `transfer_excluded` for dismissed transfers
- FIX-138: Restore identifier hardening (`assertRestoreColumnNames`), cleanup rejected uploads
- I-5: Restore staging file cleanup, GDrive reconnect notice
- I-6: Drive `folderId` validation before API interpolation

**Optional future (consolidation):**
- `POST /imports/upload` → 200 with preview + importId
- `POST /imports/{id}/confirm` → finalize atomically
- Parser auto-detection (CSV headers, PDF text, account history)
- Remember last-used parser per account

### ESPP Equity Tracker (ESPP-1, V5)

**Status:** Deferred V5. Design + spec complete (2026-05-26); prototype in `concept/espp/`. No code yet.

**Context:** IBM ESPP — each payslip deduction = one purchase event (1:1 payslip → batch). Stocks land in EquatePlus (Computershare). User transfers to broker immediately. Selling before 2 years = disqualifying disposition.

**Tax concept definitions (these three are distinct):**

| Metric | Formula | When it triggers |
|--------|---------|-----------------|
| Discount Received | `discount/share x shares_purchased` | At purchase. IBM reports this on payslip "ESPP Discount" field. |
| Ordinary Income | `discount/share x shares_sold` | Only on sale. Zero if holding. Less than Discount Received if any shares still held. |
| Capital Gain/Loss | `(sale_price - FMV) x shares_sold` | Only on sale. Positive when sale price exceeds FMV at purchase. |

Ordinary income does not equal discount received unless 100% of shares are sold. Discount Received YTD tile uses `SUM(espp_discount_payslip)` across batches in the year — IBM's authoritative number, not a formula.

**Data sources per batch:**
- **PDF (EquatePlus plan detail):** purchase date, shares allocated, Purchase FMV/share, cost basis/share. Parse via text/regex — no OpenAI needed. Fields consistently labelled: "Cost basis $X", "Purchase FMV $X", "Allocated N".
- **CSV (Allocations export):** one row per allocation date, shares transferred to broker. One CSV can span multiple purchase dates; system matches rows to batches by allocation date.
- Both files are **optional individually** — at least one required to submit. PDF-only creates the batch record with outstanding = all shares. CSV-only updates `shares_transferred` on existing batches by date. Both together = full upsert.

**Payslip linkage:** At import time, query payslip by `pay_date = purchase_date OR pay_period_end = purchase_date`, filter `pli.name ILIKE '%ESPP%'`. Store three values on `espp_batch` directly — no cross-table join at read time:
- `espp_discount_payslip` from `name = 'ESPP Discount'`, `amount_current` (section: `other_information`)
- `espp_salary_deduction` from `name = 'ESPP (Stock Salary)'`, `amount_current` (section: `post_tax_deductions`)
- `espp_other_deduction` from `name = 'ESPP (Stock Other)'`, `amount_current` (section: `post_tax_deductions`)

**DB schema:**

`espp_batch` — one row per purchase date, upserted on import:
```
id, purchase_date (unique), shares_granted, fmv_per_share, cost_basis_per_share,
discount_per_share (stored: fmv - cost_basis), shares_transferred,
payslip_id (FK nullable), espp_discount_payslip, espp_salary_deduction, espp_other_deduction,
created_at, updated_at
```

`espp_sale` — time-series, one row per batch-line in a sale:
```
id, batch_id (FK espp_batch), sale_date, shares_sold, sale_price_per_share,
proceeds (shares_sold x sale_price),
ordinary_income (discount_per_share x shares_sold),
cap_gain_loss ((sale_price - fmv_per_share) x shares_sold),
created_at
```

Derived (never stored): `outstanding = shares_granted - shares_transferred`, `held_at_broker = shares_transferred - SUM(shares_sold)`

**UI — ESPP Tracker page** (Forest Studio design system; prototype in `concept/espp/`):

*Year selector* — drives both the summary strip and the batch table. Changing year filters everything on the page.

*Section 1 — Year summary strip:* 5-col x 2-row stat tile grid. Row 1: Shares Purchased YTD | Transferred to Broker | Outstanding (EquatePlus) | Shares Sold YTD | Total Invested. Row 2: Discount Received YTD (gold, source: payslip SUM) | Sale Proceeds YTD | Realized Gain/Loss (green/red) | Ordinary Income YTD | Capital Gain/Loss YTD (green/red).

*Section 2 — Batch table:* filtered by selected year. Columns: Purchase Date | Shares | FMV/sh | Cost/sh | Disc/sh (gold) | Transferred | Outstanding | Sold | Held (forest-green when > 0) | Status badge (All Held / Partially Sold / Fully Sold). Expandable row shows sale history: Sale Date | Shares Sold | Sale Price | Proceeds | Ordinary Income (gold) | Cap Gain/Loss (green/red).

*Actions (top-right):*
- **Import** — two drop zones side by side (PDF left, CSV right), both optional individually, at least one required. On submit: PDF creates/upserts batch; CSV updates `shares_transferred` on matched batches; payslip lookup runs immediately to store ESPP line items.
- **Record Sale** — date picker + multi-row grid. Each row: `[Batch dropdown (date + shares available)] [Qty] [Price/share] [Proceeds] [OI] [Cap Gain/Loss] [x]`. Last three columns are **live-calculated** as user types — Proceeds = qty x price, OI = discount_per_share x qty, Cap Gain = (price - fmv_per_share) x qty. Modal grows horizontally to show all 7 columns. "+ Add Row" adds another batch-line on the same sale date. One submit creates N `espp_sale` rows.

### Security Hardening

**Status:** SEC-153/154 shipped (2026-05-06). I-4/I-6 shipped (2026-05-12). B-7 shipped (2026-05-09).

**Shipped:**
- SEC-153: `storagePath` removed from 404, crypto.randomBytes for temp passwords, JWT_SECRET required in PROD, recurring endpoints auth-locked
- SEC-154: GDrive token encrypted (AES-256-GCM), scope narrowed to `drive.file`
- I-4: Periodic purge of `password_reset_token` rows (hourly export schedule)
- I-6: `folderId` validation in gdrive-backup.service.ts
- B-7: AI insight cooldown in-memory → DB-backed (query on `insight_job`)

**Remaining backlog (P3/deferred):**
- HttpOnly JWT cookies (complexity not worth it for single-household self-host)
- RBAC lockdown (already implemented in CR-109)
- Capital One UI (deferred — institution not actively used)
- Export cleanup (asset inventory)
- Password reset email infrastructure (CR-095b; email infrastructure design consolidated in ADMIN_GUIDE.md §8)

---

## Version History Summary

| Version | Release | Items Shipped | Type |
|---|---|---|---|
| **V4** | 2026-05-15–2026-05-25 | R-1/R-2/R-3 + F-1/F-2/F-3/F-4/F-5/F-6/F-6b/F-7/F-8/F-9/F-10 + TM-1/TM-2/TM-4 + PS-2b/PS-5-Phase-1 + I-8/I-10/I-12 | Quick fixes, high-value features, performance, payslip pass, error logging, Playwright E2E |
| **V3** | 2026-04-15–2026-05-14 | B-1–8 + F-1–11 + I-1–6 + D-2 + UX-166/167/174/175/176 | Major feature release: infrastructure, account enrichment, real estate, reporting, mobile UX baseline |
| **V2** | Pre-2026-04-15 | RBAC (CR-109), recurring phases 1–3 (CR-121/122/123), security (SEC-153/154) | Foundation: roles, recurring detection, pre-release hardening |
| **V1** | Pre-2026-04 | Basic ledger, import, dashboard, payslips, net worth | Core app |

---

## Planning Notes

### V4 Complete
All P1 and P2 items shipped. V4 feature set locked 2026-05-15; final item (F-1 notification system) shipped 2026-05-25. Next planning cycle: V5 priorities and groom deferred items.

### V5 Candidate Items
- **High value:** PT-1 property tax protest assistant (needs grooming), data archival (D-1), ESPP-1 equity tracker
- **Foundation:** Multi-household (D-4) for future multi-user deployments
- **Enhancement:** Recurring phase 4+, async import pipeline

### Design Decision Notes
- **Payslip:** PS-5 Phase 2 (full tax computation) dropped — tax software territory; Phase 1 (stored rates) sufficient for data-derived signal
- **Real estate:** No dedicated `real_estate` account type; property data on join table (simpler than institution identity problem)
- **Transfer detection:** Greedy pre-assignment considered but deferred — user resolution queue acceptable for household app
- **Recurring:** Heuristic + user override proven approach; fuzzy matching dropped (high false-positive risk on short bank strings)
- **Multi-household:** Deferred until self-hosted → multi-user use case becomes real; RBAC already works for single household

---

*Last updated: 2026-05-26. V4 complete. I-8 Playwright E2E marked Shipped V4 (CR-226, 13 tests, 3 suites). All P1/P2/P3 V4 items shipped; V4 feature set fully locked. ESPP-1 added as V5 candidate (IBM ESPP purchase/transfer/sale tracker, full design spec captured). Next: V5 planning and backlog grooming.*
