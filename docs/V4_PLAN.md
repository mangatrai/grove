# V4 Plan — Feature List with Priority

**Compiled:** 2026-05-15. Sources: post-V3 docs audit, user priorities review session, `V3_PLAN.md` deferred items, `SECURITY_HARDENING_BACKLOG.md`, `MOBILE_UX_BACKLOG.md`.

**Priority tiers:**
- **P1** — Quick fix or correctness issue; high value, low risk
- **P2** — High-value feature; materially improves the app for regular use
- **P3** — Useful improvement; non-blocking, lower impact or more speculative
- **Deferred** — Explicitly post-V4; noted here for awareness

---

## P1 — Quick Fixes

### R-1: Post-restore `force_password_change` ✅ SHIPPED (SEC-003, 2026-05-17)
After a household restore, all sessions are invalidated via `token_version` bump, but existing user passwords are unchanged. A restore from a backup could be from a compromised state; forcing a password change on next login for all users is a cheap safety net.

**Implementation:** In `import-household-bundle.service.ts`, after the wipe-and-restore transaction completes, run:
```sql
UPDATE app_user SET force_password_change = TRUE WHERE household_id = ?
```
The `force_password_change` column already exists; login already returns it; the password-change redirect already exists in the frontend. This is a 3-line addition.

**Files:** `backend/src/modules/export/import-household-bundle.service.ts`

---

### R-2: BY ACCOUNT card — add YoY delta arrow alongside existing MoM arrow ✅ SHIPPED (UX-116, 2026-05-18)
Each account row now shows two arrows side by side: the existing MoM arrow (vs prior month) and a new YoY arrow labelled with the short year (e.g., `↑ '25`). Both use the same ±5% threshold, `count < 3` guard, and colour semantics. A separate 8th fetch loads same-month-prior-year transactions; `priorYearMap` useMemo builds the per-account aggregates; `yoyArrow()` mirrors `accountArrow()`. No backend changes.

**Files:** `frontend/src/pages/DashboardPageV2.tsx`

---

### R-3: Remove `checking` from `LIABILITY_ACCOUNT_TYPES` (dashboard arrow bug) ✅ SHIPPED (UX-114, 2026-05-18)
Checking accounts are liquid assets, not liabilities. The constant at `DashboardPageV2.tsx:175` incorrectly includes `"checking"`, causing the BY ACCOUNT card to show a red ↑ arrow when checking outflow increases month-over-month — the same signal used for a rising credit card balance. Checking outflow increase should show gold ↑ (neutral) not terracotta (bad).

**Fix:** Remove `"checking"` from the set. Correct list: `new Set(["credit_card", "loan"])`.

**Files:** `frontend/src/pages/DashboardPageV2.tsx` (line 175)

---

### F-6: Dashboard + Net Worth page caching with session refresh icon ✅ SHIPPED (CR-192, 2026-05-19)
Every Home page and Net Worth page load re-runs expensive aggregate SQL queries (cash summary, balance sheet history). For a self-hosted offline app, data does not change between page loads — only after a new import. Caching in `sessionStorage` with an explicit refresh button eliminates the per-navigation latency.

**Scope:**
- **Home page:** Cache `GET /reports/cash-summary` in `sessionStorage` keyed by `household_id + active_month`. On mount, serve cached data immediately. Refresh icon (top-right corner of the inflow/outflow KPI card) triggers a fresh fetch, updates the cache, and shows a "Last updated X min ago" tooltip.
- **Net Worth page:** Same pattern for `GET /reports/balance-sheet` + history. Cache keyed by `household_id + member_filter`.
- **Cache invalidation:** Clear relevant keys when import session is finalized (dispatch a `CustomEvent` from the import flow, listened to by cached pages).
- **Shared hook:** `useSessionCache<T>(key, fetcher)` — returns `{ data, loading, refresh, lastUpdatedAt }`.

**Design notes:** See `docs/V4_BACKLOG.md` §Dashboard + Net Worth Caching for implementation pattern.

**Files:** `frontend/src/pages/DashboardPageV2.tsx`, `frontend/src/pages/NetWorthPage.tsx`; new `frontend/src/hooks/useSessionCache.ts`

---

### TM-1: Transfer matching — bump date tolerance from 2 → 4 days ✅ SHIPPED (FIX-192, 2026-05-19)
The current transfer auto-pairing window is ±2 days (`canonical-ingest.service.ts:922`). Real-world bank-to-bank ACH transfers routinely take 3 days, causing confirmed pairs to miss the window and land in the unmatched queue. Widening to 4 days catches the common 3-day lag without materially increasing false-pair risk: the pair score threshold (45) and same-account exclusion both still apply.

**Implementation:** Changed `<= 2` to `<= 4` in both filter passes (lines 922 and 1004) and updated all three `closeDateToleranceDays` telemetry fields. Added integration test verifying a 3-day ACH gap is correctly paired.

**Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/app.test.ts`

---

## P2 — High-Value Features

### F-1: In-app notification system + budget/operation alerts
Unified notification center — bell icon with unread badge in the top bar, dropdown notification panel, configurable per-type preferences. Settings → Notifications tab (currently a confirmed placeholder) becomes functional.

**Design details:** See `docs/V4_BACKLOG.md` §Notification System for full schema, API, and trigger spec.

**Notification triggers (v1 scope):**
- Export job completed (supplement existing email)
- Household restore completed
- Google Drive backup succeeded / failed
- Property valuation auto-refreshed (monthly scheduler)
- Budget category threshold crossed (configurable %, default 80% and 100%)
- Large transaction detected (configurable household-level threshold amount)

**Preference model:** Per-user, per-type: `enabled_email` + `enabled_inapp`. Master email toggle. Sensible defaults (operational = in-app + email; budget/transaction = in-app only by default).

**Implementation scope:**
- Migration: `notification` table + `notification_preference` table
- Backend: `notification.service.ts` (create, list, mark-read, preferences CRUD)
- API: `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`, `GET /notifications/unread-count`, `GET/PUT /notifications/preferences`
- Frontend: Bell icon in `AppTopBar`, 60s polling for unread count, notification dropdown panel, Settings Notifications tab wired up
- Wire `createNotification()` into: `export-job.service.ts`, `import-household-bundle.service.ts`, `gdrive-backup.service.ts`, `realty-api.service.ts` (monthly scheduler), budget check on import finalize

**Files (new):** `backend/db/migrations/0047_v4_notifications.sql`, `backend/src/modules/notifications/notification.service.ts`, `backend/src/modules/notifications/notifications.routes.ts`
**Files (updated):** `export-job.service.ts`, `import-household-bundle.service.ts`, `gdrive-backup.service.ts`, `realty-api.service.ts`, `import-session.service.ts` (budget check), `AppTopBar.tsx`, `SettingsPage.tsx`

---

### F-2: Balance sheet member subtotals ✅ SHIPPED (CR-193, 2026-05-19)
The net worth page currently has a filter (show household OR one member). Member subtotals go one step further: a summary section at the bottom of the page showing ALL members simultaneously as a breakdown table:

| Member | Assets | Liabilities | Net Worth |
|--------|--------|-------------|-----------|
| Household Total | $X | $Y | $Z |
| Mangat | $a | $b | $c |
| Spouse | $d | $e | $f |

This gives the household overview without requiring the user to switch filters. Accounts already have `owner_person_profile_id`; the balance sheet service can group by it using the same snapshot data already loaded.

**Backend:** Extend `GET /reports/balance-sheet` to include a `memberSummary[]` array when the household has multiple members. Each entry: `personProfileId`, `name`, `totalAssets`, `totalLiabilities`, `netWorth`. Accounts without an owner map to a "Shared / Household" row.

**Frontend:** Add a collapsible "Household Breakdown" section at the bottom of `NetWorthPage.tsx`, below the account table. Renders only when `memberSummary.length > 1`.

**Files:** `backend/src/modules/reports/balance-sheet.service.ts`, `frontend/src/pages/NetWorthPage.tsx`, `docs/API_BALANCE_SHEET.md`

---

### F-3: Payslip enhancement pass ✅ SHIPPED (CR-197/UX-196/UX-198/UX-199/UX-200/UX-201, 2026-05-22)
A cohesive pass over the payslip feature covering: month-over-month comparison, investment contribution grouping, savings/wealth-building rate, and tax sufficiency signal. All payslip-related improvements in one release rather than scattered commits.

**Design details:** See `docs/V4_BACKLOG.md` §Payslip Enhancement Pass for full spec.

**Sub-items:**

**PS-1 — Month-over-month delta badges:** Net pay, gross pay, total taxes, total pre-tax deductions compared to the prior payslip for the same person. Display as absolute delta + direction icon (↑ / ↓ / —). "Prior" = the immediately preceding `pay_period_end` for the same `person_profile_id`. Service-layer only addition; no schema change.

**PS-2 — Investment contribution grouping:** Group pre-tax deduction line items from `payslip_line_items` by contribution type (retirement: 401k/403b/457; equity: ESPP/RSU; health: HSA/FSA). Show YTD total per group on the payslip detail page. The LLM already extracts these; this is grouping + display.

**PS-3 — Savings / wealth-building rate:** Per payslip: what percentage of gross goes to pre-tax contributions (retirement + equity + health). Running YTD rate across the pay year for the person. Pure computation from already-extracted data.

**PS-4 — Tax sufficiency signal:** Annualised federal + state withholding rate (YTD withheld ÷ YTD gross × 12/pay-period-count). Display a subtle flag if annualised federal rate looks low vs 20% general benchmark. NOT a full tax calculation — just a data-derived signal to prompt the user to check their W-4.

**Files:** `backend/src/modules/payslip/payslip.service.ts`, `frontend/src/pages/PayslipDetailPage.tsx`, `frontend/src/payslip/types.ts`

---

### TM-2: Transfer pair visibility + manual pair/unpair UI ✅ SHIPPED (CR-204, 2026-05-22)
No way exists today to see which transactions are paired as transfers, or to manually pair unmatched ones. Edge cases that auto-detection misses (check float > 4 days, empty-memo same-institution transfers) require raw SQL to resolve.

**Scope:**
- **Transactions page — More Filters section:** Add "Transfer status" filter: `Paired` (has `transfer_group_id`), `Unpaired transfer` (no `transfer_group_id` + category is Transfer In or Transfer Out).
- **Paired indicator:** On transactions with a `transfer_group_id`, show a small "↔ Transfer" badge. Clicking it reveals the paired transaction inline (account, date, amount).
- **Manual pair:** Select two transactions → "Mark as transfer pair" action → `POST /transactions/pair` (validates different accounts, opposite signs, same household).
- **Unpair:** From a paired transaction's detail view → "Remove transfer pair" → `DELETE /transactions/pair/:groupId` (nulls `transfer_group_id` on both rows).

**Backend:** New `POST /transactions/pair` and `DELETE /transactions/pair/:groupId` endpoints in `ledger.routes.ts`.

**Design notes:** See `docs/V4_BACKLOG.md` §Transfer Pair Visibility for API spec.

**Files (new):** New endpoints in `backend/src/modules/ledger/ledger.routes.ts`, `ledger.service.ts`
**Files (updated):** `frontend/src/pages/TransactionsPage.tsx`

---

### TM-4: Near-duplicate detection — remove description gate (Option 1)

**Bug.** The same real-world transaction imported from two sources (BoA CSV and BoA PDF parser) fails near-duplicate detection. The formats produce descriptions that differ in reference IDs and prefix tokens — masked digits (`XXXXX50542835`) vs real (`1049950542835`), or format prefixes (`CHECKCARD 0430 TMOBILE...` vs `TMOBILE AUTO P 04/30...`) — so `descriptionsCompatibleForNearDuplicate()` returns false and both land as live rows.

**Root cause:** The near-duplicate path (same account + same date + same amount + different fingerprint) gates on substring containment between descriptions. This is too strict when descriptions differ across import formats.

**Fix (Option 1 — selected):** Remove `descriptionsCompatibleForNearDuplicate()` as a prerequisite. For same-account + same-date + same-amount pairs, any fingerprint mismatch is sufficient to route the second transaction to `status = 'duplicate'` with a `duplicate_ambiguity` resolution item.

**Trade-off:** Two genuinely different same-price same-day transactions (e.g. two $5.25 coffee purchases) will occasionally queue to resolution. The false-positive rate is low in practice (ACH, payroll, and transfer amounts are typically unique per day), and the resolution queue is the designed handling path for ambiguity. Acceptable for a household app.

**Option 3 (future upgrade — structural token Jaccard):** If false-positive resolution noise ever becomes a problem, a smarter check can replace the removed gate. See `docs/V4_BACKLOG.md` §TM-4 for the full design.

**Scope:** Same-account near-duplicate path only. Transfer pairing (`transferPairScore()`) is a separate path and is not touched.

**Tests:** One integration test per example pair — assert second import lands as `status = 'duplicate'` with a `duplicate_ambiguity` resolution item.

**Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/app.test.ts`

