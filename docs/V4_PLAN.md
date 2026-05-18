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

### R-2: BY ACCOUNT card — add YoY delta arrow alongside existing MoM arrow
The "By Account — This Month" card currently shows one MoM arrow per account (thisMonth vs priorMonth). R-2 adds a **second arrow** showing the same metric vs the same month last year, so each row displays both comparisons side by side:

```
Bank of America · 1001   $251   ↑ (vs Apr)   ↓ (vs May '25)
```

This gives the user two meaningful signals at once: short-term trend (MoM) and seasonal baseline (YoY). A month that looks fine MoM might still be running significantly hotter than the same month last year.

**Implementation:** After F-8 switches the card to `account_balance_snapshot` as the data source, same-month-last-year balance is already in the snapshot table — no second fetch or backend change needed. Just pull the snapshot row for `month - 12` alongside the existing current and prior-month rows.

**Dependency:** F-8 must ship first. R-2 is a column added on top of a stable card.

**Files:** `frontend/src/pages/DashboardPageV2.tsx`

---

### R-3: Remove `checking` from `LIABILITY_ACCOUNT_TYPES` (dashboard arrow bug)
Checking accounts are liquid assets, not liabilities. The constant at `DashboardPageV2.tsx:175` incorrectly includes `"checking"`, causing the BY ACCOUNT card to show a red ↑ arrow when checking outflow increases month-over-month — the same signal used for a rising credit card balance. Checking outflow increase should show gold ↑ (neutral) not terracotta (bad).

**Fix:** Remove `"checking"` from the set. Correct list: `new Set(["credit_card", "loan"])`.

**Files:** `frontend/src/pages/DashboardPageV2.tsx` (line 175)

---

### F-6: Dashboard + Net Worth page caching with session refresh icon
Every Home page and Net Worth page load re-runs expensive aggregate SQL queries (cash summary, balance sheet history). For a self-hosted offline app, data does not change between page loads — only after a new import. Caching in `sessionStorage` with an explicit refresh button eliminates the per-navigation latency.

**Scope:**
- **Home page:** Cache `GET /reports/cash-summary` in `sessionStorage` keyed by `household_id + active_month`. On mount, serve cached data immediately. Refresh icon (top-right corner of the inflow/outflow KPI card) triggers a fresh fetch, updates the cache, and shows a "Last updated X min ago" tooltip.
- **Net Worth page:** Same pattern for `GET /reports/balance-sheet` + history. Cache keyed by `household_id + member_filter`.
- **Cache invalidation:** Clear relevant keys when import session is finalized (dispatch a `CustomEvent` from the import flow, listened to by cached pages).
- **Shared hook:** `useSessionCache<T>(key, fetcher)` — returns `{ data, loading, refresh, lastUpdatedAt }`.

**Design notes:** See `docs/V4_BACKLOG.md` §Dashboard + Net Worth Caching for implementation pattern.

**Files:** `frontend/src/pages/DashboardPageV2.tsx`, `frontend/src/pages/NetWorthPage.tsx`; new `frontend/src/hooks/useSessionCache.ts`

---

### TM-1: Transfer matching — bump date tolerance from 2 → 4 days
The current transfer auto-pairing window is ±2 days (`canonical-ingest.service.ts:922`). Real-world bank-to-bank ACH transfers routinely take 3 days, causing confirmed pairs to miss the window and land in the unmatched queue. Widening to 4 days catches the common 3-day lag without materially increasing false-pair risk: the pair score threshold (45) and same-account exclusion both still apply.

**Implementation:** Change the `<= 2` check at line 922 to `<= 4`. Update the `closeDateToleranceDays` telemetry field (line 964) to match.

**Files:** `backend/src/modules/canonical/canonical-ingest.service.ts` (lines 922, 964)

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

### F-2: Balance sheet member subtotals
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

### F-3: Payslip enhancement pass
A cohesive pass over the payslip feature covering: month-over-month comparison, investment contribution grouping, savings/wealth-building rate, and tax sufficiency signal. All payslip-related improvements in one release rather than scattered commits.

**Design details:** See `docs/V4_BACKLOG.md` §Payslip Enhancement Pass for full spec.

**Sub-items:**

**PS-1 — Month-over-month delta badges:** Net pay, gross pay, total taxes, total pre-tax deductions compared to the prior payslip for the same person. Display as absolute delta + direction icon (↑ / ↓ / —). "Prior" = the immediately preceding `pay_period_end` for the same `person_profile_id`. Service-layer only addition; no schema change.

**PS-2 — Investment contribution grouping:** Group pre-tax deduction line items from `payslip_line_items` by contribution type (retirement: 401k/403b/457; equity: ESPP/RSU; health: HSA/FSA). Show YTD total per group on the payslip detail page. The LLM already extracts these; this is grouping + display.

**PS-3 — Savings / wealth-building rate:** Per payslip: what percentage of gross goes to pre-tax contributions (retirement + equity + health). Running YTD rate across the pay year for the person. Pure computation from already-extracted data.

**PS-4 — Tax sufficiency signal:** Annualised federal + state withholding rate (YTD withheld ÷ YTD gross × 12/pay-period-count). Display a subtle flag if annualised federal rate looks low vs 20% general benchmark. NOT a full tax calculation — just a data-derived signal to prompt the user to check their W-4.

**Files:** `backend/src/modules/payslip/payslip.service.ts`, `frontend/src/pages/PayslipDetailPage.tsx`, `frontend/src/payslip/types.ts`

---

### TM-2: Transfer pair visibility + manual pair/unpair UI
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

