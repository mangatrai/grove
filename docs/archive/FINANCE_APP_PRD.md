# Household Finance Platform - Product Requirements Document (PRD)

**Implementation status:** This PRD is the north star (archived copy; active planning uses **`docs/CHANGE_HISTORY.md`** for what shipped and why). **`docs/USER_GUIDE.md`**, **`openapi/openapi.yaml`**, and **`docs/API_*.md`** describe current behavior. **Target app shell and IA (phased):** **§13**.

## 1) Product Vision
Build a private, self-hosted household finance platform that gives a trustworthy view of:
- monthly net cashflow,
- safe-to-spend (spending power),
- savings trajectory,
- category-level spending,
- yearly trends and comparisons.

The system must support low-friction ingestion of monthly financial statements (especially PDF-first workflows), strong duplicate prevention, and minimal ongoing user maintenance.

## 2) Product Goals and Non-Goals

### Goals (Phase 1)
- Reliable monthly import workflow for checking/savings/credit cards/loans.
- Household-level visibility with role-based access (head of household full visibility).
- Minimal post-import effort via automated parsing + categorization + bulk review.
- Accurate transfer handling (credit card payments, loan payments, internal transfers).
- Clear dashboards for income vs spend vs net cashflow and safe-to-spend.
- Manual entry/edit + batch correction + import undo window.

### Non-Goals (Phase 1)
- Direct bank API integrations.
- Full tax preparation.
- Full investment transaction accounting.
- Receipt image retention.
- Advanced per-user budgeting and child workflows.

## 3) Success Metrics (from discovery)
1. Monthly net cashflow accuracy and confidence.
2. Spending power metric usability (safe-to-spend after savings buffer).
3. Time-to-monthly-close: user can process statement batch quickly with minimal manual fixes.
4. Reduction in uncertainty: user can answer "how much we can safely spend" at any time.

## 4) Primary Users and Access Model

### Users
- Head of household (Owner/Admin): full data visibility and edit rights.
- Spouse (Member): own data visibility by default.
- Future household members (modeled now, feature-enabled later).

### RBAC (Phase 1)
- Owner/Admin:
  - view all household members/accounts/transactions.
  - upload/import/approve/edit/delete (within policy).
  - manage household structure/settings (members, relationships, household-level settings).
- Member:
  - view/edit own transactions/accounts only.
  - upload own statements.
  - does **not** manage household structure/settings.
- **Staff** (added §20): restricted role for household employees (nanny, cleaner, etc.).
  - sees **only** "My Timesheet" and "My Expenses" tabs — no financial data or household settings.
  - cannot access Home, Transactions, Import, Reports, Budget, Categories, or household Settings.
- Read-only role deferred to Phase 2.

### Identity and Membership Model (decision)
- **Chosen approach:** keep **authentication identity** and **person profile** separate.
- **`user_account`** holds login/security concerns (email, password hash, sessions).
- **`person_profile`** holds human attributes (name, phone, avatar/icon) and ownership attribution.
- **`household_membership`** links person to household with role and relationship (head, spouse, child, member).
- A household person may exist without login credentials (e.g. child/dependent); login can be added later.

## 5) Scope and Data Domains

### In-scope Phase 1
- Account types: checking, savings, credit cards, loans/mortgages (liability tracking).
- Currency: USD only in reporting.
- Investment accounts: balance snapshots only (month-end optional).
- Income types: salary, commissions, rental income, savings interest, dividends (as available from statements/payslips).
- Payslip details: gross, net, taxes withheld, deductions (benefits/401k/ESPP), employer-specific line items.

### Deferred Phase 2+
- INR account ingestion and FX conversion reporting.
- annual tax projection helpers.
- attachment search/indexing.
- approval workflow and full audit trails.

## 6) Core User Jobs-To-Be-Done
1. "I drop monthly statements and payslips, and the system processes them with minimal intervention."
2. "I review unresolved/low-confidence items in one screen, in bulk."
3. "I can clearly see income, expenses, transfers, net cashflow, and safe-to-spend."
4. "I can fix mistakes quickly and undo a bad import safely."
5. "I can compare this week/month/year vs prior periods."