---

### TM-3: Transfer matching — same-institution score boost ❌ NOT DOING

**Dropped 2026-05-19.** The original premise — that empty OFX memos produce a score of 0, leaving same-institution pairs unmatched — is false. The OFX parser always produces a non-empty description (falls back to `"OFX Transaction"`); two truly-empty-memo transactions would score 100 (identical descriptions) and auto-pair. In practice, production transactions (3,500 over 3 years) have never exhibited the empty-memo failure mode. The transfer resolution queue is working well and does not show this as a real source of noise. Adding institution as a scoring signal would add complexity without a demonstrated benefit, and risks making cross-institution transfers (BofA checking → Chase savings) harder to reason about. Closed.

---

### F-7: AI Year-End "Wrapped" financial summary
A "Spotify Wrapped for your finances" — triggered manually in January after the full year is imported and reconciled. Surfaces the year's highlights, trends, and surprises in a card-based UI with optional email delivery.

**Trigger:** Manual "Generate Year Summary" button, visible January 1 – March 31. User selects the year (defaults to prior year).

**What it computes:**
- Full-year income, spending, net savings, savings rate; YoY comparison if prior year exists
- Top 5 spending categories with % of total spend
- Best month (highest net) and worst month (highest spend)
- Net worth change Jan 1 → Dec 31 (from `account_balance_snapshot`)
- Investment/retirement account growth (accounts of type `investment`, `retirement`)
- Largest single transaction; most-used merchant by count

**AI narrative:** Feed structured data to LLM (same pattern as existing AI Financial Health). Returns a 2–3 paragraph personal narrative: what went well, what stands out, one actionable suggestion.

**UI:** "Year in Review" modal or dedicated page — card-per-stat layout, AI narrative at top, data cards below.

**Email:** When F-1 (notification system) has shipped, deliver via `year_summary_ready` notification with email.

**Dependency:** F-1 for email delivery; UI-only mode works without it.

**Design notes:** See `docs/V4_BACKLOG.md` §AI Year-End Summary for prompt design.

**Files (new):** `backend/src/modules/reports/year-summary.service.ts`
**Files (updated):** `reports.routes.ts`, `insight-prompt.service.ts`, new frontend page/modal

---

## P3 — Useful Improvements

### I-8: Playwright end-to-end test suite (spike)
Time-boxed spike to evaluate Playwright for browser-level test coverage. V3 found UI bugs (broken subcategory picker, chart expand, delta cards) that backend integration tests completely missed. Goal of spike: prove the framework works for this stack (Vite + React + Postgres), not achieve full coverage.