### TM-3: Transfer matching — same-institution score boost
When two transactions share the same date, exact matching absolute amounts (opposite signs), and belong to accounts at the **same institution**, it is almost certainly an internal transfer (Citibank card → Citibank savings; BofA checking → BofA credit card payment). The current scorer returns 0 for these pairs when both memos are empty — below the auto-pair threshold (45) — so they land in the resolution queue instead of auto-pairing.

**Fix:** Extend the candidates query to include `institution`. Pass institution to `transferPairScore`. Return 55 when `sameInstitution && dateDiff === 0`. Score 55 is above the auto-pair threshold but still subject to normal ambiguity resolution if multiple same-amount same-institution candidates exist.

**Why not score 0 by default on same-day same-amount different accounts:** An Amazon purchase ($182.81) and a Citibank internal transfer ($182.81) could coincide — institution is the discriminating signal. Amazon is never the institution on a `financial_account` row.

**Files:** `backend/src/modules/canonical/canonical-ingest.service.ts` (candidates query + `transferPairScore` signature + call sites)

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

### F-8: BY ACCOUNT card — full redesign pass

Design decisions locked 2026-05-18:

**Account types shown:** `credit_card`, `checking`, `savings` only.
- `loan` excluded — loan balances decrease steadily and predictably; no actionable signal month-to-month.
- `investment`, `retirement`, `property` excluded — not flow accounts in the monthly sense.

**Row cap:** Top **3 credit cards** + top **3 checking/savings** = max 6 rows. Enough for signal, not overwhelming.

**Primary metric: current balance from `account_balance_snapshot`**, not transaction-derived outflow.
- Rationale: this is an offline app. The user may update account balances manually (without uploading a statement). In that case transaction-derived outflow is incomplete, but the balance snapshot is authoritative. If imports are complete, outflow and balance should agree anyway.
- Credit cards: display current balance (= debt owed). ↑ balance = more debt = bad (terracotta). ↓ = paying it down (forest).
- Checking/savings: display current balance (= liquid assets). ↑ = growing (forest). ↓ = depleting (gold — cautionary, not catastrophic).

**Comparison arrows (MoM and YoY after R-2):** Compare current month's `account_balance_snapshot` vs prior month's snapshot, and vs same-month-last-year snapshot. Both snapshots are already stored; no new backend data needed beyond what `account_balance_snapshot` already holds.

**R-3 still applies:** `checking` color fix (`LIABILITY_ACCOUNT_TYPES`) is still the right one-liner to ship immediately. F-8 is the broader structural pass on top.

**Build order:** R-3 (color fix) → F-8 (switch to balance metric, account filter, row cap) → R-2 (add YoY arrow column).

**Files:** `frontend/src/pages/DashboardPageV2.tsx`, possibly `backend/src/modules/reports/` if a new balance-by-account endpoint is needed.

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

### I-12: "Other" category hyperlink on WHERE MONEY WENT card
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
| R-2 | BY ACCOUNT card — add YoY arrow alongside MoM arrow | P2 | UX |
| R-3 | Remove `checking` from `LIABILITY_ACCOUNT_TYPES` | P1 | Bug fix |
| F-6 | Dashboard + Net Worth caching with refresh icon | P1 | Performance |
| TM-1 | Transfer date tolerance 2 → 4 days | P1 | Bug fix |
| F-1 | In-app notification system + alerts | P2 | Feature |
| F-2 | Balance sheet member subtotals | P2 | Feature |
| F-3 | Payslip enhancement pass (PS-1/PS-2/PS-3/PS-4) | P2 | Feature |
| TM-2 | Transfer pair visibility + manual pair/unpair UI | P2 | Feature |
| TM-3 | Transfer matching — same-institution score boost | P2 | Enhancement |
| F-7 | AI Year-End "Wrapped" financial summary | P2 | Feature |
| I-8 | Playwright E2E spike | P3 | Testing |
| I-9 | Fuzzy match categorization (Tier B) | P3 | Enhancement |
| F-4 | Delete property | P3 | Feature |
| F-5 | Account closed/inactive status | P3 | Feature |
| F-8 | BY ACCOUNT card — account filter, row cap, full pass | P3 | UX |
| I-10 | App-wide error logging audit | P3 | Reliability |
| I-12 | "Other" category hyperlink on dashboard | P3 | UX |
| T-1 | Documentation consolidation (40 → 5 docs) | P3 | Maintenance |
| D-1 | Data archival + encrypted Drive archive | Deferred | Infrastructure |
| D-4 | Multi-household | Deferred | Architecture |
| I-11 | PWA file-input hang (Safari PWA works; Chrome deferred) | Deferred | Enhancement |
| PT-1 | Property tax protest assistant (ARB) | Deferred — needs grooming | Feature |
| FR-15 | Staff module (timesheets, expenses, payments) | Deferred (V5/V6) | Feature |

---

*Last updated: 2026-05-18. R-1 shipped (SEC-003). R-2 re-scoped: MoM + YoY balance arrows on BY ACCOUNT card; simplified by F-8 switching to account_balance_snapshot (no extra fetch needed). F-8 design locked: credit_card/checking/savings only, top 3 per group (max 6 rows), balance from account_balance_snapshot as primary metric, loan/investment/retirement/property excluded. Recommended build order: R-3 (color fix) → F-8 (balance metric + filter + cap) → R-2 (YoY arrow) → TM-1 → F-6 → F-2 → F-3 → TM-2 + TM-3 → F-7 → F-1 → P3 items.*