## 7) Functional Requirements

### FR-1: Ingestion
- Accept multi-file uploads and/or watched input directories by user.
- Supported input types (Phase 1): PDF + CSV/Excel (statement import layer normalizes to canonical format).
- Statement parser profiles per institution/template (layout-stable assumption).
- Payslip parser profiles per employer template.
- Password-protected PDF support deferred (India scope later).

### FR-2: Parsing and Normalization
- Extract metadata: institution, account, statement period, opening/closing balance.
- Extract line items: date, posting date (if present), description, amount, debit/credit sign, reference ID.
- Normalize into canonical transaction schema.
- Preserve parser confidence and provenance (file + row hash + parser version).

### FR-3: Deduplication (strict)
- Prevent duplicate transaction insertion across repeated uploads.
- Deterministic fingerprint strategy:
  - account_id + date + amount + normalized_description + statement_period.
- Near-duplicate queue for collisions/ambiguity.
- Never silently merge uncertain records; send to "Needs Resolution."

### FR-4: Categorization
- Standard category set in Phase 1 (minimal config burden).
- Global household categorization rules only (no per-user rule maintenance).
- Auto-categorize by merchant patterns with conservative confidence threshold.
- Unknown category queue in "Needs Resolution."

### FR-5: Transfer Detection
- Detect and mark internal transfers between owned accounts.
- Special handling for:
  - credit card purchase (expense + liability increase),
  - credit card payment (asset decrease + liability decrease, no expense),
  - loan payment split (principal vs interest when data allows).
- Uncertain transfer matches appear in resolution queue.

### FR-6: Review and Correction UX
- Single "Import Inbox" for all processed files and unresolved items.
- Bulk actions: approve selected, categorize selected, mark transfer, assign user.
- Inline edit grid for transaction batch correction.
- "Approve all high-confidence" action.

### FR-7: Manual Entry and Batch Edit
- Add single transaction manually.
- Batch edit selected transactions (category/tag/user/notes).
- Support correction entries and balance adjustments with explicit reason.

### FR-8: Undo and Safety
- Import session rollback allowed until "Finalize Review."
- Optional time-based undo window (e.g., 30 minutes) before final lock.
- Once finalized, changes require explicit correction entries.

### FR-9: Dashboards and Reporting (MVP)
- Household overview:
  - income, expenses, net cashflow,
  - safe-to-spend metric,
  - savings rate,
  - trend vs previous period.
- Category spend breakdown and drill-down to transactions.
- Time windows: weekly, monthly, YTD, yearly, custom range.
- Comparative views: current vs prior week/month/year.
- **Presentation:** **All accounts vs one account** scope is **primary** on the dashboard surface (**§13** Phase C). **Data-dense** layouts are acceptable when filters and labels preserve scanability (**§13**).

### FR-9b: Search (MVP baseline)
- Provide free-text search on merchant/memo/normalized description.
- Search ranking uses BM25 over local index data (SQLite FTS5).
- Support structured filters with search results:
  - amount range,
  - account,
  - date window,
  - status.

### FR-10: Household and Assignment
- Assign accounts/statements/transactions to a household member.
- Owner sees all; members see own by default.
- Family-level consolidated dashboards.
- Support person-level attribution even when the person has no direct login account.
- Household roles/relationships are modeled in membership, not embedded in auth records.

### FR-11: Privacy and Retention
- Air-gapped capable operation (no external calls required for core ingestion).
- Raw PDFs purged after successful extraction + validation checkpoint.
- Parsed canonical records retained.

### FR-12: Reconciliation Policy (MVP)
- Reconciliation mismatches are warn-only in MVP.
- Finalization is allowed with visible warning and reason capture.
- Policy can be tightened to block mode in future release.

## 8) Derived Metrics Definitions

### Monthly Net Cashflow
Net Cashflow = Total Income - Total Expenses (excluding transfers and balance moves)

### Savings Rate
Savings Rate = (Income - Expenses) / Income

### Spending Power (Safe-to-Spend)
Safe-to-Spend = (Expected Income - Committed Expenses - Planned Savings Buffer) - Realized/Committed Discretionary Spend