**Spike scope (time-boxed to 2-3 days):**
- Auth flow: sign in, forced password change
- Import session: create, upload file, bind to account, parse, canonicalize, finalize
- Ledger: filter, category assignment, transaction aggregate strip
- Net worth: add balance snapshot, verify it appears in chart + KPI tiles

**Decision points:** Docker Compose reuse for test Postgres; local-only vs CI; test data isolation strategy.

**Files (new):** `e2e/` directory, `playwright.config.ts`, first 4 spec files

---

### I-9: Fuzzy match categorization (Tier B)
Complement existing exact-regex rules with a fuzzy merchant name matching layer. Catches variants like `AMAZON.COM*AB12CD` vs `AMAZON.COM*XY34ZF` or `WHOLEFDS #123` vs `WHOLE FOODS MKT`. Runs after exact rules fail, before Unknown fallback.

**Approach:** Normalize merchant name (uppercase, strip non-alpha/digits, collapse whitespace, strip trailing alphanumeric codes after `*` / `#`). Compute Jaro-Winkler or normalized edit distance against confirmed household merchant→category pairings. Threshold configurable; below threshold → Unknown (no false positives).

**Files:** `backend/src/modules/category/fuzzy-match.service.ts` (new), `backend/src/modules/canonical/canonical-ingest.service.ts`

---

### F-4: Delete property

Remove a property record and its value snapshot history. Useful when a property was created by mistake or a home is sold and equity no longer applies.

**Scope:**
- `DELETE /household/properties/:propertyId` — soft-guard: reject if any `financial_account.property_id` still references the property (user must unlink the account first). Delete cascades `property_value_snapshot` rows.
- Frontend: small trash icon button in the Net Worth page Real Estate section (owner/admin only); confirmation modal with a warning if the property has value history.
- No migration needed: cascade delete on `property_value_snapshot` via FK (already `ON DELETE CASCADE` or add it); `financial_account.property_id` FK is nullable — just null it on unlink before delete.

**Files:** `backend/src/modules/household/property.service.ts`, `household.routes.ts`, `frontend/src/pages/NetWorthPage.tsx`

---

### F-5: Account closed/inactive status

Mark a financial account as closed. A closed account:
- No longer appears in import binding dropdowns
- Is excluded from AI insights spending analysis
- Shows as "Closed" badge in Settings → Accounts (collapsed by default)
- Still appears in Net Worth balance sheet with its last snapshot (for historical accuracy); can be toggled off with a "Show closed" filter
- Still shows in Transactions ledger (historical data preserved); filter can hide closed accounts

**Schema:** `financial_account.status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed'))`, plus `closed_at TIMESTAMPTZ`. One migration; no data migration needed (existing rows stay `active`).

**UI entry points:**
- Settings → Accounts: kebab menu on each account row → "Close account" (with confirmation modal that explains what this does)
- Settings → Accounts: "Show closed accounts" toggle at top of table

**Files:** `backend/db/migrations/0047_account_status.sql`, `import-file-binding.service.ts` (filter active accounts in binding), `balance-sheet.service.ts` (keep last snapshot for closed), `insight-prompt.service.ts` (skip closed), `imports.routes.ts` (account list filter), `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/NetWorthPage.tsx`

---

### F-8: BY ACCOUNT card — full redesign pass ✅ SHIPPED (UX-115, 2026-05-18)

Design decisions locked 2026-05-18:

**Account types shown:** `credit_card`, `checking`, `savings` only.
- `loan` excluded — loan balances decrease steadily and predictably; no actionable signal month-to-month.
- `investment`, `retirement`, `property` excluded — not flow accounts in the monthly sense.

**Row cap:** Top **3 credit cards** + top **3 checking/savings** = max 6 rows. Enough for signal, not overwhelming.

**Primary metric: transaction outflow** (thisMonthOutflow), not balance snapshot.
- Rationale: the card lives inside a month-navigation dashboard ("← May 2026 →"). Outflow is genuinely this-month data that matches the month context. Balance snapshots are always one month behind mid-month, creating a misleading "May" header with April data.
- The primary data entry path is OFX import, which provides complete transaction data. Manual balance-only updates are occasional; outflow accuracy is acceptable for this card.
- Credit cards: ↑ outflow = terracotta (spending more). ↓ = forest.
- Checking/savings: ↑ outflow = gold (cautionary — more leaving). ↓ = forest.

**Comparison arrows (MoM and YoY after R-2):** MoM uses `thisMonthOutflow` vs `priorMonthOutflow` from the transaction fetch already in the load. YoY (R-2) will require a separate fetch for the same month last year.

**R-3 still applies:** `checking` color fix (`LIABILITY_ACCOUNT_TYPES`) is still the right one-liner to ship immediately. F-8 is the broader structural pass on top.

**Build order:** R-3 (color fix) → F-8 (switch to balance metric, account filter, row cap) → R-2 (add YoY arrow column).

**Files:** `frontend/src/pages/DashboardPageV2.tsx`, possibly `backend/src/modules/reports/` if a new balance-by-account endpoint is needed.

---

### F-6b: Net Worth page — cache balance-sheet snapshot + per-account row-expansion history ✅ SHIPPED (CR-194, 2026-05-20)

