# V3 Plan — Feature List with Priority

**Compiled:** 2026-05-08. Sources: `V3_BACKLOG.md`, `SECURITY_HARDENING_BACKLOG.md`, `EXPORT_IMPORT_BACKLOG.md`, `RECURRING_PAYMENTS_BACKLOG.md`, post-v2-merge change history, live onboarding sessions.

**Priority tiers:**
- **P1** — Bug or correctness issue; blocks trusted daily use or is a security risk
- **P2** — High-value feature; materially improves the app for regular use
- **P3** — Useful improvement; non-blocking, lower impact or more speculative
- **Deferred** — Explicitly post-V3; noted here for awareness

---

## P1 — Bugs & Correctness

### ~~B-1: Transfer ambiguity — confirm button missing after partial candidate dismissal~~ ✓ DELIVERED (FIX-168, 2026-05-10)
Confirm button never appeared because it required `creditId` (singular) in reason JSON but ingest always wrote `creditCandidateIds` (plural array).

**Delivered approach (simpler than originally planned):** Replaced the broken `creditId`-in-JSON confirm path entirely. Ingest now creates resolution items for the **debit only** (not all candidates). `buildResolutionItemRow` live-queries candidate transactions and returns `transferCandidates[]`. UI presents a radio picker — user selects the correct credit, clicks "Confirm transfer pair". One confirm button per item regardless of candidate count. Bulk confirm removed (dead after this redesign). Legacy credit-side items handled gracefully (self-referential candidates filtered out).

---

### ~~B-2: Dismissed transfer items re-surface on every new import~~ ✓ DELIVERED (FIX-168, 2026-05-10)
Canonical row had no memory of the dismissal decision.

**Delivered:** Migration 0040 adds `transfer_excluded BOOLEAN NOT NULL DEFAULT FALSE` to `transaction_canonical`. Dismiss path (`updateResolutionStatusForHousehold` + bulk) sets `transfer_excluded = TRUE` on the debit row. Ingest candidate query adds `AND NOT transfer_excluded`. Note: "re-include as transfer candidate" action not implemented (deferred — uncommon edge case).

---

### ~~B-3: Multi-day same-amount transfers create cross-match ambiguity~~ ✓ DELIVERED (FIX-168, 2026-05-10)
Two same-amount transfers on consecutive days each claimed the same two credit candidates.

**Delivered approach (simpler than originally planned):** No greedy algorithm. The debit-only resolution item model solves this naturally — each debit gets its own item with the full candidate list, and the radio picker lets the user assign the correct credit. First debit to confirm claims the credit; the other debit's item shows "no candidates" on next load. "Dissolve transfer pair" action not implemented (deferred).

---

### ~~B-4: Marcus PDF parser — ACH deposits silently dropped~~ ✓ DELIVERED (FIX-160, 2026-05-08)
ACH deposits with wrapped description text are lost. Only single-line entries (Interest Paid) parse correctly. Root cause: `pdf-parse` doesn't understand columnar layout — description wrapping interleaves with amount columns.

**Fix:** `pendingLine` state machine accumulates date+description lines until ≥2 dollar amounts arrive on a continuation line, then joins and parses. Pre-scan pass extracts Beginning/Ending Balance and Statement Period from the summary block above ACCOUNT ACTIVITY.

**Files:** `backend/src/modules/imports/profiles/marcus-online-savings-pdf.ts`, `backend/tests/pdf-parsers.test.ts`

---