For first release, simplify to:
Safe-to-Spend (current month) = Income MTD - Expense MTD - Monthly Minimum Savings Target

### MVP shipped formulas (custom web app — this repo)
The Phase 1 **household-finance-app** dashboard uses **`GET /reports/cash-summary`** (posted ledger, optional account filter). Transfer-linked rows are **excluded** from inflow/outflow aggregates where configured (**`docs/CHANGE_HISTORY.md`** **CR-004**). This section records **intentional** differences from the shortcut formulas above; audit detail: **`docs/CHANGE_HISTORY.md`** **PRD-002**, API: **`docs/API_CASH_SUMMARY.md`**, **`docs/API_HOUSEHOLD.md`**.

- **Inflows / outflows / net (Home KPIs)** — **Sum of posted credits**, **sum of posted debits**, and **inflows − outflows** for the **selected preset window** (calendar month, YTD, rolling 30/90), not a separate “expected income” or MTD-only model.
- **Savings rate (Home)** — When **inflows > 0**: **(inflows − outflows) ÷ inflows**, **rounded to two decimal places** as a ratio, then shown as a percentage. Algebra matches §8 *Savings Rate* when **Income** / **Expenses** are read as **cash-basis ledger totals** in the same window.
- **Safe-to-spend** — Shown only when the household sets **`monthly_savings_target_usd`** (**`GET/PATCH /household/settings`**). **Net for the window** minus **monthly target × (inclusive calendar days in window ÷ ~30.437)**. This **generalizes** the “current month MTD” shortcut to all presets; without a target the KPI stays empty (—).

**Home UX:** Definitions for each KPI appear in **(i)** tooltips (hover or keyboard focus), not as a long paragraph under the tiles (**`docs/CHANGE_HISTORY.md`** **UX-005**). The **monthly savings target** is adjusted with a **slider**; **safe-to-spend** updates live in the KPIs before save (**UX-006**).

### Net Worth Trend (Phase 1 basic)
Net Worth = Assets - Liabilities
Monthly trend from account balances and loan liabilities.

## 9) Recommended Product Strategy
Use a hybrid approach:
1. Base product: Actual Budget for budgeting/reporting UI and account semantics.
2. Custom ingestion layer:
  - PDF/CSV/Excel parser and canonicalizer,
  - strict dedupe + import inbox + resolution queue,
  - exporter/importer bridge into base system.

Rationale:
- avoids rebuilding dashboards/ledger core,
- addresses key gap (PDF ingestion),
- keeps workload focused on differentiator.

## 10) High-Level System Architecture

### Components
- UI Layer: mobile-friendly web app + desktop web.
- Ingestion Service:
  - file intake (upload/watch folder),
  - parser engine (institution templates),
  - canonical transaction store.
- Classification Service:
  - category assignment,
  - transfer matcher,
  - confidence scoring.
- Review Workflow:
  - inbox, bulk actions, resolution queues.
- Ledger/Finance Core:
  - base system (Actual) as reporting/budget engine.
- Data Store:
  - relational DB for canonical records + provenance + user/household model.
- Retention Worker:
  - secure purge of raw files post-processing.

## 11) Suggested Data Model (MVP)
- household(id, name, owner_user_id, created_at, monthly_savings_target_usd nullable) — *target used for prorated safe-to-spend on cash summary; see §8 MVP shipped formulas*
- user(id, household_id, role, visibility_scope, ...)
- financial_account(id, household_id, owner_user_id, type, institution, mask, currency)
- import_session(id, household_id, source_type, started_at, status, finalized_at)
- import_file(id, session_id, file_name, checksum, parser_profile_id, status, confidence_summary)
- transaction_raw(id, file_id, row_index, extracted_payload_json, confidence)
- transaction_canonical(id, household_id, account_id, txn_date, amount, direction, merchant, memo, category_id, user_id, transfer_group_id, fingerprint, source_ref, status)
- category(id, household_id nullable, parent_id nullable, name, is_default)
- rule(id, household_id, rule_type, pattern, action, confidence_threshold, active)
- resolution_item(id, household_id, type, target_id, reason, status, assigned_to)
- balance_snapshot(id, account_id, snapshot_date, balance, source)
- paystub_record(id, user_id, pay_date, gross, net, tax_total, deduction_total, detail_json, source_file_ref)

