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

## CR-126 — .hfb Format + Backup Encryption
**Date:** 2026-04-30
**Files:** `backend/src/modules/export/backup-crypto.ts` (new), `backend/src/modules/export/export-job.service.ts`, `backend/src/modules/export/import-household-bundle.service.ts`, `backend/src/modules/export/exports.routes.ts`, `backend/src/config/env.ts`, `frontend/src/pages/SettingsPage.tsx`, `backend/tests/app.test.ts`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/API_EXPORTS.md`
**What:** All backup files now use the `.hfb` extension (Household Finance Backup). Added optional AES-256-GCM encryption via `BACKUP_ENCRYPTION_KEY` env var (64-char hex = 32-byte key). Encrypted files are prefixed with `HFB1` magic bytes + IV + auth tag. Restore auto-detects encrypted files and decrypts before processing. If a backup is encrypted and `BACKUP_ENCRYPTION_KEY` is absent, restore fails with a clear error message. Frontend FileInput now accepts `.hfb` only, and download filenames now use `.hfb`.

---

## CR-125 — Export/Import Parity (exportVersion 4)
**Date:** 2026-04-30
**Files:** `backend/src/modules/export/export-registry.ts` (new), `backend/src/modules/export/export-household-bundle.service.ts`, `backend/src/modules/export/import-household-bundle.service.ts`, `backend/src/server.ts`, `backend/src/db/export-coverage-check.ts`, `backend/tests/app.test.ts`
**What:** Introduced `EXPORT_REGISTRY` as the single source of truth for backed-up tables. Export now uses `SELECT *` with no hardcoded column lists. Added five missing tables: `budget_category`, `payslip_line_item`, `recurring_merchant_override`, `resolution_item`, `household_ai_insight`. Fixed silently missing columns on `household`, `person_profile`, and `payslip_snapshot` (added by migrations 0022 and 0031 but absent from prior hardcoded SELECT lists). Added startup coverage check that warns if any non-ephemeral DB table is absent from the registry. Bumped `exportVersion` to 4. Import service handles v1/v2/v3 bundles with graceful skip for absent table keys.

---

## UX-127 (2026-04-30): Surface account freshness dates in Settings and Import workspace
- **Type:** UX
- **What changed:** Added `Last upload` and `Statement ending` account freshness context in two high-use UI surfaces.
- **Settings UI:** Connected Accounts table now includes an `Import freshness` column with both dates per account.
- **Import UI:** Account picker keeps compact account labels; freshness dates are shown below the selected account row (not inside picker option labels).
- **Display behavior:** Missing upload is shown as `Never`; missing statement end date is shown as `Not detected`.
- **Files changed:** `frontend/src/import/accountDisplay.ts`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`.

---

## CR-127 (2026-04-30): Account import freshness metadata on `/imports/accounts`
- **Type:** CR
- **What changed:** `GET /imports/accounts` now returns per-account freshness metadata: `last_uploaded_at` (latest parsed upload timestamp) and `last_statement_end_date` (latest detected statement period end date).
- **Backend behavior:** Freshness is derived from parsed `import_file` rows; statement end date is read from parser metadata (`confidence_summary.statementBalances.asOfEnd`) when available.
- **Test coverage:** Added backend integration assertion that `/imports/accounts` includes freshness fields after a successful upload.
- **Files changed:** `backend/src/modules/imports/import-file-binding.service.ts`, `backend/tests/import-upload-flow.test.ts`, `docs/API_IMPORT_SESSIONS.md`, `openapi/openapi.yaml`.

---

## FIX-095e (2026-04-30): Disable outbound email delivery in TEST mode
- **Type:** FIX
- **Issue:** Invite/password-reset integration tests set SMTP env fields to exercise token/invite flows, which allowed real email delivery attempts when transport resolved.
- **Fix:** `sendMail()` now hard-stops outbound delivery when `MODE=TEST`, returning `DELIVERY_DISABLED_IN_TEST` after logging a skip message.
- **Behavior impact:** Auth/member invite flows still execute and generate reset tokens during tests; only SMTP transmission is suppressed.
- **Files changed:** `backend/src/modules/mailer/mailer.service.ts`.

---

## CR-095d (2026-04-29): Password-changed security notification email
- **Type:** CR
- **What changed:** `POST /auth/change-password` now sends a security notification email after a successful password update.
- **When email configured:** `changePassword()` fires `sendMail()` as fire-and-forget after DB update succeeds.
- **When not configured:** No-op; existing behavior remains unchanged.
- **New template:** Added `backend/src/modules/mailer/templates/password-changed.ts`.
- **Files changed:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/mailer/templates/password-changed.ts`, `backend/tests/password-reset.test.ts`.

---

## UX-095c (2026-04-29): Explain guarded member delete in remove dialog
- **Type:** UX
- **Issue:** When removing a member with a linked login and leaving "Also delete their login account" unchecked, backend correctly returned `409 HAS_LOGIN_ACCOUNT` but the dialog showed no inline feedback.
- **Fix:** Added explicit inline error messaging inside the remove-member confirmation dialog so users understand why deletion was blocked and what action is required.
- **Files changed:** `frontend/src/pages/SettingsPage.tsx`.

---

## FIX-095c (2026-04-29): Household member delete/login guard correctness
- **Type:** FIX
- **Issue:** Deleting a member with `deleteLogin=true` failed with FK violation (`person_profile.linked_user_id -> app_user.id`) because delete order removed `app_user` first.
- **Issue:** Deleting with `deleteLogin=false` still removed members even when a linked login existed, contrary to intended guard behavior.
- **Fix:** `deleteHouseholdMember` now returns `HAS_LOGIN_ACCOUNT` when a linked login exists and `deleteLogin` is false, and when `deleteLogin` is true it deletes `household_membership` + `person_profile` before deleting `app_user`.
- **Route mapping:** `DELETE /household/members/:memberId` now maps `HAS_LOGIN_ACCOUNT` to HTTP 409.
- **Regression test:** Added backend coverage for both guarded delete (409) and full delete with login removal (204 + user row removed).
- **Files changed:** `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`, `backend/tests/member-invite.test.ts`, `openapi/openapi.yaml`.

---

## CR-095c (2026-04-29): Member invite email + admin reset-password email
- **Type:** CR
- **What changed:** Wired member login creation and admin-triggered member password reset to SMTP email infrastructure using existing `password_reset_token` flow (no new tables, no new routes).
- **Create login (email configured):** `createHouseholdMember` and `createLoginForMember` now set an unguessable hash and send invite email with a 24-hour reset link (`inviteSent: true`).
- **Create login (no email):** Existing `ChangeMe123!` + force-change fallback remains unchanged (`inviteSent: false`).
- **Admin reset (email configured):** `resetMemberPassword` now invalidates session (`token_version` bump), creates a 1-hour reset token, sends reset email, and does not expose temp password.
- **Admin reset (no email):** Existing temporary password flow and modal fallback remains unchanged.
- **New template:** Added `backend/src/modules/mailer/templates/member-invite.ts`.
- **Files changed:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `backend/src/modules/mailer/templates/member-invite.ts`, `openapi/openapi.yaml`, `backend/tests/member-invite.test.ts`.

---

## CR-095b-fix (2026-04-29): Password reset regressions (link, capabilities, login UX)
- **Type:** FIX
- **Reset link:** `requestPasswordReset` now builds `PUBLIC_BASE_URL/reset-password?token=...` for BrowserRouter instead of `/#/reset-password` (HashRouter). File: `backend/src/modules/auth/auth.service.ts`.
- **Email readiness:** `isEmailConfigured()` now requires a non-empty `PUBLIC_BASE_URL` so reset links are always buildable when the UI reports email enabled. File: `backend/src/config/env.ts`.
- **Forgot password UX:** When email is enabled, the reset form is gated behind a "Forgot password?" click (`showForgotForm`) instead of showing immediately. File: `frontend/src/pages/HomePage.tsx`.
- **Tests:** `backend/tests/password-reset.test.ts` sets `PUBLIC_BASE_URL` in the SMTP test harness so integration tests still exercise token creation after the stricter `isEmailConfigured()` check; `beforeEach` clears email-related `env` fields so `GET /auth/capabilities` stays deterministic when the repo `.env` defines SMTP for local dev.

## CR-095b (2026-04-29): Email infrastructure + self-service password reset
- **Type:** CR
- **Motivation:** Introduce production-ready email infrastructure and end-user password reset without exposing account enumeration, while keeping the existing admin reset path as fallback.
- **Database:** Added migration `backend/db/migrations/0033_password_reset_token.sql` with `password_reset_token` table (`token_hash`, one-hour expiry, single-use via `used_at`) plus `idx_prt_user`.
- **Backend mailer module:** Added `backend/src/modules/mailer/` with typed payloads (`mailer.types.ts`), reusable HTML wrapper (`templates/layout.ts`), password reset template (`templates/password-reset.ts`), and lazy singleton SMTP transport (`mailer.service.ts`) using nodemailer.
- **Backend auth APIs:** Added `GET /auth/capabilities`, `POST /auth/forgot-password`, and `POST /auth/reset-password` in `auth.routes.ts` with Zod validation, TEST-mode-aware rate limits, and invariant `200` response for forgot-password.
- **Auth service logic:** Added reset token issuance/rotation, SHA-256 token hashing, one-hour expiry, single-use token consumption in transaction, password change with bcrypt cost 12, and `token_version` bump to revoke prior JWTs.
- **Config/env:** Added SMTP and public URL env vars in `backend/src/config/env.ts`, `.env.example`, and docs (`docs/ENVIRONMENT_VARIABLES.md`), including Resend and Gmail App Password examples.
- **Frontend UX:** Added public `ResetPasswordPage` route (`/#/reset-password?token=...`) and updated `HomePage` to fetch `/auth/capabilities`; shows legacy admin tip when email is disabled and an inline forgot-password form when enabled; adds `?reset=1` success alert after reset.
- **Contract docs:** Updated `openapi/openapi.yaml` with full schemas for the three new auth endpoints and error shapes; updated `docs/EMAIL_INFRASTRUCTURE.md` status to implemented.
- **Tests:** Added `backend/tests/password-reset.test.ts` covering capabilities, forgot-password invariants, token lifecycle, reset success + JWT invalidation, invalid/expired/used token handling, weak password validation, and same-password rejection.

---

## UX-126 (2026-04-29): Net Worth page — Mantine migration + layout redesign
- **Type:** UX
- **Motivation:** Net Worth page was the last major page on the old `.card`/raw-div layout, inconsistent with the Mantine-first standard established by Dashboard V2 (UX-120). Layout was also flat — KPI totals were buried inside a section rather than promoted to the top.
- **KPI hero strip:** Assets / Liabilities / Net Worth promoted to a `SimpleGrid` (3-col on sm+, stacked on mobile) at the top of the page. Each tile is a `Paper` with a color-coded top border (`--color-success` for assets, `--color-warm` for liabilities, accent/danger adaptive for net worth sign). Values use tabular-numeral font variant for alignment.
- **Delta chips:** Period summary section now renders three delta chips (ASSETS, LIABILITIES, NET WORTH) showing signed change (`+$X` / `–$X`) over the selected trend window with green/red backgrounds keyed to financial direction (liabilities decreasing = green).
- **`formatSignedDelta` helper:** New utility formats a signed numeric delta with `+`/`–` prefix and `$` amount — used exclusively by the delta chips.
- **Period preset pills:** 3M / 6M / 12M / 2Y / 3Y / YTD / Custom controls retained but styled via existing CSS variables (pending full Mantine `SegmentedControl` migration in a later pass).
- **Balance sheet table split:** Assets and Liabilities account tables now rendered as separate `Paper` sections rather than interleaved. Clarifies the two-sided structure.
- **Mantine 7 migration:** All layout shells migrated — `Paper` (with `withBorder shadow="sm"`), `Stack`, `Group`, `SimpleGrid`, `Title`, `Text`, `Anchor`, `Alert`, `Skeleton`, `Button`, `Select`, `Divider`, `Box`. Chart tooltip shell converted to `Paper`.
- **Recharts `Legend` removed:** Replaced with a manual legend using `Text`/`Group` Mantine primitives to match the visual language of the rest of the page.
- **CSS delta:** 136 Net Worth-specific utility classes added mid-migration then fully removed once Mantine tokens replaced them — net zero CSS delta.
- **No backend or API changes.** Pure presentation migration.
- **Files changed:** `frontend/src/pages/NetWorthPage.tsx`, `frontend/src/index.css` (net zero).

---

## UX-125 (2026-04-29): Forest Studio design theme + 3-way OS-aware color scheme toggle
- **Type:** UX
- **Motivation:** App was visually monotonous (single green everywhere) and "harsh on eyes" due to cold blue-gray backgrounds and neon accent colors. Dark mode used cold navy blacks. Theme toggle had no "Auto (follow OS)" option despite Mantine already supporting it.
- **Palette redesign: "Forest Studio"** — warm neutrals throughout, mature Pantone-forest greens, forest-night chrome. Grounded in UX research on warm vs cold color perception for extended use.
  - **Light mode:** Page background changed from cold `#f0f4f8` → warm linen `#efebe3`. Surface from pure white → warm `#fdfcfb`. All borders warm stone-toned. Text warm stone-900 (`#1c1917`) instead of cold slate-900.
  - **Dark mode:** Page bg changed from cold navy `#0f1420` → warm brown-black `#131009`. Surfaces warm brown-dark. Eliminates the "electric navy" look that's harsh at night.
  - **Sidebar chrome:** Changed from cold navy (`#1a2540`) → dark forest night (`#1a2b1f`). Now has a clear semantic relationship to the forest green identity instead of feeling like a different app.
  - **Active accent:** Changed from neon lime `#4ade80` → soothing mint teal `#6ee7b7`. Less fatiguing, more refined.
  - **Primary color ramp:** Replaced with mature Pantone Forest family — `#2d6a4f` as default shade. Not aggressive lime-green, but sophisticated earthy forest.
  - **Shadows:** Warm-tinted (rgba warm stone) instead of cold blue-tinted.
- **3-way theme switcher** in `AppTopBar`: replaced the 2-state sun/moon toggle with a compact Sun | Monitor | Moon segmented control. "Monitor" sets `'auto'` which follows OS preference via `useMantineColorScheme({ setColorScheme('auto') })`. User preference persists in localStorage (`hf_color_scheme`). OS-auto was already wired in `main.tsx` via `defaultColorScheme="auto"` — this exposes it in the UI.
- **Component updates:** KPI cards, KPI delta chips, table headers, category picker flyout, hs-picker, transaction toolbar, dashboard scope bar, bulk action bar, settings tabs, category rules section — all updated to use CSS variables instead of hardcoded cold blue-grays.
- **KPI income/expense colors:** `kpi-in` and `kpi-out` now use `--color-success` and `--color-expense` (warm terracotta) instead of harsh hardcoded greens/reds.
- **Files changed:** `frontend/src/theme.ts`, `frontend/src/index.css`, `frontend/src/layout/AppTopBar.tsx`, `frontend/src/pages/PayslipsPage.tsx` (fixed pre-existing unused import).

## CR-124 (2026-04-28): AI Financial Health Analysis (on-demand)
- **Type:** CR + DB
- Added migration `backend/db/migrations/0031_ai_financial_insight.sql` with new demographic fields on `household` (`city`, `state`, `combined_gross_income_usd`) and `person_profile` (`age`, `sex`, `individual_gross_income_usd`, `risk_tolerance`, `financial_goals_json`), plus new `household_ai_insight` and `insight_job` tables.
- Added backend insights module under `backend/src/modules/insights/` with 5 routes: `GET /insights/financial`, `POST /insights/financial/refresh`, `GET /insights/financial/status/:jobId`, `GET /insights/financial/history`, `GET /insights/financial/:id`.
- Added LLM provider abstraction in `llm-provider.service.ts` with `LLM_PROVIDER=openai|anthropic` and Anthropic SDK support.
- Extended household/profile APIs and services to read/write demographics and financial profile fields.
- Added dashboard financial health card (`frontend/src/components/FinancialHealthCard.tsx`) and integrated into `DashboardPageV2`; added Settings `insights` history tab plus new profile/household demographic form fields.
- Added integration coverage in `backend/tests/insights.test.ts` for insights refresh/status and new household/profile fields.
- Completed strict Mantine 7 sweep for `frontend/src/pages/SettingsPage.tsx` (all legacy tab controls migrated to Mantine components across profile, household, accounts, recurring, security, notifications, and insights sections).
- Normalized validation error shape to `400 { errors: z.issues }` in household and insights route validators; aligned insights service/route envelope behavior and OpenAPI/docs response contracts.
- Expanded OpenAPI household contract to match runtime handlers for `/household/members/{memberId}/data-count` and `/household/members/{memberId}/create-login`, plus detailed request/response/error mappings across household settings/profile/member endpoints.
- Final UI polish pass: refined Settings tab/header density, restored pill-shaped top-bar controls, moved AI card below core dashboard KPIs, improved compact AI card presentation, prevented duplicate insight refresh triggers, fixed Security tab crash on password input, and enforced Security-only tab access during forced first-login password change.
- Added migration `backend/db/migrations/0032_insight_job_household_index.sql` to index `insight_job(household_id)` for faster household-scoped job lookups.
- Added server-side refresh rate limit in `backend/src/modules/insights/insights.routes.ts` (one refresh per household per 5 minutes, `429 RATE_LIMITED`), with test-mode bypass to keep integration tests deterministic.
- Refactored `overBudgetCategories` in `backend/src/modules/insights/insight-prompt.service.ts` to replace per-budget-row spend lookups with a single grouped aggregate query (removes N+1 query pattern).
- Expanded user and API docs for insights behavior and contracts: `docs/USER_GUIDE.md`, `docs/API_INSIGHTS.md`, and `openapi/openapi.yaml` (including `429` response contract).
- Fixed desktop sidebar behavior so Settings/collapse controls stay visible within viewport-height navigation on long pages (`frontend/src/index.css` sidebar now viewport-anchored with internal nav scrolling).
- Added All-tab bulk action parity in Transactions by wiring "Move to trash" into the existing household bulk-trash flow (`frontend/src/pages/TransactionsPage.tsx`).
- Improved restore upload affordance in Settings with clearer Mantine `FileInput` presentation (placeholder, upload icon, full-width input, explicit action button width) while retaining disabled restore safety until a ZIP is selected (`frontend/src/pages/SettingsPage.tsx`).
- Normalized landing sign-in CTA to Mantine `Button` so the first-page auth action follows the app theme contract and no longer renders as a legacy gray control (`frontend/src/pages/HomePage.tsx`).
- Migrated Payslips list and Add-manual payslip pages toward Mantine-first presentation by replacing legacy card/header/action/button primitives with Mantine `Paper`/`Title`/`Text`/`Button`/`ActionIcon`/`Alert` wrappers while preserving existing backend/API behavior (`frontend/src/pages/PayslipsPage.tsx`, `frontend/src/pages/PayslipManualPage.tsx`).
- Continued payslip Mantine pass on detail and confirmation UX: `frontend/src/pages/PayslipDetailPage.tsx` now uses Mantine layout shells (`Paper`/`Stack`/`Title`/`Text`/`Alert`/`Anchor`) for key sections, and shared delete confirmations were upgraded to Mantine buttons in `frontend/src/components/ConfirmDialog.tsx`.
- Fixed visual alignment of Add-manual payslip field rows (`Who / employer`, `Salary / rate`) by normalizing row layout and control heights in `frontend/src/pages/PayslipManualPage.tsx`.
- Fixed Add-manual line-item crash on environments without `crypto.randomUUID()` by adding a safe draft-id fallback generator in `frontend/src/pages/PayslipManualPage.tsx`.
- Replaced remaining legacy Add-row controls in payslip detail line-item section with Mantine buttons (`frontend/src/pages/PayslipDetailPage.tsx`), reducing mixed button styling.

---

## FIX-123 (2026-04-28): Recurring overrides — hardening fixes across Phase 1/2/3
- **Backend validation gap (whitespace key):** `merchantKey` Zod schema in `recurring.routes.ts` changed from `z.string().min(1)` to `z.string().trim().min(1)` — a single-space input like `" "` previously passed the `min(1)` check and reached the service where `.trim()` produced an empty string that could be persisted. Now rejected at the boundary with a 400.
- **Case normalization:** `recurring.service.ts` now lowercases `merchantKey` before insert/upsert (was trim-only). The DB `UNIQUE (household_id, merchant_key)` constraint is case-sensitive; without this, `"Netflix"` and `"netflix"` created two separate rows with ambiguous matching behaviour. The frontend modal was already lowercasing client-side, but the API is now the authoritative normalizer.
- **DELETE response not checked (Phase 2/3):** Three sites updated to throw on non-2xx DELETE responses instead of silently updating UI state as if the request succeeded:
  - `TransactionsPage.tsx` — `onRemove` in the recurring modal wiring
  - `SettingsPage.tsx` — `handleRemoveDismissed` inline handler
  - `SettingsPage.tsx` — `onRemove` in the settings modal wiring
  Errors now propagate to the modal's catch block and are surfaced to the user.
- Files: `backend/src/modules/recurring/recurring.routes.ts`, `backend/src/modules/recurring/recurring.service.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/SettingsPage.tsx`

---

## CR-123 (2026-04-28): Recurring overrides management tab in Settings (Phase 3)
- Added a new `Recurring` tab to `frontend/src/pages/SettingsPage.tsx` with:
  - Separate confirmed and dismissed override tables.
  - Confirmed row edit action wired to `RecurringTagModal` (save/remove).
  - Dismissed row remove action for unsuppressing merchants.
- Added recurring tab state/effects to fetch and maintain override data via existing API calls only (`GET`, `POST`, `DELETE` on `/recurring-overrides`).
- Updated recurring API documentation in `docs/API_RECURRING.md` with a Phase 3 Settings management section.
- Why: Phase 3 provides a centralized management surface for recurring tagging decisions so users can audit and adjust overrides without returning to dashboard suggestions or individual transaction rows.

---

## CR-122 (2026-04-28): Recurring payments hybrid tagging Phase 2 in transactions view
- Added recurring tagging UX to `frontend/src/pages/TransactionsPage.tsx`:
  - Loads recurring overrides alongside transactions/categories/accounts.
  - Adds per-row recurring icon for posted debit transactions (`○` untagged, `●` confirmed) and opens a tagging modal.
  - Adds client-side `recurringOnly=true` URL filter in More filters and includes it in active-filter/clear-filter behavior.