F-6 shipped caching for the trend chart history (`bs-history:*` keys) and the Dashboard cash-summary. Two expensive queries on the Net Worth page remain uncached:

1. **Balance-sheet snapshot** (`loadSheet` → `GET /reports/balance-sheet`): fires on every page load and on every member/scope filter change. This is the most expensive call — joins across accounts, properties, and snapshots. Currently bypasses `useLocalStorageCache` entirely.
2. **Per-account row-expansion history**: each time a user expands an account row in the balance sheet table, one query fires to load that account's historical balance series. Expanding all rows can fire 10–20 sequential queries.

**Implementation:**
- **Snapshot:** wrap `loadSheet()` with `useLocalStorageCache`, key `bs-snapshot:{ownerScope}:{ownerPersonProfileId|'household'}`, scope `"networth"`, TTL **1 hour** (snapshot reflects current account balances; shorter stale-tolerance than the historical series).
- **Per-account expansion:** wrap each account's history fetch with `useLocalStorageCache`, key `bs-acct-history:{accountId}:{fromDate}:{toDate}`, scope `"networth"`, TTL **7 days** (historical balance data is immutable once written).
- Both keys use the existing `"networth"` scope → the existing refresh icon on the page (shipped in F-6) busts all cached data together. No new UI needed.
- Uses the same `useLocalStorageCache` hook already wired in `NetWorthPage.tsx`.

**Design notes:** See `docs/V4_BACKLOG.md` §Net Worth Caching Follow-on (F-6b) for cache key format and TTL rationale.

**Files:** `frontend/src/pages/NetWorthPage.tsx`

---

### I-10: App-wide error logging audit

Production issues are currently discovered by tracing code paths by hand because many async route handlers lack try-catch (errors cause process crashes with no log entry) and several service functions return early/silently on unexpected states.

**Scope:**
- Audit all Express async route handlers for missing try-catch. Any handler where an unhandled rejection can crash the process is a P1 logging gap. Add try-catch + `log.error` to each. Express 4.x with Node 20 exits on unhandled async rejections — every uncaught throw is a silent 503 from Koyeb's perspective.
- Audit service functions for silent early returns (return `null` / `undefined` / `false` without a `log.warn`). Every non-obvious control flow exit should emit a structured log entry explaining why.
- Audit external API call sites (RealtyAPI, OpenAI, Google Drive, SMTP) for consistent log coverage: log entry on call start (info), log on success with key output fields (info), log on failure with error message and context (error).
- Audit the scheduler functions (`realty-scheduler.service.ts`, `export-job.service.ts`, etc.) for unhandled rejection coverage.
- Add a log line at the start of every background operation (scheduler tick, async job dispatch) so activity is visible in Koyeb log stream.

**Why P3 (not deferred):** The missing try-catch on `POST /household/properties` caused a production 503 that required reading every line of the route handler to diagnose (FIX-191). This audit prevents the same class of invisible failures.

**Files:** All `*.routes.ts` files, all service files with external I/O or non-trivial control flow.

---

### I-12: "Other" category hyperlink on WHERE MONEY WENT card ✅ SHIPPED (UX-117, 2026-05-19)
Top-5 spending category slices are `<Anchor>` links to the Transactions page filtered by category. The "Other" catch-all bucket (categories 6+) renders as plain `<Text>` — not clickable — because it has no single `categoryId`.

**Fix:** In `outflowSlices()` carry the constituent category IDs on the Other slice. Build a URL with all those IDs as `categoryIds[]=...` params — the Transactions page already supports multi-value category filter via `HierarchicalSearchPicker`.

**Files:** `frontend/src/pages/DashboardPageV2.tsx`

---

### ~~I-11: PWA file-input hang — File System Access API fallback~~ → Deferred
**Update 2026-05-16:** PWA installed via Safari works correctly. Chrome PWA file-input hang is a real issue but not actively blocking usage. Moved to Deferred; revisit if Safari PWA stops working or Chrome PWA adoption increases.

~~In Chrome installed-app (PWA) mode, any programmatic `<input type="file">.click()` is blocked by Chrome's security policy in standalone display mode, causing the UI to hang silently. Affected flows:~~

- **Import workspace** (`ImportWorkspacePage.tsx`) — statement file upload
- **Backup/Restore** (`BackupRestoreSection.tsx`) — `.hfb` restore upload
- **Category rules** (`CategoryRulesPage.tsx`) — CSV import

**Fix approach:**
1. Detect PWA mode: `window.matchMedia('(display-mode: standalone)').matches`
2. Prefer the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker) (`window.showOpenFilePicker`) where available — it works in PWA mode and gives the user a native picker
3. Fall back to showing a warning banner if `showOpenFilePicker` is not available (older Chrome or browser-level block)

**Files:** `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/settings/BackupRestoreSection.tsx`, `frontend/src/pages/CategoryRulesPage.tsx`; possibly a shared `usePwaFileOpen` hook

---

### F-9: Recurring payments — display name field in tag modal

Confirmed recurring rules on the Dashboard show the raw `merchantKey` (the substring match pattern) because `display_name` is never populated. The DB column, backend schema, and dashboard rendering are all already wired — the dashboard already does `displayName ?? merchantKey` fallback — but the `RecurringTagModal` has no input field for it, so it is always null.

