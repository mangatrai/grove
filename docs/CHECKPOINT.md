# Development checkpoint

**Last updated:** 2026-04-02 — **CR-044** (MVP closure: connected accounts + member ownership attribution), **CR-043** and prior — see **`docs/CHANGE_HISTORY.md`**.

This file is the **single place** to see what the repo actually does today vs the backlog, and what to do next.  
**Audit trail** of user-driven tweaks, UX passes, and PRD deviations: **`docs/CHANGE_HISTORY.md`**.  
**GitHub tracking:** UX/CR items may also live as issues on **`https://github.com/mangatrai/household-finance-app`** — see **`GitHub:`** / **`GitHub (closed):`** lines on **`docs/CHANGE_HISTORY.md`** entries (e.g. **UX-013** issues **#1–#4** closed with that ship). Close or comment on issues when fixes ship.

### Handoff — next session (2026-04-02)

- **Stable:** **`PATCH /household/settings`** — only **`monthlySavingsTargetUsd`**. Salary deposit + employers — **`GET /household/settings`** (read) + **`PATCH /household/profile`** (write); see **`docs/API_HOUSEHOLD.md`** and **`docs/API_HOUSEHOLD_PROFILE.md`**. Payslip/import employer lists use **`getHouseholdSettings(householdId, userId)`**. Backend **`cd backend && npm test`** — re-run after **`0023_household_custom_institution`**; frontend **`cd frontend && npm run lint`** OK. **API index:** **`openapi/openapi.yaml`**, **`docs/API_INDEX.md`**. **Import automation explainer:** **`docs/IMPORT_CLASSIFICATION.md`**. **Prod DB:** **`docs/PRODUCTION_SETUP.md`** (dev seeds under **`backend/db/seeds/dev/`**).
- **`avatarKey`:** Persisted on profile and now surfaced in **`AppTopBar`** label (emoji + first name) for visible continuity with Settings.
- **Security:** password change now increments **`app_user.token_version`**; existing JWTs are rejected after change (session invalidation behavior).
- **Import reconciliation:** Import session **Outcomes by file** now include warn-only reconciliation diagnostics for profiles that expose running balance; balance detection now covers generic `source_row` balance-like keys (not only literal `balance`) so more parser outputs are covered without blocking import.
- **Review navigation:** Import outcome links now support **file-scoped** drill-down via `GET /transactions?sessionId=...&fileId=...` (and `needsReview=true` variant).
- **Connected accounts + ownership:** Settings now supports manual connected-account onboarding (institution presets/parsers/owner assignment), Import supports file-level owner tagging, Transactions supports owner tagging + owner filters, and Dashboard/Home cash summary supports owner filters with drill-down parity (**CR-044**).
- **Ownership UX wording:** Ownership controls now use **Belongs-to** language with one hierarchical selector (Household + `Household > Member`) across Settings, Import, Transactions/Needs Review, and Dashboard for consistent attribution UX (**UX-011**).
- **Picker UX modernization:** Transactions/Dashboard/Import/Settings now use searchable hierarchy-aware pickers for category/account/belongs-to selection; Transactions row category assignment moved to inline searchable picker (legacy portlet chooser removed) while keeping quick add actions (**UX-012**).
- **Cascade refinement + Add Transaction fixes:** Pickers now support menu/submenu cascade interaction with search, category creation moved to in-picker footer actions, Home scope controls are side-by-side, and Add Transaction now uses money direction + positive amount + required belongs-to with fixed dropdown layering (**UX-013**).
- **MVP close status:** Final P0 checklist run completed including ownership closure slice; no new P0 blockers found in this pass.
- **Good next picks:** (1) Continue **Epic 12** per **`docs/EPIC_12_13_EXECUTION_PLAN.md`** (membership + ownership attribution still backlog-shaped). (2) Post-MVP transfer matcher tuning with real data (Epic 5.2 continuation). (3) Optional performance/code-split pass for frontend bundle warning.
- **Branch note:** Local **`main`** may be **ahead of `origin/main`**; confirm **`git status`** before push/merge.

### Progress legend (used across `docs/`)

| Symbol | Meaning |
|--------|---------|
| ✅ | **Done** — shipped in repo, exercised in tests or manual smoke where noted |
| 🟡 | **Partial** — usable slice exists; backlog lists gaps |
| ⬜ | **Not started** — design/backlog only |

---

## How to run

| Action | Command |
|--------|---------|
| Install + DB + seed | `npm run setup` (repo root) |
| Backend tests | `cd backend && npm test` (runs prep DB + migrations + Vitest) |
| Frontend typecheck | `cd frontend && npm run lint` |
| Dev: API + UI | `npm run services:start` or two terminals: `npm run dev` (backend), `npm run dev:frontend` |

Default **UI:** `http://127.0.0.1:3000` · **API:** `http://127.0.0.1:4000` · See root **`.env`** for `PORT` / `FRONTEND_PORT` / **`MODE`**. Optional **transfer matcher** tuning: **`TRANSFER_*`** (see **`.env.example`** and **`backend/src/config/env.ts`**).

`npm test` in `backend/` runs **`prep-test-db.sh`**, **`db.sh --init --seed`**, then Vitest — it can sit without output for tens of seconds while SQLite is recreated; that is normal. If another process locks the test DB, stop it and retry.

**Migration order:** SQL migrations run **before** seeds. Any migration that inserts rows with `parent_id` to built-in parents must **`INSERT OR IGNORE`** those parents in the migration if they only existed in seed before (see **`0008`** + **FIX-002** in **`docs/CHANGE_HISTORY.md`**).

---

## Implemented (high level)

| Area | Status | What exists |
|------|--------|-------------|
| **Auth** | ✅ | Login, JWT, household-scoped routes; password change invalidates existing sessions via **`app_user.token_version`** check (**`0021`**). |
| **Import** | ✅ | Session → upload → bind account/profile → parse → canonicalize; staging **deleted after successful canonicalize**. **`payslip`** account type + **IBM placeholder** account (**CR-032**) for payslip PDF binding without a bank statement account. **IBM payslip** profile (**`ibm_pay_contributions_pdf`**) → **`payslip_snapshot`** + **`import_file_id`** (**`0015`**); **0** raw rows; payslip-only canonicalize OK (**CR-028**) |
| **Dedupe (Epic 4.2)** | ✅ | `transaction-fingerprint.ts` — stable fingerprint; near-duplicate → **`resolution_item`** (`duplicate_ambiguity`); **`nearDuplicates`** in canonicalize response |
| **Home / cash dashboard (Epic 7.1 / 7.2)** | 🟡 | **`GET /reports/cash-summary`** — presets + **custom `dateFrom`/`dateTo`** (inclusive, max 366 days, **`CR-015`**), KPIs, **`spendingPower`**, **`comparison`** (same-length prior window for custom), account filter, by-account, **by-category** + charts, trend. **`GET/PATCH /household/settings`** — **`monthly_savings_target_usd`**. **Transfer exclusions** per **CR-004**; **FIX-003** unmigrated DB. **UI:** Home — **Custom** period + Apply, KPI tooltips (**UX-005**), savings slider (**UX-006**), drill-down. **PRD §8** via **PRD-002**. **Not yet:** free-form range beyond 366-day cap |
| **Classification (Epic 5.1)** | 🟡 | **Static rules** in **`category-rules.ts`** + **DB rules** (migration **`0009`**, **`category_rule`** table) evaluated before defaults; **`classification_meta`** on canonical rows for explainability. **`GET/POST/PATCH /categories/rules`**; **UI:** **`/categories/rules`**. **`unknown_category`** triage: **Transactions → Needs review** (bulk + expand-row context + **`POST /resolution/bulk-apply-category`**). **Still not:** richer confidence UX polish |
| **Category hierarchy + ledger UX (Epic 5.3)** | 🟡 | **Migrations** through **`0008`** (+ **`0009`** for rules). **`/categories`** + **`/categories/rules`**. **Ledger:** **`LedgerCategoryPicker`** (portal flyout, inline **`POST /categories`**), **single-line** category cell, **no Status column** (**UX-003**, **PRD-001**). **IA:** **D-014** — keep **Transactions** as primary categorization surface; **Categories** + **Rules** remain secondary (**DOC-008**). **Gaps:** hierarchical **`byCategory`** semantics beyond **`categoryRollup`** |
| **Transfer matcher (Epic 5.2)** | 🟡 | **Baseline shipped**; **continuation post-MVP** (**`MVP_BACKLOG`**) — real-statement validation before deeper patterns. Matcher in **`canonical-ingest.service.ts`**: **CR-016** + **CR-030** **`outgoingPaymentTokens`**; **`transfer_ambiguity`**, **`low_pair_score`**. **`TRANSFER_*`** env. |
| **UI shell & routing** | 🟡 | **Epic 11.1 / 11.3 / 11.4 (partial):** collapsible **sidebar** + **top bar** + **Account** menu (**Settings** `/settings`, **Sign out**); nav label **Transactions** (`/transactions`). **`/dashboard`** → **`/`**. **Guests:** **`/`** = landing + **inline sign-in** (**CR-017**); **`/login`** → **`/`**. **Home (signed-in):** **Scope** bar (account filter). **`/settings`** tabs are partially wired; **Household** management is owner/admin only (member tab hidden; backend `403` on household member/settings management routes). **`avatarKey`** + first name now shown in top bar account trigger. Sidebar width: **`localStorage`** `hf_sidebar_collapsed` |
| **Import UX** | 🟡 | Closed sessions: uploads hidden; **Start another import session**. **Epic 6.3:** **`POST /imports/sessions/:id/undo-import`** + UI while **`review`** (**CR-021**); **Finalize session** UI (**CR-022**) → **`PATCH .../status`** **`finalized`**. **Payslip copy + filename heuristic** for IBM profile (**UX-009**, **CR-028**); import run is now blocked with explicit message when multi-employer payslip files are missing employer selection (**CR-041**). **CR-042:** outcomes include per-file reconciliation diagnostics and file-scoped drill-down links. |
| **Payslip (Epic 3.3a / 3.3b)** | 🟡 | **`POST /payslips/upload`** — IBM SuccessFactors / Pay and Contributions **multiline** text parse (**FIX-006**, **FIX-007**); **`422`** codes **`NO_PDF_TEXT`** / **`PARSE_FAILED`** / **`PDF_READ_ERROR`**. **`GET /payslips`** — list + paging; **`GET /payslips/:id`** — full snapshot (**CR-031**). **`/payslips`** — **Recharts** gross/net/taxes + month rollups + latest-stub breakdown (**CR-036**). **`importFileId`** when from Import. **Import path:** **`ibm_pay_contributions_pdf`** + **`0015`** (**CR-028**). **Settings → Profile:** salary deposit + **employers** (person-owned storage, **CR-039**). **UI:** detail (**UX-008**); Import workspace (**UX-009**). **Dev:** Vite **`/payslips`** (**FIX-008**). **Not** merged into **`transaction_canonical`**. **Still not:** line-item grids; multi-parser execution beyond IBM — see **`docs/PAYSLIP_V1.md`** |
| **Operator purge** | ✅ | `npm run import:purge` — `docs/IMPORT_STAGING_PURGE.md` |
| **Tests** | 🟡 | Backend: Vitest + integration (**`cd backend && npm test`**). Frontend: **`cd frontend && npm test`** — **`inferParserProfile`** / payslip filename heuristic (**CR-028**) |
| **Design system & branding (Epic 10, P1)** | ⬜ | Ad hoc polish in **`CHANGE_HISTORY`** (e.g. **UX-002**); **no** full theme system yet — see **`docs/MVP_BACKLOG.md`** Epic **10** (tokens, optional dark/light, consistency pass, **`docs/UI_BRAND.md`**) |
| **Shell, transactions hub, settings (Epic 11, P0)** | 🟡 | **Shipped:** **CR-013** + **CR-014** + **CR-018** + **CR-034**: **`/transactions`** **Needs review** + **`/resolution-queue`** (full **`GET /resolution`**) + banner when **`openDuplicateAmbiguityNotOnLedger`** > 0 (**DOC-005**). Type filter, **`openReviewItems`**, **`importSessionId`**, expand row **`GET /transactions/:id/open-review`**, **`PATCH /resolution/:id`**. **`GET /transactions`** paging + **FTS5** (**`0011`**, **`0013`**). **`/resolution`** → **`/transactions?needsReview=true`**. **Trash** deferred. **`docs/FINANCE_APP_PRD.md` §13**. |
| **Identity + membership model (Epic 12)** | 🟡 | **Decision locked** (**DOC-012**). **Shipped in DB/API/UI:** migrations **`0019`**, **`0020`**, **`0022`**; **`GET/PATCH /household/profile`**; salary/employers on **`person_profile`**; owner attribution across connected accounts/import files/ledger + owner filters in transactions/reports/dashboard (**CR-039**, **CR-040**, **CR-044**). **Still backlog:** profile-only members with no linked auth in onboarding UX; split allocation semantics (post-MVP). |
| **Credentials lifecycle (Epic 13)** | 🟡 | DB-backed credentials + Security change-password are shipped, including JWT invalidation after password change (**`0021`** token version). **Still backlog:** full onboarding/invite lifecycle for air-gapped member account creation. |

---

## Key docs (by topic)

| Topic | File |
|----------|------|
| Backlog & epics | `docs/MVP_BACKLOG.md` |
| Target shell & IA (phased) | **`docs/FINANCE_APP_PRD.md` §13** · **Epic 11** in **`MVP_BACKLOG.md`** |
| External PFM patterns (non-competitive) | **`docs/PFM_COMPETITIVE_UX_REFERENCE.md`** · **D-018** |
| **Change / CR / UX history** | **`docs/CHANGE_HISTORY.md`** |
| Decisions (ADR-lite) | `docs/DECISIONS_LOG.md` |
| Import API | `docs/API_IMPORT_SESSIONS.md` |
| Ledger API | `docs/API_LEDGER.md` |
| Categories API | `docs/API_CATEGORIES.md` |
| Resolution queue API | `docs/API_RESOLUTION.md` |
| Cash summary (home) | `docs/API_CASH_SUMMARY.md` |
| Household settings (savings target) + read salary/employers | `docs/API_HOUSEHOLD.md` |
| Profile (salary/employers PATCH) | `docs/API_HOUSEHOLD_PROFILE.md` |
| Staging purge | `docs/IMPORT_STAGING_PURGE.md` |
| Epic 12/13 phased execution | `docs/EPIC_12_13_EXECUTION_PLAN.md` |
| Payslip (3.3a/b + parser notes) | **`docs/PAYSLIP_V1.md`** · **`GET/POST /payslips`** (**CR-023**, **CR-026**, **FIX-006**–**FIX-007**) |

---

## Resolved / superseded — Needs review bulk category (March 2026)

**Original issue:** bulk **Apply category** looked broken when selection had no **`unknown_category`** items; categorized rows on Needs review were confusing.

**Shipped (CR-025):** selection summary + disabled **Apply category** when no unknown-category items; clearer error copy; toolbar **Show unknown category only** sets **`resolutionType=unknown_category`**; intro + **`reviewReasons`** explain “category set but other flags open.”

---

## Sensible next steps (prioritized themes)

1. **Payslip + Import:** **Shipped (baseline):** **`import_file`** on **`payslip_snapshot`** (**`0015`**), **`GET /payslips/:id`**, detail UI (**CR-031**), session parse + payslip-only canonicalize, workspace guidance, filename-based suggestion for **`ibm_pay_contributions_pdf`**. **Next:** salary/income account hints from onboarding; optional PDF text sniff (beyond filename). See **`docs/PAYSLIP_V1.md`**.
2. **Epic 5.2 (transfer matcher):** **post-MVP / backlog** — further matcher work after **real-world** export validation (**`MVP_BACKLOG`** Story **5.2**).
3. **Epic 7 continuation:** **`byCategory`** prior-window / delta fields shipped; **safe-to-spend** polish and remaining KPI range UX (e.g. free-form ranges beyond the 366-day cap).
4. **Epic 5.1:** classification explainability / confidence UI on Transactions and rules.
5. **Epic 11:** duplicate/transfer specialist UX vs queue parity; **DOC-005** edge cases (near-duplicate **`source_ref`**).
6. **Epic 12 (new):** implement separate `user_account` + `person_profile`, household membership roles/relationships, and ownership attribution fields.
7. **Epic 13 (new):** replace `.env` auth with DB credentials and ship Security tab (change password).
8. **Epic 6:** **6.2** bulk edits; import UX polish if not subsumed by (1).
9. ~~**Needs review bulk UX:**~~ **CR-025** shipped — optional micro-copy only.
10. **Docs hygiene:** append **`CHANGE_HISTORY.md`** when shipping user-visible or behavior-changing work (**DOC-010** meta).

---

## MVP done vs deferred freeze

**Done**
- Auth/security baseline: password change invalidates existing sessions via token versioning (**`0021`**, **CR-041**).
- Profile continuity: top bar now reflects profile identity (`avatarKey` + first name) (**CR-041**).
- Import/payslip guardrails: multi-employer employer selection is enforced before parse/import (**CR-041**).
- Import trust diagnostics: per-file reconciliation details (when running balance is present), broader balance-key detection, and file-scoped review drill-down links (**CR-042**, **CR-043**).
- Needs-review throughput: bulk **Apply + resolve** flow for unknown-category items with mixed-selection guardrail messaging (**CR-043**).
- KPI/drill-down parity: unknown-category CTA and account drill-down preserve active dashboard scope/context (**CR-043**).
- Validation/UAT gates: backend test suite passing (**125/125**), frontend typecheck (`npm run lint`) + production build green.

**Deferred (explicit)**
- Deep transfer matcher tuning with broader real-world pattern coverage (**post-MVP**, Epic 5.2 continuation).
- Split allocation semantics (percent/amount) and richer onboarding lifecycle polish for profile-only members (post-MVP).
- Expanded statement-balance reconciliation support across all parser profiles (currently available where parsed rows expose running balance).

---

## Quick file map (categories + ledger + reporting)

- `backend/src/modules/category/category-rules.ts` — default classification + **DB rule** merge  
- `backend/src/modules/category/category-rules.service.ts` — **CRUD** for `category_rule`  
- `backend/src/modules/category/category-rules.routes.ts` — **`/categories/rules`** API  
- `backend/src/modules/category/category-ids.ts` — leaf/parent id constants  
- `backend/db/migrations/0008_income_taxes_transfers_taxonomy.sql` — Income/Taxes/Transfers taxonomy  
- `backend/db/migrations/0009_category_rules_explainability.sql` — **`category_rule`** + **`classification_meta`**  
- `backend/src/config/env.ts` — **transfer matcher** env vars (`.env` / `.env.example`)  
- `backend/src/modules/canonical/canonical-ingest.service.ts` — ingest, dedupe, **transfer matcher**  
- `backend/src/modules/reports/cash-summary.service.ts` — KPIs, comparisons, **transfer exclusion**  
- `frontend/src/layout/ShellLayout.tsx`, `AppSidebar.tsx`, `AppTopBar.tsx` — collapsible nav + top bar (**Epic 11.1**)  
- `frontend/src/pages/SettingsPage.tsx` — **`/settings`** tabs (**Epic 11.4**)  
- `frontend/src/components/LedgerCategoryPicker.tsx` — category flyout + inline create  
- `backend/src/modules/ledger/ledger.service.ts` — ledger list filters, **`needsReview`** predicate, **`reviewReasons`**, **`createManualCanonicalTransaction`**  
- `backend/src/modules/ledger/ledger.routes.ts` — **`GET/POST/PATCH /transactions`**  
- `frontend/src/pages/TransactionsPage.tsx` — **All \| Needs review** tabs, sticky filters, **Why** column, **+ Add** modal (**no Status column**; **Manage categories** link removed from intro)  
- `frontend/src/pages/CategoriesPage.tsx` — category management; **link to rules**  
- `frontend/src/pages/CategoryRulesPage.tsx` — **household classification rules UI**  
- `frontend/src/pages/PayslipsPage.tsx`, `PayslipDetailPage.tsx` — payslip upload + list + detail (**CR-031**)  
- `frontend/vite.config.ts` — dev proxy **`/payslips`** (**FIX-008**)  
- `backend/src/modules/payslip/profiles/ibm-payslip-pdf.ts` — IBM parser (**FIX-006**, **FIX-007**)  
- `docs/CHANGE_HISTORY.md` — **CR / UX / FIX / PRD deviation log**