## 12) UX Flows (MVP)
1. Upload files -> parser runs -> dedupe/classify -> inbox summary.
2. Review unresolved items in grid -> bulk fix -> finalize import.
3. Dashboard updates immediately after finalize.
4. Optional rollback while session is unfinalized.

## 13) Application shell, ledger hub, and settings (target IA)
**Intent:** Reduce wayfinding cost and extra screens by using a **persistent app shell** (nav + header), a **Transactions-first hub** for day-to-day work, a dedicated **Home** dashboard, and a **Settings** area under the user menu — aligned with proven patterns (e.g. Stessa-style density) while staying household-finance-specific.

**Density:** The product targets **data-heavy** screens for **analysis and decisions**; information hierarchy, filters, and scanability take priority over aggressive minimalism. Dense tables and filter rows are **acceptable by design** when labeled and keyboard-friendly.

### Phase A — Shell and wayfinding
- **Collapsible** left navigation (icons + labels; collapse to icons-only on narrow widths).
- **Top-right user menu:** at minimum **Settings** and **Log out**; room for notifications/help later.
- **Information architecture:** **Transactions** = primary **operational hub** (posted ledger + corrections). **Home** = **dashboard** (KPIs, trends, safe-to-spend). **Import** remains **one click** from the global header (no requirement to bury import inside Transactions only).
- **Naming:** User-facing nav and page title use **Transactions** (not “Ledger”) for `/transactions`; **`docs/CHECKPOINT.md`** records status. Internal code may still say `ledger` in API paths (`/transactions`) and CSS class names.

### Phase B — Transactions as command center
- **Tabs** on the Transactions view, same underlying table patterns:
  - **All** — default full posted ledger (current behavior baseline).
  - **Needs review** — rows that need attention **before trusting reporting**; **definition (single sentence):** *Posted transactions that are **uncategorized** **or** have an **open resolution item** tied to them **or** are tied to **import/staging** outcomes that are blocked or failed pending user action.* Exact query/API mapping is an implementation detail; the tab must **not** become an undifferentiated junk drawer — if a row appears here, the UI states **why** (uncategorized vs resolution vs import).
  - **Trash** — **not MVP** unless the product adopts **soft-delete** with restore semantics, retention, and audit rules (see **Deferrals** below).
- **Primary actions** on or adjacent to this screen: **Import** (may duplicate header) and **+ Add** for **manual transaction entry** (**FR-7**).
- **Filter bar:** A **sticky** (or always-visible) region above the table: **search** (free text per **FR-9b** when available), **account**, **date window**, **category**, **amount** band; optional **More filters** link for progressive disclosure.
- **Category assignment:** Prefer **in-row** hierarchical assignment (search + parent/child, no page navigation) as the default path; **`/categories`** remains for taxonomy and rules administration.

### Phase C — Dashboard (Home)
- **Home** remains the **dashboard** route.
- **Scope** (**all accounts** vs **one account**) is **visually primary** at the top of the page (dropdown or equivalent), with copy appropriate to **financial accounts** (checking, credit cards, etc.) — not “properties.” Card layout and per-metric **(i)** tooltips remain the pattern (**§8**).

### Phase D — Settings
- Dedicated **Settings** route (e.g. from user menu) with **sub-tabs** only where APIs exist; placeholder tabs acceptable with clear “not configured” states.
- Suggested tab groups over time: **Profile** (user identity), **Household** (household name, **monthly savings target**, future expectations), **Connected accounts** / institutions, **Notifications**, **Security** (password/session).
- **Monthly savings target** may appear both as **quick adjust on Home** and as **full edit under Household** in Settings (dual entry is acceptable).
- **Financial Insights** sub-tab: AI provider configuration, API key, and user financial profile (age, salary, goals, risk tolerance) — see §18.
- **Backup & Restore** sub-tab: manual export/restore (moved from wherever currently exposed) + Google Drive cloud backup configuration — see §19.
- **Staff** sub-tab: manage household staff profiles, review timesheets, approve expenses, record payments — see §20.