**Gap:**
- `RecurringTagModal` collects `merchantKey`, `amountAnchor`, `amountTolerancePct` — no `displayName` field
- Neither `TransactionsPage` nor `SettingsPage` passes `displayName` in the POST body
- Result: confirmed recurring entries show raw match string (e.g. `"CITY OF FRISCO UTILITI FRIS"`) instead of a clean label

**Suggested items** use the raw heuristic `item.merchant` (normalized transaction description). This is correct — they haven't been named by the user yet. When the user confirms a suggestion, they can set a display name at that point.

**Fix (frontend-only, no migration needed):**
1. `RecurringTagModal.tsx` — add optional "Display name" text input; include in `onConfirm` payload. Pre-fill with any existing `displayName` when opened from the Settings edit flow.
2. `TransactionsPage.tsx` — pass `displayName` in the POST body to `POST /recurring/overrides`.
3. `SettingsPage.tsx` — pass `displayName` in the POST body for both create and edit paths.
4. No backend change needed: schema already accepts `displayName?: string` and upsert already writes it.

**Files:** `frontend/src/components/RecurringTagModal.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/SettingsPage.tsx`

**Design notes:** See `docs/V4_BACKLOG.md` §Recurring Payments Display Name (F-9) for data-flow details.

---

### F-10: Cash account — auto-update balance snapshot on manual transaction ✅ SHIPPED (CR-203, 2026-05-22)

When a manual transaction is recorded against a `cash`-type account (`POST /ledger`), the `account_balance_snapshot` table is not touched. The user must manually go to the Net Worth page and re-enter the balance. For a cash account that is tracked exclusively by manual transaction entry, the balance should auto-update.

**Current behaviour:** `createManualCanonicalTransaction()` inserts into `transaction_canonical` and returns. No snapshot is written. The Net Worth balance remains at whatever was last manually set.

**Desired behaviour:**
- **Money out (negative amount):** latest snapshot − |amount| → upsert as new snapshot on txn date
- **Money in (positive amount):** latest snapshot + amount → upsert as new snapshot on txn date
- **Delete transaction:** reverse the delta (snapshot + original amount for a deletion, effectively)
- **Edit transaction amount:** snapshot − old_amount + new_amount

**Scope restriction — cash accounts only.** Checking and savings accounts receive import-sourced snapshots from bank statements; auto-updating those from manual transactions would pollute the import-derived balance. Only `type = 'cash'` accounts get auto-balance.

**Opening balance:** If no prior snapshot exists for the account (new cash account), treat the starting balance as 0 and derive the snapshot from the transaction alone. User can always correct the balance explicitly via the Net Worth manual entry UI.

**Implementation:**
1. In `ledger.routes.ts` POST handler — after transaction is created, fetch `financial_account.type`. If `'cash'`, call `computeAndUpsertCashBalance(householdId, accountId, txnDate)`.
2. `computeAndUpsertCashBalance()` (new helper in `balance-sheet.service.ts`): read the latest snapshot, compute `snapshot.amount + txnAmount`, call `upsertManualBalanceSnapshot()`.
3. Apply the same call site in the DELETE handler (with inverted delta) and the PATCH/update handler (with `new_amount − old_amount` delta).

**No schema migration needed.** `account_balance_snapshot` with `source = 'manual'` is already the correct target.

**Files:** `backend/src/modules/ledger/ledger.routes.ts`, `backend/src/modules/reports/balance-sheet.service.ts`, `backend/tests/app.test.ts`

**Design notes:** See `docs/V4_BACKLOG.md` §Cash Account Auto-Balance (F-10) for edge cases.

---

### PS-5: Tax Filing Profile + Stored Effective Federal Rate

**Blocked on due diligence — do not build until open questions are resolved.** See `docs/V4_BACKLOG.md` §PS-5 for full spec and open questions.

**Why this exists:** `PS-4 TaxSufficiencyAlert` computes the federal tax rate at runtime by scanning `payslip_line_item` rows for a "federal" line. This is brittle — IBM uses `"TX Withholding Tax"` with authority `"Federal"` rather than the word "federal" in the name, and future employer formats could differ again. The fix is to store the computed rate on `payslip_snapshot` at import time and read it directly, eliminating the heuristic.

**Phase 1 (independent — no due diligence needed):**
- Migration: add `effective_federal_rate_ytd` + `effective_total_tax_rate_ytd` to `payslip_snapshot`
- Import pipeline: compute and write these from normalised line items at finalization time
- `TaxSufficiencyAlert` reads from the stored columns instead of scanning line items
- **Files:** `backend/db/migrations/0049_ps5_tax_profile.sql`, `payslip.service.ts`, `payslip-async-import-reconcile.service.ts`

**Phase 2 (needs due diligence):**
- New table `person_tax_profile` — filing status, W-4 fields (credits, additional withholding), state code, per-year, per-person
- LLM extraction at import populates the profile when W-4 data is present in the payslip (IBM has it; Deloitte does not)
- User can view and correct via a Tax Profile section in Settings → People
- When populated, `TaxSufficiencyAlert` can show a more precise "estimated annual liability vs. withheld" comparison

**Open questions for due diligence:** Where should the filing profile live in the UI? State tax handling in scope for v1? IRS Pub 15-T tables vs. LLM for liability estimate? Check `canonical_extract_json` on real IBM payslips to confirm LLM extraction quality.

