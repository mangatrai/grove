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

### F-5: Payslip deposit matching — stored pairing + improved matching logic
Current dynamic-only model loses the confirmed match on every load; flaky for edge cases (split deposits, late ACH, null pay_date).

**Hybrid model:**
1. Dynamic candidates shown as suggestions (existing behavior)
2. "Confirm" button on a candidate → writes `matched_deposit_canonical_id` on `payslip_snapshot` row
3. Subsequent loads use stored match (no re-query); "Unlink" clears it
4. Manual pick: search/select any transaction from ledger (handles split deposits)

**Matching improvements:**
- Date window: ±5 business days instead of ±3 calendar days
- Split deposit support: if no single match, look for same-day credits summing to net pay
- `pay_date` null fallback: use `pay_period_end` ± wider window
- Surface confidence to user (date distance, amount delta)

**DB:** New migration adding `matched_deposit_canonical_id TEXT REFERENCES transaction_canonical(id) ON DELETE SET NULL` to `payslip_snapshot`.

**Files:** `payslip.service.ts`, new migration, `payslip.routes.ts` (PATCH confirm/unlink), `PayslipDetailPage.tsx`

---

### ~~F-6: Async payslip upload (fix 504 on OpenAI calls)~~ → moved to P3 (see I-2)
The import session flow is already async and stateful. The 504 risk on IBM payslip upload is real but has not surfaced as an active problem in practice. Deprioritised in favour of higher-value P2 features. The fix pattern (202/poll using the existing export_job model) is documented in I-2 alongside the import parse/canonicalize case and can be implemented together when the time comes.

---

### F-7: AI insights — fix transfer and flow pollution in spending data
Two gaps in `insight-prompt.service.ts` make LLM spending figures unreliable:
1. Transfer-categorized transactions without `transfer_group_id` pass the `IS NULL` filter and appear in topCategories
2. Credit card payments (checking → credit card) double-count as both outflow and inflow

**Fixes:**
- Add `AND NOT (COALESCE(p.name, c.name) ILIKE '%transfer%')` filter to `topSpendCategories12m` and `flowTotals12m`
- Filter Uncategorized from `topCategories` (move to separate `uncategorizedMonthlyAvg` field)
- Add `dataNote` annotation to LLM prompt context explaining what was excluded

**Bonus (flow classification):** Map top-level category names to flow classes (`true_income`, `lifestyle`, `wealth_building`, `tax`, `movement`). Split `avgMonthlyOutflow` into `lifestyleSpend`, `wealthBuilding`, `taxObligations`, `moneyMovements`. Annotate LLM prompt with separate fields. No schema change needed — category names are the signal. ⚠ Keep compute simple: lookup map at query time only.

**Files:** `insight-prompt.service.ts`

---

### ~~F-10: Transaction aggregation strip (CR-177)~~ ✓ Done (2026-05-11; FIX-177 corrective pass same day)
Live **Summary of filtered results** on Transactions: server-backed totals and breakdowns over the full filtered ledger (not the current page). Replaces the retired Reports page in context.

**Architecture:** True server-side pagination on the list; **`GET /transactions/aggregate`** mirrors list filters (no pagination). Headline money fields use signed `amount` (see `docs/API_LEDGER.md`).

**Backend (shipped):** `categoryIds` / `accountIds` / `ownerPersonProfileIds` plus legacy singular params; **`belongsTo`** (`household` and/or profile UUIDs, precedence over legacy owner scope). Integration tests on aggregate auth, filters, merchant normalization, month buckets.

**Frontend (shipped):** `HierarchicalSearchPicker` multi-select on Transactions (category, account, belongs-to); `TransactionAggregateSummary` strip; `useEffect` + `apiJson` fetch (not React Query). **FIX-177:** parent click selects parent value + children (no “direct” row, no Mantine checkbox in menu); strip headline without duplicate Count cell; plain `$` inflows/outflows; stat `title` tooltips; By month last 6 with cap notice; context stats row.

**Slices (reference):** CR-177-a–d + FIX-177 in `docs/CHANGE_HISTORY.md`.