### ~~B-5: Import "Belongs To" not auto-set when account is selected~~ ✓ DELIVERED (FIX-158, 2026-05-08)
`onAccountChange` reads `ownerScope` from draft state instead of from the selected account object. OFX auto-detect has the same bug (uses role-based logic, ignores account's own `owner_scope`).

**Fix (frontend-only, already fully diagnosed):** In `onAccountChange` at all three branches (~lines 771, 803, 826) and the OFX auto-bind block (~line 495): read `account.owner_scope` / `account.owner_person_profile_id` first; fall back to draft.

**Files:** `frontend/src/pages/ImportWorkspacePage.tsx`

---

### ~~B-6: Transactions page — incomplete Mantine migration + non-clickable subcategory picker~~ ✓ DELIVERED (FIX-159, 2026-05-08)
Category picker still uses custom CSS. Group/sub-group alert uses custom class. In Needs Review tab, "Add subcategory" is not clickable (z-index / pointer-events / focus-trap bug from partial migration).

**Fix:** Complete Mantine migration on TransactionsPage (category picker → Mantine `Select`/`Combobox`, alert → Mantine `Alert`). Diagnose and fix the non-clickable subcategory picker in Needs Review.

**Files:** `frontend/src/pages/TransactionsPage.tsx`

---

### ~~B-7 (Security P1): AI insight cooldown — in-memory → DB-backed~~ ✓ DELIVERED (FIX-164, 2026-05-09)
Rate-limit `Map<householdId, timestamp>` resets on every process restart. Allows unbounded API cost on frequent restarts.

**Fix:** `insight_job` table already existed. Replaced Map with a query for the most recent `created_at` for the household; remaining cooldown computed from that. No migration needed.

**Files:** `backend/src/modules/insights/insights.routes.ts`

---

## P2 — High-Value Features

### ~~F-1: Account enrichment — memo, sub_type, liquidity~~ ✓ DELIVERED (CR-169, 2026-05-10)

**Delivered (expanded from original plan):**
- `sub_type TEXT` — comprehensive two-level hierarchy (9 top-level types × up to 13 subtypes). New types added: `health` (HSA/FSA/HRA/ABLE) and `education` (529/Coverdell/UGMA-UTMA). `mortgage` top-level type removed — now `loan/mortgage_primary|investment|vacation`.
- `memo TEXT` — free-form note fed to AI insights
- `liquidity TEXT CHECK('liquid','semi_liquid','restricted')` — `defaultLiquidity()` auto-sets from type+subtype at save; user can override. Correct edge cases: savings/cd → semi_liquid; investment/stock_options → restricted; health/hsa → semi_liquid.
- `linked_account_id TEXT FK → financial_account(id)` — self-referential, wired for future HELOC→mortgage pairing
- `property_id TEXT FK → property(id)` — links mortgage accounts to property entity (see F-2)
- **UI:** flat `Select` replaced with `HierarchicalSearchPicker` (type → subtype two-pane picker); memo `Textarea`; liquidity override `Select` (clearable, auto label when empty)
- **Data migration:** existing `mortgage` rows → `type='loan', sub_type='mortgage_primary'`
- `balance-sheet.service.ts` + `insight-prompt.service.ts` updated: `health`/`education` classified as assets; `mortgage` references removed

**Files:** `backend/db/migrations/0041_v3_account_enrichment.sql`, `backend/src/modules/imports/import-file-binding.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/reports/balance-sheet.service.ts`, `backend/src/modules/insights/insight-prompt.service.ts`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/NetWorthPage.tsx`, `frontend/src/pages/DashboardPageV2.tsx`

---

### ~~F-2: Real estate account type + home equity display~~ ✓ DELIVERED (CR-169 structural + CR-171 display, 2026-05-10)

**Delivered approach (simpler than originally planned — no `real_estate` account type):**

Original plan added a `real_estate` account type, which created an institution identity problem (no bank = no natural institution). Revised design: property data lives on a dedicated `property` table linked to the mortgage account via FK. No separate asset account needed.

- **`property` table:** `address_line1`, `city`, `state`, `zip`, `country`, `property_use` (`primary`/`rental`/`vacation`), `api_provider`, `api_property_id` (for future valuation API)
- **`property_value_snapshot` table:** time-series market values — mirrors `account_balance_snapshot` pattern. Unique index on `(property_id, as_of_date)`. Upserts on same date rather than creating duplicates.
- **Backend:** `property.service.ts` (new) — full CRUD + value snapshot CRUD. Routes at `GET/POST /household/properties`, `GET/PATCH /household/properties/:id`, `GET/POST /household/properties/:id/values`
- **UI (CR-169):** mortgage accounts in Settings table show a `+ Property` / `Property` button opening a modal with address fields + market value entry. Value creates first snapshot in the time series.
- **UI + API (CR-171):** `GET /reports/balance-sheet` includes `properties[]`, rolls property market values into `totals.assets` / `netWorth`, resolves linked loan balance for equity sub-text. Net worth page shows a **Real Estate** subsection with expand-on-click value history (Recharts) and inline edit for new snapshots.

**Deferred:** Real estate auto-valuation API integration → **D-2**.

**Files:** `backend/db/migrations/0041_v3_account_enrichment.sql`, `backend/src/modules/household/property.service.ts` (new), `backend/src/modules/household/household.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `backend/src/modules/reports/balance-sheet.service.ts`, `frontend/src/pages/NetWorthPage.tsx`

---

### ~~F-3: Net worth — liquidity breakdown~~ ✓ DELIVERED (CR-171, 2026-05-10)

Adds a liquidity tier summary on the net worth page (between KPI cards and trend chart): **Liquid**, **Semi-liquid**, **Restricted**, and **Uncategorized** (with link to Settings → Accounts). Computed from `liquidity` on each asset row returned by the balance sheet API; property market values are always counted as **restricted**. Shown when at least one asset has a non-null liquidity tag or any property has a market value.

**Files:** `balance-sheet.service.ts`, `NetWorthPage.tsx`

---

### ~~F-4: Net worth — per-account balance history chart (expand-on-click)~~ ✓ DELIVERED (CR-161, 2026-05-09)
Click an account row in the net worth table → inline expand reveals a Recharts LineChart of that account's balance over time. Backend API (`GET /reports/balance-sheet/history?accountIds=X`) already fully built. Frontend-only feature.

Edge cases: 1-2 snapshots → flat line or placeholder; 0 snapshots → no expand offered.

**Files:** `frontend/src/pages/NetWorthPage.tsx`

---

### ~~F-5: Payslip deposit matching — stored pairing + improved matching logic~~ ✓ Done (CR-185, 2026-05-14)

**Delivered:** `payslip_deposit_match` join table (1-to-N per payslip, supports split deposits across multiple transactions/accounts). `GET /payslips/:id` returns `confirmedDeposits` (join table) and `suggestedDeposits` (dynamic, only when confirmed is empty). `PUT /payslips/:id/deposits/:canonicalId` adds a confirmed link (idempotent). `DELETE /payslips/:id/deposits/:canonicalId` removes one. Dynamic search window expanded from ±3 to ±7 calendar days; `pay_period_end` fallback (±10 days); `tc.status = 'posted'` filter added; `dateDelta`/`amountDelta` confidence fields on every deposit row. UI: confirmed deposits show with Remove buttons; suggestions show with Confirm + confidence annotation; "Search ledger…" opens a modal for manual linking with multi-select support.

**Files:** `backend/db/migrations/0045_f5_payslip_deposit_match.sql`, `payslip.service.ts`, `payslip.routes.ts`, `frontend/src/payslip/types.ts`, `frontend/src/pages/PayslipDetailPage.tsx`

---

### ~~F-6: Async payslip upload (fix 504 on OpenAI calls)~~ → moved to P3 (see I-2)
The import session flow is already async and stateful. The 504 risk on IBM payslip upload is real but has not surfaced as an active problem in practice. Deprioritised in favour of higher-value P2 features. The fix pattern (202/poll using the existing export_job model) is documented in I-2 alongside the import parse/canonicalize case and can be implemented together when the time comes.

---

### ~~F-7: AI insights — fix transfer and flow pollution in spending data~~ ✓ Done

---

### ~~F-10: Transaction aggregation strip (CR-177)~~ ✓ Done (2026-05-11; FIX-177 corrective pass same day)
Live **Summary of filtered results** on Transactions: server-backed totals and breakdowns over the full filtered ledger (not the current page). Replaces the retired Reports page in context.

**Architecture:** True server-side pagination on the list; **`GET /transactions/aggregate`** mirrors list filters (no pagination). Headline money fields use signed `amount` (see `docs/API_LEDGER.md`).

**Backend (shipped):** `categoryIds` / `accountIds` / `ownerPersonProfileIds` plus legacy singular params; **`belongsTo`** (`household` and/or profile UUIDs, precedence over legacy owner scope). Integration tests on aggregate auth, filters, merchant normalization, month buckets.

**Frontend (shipped):** `HierarchicalSearchPicker` multi-select on Transactions (category, account, belongs-to); `TransactionAggregateSummary` strip; `useEffect` + `apiJson` fetch (not React Query). **FIX-177:** parent click selects parent value + children (no “direct” row, no Mantine checkbox in menu); strip headline without duplicate Count cell; plain `$` inflows/outflows; stat `title` tooltips; By month last 6 with cap notice; context stats row.

**Slices (reference):** CR-177-a–d + FIX-177 in `docs/CHANGE_HISTORY.md`.

**Files:** `backend/src/modules/ledger/ledger.service.ts`, `ledger.routes.ts`, `backend/tests/app.test.ts`, `openapi/openapi.yaml`, `docs/API_LEDGER.md`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/components/TransactionAggregateSummary.tsx`

---

### ~~B-8: Settings — Add custom institution uses `window.prompt`~~ ✓ DELIVERED (FIX-B8, 2026-05-12)
**Settings → Accounts → Institutions → Add institution** still uses a native browser prompt for the name. Rest of the app uses custom modals and Mantine forms.

**Delivered:** Cursor replaced `window.prompt` with a Mantine modal. Follow-up fix: modal was rendering behind the `HierarchicalSearchPicker` dropdown portal (`zIndex: 1300`). Fixed by extending `HierarchicalSearchPicker`'s `footer` prop to accept a render function `(close: () => void) => ReactNode`; the "Add institution" button now calls `close()` before opening the modal, dismissing the picker overlay first.

**Files:** `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/pages/SettingsPage.tsx`

---

### ~~F-11: Record cash payments (manual ledger entry)~~ ✓ DELIVERED (CR-183, 2026-05-12)

**Delivered:** New `cash` account type — reuses the existing account + manual ledger entry + `account_balance_snapshot` stack.
- `"Cash & Wallet"` built into the institution catalog (no custom institution needed)
- `type='cash'` → `defaultLiquidity='liquid'`; `accountSide='asset'` → appears on net worth balance sheet
- AI insights rolls cash into `checkingSavingsTotal`
- Flow: Settings → Add account → Institution: "Cash & Wallet" → Type: Cash → set initial balance → record payments as manual debit transactions

**Files:** `backend/db/migrations/0043_cash_account_type.sql`, `imports.routes.ts`, `import-file-binding.service.ts`, `balance-sheet.service.ts`, `insight-prompt.service.ts`, `institution-catalog.ts` (both), `SettingsPage.tsx`

---

### ~~F-8: Money flow classification in reports (cash summary + budget)~~ ✓ Done

---

### ~~F-9: Date of birth — encrypted at rest, computed age~~ ✓ Done (CR-173, 2026-05-10)
`person_profile.age` was a manually-entered integer the user had to update every year. DOB is now stored encrypted and age is computed on read.

**Schema:** Migration **0042** adds `date_of_birth_encrypted TEXT` to `person_profile`. The existing `age INTEGER` column stays as a fallback for profiles without DOB. Own-profile responses (`GET/PATCH /household/profile`) return decrypted `dateOfBirth`; member-list/detail responses return only `hasDob: boolean` and computed `age: number | null`.

**Encryption:** AES-256-GCM in **`backend/src/modules/household/dob-crypto.ts`**. Key = `SHA-256("household-finance:dob:" + JWT_SECRET)` — same derivation pattern as `gdrive.service.ts` token encryption. Format: `base64(iv[12] || authTag[16] || ciphertext)`. `decryptDob` returns `null` on any failure.

**UI:** **`SettingsPage.tsx`** profile tab swaps the age `NumberInput` for a DOB date picker. When DOB is set: date input + computed age display + "Clear DOB" button. When DOB is unset: date picker placeholder + manual age fallback input. Save sends `dateOfBirth` unconditionally; manual `age` is only sent when no DOB is set.

**Export:** **`export-registry.ts`** has an `onExport` hook on the `person_profile` entry that strips `date_of_birth_encrypted` before `.hfb` export. The encryption key is instance-specific (depends on `JWT_SECRET`), so re-entering DOBs after a restore is required.

**AI insights:** **`insight-prompt.service.ts`** decrypts DOB and computes effective age (DOB-first, manual fallback) for both household-level (head + spouse) and personal prompt input.

**Files:** `backend/db/migrations/0042_person_profile_dob.sql` (new), `backend/src/modules/household/dob-crypto.ts` (new), `household.service.ts`, `household.routes.ts`, `insight-prompt.service.ts`, `export-registry.ts`, `SettingsPage.tsx`

---

## P3 — Useful Improvements

### ~~I-1: Personal loan tracker~~ ✓ DELIVERED (I-1, 2026-05-14)

**Decision:** Full loan event tracker (schema + UI) scoped down. Category-based tracking is sufficient: both outgoing and incoming sides of informal lending are tagged `Loans > Personal` — they net out over time. No new schema or UI required.

**Delivered:** AI insights system prompt updated (`llm-provider.service.ts`) to explain `Loans > Personal` = informal cash lending to friends/family, not discretionary spending or a bank obligation. Prevents the LLM from misreading a lend/repay cycle as a spending spike + income bump. `PROMPT_VERSION` bumped to `v1.2`.

---

### I-2: Async payslip upload + import parse/canonicalize (504 resilience)
Apply the existing 202/poll pattern (proven in export/restore) to the remaining synchronous long-running operations:
- `POST /payslips/upload` (IBM path) — awaits OpenAI synchronously; 504 risk on slow responses
- `POST /imports/sessions/:id/parse` → 202 + jobId
- `POST /imports/sessions/:id/canonicalize` → 202 + jobId

Import session state machine already handles in-progress state; frontend polls session status naturally. Implement together as a single pass when 504s become a live issue.

**Files:** `payslip.routes.ts`, `payslip-parse.service.ts`, `import-session.service.ts`, `import-parser.service.ts`, new job migration

---

### ~~I-3: Category / reimbursement taxonomy cleanup~~ ✓ DELIVERED (I-3, 2026-05-14)

**Decision:** No structural rename — `Income > Reimbursements` stays under Income. Employer per diems and FSA reimbursements are genuine cash-positive events; treating them as income-adjacent inflow is correct for this household. Zelle rule removed (too broad; manual resolution is cleaner for P2P).

**Delivered:**
- Builtin rules fixed: shell/exxon/chevron/bp → `Mobility > Fuel`; parking/toll → `Mobility > Parking & Tolls` (migration `0044_i3_rule_taxonomy_fix.sql` + seed)
- Household rule master CSV (`fixtures/category-import/category-rules-house.csv`) fully audited and updated: `APPLE` → `APPLE STORE` (fixes 40 Apple Pay miscategorizations); `DIRECTPAY FULL BALANCE` consolidated to `any`; synced 6 rules that existed in DB but were missing from master file (FLEX PLAN, Rental Prop loan servicers); added 12 new rules (energy vendors, cruise lines, EV charging, AMC, DESI MANDI)
- `Bonds` and `Rental Prop` custom categories added to bootstrap seed and `categories.csv` fixture

**Files:** `backend/db/migrations/0044_i3_rule_taxonomy_fix.sql`, `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/category-rules-house.csv`, `fixtures/category-import/categories.csv`

---

### ~~I-4: Security — password reset token cleanup~~ ✓ DELIVERED (I-4, 2026-05-12)

`purgeStalePasswordResetTokens` runs on the existing hourly export purge schedule.

**Files:** `auth.service.ts`, `export-job.service.ts`

---

### ~~I-5: Export/restore housekeeping~~ ✓ DELIVERED (I-5, 2026-05-12)

- Restore staging `.hfb` deleted in `runImportJob` `finally`.
- Successful restore UI warns to reconnect Google Drive under Settings → Data → Backup.

**Files:** `import-household-bundle.service.ts`, `BackupRestoreSection.tsx`

---

### ~~I-6: Drive query string escaping~~ ✓ DELIVERED (I-6, 2026-05-12)

`listHfbFilesInFolder` validates `folderId` with `^[\w-]+$` before Drive `q` interpolation.

**Files:** `gdrive-backup.service.ts`

---

### I-8: Playwright end-to-end test suite exploration
The app has 400+ backend integration tests (Vitest + supertest) but no browser-level test coverage. UI bugs like the ones found in V3 (broken subcategory picker, delta cards, broken expand chart) would be caught earlier with E2E tests that drive a real browser.

**Scope for exploration:**
- Evaluate [Playwright](https://github.com/microsoft/playwright) (Microsoft, TypeScript-native, supports Chromium/Firefox/WebKit, built-in trace viewer)
- Spike: auth flow, import session creation, ledger category assignment, net worth balance entry
- Decision point: how to handle local Postgres setup (reuse Docker Compose) and whether to run in CI or locally only
- Timebox to a spike — full coverage is a multi-sprint effort; the goal is proving out the framework and toolchain before committing

**Why P3 (not deferred):** Reliability gap is visible in V3. Worth scheduling once P1/P2 are stable rather than post-V3.

---

### ~~UX-166: Consistent currency display — comma-separated thousands everywhere~~ ✓ DELIVERED (UX-166, 2026-05-12)

**Delivered:** Shared `formatUsd` utility; dollar `toFixed(2)` display replaced in payslips, dashboard, import reconciliation, settings recurring anchor, and payslip chart/detail/manual views.

**Files:** `frontend/src/utils/format.ts`, `PayslipsPage.tsx`, `DashboardPageV2.tsx`, `ImportWorkspacePage.tsx`, `SettingsPage.tsx`, `PayslipIncomeCharts.tsx`, `PayslipDetailPage.tsx`, `PayslipManualPage.tsx`

---

### ~~UX-167: Cash register input — decimal-first dollar entry~~ ✓ DELIVERED (UX-167, 2026-05-12)

**Delivered:** `CurrencyInput` wrapper around `react-currency-input-field` (two fixed decimals, Mantine `Input.Wrapper`); wired into net worth balance, Settings dollar fields, budget amounts, payslip manual dollar fields, and manual transaction amount.

**Files:** `frontend/src/components/CurrencyInput.tsx`, `NetWorthPage.tsx`, `SettingsPage.tsx`, `BudgetPage.tsx`, `PayslipManualPage.tsx`, `TransactionsPage.tsx`

---

### ~~UX-175: Forest Studio prompt #2 — dashboard badges, fsForest sweep, fsGold alerts, sidebar brand, ranked spending bars~~ ✓ DELIVERED (CR-175, 2026-05-11)

**Delivered:** Dashboard resolution pills → gray + Tabler icons (no unicode); positive-status `c="green"` / non-banner greens → `fsForest` / CSS var; informational yellow alerts → `fsGold variant="light"` (member-remove data warning stays yellow); collapsed sidebar hides brand entirely; spending card → ranked horizontal bars + `--color-track`.

**Files:** `DashboardPageV2.tsx`, `HomePage.tsx`, `ImportWorkspacePage.tsx`, `PayslipManualPage.tsx`, `PayslipDetailPage.tsx`, `SettingsPage.tsx`, `ResetPasswordPage.tsx`, `TransactionsPage.tsx`, `settings/BackupRestoreSection.tsx`, `AppSidebar.tsx`, `index.css`

---

### ~~UX-176: Forest Studio Phase F — authed shell width cap + Inter Tight typography~~ ✓ DELIVERED (CR-176, 2026-05-11)

**Delivered:** Main column content capped at **1500px** centered under `app-shell-main` while sidebar/topbar layout unchanged; **Inter Tight** on Google Fonts + `--font-heading` for `h1`–`h4` / Mantine `Title` + larger `.kpi-value`; `theme.ts` `headings.sizes` aligned with global CSS.

**Files:** `frontend/index.html`, `frontend/src/index.css`, `frontend/src/theme.ts`

---

### ~~UX-174: Forest Studio — design tokens, terracotta money semantics, grouped nav~~ ✓ DELIVERED (CR-174, 2026-05-10)

**Delivered:** CSS `--fs-*` palette + `chartPalette.ts`; Mantine `fsForest` / `fsTerracotta` / `fsGold`; dashboard / net worth / budget / payslips / transactions badge colors updated; sidebar **Daily / Reports / Setup** groups; warm-cream active nav and topbar accents (replacing mint teal); removed `DashboardPage.tsx` shim in favor of direct `DashboardPageV2` import.

**Files:** `frontend/src/index.css`, `frontend/src/theme.ts`, `frontend/src/theme/chartPalette.ts`, `frontend/src/layout/AppSidebar.tsx`, `HomeRoute.tsx`, `BudgetPage.tsx`, `NetWorthPage.tsx`, `DashboardPageV2.tsx`, `TransactionsPage.tsx`, `PayslipsPage.tsx`, `payslipChartsModel.ts`

---

### I-7: Recurring payments — remaining backlog (Phases 4+)
Phases 1–3 shipped (CR-121/122/123). Remaining deferred items:
- **Annual subscription detection:** Current CV + 2-month gate misses annual charges. Detect single-annual-charge pattern separately.
- **Upcoming bill prediction:** Use confirmed recurring overrides to predict next charge date/amount.
- **Per-transaction exclusion:** Exclude a specific transaction from a confirmed recurring pattern (one-time same-merchant charge).

These are enhancements to the shipped recurring system, not blockers.

---

## Post-V3 (Deferred)

### D-1: Data archival + pre-computed monthly reports
Pre-compute and store `monthly_report` rows at month close. Raw data retention policy (user-configurable window). Enables long-term trend analysis without full-table scans; reduces DB footprint over time.

**Why deferred:** Foundational reporting (F-7/F-8 flow classification) must come first. This is infrastructure that only pays off at 2+ years of data. Design the report schema with archival in mind from the start; don't implement yet.

---

### ~~D-2: Real estate auto-valuation (market value API)~~ ✓ DELIVERED (CR-187/CR-188/CR-189, 2026-05-15)

**Provider:** Redfin via RealtyAPI.io (free tier 250 req/month).
**Backend:** `/properties/preview-valuation` + `/properties/:id/refresh-valuation` + monthly 28-day background scheduler + `ValuationDetail` JSON (AVM estimate+range, last sold, tax history, up to 6 comparable sales with prices/sqft/beds/baths).
**Schema:** `property.api_listing_id`, `property.valuation_detail_json`, `property.valuation_fetched_at` (migration 0046).
**Frontend (all 3 surfaces shipped):**
- Settings property modal: "Retrieve/Update Redfin estimate" button (requires all 4 address fields); auto-fills market value; stores Redfin IDs + full `valuation_detail_json` on save.
- Net Worth inline edit: refresh icon button (`IconRefresh` + hover tooltip) calls stored-ID endpoint, fills edit fields.
**UX polish (CR-189):** Button gate (all 4 address fields required), correct Retrieve vs Update label based on whether value is already set, `valuation_detail_json` now written on property create (was only written on refresh).

---

### D-3: Rental income tracking
Link rent deposits to a rental property account; track expenses (HOA, maintenance), compute ROI. Significant feature thread — v4 candidate. Do not block F-2 (real estate account type) on this.

---

### D-4: Multi-household
Email as canonical identity; `user_household_membership` join table. Fully deferred. Design in `docs/MULTI_HOUSEHOLD_BACKLOG.md`.

---

### D-5: HELOC modeling
Home equity line of credit — hybrid liability. Tentative: `type: credit_card` + `linked_account_id → real_estate`. Needs more design thought before implementation.

---

## Summary Table

| ID | Title | Priority | Type | Prereqs |
|---|---|---|---|---|
| ~~B-1~~ | ~~Transfer confirm button missing after partial dismissal~~ | ✓ Done | Bug | — |
| ~~B-2~~ | ~~Dismissed transfers re-surface on next import~~ | ✓ Done | Bug + DB | — |
| ~~B-3~~ | ~~Multi-day same-amount transfer cross-match~~ | ✓ Done | Bug | — |
| ~~B-4~~ | ~~Marcus PDF ACH deposits silently dropped~~ | ✓ Done | Bug | — |
| ~~B-5~~ | ~~Import "Belongs To" not auto-set from account~~ | ✓ Done | Bug (FE only) | — |
| ~~B-6~~ | ~~Transactions page: incomplete Mantine + broken subcategory picker~~ | ✓ Done | Bug + UX | — |
| ~~B-7~~ | ~~AI insight cooldown: in-memory → DB-backed~~ | ✓ Done | Security | — |
| ~~B-8~~ | ~~Settings: Add institution uses `window.prompt`~~ | ✓ Done | Bug + UX | — |
| ~~F-1~~ | ~~Account enrichment (sub_type, memo, liquidity, linked_account_id, health/education types)~~ | ✓ Done | Feature | — |
| ~~F-2~~ | ~~Real estate equity display + value history chart~~ | ✓ Done | Feature | F-1 |
| ~~F-3~~ | ~~Net worth liquidity breakdown~~ | ✓ Done | Feature | F-1 ✓ |
| ~~F-4~~ | ~~Per-account balance history chart (FE only)~~ | ✓ Done | Feature | — |
| ~~F-5~~ | ~~Payslip deposit matching: stored pairing + improved logic~~ | ✓ Done | Feature | — |
| ~~F-10~~ | ~~Transaction aggregation strip (CR-177 + FIX-177)~~ | ✓ Done | Feature | — |
| ~~F-11~~ | ~~Record cash payments (manual ledger entry)~~ | ✓ Done | Feature | F-1 ✓ |
| ~~F-6~~ | ~~Async payslip upload (fix 504 on OpenAI)~~ | → P3/I-2 | Reliability | — |
| ~~F-7~~ | ~~AI insights: fix transfer/flow pollution~~ | ✓ Done | Feature | — |
| ~~F-8~~ | ~~Money flow classification in reports~~ | ✓ Done | Feature | F-7 ✓ |
| ~~F-9~~ | ~~Date of birth encrypted at rest, computed age~~ | ✓ Done | Feature + Security | — |
| ~~I-1~~ | ~~Personal loan tracker~~ | ✓ Done 2026-05-14 | Prompt update | — |
| I-2 | Async import parse + canonicalize | P3 | Reliability | — |
| ~~I-3~~ | ~~Category / reimbursements taxonomy cleanup~~ | ~~P3~~ | ✓ Done 2026-05-14 | — |
| ~~I-4~~ | ~~Password reset token periodic cleanup~~ | ✓ Done | Maintenance | — |
| ~~I-5~~ | ~~Export/restore housekeeping (staging file, GDrive warning)~~ | ✓ Done | Maintenance | — |
| ~~I-6~~ | ~~Drive query string escaping~~ | ✓ Done | Security hygiene | — |
| ~~UX-166~~ | ~~Consistent currency display (comma thousands separator)~~ | ✓ Done | UX polish | — |
| ~~UX-167~~ | ~~Cash register input for dollar amount fields~~ | ✓ Done | UX polish | UX-166 |
| ~~UX-170~~ | ~~Grove branding — rename all email templates from "Household Finance"~~ | ✓ Done | Branding | — |
| I-7 | Recurring payments: annual detection, prediction, per-tx exclusion | P3 | Enhancement | — |
| I-8 | Playwright E2E test suite exploration (spike) | P3 | Testing | — |
| PS-1 | Payslip MoM comparison: delta badges (net, gross, taxes, deductions vs prior payslip) | P3 | Feature | F-5 |
| PS-2 | Estimated tax sufficiency: annualised withholding rate, safe-harbour flag, non-W2 income callout | P3 | Feature | F-5, parser line-item coverage |
| D-1 | Data archival + pre-computed monthly reports | Deferred | Infrastructure | F-8 |
| ~~D-2~~ | ~~Real estate auto-valuation (market value API)~~ | ✓ Done | Enhancement | F-2 |
| D-3 | Rental income tracking | Deferred | Feature | F-2 |
| D-4 | Multi-household | Deferred | Architecture | — |
| D-5 | HELOC modeling | Deferred | Feature | F-2 |

---

*Last updated: 2026-05-15. **V3 complete.** All P1, P2, and actionable P3 items shipped. Remaining open items deferred to future sprints: I-2 (not a live issue), I-7 (recurring enhancements), I-8 (Playwright spike — between-sprints), PS-1/PS-2 (payslip improvement sprint), D-3/D-4/D-5 (post-V3).*