**Note:** Phase 2 only touches frontend for a small Settings sub-section. `PayslipDetailPage` itself doesn't change — it reads `effective_federal_rate_ytd` directly from the snapshot response.

---

### T-1: Documentation consolidation
Reduce 40+ markdown files in `docs/` to 5 canonical documents. Current state has multiple overlapping backlogs, archived PRDs with outdated status, and split deployment guides.

**Target structure:**
1. **`docs/USER_GUIDE.md`** — end-to-end feature guide for household users (enhance existing)
2. **`docs/ADMIN_GUIDE.md`** — everything for deploying and operating: consolidates `RUNBOOK.md`, `PRODUCTION_SETUP.md`, `HOSTING_OPTIONS_AND_HOME_LAB.md`, `OCI_DEPLOYMENT.md`, `ENVIRONMENT_VARIABLES.md`, `DATABASE_ARCHITECTURE.md`
3. **`docs/BACKLOG.md`** — single Jira-board-style backlog: consolidates all `*_BACKLOG.md` files, active V4/V5 items, and deferred items with notes
4. **`docs/PRD_AND_CRS.md`** — all requirements and change records: consolidates `archive/FINANCE_APP_PRD.md`, `archive/CATEGORIZATION_ROADMAP.md`, `archive/DECISIONS_LOG.md`, and inline PRD sections from API docs
5. **`docs/CHANGE_HISTORY.md`** — keep as-is; continue building on it

**Files to retire:** `ARCHITECTURE.md`, `EMAIL_INFRASTRUCTURE.md`, `EXPORT_IMPORT_BACKLOG.md`, `IMPORT_PIPELINE_SIMPLIFICATION_BACKLOG.md`, `MOBILE_UX_BACKLOG.md`, `MULTI_HOUSEHOLD_BACKLOG.md`, `RECURRING_PAYMENTS_BACKLOG.md`, `SECURITY_HARDENING_BACKLOG.md`, `PAYSLIP_V1.md`, `DATABASE_ARCHITECTURE.md`, `HOSTING_OPTIONS_AND_HOME_LAB.md`, `OCI_DEPLOYMENT.md`, `RUNBOOK.md`, `PRODUCTION_SETUP.md`, `ENVIRONMENT_VARIABLES.md`, `archive/FINANCE_APP_PRD.md`, `archive/CATEGORIZATION_ROADMAP.md`, `archive/DECISIONS_LOG.md`, `archive/PFM_COMPETITIVE_UX_REFERENCE.md`, `archive/PROJECT_CONTEXT.md`, `V3_BACKLOG.md` (historical), `V4_BACKLOG.md` (folds into `BACKLOG.md` when T-1 ships)

**Note:** API docs (`docs/API_*.md`) and `openapi/openapi.yaml` stay — they are per-domain technical references and don't consolidate well.

---

## Post-V4 (Deferred)

### D-1: Data archival + encrypted Drive archive
Pre-compute and store `monthly_report` rows at month close (income, lifestyle spend, tax, investments, category breakdown, net worth snapshot, savings rate, KPIs). User-configurable raw data retention window (e.g. 24 months rolling). After window expires, transactions archived/pruned; monthly summaries kept.

**Extended vision (2026-05-15):** Google Drive is already wired. Extend archival to encrypt and upload older monthly `.hfb` bundles to Drive. App keeps X years of live data in Postgres; older data lives as encrypted Drive archives that can be restored on demand. Large standalone infrastructure feature.

**Why deferred:** Pays off at 2+ years of data. Current Koyeb Postgres free tier (500 MB) is sufficient for now. Design the `monthly_report` schema with archival in mind from the start; do not implement until data size becomes a real constraint.

**Schema note (for future design):** `monthly_report` rows should be generated only after the month is fully imported/reconciled, be regenerable from raw data while raw data still exists, and treat the pruning step as explicit and irreversible (never silent).

---

### D-4: Multi-household
Email as canonical identity; `user_household_membership` join table. Deferred until there is a reason to release to multiple independent households. Not of interest at this time.

---

### PT-1: Property Tax Protest Assistant
Annual workflow to assess whether to protest a county appraisal and build evidence for both protest strategies (market value + unequal appraisal). Per-property worksheet, CAD data integration for comp assessment lookups, LLM-powered case analysis, and protest outcome tracker. Multi-state: Denton County TX (ARB) + Shelby County TN (Board of Equalization).

**Urgency note:** User's Denton County ARB hearing is June 8, 2026. This year's protest will likely be manual; feature targets next year's cycle. An early build before June 8 would serve as real-world validation.

**Architecture decision:** Built feature for data collection, storage, and protest tracking + LLM layer ("Generate protest strategy" button) for case analysis and multi-state strategy adaptation. Not a standalone Claude Code skill — requires persistent property and protest history data.

**Quick win available now (standalone):** Extract subject property physical facts (sqft/beds/baths/yearBuilt/lotSqft) from the existing Redfin `/detailsbyaddress` response. Currently parsed for comps only. Small isolated addition to `realty-api.service.ts`; should ship before the full ARB feature so data accumulates with each monthly refresh.