### Deferrals (explicit)
- **Trash / deleted transactions tab:** **Out of scope** for MVP unless **soft-delete**, restore, retention, and dedupe/fingerprint interaction are specified and built. Until then, omit the tab or defer to a later **archive** concept.

## 14) NFRs
- Dashboard load target: <= 2-3 seconds for typical household dataset.
- Import SLA target: 20-30 seconds per statement acceptable.
- Reliability: idempotent imports, deterministic dedupe.
- Security: encrypted backups, local-first deployment, no required external services.
- Operability: can run on laptop on-demand, not 24x7 dependent.

## 15) Risks and Mitigations

### Risk: PDF parser drift per institution
- Mitigation: parser profiles + template tests + fallback manual mapping UI.

### Risk: Duplicate or missing transactions
- Mitigation: strict fingerprints + unresolved queue + reconciliation checks.

### Risk: Wrong transfer detection
- Mitigation: confidence threshold + review queue + reversible decision before finalize.

### Risk: Category noise
- Mitigation: conservative default categorization + bulk correction UX.

### Risk: Over-complex feature creep
- Mitigation: phase gates and explicit MVP freeze.

## 16) MVP Exit Criteria
- User can ingest monthly household files with <10 minutes review effort.
- No duplicate transactions on repeated file upload.
- Correct treatment of credit card purchase vs payment flow.
- Dashboard clearly shows income, expenses, net cashflow, safe-to-spend.
- User can batch-correct and finalize without per-row manual toil.