- Added new modal component `frontend/src/components/RecurringTagModal.tsx` for confirm/edit/remove recurring overrides, including:
  - Editable merchant match key, amount anchor, tolerance %, and live match count against loaded transactions.
  - Confirm via existing `POST /recurring-overrides` and remove via existing `DELETE /recurring-overrides/:id`.
- Updated recurring API doc `docs/API_RECURRING.md` with frontend tagging flow notes so future work understands how the transactions page consumes existing endpoints without backend changes.
- Why: Phase 2 wires the already-shipped recurring override backend into day-to-day transaction triage, letting users tag and filter recurring debits directly where they review ledger rows.

---

## CR-121 (2026-04-28): Recurring payments hybrid tagging Phase 1 override store + dashboard dismiss flow
- Added migration `backend/db/migrations/0030_recurring_merchant_override.sql` introducing `recurring_merchant_override` with household-scoped unique `(household_id, merchant_key)` rows and confirm/dismiss verdict support.
- Added new backend recurring module (`backend/src/modules/recurring/recurring.service.ts`, `backend/src/modules/recurring/recurring.routes.ts`, `backend/src/modules/recurring/recurring.types.ts`) and registered router in `backend/src/app.ts` for:
  - `GET /recurring-overrides` (list)
  - `POST /recurring-overrides` (upsert confirmed/dismissed override)
  - `DELETE /recurring-overrides/:id` (delete by id in household scope)
- Updated dashboard recurring module (`frontend/src/pages/DashboardPageV2.tsx`) to:
  - Fetch recurring overrides with other dashboard data.
  - Persist dismiss actions via `POST /recurring-overrides` and optimistically hide dismissed heuristic candidates.
  - Render confirmed overrides above heuristic suggestions, while filtering suggestions against confirmed/dismissed overrides.
- Added backend test coverage in `backend/tests/recurring-overrides.test.ts` for CRUD upsert behavior, conflict update semantics, list responses, delete/not-found behavior, and auth guards.
- Added docs/API updates for recurring endpoints: `docs/API_RECURRING.md` (new), `docs/API_INDEX.md`, `openapi/openapi.yaml`.

---

## FIX-120d (2026-04-28): Expand recurring category lists and treat checking as liability in account trend arrows
- Updated `DashboardPageV2` recurring-payment constants to broaden category gating coverage: `EXCLUDE_CATEGORIES` now includes food/coffee/snacks, expanded shopping variants, travel/parking/taxi, entertainment/movies, gifts, and tax-related tokens; `ALLOW_CATEGORIES` now includes utility subtypes, housing/hoa, subscriptions/streaming/software, fitness, and childcare/tuition.
- Updated `LIABILITY_ACCOUNT_TYPES` in the same file to include `checking` so the By Account MoM arrow color logic treats checking accounts with the liability color policy.
- Files: `frontend/src/pages/DashboardPageV2.tsx`

---

## FIX-120c (2026-04-28): Recurring category gate now uses substring token matching
- `detectRecurring` category gate in `DashboardPageV2` previously used exact `Set.has()` checks for `EXCLUDE_CATEGORIES` / `ALLOW_CATEGORIES`, which missed common variants (for example names with suffixes/prefixes).
- Fix: switched both gates to substring token checks (`[...SET].some((token) => cat.includes(token))`) so exclusion/allow logic still uses the same token lists but matches normalized category strings more reliably.
- Files: `frontend/src/pages/DashboardPageV2.tsx`

---

## FIX-120b (2026-04-27): Net-worth sparkline never rendered — API shape mismatch
- `NetWorthHistoryPoint` type in DashboardPageV2 declared `{ date, netWorth }` but `/reports/balance-sheet/history` returns `{ asOf, totals: { netWorth } }`. The sparkline filter checked `p.date` and `p.netWorth` — both `undefined` on every point — so the gate (`points.length < 2`) always failed and the sparkline never rendered.
- Fix: corrected the `apiJson` generic to match the real response shape (`Array<{ asOf: string; totals: { netWorth: number | null } }>`), then mapped `asOf → date` and `totals.netWorth → netWorth` before setting state. Frontend display type unchanged.
- Files: `frontend/src/pages/DashboardPageV2.tsx`

## UX-120 (2026-04-27): Dashboard Mantine reference + pulse breakdown, tighter recurring, per-account module, net-worth sparkline
- DashboardPageV2 migrated entirely to Mantine 7 primitives (Paper, Stack, Group, SimpleGrid, Text, Title, Button, Progress, Badge, Anchor, Box, Skeleton). This is the project's first reference page for the Mantine pattern; all other pages remain on the existing project CSS classes (`.card`, `.muted`, `.secondary`, `.dashboard-page` in `frontend/src/index.css`). The dashboard's hard-coded greys/borders are now Mantine tokens (`c="dimmed"`, `Paper withBorder`), so the dashboard now follows the `data-mantine-color-scheme` dark/light flip that `index.css` already wires up. Recharts strokes/fills keep hex literals — Recharts does not read Mantine theme.
- Pulse hero card: added inflow/outflow breakdown line under the headline net number (green ↑ inflow, red ↓ outflow).
- `detectRecurring`: 3-layer filter — Layer 1 drops merchants whose name contains TRANSFER / E-PAYMENT / AUTOPAY / PAYDOWN / PAYMENT / DIRECT DEP / DIRECT DEPOSIT / REFUND; Layer 2 requires CV<0.25 amount stability; Layer 3 modal-category gate drops groceries/dining/restaurant/gas/fuel/shopping/entertainment buckets and relaxes the CV cap to 0.5 for utilities/subscriptions/insurance/rent/mortgage/loan. Section renamed "Monthly Commitments" → "Recurring Payments" with microcopy "Estimated from repeated charges".
- New "By Account — This Month" card in the responsive SimpleGrid (top 5 accounts by `activeMonth` outflow, MoM arrow with 5% threshold, account-type-aware color: liability accounts (`credit_card`/`loan`/`mortgage`) ↑=red ↓=green, asset accounts ↑=orange ↓=green, → for flat or insufficient prior data; arrow omitted when prior month has fewer than 3 txns; whole module hidden when `recentTxns` is null or has fewer than 5 rows).
- Net-worth card: headline 1.7rem→1.5rem, sub-lines (assets/liabilities and as-of) normalised to `size="sm"`, sparkline color now compares first vs last (green/red/gray) instead of absolute sign, height 48px (was 52), only renders with ≥2 distinct non-zero points.
- LedgerRow type widened to surface `accountId`, `institution`, `accountType`, `accountMask`, `categoryName` fields the `/transactions` API already returns — no new API calls, no backend changes.
- Follow-ups deferred (not in this PR): (a) audit of `frontend/src/pages` and `frontend/src/components` for Mantine vs `index.css` usage; (b) `docs/backlog/PRD-mantine-migration.md` describing the rollout pattern and migrate-when-touched rule; (c) cleanup of orphaned `.dashboard-page` / `.dashboard-page__hero` rules in `frontend/src/index.css` once no other file references them.
Files: frontend/src/pages/DashboardPageV2.tsx, docs/CHANGE_HISTORY.md

---

## FIX-120a (2026-04-27): Fix dashboard home-page crash loop on net worth history sort
- Fixed `DashboardPageV2` crash when a net worth history point has missing/invalid `date` by validating rows before sparkline sort (`localeCompare`) and render.
- Prevented V2 data fetch effects from running while classic view is active, avoiding background fetch churn under legacy fallback mode.
Files: frontend/src/pages/DashboardPageV2.tsx, docs/CHANGE_HISTORY.md

---

## CR-120 (2026-04-27): Home screen overhaul with legacy fallback
- Rebuilt the home screen into a new three-zone dashboard layout (Pulse, Action Items, Summary Cards, and 6-month trend) with month navigation and partial data rendering.
- Added `DashboardPageLegacy.tsx` as a preserved one-click fallback and introduced `dashboard_classic` localStorage toggle between classic and new views.
- Rewired `DashboardPage.tsx` to transparently export the new implementation (`DashboardPageV2`) without route changes.
Files: frontend/src/pages/DashboardPageLegacy.tsx, frontend/src/pages/DashboardPageV2.tsx, frontend/src/pages/DashboardPage.tsx, docs/CHANGE_HISTORY.md

---

## FIX-119 (2026-04-27): Route silent duplicate drops to Needs Review with FITID-aware messaging
- canonical-ingest.service.ts: in-session FITID dedup and in-session fingerprint dedup no longer silently drop transactions
- Both paths now call insertExactDuplicateForReview: status='duplicate' canonical row + resolution_item created, visible in Transactions -> Needs Review
- Cross-import fingerprint check now compares FITIDs: different FITID + same fingerprint shows "likely legitimate separate charge" message; same/missing FITID shows "exact duplicate"
- Root cause: CitiCard OFX file had 3 charges (ENERGY OGRE, 2024-05-29, $10) with unique FITIDs but identical fingerprints — 2 were silently lost
Files: backend/src/modules/canonical/canonical-ingest.service.ts, backend/tests/app.test.ts

---

## CR-119b (2026-04-26): Fix sticky regression and extend inline account creation
- Removed all localStorage sticky account logic from ImportWorkspacePage (dead for CSV/PDF and regression-prone for OFX shared profile key).
- Extended inline `create new account` flow to non-OFX file rows (CSV/PDF/XLSX), reusing the existing in-row OFX create-account form/state and save path.
- No backend or API changes.
Files: frontend/src/pages/ImportWorkspacePage.tsx, docs/CHANGE_HISTORY.md

---

## CR-119 (2026-04-26): Kill ImportPage, restore workspace as primary import UX
- Deleted frontend/src/pages/ImportPage.tsx
- /imports and /import routes now redirect to /imports/workspace
- Removed Finalize button and finalize flow from ImportWorkspacePage
- Undo is now available on any session regardless of status (removed status=review guard from rollback service)
- Added sticky last-used account per parser profile (localStorage) in workspace file binding
- Backend CR-118 endpoints (POST /imports/upload, GET /imports/history) retained for API use
Files: frontend/src/App.tsx, frontend/src/layout/AppTopBar.tsx, frontend/src/pages/ImportWorkspacePage.tsx, backend/src/modules/imports/import-session-rollback.service.ts, backend/src/modules/imports/imports.routes.ts, backend/tests/app.test.ts, docs/API_IMPORT_SESSIONS.md, CLAUDE.md, openapi/openapi.yaml

---

## CR-118c — Import parity upgrades on `/imports`
Date: 2026-04-26
Files: backend/src/modules/imports/import-upload.service.ts, backend/src/modules/imports/imports.routes.ts, frontend/src/pages/ImportPage.tsx, openapi/openapi.yaml, docs/CHANGE_HISTORY.md
What:
- **Backend:** Persist `import_session.stats_json` after successful canonicalize on `POST /imports/sessions/:sessionId/ofx-confirm` and `POST /imports/sessions/:sessionId/canonicalize`; add `accountType` on `GET /imports/history` bank items.
- **Frontend:** Session-based multi-file bank and payslip import on `/imports`; Add account from picker (type list aligned with Advanced Import); lazy expandable per-import details from session summary; Needs Review link for duplicate triage; payslip employer UX for 0/1/many employers.
Why: CR-118b hid outcomes and dropped multi-file and add-account parity relative to Advanced Import.

---

## CR-118b — ImportPage complete rebuild with Mantine UI + full feature parity
Date: 2026-04-26
Files: frontend/src/pages/ImportPage.tsx (complete rewrite)
What: Full Mantine UI, OFX detection using existing session API (create session + upload + ofx-suggestion + ofx-confirm), inline account creation, belongs-to assignment, client-side format inference label, import history with undo. No new backend endpoints.
Why: CR-118 initial build used plain HTML and dropped OFX detection, belongs-to, and account creation.

---

## 2026-04-26 (CR-118 import simplification — v2)

### CR-118 — One-shot import upload, unified history, and primary Import page

- **Type:** CR / feature
- **What:**
  1. Added `POST /imports/upload` to run one-shot upload flows for both bank and payslip files, reusing existing parse/canonical/payslip services and returning `{ ok, data/code, message }` service-style outcomes.
  2. Added `GET /imports/history` to merge recent bank import sessions and payslip uploads into a single latest-first feed with undo affordance metadata.
  3. Added schema migration `0023_import_session_stats.sql` to store canonicalize summary counts in `import_session.stats_json`; upload flow writes `{ addedCount, duplicateCount }`.
  4. Added new frontend primary page `ImportPage` at `/imports` with one-shot form, success/error alerts, unified history table, and undo actions; kept `/imports/workspace` and `/imports/:sessionId` for advanced/manual flow.
  5. Added backend coverage in `backend/tests/import-upload-flow.test.ts` for bank happy path, duplicate behavior, inference failure, history, and undo impact.