**Files:** `backend/src/modules/ledger/ledger.service.ts`, `ledger.routes.ts`, `backend/tests/app.test.ts`, `openapi/openapi.yaml`, `docs/API_LEDGER.md`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/components/TransactionAggregateSummary.tsx`

---

### B-8: Settings — Add custom institution uses `window.prompt`
**Settings → Accounts → Institutions → Add institution** still uses a native browser prompt for the name. Rest of the app uses custom modals and Mantine forms.

**Fix:** Inline modal or form consistent with other Settings flows; same validation and household-scoped save behavior.

**Files:** `frontend/src/pages/SettingsPage.tsx`

---

### F-11: Record cash payments (manual ledger entry)
Manual ledger entry requires an **account**; cash outside bank/card imports has no first-class target today.

**Groom before build:** placeholder cash `financial_account` vs explicit **cash** type on enriched accounts (F-1) vs folding into broader multi-account / institution UX. Decide net-worth and cash-summary treatment and whether cash is household-wide or per person.

**Files (TBD):** likely `financial_account` model/seeds, manual transaction UI (`TransactionsPage` / ledger API), possibly `SettingsPage` account creation.

---

### F-8: Money flow classification in reports (cash summary + budget)
Extend flow classification (F-7) from AI insights to the app's own reports:

**Cash Summary:** Split outflow into `lifestyleSpend` / `wealthBuilding` / `taxObligations` / `moneyMovements`. Compute savings rate on lifestyle only (not total outflow). Split inflow into `trueIncome` / `moneyReturns`.

**Budget page:** Suppress budget progress bars for non-lifestyle categories. Show investment contributions, loans, taxes in a separate "Movements" section or hide from budget overage report.

**⚠ Groom before implementing:** 0.25 vCPU constraint. Solution must be a lookup map on category names at query time. No materialised views, no background jobs, no new tables. Design-review this item before writing code.

**Files:** `cash-summary.service.ts`, `budget.service.ts`, `DashboardPageV2.tsx`, `BudgetPage.tsx`

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

### I-1: Personal loan tracker
`loan_event` entity groups related lent/repaid transactions under a named event. Outstanding balance optionally surfaced as informal receivable on net worth.

**Schema:** `loan_event` + `loan_event_transaction` join table (see V3_BACKLOG.md for full design).

**Net worth integration:** Open loan events shown as "Informal Receivables" asset row (user-configurable include/exclude per event).

**AI insights integration:** Transactions tagged to a loan event excluded from lifestyle spending totals; separate `informalLoans` block sent to LLM.

**Priority note:** Category workaround (`Loans > Personal` out, `Income > Reimbursements` in) is viable for now. Build after F-8 flow classification is shipped.

---

### I-2: Async payslip upload + import parse/canonicalize (504 resilience)
Apply the existing 202/poll pattern (proven in export/restore) to the remaining synchronous long-running operations:
- `POST /payslips/upload` (IBM path) — awaits OpenAI synchronously; 504 risk on slow responses
- `POST /imports/sessions/:id/parse` → 202 + jobId
- `POST /imports/sessions/:id/canonicalize` → 202 + jobId

Import session state machine already handles in-progress state; frontend polls session status naturally. Implement together as a single pass when 504s become a live issue.

**Files:** `payslip.routes.ts`, `payslip-parse.service.ts`, `import-session.service.ts`, `import-parser.service.ts`, new job migration

---

### I-3: Category / reimbursement taxonomy cleanup
- Rename or restructure `Income > Reimbursements`: the "Income" parent is misleading. Consider top-level `Reimbursements & Recoveries` category, classified as `money_return` flow class (not `true_income`).
- Audit global rules: remove/narrow any rule mapping payment methods (Zelle, Venmo, PayPal, CashApp) → Reimbursements. These are too broad.
- Groom alongside F-8 (flow classification) — categories must align with flow class map.

**Files:** `backend/db/seeds/`, category service, potentially new migration to rename global builtin category

---

### I-4: Security — password reset token cleanup
`createPasswordResetToken` deletes *unused* tokens for user before insert. Used/expired tokens are never purged — slow table growth over time.

**Fix:** Add periodic cleanup (inside `purgeExpiredExports` or separate cron):
`DELETE FROM password_reset_token WHERE used_at IS NOT NULL OR expires_at < NOW()`

**Files:** `auth.service.ts`

---

### I-5: Export/restore housekeeping
Two small items from `EXPORT_IMPORT_BACKLOG.md`:
- **Restore staging file not deleted:** Add `fs.unlink(storagePath)` in `finally` block of `runImportJob` after job completion/failure (mirrors `runBackupJob` which already does this).
- **Restore completion UI:** Warn user that GDrive connection is lost after restore (expected — `household_gdrive_config` excluded from `.hfb`). Add notice to restore success message: "Settings → Data → Reconnect Google Drive."

**Files:** `import-household-bundle.service.ts`, restore success UI

---

### I-6: Drive query string escaping
`folderId` interpolated directly into Drive API `q` parameter. DB-sourced so low exploitability, but add guard:
`if (!/^[\w-]+$/.test(folderId)) throw new Error(...)`

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

### UX-166: Consistent currency display — comma-separated thousands everywhere
All dollar values displayed in the app use inconsistent formatting today. `NetWorthPage` already uses `toLocaleString()` (commas present); `PayslipsPage`, `DashboardPageV2`, `ImportWorkspacePage`, `SettingsPage` use raw `toFixed(2)` with no comma separator (e.g. `7305.84` instead of `7,305.84`).

**Fix:** Create a shared `formatUsd(n: number): string` utility (using `toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`). Replace all bare `toFixed(2)` dollar-value calls across ~8 files. Chart tick/tooltip formatters updated in the same pass.

**Note:** Non-dollar `toFixed` calls (KB file sizes, confidence scores, priority values, tolerance percentages) are intentionally excluded.

**Files:** New `frontend/src/utils/format.ts`, `PayslipsPage.tsx`, `DashboardPageV2.tsx`, `ImportWorkspacePage.tsx`, `SettingsPage.tsx`, `PayslipIncomeCharts.tsx`, `PayslipDetailPage.tsx`, `PayslipManualPage.tsx`

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

### UX-167: Cash register input — decimal-first dollar entry
Dollar amount inputs across the app require the user to manually type the decimal point. A fat-finger omission (typing `1002` when intending `100.20`) silently submits the wrong value.

**Fix:** Add `react-currency-input-field` (battle-tested, TypeScript-native, zero custom hook work). Create a thin `CurrencyInput` wrapper that applies Mantine styling. Cash-register behavior (right-to-left digit shifting, always 2 decimal places) comes from the library config — `decimalsLimit={2}` + `fixedDecimalLength={2}`.

**Scope:** Apply only to dollar-value inputs. Excluded: priority, confidence, tolerance percentage, file size, and other non-dollar numeric fields.

**Dollar inputs to update:** manual balance entry (NetWorthPage), salary / initial balance fields (SettingsPage ~5 instances), budget amounts (BudgetPage), payslip manual entry (PayslipManualPage), manual transaction amount (TransactionsPage).

**Prereq:** UX-166 (do in same pass — same files touched).

**Files:** `react-currency-input-field` (new dep), new `frontend/src/components/CurrencyInput.tsx`, `NetWorthPage.tsx`, `SettingsPage.tsx`, `BudgetPage.tsx`, `PayslipManualPage.tsx`, `TransactionsPage.tsx`

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

### D-2: Real estate auto-valuation (market value API)
Monthly background job fetches `account_balance_snapshot` from RealtyAPI / FreeWebAPI using stored `property_api_id`. Requires `REALTY_API_KEY` env var; degrades to manual if absent.

**Why deferred:** Manual entry covers the use case for v3. API integration is nice-to-have; property values don't move meaningfully month-to-month.

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
| B-8 | Settings: Add institution uses `window.prompt` | P2 | Bug + UX | — |
| ~~F-1~~ | ~~Account enrichment (sub_type, memo, liquidity, linked_account_id, health/education types)~~ | ✓ Done | Feature | — |
| ~~F-2~~ | ~~Real estate equity display + value history chart~~ | ✓ Done | Feature | F-1 |
| ~~F-3~~ | ~~Net worth liquidity breakdown~~ | ✓ Done | Feature | F-1 ✓ |
| ~~F-4~~ | ~~Per-account balance history chart (FE only)~~ | ✓ Done | Feature | — |
| F-5 | Payslip deposit matching: stored pairing + improved logic | P2 | Feature | — |
| ~~F-10~~ | ~~Transaction aggregation strip (CR-177 + FIX-177)~~ | ✓ Done | Feature | — |
| F-11 | Record cash payments (manual ledger entry) | P2 | Feature | F-1 (groom) |
| ~~F-6~~ | ~~Async payslip upload (fix 504 on OpenAI)~~ | → P3/I-2 | Reliability | — |
| F-7 | AI insights: fix transfer/flow pollution | P2 | Feature | — |
| F-8 | Money flow classification in reports | P2 | Feature | F-7 |
| ~~F-9~~ | ~~Date of birth encrypted at rest, computed age~~ | ✓ Done | Feature + Security | — |
| I-1 | Personal loan tracker | P3 | Feature | F-8 |
| I-2 | Async import parse + canonicalize | P3 | Reliability | — |
| I-3 | Category / reimbursements taxonomy cleanup | P3 | Improvement | F-7/F-8 |
| I-4 | Password reset token periodic cleanup | P3 | Maintenance | — |
| I-5 | Export/restore housekeeping (staging file, GDrive warning) | P3 | Maintenance | — |
| I-6 | Drive query string escaping | P3 | Security hygiene | — |
| UX-166 | Consistent currency display (comma thousands separator) | P3 | UX polish | — |
| UX-167 | Cash register input for dollar amount fields | P3 | UX polish | UX-166 |
| I-7 | Recurring payments: annual detection, prediction, per-tx exclusion | P3 | Enhancement | — |
| I-8 | Playwright E2E test suite exploration (spike) | P3 | Testing | — |
| D-1 | Data archival + pre-computed monthly reports | Deferred | Infrastructure | F-8 |
| D-2 | Real estate auto-valuation (market value API) | Deferred | Enhancement | F-2 |
| D-3 | Rental income tracking | Deferred | Feature | F-2 |
| D-4 | Multi-household | Deferred | Architecture | — |
| D-5 | HELOC modeling | Deferred | Feature | F-2 |

---

*Last updated: 2026-05-11. All P1 bugs done. F-1, F-2, F-3, F-9, and F-10 (CR-177 + FIX-177) done. Queued: **B-8** (institution add prompt → modal), **F-11** (cash payment recording — groom first). Next: F-5 (payslip deposit stored pairing) or F-7 (AI insights pollution fix).*