## 17) Future Phases
- Phase 2: INR handling + FX conversion, tax summary/high-level projections, notifications, audit trail.
- Phase 3: advanced search, deeper investment analytics, custom categories/tags UX maturity, configurable user-level budgets.
- Cloud backup Phase 2: OneDrive provider (Microsoft OAuth + Graph API, same job runner as §19 Google Drive).
- Staff module Phase 2: PDF pay stub generation for staff, mileage log export, multi-household-member payroll summary.
- Balance sheet enhancements: multi-time-slice comparison views; denser persisted history independent of import events; household-vs-member subtotal breakdown rows on the net worth page (filtering shipped in CR-064; subtotals still deferred).
- Async canonicalize: large imports benefit from a `202 { jobId }` response with background worker and client polling — avoids HTTP timeouts on slow LLM-backed parses. See GitHub [#12](https://github.com/mangatrai/household-finance-app/issues/12).

---

## 18) AI Financial Health Dashboard (FR-13)

### Overview
An on-demand AI analysis panel on the Home page. The household owner configures their preferred AI provider and API key in Settings (under a new "Financial Insights" sub-tab), along with a personal financial profile. Clicking "Refresh Analysis" sends a curated summary of the household's financial state to the configured AI and caches the result until the user refreshes again.

### Design Decisions
- **Provider:** user-selectable in Settings — OpenAI or Anthropic Claude. User supplies their own API key. No vendor is hard-coded.
- **Trigger:** on-demand only ("Refresh Analysis" button). Never auto-runs on page load.
- **Privacy:** financial data leaves the device only when the user explicitly clicks Refresh. The user consents by wiring up their own API key and accepting the prompt.
- **Result storage:** cached server-side; all household members can view the latest cached analysis without triggering a new API call.

### Analysis Input (sent to AI)
The backend assembles a prompt containing:
- **User profile** (from Settings): age, gross annual salary, risk tolerance, stated financial goals
- **Net worth snapshot**: total assets, total liabilities, net worth (from balance sheet)
- **Income/expense trend**: last 12 months of category-level aggregates (inflows, outflows, top 10 spending categories)
- **Savings rate trend**: last 12 months
- **Budget vs actuals**: current month and last 3 months where budgets exist
- **Account type inventory**: which account types are present (checking, savings, investment, retirement, etc.) — gaps noted
- **Household context**: number of household members

### Analysis Output (structured narrative)
The AI is prompted to return a structured response with these sections:
1. **Overall health rating**: strong / on-track / needs attention / at risk (single label + one sentence rationale)
2. **What's working well** (2–4 bullet points)
3. **Areas of concern** (2–4 bullet points)
4. **Top expense reduction opportunities** (up to 3, specific category-level observations)
5. **Investment / product gaps** (e.g., no investment account detected, no emergency fund evident from balance data)
6. **Demographic benchmark note** (AI reasons against general benchmarks for the stated age/income bracket — non-prescriptive)
7. **Actionable next steps** (2–3 concrete recommendations)

### Settings — "Financial Insights" sub-tab
New fields added to Settings:
- AI provider: OpenAI / Anthropic Claude (select)
- API key (encrypted at rest, masked in UI after save)
- Model preference (e.g., `gpt-4o`, `claude-sonnet-4-6` — defaults per provider)
- Age (years)
- Gross annual salary (USD)
- Risk tolerance: conservative / moderate / aggressive
- Primary financial goals (multi-select): build emergency fund, pay off debt, save for home, invest for retirement, grow wealth, other

### UI — Home Page Additions
- New "Financial Health" card below the KPI tiles
- Displays: last analysis timestamp, health rating badge (color-coded), narrative sections (collapsible by section)
- "Refresh Analysis" button (shows spinner + disabled during generation; estimated 10–30s)
- If provider not configured: shows "Configure AI in Settings" prompt with link instead of the analysis panel

### Non-Functional Requirements
- Analysis is generated server-side (backend calls AI API — not frontend)
- Cached in a new DB table: `household_ai_insight` (household_id, generated_at, provider, model, payload_json, prompt_version)
- One active insight per household; prior insights overwritten on refresh
- Prompt version tracked so stale results from old prompt structures can be flagged
- Analysis generation is a best-effort async call; timeout after 60s with user-visible error

---

## 19) Automated Cloud Backup & Restore (FR-14)

### Overview
Extends the existing manual export/restore capability with scheduled automated backups to Google Drive. A new "Backup & Restore" sub-tab in Settings consolidates all export, restore, and cloud backup configuration into one place. **Shipped:** **`.hfb`** household bundles (**`exportVersion` 4** per **`docs/CHANGE_HISTORY.md`** **CR-125** / **CR-126**); Drive backups use the same payload as HTTP export.

### Design Decisions
- **Phase 1 provider:** Google Drive only. Phase 2 adds OneDrive.
- **Backup format:** same **`POST /exports/household`** pipeline as manual export (**.hfb**, **`exportVersion` 4**). Optional AES-GCM encryption via **`BACKUP_ENCRYPTION_KEY`**.
- **Triggers:** scheduled (daily/weekly/monthly background job) and manual "Backup Now".
- **Drive scope:** `drive.file` only — app can only access files it creates, not the user's full Drive.

### Settings — "Backup & Restore" Tab

**Section A — Manual Export / Restore** (consolidates existing capability):
- "Export household data" button → calls existing `POST /exports/household`, downloads ZIP
- "Restore from file" upload → calls existing `POST /exports/household/import`
- Restore history table: last 5 jobs with status, timestamp, stats

**Section B — Google Drive Backup**:
- "Connect Google Drive" button → initiates OAuth 2.0 flow (scope: `drive.file`)
- Once connected: shows Google account email + "Disconnect" button
- Configuration (shown after connect):
  - Backup folder path in Drive (default: `HouseholdFinanceBackups/`)
  - Backup frequency: Daily / Weekly (day-of-week picker) / Monthly (day-of-month picker)
  - Keep last N backups in Drive: 1 / 3 / 5 / 10 / unlimited
  - Keep last N local export jobs: same options (prunes old `export_job` rows and ZIP files)
- "Backup Now" button: manual trigger, runs immediately regardless of schedule
- Last backup status: timestamp, file name, Drive link, file size
- Backup history table: date, file name, size, location (local / Drive), status (success / failed + error detail)

### Backend Additions

**New DB tables:**
- `cloud_backup_credential` (id, household_id, provider, access_token_enc, refresh_token_enc, account_email, scopes, expires_at, created_at)
- `backup_schedule` (id, household_id, provider, folder_path, frequency, day_of_week, day_of_month, drive_retention_count, local_retention_count, enabled, last_run_at, next_run_at)
- `backup_job` (id, household_id, provider, triggered_by: scheduled/manual, status: running/success/failed, started_at, finished_at, file_name, file_size_bytes, drive_file_id, error_detail)

**New API routes:**
- `GET /backup/cloud-credentials` — connection status (provider, email, connected)
- `GET /backup/oauth/start` — returns OAuth authorization URL for redirect
- `GET /backup/oauth/callback` — OAuth callback; stores tokens; redirects back to Settings
- `DELETE /backup/cloud-credentials` — disconnect (revoke + delete tokens)
- `GET/PUT /backup/schedule` — read/write schedule config
- `POST /backup/trigger` — manual backup trigger (returns job ID for polling)
- `GET /backup/jobs` — backup history (paginated)
- `GET /backup/jobs/:id` — single job status

**Scheduled worker:**
- Runs on an interval (checked every minute against `next_run_at`)
- Calls existing export pipeline to generate ZIP
- Uploads ZIP to configured Drive folder via Google Drive API
- Prunes old Drive backups beyond `drive_retention_count`
- Prunes old local export jobs beyond `local_retention_count`
- Updates `backup_job` with result; updates `backup_schedule.last_run_at` and `next_run_at`

**Google Drive OAuth flow:**
1. User clicks "Connect Google Drive" in Settings
2. Frontend calls `GET /backup/oauth/start` → receives authorization URL
3. User is redirected to Google consent screen
4. Google redirects to `GET /backup/oauth/callback` with code
5. Backend exchanges code for access + refresh tokens; stores encrypted in `cloud_backup_credential`
6. Redirect back to Settings; UI shows connected state

**Security / NFRs:**
- OAuth tokens encrypted at rest (AES-256 with key from `JWT_SECRET` or dedicated `ENCRYPTION_KEY` env var)
- Refresh token rotation handled automatically (Google issues new refresh token periodically)
- Failed backups shown in UI with error detail — never silently swallowed
- Backup file naming: `household-backup-{YYYY-MM-DD-HHmm}-{householdShortId}.zip`
- Phase 2: OneDrive (Microsoft OAuth 2.0 + Graph API, same job runner abstraction)

---

## 20) Household Staff Timesheet & Expenses (FR-15)

### Overview
A time-and-expense reporting module for household employees (nanny, cleaner, au pair, etc.) built within this app. A new `staff` RBAC role provides a restricted view — staff see only their own timesheet and expense tabs. Owners/admins manage staff profiles, review and approve entries, record payments, and optionally post approved expenses and wage payments to the household financial ledger.

### Design Decisions
- **Architecture:** extend this app (not a separate SPA) — reuses auth, RBAC, household model, and single deploy. Staff are `app_user` rows with `role = 'staff'`.
- **Ledger integration:** approved expenses and wage payments can optionally be posted to `transaction_canonical` as categorized household expenses. Owner decides at the time of payment recording.
- **Staff isolation:** staff users cannot see any financial data, household settings, or other users' information.

### RBAC — `staff` Role
- Permitted routes: `GET/POST /staff/timesheets/*`, `GET/POST /staff/expenses/*`, `GET /staff/profile` (own only)
- Blocked routes: all existing app routes (Home, Transactions, Import, Reports, Budget, Categories, Settings)
- Navigation renders only "My Timesheet" and "My Expenses" tabs when `role === 'staff'`

### Staff Management (Settings > Staff sub-tab, owner/admin only)

**Add / edit staff member:**
- Name, email, phone
- Regular hourly rate (USD), overtime rate (USD)
- OT threshold: daily (>8h/day) or weekly (>40h/week) — per staff
- Pay period type: weekly / biweekly / semi-monthly / monthly
- Pay period anchor date (reference start date for period calculation)
- Household expense category for wage payments (default: maps to a new built-in "Household Staff" category)
- Household mileage reimbursement rate (USD/mile; defaults to current IRS standard rate — household-level setting)

**Login provisioning:**
- Admin sets a temporary password; staff receives login email + temp password
- Staff can change password on first login

**Deactivate / reactivate staff**: preserves all historical records; deactivated staff cannot log in.

### Staff View — "My Timesheet" Tab

**Time entry:**
- Clock in / clock out (records exact timestamps; calculates duration automatically)
- Manual entry form: date, start time, end time, break duration (minutes), notes
- Regular vs overtime hours auto-calculated per configured threshold
- Entries editable until pay period is submitted

**Pay period submission:**
- "Submit Timesheet" button locks all entries for the current pay period
- Staff can view history of past submitted/approved/rejected pay periods

### Staff View — "My Expenses" Tab

**Expense entry:**
- Date, category (dropdown: groceries, household supplies, children activities, transportation, parking, other), amount, description, receipt note (text field)
- Mileage entry: date, from (text), to (text), purpose, distance (miles) → amount auto-calculated at household mileage rate

**Expense list:**
- Shows own expenses with status (pending / approved / rejected) and any rejection note

### Admin View — Staff Review (Settings > Staff > [Staff Name])

**Timesheet review:**
- List of submitted pay periods with total regular hours, OT hours, gross pay preview
- Approve (locks pay period) or Send Back with comment (reopens for staff correction)
- Approved timesheets generate a payable amount

**Expense review:**
- List of pending expenses (all staff or filtered by person)
- Approve or Reject with reason (individual or bulk)
- Approved expenses roll into the staff member's outstanding balance

**Payment recording:**
- "Record Payment" dialog: date, amount, payment method (cash, check, Venmo, bank transfer, Zelle, other), notes
- Checkbox: "Post to household ledger" → creates a `transaction_canonical` row (debit, configured category, description: "Staff wages – [Name] [period]")
- Separate checkbox for expenses: "Post approved expenses to household ledger" → creates individual `transaction_canonical` rows per expense item

**Payment history ledger (per staff member):**
- Date, amount, method, notes, ledger-posted status

### Admin Summary Page

Accessible from Settings > Staff top level (across all staff):
- Per-staff card: hours owed this period, expenses awaiting payment, total outstanding balance
- YTD totals per staff: wages paid, expenses reimbursed
- Open items alert: count of submitted timesheets awaiting review, count of pending expenses

### Database Additions

New tables:

```sql
staff_profile (
  id, household_id, user_id,            -- user_id → app_user with role='staff'
  hourly_rate, ot_rate,
  ot_threshold_type,                    -- 'daily' | 'weekly'
  pay_period_type,                      -- 'weekly' | 'biweekly' | 'semi_monthly' | 'monthly'
  pay_period_anchor,                    -- DATE reference for period calc
  expense_category_id,                  -- FK → category
  active, created_at
)

timesheet_entry (
  id, staff_profile_id,
  entry_date, clock_in, clock_out,      -- clock_in/out are TIMESTAMPTZ nullable
  break_minutes,
  regular_hours, ot_hours,              -- computed and stored
  notes,
  status,                               -- 'draft' | 'submitted' | 'approved' | 'rejected'
  period_id                             -- FK → timesheet_period nullable
)

timesheet_period (
  id, staff_profile_id,
  period_start, period_end,
  status,                               -- 'open' | 'submitted' | 'approved' | 'sent_back'
  approved_by, approved_at,
  total_regular_h, total_ot_h, gross_pay,
  send_back_note
)

staff_expense (
  id, staff_profile_id,
  expense_date, category,               -- category is freeform enum (not FK to household category)
  amount, description,
  mileage_miles, mileage_rate,          -- nullable; amount = miles × rate when mileage entry
  status,                               -- 'pending' | 'approved' | 'rejected'
  reviewed_by, reviewed_at, reject_note
)

staff_payment (
  id, staff_profile_id,
  payment_date, amount, method, notes,
  canonical_txn_id,                     -- nullable FK → transaction_canonical (if posted to ledger)
  created_by, created_at
)
```

### Navigation / IA Impact
- **Staff role:** nav renders only "My Timesheet" and "My Expenses" — no other routes accessible
- **Owner/admin:** existing nav unchanged; Settings gains "Staff" sub-tab
- **Staff admin review** accessible from Settings > Staff (not in main left nav to preserve primary UX focus)
- No changes to existing Transactions, Home, Import, or Reports screens