- **Why:** CR-118 requires collapsing import UX into a simpler primary path while preserving advanced workspace behavior and existing backend pipelines.
- **Files:** `backend/db/migrations/0023_import_session_stats.sql`, `backend/src/modules/imports/import-upload.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/tests/import-upload-flow.test.ts`, `frontend/src/pages/ImportPage.tsx`, `frontend/src/App.tsx`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`

---

## 2026-04-25 (mobile UX — v2)

### UX-R01 through UX-R06 + UX-P01/P02/P03 — Mobile responsive fixes + PWA baseline

- **Type:** UX / mobile
- **What:**
  1. **Budget page** — `ProgressView` KPI bar converted from hard-coded
     `repeat(3, 1fr)` to `.budget-kpi-grid` class with `@media (max-width: 640px)`
     single-column fallback. Both budget tables (setup/suggestion and progress)
     wrapped in `overflowX: auto` containers.
  2. **Import Workspace** — file-binding table wrapped in `overflowX: auto`.
  3. **Transaction toolbar** — `@media (max-width: 640px)` reduces padding and
     makes filter fields flex-wrap cleanly at 50% width pairs.
  4. **Payslip Detail** — pencil/edit buttons converted to `.payslip-inline-edit-btn`
     CSS class; `@media (hover: none)` rule forces full opacity on touch devices.
  5. **Settings page** — audit confirmed the only `ledger-table` instance is already
     wrapped; no change needed.
  6. **app-main padding** — reduced to `0.75rem` side padding on ≤640px viewports.
  7. **PWA manifest** — `frontend/public/manifest.json` created with `display:
     standalone`, matching app theme colors.
  8. **PWA meta tags** — `frontend/index.html` updated with manifest link,
     Apple PWA tags, and `theme-color`.
  9. **PWA icons** — `frontend/public/icons/icon-192.png` and `icon-512.png`
     created (HF initials on dark navy).
- **Why:** App is live and primary access is from phone browser. Viewport audit
  (UX-R01) found three broken pages (Budget, Import Workspace broken; Payslip
  edit controls invisible on touch). Mobile nav drawer was already implemented.
  PWA baseline enables iOS/Android "Add to Home Screen."
- **Files:** `frontend/src/pages/BudgetPage.tsx`,
  `frontend/src/pages/ImportWorkspacePage.tsx`,
  `frontend/src/pages/PayslipDetailPage.tsx`,
  `frontend/src/index.css`,
  `frontend/index.html`,
  `frontend/public/manifest.json`,
  `frontend/public/icons/icon-192.png`,
  `frontend/public/icons/icon-512.png`

---

## 2026-04-21 (docs + backlog)

### DOC-020 — OCI Always Free deployment guide + mobile UX backlog

- **Type:** DOC / backlog
- **What:**
  1. **`docs/OCI_DEPLOYMENT.md`** (new) — end-to-end deployment guide for Oracle Cloud Infrastructure Always Free Tier. Covers: VM creation (A1 Flex 4 OCPU/24 GB, Ubuntu 22.04), OCI Security List + ufw firewall config, block volume attach/mount, PostgreSQL 17 installation and performance tuning for 24 GB RAM (`shared_buffers`, `effective_cache_size`, `work_mem`, connection limits), Postgres security hardening (localhost-only, `pg_hba.conf`), Node 20 via nvm, GitHub SSH deploy key generation, `.env` setup including JWT secret generation (`openssl rand -base64 48`), `npm run build` + `db:seed` first-time bootstrap, systemd service unit, DuckDNS free subdomain, nginx reverse proxy, Let's Encrypt HTTPS via Certbot, update deploy flow, and backup cron.
  2. **`docs/MOBILE_UX_BACKLOG.md`** (new) — backlog for mobile responsive UX and PWA. Items: UX-R01 (viewport audit), UX-R02 (AppShell mobile drawer), UX-R03 (ledger table → card list), UX-R04 (Recharts ResponsiveContainer audit), UX-R05 (form Grid → Stack), UX-R06 (touch inline edit). PWA items: UX-P01 (manifest.json), UX-P02 (index.html meta tags), UX-P03 (app icons), UX-P04 (optional service worker). Status: backlogged.
  3. **`docs/HOSTING_OPTIONS_AND_HOME_LAB.md`** (updated) — OCI section expanded, marked as current recommended self-hosted path, linked to new `OCI_DEPLOYMENT.md`. Related docs table updated.
- **Why:** App is going to production on OCI Always Free Tier. Existing `PRODUCTION_SETUP.md` covers Koyeb/Docker only. A self-hosted OCI guide needed to cover VCN/firewall layering, Postgres direct install, systemd, nginx, and DuckDNS — all specific to the OCI bare-VM path. Mobile backlog added because primary access will be from phone browser.
- **No code changes.** `trust proxy` was already set in FIX-118; nginx handles SSL termination without app modifications.
- **Files:** `docs/OCI_DEPLOYMENT.md` (new), `docs/MOBILE_UX_BACKLOG.md` (new), `docs/HOSTING_OPTIONS_AND_HOME_LAB.md` (updated), `docs/CHANGE_HISTORY.md`

---

## 2026-04-19 (backlog)

### PRD-019 — Import pipeline simplification backlogged

- **Type:** PRD / backlog
- **What:** Documented a backlog item to collapse the current 6-step import flow (create session → upload → bind → parse → canonicalize → finalize) into 3 user-facing steps (upload → review → confirm). New proposed API: `POST /imports/upload`, `POST /imports/{id}/confirm`, `DELETE /imports/{id}`. Parser auto-detection, immediate preview on upload, undo from import history.
- **Why:** Current pipeline exposes internal ETL stages as user-facing actions. Not building now — too close to production release. Grooming notes and open decisions captured for future sprint.
- **Files:** `docs/IMPORT_PIPELINE_SIMPLIFICATION_BACKLOG.md` (new)

---

## 2026-04-18 (pre-production hardening sweep)

### FIX-118 — Graceful shutdown, trust proxy, request logging, change-password rate limit

- **Type:** FIX / ops hardening
- **What:**
  1. **Graceful shutdown** (`backend/src/server.ts`) — Added `SIGTERM` and `SIGINT` handlers that stop accepting new connections, drain in-flight requests, then call `closeSql()` before exiting. A 10-second forced-exit timeout ensures a hung keep-alive doesn't stall container replacement. Previously the process was killed immediately by the orchestrator.
  2. **`trust proxy` setting** (`backend/src/app.ts`) — Added `app.set('trust proxy', 1)` so that Express reads the real client IP from `X-Forwarded-For` when running behind Oracle Cloud / any load balancer. Without this, the login rate limiter sees every request coming from the proxy address, making it ineffective.
  3. **Request logging middleware** (`backend/src/app.ts`) — Added `requestLoggerMiddleware()` that logs `METHOD /path STATUS Xms` for every non-static request using the existing `log` infrastructure. No new dependency. Skips requests for static assets (JS, CSS, images) to keep logs readable.
  4. **Rate limit on `POST /auth/change-password`** (`backend/src/modules/auth/auth.routes.ts`) — Added `changePasswordRateLimit` (10 attempts per 15 minutes per IP). Same `skip: MODE === "TEST"` guard as the login limiter so tests are unaffected.
  5. **Dockerfile JWT_SECRET comment** (`Dockerfile`) — Corrected `<min 16 chars>` to `<min 32 chars>` to match the Zod enforcement in `env.ts`.
- **Why:** Pre-production sweep before Oracle Cloud free-tier deployment. All five issues were found in the sweep; none individually critical but collectively important for correct prod behavior.
- **Files:** `backend/src/server.ts`, `backend/src/app.ts`, `backend/src/modules/auth/auth.routes.ts`, `Dockerfile`, `docs/CHANGE_HISTORY.md`

---

## 2026-04-18 (payslip line item CRUD + cross-validation + manual page redesign)

### CR-117 — Payslip line item edit, delete, add + cross-validation warnings

- **Type:** CR / feature
- **What:**
  1. **Line item CRUD** — three new endpoints: `POST /payslips/:id/line-items`, `PATCH /payslips/:id/line-items/:itemId`, `DELETE /payslips/:id/line-items/:itemId`. Each mutates a single row and cascades: re-sums the affected section(s) from remaining line items and updates the matching `payslip_snapshot` summary column in the same transaction.
  2. **Cross-validation** — new `payslip-validation.ts` with `validatePayslipBalance()`. Checks section sums against summary columns (tolerance $0.01) and arithmetic invariant `gross − pre_tax − taxes − post_tax ≈ net` (tolerance $1.00). Warnings returned on `GET /payslips/:id`, `PATCH /payslips/:id`, and all line item endpoints. Non-blocking.
  3. **Summary PATCH now returns `validationWarnings`** — so the UI can immediately show whether a manual correction resolved or created a mismatch.
  4. **POST /payslips/manual now accepts `lineItems[]`** — optional array of individual rows sent at creation time. Same cascade logic as above.
  5. **IBM parser fix** — `ibm-payslip-pdf.ts` was missing `hoursOrDaysYtd`, `taxableEarningsCurrent`, `taxableEarningsYtd`, `otherInformationCurrent`, `otherInformationYtd` fields from `ParsedPayslipSummary`. Added as `null` to satisfy strict type.
- **Cascade mapping** (line items → summary columns):
  - `earnings` → `gross_pay_current / _ytd`
  - `pre_tax_deductions` → `pre_tax_deductions_current / _ytd`
  - `tax_deductions` → `employee_taxes_current / _ytd`
  - `post_tax_deductions + other_deductions` (combined) → `post_tax_deductions_current / _ytd`
  - `other_information` → `other_information_current / _ytd`
  - `taxable_earnings` → `taxable_earnings_current / _ytd`
  - `net_pay` intentionally excluded — it is the bank-deposit anchor for `matchedDeposits` and must not be auto-derived.
- **Files:** `backend/src/modules/payslip/payslip-validation.ts` (new), `payslip.service.ts`, `payslip.routes.ts`, `payslip.types.ts` (IBM fix), `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`.

### UX-030 — Payslip detail page: line item edit + delete + validation banner

- **Type:** UX
- **What:** Detail page (`PayslipDetailPage.tsx`) now supports inline edit (✏) and delete (✕) per line item row. Edit mode: name, authority, amounts, hours, rate go into inputs; Enter saves, Escape cancels. Delete mode: inline confirm row ("Delete X? [Delete] [Cancel]") — no modal. After any mutation, summary amounts in the Amounts table update automatically (cascade from backend). Validation warnings banner shows above the Amounts table when mismatches exist — color-coded amber for section sum mismatches, red for arithmetic imbalance. Also added Authority column to tax section display when any row has a non-null authority.
- **Files:** `frontend/src/pages/PayslipDetailPage.tsx`, `frontend/src/payslip/types.ts`.

### UX-031 — Manual payslip page redesign + line item entry

- **Type:** UX
- **What:** Full redesign of `PayslipManualPage.tsx` (`/payslips/new`):
  - Shorter header copy ("Enter totals from any pay stub — no PDF required." instead of paragraph).
  - Logical card grouping: Who/Employer, Pay Period, Amounts, Line Items (optional, collapsed), Salary/Rate.
  - **Reordered amounts**: Gross → Pre-tax deductions → Employee taxes → Post-tax deductions → Net pay (result last). Supplemental rows (Hours, Taxable earnings, Other information) separated by a visual divider.
  - **Live arithmetic indicator**: computes `implied net = gross − pre_tax − taxes − post_tax` as you type. Green when it matches stated net (≤$1 diff), amber for $1–$50 diff, red for >$50.
  - **Line items section**: collapsible `<details>` with a table (Section, Name, Current, YTD, ✕). "+ Add line item" button appends a blank row. Items are POSTed as `lineItems[]` with the summary fields.
  - Statement template (parser profile) now shown inline as a labelled select instead of hidden in `<details>`.
- **Files:** `frontend/src/pages/PayslipManualPage.tsx`.

## 2026-04-18 (payslip inline editing)

### UX-028 — Inline edit for payslip summary amounts

- **Type:** UX / feature
- **What:** Added inline editing to the Amounts table on the payslip detail page. Each summary row (Gross pay, Taxable earnings, Employee taxes, Pre-tax deductions, Post-tax deductions, Other information, Net pay) now has a muted ✏ pencil button. Clicking it puts that row into edit mode: Current and YTD become number inputs. Save (✓) calls `PATCH /payslips/:id` with just the two changed fields; Cancel (✗) restores the read-only view. Only one row is editable at a time. Enter saves; Escape cancels.
- **Why:** LLM extraction (especially on complex Deloitte stubs) occasionally produces wrong summary totals. Re-processing is costly; manual correction is the practical fix. Line items cannot be individually edited (no backend endpoint) — only the summary totals are patchable.
- **Design decisions:**
  - All 7 amount rows are always visible (removed conditional hiding of Taxable earnings / Other information when null). This lets users add a value even when the LLM returned null.
  - Pencil button is always rendered but at low opacity (0.45), fully opaque on hover — visible without cluttering the read-only view.
  - Blank input = `null` (clears the field). Invalid number = inline error, no save.
  - After PATCH succeeds, local state is updated preserving `lineItems` and `matchedDeposits` (those are not returned by PATCH).
  - Line items section remains read-only with no change.
- **Files changed:**
  - `frontend/src/pages/PayslipDetailPage.tsx` — `SummaryAmountRow` component, `AMOUNT_ROWS` config, `patchPayslip` / `handleSaveRow` handlers, merged edit state.
  - `frontend/src/payslip/payslipChartsModel.test.ts` — updated base fixture to include fields added in CR-072 (`hoursOrDaysYtd`, `taxableEarningsCurrent`, `taxableEarningsYtd`, `otherInformationCurrent`, `otherInformationYtd`, `employmentRate`, `employmentRateType`).
- **No backend changes.** Uses existing `PATCH /payslips/:id` endpoint.

---

## 2026-04-18 (payslip tax deduction YTD regression after model upgrade)

### FIX-116 — Employee taxes YTD wrong after gpt-4.1 upgrade (summary value beats line items)

- **Type:** FIX
- **What:** After the FIX-115 model upgrade to `gpt-4.1`, employee taxes YTD displayed incorrectly ($6409.41 instead of $6909.02). The LLM was producing a wrong `summary.tax_deductions_ytd` while extracting the three individual tax rows correctly (their YTD values sum to $6909.02).
- **Root cause:** Tax deductions used a different precedence rule than pre-tax: line item sums were only used when the summary field was `null`. Since `gpt-4.1` populated `tax_deductions_ytd` with a wrong header-read value ($6409.41), the correct line item sums were ignored.
- **Fix:** Applied the same "always prefer line item sums when line items exist" rule to tax deductions that already governs pre-tax and post-tax deductions. Summary values are now only used when the `tax_deductions` line items array is empty.
- **Files changed:**
  - `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts` — tax deductions now prefer line item sums when items exist
  - `backend/tests/payslip-canonical-map.test.ts` — new test: "prefers line item sum over summary for tax deductions when both exist"

---

## 2026-04-18 (payslip model upgrade + hours contamination guard)

### FIX-115 — Deloitte extraction failures on gpt-4.1-mini: model upgrade + defensive hours guard

- **Type:** FIX
- **What:** `gpt-4.1-mini` was producing multiple structural errors on Deloitte payslips despite detailed prompt instructions: (a) dollar amounts written into `hours_or_days` fields for deduction rows (e.g. Tax Advance `hours_or_days.ytd=152.68`), (b) row-level amount mix-up (Equalization Tax Adv receiving Recognition Award's current amount), (c) Regular Salary gaining spurious `hours_or_days.current=8`, (d) Imp Inc Core Life/LTD persisting in `line_items.earnings` despite explicit prompt exclusion.
- **Root cause:** `gpt-4.1-mini` has insufficient column-type disambiguation capability for the Deloitte two-column-group payslip layout. This is a model-quality problem, not a prompt-engineering problem — the model conflates money columns with hours columns when both appear adjacent in the deduction section.
- **Fixes:**
  1. **Model upgrade:** `OPENAI_MODEL` changed from `gpt-4.1-mini` → `gpt-4.1` in `.env`. `gpt-4.1` follows multi-step column-pairing instructions reliably; `gpt-4.1-mini` does not. `.env.example` updated to recommend `gpt-4.1` with a comment noting mini-model accuracy issues.
  2. **Defensive guard in `flattenLineItems`:** `hoursOrDaysCurrent` and `hoursOrDaysYtd` are now unconditionally set to `null` for all non-`earnings` sections before DB insert. Deduction rows (pre-tax, post-tax, tax, other_deductions, other_information, taxable_earnings) never carry meaningful hours — any value placed there by the model is an extraction error. This guard prevents contaminated values from reaching `payslip_line_item` regardless of model.
- **Files changed:**
  - `.env` — `OPENAI_MODEL=gpt-4.1`
  - `.env.example` — updated comment to recommend `gpt-4.1`
  - `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts` — defensive `isEarnings` guard in `flattenLineItems`
  - `backend/tests/payslip-canonical-map.test.ts` — new test: "flattenLineItems nulls hoursOrDaysCurrent/YTD for non-earnings sections"
- **No DB migration needed.** Guard is applied at write time; historical rows with dollar-in-hours contamination will remain until re-processed.

---

## 2026-04-18 (payslip Deloitte imputed-income dedup)

### FIX-114 — Deloitte Earnings section polluted by Imp Inc Core Life/LTD (duplicate rows)

- **Type:** FIX
- **What:** After FIX-113 merged `other_deductions` into the Post-Tax section, Deloitte imputed-income rows ("02/21 Imp Inc Core Life", "02/21 Imp Inc Core LTD") became visible in **both** the Earnings section and the Post-Tax Deductions section simultaneously. These rows appear in two places in the Deloitte PDF: the GROSS EARNINGS block (they inflate gross/taxable pay) and the OTHER DEDUCTION(S) block (they are deducted back so net pay is unaffected). The LLM was following the old prompt and placing them in both `line_items.earnings` and `line_items.other_deductions`.
- **Root cause:** The prompt instruction for Deloitte earnings explicitly told the LLM to capture Imp Inc items from the earnings section. Combined with the Other Deductions prompt that correctly places them there too, they ended up stored in both sections in the DB.
- **Fixes:**
  1. **UI dedup (handles historical data):** `PayslipDetailPage` now builds an `otherDeductionNames` set before rendering. Any earnings row whose name appears in `other_deductions` is filtered out of the Earnings display. Imp Inc items show only in Post-Tax Deductions.
  2. **Prompt fix (future re-processing):** Updated LLM instruction: Imp Inc Core Life/LTD must be placed **only** in `line_items.other_deductions` (with `hours_or_days.current` and `amount_current`); they must NOT be placed in `line_items.earnings`.
- **Expected Earnings section (Deloitte) after fix:** Regular Salary, Equalization Tax Adv, Recognition Award — 3 rows, no imputed-income entries.
- **Files changed:**
  - `frontend/src/pages/PayslipDetailPage.tsx` — dedup filter on earnings before render.
  - `backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts` — Deloitte earnings prompt updated.
- **No DB migration needed.** Historical snapshots are corrected at render time by the UI filter.

---

## 2026-04-17 (payslip canonical map + UI correctness fixes)

### FIX-113 — Deloitte pre-tax YTD wrong; post-tax missing other-deductions; IBM pay date missing

- **Type:** FIX
- **What:** Three inter-related payslip correctness bugs found against real Deloitte and IBM payslips after CR-072 shipped.
- **Root causes & fixes:**

  **1. Deloitte pre-tax YTD (e.g. $7332.50 instead of $7947.86)**
  - `mapCanonicalExtractToPersist` only fell back to line item sums when the LLM `summary.pre_tax_deductions_ytd` was null. In practice the LLM reads the PDF section header total ($7332.50, only 401k) for the summary field while correctly extracting all three rows (401k + Flex Spending Health + Flex Spending Dep Care) with their individual YTDs. The line item sum is always more accurate.
  - **Fix:** when `pre_tax_deductions` line items are present their computed sum is always preferred over the LLM summary value. The LLM summary is only used when the line items array is empty.

  **2. Deloitte post-tax total wrong (current $17.13 missing Imp Inc Core Life/LTD)**
  - `other_deductions` line items (Tax Advance, Award Received, Imp Inc Core Life, Imp Inc Core LTD) were only added to the post-tax total when `post_tax_deductions_current` was null. Since "After-Tax Ded" ($17.13) was already set, the other four rows were never included.
  - Deloitte's "OTHER DEDUCTION(S)" section is semantically post-tax, identical to "POST-TAX DEDUCTION(S)". The two sections must be combined.
  - **Fix:** `other_deductions` line items are now always combined with `post_tax_deductions` line items into a single post-tax total. Combined line item sums are preferred over the LLM summary value (same rule as pre-tax). Diagnostic flag `otherDeductionsFoldedIntoPostTax: true` added to `raw_extract_json` when folding occurs.

  **3. IBM pay date missing**
  - IBM payslips do not print a standalone pay date on the stub — it appears only in the "Payment Information" section. The LLM correctly extracts it into `payment_information[0].pay_date` but `mapCanonicalExtractToPersist` only read `pay_period.pay_date` (null for IBM).
  - **Fix:** canonical map now falls back to `payment_information[].pay_date` (first non-null entry) when `pay_period.pay_date` is null.
  - LLM prompt updated with explicit IBM instruction: "IBM: pay_period.pay_date must be populated from the pay date visible in the Payment Information section."

  **4. Hours column shown for deduction sections in UI**
  - Deloitte imputed income rows (Imp Inc Core Life, Imp Inc Core LTD) in `other_deductions` carry `hoursOrDaysCurrent` values because the PDF has an Hours column in that section. The `sectionHasHours` check was section-agnostic, causing an Hours column to appear in post-tax deduction line items.
  - No post-tax (or any deduction) row should ever display hours — hours are meaningful only in the Earnings section.
  - **Fix:** `sectionHasHours` now returns `false` for any section other than `earnings`.

  **5. "Other Deductions" and "Post-Tax Deductions" shown as separate sections in UI**
  - The line items panel listed both `post_tax_deductions` and `other_deductions` as distinct collapsible sections, which is confusing since they are the same concept for Deloitte.
  - **Fix:** UI merges `other_deductions` rows into `post_tax_deductions` at render time (applicable to both historical and new data). The `other_deductions` section no longer appears as a separate group.

- **Files changed:**
  - `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts` — rewrote pre-tax and post-tax sum logic; added IBM pay date fallback; removed `isOtherDeductionPostTaxRow` / `sumOtherDeductionsMarkedAsPostTax` helpers (superseded).
  - `backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts` — added IBM pay date prompt instruction.
  - `frontend/src/pages/PayslipDetailPage.tsx` — `sectionHasHours` gated to `earnings` only; `other_deductions` merged into `post_tax_deductions` for display.
  - `backend/tests/payslip-canonical-map.test.ts` — updated two tests (backfill and raw_section-null scenarios now use new diagnostic field names); added 7 new tests: Deloitte pre-tax line-item-over-summary preference, combined post-tax (realistic Deloitte scenario), IBM pay date fallback, pay_period.pay_date priority, null pay date, pre-tax/post-tax fallback-to-summary when no line items, `other_deductions` stored section preserved in DB.

---

## 2026-04-16 (payslip rich extraction + line item storage)

### CR-072 — Payslip rich extraction: per-row line items + 7 new snapshot columns

- **Type:** CR
- **What:** Expanded payslip data capture to store every structured field visible on IBM and Deloitte PDFs — not just summary buckets. All individual earnings, deduction, and tax rows are now queryable per payslip.
- **New migration `0022_payslip_line_items.sql`:**
  - Adds 7 columns to `payslip_snapshot`: `taxable_earnings_current`, `taxable_earnings_ytd`, `other_information_current`, `other_information_ytd`, `hours_or_days_ytd`, `employment_rate`, `employment_rate_type`.
  - Creates `payslip_line_item` table with `ON DELETE CASCADE` FK to snapshot — stores one row per earnings/deduction/tax line item, grouped by `section` enum: `earnings`, `pre_tax_deductions`, `post_tax_deductions`, `tax_deductions`, `other_deductions`, `other_information`, `taxable_earnings`.
  - Indexes: `idx_payslip_line_item_snapshot (payslip_snapshot_id, section, sort_order)`, `idx_payslip_line_item_household (household_id, section)`.
- **Backend changes:**
  - `payslip.types.ts`: new `PayslipLineItemSection`, `PayslipLineItemRow`, `PayslipLineItemsGrouped`, `LineItemForInsert` types; extended `ParsedPayslipSummary` (5 fields), `PayslipHybridColumns` (2 fields).
  - `payslip-canonical-map.ts`: added `flattenLineItems()` helper (iterates all 7 section arrays, preserves PDF sort order), new `CanonicalMapResult` return type; populates all 7 new fields from LLM extract.
  - `payslip-parse.service.ts`: `PayslipPdfParseSuccess` carries `lineItems`; passes through from canonical mapper.
  - `payslip.service.ts`: `insertPayslipSnapshot` now wraps snapshot + line item INSERTs in `qBegin` transaction (atomic). New `getPayslipLineItems(snapshotId, householdId)` query returns all 7 sections grouped. `PayslipSnapshotPatchInput` extended with 7 new optional fields.
  - `payslip.routes.ts`: upload path and reconcile path pass `parseResult.lineItems` to insert; `GET /payslips/:id` returns `lineItems` (parallel fetch with `matchedDeposits`); `POST /payslips/manual` Zod schema includes 7 new optional fields.
  - `payslip-async-import-reconcile.service.ts`, `import-parser.service.ts`: thread `lineItems` through reconcile/import paths.
  - `extract-payslip-llm.ts`: 8 new prompt lines (4 IBM-specific, 4 Deloitte-specific) clarifying: IBM OTHER INFORMATION section mapping, IBM 401k multi-row capture, IBM ESPP disambiguation (post-tax vs other_information), IBM employment_context rate/hours; Deloitte earnings row classification, Deloitte Flex Spending separate rows, Deloitte YTD-only other deductions, Deloitte biweekly rate type.
- **API changes:**
  - `GET /payslips/:id` response gains 7 new scalar fields + `lineItems: { earnings: [...], pre_tax_deductions: [...], ... }` (7 sections, each an array of `PayslipLineItemRow`).
  - `POST /payslips/manual` body accepts 7 new optional fields: `taxableEarningsCurrent`, `taxableEarningsYtd`, `otherInformationCurrent`, `otherInformationYtd`, `hoursOrDaysYtd`, `employmentRate`, `employmentRateType`.
- **Frontend changes:**
  - `frontend/src/payslip/types.ts`: added `PayslipLineItemSection`, `PayslipLineItemRow`, `PayslipLineItemsGrouped`, `SECTION_LABELS`, `SECTION_ORDER`; extended `PayslipSnapshotDetail`.
  - `PayslipDetailPage.tsx`: Period card shows Hours YTD inline + Salary/Rate row. Amounts table adds conditional Taxable Earnings and Other Information rows. New "Line Items" collapsible card below Amounts — one `<details>` accordion per non-empty section; Hours/Rate columns hidden when all rows are null.
  - `PayslipManualPage.tsx`: 8 new optional fields (taxable earnings current/YTD, other information current/YTD, hours/days YTD, salary/rate, rate type); backlog comment for full per-row line item entry UI.
- **Tests:** `payslip-canonical-map.test.ts` — 8 new cases (new field mappings + `flattenLineItems`); `payslip-upload.test.ts` — updated mock with realistic line items/rate/hours, extended GET /:id assertions, extended manual test. All 275 tests pass.
- **Files:** `backend/db/migrations/0022_payslip_line_items.sql`, `backend/src/modules/payslip/payslip.types.ts`, `payslip-canonical-map.ts`, `payslip-parse.service.ts`, `payslip.service.ts`, `payslip.routes.ts`, `payslip-async-import-reconcile.service.ts`, `import-parser.service.ts`, `extract-payslip-llm.ts`, `frontend/src/payslip/types.ts`, `PayslipDetailPage.tsx`, `PayslipManualPage.tsx`, `payslip-canonical-map.test.ts`, `payslip-upload.test.ts`

---

## 2026-04-16 (apiFetch 401 still leaking raw JSON)

### FIX-027 — `apiFetch` returning raw 401 body instead of throwing on session expiry

- **Type:** FIX
- **What:** After token expiry, some actions (file upload, delete payslip, delete category/rule, import) were showing `{"message":"Missing bearer token"}` to the user instead of the friendly "Session expired" message.
- **Root cause:** `apiJson` was correctly fixed to throw `"Session expired. Please sign in again."` on 401. `apiFetch` — used for operations that need the raw `Response` object (multipart uploads, DELETEs) — was only calling `setToken(null)` and then returning the 401 `Response`. Callers hit `if (!res.ok)` → `res.text()` → raw JSON displayed as error string.
- **Fix:** `apiFetch` now also throws `"Session expired. Please sign in again."` on 401. All callers are already inside try/catch blocks so the throw is handled correctly. `setToken(null)` still fires the listener, redirecting to login.
- **Files:** `frontend/src/api.ts`

---

## 2026-04-16 (database architecture review + index audit)

### DB-007 — Performance index audit: 9 missing indexes added (migration 0021)

- **Type:** DB
- **What:** Audited all query patterns in `backend/src/modules/` against the migration schema. Found critical index gaps:
  - `transaction_canonical` had only 2 indexes (fingerprint dedup + GIN full-text). Zero coverage for date-range queries, account-scoped queries, source_ref idempotency lookups, or transfer group joins.
  - `resolution_item` had **zero indexes** despite being queried on every Needs Review load and dashboard summary.
  - `transaction_raw`, `import_session`, `account_balance_snapshot`, `financial_account` had no query-supporting indexes.
- **Added in `0021_performance_indexes.sql`:**
  1. `idx_tc_household_date_status` on `transaction_canonical (household_id, txn_date DESC, status)` — covers all ledger list, cash summary, budget actuals, transfer detection date-window queries
  2. `idx_tc_household_account_date` on `transaction_canonical (household_id, account_id, txn_date DESC)` — near-duplicate detection, per-account queries, payslip deposit match
  3. `idx_tc_household_source_ref` partial on `transaction_canonical (household_id, source_ref) WHERE source_ref IS NOT NULL` — canonical ingest idempotency guard
  4. `idx_tc_transfer_group` partial on `transaction_canonical (household_id, transfer_group_id) WHERE transfer_group_id IS NOT NULL` — transfer group lookups
  5. `idx_ri_household_status_type` on `resolution_item (household_id, status, type)` — dashboard count, list by status/type
  6. `idx_ri_household_target` on `resolution_item (household_id, target_id)` — per-transaction resolution lookup and close
  7. `idx_transaction_raw_file_id` on `transaction_raw (file_id)` — canonical ingest join
  8. `idx_import_session_household_started` on `import_session (household_id, started_at DESC)` — session listing
  9. `idx_abs_household_account_date` on `account_balance_snapshot (household_id, financial_account_id, as_of_date DESC)` — balance sheet history
  10. `idx_financial_account_household` on `financial_account (household_id)` — account listing
- **New doc:** `docs/DATABASE_ARCHITECTURE.md` — records Postgres vs NoSQL rationale, full index inventory, and upgrade ladder (pg_trgm → materialized views → partitioning → TimescaleDB)
- **Files:** `backend/db/migrations/0021_performance_indexes.sql`, `docs/DATABASE_ARCHITECTURE.md`

---

## 2026-04-16 (bulk resolve by merchant — root cause fix)

### FIX-026 — "Resolve all by merchant name" always returned zero matches

- **Type:** FIX
- **What:** The pattern preview (`POST /resolution/pattern-preview`) and bulk apply (`POST /resolution/bulk-apply-by-pattern`) always returned 0 matches, even when uncategorized transactions with matching descriptions were visible in Needs Review.
- **Root cause:** `findUnknownCategoryItemsByDescriptionPattern` queried through `resolution_item` requiring `type = 'unknown_category'` AND `status = 'open'`. But canonical ingest has a comment at line 450 of `canonical-ingest.service.ts` explicitly stating: *"Uncategorized rows appear in Needs Review via `category_id IS NULL` — no `resolution_item` needed."* No `unknown_category` resolution items are ever created, so the join always returned empty.
- **Fix:** Rewrote both functions to query `transaction_canonical` directly for `category_id IS NULL, status = 'posted'` rows matching the pattern. The bulk apply continues to close any incidentally-existing resolution items as a best-effort cleanup.
- **Files:** `backend/src/modules/resolution/resolution.service.ts`

---

## 2026-04-16 (PRD expansion: AI health, cloud backup, staff timesheet)

### PRD-003 — Three new feature requirements added to PRD (§18, §19, §20)
- **Type:** PRD
- **What:** Added three fully specified requirements sections to `docs/archive/FINANCE_APP_PRD.md`:
  - **§18 / FR-13 — AI Financial Health Dashboard:** On-demand AI analysis on the Home page. User configures AI provider (OpenAI or Anthropic) + API key + personal profile (age, salary, goals, risk tolerance) in a new "Financial Insights" Settings sub-tab. Analysis is generated server-side and cached. Output: health rating, what's good/bad/ugly, expense reduction tips, investment gaps, demographic benchmarks, actionable next steps.
  - **§19 / FR-14 — Automated Cloud Backup & Restore:** New "Backup & Restore" Settings tab consolidating manual export/restore (moved) and Google Drive scheduled backup. Google OAuth `drive.file` scope. Configurable folder, frequency (daily/weekly/monthly), and retention. Phase 2: OneDrive.
  - **§20 / FR-15 — Household Staff Timesheet & Expenses:** New `staff` RBAC role. Staff see only "My Timesheet" and "My Expenses" tabs. Admins manage staff profiles, review/approve timesheets and expenses, record payments, and optionally post wages/expenses to the household ledger as categorized transactions. Clock-in/out, manual time entry, OT calculation, mileage reimbursement.
- **Also updated:** §4 RBAC (added staff role), §13 Phase D Settings (added new sub-tabs), §17 Future Phases (added OneDrive Phase 2 and staff Phase 2 items).
- **Why:** Requirements gathering session with product owner to shape next phase of development.
- **Files:** `docs/archive/FINANCE_APP_PRD.md`, `docs/CHANGE_HISTORY.md`

---

## 2026-04-16 (bulk recategorize All tab, bank category hint, backlog)

### CR-113 — Bulk recategorize on the All (Ledger) tab
- **Type:** CR
- **What:** Users can now select posted transactions on the main "All" tab and bulk-reassign their category — not just on the Needs Review tab. A checkbox column is now visible on all three tabs. Selecting one or more rows on the All tab reveals a bulk action bar with a category picker, "Apply category" button, and "Clear selection" button. The existing `POST /transactions/bulk-category` backend endpoint is reused (it was already accessible but had no All-tab UI). Per-page select-all checkbox works the same as on Needs Review. Selection is cleared automatically on tab switch, page navigation, and filter change.
- **Why:** Power users re-importing after rule changes, or correcting a batch of miscategorised transactions, had no way to bulk-update from the main ledger view. They had to go through Needs Review which only surfaces unknown-category items.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

### UX-030 — Bank-supplied category hint in Needs Review expand panel
- **Type:** UX / CR
- **What:** For banks that include a category column in their export (currently Discover: "Supermarkets", "Restaurants", "Gas Stations", etc.), the bank-assigned category is now surfaced in the classification hint shown in the Needs Review expand panel when the app could not classify the transaction. Appears as **"Bank suggested: Restaurants"** below the "no rule matched" reason. Only shown when the app's classifier returned `source: "none"` (i.e. no household or builtin rule fired) — avoids showing it when a rule already matched correctly.
- **Backend:** During canonical ingest (`canonical-ingest.service.ts`), both `insertCanonicalRow` and `insertExactDuplicateForReview` now check `parsed.source_row["Category"]` (non-empty, trimmed). If present, it is stored as `bankCategory` in the `classification_meta` JSON alongside the existing `source/ruleId/confidence/reason` fields. No schema migration needed — `classification_meta` is a free-form JSON column.
- **Frontend/service:** `ClassificationExplainMeta` in `ledger.service.ts` gains optional `bankCategory?: string | null`. `parseClassificationMetaJson` extracts it. `TxClassificationMeta` in `TransactionsPage.tsx` gains the same field. `CategoryClassificationHint` renders "Bank suggested: X" when `bankCategory` is present.
- **Why not a mapping:** A direct Discover→app category mapping (e.g. "Supermarkets" → Groceries) is too fragile — the boundary between "Supermarkets" and "General Merchandise" is institution-specific and doesn't generalise. Showing the bank label as informational context lets the user decide without the app making a wrong assumption.
- **Generality:** The `source_row["Category"]` key is Discover-specific today. Any future bank parser that stores a category hint under the same key will automatically surface it. Other banks that do not provide a category column produce an empty string → stored as null → nothing shown.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/src/modules/ledger/ledger.service.ts`, `frontend/src/pages/TransactionsPage.tsx`

