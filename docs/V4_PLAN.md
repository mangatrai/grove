# V4 Plan — Feature List with Priority

**Compiled:** 2026-05-15. Sources: post-V3 docs audit, user priorities review session, `V3_PLAN.md` deferred items, `SECURITY_HARDENING_BACKLOG.md`, `MOBILE_UX_BACKLOG.md`.

**Priority tiers:**
- **P1** — Quick fix or correctness issue; high value, low risk
- **P2** — High-value feature; materially improves the app for regular use
- **P3** — Useful improvement; non-blocking, lower impact or more speculative
- **Deferred** — Explicitly post-V4; noted here for awareness

---

## P1 — Quick Fixes

### R-1: Post-restore `force_password_change`
After a household restore, all sessions are invalidated via `token_version` bump, but existing user passwords are unchanged. A restore from a backup could be from a compromised state; forcing a password change on next login for all users is a cheap safety net.

**Implementation:** In `import-household-bundle.service.ts`, after the wipe-and-restore transaction completes, run:
```sql
UPDATE app_user SET force_password_change = TRUE WHERE household_id = ?
```
The `force_password_change` column already exists; login already returns it; the password-change redirect already exists in the frontend. This is a 3-line addition.

**Files:** `backend/src/modules/export/import-household-bundle.service.ts`

---

### R-2: YoY delta on Home KPIs (frontend-only)
The backend already computes a `yearOverYear` comparison block for `preset=month` (same month last year — inflows, outflows, net, delta). The frontend ignores it entirely — not a single reference anywhere in the codebase.

**Implementation:** Wire up the existing `comparison.yearOverYear` field from the cash summary API response to display a "vs same month last year" secondary delta badge on the Home page KPI tiles, alongside the existing "vs last month" delta. No backend change required.

**Files:** `frontend/src/pages/HomePage.tsx`

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

---

## Summary Table

| ID | Title | Priority | Type |
|---|---|---|---|
| R-1 | Post-restore `force_password_change` | P1 | Security |
| R-2 | YoY delta on Home KPIs (frontend-only) | P1 | UX |
| F-1 | In-app notification system + alerts | P2 | Feature |
| F-2 | Balance sheet member subtotals | P2 | Feature |
| F-3 | Payslip enhancement pass (PS-1/PS-2/PS-3/PS-4) | P2 | Feature |
| I-8 | Playwright E2E spike | P3 | Testing |
| I-9 | Fuzzy match categorization (Tier B) | P3 | Enhancement |
| T-1 | Documentation consolidation (40 → 5 docs) | P3 | Maintenance |
| D-1 | Data archival + encrypted Drive archive | Deferred | Infrastructure |
| D-4 | Multi-household | Deferred | Architecture |
| PT-1 | Property tax protest assistant (ARB) | Deferred — needs grooming | Feature |
| FR-15 | Staff module (timesheets, expenses, payments) | Deferred (V5/V6) | Feature |

---

*Last updated: 2026-05-15. V4 planning complete. Recommended build order: R-1 + R-2 (quick wins, same session) → F-2 (balance sheet subtotals) → F-3 (payslip pass) → F-1 (notifications, scope triggers before building) → P3 items in any order.*
