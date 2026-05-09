# V3 Plan — Feature List with Priority

**Compiled:** 2026-05-08. Sources: `V3_BACKLOG.md`, `SECURITY_HARDENING_BACKLOG.md`, `EXPORT_IMPORT_BACKLOG.md`, `RECURRING_PAYMENTS_BACKLOG.md`, post-v2-merge change history, live onboarding sessions.

**Priority tiers:**
- **P1** — Bug or correctness issue; blocks trusted daily use or is a security risk
- **P2** — High-value feature; materially improves the app for regular use
- **P3** — Useful improvement; non-blocking, lower impact or more speculative
- **Deferred** — Explicitly post-V3; noted here for awareness

---

## P1 — Bugs & Correctness

### B-1: Transfer ambiguity — confirm button missing after partial candidate dismissal
When a resolution item has `creditCandidateIds` (plural array) and the user dismisses one, the surviving candidate never gets promoted to `creditId` (singular). Confirm button never appears; pair is unresolvable from the UI.

**Three gaps:**
- Gap 1: After dismissal of one candidate, update surviving item's reason JSON from array → singular `creditId`
- Gap 2: Bulk confirm must handle single-entry `creditCandidateIds` as unambiguous; surface error for multi-entry instead of silently failing
- Gap 3: Bulk confirm gives zero user feedback on failure — toast "Could not confirm X transfers" at minimum

**Files:** `resolution.service.ts`, `canonical-ingest.service.ts`, resolution queue frontend page

---

### B-2: Dismissed transfer items re-surface on every new import
Dismissing "Not a transfer" only closes the resolution item. The canonical row has no memory of the decision. Next import re-detects the same pair and creates a new resolution item. User must re-dismiss on every import cycle.

**Fix:** Add `transfer_excluded BOOLEAN NOT NULL DEFAULT FALSE` to `transaction_canonical`. Set it on dismissal. Transfer detection skips rows where `transfer_excluded = TRUE`. Also add a ledger-level "re-include as transfer candidate" action for corrections.

**DB change:** New migration for `transfer_excluded` column.

**Files:** `canonical-ingest.service.ts`, `resolution.service.ts`, new migration

---

### B-3: Multi-day same-amount transfers create cross-match ambiguity
Two $10k transfers on consecutive days each claim the same two credit candidates. Both produce `transfer_ambiguity` items with identical candidate arrays — even a working Confirm button can't resolve which debit pairs with which credit.

**Fix:** Greedy closest-date pre-assignment pass during ingest. Score all (debit, credit) pairs by date proximity; greedily assign best pairs; remaining ambiguous items get singular `creditId` for one-click confirm. Keep detection window at ±3 days (ACH float). Output is single-candidate confirm, not silent auto-pair.

Also implement: **"Dissolve transfer pair"** action in ledger (when `transfer_group_id IS NOT NULL`) — sets both legs back to `NULL`, re-opens as candidates. Safer than perfecting the algorithm.

**Files:** `canonical-ingest.service.ts`

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

### F-1: Account enrichment — memo, sub_type, liquidity
Adds three nullable columns to `financial_account`:
- `memo TEXT` — free-form note (fed into AI insights for account context)
- `sub_type TEXT` — descriptive sub-classification (UI suggests per type: `401k`, `roth_ira`, `hsa`, `brokerage`, `529`, `able`, `hysa`, `crypto`, etc.)
- `liquidity TEXT CHECK ('liquid','semi_liquid','restricted')` — behavioral tag; inferred by default from type, user-overridable

Liquidity defaults: checking/savings → `liquid`; investment → `semi_liquid`; retirement/real_estate → `restricted`. HSA critical case: `investment + restricted`.

**Also adds:** `linked_account_id TEXT FK → financial_account(id)` (mortgage → property pairing) and `property_use TEXT CHECK ('primary','rental','vacation')` for real_estate.

**DB:** Single migration adding all enrichment columns.

**UI:** Account create/edit form gains memo textarea, sub_type select (suggestions per type), liquidity override toggle.

**Files:** New migration, `household.service.ts`, account-related routes, account form in frontend

---

### F-2: Real estate account type + home equity display
Add `real_estate` to the `type` CHECK constraint. Onboarding flow: structured address fields, property_use toggle, link-to-mortgage dropdown, initial market value entry.

Net worth table equity callout: when a mortgage has `linked_account_id` pointing to a real_estate account, show:
```
Primary Residence    $1,200,000
  └─ Mortgage       -$790,000
  └─ Equity          $410,000
```
Mortgage excluded from standalone liabilities to avoid double-counting in display (math unchanged).

**Optional (store the intent, implement later):** Monthly auto-valuation from RealtyAPI/FreeWebAPI. Requires `property_api_provider` + `property_api_id` columns and `REALTY_API_KEY` env var. Degrades gracefully to manual if absent.

**Files:** New migration (type constraint + real_estate columns), `household.service.ts`, `NetWorthPage.tsx`, account form

---