### BACKLOG-003 — Notifications system (roadmap)
- **Type:** PRD / backlog
- **What:** The Notifications tab in Settings (`SettingsPage.tsx`) is intentionally kept as a placeholder. Planned use cases:
  1. **Export ready** — async export ZIP generation can take time on large households; notify the user in-app when the download is ready instead of requiring them to poll the Settings export section.
  2. **Password change confirmation** — in-app confirmation after a successful password change.
  3. **Unresolved items alert** — periodic reminder when the resolution queue grows (e.g. "You have 42 uncategorised transactions").
  4. Additional hooks TBD as the app grows.
- **Why not yet:** No notification delivery mechanism exists (no email, no WebSocket push). Implementation requires either a polling endpoint or a real-time channel. Scope is medium-to-large; not blocking first release.
- **Status:** Tab shows "No notification service is configured for the local MVP. This tab is reserved." — intentionally visible so the feature is discoverable.

### BACKLOG-004 — Recurring transaction detection / subscription tracker (roadmap)
- **Type:** PRD / backlog
- **What:** Automatically identify transactions that recur at a predictable cadence (monthly, weekly, annual) and surface them as a "Subscriptions" or "Recurring charges" list. Use cases:
  1. Show all subscriptions in one place — Netflix, Spotify, gym memberships, insurance premiums, auto-loan payments, etc.
  2. Flag missed auto-pays (expected charge didn't appear this month).
  3. Highlight subscriptions the user may have forgotten (e.g. a $14.99/mo charge for a service they stopped using).
- **Detection heuristic ideas:** Group by normalised merchant name; transactions with consistent amount ± 5% on consistent day-of-month ± 5 days over 3+ occurrences = candidate recurring. Flag as recurring in the ledger row (new `is_recurring` column on `transaction_canonical`, or a computed label from a `recurring_pattern` table).
- **Why not yet:** Requires a batch analysis job (or on-demand scan) across the household's full ledger history. Output is a new UI surface (dedicated page or dashboard widget). Medium-to-large scope; non-blocking for first release.

---

## 2026-04-16 (RBAC, login UX, dashboard budget widget)

### FIX-036 — Wrong-password shows "Session expired"
- **Type:** FIX
- **What:** The login form called `apiJson()` which intercepts every 401 and throws "Session expired. Please sign in again." — including 401 from wrong credentials. Changed `HomePage.tsx` login submit to use raw `fetch` so the 401 from `/auth/login` returns the server's actual "Invalid credentials" message instead.
- **Files:** `frontend/src/pages/HomePage.tsx`

### FIX-037 — Member can delete other members' payslips
- **Type:** FIX
- **What:** `DELETE /payslips/:id` only checked household ownership, not per-person ownership. A member user could delete any payslip in the household. Added `restrictToOwnerPersonProfileId` guard in `deletePayslipSnapshotForHousehold()`: when the caller is a `member`, the payslip's `owner_person_profile_id` must match their own `personProfileId`. Service now returns `"deleted" | "not_found" | "forbidden"`. Route returns 403 for ownership violation, 404 for genuinely missing payslip.
- **Files:** `backend/src/modules/payslip/payslip.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`

### FIX-038 — Members see edit/delete icons on Categories page
- **Type:** FIX
- **What:** `showEditForRow()` returned `true` for any `householdScoped` category regardless of role — so members saw the pencil icon and got "Not allowed to delete this category" errors when they clicked trash. Added `canManageCategories` check (`owner` or `admin` only). Both the edit and delete buttons now require `canManageCategories`.
- **Files:** `frontend/src/pages/CategoriesPage.tsx`

### UX-029 — Dashboard: richer budget widget with per-category breakdown
- **Type:** UX
- **What:** Budget widget was a single total progress bar always locked to the current calendar month. Three improvements: (1) When the period filter is set to "Calendar month", the budget widget now shows that month's budget instead of always today's month. (2) Full per-category breakdown: top 6 categories sorted by % used, each with an individual progress bar, colour-coded green/amber/red. Over-budget categories shown in red. (3) When no budget exists for the month, shows a "Set up budget →" CTA instead of nothing.
- **Files:** `frontend/src/pages/DashboardPage.tsx`

### FIX-039 — Pre-existing unused-var build error in TransactionsPage
- **Type:** FIX
- **What:** `const r = await apiJson<...>` at line 835 was declared but never used — TypeScript strict mode rejected the build. Removed the unused binding (`await` directly).
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

---

## 2026-04-15 (transfer filter, build fix, backlog)

### FIX-035 — Build error: Unicode escape in string literal
- **Type:** FIX
- **What:** `ImportWorkspacePage.tsx` contained `\u201c` / `\u201d` (curly-quote Unicode escapes) inside a string literal. Babel rejected the file at parse time, breaking the Vite dev server and the login page. Changed to a single-quoted string with straight double quotes.
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`

### UX-028 — Add "Transfer" to Needs Review type filter dropdown
- **Type:** UX
- **What:** `transfer_ambiguity` was missing from `LEDGER_RESOLUTION_TYPES` in `TransactionsPage.tsx`, so it never appeared as a filter option in the "Review type" dropdown on the Needs Review tab. Users could not filter the list to show only transfer items, making it impossible to select-all and bulk resolve. Added `transfer_ambiguity → "Transfer"` to the constant and label map. Updated the "Resolve flags" button tooltip to mention transfers. Bulk resolve already worked mechanically (the backend includes transfer_ambiguity items in `openReviewItems` and `POST /resolution/bulk` handles them) — the filter was the only missing piece for efficient triage.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

### CR-112 — Transfer confirmation: "Confirm as transfer" pairs both legs and clears cash flow distortion
- **Type:** CR / FIX
- **What:** `transfer_ambiguity` review items were previously inert — resolving them cleared the review queue but did nothing to the transactions. Both legs (outflow from one account, inflow to another) continued to appear as individual posted rows, double-counting in cash flow KPIs. Now:
  - **Per-row:** Expand panel for `transfer_ambiguity` items shows **"Confirm as transfer"** + **"Not a transfer"**. "Confirm as transfer" calls `POST /resolution/:id/confirm-transfer` — sets a shared `transfer_group_id` on both canonical rows and resolves all open transfer_ambiguity items for both legs in one request. "Not a transfer" is the old PATCH resolve (dismiss without pairing) — kept for coincidental amount matches that are not real transfers.
  - **Bulk:** When Transfer-filtered rows are selected, the bulk bar shows **"Confirm transfers (N)"** (calls `POST /resolution/bulk-confirm-transfers`) alongside **"Not a transfer / dismiss (N)"** for the simple-resolve path.
  - **Filter:** "Transfer" added to the Review type filter dropdown so users can filter to only transfer items, select-all, and confirm in 4 clicks.
- **Backend:** `confirmTransferPairForHousehold` + `bulkConfirmTransferPairsForHousehold` in `resolution.service.ts`. Two new routes in `resolution.routes.ts`. Reads `debitId`/`creditId` from the `low_pair_score` reason JSON — multi-candidate ambiguity items (no unambiguous pair IDs) return `MISSING_PAIR_IDS`.
- **Docs:** `API_RESOLUTION.md` updated with both new endpoints.
- **Files:** `backend/src/modules/resolution/resolution.service.ts`, `backend/src/modules/resolution/resolution.routes.ts`, `frontend/src/pages/TransactionsPage.tsx`, `docs/API_RESOLUTION.md`

### BACKLOG-002 — Manual transfer pairing (roadmap)
- **Type:** PRD / backlog
- **What:** When the transfer auto-matcher scores below the threshold (score 0, threshold 45), it creates a `transfer_ambiguity` review item instead of setting `transfer_group_id` on both sides. Resolving that item clears the review queue but does NOT pair the transactions — they remain as individual posted rows. Money moving between the user's own accounts (e.g. salary checking → high-yield savings via ACH) counts as an outflow on one side and an inflow on the other, distorting cash flow KPIs (inflow total, outflow total, savings rate, safe-to-spend). The correct fix is a "Mark as transfer pair" action in the Needs Review expand panel that accepts a debit ID and credit ID, sets a shared `transfer_group_id` on both `transaction_canonical` rows, and marks both resolution items resolved. The backend pair-score logic should also be extended with the household's actual bank description patterns once known. Until then, users can resolve the review items (clears noise) and optionally lower `TRANSFER_MIN_AUTO_PAIR_SCORE` in `.env` (risky without domain-specific patterns).
- **Why not yet:** Requires a UI for selecting the two legs of a transfer (debit from one account, credit from another) and a new backend endpoint. Scope is medium — not blocking first release since cash flow is usable with the distortion noted.

---

## 2026-04-15 (bug fixes: pattern-preview crash, auth, OFX, UX polish)

### FIX-030 — Pattern-preview backend crash: `tc.description` column does not exist
- **Type:** FIX (critical — backend crash)
- **What:** `findUnknownCategoryItemsByDescriptionPattern` in `resolution.service.ts` referenced `tc.description` which is not a column on `transaction_canonical` (table has `merchant` and `memo`). Every call to `POST /resolution/pattern-preview` or `POST /resolution/bulk-apply-by-pattern` raised PostgresError code 42703, crashing the backend and causing all subsequent requests to return 500 until restart. Fixed query to `COALESCE(tc.merchant, '') || ' ' || COALESCE(tc.memo, '')` with TRIM for display.
- **Files:** `backend/src/modules/resolution/resolution.service.ts`, `backend/tests/app.test.ts`

### FIX-031 — Wrong current password returned 401, treated as "Session expired" by frontend
- **Type:** FIX
- **What:** `POST /auth/change-password` returned HTTP 401 for `INVALID_CURRENT_PASSWORD`. `apiJson()` in `frontend/src/api.ts` treats all 401 responses as "Session expired" — it clears the token and throws, logging the user out instead of showing the actual error. Fixed: backend now returns 400 for wrong current password. Also improved `apiJson` error handling to extract the `message` field from JSON error bodies so the UI shows "Current password is incorrect" instead of "400 Bad Request: {raw json}".
- **Files:** `backend/src/modules/auth/auth.routes.ts`, `frontend/src/api.ts`, `backend/tests/app.test.ts`

### FIX-032 — Post-password-change: "Session expired" instead of clean sign-out
- **Type:** FIX
- **What:** After a forced first-login password change (or any self-service change), the server increments `token_version`, invalidating the old JWT immediately. The frontend dispatched `app:password-changed` to clear the `forcePasswordChange` banner, but left the old (now invalid) token in localStorage. The next API call (e.g. navigating away) got a 401, which `apiJson` converted to "Session expired". Fixed: `ShellLayout.tsx` handler for `app:password-changed` now calls `setToken(null)` — clears the token immediately, React re-renders, `RequireAuth` redirects to home/login page. Clean sign-out, no "Session expired" flash.
- **Files:** `frontend/src/layout/ShellLayout.tsx`

### FIX-033 — OFX new-account creation leaves Run Import disabled
- **Type:** FIX
- **What:** After creating a new account from the OFX prompt and clicking "Create account", `onAccountChange(fileId, result.id)` was called to auto-bind the file. But `onAccountChange` is a `useCallback` that captures the `accounts` array in its closure — that array was still the pre-creation list (React state update is async). `accountById(accounts, result.id)` returned undefined → `inferParserProfile` returned null → error "We couldn't match this file…" → binding not saved → Run Import stayed disabled. Fixed: after refreshing the accounts list, the creation handler now uses the fresh array directly to infer the profile and calls `persistBinding` without going through the stale closure.
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`

### FIX-034 — Remove dead "Check now (Deloitte payslip)" button
- **Type:** FIX / UX
- **What:** The "Check now (Deloitte payslip)" button in the "Separate steps" details section called `runReconcilePayslipAsync(true)`, which polls the backend for completed Deloitte payslip extraction. This button was dead in practice — the auto-poll useEffect already runs every 2 minutes automatically and on a 2.5s delay after upload. Removed the button. Updated three message strings that referenced "use Check now" to say "automatic check every 2 minutes" instead. The `runReconcilePayslipAsync` function is kept (still used by the auto-poll effect).
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`

### UX-025 — Classification matcher preview: collapse toggle
- **Type:** UX
- **What:** The "Load classification preview" button opened the table with no way to dismiss it other than leaving the page. Button label now toggles: shows "Hide preview" when rows are visible, "Load classification preview" when empty. Clicking when rows are visible clears them; clicking when empty loads them. Same button serves both purposes.
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`

### UX-026 — Rule learning dialog: per-merchant dedup in Needs Review
- **Type:** UX / CR
- **What:** After CR-110, the "Create classification rule?" dialog fired on every categorization in the Needs Review expand panel — resolving 30 WHOLEFDS items meant 30 consecutive modal interrupts. The dialog is now deduplicated per merchant key within the triage session. First time a given merchant (e.g. "WHOLEFDS") is categorized → dialog offered, key added to a session-scoped Set. Subsequent items with the same merchant → dialog silently skipped. Each unique merchant still gets one offer. A session with 30 WHOLEFDS + 5 AMAZON + 3 NETFLIX items produces 3 dialogs, not 38.
- **Why:** The dialog itself is useful — it's the right moment to create a rule. The problem was repetition for the same merchant, not the concept.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

### UX-027 — Needs Review toolbar: sticky on scroll
- **Type:** UX
- **What:** When the Needs Review table has many rows, the bulk action bar (category picker, Apply, Resolve flags, Move to trash) and the "Resolve all by merchant name" form scrolled off the top of the viewport. Both controls are now wrapped in a `position: sticky; top: 0` container so they remain visible while scrolling the transaction list.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

---

## 2026-04-15 (dashboard audit + pre-release polish)

### UX-DASH-001 — Dashboard audit: net worth widget, budget progress, inflows table, resolution alert, chart labels
- **Type:** UX
- **What:**
  - **Net worth widget** — Added a compact banner above the KPI grid that pulls from `GET /reports/balance-sheet` and shows assets, liabilities, and net worth with an "as of" date and a link to the full Net Worth page. Only renders when balance data is available.
  - **Budget progress bar** — Added a color-coded progress bar for the current calendar month's budget (green → amber at 85% → red over budget) with spent/budgeted totals and a "Manage budget →" link. Only renders when a budget exists for the month. Links budget feature to the dashboard for discoverability.
  - **Inflows by category: pie → table** — The inflows donut pie was replaced with a ranked table. Most households have 1–3 inflow categories (salary, interest); a donut with 2 slices is not useful. The table is sortable by amount and links to the ledger drill-down.
  - **Resolution alert: all types** — The uncategorized alert previously only fired for `unknown_category`. It now surfaces all open resolution types: uncategorized, transfers needing pairing, and possible duplicates — each with its own "Review" link.
  - **Chart labels: fixed 6-month scope** — Monthly trend charts (stacked outflows, monthly net) always show the trailing 6 months regardless of the period preset. Labels updated to say "trailing 6 months" and "Always shows the last 6 calendar months regardless of the period filter above" so users aren't confused when KPIs say "Last 7 days" but charts show 6 months.
- **Files:** `frontend/src/pages/DashboardPage.tsx`

### UX-IMPORT-001 — Disable unsupported parser profiles in file-binding UI
- **Type:** UX
- **What:** Parser profiles that are registered in the backend but not yet implemented (`capital_one_card_csv`, `adp_payslip_pdf`) were selectable in the file-binding dropdown, causing a server error on parse. Now they appear greyed out with "(not supported)" and a title tooltip explaining why. If a file is already bound to an unsupported profile, the format column shows a red warning instead of "Ready". `formatProfileLabel()` now delegates to `friendlyParserLabel()` so the dropdown shows human-readable labels.
- **Why:** Prevents a jarring server error. Users should not be able to walk into a wall.
- **Files:** `frontend/src/import/profileLabels.ts` (added `DISABLED_PROFILES` export), `frontend/src/pages/ImportWorkspacePage.tsx`

### CR-110 — Rule learning wired to category edit in transaction list
- **Type:** CR
- **What:** When a user changes a transaction's category in the main ledger (non-review path), a "Create classification rule?" dialog now appears after the save completes (owner/admin only). Accepting calls `POST /categories/rules/from-ledger` with a contains match on the normalized description. Previously this dialog only appeared in the resolution-review expand panel (`unknown_category` flow); the main list picker never triggered it. `closeOnClickOutside` set to `true` so a quick "Not now" is low-friction.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

### CR-111 (BACKLOG-001) — Bulk resolve unknown-category items by description pattern
- **Type:** CR
- **What:**
  - **Backend service:** `findUnknownCategoryItemsByDescriptionPattern` and `bulkApplyCategoryByDescriptionPattern` in `resolution.service.ts` — find all open `unknown_category` resolution items whose linked transaction description contains a pattern (case-insensitive LIKE), apply category, mark resolved.
  - **Backend routes:** `POST /resolution/pattern-preview` (returns matched count + up to 5 example descriptions) and `POST /resolution/bulk-apply-by-pattern` (applies the category).
  - **Frontend:** In the "Needs review" tab of TransactionsPage, a "Resolve all by merchant name…" button expands an inline form: pattern input with live preview count and examples, category picker, Apply button. Replaces 40 one-by-one resolves with 1 action.
- **Why:** First import with multiple months of statements produces many repetitive `unknown_category` items for the same merchant. One-by-one resolution is unusable at scale.
- **Files:** `backend/src/modules/resolution/resolution.service.ts`, `backend/src/modules/resolution/resolution.routes.ts`, `frontend/src/pages/TransactionsPage.tsx`; docs: `openapi/openapi.yaml`

## 2026-04-15 (continued)

### UX-SEC-005 — Login page "Forgot password?" wired to real reset flow
- **Type:** UX
- **What:** "Forgot password?" on the login page was a dead `mailto:admin@household.local` stub. Replaced with a toggle button that shows an inline tip: "Ask your household admin to reset your password from Settings → Members → Reset password." Works in conjunction with SEC-005 (reset-password endpoint). `USER_GUIDE.md` updated to document login account management (create/reset password from Settings) and remove stale "operator must manage at DB level" note.
- **Files:** `HomePage.tsx`, `USER_GUIDE.md`

### SEC-005 — Self-service password reset (owner/admin resets member password)
- **Type:** CR (security / UX)
- **What:**
  - **`household.service.ts`:** `resetMemberPassword(householdId, memberId)` — generates a random 12-char temporary password (3×4 alphanum groups joined by `-`, guaranteed upper+lower+digit+special), hashes it at rounds 12, sets `force_password_change = true`, bumps `token_version` (invalidates existing JWTs). Returns `{ tempPassword }` to the caller.
  - **`household.routes.ts`:** `POST /household/members/:memberId/reset-password` (owner/admin only). 404 if member not found; 409 if member has no login account.
  - **`SettingsPage.tsx`:** "Reset password" button next to "✓ Has login account" for each member. Clicking opens a `ConfirmDialog` warning. On confirm, calls the API and shows a modal with the temporary password (monospace, `user-select: all` for easy copy). Member's session is invalidated immediately; they must change the password on next login.
- **Why:** Operators previously had to use the database directly to reset a forgotten password. This closes the last operator-managed account flow.
- **Files:** `household.service.ts`, `household.routes.ts`, `SettingsPage.tsx`; docs: `CHANGE_HISTORY.md`, `docs/API_HOUSEHOLD.md`, `openapi/openapi.yaml`

## 2026-04-15 (security hardening continued)

### CR-109 (slice 5) — RBAC redesign: member-scoped export + frontend Belongs-To pre-fill
- **Type:** CR (security/RBAC + UX)
- **What:**
  - **Migration `0020`:** Adds `person_profile_id TEXT REFERENCES person_profile(id)` to `export_job`. NULL = household-wide; non-NULL = member-scoped.
  - **`export-household-bundle.service.ts`:** `queryAllExportTables` accepts optional `personProfileId`. When set, filters transactions/accounts/payslips/balance_snapshots to that profile; includes only the member's `person_profile` row; omits users (security) and household/membership rows.
  - **`export-job.service.ts`:** `ExportJobRow` gains `personProfileId`; `queueHouseholdExport` accepts optional `personProfileId`; `runExportJob` reads `person_profile_id` from DB and threads it to `queryAllExportTables`. Manifest includes `scope:"member"` and `personProfileId` for member exports.
  - **`exports.routes.ts`:** `POST /exports/household` now open to members with a linked profile (403 if no profile). Members receive a personal-data ZIP (their transactions/accounts/payslips/balance snapshots + shared reference data). `GET /:jobId` response includes `scope` field. Restore (`POST /household/import`) remains owner-only.
  - **`UserContext.tsx`:** New React context exposing `{ role, personProfileId }` for child pages. `ShellLayout.tsx` provides it from the existing `/auth/me` state.
  - **`ImportWorkspacePage.tsx`:** Uses `useCurrentUser()`; file-binding drafts and OFX auto-bind default `ownerScope/ownerPersonProfileId` to the member's profile for unbound files. New-account creation form also defaults to member's profile via `useEffect`.
  - **`TransactionsPage.tsx`:** Uses `useCurrentUser()`; transaction list URL filter auto-defaults to `ownerPersonProfileId=<personProfileId>` for members on mount (if no filter already set); manual-entry `addBelongsTo` defaults to member's profile.
- **Files:** `backend/db/migrations/0020_export_job_person_scope.sql`, `backend/src/modules/export/export-household-bundle.service.ts`, `backend/src/modules/export/export-job.service.ts`, `backend/src/modules/export/exports.routes.ts`, `frontend/src/UserContext.tsx`, `frontend/src/layout/ShellLayout.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/TransactionsPage.tsx`

### CR-109 (slice 4) — RBAC redesign: member-scoped ledger writes
- **Type:** CR (security/RBAC)
- **What:** Members can only write/modify transactions they own (`owner_person_profile_id = personProfileId`). All checks are in-route (no service changes).
  - **`PATCH /transactions/:id`:** Pre-checks transaction ownership for members (404 if not found, 403 if not theirs). Also strips `ownerScope`/`ownerPersonProfileId` from member PATCH requests — members cannot reassign ownership.
  - **`DELETE /transactions/:id`:** Same ownership pre-check.
  - **`POST /transactions`** (manual entry): Members may only create transactions on accounts they own (`owner_person_profile_id = personProfileId`).
  - **`POST /transactions/bulk-category`, `bulk-trash`, `bulk-restore`, `bulk-delete`:** For members, IDs are filtered to owned-only using a single `= ANY($n)` query. Response includes `skippedNotOwned: number` for members when any were filtered out.
  - **`POST /transactions/bulk-reassign-owner`:** Locked to `requireRole(["owner","admin"])` — household-level admin operation.
  - Helper `filterOwnedTransactionIds(householdId, ids, personProfileId)` added inline in `ledger.routes.ts`.
- **Tests:** All 265 passing.
- **Files:** `backend/src/modules/ledger/ledger.routes.ts`

### CR-109 (slice 3) — RBAC redesign: member-scoped import sessions
- **Type:** CR (security/RBAC)
- **What:** Members can now create and manage their own import sessions end-to-end. All `requireRole(["owner","admin"])` gates removed from import session routes; ownership enforced in-handler instead.
  - **Migration `0019`:** Adds `created_by_user_id TEXT REFERENCES app_user(id)` to `import_session`.
  - **`createImportSession`:** Accepts `createdByUserId`; stored in DB.
  - **`listImportSessionsForHousehold`:** Accepts optional `creatorUserId` filter; members see only their own sessions, owners/admins see all. Result includes `createdByUserId`.
  - **`ImportSessionRow`:** Now includes `created_by_user_id`.
  - **`POST /imports/sessions`:** Open to members. Members without a linked person profile receive 403.
  - **`GET /imports/sessions`:** Members receive only their own sessions.
  - **`GET /imports/sessions/:id`, `GET /imports/sessions/:id/summary`:** Members scoped to their own sessions (404 if not theirs).
  - **`POST /imports/sessions/:id/files`:** Members must own the session.
  - **`PATCH /imports/sessions/:id/status`:** Members must own the session.
  - **`PATCH /imports/sessions/:id/files/:fileId`:** Members must own the session AND must bind to a financial account scoped to their person profile (`owner_person_profile_id = personProfileId`).
  - **`DELETE /imports/sessions/:id/files/:fileId`:** Members must own the session.
  - **`POST /imports/sessions/:id/parse`, `canonicalize`, `undo-import`, `reconcile-payslip-async`:** Members must own the session.
  - **`POST /imports/sessions/:id/ofx-confirm`:** Members must own the session and bind to their own account.
- **Tests:** Updated RBAC baseline comment — 403 on member session create now comes from the profile check (no linked profile) rather than a role gate.
- **Files:** `backend/db/migrations/0019_import_session_creator.sql`, `backend/src/modules/imports/import-session.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/tests/app.test.ts`
- **Next:** Slice 4 — member-scoped ledger writes.

### CR-109 (slice 2) — RBAC redesign: member-scoped category, account, and institution writes
- **Type:** CR (security/RBAC)
- **What:** Members can now create/edit/delete their own categories, accounts, and custom institutions. Owner/admin access unchanged.
  - **Categories:** `createHouseholdCategory` stores `created_by_user_id`. `updateHouseholdCategory` and `deleteHouseholdCategory` accept a `caller` argument and return `FORBIDDEN` when a member attempts to edit/delete a category they did not create. `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` are now open to all authenticated users (no more `requireRole` gate); the service enforces ownership for members.
  - **Accounts:** `POST /imports/accounts` open to members — scope is forced to `ownerScope=person` / `ownerPersonProfileId=<member's profile>`. Members without a linked profile receive 403. `PATCH /imports/accounts/:id` checks `owner_user_id = userId` for members.
  - **Custom institutions:** `createHouseholdCustomInstitution` stores `created_by_user_id`. New `deleteHouseholdCustomInstitution` enforces ownership for members. `POST /imports/institutions/custom` open to all authenticated. New `DELETE /imports/institutions/custom/:id` route added (open to all; members can only delete their own).
- **Tests:** Updated RBAC baseline — asserts 201 on member category create; asserts 403 on member account create (no linked profile); imports/export/restore blocks unchanged.
- **Files:** `backend/src/modules/category/categories.service.ts`, `backend/src/modules/category/categories.routes.ts`, `backend/src/modules/imports/household-institutions.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/tests/app.test.ts`
- **Next:** Slice 3 — member-scoped import sessions.

### CR-109 (slice 1) — RBAC redesign: foundation — member identity, creator columns, no-profile guard
- **Type:** CR (security/RBAC)
- **What:** Foundational layer for member-scoped RBAC redesign. Establishes the mechanism by which services know *who* a member is and *what they own*:
  - **Migration `0018`:** Adds `created_by_user_id TEXT REFERENCES app_user(id)` to `category` and `household_custom_institution`. Existing rows are NULL; new rows created by members will carry this. (`financial_account` already has `owner_user_id` for the same purpose.)
  - **`auth.service.ts`:** `verifyToken` and `findUserByEmail` now JOIN `person_profile` to resolve `personProfileId` (the caller's `person_profile.id`). Returned as `null` if no linked profile exists. Resolved fresh on every request — not stored in JWT.
  - **`types.ts`:** `AuthUser` gains `personProfileId: string | null`.
  - **`ShellLayout.tsx`:** Members with `personProfileId === null` (login exists but not linked to any household profile) see a locked screen: "Not part of a household — contact your household admin."
- **Files:** `backend/db/migrations/0018_rbac_creator_columns.sql`, `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/types.ts`, `frontend/src/layout/ShellLayout.tsx`
- **Next:** Slice 2 — member-scoped category and institution writes.

### SEC-004 — RBAC lock-down: imports, categories, rules, and exports restricted to owner/admin
- **Type:** FIX + CR (security backlog item)
- **What:** Members previously had broad write access. Now locked:
  - **Imports** (`imports.routes.ts`): all write ops (POST /sessions, file upload, file bind, file delete, status transition, parse, canonicalize, undo-import, ofx-confirm, reconcile-payslip) → `owner|admin`
  - **Categories** (`categories.routes.ts`): POST, PATCH /:id, DELETE /:id → `owner|admin`
  - **Category rules** (`category-rules.routes.ts`): POST, POST /bulk, PATCH /:id, DELETE /:id, DELETE /household, POST /recategorize, POST /from-ledger → `owner|admin`
  - **Exports** (`exports.routes.ts`): POST /household (start export) → `owner|admin`; POST /household/import (restore, wipes all data) → `owner` only
  - Read-only routes, `POST /categories/rules/test`, and `POST /categories/rules/rule-learning-preview` remain open to all authenticated users
  - Ledger writes (categorize, trash, manual entry) remain open — household members need to triage transactions
- **Tests:** Extended `app.test.ts` RBAC baseline to assert 403 on import session create, category create, rule create, export start, and restore
- **Files:** `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/category/categories.routes.ts`, `backend/src/modules/category/category-rules.routes.ts`, `backend/src/modules/export/exports.routes.ts`, `backend/tests/app.test.ts`

### UX-SEC-002 — First-login banner for owner forced password change
- **Type:** UX fix
- **What:** When an owner account with `force_password_change=true` is hard-redirected to `/settings?tab=security`, they now see an amber banner: "First login: Your account was created with a temporary password. Please set a permanent password below before using the app." Previously the redirect was silent — no explanation for why every click landed on the settings page.
- **Files:** `frontend/src/layout/ShellLayout.tsx`

### SEC-003 — Export ZIP 48-hour auto-cleanup
- **Type:** FIX + CR (security backlog item)
- **What:** Export ZIP files now expire and are purged after 48 hours.
  - **Backend:** `purgeExpiredExports()` in `export-job.service.ts` deletes the ZIP file from disk and marks `export_job.status = 'expired'` for all `complete` rows older than 48h. `startExportCleanupSchedule()` runs on server startup and repeats every hour via `setInterval`.
  - **Migration:** `0017_export_job_expired.sql` — adds `'expired'` to the `status` CHECK constraint on `export_job`.
  - **Download route:** `GET /exports/:jobId/download` now returns **410 Gone** with `code: EXPORT_EXPIRED` for purged files instead of 404 EXPORT_FILE_MISSING.
  - **Frontend:** Settings page export section now shows a notice: "Export files are available for 48 hours after generation. Please download a local copy before then." Expired-download error shows a clear message prompting a new export.
- **Files:** `backend/db/migrations/0017_export_job_expired.sql`, `backend/src/modules/export/export-job.service.ts`, `backend/src/modules/export/exports.routes.ts`, `frontend/src/pages/SettingsPage.tsx`

---

## 2026-04-15 (security hardening — public deployment readiness)

### SEC-001 — Security hardening: 5-piece hardening pass for OCI/internet-facing deployment
- **Type:** FIX + CR
- **What:** Comprehensive security hardening across auth, transport, file handling, and session management. Addressed issues identified in a pre-release security review. Changes shipped in 5 logical slices:

  **Piece 1 — Pure additions (no user-visible change):**
  - `helmet()` middleware added to `buildApp()` — sets `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, `Content-Security-Policy`, `Referrer-Policy`, and other standard security headers.
  - `express.json({ limit: '50kb' })` — explicit body size cap (was implicit Express default).
  - `path.basename(file.originalname)` on multer uploads — strips any directory traversal sequences from client-supplied filenames before writing to disk.
  - File upload size limits: imports 50 MB/file, 20 files max; payslips 25 MB/file, 1 file (previously unlimited — memory DoS vector).
  - `jwt.sign` now explicitly passes `{ algorithm: 'HS256' }`; `jwt.verify` now passes `{ algorithms: ['HS256'] }` — prevents algorithm confusion attacks.
  - **Timing oracle fix:** `login()` now always runs `bcrypt.compare` even when the email is not found (compares against a dummy hash). Previously, a missing email returned in ~1ms vs ~80ms for a wrong password, leaking which emails have accounts.

  **Piece 2 — bcrypt async + stronger rounds:**
  - All `bcrypt.compareSync` / `bcrypt.hashSync` calls replaced with `await bcrypt.compare` / `await bcrypt.hash` — synchronous bcrypt blocked the Node.js event loop for ~80-100ms per call.
  - Cost factor raised from `10` → `12` (OWASP 2023 recommendation; ~4× more work per hash for new passwords). Existing hashes remain valid — bcrypt reads the cost factor from the stored hash on compare.

  **Piece 3 — Login hardening + seed fix:**
  - `POST /auth/login` now rate-limited: 12 attempts per 15-minute window per IP via `express-rate-limit`. Returns 429 with descriptive message. Skipped in `MODE=TEST` so integration tests are unaffected.
  - Password strength enforced on `POST /auth/change-password`: min 10 chars + must include uppercase, lowercase, digit, and special character. Login schema unchanged (allows existing stored passwords to log in; strength only required when choosing a new password).
  - Bootstrap seed (`0001_bootstrap.sql`): default owner account (`owner@example.com`) now has `force_password_change = true`. Previously the owner was seeded without forced change — a public instance with the default credentials was accessible without any change prompt.

  **Piece 4 — Config hardening:**
  - `JWT_SECRET` minimum raised from 16 → 32 chars.
  - Server refuses to start in `PROD` if `JWT_SECRET` equals the default dev value — prevents accidental deployment with a well-known secret.
  - `ALLOWED_ORIGIN` env var added: when set, CORS header is locked to that origin. Unset in `TEST` (dev proxy keeps working); unset in `PROD` means no `Allow-Origin` header (browser cross-origin requests blocked). `.env.example` updated with guidance. Previously CORS was `Access-Control-Allow-Origin: *` unconditionally.

  **Piece 5 — Server-side logout:**
  - New `POST /auth/logout` (requires auth): increments `token_version`, immediately invalidating all existing JWTs for that user. Returns 204.
  - Frontend `AppTopBar.tsx` logout now fires `POST /auth/logout` (fire-and-forget) before clearing localStorage. If the server call fails the user is still logged out locally — no user-visible breakage.

- **Why:** App will be deployed on OCI free tier exposed to the internet. All items were identified in a pre-release security audit.
- **Files:** `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/config/env.ts`, `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.routes.ts`, `backend/src/modules/household/household.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/imports/import-session.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`, `backend/db/seeds/0001_bootstrap.sql`, `frontend/src/layout/AppTopBar.tsx`, `.env.example`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/CHANGE_HISTORY.md`.

### SEC-002 — Hard gate for owner force-password-change
- **Type:** FIX
- **What:** Owner accounts with `force_password_change = true` are now hard-redirected to `/settings?tab=security` on every route until the password is changed. Previously the banner said "must be changed before you continue" but nothing blocked navigation — the gate was purely visual. Member accounts retain the soft banner (redirect on their own time). Admin accounts follow member behavior (soft banner only).
- **Why:** A freshly seeded OCI/public instance with the default `owner@example.com` / `ChangeMe123!` credentials was fully usable without ever changing the password. The banner alone does not protect against an owner clicking away. Hard gate closes the gap.
- **Behavior:** `ShellLayout` now reads `role` from `GET /auth/me` alongside `forcePasswordChange`. If `forcePasswordChange && role === 'owner'` and the current path is not `/settings`, a `<Navigate replace>` fires immediately. The Settings page itself is always reachable so the owner can complete the password change.
- **Files:** `frontend/src/layout/ShellLayout.tsx`, `docs/CHANGE_HISTORY.md`.

---

## 2026-04-14 (multi-user onboarding + RBAC audit)

### CR-108 — Multi-user onboarding: login accounts for household members
- **Type:** CR
- **What:** Owner/admin can now create a login account when adding a household member, or for existing members later. Password defaults to `ChangeMe123!` and `force_password_change` is set — the member sees a banner on first login directing them to Settings → Security to change it.
- **Backend:**
  - Migration `0016_app_user_force_password_change.sql` — adds `force_password_change BOOLEAN NOT NULL DEFAULT false` to `app_user`
  - `household.service.ts` — `createHouseholdMember` extended with `createLogin?: boolean` (creates `app_user` + links `person_profile.linked_user_id`); new `createLoginForMember` for existing members; new `getHouseholdMemberDataCount`; `deleteHouseholdMember` now accepts `{ deleteLogin }` instead of blocking with `HAS_LOGIN_ACCOUNT`
  - `auth.service.ts` — `changePassword` clears `force_password_change`; new `getForcePasswordChange` helper
  - `auth.routes.ts` — `GET /auth/me` now returns `forcePasswordChange: boolean`
  - `household.routes.ts` — `POST /household/members` accepts `createLogin`; new `POST /household/members/:id/create-login`; new `GET /household/members/:id/data-count`; `DELETE /household/members/:id` accepts `{ deleteLogin }` body
  - `ledger.service.ts` + `ledger.routes.ts` — `POST /ledger/bulk-reassign-owner` reassigns all transactions from one person profile to another
- **Frontend:**
  - `SettingsPage.tsx` — new member rows show "Create login" checkbox with default-password note; existing members show "Has login account" (green) or "No login / Create login" button; delete confirmation warns about assigned transaction/payslip counts and offers "Also delete login account" checkbox
  - `ShellLayout.tsx` — fetches `GET /auth/me` after login; shows amber banner "Your password is temporary — change it now" if `forcePasswordChange`; banner clears on `app:password-changed` event
- **Default password:** `ChangeMe123!` — forced change on first login
- **Files:** `backend/db/migrations/0016_app_user_force_password_change.sql`, `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.routes.ts`, `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`, `backend/src/modules/ledger/ledger.service.ts`, `backend/src/modules/ledger/ledger.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/layout/ShellLayout.tsx`.

### PRD-006 — RBAC current state audit
- **Type:** PRD
- **What:** The `member` role currently has broad write access. Only the following are restricted to `owner`/`admin`:
  - Household settings, member management (`/household/*`)
  - Account create/edit (`POST/PATCH /imports/accounts`)
  - Custom institution create (`POST /imports/institutions/custom`)
  - Built-in category rule overrides (`/categories/rules/builtin/*`)
  - Everything else — ledger writes, categories, custom rules, imports, budgets, payslips, exports — is accessible to `member` role.
- **Decision:** Acceptable for household use where members are trusted family. A role-based lock-down of imports and category management is **backlog** (no CR yet).
- **Backlog items documented:**
  1. Lock `POST/DELETE /categories` (custom category CRUD) to owner/admin
  2. Lock `POST/DELETE /categories/rules` (custom rule CRUD) to owner/admin
  3. Lock import session create/finalize to owner/admin (members can view but not import)
  4. Lock export/restore to owner/admin
  5. Self-service "request access" invite flow from home page (member signs up using email already added by owner)

## 2026-04-14 (memo editing on transactions)

### CR-107 — Inline memo editing on transaction rows
- **Type:** CR
- **What:** Users can now add or edit a free-text memo on any posted or needs-review transaction directly from the transaction list. The memo line is hidden until the row is hovered (hover-reveal). If a memo is already set it is always visible. Clicking the pencil icon enters inline edit mode — Enter saves, Escape cancels. Trashed rows show memo as read-only (no edit affordance).
- **Backend:** `PATCH /ledger/:id` extended to accept `{ memo: string | null }` as a memo-only update path. New service function `updateCanonicalTransactionMemo` in `ledger.service.ts`.
- **Frontend:** `TransactionsPage.tsx` — new `editingMemoId` / `memoDraft` state, `startMemoEdit` / `cancelMemoEdit` / `saveMemo` handlers, description cell redesigned to show merchant as primary + memo as secondary hover-reveal line.
- **CSS:** New `.transactions-page__memo-line`, `.transactions-page__memo-pencil`, `.transactions-page__memo-edit`, `.transactions-page__memo-input`, `.transactions-page__memo-btn` rules in `index.css`.
- **Why memo not merchant:** Merchant is the source-parsed description and part of the dedup fingerprint — editing it would diverge from the import source. Memo is a separate annotation field, not in the fingerprint, safe to edit freely.
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `backend/src/modules/ledger/ledger.routes.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/index.css`.

## 2026-04-14 (transactions UX: pagination + clear filters; net worth: remove misleading eye icons)

### UX-018 — Transactions: improved pagination + "Clear all filters" button
- **Type:** UX
- **What:**
  1. Pagination bar now shows "Showing 1–100 of 905 transaction(s). Page 1 of 10." instead of the raw offset/limit debug text.
  2. Added a "Per page" selector (25 / 50 / 100 / 200) next to Prev/Next so users can control page size.
  3. Added a "Clear all filters" button in the filter toolbar (visible only when any filter is active) — one-click reset to default view, same as the existing link in the active-filters paragraph.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`.

### UX-019 — Net worth: remove misleading "View transactions" links from Trend card
- **Type:** UX
- **What:** The Period Summary table had eye-icon links and the Trend chart tooltip had a "View transactions →" link, both navigating to Transactions filtered by that date. These were misleading: net worth balances come from `account_balance_snapshot` (manual entries + import-sourced snapshots), not from the transaction ledger. There is no guarantee any transaction exists for a given balance date, so the links could lead to empty results and imply a relationship that does not exist. Both removed. The per-account drill-down links in the Balance Sheet table below (linking to an account's import file) are intentional and remain.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

## 2026-04-14 (net worth UX + balance resolution fix)

### FIX-007 — Net worth: balance resolution — most-recent wins (manual or import)
- **Type:** FIX
- **What:** The balance resolution order previously hard-coded **manual > import** regardless of date. If a manual snapshot existed from March 30 and an import snapshot existed from April 5 on the same account, the March 30 value was shown. Fixed: both manual and import snapshots are fetched concurrently; the one with the **more recent `as_of_date`** is used. Tie-break favours manual (explicit user entry). The legacy import-file-hint fallback is unchanged (only triggers when no `account_balance_snapshot` row exists at all).
- **Files:** `backend/src/modules/reports/balance-sheet.service.ts`.

### UX-013 — Net worth: remove overlay accounts from trend chart
- **Type:** UX
- **What:** Removed the "Overlay accounts on chart" MultiSelect from the Trend section. The feature added per-account line overlays but had rendering bugs and low utility given the Balance Sheet table below already shows per-account detail.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

### UX-014 — Net worth: default period changed to Last 3 months
- **Type:** UX
- **What:** Trend chart and custom range now default to **Last 3 months** (was Last 12 months). Reduces initial data load and focuses on recent activity.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

### UX-015 — Net worth: "Belongs to" filter aligned with Transactions page
- **Type:** UX
- **What:** Removed the spurious "Scope > All accounts" group from the `HierarchicalSearchPicker` dropdown. The picker's existing `clearable` prop already handles the "all accounts" state. Group labels now match TransactionsPage: `Household` / `Members`.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

### UX-016 — Net worth: more Period and Interval options + Period Summary "Date" label
- **Type:** UX
- **What:** Added **Last 2 years** (`2y`) and **Last 3 years** (`3y`) period presets. Added **Quarter-end** interval option (generates March 31, June 30, Sept 30, Dec 31 sample dates). Renamed "Sample" column in the Period Summary table to "Date". Updated backend to accept and generate `quarter` interval points.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`, `backend/src/modules/reports/balance-sheet.service.ts`, `backend/src/modules/reports/reports.routes.ts`.

### UX-017 — Net worth: Top 5 Assets + Top 5 Liabilities panels
- **Type:** UX
- **What:** Added ranked quick-view panels between the summary cards and the full account table. Each panel shows up to 5 accounts sorted by balance magnitude, with a clickable link to the account's transactions. Assets highlighted green, liabilities amber. Only renders when balance data exists.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

---

## 2026-04-13 (net worth, member management, security)

### FIX-003 — Net worth: retirement accounts excluded from balance sheet
- **Type:** FIX
- **What:** `accountSide()` in `balance-sheet.service.ts` only classified `checking`, `savings`, `investment` as assets. `retirement` fell through to `null` → those accounts were invisible on the Net Worth page. Added `retirement` to the asset branch.
- **Files:** `backend/src/modules/reports/balance-sheet.service.ts`, `docs/API_BALANCE_SHEET.md`.

### FIX-004 — Net worth: liability account balance sign normalization on import
- **Type:** FIX
- **What:** OFX files (and some PDF parsers) report credit-card / loan balances as **negative** values (e.g. `-500.00` = you owe $500). The net-worth formula stores liability magnitudes as **positive** (`netWorth = assetSum − liabilitySum`), so a stored `-500` was _adding_ $500 to net worth instead of subtracting it. Fixed: when persisting a statement balance snapshot for a `credit_card`, `loan`, or `mortgage` account, the value is negated if negative. Applies to any parser that returns `statementBalances`.
- **Files:** `backend/src/modules/imports/import-parser.service.ts`.

### FIX-005 — Wealthfront PDF: balance regex too strict + starting balance not extracted
- **Type:** FIX
- **What:** The ending-balance regex used literal `\n` as separator; if `pdf-parse` emitted different whitespace the match silently failed and no snapshot was persisted. Changed both starting and ending balance regexes to `\s+`. Also added **starting balance** extraction (was always `null` before) so `statementBalances.beginning` / `.asOfStart` are now populated.
- **Files:** `backend/src/modules/imports/profiles/wealthfront-investment-pdf.ts`.

### FIX-006 — Wealthfront import inference: `checking` account type not matched
- **Type:** FIX
- **What:** `inferParserProfile` only matched Wealthfront accounts with type `investment | savings | retirement`. Wealthfront Cash Account is typically set up as `checking` (also the default in the account form), so the auto-match returned `null` → "couldn't match this file". Added `checking` to the CSV condition and added a new Wealthfront PDF inference branch. Updated the stale "stub" comment in `profile-ids.ts`.
- **Files:** `frontend/src/import/inferParserProfile.ts`, `frontend/src/import/inferParserProfile.test.ts`, `frontend/src/import/profileLabels.ts`, `backend/src/modules/imports/profiles/profile-ids.ts`.

### CR-106 — Member management: remove member (DELETE /household/members/:id + UI)
- **Type:** CR
- **What:** Added `DELETE /household/members/:memberId` (owner/admin only). Deletes both `household_membership` and `person_profile` in a transaction. Returns **409 HAS_LOGIN_ACCOUNT** when the member has a linked `app_user`. Frontend: saved member rows now show a **Remove** button (confirm dialog, calls DELETE, refreshes list). Unsaved draft rows get a **Discard** button. Docs updated.
- **Files:** `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/API_HOUSEHOLD.md`.

### FIX-007 — 401 interceptor: auto-clear token + redirect to login on session expiry
- **Type:** FIX
- **What:** `apiJson` and `apiFetch` now call `setToken(null)` on a **401** response. `RequireAuth` re-renders on token change and redirects to home/login automatically. Previously, expired tokens caused raw error messages ("Missing bearer token") with no recovery.
- **Files:** `frontend/src/api.ts`.

---

## 2026-04-13 (developer ergonomics)

### DX-001 — One-command npm scripts map + setup `.env` bootstrap
- **Type:** DX + docs
- **What:** Root `package.json` adds **`start:dev`** / **`stop:dev`** (aliases for `services:start` / `services:stop`), **`db:reset`** (alias for `db:cleanup`), **`db:reset:dev`** (cleanup + dev seeds). **`scripts/setup.sh`** copies **`.env.example` → `.env`** when missing and reminds to start Docker Postgres. **`README.md`**, **`docs/RUNBOOK.md`**, **`CLAUDE.md`**, **`ENVIRONMENT_VARIABLES.md`**, **`LOGGING.md`**, **`frontend/README.md`** updated (Postgres quick start; `db:cleanup` no longer documented as `npm run db:cleanup -- --yes`).
- **Files:** `package.json`, `scripts/setup.sh`, `README.md`, `docs/RUNBOOK.md`, `CLAUDE.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/LOGGING.md`, `frontend/README.md`, `docs/CHANGE_HISTORY.md`.

---

## 2026-04-13 (bank parsers, cont.)

### CR-104 — BoA credit card CSV: date ISO output + test coverage
- **Type:** FIX + CR
- **What:** `boa-credit-card-csv.ts` was emitting `MM/DD/YYYY` into `txn_date` (same issue as Marcus before CR-101). Fixed to output `YYYY-MM-DD`. Added 5 unit tests covering date conversion, amounts, reference_id, and description.
- **Files:** `backend/src/modules/imports/profiles/boa-credit-card-csv.ts`, `backend/tests/csv-parsers.test.ts`.

### CR-105 — Wealthfront Cash Account PDF statement parser
- **Type:** CR (new parser)
- **What:** Built `wealthfront-investment-pdf.ts` for Wealthfront monthly PDF statements. Parses deposits (ACH Received), withdrawals (ACH/RTP Disbursed), and interest payments. Skips "Transfer between Wealthfront and Program Banks" rows — these are internal FDIC-sweep allocations with no cash-flow meaning. Extracts ending balance → `statementBalances` → auto-persisted as `account_balance_snapshot` (same pipeline as BoA/OFX/Marcus). Wired into `import-parser.service.ts` with full balance-snapshot pass-through. 11 new tests covering both Feb and March 2026 statement patterns (including RTP/FedNow with mid-row footnote).
- **Files:** `backend/src/modules/imports/profiles/wealthfront-investment-pdf.ts` (new), `backend/src/modules/imports/import-parser.service.ts`, `backend/tests/pdf-parsers.test.ts`.

### FIX-001 — BoaStatementBalances source union expanded; Marcus source corrected
- **Type:** FIX
- **What:** `BoaStatementBalances.source` was a narrow union that excluded `marcus_online_savings_pdf` and `wealthfront_investment_pdf`. Extended the union. Marcus was incorrectly using `"ofx_transactions"` as its source value — corrected to `"marcus_online_savings_pdf"`.
- **Files:** `backend/src/modules/imports/profiles/boa-checking-savings-csv.ts`, `backend/src/modules/imports/profiles/marcus-online-savings-pdf.ts`.

### BACKLOG-001 — Resolution queue: bulk-resolve by description pattern (not yet implemented)
- **Type:** Backlog
- **What:** After importing Discover / Wealthfront historical data, the `unknown_category` resolution queue will grow. A "apply this category to all transactions matching this description" action would significantly reduce per-item review work. Proposed: resolution item detail shows a "categorize all N matching" option that fires a new `POST /resolution/bulk-assign` endpoint, creates a category rule, and resolves all matching open items in one step.

---

## 2026-04-13 (bank parsers)

### CR-101 — Marcus Online Savings PDF: date normalization, balance snapshot, hardened sign detection
- **Type:** FIX + CR
- **What:** Three improvements to `marcus-online-savings-pdf.ts`:
  1. **Date output is now ISO (YYYY-MM-DD)** — previously emitted `MM/DD/YYYY` into `transaction_raw.txn_date`; canonical ingest normalized it for fingerprinting but the raw table stored the un-normalized form.
  2. **Ending balance snapshot extraction** — the `Ending Balance` row is now captured and returned as `statementBalances.ending` so `import-parser.service.ts` can persist an `account_balance_snapshot` (same path as BoA and OFX). Previously the row was silently dropped.
  3. **Sign keyword list expanded** — added `incoming`, `direct deposit`, `ach credit`, `refund`, `outgoing`, `wire out`, `fee` to cover common Marcus savings transaction types. Unknown types still default to debit with an explanatory comment.
- **Files:** `backend/src/modules/imports/profiles/marcus-online-savings-pdf.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/tests/pdf-parsers.test.ts`.

### CR-102 — Discover card CSV: preserve Discover-supplied Category in source_row
- **Type:** CR
- **What:** The Discover export includes a `Category` column (e.g. "Supermarkets", "Payments and Credits"). It is now preserved in `source_row["Category"]` so it is available if category-hint logic is added later. No change to how categories are assigned during classification.
- **Files:** `backend/src/modules/imports/profiles/discover-card-csv.ts`, `backend/tests/csv-parsers.test.ts`.

### CR-103 — Register stub profiles for Capital One card CSV and Wealthfront PDF
- **Type:** CR
- **What:** Added `capital_one_card_csv` and `wealthfront_investment_pdf` to `PARSER_PROFILE_IDS`. Both return `NOT_IMPLEMENTED` from the parser service. Capital One CSV format is TBD; Wealthfront PDF parser needs a sample statement before it can be implemented. These stubs allow accounts to be associated with the profile IDs in the UI without silent failures.
- **Files:** `backend/src/modules/imports/profiles/profile-ids.ts`, `backend/src/modules/imports/import-parser.service.ts`.

---

## 2026-04-13

### DB-006 — Rename `migrations_pg` / `seeds_pg` to `migrations` / `seeds`
- **Type:** DB + housekeeping
- **What:** Dropped the `_pg` suffix now that Postgres is the only database. `backend/scripts/gen-0026-migration.mjs` writes the built-in rules block using Postgres `INSERT ... ON CONFLICT DO NOTHING` into `backend/db/seeds/0001_bootstrap.sql`.
- **Files:** `backend/db/migrations/`, `backend/db/seeds/`, `backend/src/db/apply-pg-migrations.ts`, `scripts/db-pg.mjs`, `scripts/db.sh`, `backend/scripts/gen-0026-migration.mjs`, `Dockerfile`, `CLAUDE.md`, `backend/db/README.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/POSTGRES_CUTOVER.md`, `docs/PRODUCTION_SETUP.md`, `docs/RUNBOOK.md`, and related doc touch-ups.

### DB-005 — Built-in merchant scopes: selective `debit_only` -> `any`
- **Type:** DB
- **What:** Updated refund-prone **merchant** built-ins to **`any`** scope (kept broad/generic and directional finance rules unchanged). Changed keys: `dining_1..8`, `coffee_0..2`, `groceries_0..4`, `groceries_7..10`, `transit_0..6`, `transit_9`. Source-of-truth seed and fixture CSV kept in sync.
- **Files:** `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/classification-rules-builtin.csv`.

### DB-004 — Global category Shopping > Office (`0015` + bootstrap seed)
- **Type:** DB
- **What:** Added default leaf **`Office`** under **`Shopping`** (`id` **`30000000-0000-0000-0000-000000000167`**) for work-related spend (memberships, conference fees, supplies). Migration **`0015_category_shopping_office.sql`**, bootstrap seed, fixture categories list, and **`DEFAULT_CATEGORY_IDS.shoppingOffice`** updated.
- **Files:** `backend/db/migrations/0015_category_shopping_office.sql`, `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/categories.csv`, `backend/src/modules/category/category-ids.ts`.

### DB-003 — Global category Mobility > Parking & Tolls (`0014` + bootstrap seed)
- **Type:** DB
- **What:** Added default leaf **`Parking & Tolls`** under **`Mobility`** (`id` **`30000000-0000-0000-0000-000000000166`**). Migration **`0014_category_mobility_parking_tolls.sql`**; **`seeds/0001_bootstrap.sql`**; **`fixtures/category-import/categories.csv`**; **`DEFAULT_CATEGORY_IDS.mobilityParkingAndTolls`**.
- **Files:** `backend/db/migrations/0014_category_mobility_parking_tolls.sql`, `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/categories.csv`, `backend/src/modules/category/category-ids.ts`.

### DB-002 — Global category Shopping > Software (`0013` + bootstrap seed)
- **Type:** DB
- **What:** Added default leaf **`Software`** under **`Shopping`** (`id` **`30000000-0000-0000-0000-000000000165`**) for SaaS / subscription-style spend. Migration **`0013_category_shopping_software.sql`** inserts for existing DBs; **`backend/db/seeds/0001_bootstrap.sql`** includes the row for fresh **`db:seed`**. **`fixtures/category-import/categories.csv`** and **`DEFAULT_CATEGORY_IDS.shoppingSoftware`** in **`category-ids.ts`** updated.
- **Files:** `backend/db/migrations/0013_category_shopping_software.sql`, `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/categories.csv`, `backend/src/modules/category/category-ids.ts`.

### CR-101 — Home page redesign: remove diagonal cut, two-panel split, dark mode contrast
- **Type:** CR / UX / Frontend
- **What:**
  1. **Diagonal gradient removed** — the `linear-gradient(165deg, …42%…42%…)` hard-angle cut across the hero caused bullet text (Categories & rules, Budgets & net worth) to land on the light side and become invisible. Replaced with a CSS `::before` pseudo-element that covers the left 58% of the viewport in a solid dark navy gradient — true vertical split, no diagonal.
  2. **Mobile** — on narrow screens the `::before` panel is hidden; the whole background becomes the navy gradient (hero text always on dark).
  3. **Auth card** — removed `backdrop-filter: blur` and glass effect; card is now a clean `#fff` with a subtle box-shadow, matching polished SaaS finance app conventions.
  4. **Dark mode home** — both panels switch to a dark blue-charcoal palette; right panel uses `#161d2e` instead of translucent glass.
  5. **Dark mode dashboard contrast** — surface variables shifted from near-identical gray to slightly blue-tinted navy (`--color-surface: #1a2236`, `--color-surface-alt: #1f2940`, `--color-border: #2d3a52`) so cards visually separate from the page background. Dark mode card gets a subtle inset glow.
  6. **Glow orb** — repositioned to left panel only; uses teal radial gradient instead of sky-blue.
- **Files:** `frontend/src/index.css`.

### UX-001 — Categories page: icon buttons + SourceBadge on subcategory rows
- **Type:** UX / Frontend
- **What:**
  1. **Child row action buttons** — subcategory rows (child rows) previously used text buttons ("Edit" / "Delete" / "—"). Updated to match parent row style: `<IconPencil size={13} />` icon button for edit, `<IconTrash size={13} />` (red-tinted) for delete. Non-editable / non-deletable rows show no button (dash removed).
  2. **SourceBadge on child rows** — subcategory source column previously rendered raw text ("Built-in template"). Now renders the same `<SourceBadge>` pill badge as parent rows ("Built-in" gray / "Yours" emerald). `sourceLabel()` helper removed as it's no longer used.
- **Files:** `frontend/src/pages/CategoriesPage.tsx`.

### UX-002 — Remove broken /resolution-queue link; redirect to Needs Review
- **Type:** UX / Frontend
- **What:** A banner in the Needs Review tab linked to `/resolution-queue`, which rendered a blank page. The separate resolution queue concept is removed — all transaction review happens in the Transactions page itself. Changes:
  1. **Banner link removed** — near-duplicate orphan banner no longer links to `/resolution-queue`. Message updated to explain the items exist but can be ignored.
  2. **Route redirect** — `/resolution-queue` now redirects to `/transactions?needsReview=true` (same as the existing `/resolution` redirect). `ResolutionQueuePage` import removed from `App.tsx`.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/App.tsx`.

### CR-100 — Import Workspace page redesign: icon buttons, status badges, HelpIcon, hub card rows
- **Type:** CR / UX / Frontend
- **What:** Aesthetic overhaul of `ImportWorkspacePage.tsx`.
  1. **Hub page (no sessionId)** — Page h1 "Import" gets a `<HelpIcon>`. Nav links (Home / Classification rules) moved inline. "New import session" button gains `<IconUpload>`. Recent sessions table replaced with card-based rows — each row shows date, `<SessionStatusBadge>`, file count, truncated session id, and an "Open" link.
  2. **`SessionStatusBadge` component** — Colored pill badge for session status: Created (muted), Processing (blue), Review (amber), Finalized (emerald), Failed (red).
  3. **Session workspace header** — Removed the long `<p>` paragraph with session id. Replaced with compact inline row: `<SessionStatusBadge>`, truncated session id code, "Copy id" button. `<HelpIcon>` on h1.
  4. **Section headings** — Verbose description paragraphs removed from "Upload files", "Files & account", "Run import", "Classification matcher preview", "Undo ledger posting", and "Finalize session". Each replaced with an inline `<HelpIcon>` tooltip.
  5. **Run import button** — `<IconPlayerPlay size={15} />` added inline.
  6. **Undo posting button** — `<IconArrowBackUp size={15} />` added inline; label shortened to "Undo posting".
  7. **Finalize session button** — `<IconLock size={15} />` added inline.
  8. **Remove file button** — `<IconTrash size={12} />` + compact "Remove" label (red-tinted, replaces "Remove from session" text button).
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`.

### CR-099 — Classification Rules page redesign: badge pills, icon buttons, collapsible sections, HelpIcon
- **Type:** CR / UX / Frontend
- **What:** Aesthetic overhaul of `CategoryRulesPage.tsx`.
  1. **Page header** — Removed the 3-paragraph wall-of-text intro. Replaced with a compact `<HelpIcon>` tooltip on the "Classification rules" h1. Navigation links (Categories / Transactions / Import) moved inline to the header row.
  2. **`MatchTypeBadge` component** — Renders `CONTAINS` (blue), `PREFIX` (purple), `REGEX` (amber) as colored pill badges in the match type column for both household and built-in rules tables.
  3. **`AmountScopeBadge` component** — Renders `ANY` (muted gray), `CREDIT` (emerald green), `DEBIT` (red) as colored pill badges in the amount scope column.
  4. **Icon buttons** — Edit → `<IconPencil size={13} />`, Delete → `<IconTrash size={13} />` (red-tinted) in both household and built-in rule tables. Save/Cancel remain as text buttons (appropriate for inline form context).
  5. **Collapsible Import/Export section** — Wrapped in `<details><summary>` with a `<HelpIcon>` explaining create-only behavior. Closed by default to reduce visual noise for users who don't need it.
  6. **Collapsible Search & test + Re-apply section** — Wrapped in `<details><summary>` with a `<HelpIcon>`. Reduces initial page density.
  7. **Section headings** — All verbose description paragraphs under section h2s removed; replaced with inline `<HelpIcon>` tooltips.
- **Files:** `frontend/src/pages/CategoryRulesPage.tsx`.

### CR-098 — Categories page redesign: SourceBadge, icon buttons, HelpIcon
- **Type:** CR / UX / Frontend
- **What:** Aesthetic overhaul of `CategoriesPage.tsx`.
  1. **Page header** — Removed the 5-paragraph wall-of-text intro. Replaced with a compact `<HelpIcon>` tooltip on the "Categories" h1. Navigation links moved inline to the header row.
  2. **`SourceBadge` component** — Replaced plain text (`Built-in` / `Yours (household)`) in the Source column with a colored pill badge. Household-scoped categories render in emerald teal; built-ins render in muted gray. A `<HelpIcon>` added to the Source column header explains the distinction.
  3. **Icon buttons** — "Edit" and "Delete" text buttons replaced with `<IconPencil size={13} />` and `<IconTrash size={13} />` icon buttons (using `replace_all` to cover both table rows and inline editing state) with appropriate `title` attributes.
  4. **Inline edit state** — Save and Cancel buttons remain text labels (appropriate for a form-confirmation context).
- **Files:** `frontend/src/pages/CategoriesPage.tsx`.

### CR-095 — Net Worth page redesign: AreaChart gradient, stat cards, HelpIcon, icon buttons
- **Type:** CR / UX / Frontend
- **What:** Visual overhaul of `NetWorthPage.tsx`.
  1. **Page header** — Removed the 4-line wall-of-text intro paragraph. Replaced with a compact `<HelpIcon>` tooltip on the "Net worth" h1. "Manage accounts" link moved inline to the header row.
  2. **AreaChart with gradient** — Upgraded `LineChart` → `AreaChart`. Net worth renders as a bold emerald area with a soft gradient fill. Assets: lighter emerald line+fill. Liabilities: amber/orange with gradient. Account overlay lines remain as `<Line>` over the area chart.
  3. **Chart colors** — All hardcoded hex replaced: net worth `#059669` → `#15803d` (emerald-700), assets `#2563eb` → `#22c55e` (emerald-500), liabilities `#dc2626` → `#f59e0b` (amber — debts are a caution, not danger). Tooltip now shows color-coded series names.
  4. **Period summary** — "View" text links replaced with `<IconEye>` icon buttons. Change row color-coded green/red. Verbose description paragraph removed; replaced with `<HelpIcon>`.
  5. **Balance sheet KPI cards** — Replaced plain inline row with 3 stat cards matching Budget page style (colored `borderTop` accent: green for assets, amber for liabilities, conditional for net worth).
  6. **Balance sheet heading** — `<HelpIcon>` on h2; verbose description paragraph removed.
  7. **Edit pencil** — Custom inline SVG replaced with `<IconPencil size={15} />` from @tabler/icons-react.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

### CR-097 — Payslips page redesign: KPI cards, card-based list, icon buttons, HelpIcon
- **Type:** CR / UX / Frontend
- **What:** Aesthetic overhaul of `PayslipsPage.tsx`.
  1. **Hero KPI cards** — 4 stat cards at the top when payslips exist: Latest gross, Latest net, YTD gross, YTD net. Each has a colored `borderTop` accent (emerald for gross/net current, muted for YTD). Derived from `data.items[0]` (newest payslip, sorted by backend).
  2. **Page header** — `<HelpIcon>` replaces the intro paragraph. Two action buttons added: "Import PDF" (links to /imports, outline style) and "Add manually" (emerald filled, `<IconPlus>`).
  3. **Belongs-to filter** — Compact inline label + `<HelpIcon>` tooltip; verbose explanation paragraph removed.
  4. **Charts section** — `<HelpIcon>` on "Income & payroll" heading.
  5. **Payslip list** — Replaced the plain `<table>` with card-based rows. Each row: period start/end + pay date, gross + net in a two-column mini-grid, eye icon (`<IconEye>`) + trash icon (`<IconTrash>`) action buttons. Net pay rendered in emerald green.
  6. **Empty state** — Updated copy to reference the two add actions.
- **Files:** `frontend/src/pages/PayslipsPage.tsx`.

### CR-096 — Transactions page: duplicate filter bug fix + aesthetic overhaul
- **Type:** FIX + CR / UX / Backend + Frontend
- **Bug fix (backend):** When `resolutionType=duplicate_ambiguity` was selected in Needs Review, exact duplicate rows (`status='duplicate'`) disappeared. Exact duplicates are created by fingerprint deduplication with no `resolution_item` — they surface via `status NOT IN ('posted','trashed')`. The `resolutionTypes` SQL predicate required an `EXISTS` on `resolution_item`, excluding them. **Fix:** when `duplicate_ambiguity` is in `resolutionTypes`, the predicate now also includes `tc.status = 'duplicate'` via an `OR` clause. Both exact and near-duplicates appear when the "Duplicate" filter is active.
- **Aesthetic changes (frontend):**
  1. **Page header** — Wall-of-text intro replaced with compact `<HelpIcon>` tooltip. Session/dashboard links moved inline.
  2. **Status badges** — Non-`posted` transactions now show a colored pill badge next to the amount (`Duplicate` → amber, `Trashed` → red, `Pending` → gray).
  3. **Icon buttons** — Trash → `<IconTrash>`, Restore → `<IconArrowBackUp>`, Hard-delete → red-tinted `<IconTrash>`.
  4. **Add transaction button** — `<IconPlus>` added alongside label, emerald primary styling.
  5. **More filters toggle** — Verbose FTS paragraph replaced with `<HelpIcon>`. Toggle label improved.
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `frontend/src/pages/TransactionsPage.tsx`.

### CR-094 — Budget page redesign: "Add a category" placement, icon nav, HelpIcon, CSS var colors
- **Type:** CR / UX / Frontend
- **What:** Aesthetic and UX improvements to `BudgetPage.tsx`.
  1. **"Add a category" placement** — Moved the category picker (select + Add button) from `<tfoot>` *after* the Total row to *before* it. Total row now correctly sits as the last summary row, with "Add a category" appearing above it. This is the correct UX — users add categories, then see the total update.
  2. **Progress bars use CSS vars** — `ProgressBar` now uses `var(--color-success)`, `var(--color-warning)`, `var(--color-danger)` instead of hard-coded hex (#16a34a, #d97706, #dc2626). Responds correctly to dark mode.
  3. **KPI summary cards** — Each card gets a color-coded `borderTop` accent: neutral (budgeted), green (remaining) or red (over budget), and red on "Spent" when over budget. Labels use uppercase tracking for cleaner finance aesthetic.
  4. **Chevron icon nav** — Month navigation `<` / `>` text replaced with `IconChevronLeft` / `IconChevronRight` icon buttons (`@tabler/icons-react`).
  5. **HelpIcon on page title** — Inline help tooltip added next to "Budget" heading via `<HelpIcon>`. SetupForm description paragraph condensed to one line with a `<HelpIcon>` for full detail.
  6. **Edit budget button** — Now includes `IconPencil` icon and cleaner inline-flex styling.
- **Files:** `frontend/src/pages/BudgetPage.tsx`.

### CR-090 — Design system foundation: emerald + amber palette, dark mode, Inter font, @tabler/icons-react
- **Type:** CR / UX / Frontend
- **What:** Established a unified design token layer used by every subsequent Epic 12 phase.
  1. **Color palette** — Replaced legacy sky-blue (#0284c7) with **emerald green** primary (#22c55e light / #4ade80 dark mode) + **amber/orange** complement (#f59e0b). Teal was an initial choice but discarded after dark-mode review (too close in hue to the dark navy sidebar, low contrast). Emerald sits at hue ~145° vs navy ~215° — clear separation and vibrant on both dark and light backgrounds.
  2. **CSS custom properties** — Full redesign of `:root` block. New tokens: `--color-accent`, `--color-accent-bright`, `--color-accent-hover`, `--color-accent-subtle`, `--color-warm`, `--color-warm-dark`, `--color-warm-subtle`, `--color-sidebar-*`, `--color-surface-alt`, `--color-text-secondary`, plus semantic success/warning/danger subtle tokens.
  3. **Dark mode** — `[data-mantine-color-scheme="dark"]` selector block covers all surfaces, inputs, tables, pickers, toolbars, dropdowns, modals, and the home-page hero. Persisted via `localStorageColorSchemeManager` (key: `hf_color_scheme`).
  4. **Mantine theme** (`frontend/src/theme.ts` — new) — `primaryColor: 'green'`, `primaryShade: {light:7, dark:4}`, Inter font, `defaultRadius: 'md'`, component defaults (Button sm, ActionIcon subtle, Modal centered+blur, Tooltip withArrow+multiline).
  5. **Inter font** — Added to Google Fonts preload in `index.html` alongside DM Sans.
  6. **@tabler/icons-react** — Installed as frontend dependency (natural Mantine companion).
- **Files:** `frontend/src/index.css`, `frontend/src/theme.ts` (new), `frontend/src/main.tsx`, `frontend/index.html`, `frontend/package.json`.

### CR-091 — Shared UI components: HelpIcon, PageHeader, SectionCard
- **Type:** CR / UX / Frontend
- **What:** Three reusable components that enforce design consistency across all pages going forward.
  - **`HelpIcon`** (`frontend/src/components/HelpIcon.tsx`) — `IconInfoCircle` wrapped in Mantine `Tooltip`. Replaces verbose inline `<p class="muted">` help paragraphs with a compact `ⓘ` icon badge. Usage: `<HelpIcon label="..." />` next to any label or heading.
  - **`PageHeader`** (`frontend/src/components/PageHeader.tsx`) — Consistent `h1` + optional subtitle + optional `HelpIcon` + right-aligned action slot. Eliminates per-page ad-hoc heading rows.
  - **`SectionCard`** (`frontend/src/components/SectionCard.tsx`) — Titled `.card` wrapper with optional `HelpIcon` and header action slot. Replaces ad-hoc `<div class="card"> + <h2>` combinations.
- **Files:** `frontend/src/components/HelpIcon.tsx` (new), `frontend/src/components/PageHeader.tsx` (new), `frontend/src/components/SectionCard.tsx` (new), `frontend/src/index.css` (PageHeader + SectionCard CSS added).

### CR-092 — Home page redesign: simplified auth card + hero pills
- **Type:** CR / UX / Frontend
- **What:** Rebuilt the guest landing page auth card and hero section.
  1. **Auth card** — Removed the 3-tab (Sign In / Sign Up / Forgot Password) Mantine Tabs that felt clunky. Reverted to a single clean sign-in form. Below the form: a compact footer row with `"New here? Request access"` and `"Forgot password?"` as lightweight mailto links — no disabled stub forms, no redundant UI. Proper CR stubs for backend sign-up and password-reset flows are tracked in the backlog (CR-095a, CR-095b).
  2. **Hero** — Added a fourth bullet ("Budgets & net worth"). Added a feature-pill row at the bottom of the hero (Cash flow · Budgets · Net worth · Payslips · Imports · Categories) in subtle emerald-green on dark background.
  3. **Dark mode home page** — Explicit `[data-mantine-color-scheme="dark"]` override for `.home-landing` gradient (both sides fully dark). Auth card gets dark-glass treatment (dark navy background, subtle white border) so it stands out clearly against the very dark page background.
- **Files:** `frontend/src/pages/HomePage.tsx`, `frontend/src/index.css`.

### CR-093 — Navigation redesign: dark navy sidebar with icons, slim dark topbar, dark mode toggle
- **Type:** CR / UX / Frontend
- **What:** Full visual overhaul of the app shell navigation.
  1. **Sidebar** — Background changed from white to dark navy (`#1a2540`). All six nav items now use `@tabler/icons-react` icons (Home → `IconHome`, Budget → `IconChartBar`, Net Worth → `IconScale`, Transactions → `IconReceipt`, Payslips → `IconFileText`, Categories → `IconTag`). Active state: emerald-green left border + emerald text + subtle emerald bg. Hover: semi-transparent white overlay. Settings moved from topbar user-menu only → also pinned as a bottom nav item (`IconSettings`). Collapsed state: icons only (letters removed). Collapse button uses `IconChevronLeft/Right`.
  2. **Topbar** — Background changed from white to dark navy (matches sidebar top). **Dark mode toggle** added (`IconSun` / `IconMoon`, hooks into `useMantineColorScheme()`). **Import button** restyled: emerald-green filled compact button with `IconUpload` icon. Mobile hamburger replaced with `IconMenu2`. User menu trigger: semi-transparent white pill on dark background. User dropdown: dark-glass treatment (dark navy, subtle borders).
- **Files:** `frontend/src/layout/AppSidebar.tsx`, `frontend/src/layout/AppTopBar.tsx`, `frontend/src/index.css`.

### Backlog CRs created (from Epic 12 Phase 1–4)
- **CR-095a** — Backend: User sign-up endpoint + household invitation flow (Medium priority, High complexity)
- **CR-095b** — Self-service forgot password via email reset link (Medium priority, Medium complexity) — see full spec below
- **CR-097a** — Payslip: Bulk PDF import (multiple files in one session) (Medium, Medium)
- **CR-097b** — Payslip: YTD analytics dashboard — income trends, tax rate history (Low, Medium)
- **CR-097c** — Payslip: Employer management from payslip list (currently only in Settings) (Low, Low)
- **CR-101** — Budget: Rollover unspent budget to next month (Low, Medium)
- **CR-102** — Dashboard: Spending alerts / push notifications (Low, High)
- **CR-103** — Transactions: Bulk recategorization (Medium, Low)
- **CR-104** — Net worth: Goal tracking — target net worth by date (Low, Medium)
- **CR-105** — Mobile: PWA manifest + install prompt (Low, Low)

---

## 2026-04-17 (email infrastructure decision + CR-095b spec)

### CR-106 — Email infrastructure: SMTP abstraction + provider decision

- **Type:** CR (architecture / backlog)
- **Status:** Decided, not yet implemented. Decision recorded in **`docs/EMAIL_INFRASTRUCTURE.md`**.
- **What:** Established the email infrastructure approach that will underpin multiple features: self-service password reset (CR-095b), household invites (CR-095a), staff provisioning (PRD §20), timesheet notifications, and budget alerts (CR-102).
- **Decision:**
  - Use **nodemailer** with standard SMTP — no vendor SDK in the codebase; provider is swapped by changing env vars.
  - **Recommended providers:** Resend (free, purpose-built transactional email, best deliverability) as production default; Gmail App Password as the easy personal setup path.
  - **6 new env vars** (all optional until first email feature ships): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
  - Email-dependent routes degrade gracefully when SMTP is not configured — admin-reset flow remains available as fallback.
- **Expected volume:** 10–20 emails/month today; up to ~500/month when Phase 3 ships. Both recommended providers' free tiers comfortably cover this.
- **Files:** `docs/EMAIL_INFRASTRUCTURE.md` (new)

---

### CR-095b — Self-service forgot password via email reset link (BACKLOG SPEC)

- **Type:** CR (backlog — Medium priority, Medium complexity)
- **Status:** Not yet implemented. Full spec in **`docs/EMAIL_INFRASTRUCTURE.md`**. Prerequisite: CR-106 (SMTP config).
- **Problem:** Currently "Forgot password?" shows a tip to ask the household admin. This works for members but not for the owner themselves (no one to ask). Also blocks any future self-managed user onboarding.
- **Approach:** Standard email-based time-limited token reset (not OAuth, not SMS). Admin-reset flow (Settings → Members) stays in place and is not replaced.
- **New DB table:** `password_reset_token` — token_hash (SHA-256 of raw token, never stored plain), user_id FK, expires_at (1 hour), used_at. One active token per user; creating new one invalidates prior tokens.
- **New mailer module:** `backend/src/modules/mailer/` — nodemailer transport, `sendMail()` wrapper (best-effort, returns `{ ok }` not throws), password-reset email template.
- **New API routes:**
  - `POST /auth/forgot-password` — unauthenticated; body `{ email }`; always `200` (no user enumeration); rate-limited 3/15min/IP.
  - `POST /auth/reset-password` — unauthenticated; body `{ token, newPassword }`; validates token (exists, unexpired, unused); sets new password, bumps token_version (invalidates all sessions).
- **Frontend changes:**
  - Login page "Forgot password?" shows email input form when SMTP is configured; keeps current admin tip when SMTP is absent.
  - New `/reset-password?token=...` page — new password + confirm fields; success → login with confirmation message.
- **Security:** raw token = 32 bytes base64url (43 chars); only SHA-256 hash in DB; single-use; 1-hour expiry; constant-time compare; no enumeration in responses.
- **Why not OAuth/social login:** OAuth is a parallel auth system (different feature, much higher architectural cost). Email reset is the correct minimal solution for this use case. Social login is a potential Phase 4 consideration only.
- **Files to create/modify when implemented:** `backend/db/migrations/0023_password_reset_token.sql`, `backend/src/modules/mailer/mailer.service.ts`, `mailer.types.ts`, `templates/password-reset.ts`, `backend/src/modules/auth/auth.routes.ts`, `backend/src/modules/auth/auth.service.ts`, `frontend/src/pages/HomePage.tsx`, new `frontend/src/pages/ResetPasswordPage.tsx`, `docs/ENVIRONMENT_VARIABLES.md`, `openapi/openapi.yaml`

---

## 2026-04-12

### DOC-081 — Full doc audit: budget API gap, CLAUDE.md stale module table + schema, import summary CR-080 accuracy
- **Type:** DOC
- **What:** Comprehensive audit of all documentation against shipped CRs (git log back 70+ commits). Gaps found and fixed:
  1. **`openapi/openapi.yaml`** — `budget` tag and all four `/budget/*` paths (`GET /budget/suggest`, `GET /budget/months`, `GET /budget/:month`, `PUT /budget/:month`) were entirely absent. Added with full request/response schemas.
  2. **`docs/API_BUDGET.md`** — File did not exist. Created new API guide covering suggestions, month list, budget GET, budget PUT, parent-level rollup semantics, and schema.
  3. **`docs/API_INDEX.md`** — `API_BUDGET.md` link was missing. Added.
  4. **`CLAUDE.md` module table** — `budget/` module row was absent (14th module). Added with key files and responsibility summary.
  5. **`CLAUDE.md` schema highlights** — `budget_category` and `import_job` tables were not listed; latest migration pointer was stale (`0007` — now `0012`). All corrected.
  6. **`docs/API_IMPORT_SESSIONS.md`** — `nearDuplicatesFlagged` and `notPostedExactDuplicateOrSkipped` descriptions were stale after CR-080. Updated: `canonicalRowCount` now explicitly includes `status='duplicate'` rows; `nearDuplicatesFlagged` now covers both exact and near duplicates; `notPostedExactDuplicateOrSkipped` formula note updated (exact duplicates cancel in the formula after CR-080).
- **Files:** `openapi/openapi.yaml`, `docs/API_BUDGET.md` (new), `docs/API_INDEX.md`, `CLAUDE.md`, `docs/API_IMPORT_SESSIONS.md`.

### FIX-073 — Startup warning when SPA is skipped (`MODE` / missing `frontend/dist`)
- **Type:** FIX / DX
- **What:** When **`NODE_ENV=production`** but **`MODE≠PROD`**, log a **warn** that the SPA is not served (common when **`--env-file .env`** overrides the image and `.env` has **`MODE=TEST`**). When **`MODE=PROD`** but **`frontend/dist`** is missing, log a **warn** linking to **Cannot GET /**. [`docs/PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) Compose **`docker run`** example now includes **`-e MODE=PROD`** and explains **`MODE=TEST`** vs SPA.
- **Files:** `backend/src/server.ts`, `docs/PRODUCTION_SETUP.md`.

### DOC-071 — Docker run: Compose network + `DATABASE_HOST=postgres`
- **Type:** DOC
- **What:** Added [`docs/PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) subsection *App container + Postgres from Compose* — **`127.0.0.1` inside a container**, **`--network <project>_default`**, **`DATABASE_HOST=postgres`**, port **5432** vs host **5433**, **`DATABASE_SSL=0`**, **`host.docker.internal`** alternative. [`CLAUDE.md`](../CLAUDE.md) Local Postgres note: host **`npm run dev`** vs container **`docker run`** DB addressing.
- **Files:** `docs/PRODUCTION_SETUP.md`, `CLAUDE.md`.

### DOC-070 — Production setup: Postgres-only, Docker lifecycle, Koyeb Dockerfile path
- **Type:** DOC
- **What:** Rewrote [`docs/PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md): removed stale SQLite / wrong migration paths; documented **image vs `docker run`**, **`--env-file`** / mounted `.env`, **volume** for `data/`, **amd64 buildx** note; **migrations** (auto on app start, ship in image → rebuild on schema change) vs **bootstrap seeds** (once via `npm run db:seed`, not idempotent on repeat); Koyeb **Dockerfile** vs **buildpack** table retained and corrected. Aligned [`docs/RUNBOOK.md`](RUNBOOK.md) §4–5, §7 Koyeb pointer, §10 DB confirmation, §11 with Postgres + **`PRODUCTION_SETUP`** (removed SQLite **`print-db-path`** guidance there). Updated [`CLAUDE.md`](../CLAUDE.md) repo tree (**`Dockerfile`** / **`.dockerignore`**), **Production Deployment** (Docker vs bare Node, migration/seed contract), and documentation index.
- **Files:** `docs/PRODUCTION_SETUP.md`, `docs/RUNBOOK.md`, `CLAUDE.md`.

### CR-080 — Exact duplicate transactions surfaced in Needs Review instead of silent drop
- **Type:** CR / Backend / Frontend
- **What:** Previously, when a bank export file was re-imported, exact-fingerprint or FITID duplicates were silently skipped — the user had no way to know the file had already been imported. Under CR-080 each exact duplicate is instead inserted into `transaction_canonical` with `status = 'duplicate'` and a linked `resolution_item(type = 'duplicate_ambiguity', kind = 'exact_duplicate')` so it surfaces in the **Needs Review** tab for the user to either:
  - **Resolve (keep)** — the resolution flag is closed, canonical promoted to `'posted'` with a fresh fingerprint (the original dedup fingerprint remains on the first import's row so future re-imports still detect it).
  - **Trash (discard)** — standard trash action sets `status = 'trashed'` and closes all linked flags.
- **Schema (migration 0012):** The global fingerprint unique index `uq_transaction_canonical_fingerprint` is narrowed to a partial index (`WHERE status NOT IN ('duplicate', 'trashed')`). This allows a `'duplicate'` row to share a fingerprint with the existing `'posted'` row while still preventing accidental double-inserts of live transactions.
- **Dedup idempotency guard:** A new early check (before FITID/fingerprint comparison) detects if the raw row already has any canonical at `source_ref = 'raw:' || raw_id`. This keeps repeated `canonicalize` calls idempotent — re-canonicalizing a session still returns `duplicates = N` without inserting new rows.
- **In-session dedup** (same file uploaded twice in one session) still silently continues — only cross-session (DB-persisted) duplicates are surfaced.
- **Review label:** `status = 'duplicate'` rows show **"Exact duplicate"** in the Needs Review "Why" column. The review-type filter dropdown label changed from "Near-duplicate" to "Duplicate" (covers both exact and near).
- **Resolve promote logic:** `POST /resolution/bulk` and `PATCH /resolution/:id` — when resolving a `duplicate_ambiguity` item, an UPDATE now promotes any linked `status = 'duplicate'` canonical to `'posted'` (with fingerprint reassignment) before closing the flag.
- **Files:** `0012_exact_duplicate_review.sql` (new), `canonical-ingest.service.ts`, `resolution.service.ts`, `ledger.service.ts`, `TransactionsPage.tsx`, `backend/tests/app.test.ts`.

### UX-067 — Budget: hierarchical grouped form + transaction UX polish
- **Type:** UX / Frontend / Backend
- **What:**
  1. **Budget grouped by parent** — Suggestions and edit form now group leaf categories under their parent (Food, Home, Shopping…). Each group defaults to a single "lump sum" input for the parent category. A ▼ button expands to individual sub-category rows with their own inputs; ▲ collapses back and sums amounts. Backend: `parentId` added to `BudgetSuggestionRow`. `getBudgetWithActuals` refactored to handle parent-level entries — spent rolls up all child transactions.
  2. **Exclude noise categories** — Transfers, Income, and Investments are excluded from budget suggestions (financial-flow categories, not household spending). Still addable manually via the "Add a category" picker.
  3. **Rule match hint hidden from All tab** — `CategoryClassificationHint` (rule name / confidence) now only renders in the Needs Review tab where it is relevant. On the All tab it cluttered the category column.
  4. **Review type filter inline** — The "Review types" MultiSelect was in its own row above the filter bar. Moved it as the first field in the main filter row, visible only on the Needs Review tab.
- **Design:** Each parent group is a single budgeted unit (lump sum) or a set of leaf units (detailed); the two modes are mutually exclusive per group to avoid double-counting. Actuals: parent entry → sum all children's spend; leaf entry → direct lookup. Unbudgeted spend excludes transactions covered by a parent-level entry.
- **Files:** `budget.service.ts`, `BudgetPage.tsx`, `TransactionsPage.tsx`.

### CR-079 — Monthly budget per category
- **Type:** CR / Backend / Frontend
- **What:** First-class budgeting feature. Per-month, per-category budgets with actual-spend tracking and pre-populated suggestions from last month's activity.
  1. **Migration 0011:** `budget_category` table — `(household_id, category_id, month YYYY-MM, amount)` with a unique constraint on `(household_id, category_id, month)` so each category gets at most one budget entry per month. Per-month rows preserve history: changing April's budget never touches March.
  2. **Budget suggestions (`GET /budget/suggest?month=YYYY-MM`):** Returns active categories (debit spend, no transfer-linked rows, last 3 months) sorted by heaviest last-month spender first. Each row carries `suggestedAmount` (last calendar month actual when > 0, else 3-month average), `basis`, `lastMonthActual`, and `threeMonthAvg`. Pre-populates the setup form so the user has a realistic starting point.
  3. **Budget view (`GET /budget/:month`):** Returns `exists` flag, summary (totalBudgeted / totalSpent / remaining / unbudgetedSpend), and per-category rows with `budgeted`, `spent`, `remaining`, `percentUsed`. Unbudgeted spend (outflows in categories not in the budget) is surfaced separately.
  4. **Save budget (`PUT /budget/:month`):** Full replace — deletes all entries for the month and inserts the provided set in a transaction. Returns the saved budget with actuals.
  5. **History (`GET /budget/months`):** Lists months with budgets (newest first) for future navigation.
  6. **Frontend `BudgetPage`:** Two modes — setup form (when no budget exists) shows editable table pre-populated from suggestions with last-month actual in a reference column; progress view shows progress bars per category (green < 80%, amber 80–99%, red ≥ 100%), three summary KPI cards, remaining/over amounts, and a drill-through link to Transactions filtered by category + month. Month nav (‹ ›) lets the user browse history.
  7. **Sidebar:** "Budget" added between Home and Net worth (abbr B).
  8. **Vite proxy:** `/budget` added.
- **Design decisions:** Only leaf categories with recent debit activity are suggested (no blank form); transfer-linked transactions excluded from actuals (same policy as cash-summary); global categories can be budgeted (FK to `category.id` regardless of `household_id`); "Edit budget" in progress view re-populates from current budget amounts (not last month's actuals, since the user already made those decisions).
- **Files:** `0011_budget_category.sql` (new), `backend/src/modules/budget/budget.service.ts` (new), `budget.routes.ts` (new), `app.ts` (+1 router, +1 API prefix), `frontend/src/pages/BudgetPage.tsx` (new), `App.tsx`, `AppSidebar.tsx`, `vite.config.ts`.
- **Post-ship fixes:**
  - **FIX: debit amount sign** — `transaction_canonical` stores debits as negative amounts (canonical convention). Budget suggestions query used `SUM(tc.amount)` and `HAVING SUM(tc.amount) > 0` which always evaluated to negative/false for debits, returning zero suggestions even with hundreds of categorized transactions. Fixed by negating in SQL: `SUM(-tc.amount)`. Same fix applied to `getBudgetWithActuals` `spent` aggregation. (`budget.service.ts`)
  - **FIX: dynamic anchor** — Suggestions were anchored to "calendar month − 1" which returns nothing when imported bank data lags the current date. Switched to `MAX(txn_date)` within a 24-month cap so the anchor tracks actual data rather than the wall clock. Added `dataAsOf` field to the response so the UI can show "Pre-filled from actual spend in **[Month]**". (`budget.service.ts`, `budget.routes.ts`, `BudgetPage.tsx`)
  - **FIX: LEFT JOIN categories** — After a household restore, transactions can reference deleted custom category IDs (dangling FK). An `INNER JOIN` silently drops those rows; switched to `LEFT JOIN` and filter `category_name IS NOT NULL` to surface only rows with live categories. (`budget.service.ts`)
  - **FIX: setup form race condition + missing add-category** — `SetupForm.entries` initialised via `useState(suggestions ?? [])` ran once at mount before the async suggestion fetch resolved, giving an empty form. Fixed by lifting `entries` state to the parent (`BudgetPage`) and gating render on `setupReady`. Added `AddCategoryRow` picker for categories not already in the list. Nav arrows changed from Unicode `‹›` (invisible in some fonts) to HTML entity `&lt;`/`&gt;`. (`BudgetPage.tsx`)

### DOC-069 — Docs + OpenAPI parity for household ZIP export / restore
- **Type:** DOC
- **What:** Replaced stale OpenAPI **`501`** stub for **`POST /exports/household/import`** with the real multipart restore contract, **`413`**, and **`GET /exports/import/{jobId}`**. Added **`docs/API_EXPORTS.md`** and linked it from **`docs/API_INDEX.md`**. **`docs/USER_GUIDE.md`** (Settings) now mentions backup/restore. **`CLAUDE.md`** export module row + doc table updated. **`docs/archive/MVP_BACKLOG.md`** Story **8.2** marked partial with CR-078 pointer.
- **Files:** `openapi/openapi.yaml`, `docs/API_EXPORTS.md`, `docs/API_INDEX.md`, `docs/USER_GUIDE.md`, `CLAUDE.md`, `docs/archive/MVP_BACKLOG.md`.

### CR-078 v2 — Export ZIP: split-file format (one file per table)
- **Type:** CR / Backend
- **What:** Redesigned the export ZIP to write each table as its own JSON file instead of a single monolithic `household-bundle.json`. Bumped `exportVersion` to 3.
  - **Format:** `manifest.json` + one file per table (e.g. `transactions.json`, `accounts.json`, etc.). Manifest includes a `tables` index: `{ [key]: { file, rows } }`.
  - **Export service:** `queryAllExportTables` returns `TableExport[]`; `runExportJob` iterates and appends each as a named ZIP entry.
  - **Import service:** `readZipEntries` handles v3 (reads per-table files from manifest index) and v1/v2 backward compat (reads `household-bundle.json`, maps legacy bundle keys → new table keys via `legacyMap`). `runImportJob` updated to use `tables: Map<string, Row[]>` from the new `readZipEntries` return type.
- **Why:** A single bundle file is impractical for large datasets — a household with years of transactions could have a single file > 50 MB. Split files allow streaming, partial reads, and easier inspection.
- **Files:** `export-household-bundle.service.ts`, `export-job.service.ts`, `import-household-bundle.service.ts`.

### CR-078 — Full household export + async restore from ZIP backup
- **Type:** CR / Backend / Frontend
- **What:** End-to-end backup and restore feature. Fixes the broken export (404 in dev), completes the bundle, and implements a working async restore.
  1. **Fix 404 (dev):** `/exports` was missing from the Vite dev proxy — added one line to `vite.config.ts`. All dev requests to `/exports/*` now proxy to the backend correctly.
  2. **Export bundle v2:** Added `password_hash` + `token_version` to `app_user` export (required for restore); added three previously-missing tables: `account_balance_snapshot` (net worth history), `payslip_snapshot` (employer payslips), `household_custom_institution` (custom institutions). Fixed incomplete `SELECT` column lists for `financial_account` (was missing `owner_scope`, `owner_person_profile_id`, `default_parser_profile_id`) and `transaction_canonical` (was missing `reference_id` from CR-074). Bumped `exportVersion` to 2.
  3. **Async restore (`POST /exports/household/import`):** Replaced 501 stub with a real async restore pipeline. Accepts a multipart `.zip` upload → queues an `import_job` → `setImmediate` fires the restore → wipes current household data (reverse FK order) → restores all tables in FK-safe order with householdId remapping (bundle's householdId → current instance's householdId). `app_user.token_version` is incremented on restore to invalidate all existing JWTs. `import_file_id` FK references in `account_balance_snapshot` and `payslip_snapshot` are set to NULL (import_file rows are not part of the backup). Returns restore stats (row counts per table) on completion.
  4. **Import job status (`GET /exports/import/:jobId`):** Polling endpoint with `{ status, error, stats }` payload.
  5. **Frontend Settings:** Export section redesigned — shows a persistent download link when ready (replaces unreliable auto-download). New "Restore from backup" section: file picker + "Restore from backup" (danger) button, live status during polling, stats summary on completion, then auto-signs-out after 3 seconds (token invalidated server-side by version bump).
  6. **Migration 0010:** `import_job` table (mirrors `export_job` structure + `stats_json` column).
  7. **FIX:** `canonical-ingest.service.ts` was missing `referenceId` from `PendingCanonInsert` construction (CR-074 oversight). Fixed.
  8. **FIX:** `ofx-parser.ts` `parseOfx2` was using removed cheerio option `lowerCaseTags`. Replaced with cheerio default mode (which also lowercases tags, preserving all OFX 2.x selectors).
- **Restore strategy:** Wipe-then-restore. On a fresh instance: export from source → restore on target. Password hashes are restored verbatim (bcrypt is already one-way). All users are forced to re-login after restore (token_version increment).
- **Backlog:** Add `force_password_reset` flag on app_user for post-restore first-login password change flow.
- **Files:** `vite.config.ts`, `export-household-bundle.service.ts`, `import-household-bundle.service.ts` (new), `exports.routes.ts`, `backend/db/migrations/0010_import_job.sql` (new), `SettingsPage.tsx`, `index.css` (danger button style), `canonical-ingest.service.ts` (bugfix), `ofx-parser.ts` (bugfix).

## 2026-04-11

### CR-076 — New CSV parsers: Discover card + Wealthfront investment
- **Type:** CR / Backend
- **What:** Two new bank adapter parsers to cover statement formats from Discover credit card and Wealthfront investment/savings accounts.
  1. **Discover card CSV (`discover_card_csv`):** Columns `Trans. Date, Post Date, Description, Amount, Category`. Date format MM/DD/YYYY. Sign convention: positive = charge (debit), negative = payment/credit — negated on ingest to match canonical convention. Profile label: "Discover card (CSV)". Inference: `institution.toLowerCase().includes("discover")` + `type === "credit_card"` + `.csv`.
  2. **Wealthfront investment CSV (`wealthfront_investment_csv`):** Columns `Transaction date, Description, Type, Amount`. Date format M/D/YYYY (single-digit month/day supported). Sign convention already canonical (positive = credit/deposit, negative = debit/withdrawal — no negation). Profile label: "Wealthfront savings / investment (CSV)". Inference: `institution.toLowerCase().includes("wealthfront")` + `type ∈ {investment, savings, retirement}` + `.csv`.
- **Why:** Real statement files from live accounts in `data/imports/` had no parsers. Both institution names normalise to "other" in the catalog, so inference uses raw institution string matching rather than the catalog normaliser.
- **Files:** `profiles/discover-card-csv.ts` (new), `profiles/wealthfront-investment-csv.ts` (new), `profiles/profile-ids.ts`, `import-parser.service.ts`, `profileLabels.ts` (frontend), `inferParserProfile.ts` (frontend).
- **Tests added:** `backend/tests/csv-parsers.test.ts` — 11 tests (5 Discover, 6 Wealthfront) covering row count, amount sign, date conversion, description mapping. `frontend/src/import/inferParserProfile.test.ts` — 5 new inference tests.

### CR-077b — Household category rules: second pass from AmEx QFX + Wealthfront CSV
- **Type:** CR / Data
- **What:** Second-pass rules from AmEx QFX and Wealthfront CSV, plus a fix to a first-pass mapping error:
  - **Fix:** `TESLA SUPERCHARGER` reclassified from `Mobility > Fuel` → `Mobility > EV Charging` (that subcategory exists in the DB and is the correct slot)
  - **AmEx QFX patterns:** `AUTOPAY PAYMENT` credit → Transfers > Transfers in (AmEx card self-payment record); `AMEX OFFER CREDIT` credit → Income > Refunds; `DELL` debit → Shopping > Electronic; `NTTA` debit → Mobility > Public Transit (NTTA = North Texas Tollway Authority — description "NTTA AUTOCHARGE" doesn't contain the word "toll" so the builtin `toll` rule doesn't fire); `STATE FARM` debit → Insurance > Auto (no insurance rules existed)
  - **Discover CSV pattern:** `H-E-B` debit → Shopping > Groceries (house rule "HEB" doesn't substring-match "H-E-B" due to dashes); `HULU` debit → Entertainment > Streaming (no streaming rules in builtins or house rules)
  - **Wealthfront CSV patterns:** `(Account ****` credit/debit → Transfers in/out (matches Wealthfront's account-reference format for inter-bank transfers); `GOLDMAN SACHS BANK USA` credit → Transfers > Transfers in (existing rule targets "GOLDMAN SACHS BA DES:P2P" which doesn't match Wealthfront's description format); `Automated Bond Portfolio` debit → Investments > Stocks
- **Skipped (covered):** `[Month] interest` and `Interest payment` → builtin `interest` → Income > Interest already fires; JPMorgan Chase Bank deposits → covered by "(Account ****" rule above
- **Files:** `fixtures/category-import/category-rules-house.csv` (+12 new rules, 1 rule updated).

### CR-077 — Household category rules expansion (live statement patterns)
- **Type:** CR / Data
- **What:** Appended 14 new rules to `fixtures/category-import/category-rules-house.csv` based on patterns from live statements not covered by the 120 global builtin rules. Rules are grouped by category:
  - **Groceries** (ethnic/specialty chains): `INDIA BAZAAR`, `PATEL BROTHERS`, `SWADESHI PLAZA`, `HARELI FRESH MARKET`, `PY *HARELI`, `TOM THUMB` → Shopping > Groceries
  - **EV charging**: `TESLA SUPERCHARGER` → Mobility > Fuel (priority 40, high confidence — specific enough)
  - **Credit card autopay/cashback**: `DIRECTPAY FULL BALANCE` → Transfers > Transfers out (Discover DirectPay); `CASHBACK BONUS REDEMPTION` → Income > Refunds (Discover cashback payout)
  - **FSA/benefits**: `ADVANTAGE FLEX T` → Healthcare > FSA / Benefits
  - **Retail**: `FIVE BELOW` → Shopping > General merchandise
  - **Indian/Asian restaurants**: `GWALIA SWEETS`, `SIMPLY SOUTH`, `ASIAN POT` → Food > Dining out
- **Skipped (already in house rules):** Wealthfront transfers, Goldman Sachs (DES:P2P form), FRONTIER, Fyle, NAVIA BENEFIT, PROTECTIVE LIFE, CITYOFLEWISVILLE, Fundrise rows, PRIMROSE SCHOOL
- **Skipped (covered by global builtins):** kroger, walmart, costco, whole foods, target, starbucks, shell/exxon/chevron, uber/lyft, mcdonald, irs, [month] interest → Income > Interest
- **Files:** `fixtures/category-import/category-rules-house.csv` (+14 rules, first pass).

### CR-075 — Settings: initial balance on account create, retirement account type, institution catalog
- **Type:** CR / Backend / UX
- **What:** Three related improvements to account setup.
  1. **Initial balance on account creation:** Settings → Accounts form now shows two optional fields when adding a new account: "Starting balance" (number) and "Balance as of" (date, defaults to today). On save, if a non-zero balance is provided, `upsertManualBalanceSnapshot` is called to create a manual balance snapshot — the same mechanism used by the Net Worth page. Fields are hidden when editing an existing account (existing balance data is managed via Net Worth). Backend: `accountUpsertSchema` extended with `initialBalance: number | null` and `initialBalanceDate: string | null` (YYYY-MM-DD); `POST /imports/accounts` handler calls `upsertManualBalanceSnapshot` after account creation if non-null.
  2. **Retirement account type:** New `'retirement'` type in `financial_account` (migration `0009`). Covers 401K, IRA, pension accounts. Added to the `accountUpsertSchema` enum and the Settings → Accounts type dropdown as "Retirement (401K / IRA / Pension)".
  3. **Institution catalog expansion:** Added 8 new institutions (alphabetically sorted) to both `frontend/src/import/institutionCatalog.ts` and `backend/src/modules/imports/institution-catalog.ts`: Betterment, Coinbase, E*TRADE, Fundrise, Robinhood, T. Rowe Price, Vanguard, Wealthfront.
- **Why:** Users adding investment, retirement, or crypto accounts had no institutions to pick and no account type for retirement accounts. Starting balance lets new accounts contribute to net worth immediately without needing to import a statement first.
- **Files:** `backend/db/migrations/0009_account_type_retirement.sql` (new), `imports.routes.ts`, `institution-catalog.ts` (backend + frontend), `SettingsPage.tsx`.

### CR-074 — FITID dedup + OFX ledger balance auto-snapshot
- **Type:** CR / Backend / UX
- **What:** Two related improvements to the OFX import pipeline.
  1. **FITID-based deduplication:** Added `reference_id TEXT` column to `transaction_canonical` (migration `0008`) with a partial unique index `(account_id, reference_id) WHERE reference_id IS NOT NULL`. During canonical ingest, if the raw payload carries a `reference_id` (FITID from OFX), a FITID check runs *before* the fingerprint check: if the same `(account_id, reference_id)` already exists in `transaction_canonical`, the row is counted as a duplicate and skipped. A `seenReferenceIdsThisRun` set catches within-batch duplicates. Non-OFX rows (no FITID) are unaffected — the partial index allows unlimited `NULL` reference_ids.
  2. **OFX LEDGERBAL auto-snapshot:** Both OFX 1.x and OFX 2.x parsers now extract `<LEDGERBAL><BALAMT>` and `<LEDGERBAL><DTASOF>`. These fields are stored in `confidence_summary.ofxMeta` at upload time and returned via `GET /imports/sessions/:id/files/:fileId/ofx-suggestion` alongside the account match. During parse (`POST /imports/sessions/:id/parse`), if the OFX file has a non-null ledger balance with a valid ISO date, `upsertImportBalanceSnapshotFromStatement` is called to persist a balance snapshot (source = `ofx_transactions`) — same pathway as BoA CSV/e-statement balance capture. Frontend shows balance info in the OFX account hint: "Balance as of YYYY-MM-DD: $X,XXX.XX (from OFX ledger balance — auto-saved to net worth)".
- **Why:** Without FITID dedup, re-importing an OFX file after minor description edits could insert duplicates (fingerprint = SHA256 of normalised description). FITID is the authoritative dedup key for OFX files. LEDGERBAL is a free balance anchor in every Chase QFX tested — parsing it avoids a manual net-worth entry after each statement import.
- **Files:** `backend/db/migrations/0008_canonical_reference_id.sql` (new), `canonical-ingest.service.ts`, `ofx-parser.ts`, `ofx-account-match.service.ts`, `import-parser.service.ts`, `imports.routes.ts`, `boa-checking-savings-csv.ts` (source union extended), `ImportWorkspacePage.tsx`.
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
- **Schema:** `backend/db/migrations/0007_transaction_canonical_trashed_status.sql` — alters CHECK constraint to include `'trashed'`.
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
- **Files:** [`0006_account_balance_import_unique.sql`](backend/db/migrations/0006_account_balance_import_unique.sql), [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`import-parser.service.ts`](backend/src/modules/imports/import-parser.service.ts), [`app.test.ts`](backend/tests/app.test.ts), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md).

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
- **Files:** [`0005_account_balance_snapshot.sql`](backend/db/migrations/0005_account_balance_snapshot.sql), [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`reports.routes.ts`](backend/src/modules/reports/reports.routes.ts), [`app.test.ts`](backend/tests/app.test.ts), [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`App.tsx`](frontend/src/App.tsx), [`AppSidebar.tsx`](frontend/src/layout/AppSidebar.tsx), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md), [`openapi.yaml`](openapi/openapi.yaml).

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
- **Files:** `backend/db/migrations/0004_payslip_llm_async_hybrid.sql`, `backend/src/config/env.ts`, `backend/src/modules/imports/payslip-async-import-reconcile.service.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/payslip/payslip.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`, `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts`, `backend/tests/payslip-canonical-map.test.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `docs/API_IMPORT_SESSIONS.md`, `docs/PAYSLIP_V1.md`, `.env.example`.

## 2026-04-07

### CR-050 — Deloitte payslips: Unstructured Jobs async pipeline (HTML-first parser), remove local Deloitte parser
- **Type:** CR / FIX / DOC / DB / UX
- **What:** Deloitte profile switched to **Import-only async** processing through Unstructured Jobs (`POST /jobs`, poll status, download JSON). Added `import_file` job-tracking columns (`unstructured_job_id`, `unstructured_input_file_id`, `unstructured_last_poll_at`) and new reconcile endpoint **`POST /imports/sessions/:sessionId/reconcile-unstructured`** (throttled; `force=true` bypass). Added Deloitte parser that reads Unstructured **`Table.metadata.text_as_html`** first (fallback to `Table.text`) and extracts stable totals (`TOTAL GROSS`, `NET PAY`) plus date hints. Removed local `deloitte-payslip-pdf.ts` (`pdf-parse` + IBM-merge heuristic path) to prevent dead code and false positives. Import UI now reports `unstructuredPending`, auto-polls ~2 minutes for pending Deloitte jobs, and adds “Check Unstructured now”.
- **Why:** Real Deloitte PDFs had unusable local text extraction and produced incorrect values with local heuristics; Unstructured output is reliable for these stubs while preserving constrained free-tier usage through fixture-based tests and throttled polling.
- **Files:** `backend/src/modules/imports/unstructured-jobs.service.ts`, `backend/src/modules/imports/unstructured-import-reconcile.service.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/payslip/profiles/deloitte-unstructured-parse.ts`, deleted `backend/src/modules/payslip/profiles/deloitte-payslip-pdf.ts`, `backend/db/migrations/0003_import_file_unstructured.sql` (+ sqlite mirror), `frontend/src/pages/ImportWorkspacePage.tsx`, `docs/PAYSLIP_V1.md`, `docs/API_IMPORT_SESSIONS.md`, `docs/ENVIRONMENT_VARIABLES.md`.

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