**Design details:** See `docs/V4_BACKLOG.md` §Property Tax Protest Assistant for full feature vision, CAD data landscape (DCAD portal URLs, Shelby County assessor URLs), reference services (ownwell.com, bezit.co), LLM layer design, and remaining open questions.

---

### FR-15: Household Staff module (V5/V6 candidate)
Full timesheet + expense + payment module for household employees (nanny, cleaner, au pair). `staff` RBAC role with restricted navigation (My Timesheet + My Expenses only). Admin review, approval, payment recording with optional ledger posting.

**Status:** Fully specced in `docs/archive/FINANCE_APP_PRD.md` §20. No code yet. Target delivery when household staff are onboarded (~2026 Q3/Q4). Spec preserved as-is — groom before building.

**Schema (designed, not built):** `staff_profile`, `timesheet_entry`, `timesheet_period`, `staff_expense`, `staff_payment`.

---

## Permanently Dropped

These items are removed from the active backlog. No plans to build.

| Item | Reason |
|---|---|
| D-3: Rental income tracking | Scope creep — app is not a rental property management tool |
| D-5: HELOC modeling | No HELOC; `linked_account_id` schema hook already exists for future use |
| ADP payslip / Capital One CSV parsers | No personal value; revisit only if employer/bank changes |
| OneDrive backup (Phase 2) | Google Drive works; OneDrive adds complexity for no personal gain |
| CR-095a: Self-service signup | Personal home app only; no public release planned |
| I-2: Async 202 for import/parse/canonicalize | Import is already async + stateful; 504s not a live problem |
| I-7: Recurring payments phase 4+ | Annual detection + bill prediction = low signal for daily use |
| Import pipeline API consolidation | Works well; consolidation is polish with no user-visible benefit |
| Transfer pair dissolution | No transfer pair UI; building it requires significant new surface |
| Category memory (Tier A) | Household rules + "create rule" popup already serve this need |
| Login 8-char password minimum | Acceptable; seed users have forced change on first login |
| Export TTL SQL INTERVAL style | Style-only; no correctness or security issue |
| `vitest --coverage` script | No CI pipeline; no coverage gate needed at this stage |
| HttpOnly JWT cookies | Not worth the complexity for single-household self-host |
| Manual dedup fuzzy matching | Same date+amount+slightly different description is a niche case; manual resolution is acceptable; complexity outweighs benefit |

---

## Summary Table

| ID | Title | Priority | Type |
|---|---|---|---|
| R-1 | Post-restore `force_password_change` | ✅ Shipped | Security |
| R-2 | BY ACCOUNT card — add YoY arrow alongside MoM arrow | ✅ Shipped | UX |
| R-3 | Remove `checking` from `LIABILITY_ACCOUNT_TYPES` | ✅ Shipped | Bug fix |
| F-6 | Dashboard + Net Worth caching with refresh icon | ✅ Shipped | Performance |
| TM-1 | Transfer date tolerance 2 → 4 days | ✅ Shipped | Bug fix |
| F-1 | In-app notification system + alerts | P2 | Feature |
| F-2 | Balance sheet member subtotals | ✅ Shipped | Feature |
| F-3 | Payslip enhancement pass (PS-1/PS-2/PS-3/PS-4) | ✅ Shipped | Feature |
| TM-2 | Transfer pair visibility + manual pair/unpair UI | ✅ Shipped | Feature |
| TM-3 | Transfer matching — same-institution score boost | ❌ Not doing | Enhancement |
| F-7 | AI Year-End "Wrapped" financial summary | P2 | Feature |
| I-8 | Playwright E2E spike | P3 | Testing |
| I-9 | Fuzzy match categorization (Tier B) | P3 | Enhancement |
| F-4 | Delete property | P3 | Feature |
| F-5 | Account closed/inactive status | P3 | Feature |
| F-8 | BY ACCOUNT card — account filter, row cap, full pass | ✅ Shipped | UX |
| F-6b | Net Worth snapshot + row-expansion cache | ✅ Shipped | Performance |
| I-10 | App-wide error logging audit | P3 | Reliability |
| I-12 | "Other" category hyperlink on dashboard | ✅ Shipped | UX |
| TM-4 | Near-duplicate detection — masked vs real description variants | P1 | Bug fix |
| F-9 | Recurring payments — display name field in tag modal | P2 | UX |
| F-10 | Cash account — auto-update balance snapshot on manual transaction | ✅ Shipped | Feature |
| PS-5 | Tax filing profile + stored effective federal rate | P3 (blocked on due diligence) | Feature |
| T-1 | Documentation consolidation (40 → 5 docs) | P3 | Maintenance |
| D-1 | Data archival + encrypted Drive archive | Deferred | Infrastructure |
| D-4 | Multi-household | Deferred | Architecture |
| I-11 | PWA file-input hang (Safari PWA works; Chrome deferred) | Deferred | Enhancement |
| PT-1 | Property tax protest assistant (ARB) | Deferred — needs grooming | Feature |
| FR-15 | Staff module (timesheets, expenses, payments) | Deferred (V5/V6) | Feature |

---

*Last updated: 2026-05-22. TM-2 (transfer pair visibility + pair/unpair UI) shipped (CR-204). Previous: F-3, F-10, TM-1, F-6, F-2, F-6b, F-8, I-12, R-1/R-2/R-3 shipped.*