### F-3: Net worth — liquidity breakdown
Adds a liquidity tier summary beneath the net worth total:
```
Net Worth:     $XXX,XXX
  Liquid:       $XX,XXX   (checking, savings)
  Semi-liquid:  $XX,XXX   (brokerage — days to settle)
  Restricted:   $XX,XXX   (retirement, HSA, 529, real estate)
  Liabilities: -$XX,XXX
```
Computed from `liquidity` field on `financial_account` (F-1 prerequisite). Accounts with no `liquidity` set fall into an "Uncategorized" bucket to prompt tagging.

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

### F-8: Money flow classification in reports (cash summary + budget)
Extend flow classification (F-7) from AI insights to the app's own reports:

**Cash Summary:** Split outflow into `lifestyleSpend` / `wealthBuilding` / `taxObligations` / `moneyMovements`. Compute savings rate on lifestyle only (not total outflow). Split inflow into `trueIncome` / `moneyReturns`.

**Budget page:** Suppress budget progress bars for non-lifestyle categories. Show investment contributions, loans, taxes in a separate "Movements" section or hide from budget overage report.

**⚠ Groom before implementing:** 0.25 vCPU constraint. Solution must be a lookup map on category names at query time. No materialised views, no background jobs, no new tables. Design-review this item before writing code.

**Files:** `cash-summary.service.ts`, `budget.service.ts`, `DashboardPageV2.tsx`, `BudgetPage.tsx`

---

### F-9: Date of birth — encrypted at rest, computed age
`person_profile.age` is a manually-entered integer the user must update every year. Store encrypted DOB instead; compute age automatically.

**Schema:** Add `date_of_birth_encrypted TEXT` to `person_profile`. Keep `age INTEGER` as nullable fallback for profiles without DOB. API never returns raw DOB — only `hasDob: boolean` and computed `age: number | null`.

**Encryption:** AES-256-GCM, same pattern as `gdrive.service.ts`. Key derived from `JWT_SECRET` via `crypto.scryptSync`. Format: `base64(iv[12] + authTag[16] + ciphertext)`.

**UI:** Date picker in profile edit. Age field becomes read-only + auto-computed once DOB is set. Clear DOB returns to manual age input.

**Export:** DOB excluded from `.hfb` exports (PII encrypted with instance-specific key). Restore completion notice should say: "Date of birth for each person must be re-entered."

**Files:** `household.service.ts`, `insight-prompt.service.ts`, new migration, profile settings UI

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
| B-1 | Transfer confirm button missing after partial dismissal | P1 | Bug | — |
| B-2 | Dismissed transfers re-surface on next import | P1 | Bug + DB | — |
| B-3 | Multi-day same-amount transfer cross-match | P1 | Bug | — |
| ~~B-4~~ | ~~Marcus PDF ACH deposits silently dropped~~ | ✓ Done | Bug | — |
| ~~B-5~~ | ~~Import "Belongs To" not auto-set from account~~ | ✓ Done | Bug (FE only) | — |
| ~~B-6~~ | ~~Transactions page: incomplete Mantine + broken subcategory picker~~ | ✓ Done | Bug + UX | — |
| ~~B-7~~ | ~~AI insight cooldown: in-memory → DB-backed~~ | ✓ Done | Security | — |
| F-1 | Account enrichment (memo, sub_type, liquidity, linked_account_id) | P2 | Feature | — |
| F-2 | Real estate account type + home equity display | P2 | Feature | F-1 |
| F-3 | Net worth liquidity breakdown | P2 | Feature | F-1 |
| ~~F-4~~ | ~~Per-account balance history chart (FE only)~~ | ✓ Done | Feature | — |
| F-5 | Payslip deposit matching: stored pairing + improved logic | P2 | Feature | — |
| ~~F-6~~ | ~~Async payslip upload (fix 504 on OpenAI)~~ | → P3/I-2 | Reliability | — |
| F-7 | AI insights: fix transfer/flow pollution | P2 | Feature | — |
| F-8 | Money flow classification in reports | P2 | Feature | F-7 |
| F-9 | Date of birth encrypted at rest, computed age | P2 | Feature + Security | — |
| I-1 | Personal loan tracker | P3 | Feature | F-8 |
| I-2 | Async import parse + canonicalize | P3 | Reliability | — |
| I-3 | Category / reimbursements taxonomy cleanup | P3 | Improvement | F-7/F-8 |
| I-4 | Password reset token periodic cleanup | P3 | Maintenance | — |
| I-5 | Export/restore housekeeping (staging file, GDrive warning) | P3 | Maintenance | — |
| I-6 | Drive query string escaping | P3 | Security hygiene | — |
| I-7 | Recurring payments: annual detection, prediction, per-tx exclusion | P3 | Enhancement | — |
| I-8 | Playwright E2E test suite exploration (spike) | P3 | Testing | — |
| D-1 | Data archival + pre-computed monthly reports | Deferred | Infrastructure | F-8 |
| D-2 | Real estate auto-valuation (market value API) | Deferred | Enhancement | F-2 |
| D-3 | Rental income tracking | Deferred | Feature | F-2 |
| D-4 | Multi-household | Deferred | Architecture | — |
| D-5 | HELOC modeling | Deferred | Feature | F-2 |

---

*Last updated: 2026-05-08. Compiled from all backlog sources at start of v3 planning.*
