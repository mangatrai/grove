# Product Requirements Document — Grove

A private, self-hosted household finance platform delivering trustworthy visibility into monthly cashflow, spending power, savings trajectory, and wealth trends.

---

## 1. Product Vision and Goals

### Vision
Grove is a self-hosted personal finance platform that provides a household with accurate, low-friction visibility into:

- Monthly net cashflow (income minus expenses)
- Safe-to-spend (discretionary spending power after committed expenses and savings)
- Savings trajectory and rate
- Category-level spending patterns and trends
- Year-over-year net worth changes
- Detailed payslip compensation and tax withholding

The system prioritizes **financial correctness and minimal ongoing maintenance**, eliminating the uncertainty of spreadsheets while keeping data private on the user's own network.

### Phase 1 Goals
- Reliable monthly import workflow for checking, savings, credit cards, and loans/mortgages.
- Household-level visibility with role-based access (head of household sees all; members see own data).
- Minimal post-import effort via automated parsing, categorization, and bulk correction UX.
- Accurate transfer handling (credit card purchases vs. payments; loan principal vs. interest).
- Clear dashboards showing income, expenses, net cashflow, and safe-to-spend.
- Safe undo window and manual entry/edit capabilities.

### Phase 1 Non-Goals
- Direct bank API integrations (statement import only).
- Full tax preparation and filing.
- Detailed investment transaction accounting.
- Receipt image retention.
- Advanced per-user budgeting and child workflows.
- Multi-currency (India/FX handling deferred to Phase 2+).

### Success Metrics
1. User can confidently answer "How much can we safely spend?" at any time.
2. Monthly close time: <15 minutes to process and review a typical household statement batch.
3. Zero undetected duplicate transactions across repeated uploads.
4. Spending power (safe-to-spend) metric is trusted for household spending decisions.

---

## 2. Non-Goals and Explicit Exclusions

### Out of Scope (MVP and near-term)
- **Bank linking**: Grove imports statements as files (PDF, CSV, Excel), not through APIs.
- **Subscription tracking**: No bill management or subscription cancellation features.
- **Receipt images**: Statement ingestion is text-based only.
- **Per-user budgets**: Phase 1 uses household-level metrics; user-scoped budgets deferred.
- **Cloud-required sync**: Grove is designed for air-gapped operation; no mandatory external services.
- **Trash/archived transactions**: Soft-delete with restore semantics deferred until soft-delete policy is defined.
- **Full tax projection**: No automated 1040 or estimated quarterly payment helpers in Phase 1.

### Intentional Rejections
- Bank aggregation as the primary onboarding path (conflicts with self-hosted design).
- Third-party bill negotiation or credit products.
- Subscription-based revenue or paid tiers.
- SaaS cloud locks (user data always portable via export/backup).

---

## 3. Feature Requirements

### 3.1 Bank Import (FR-1, FR-2, FR-3)

#### Multi-file upload and session management
- Batch file upload to a single import session.
- Per-file mapping to a target **financial account** (checking, savings, credit card, loan).
- Per-file profile selection (institution and format-specific parser, e.g., BoA checking CSV, Citi credit card PDF).
- Auto-detect suggestions for profile + mapping with user confirmation gate.

#### Supported input types
- **Phase 1:** PDF and CSV/Excel statements.
- **Future:** optional OCR for scanned PDFs; OFX/QFX when user provides them.

#### Data extraction
- **Parser profiles per institution/template:** Each profile normalizes institution-specific quirks (summary sections, debit/credit splits, encoding) into a stable interchange format.
- **Normalized row schema:** posting date, amount (signed), description, optional reference ID (FITID), provenance pointer.
- **Metadata extraction:** Institution name, account type and mask, statement period, opening/closing balance.
- **Parser confidence:** Tracked per file to inform review queue prioritization.

#### Layered architecture
1. **Per-source adapters** — Institution-specific: BoA checking CSV, Citi/Chase card CSV, PDF profiles. Each adapter normalizes to interchange format; does not write business rules.
2. **Canonical ingest service** — Single write path: applies dedupe, classification, and transfer detection policies. Keeps correctness logic in one place as new adapters are added.
3. **Staged disk storage** — Files retained in `data/imports/<sessionId>/` for re-parse, audit, and recovery. Operator cleanup script planned for space reclamation (Story 2.4, backlog).

### 3.2 Transaction Categorization (FR-4, CATEGORIZATION_ROADMAP)

#### Category taxonomy
- **Global defaults** (household_id IS NULL): stable set of parent and leaf categories (13 parents, ~50 leaf categories).
- **Top-level buckets:** Income, Shopping, Home, Mobility, Borrowing, Investments, Healthcare, Food, Insurance, Education, Giving, Taxes, Transfers, Loans, Travel, Utilities.
- **Leaf categories** only: Rules assign to leaf categories; parents are grouping.
- **Household categories:** Household-scoped overrides or custom categories allowed; deferred to Phase 2 for UI maturity.

#### Classification rules
- **Import-time assignment:** Database rules (household + global defaults) applied at canonicalize; first match wins.
- **Match types:** `contains`, `prefix`, `regex` (regex only in manually maintained household rules).
- **Conservative approach:** Unknown categories go to "Needs Review" queue, never silent assignment to a default.
- **Rule learning UI:** Test descriptions and preview how rules would classify a parsed session (dry-run before canonicalize).
- **Recategorize action:** User can apply updated rules to existing posted transactions without re-importing.

#### Optional AI categorization (deferred)
- Primary path is rule-based; no AI in core MVP flow.
- Tiers B–D (fuzzy matching, lightweight ML, cloud LLM) are optional future enhancements compatible with air-gap design.
- When LLM is configured (Section 3.6), it fills gaps only when rules fail, not as the default.

### 3.3 Deduplication and Transfer Detection (FR-3, FR-5, FR-6)

#### Strict dedupe policy
- **Exact duplicate fingerprint:** `SHA256(household_id + account_id + txn_date + rounded_amount + normalized_description)`.
- **FITID match (OFX/QFX):** Checked first when available (stronger than fingerprint).
- **Exact match behavior:** Insert with `status = 'duplicate'`; create resolution item for user to keep or trash. Nothing is silently dropped.
- **Near-duplicate:** Compatible amount + date + description; marked with resolution item but no canonical row inserted unless user confirms.
- **In-session dedup:** Duplicate rows within a single file are silently skipped (idempotency guard).

#### Transfer detection
- **Credit card purchase:** Expense recognized at purchase; liability increases.
- **Credit card payment:** Checking decreases; liability decreases; no expense recognized.
- **Loan payment:** Principal vs. interest split when line items available; unresolved with reasonable defaults when data is sparse.
- **Confidence thresholds:** Conservative match only when account ownership and amount/date proximity align.
- **Unresolved transfers:** Appear in Needs Review for user confirmation before finalization.

#### Idempotency and safety
- Re-running canonicalize on the same session: all rows caught by idempotency guard (no duplicate DB inserts).
- Re-importing the same file in a new session: rows detected as exact duplicates, inserted with `duplicate` status for user review.
- Undo capability: session rollback allowed while session is in `review` state, before finalization.

### 3.4 Review and Correction Workflow (FR-6, FR-7, FR-8)

#### Import Inbox and Needs Review
- **Single "Import Inbox":** All processed files and their outcomes (success, warnings, resolution counts).
- **Transactions → Needs Review tab:** Aggregated view of all rows requiring action:
  - Uncategorized rows (no category assigned).
  - Open resolution items (duplicate ambiguity, transfer ambiguity, reconciliation mismatch).
  - Rows blocked from posting (import/staging errors).
- **Rationale:** Not just unknown categories; breakdown by resolution type when many rows sit in review.

#### Bulk actions
- **Approve selected:** Mark rows as reviewed; post to ledger if all checks pass.
- **Bulk categorize:** Assign same category to selected rows without per-row navigation.
- **Bulk mark transfer:** Tag multiple rows as confirmed internal transfers.
- **Assign to user:** Scope ownership to a household member.
- **Approve all high-confidence:** One-click action for rows above confidence threshold.

#### Inline correction
- **Edit grid:** Per-row adjustment of category, tags, notes, amount (with audit trail).
- **Category picker:** Hierarchical (parent/child) search-driven picker inline on rows (preferred over dedicated page navigation for common case).

#### Manual entry
- **Add single transaction:** Form-based entry for non-statement rows (transfers between external accounts, cash corrections).
- **Batch edit:** Reopen finalized rows for correction entries (explicit reason logged).

#### Undo and safety
- **Import session rollback:** Allowed until "Finalize Review" (terminal state).
- **Optional time-based undo:** Future enhancement (30-minute window before final lock).
- **Post-finalization changes:** Require correction entries with explicit reason.

### 3.5 Dashboard and Reporting (FR-9, FR-9b)

#### Home dashboard (KPIs)
- **Scope selector:** All accounts vs. one account (dropdown/selector, visually primary).
- **Inflows / Outflows / Net:** Sum of posted credits, sum of posted debits, inflows − outflows for selected preset window (calendar month, YTD, rolling 30/90).
- **Savings rate:** When inflows > 0: `(inflows − outflows) ÷ inflows`, rounded to two decimal places, displayed as percentage.
- **Safe-to-spend:** Shown when household sets `monthly_savings_target_usd`. Net for the window minus `monthly_target × (calendar days ÷ ~30.437)`. Prorates monthly target to other preset windows.
- **KPI tooltips:** **(i)** info icon on each tile; hover/keyboard focus reveals definition (not inline paragraph).
- **Savings target adjustment:** Live-updating slider; updates safe-to-spend before save.

#### Category breakdown and drill-down
- **By-category view:** Spending (outflows) and income (inflows) aggregated by parent and child categories.
- **Time windows:** Weekly, monthly, YTD, yearly, custom range.
- **Comparative views:** Current vs. prior week/month/year.
- **Drill-down:** Click a category to show all transactions in that category for the window.

#### Data density
- Data-heavy layouts acceptable by design when filters and labels preserve scanability.
- Sections and information hierarchy prioritized over aggressive minimalism.

#### Search (FR-9b)
- **Free-text search:** Merchant/memo/normalized description.
- **Ranking:** BM25 over local index (SQLite FTS5).
- **Structured filters:** Amount range, account, date window, status (integrated with search results).

### 3.6 Net Worth and Balance Sheet

#### Account balance snapshots
- **Snapshot storage:** `account_balance_snapshot` (per account, per date, balance amount, source).
- **Beginning/ending balances from statements:** Extracted at parse time and persisted as source = `import`.
- **Manual balance edits:** User can record balances for accounts without statement extraction.
- **Optional investment account snapshots:** Month-end optional; no transaction-level detail required.

#### Net Worth calculation
- **Net Worth = Assets − Liabilities**.
- **Assets:** Checking, savings, credit card grace balances (zero if full balance owed), investment accounts, other assets.
- **Liabilities:** Loan balances, mortgage balance, credit card outstanding balance.
- **Monthly trend:** Net worth charted over time from snapshots.
- **Shipped:** Net Worth page with time-slice snapshots and manual balance edits (API: `docs/API_REFERENCE.md` §Balance Sheet).

#### Future enhancements (backlog)
- Multi-time-slice comparison views.
- Denser persisted history independent of import events.
- Household-vs-member subtotal breakdown rows (filtering shipped in CR-064; subtotals deferred).

### 3.7 Payslips (FR-3.3, PAYSLIP_V1.md)

#### Scope and storage
- **Separate from ledger:** Bank import shows cash reality (net pay deposit); payslip module explains compensation (gross, taxes, deductions) on a different screen.
- **Dedicated storage:** `payslip_snapshot` (summary buckets + period metadata), `payslip_line_item` (individual earnings/deduction rows).
- **Not merged to ledger:** Prevents double-counting net pay unless user explicitly links.

#### Parser profiles (v1 shipped)
- **IBM Pay & Contributions:** OpenAI vision + JSON schema extraction.
- **Deloitte Pay Statement:** Same OpenAI vision path.
- **ADP:** Stub present; full line-item grids deferred.
- **Prerequisites:** `OPENAI_API_KEY`; Poppler (`pdftoppm` on `PATH`) for PDF rendering.

#### Async queue design (2026-06-03)
All LLM-based payslip profiles (`LLM_PAYSLIP_PROFILE_IDS`) are queued async during `POST /imports/sessions/:id/parse` — OpenAI extraction runs in the background and the UI polls every 2 minutes until files show "parsed." Previously IBM ran inline (synchronous OpenAI call during the HTTP request) while Deloitte was async — a design drift from when IBM used a local PDF library and Deloitte was the only LLM parser. Unified: both now queue async in the Import flow. Direct `POST /payslips/upload` for IBM retains inline extraction (no timeout risk in practice). `payslip-async-import-reconcile.service.ts` is now profile-agnostic; adding a new LLM payslip profile only requires adding it to `LLM_PAYSLIP_PROFILE_IDS`.

#### Data extraction (v1)
- **Pay period:** Date range and pay date.
- **Compensation buckets (current + YTD):** Gross Pay, Pre-Tax Deductions, Post-Tax Deductions, Employee Taxes, Net Pay, Taxable Earnings, Other Information, Hours/Days Worked.
- **Per-row line items:** Grouped by section (earnings, pre-tax deductions, tax deductions, post-tax deductions, other deductions, other information, taxable earnings). Each row: name, authority, hours/days, rate, amount current + YTD.
- **Hybrid storage:** Full `canonical_extract_json` (LLM output) stored for audit and future UI correction.

#### UI and features (v1 shipped)
- **List view:** Payslips with summary cards (gross, net, pay period).
- **Detail view:** Period card, Amounts table (with conditional Taxable Earnings and Other Information rows), Line Items accordion (collapsed by section; shows Hours + Rate columns only when applicable).
- **Upload:** Single PDF or import via Import session; profile auto-detection with user confirmation.
- **Manual entry:** Form for payslips without PDF parse (`POST /payslips/manual`); same snapshot shape as uploads.
- **Income charts:** YTD gross, net, tax trends on `/payslips` list.
- **Bank deposit matching (CR-068):** `GET /payslips/:id` returns confirmed and suggested deposits (±7/±10 days, 1% variance); links stored; detail UI shows deposit card with confirm/remove actions and "Search ledger…" modal for manual matching.

#### Phased roadmap (backlog)
- **PS-1 (V3):** Payslip month-over-month delta badges (↑/↓/— for net pay, gross, taxes, deductions vs. prior period).
- **PS-2 (V3):** Estimated tax sufficiency — annualized withholding rate alert; flags if dangerously low vs. threshold.
- **V4 (deferred):** Analytics integration — payslip deduction line items wired into AI insights and true savings rate (including 401k/IRA/ESPP/HSA withholdings).
- **Manual per-row line item entry:** Full form for adding individual earnings/deduction rows manually (not yet shipped; impacts line item aggregation).

### 3.8 Year-in-Review / AI Financial Health Dashboard (FR-13, PRD §18)

#### Overview
On-demand AI analysis panel on Home page. Household owner configures AI provider and API key in Settings, along with personal profile. Clicking "Refresh Analysis" sends a curated financial summary to the configured AI; result cached until user refreshes.

#### Design decisions
- **Provider:** User-selectable (OpenAI or Anthropic Claude); user supplies own API key; no vendor hard-coded.
- **Trigger:** On-demand only ("Refresh Analysis" button); never auto-runs on page load.
- **Privacy:** Data leaves device only when user explicitly clicks Refresh; user consents by configuring API key.
- **Caching:** Server-side cached per household; all members can view latest analysis without triggering new API call.

#### Analysis input (sent to AI)
- **User profile:** Age, gross annual salary, risk tolerance, stated financial goals.
- **Net worth snapshot:** Total assets, liabilities, net worth (from balance sheet).
- **Income/expense trend:** Last 12 months of category-level aggregates; inflows, outflows, top 10 spending categories.
- **Savings rate trend:** Last 12 months.
- **Budget vs. actuals:** Current month and last 3 months.
- **Account inventory:** Which account types present; gaps noted.
- **Household context:** Number of household members.

#### Analysis output (structured sections)
1. **Overall health rating:** Strong / On-track / Needs attention / At risk (label + one-sentence rationale).
2. **What's working well:** 2–4 bullet points.
3. **Areas of concern:** 2–4 bullet points.
4. **Top expense reduction opportunities:** Up to 3 category-level observations.
5. **Investment/product gaps:** Missing account types or savings evidence.
6. **Demographic benchmark note:** AI reasons against age/income bracket benchmarks (non-prescriptive).
7. **Actionable next steps:** 2–3 concrete recommendations.

#### Settings — Financial Insights sub-tab
- AI provider: OpenAI / Anthropic Claude (select).
- API key (encrypted at rest; masked in UI after save).
- Model preference (defaults per provider, e.g., `gpt-4o`, `claude-sonnet-4-6`).
- Age (years).
- Gross annual salary (USD).
- Risk tolerance: Conservative / Moderate / Aggressive.
- Primary financial goals: Multi-select (build emergency fund, pay off debt, save for home, invest for retirement, grow wealth, other).

#### UI — Home Page Additions
- **Financial Health card** below KPI tiles.
- Displays: last analysis timestamp, health rating badge (color-coded), narrative sections (collapsible by section).
- **Refresh Analysis button:** Shows spinner and disabled state during generation (estimated 10–30s).
- **Unconfigured state:** "Configure AI in Settings" prompt with link.

#### Technical requirements
- **Backend:** Assembles curated prompt; calls AI API (not frontend).
- **Database:** `household_ai_insight` (household_id, generated_at, provider, model, payload_json, prompt_version).
- **One active insight per household:** Prior insights overwritten on refresh.
- **Prompt versioning:** Tracked to flag stale results from old prompt structures.
- **Timeout:** Best-effort async; 60s timeout with user-visible error on failure.

### 3.9 Recurring Payments (Backlog, PRD non-goals Phase 1)

Not in MVP scope. Future enhancement for subscription tracking and bill management.

### 3.10 Notifications (Backlog, PRD non-goals Phase 1)

Not in MVP scope. Future enhancement for alerts (unusual spending, bills due, reconciliation mismatches).

### 3.11 Multi-Person Household (Phased, RBAC)

#### RBAC model
- **Owner/Admin:** Full visibility (all members, accounts, transactions); upload, import, approve, edit, delete; manage household structure and settings.
- **Member:** Own data only by default (own accounts and transactions); upload own statements; cannot manage household structure or settings.
- **Staff (added §20):** Restricted to "My Timesheet" and "My Expenses" tabs only; no access to financial data or household settings.
- **Read-only:** Deferred to Phase 2.

#### Identity and membership model (locked design)
- **Separate authentication from person profile:**
  - `user_account`: Login/security (email, password hash, sessions).
  - `person_profile`: Human attributes (name, phone, avatar/icon) and ownership attribution.
  - `household_membership`: Links person to household with role and relationship (head, spouse, child, member).
- **Person without login:** A household person may exist without login credentials (e.g., child/dependent); login can be added later.

#### Data visibility
- **Owner/head sees all.**
- **Members see own by default.**
  - **Payslips:** Members see and may edit only payslips where `owner_person_profile_id` matches their own profile. Attempting to read or patch another member's payslip returns 404/403.
  - **Accounts:** Members see household-scoped accounts plus their own person-scoped accounts. Other members' person-scoped accounts are not returned.
  - **Export jobs:** Members may download only export jobs they created (`requested_by_user_id`). Full household exports created by owner/admin are not accessible to members. Restore is owner-only (full wipe).
  - **Payslip create:** Members may only create payslips for their own profile; `ownerPersonProfileId` from the request body is ignored and forced to the member's own profile.
- **Household-level dashboards:** Consolidated for all members; family-level spending/income aggregates.
- **Account and transaction assignment:** Transactions assigned to a household member for attribution (even if that person has no direct login).

#### Household settings
- **Household name and identity.**
- **Monthly savings target (USD):** Used for safe-to-spend calculation (prorated to selected time window).
- **Mileage reimbursement rate (USD/mile):** For staff timesheet processing.

### 3.12 Household Staff Module (FR-15, PRD §20)

#### Overview
Time-and-expense reporting for household employees (nanny, cleaner, au pair). Staff is a restricted RBAC role; staff see only "My Timesheet" and "My Expenses" tabs. Owner/admin manages staff profiles, reviews and approves entries, records payments, and optionally posts to ledger.

#### Staff role capabilities
- Permitted: `GET/POST /staff/timesheets/*`, `GET/POST /staff/expenses/*`, `GET /staff/profile` (own only).
- Blocked: Home, Transactions, Import, Reports, Budget, Categories, Settings.

#### Staff management (Settings > Staff sub-tab, owner/admin only)

**Add/edit staff:**
- Name, email, phone.
- Hourly and overtime rates (USD).
- OT threshold: daily (>8h/day) or weekly (>40h/week).
- Pay period type: weekly / biweekly / semi-monthly / monthly.
- Pay period anchor date.
- Household expense category for wage payments.
- Deactivate/reactivate (preserves history; deactivated staff cannot log in).

#### Staff view — "My Timesheet"
- **Time entry:** Clock in/out or manual entry (date, start, end, break minutes).
- **Auto-calculation:** Regular vs. OT hours per configured threshold.
- **Editable until:** Pay period submitted.
- **Pay period submission:** Locks entries; staff views history of past submitted/approved/rejected periods.

#### Staff view — "My Expenses"
- **Expense entry:** Date, category (groceries, supplies, activities, transportation, parking, other), amount, description.
- **Mileage entry:** From, to, purpose, distance (miles); auto-calculated at household mileage rate.
- **Status tracking:** Pending / Approved / Rejected with notes.

#### Admin review (Settings > Staff > [Staff Name])
- **Timesheet review:** Submitted periods with hours preview; approve or send back with comment.
- **Expense review:** Approve or reject with reason (individual or bulk).
- **Payment recording:** Date, amount, method (cash, check, Venmo, bank transfer, Zelle, other), notes.
  - Checkbox: "Post to household ledger" → creates `transaction_canonical` (debit, configured category, description: "Staff wages – [Name] [period]").
  - Separate checkbox: "Post approved expenses to household ledger" → individual rows per expense item.
- **Payment history:** Ledger per staff member (date, amount, method, notes, ledger-posted status).

#### Admin summary page (Settings > Staff)
- Per-staff card: hours owed, expenses awaiting payment, total outstanding balance.
- YTD totals per staff: wages paid, expenses reimbursed.
- Open items alert: count of submitted timesheets awaiting review, count of pending expenses.

#### Database tables
- `staff_profile`: User, rates, OT threshold, pay period config, expense category, active status.
- `timesheet_entry`: Clock in/out or manual entry; draft/submitted/approved/rejected status.
- `timesheet_period`: Period metadata (start, end), approval status, sent-back notes, aggregated hours and gross pay.
- `staff_expense`: Expense or mileage entry; pending/approved/rejected status with review notes.
- `staff_payment`: Payment record with optional FK to `transaction_canonical` if posted to ledger.

### 3.13 Real Estate and Property Tax Protest (RE-1, PT-1)

#### Real Estate Portfolio
- **Data model:** `property` table (address, use, purchase price/date, monthly rent, notes, `photo_url`). `property_value_snapshot` for AVM timeseries.
- **Valuation provider:** Redfin via RealtyAPI.io. Parsed fields: AVM, tax history, comps, county, exterior photo URL, stories, property type.
- **DCAD async backfill (TX only):** At property add time, a fire-and-forget call to TrueProdigy public DCAD API populates protest worksheet comps. Errors logged, never block the create response.

#### Multi-County CAD Reference Data

| State | County | CAD / Assessor Portal | Appeal Process |
|-------|--------|-----------------------|----------------|
| TX | Denton | DCAD (`uentral.com` / TrueProdigy) | ARB (Appraisal Review Board) |
| TX | Harris | HCAD | ARB |
| TX | Travis | TCAD | ARB |
| TX | Collin | CCAD | ARB |
| TX | Any other | `[County] CAD` | ARB |
| TN | Shelby | Shelby County Assessor — `assessormelvinburgess.com` | Board of Equalization |
| TN | Any other | `[County] Assessor` | County Assessment Appeal |

**Shelby County (Memphis, TN) data sources:**
- Property detail: `assessormelvinburgess.com/propertyDetails?parcelid={parcelId}&IR=true`
- Owner name search: `assessormelvinburgess.com/realPropertyDetails?FirstName=...&LastName=...&active=owner&Page=property`
- Appeal: Board of Equalization (different process from TX ARB)

#### Property Tax Protest Assistant (PT-1 through PT-17)

**Chat pipeline:**
- GPT-4o (configurable via `OPENAI_MODEL`) with OpenAI tool use.
- Tools: `fetch_dcad_comps`, `refresh_redfin_comps`, `search_web` (Tavily), `update_strategy`.
- System prompt injects: property facts, CAD assessed value, parsed CAD evidence packet (§41.41 sales comps + §41.43 equity comps with medians), per-comp annotation notes, Redfin sold comp research notes, cross-year cycle summary.
- Conversation stored as `conversation_json JSONB` on `protest_worksheet`. Strategy stored as `strategy_json JSONB`.

**Protest status flow:**
- `not_filed → filed → informal → arb → resolved` (linear) with branching outcomes: `settled_informal`, `won_arb`, `lost_arb`, `withdrawn`.
- Contextual action buttons per status. Resolved state shows outcome badge + savings summary.

**CAD evidence (PT-9):**
- Upload official DCAD evidence packet PDF. Text extracted + parsed with GPT-4o into `cad_evidence_json JSONB`: subject facts (assessed, improvements, land, % good, sqft, year built), 3 §41.41 sales comps with medians, 5 §41.43 equity comps with medians.
- Dual approach: structured JSON for precise prompt injection; also chunked into pgvector for narrative RAG retrieval (see D-019).

**CAD adapter pattern (PT-14):**
- `CadAdapter` interface with `searchByAddress()`. `DcadAdapter` (Denton County, TX via TrueProdigy public API) is the only shipped implementation.
- Registry in `cad-adapters/registry.ts` — adding a new county = one new adapter file + registry entry. See D-020.

**Comp management (PT-10, PT-11, PT-15):**
- Add/remove equity comps directly from protest page. Notebook icon on every comp row for free-text annotation notes passed to AI system prompt.
- Auto-fetch DCAD assessed values for Redfin sold comps on refresh (`sold_comps_cad_json JSONB`). Surfaces CAD Assessed + §41.43 Ratio columns in Market Value table (TX only).

**RAG document store (PT-12):**
- `protest_document_chunks` table with pgvector `vector(1536)` embeddings. HNSW index for approximate cosine similarity search.
- Arbitrary uploads: PDF (text extracted) or image (GPT-4o vision description). Chunked at 300 words / 40-word overlap. Embedded with `text-embedding-3-small`.
- Chat retrieves top-5 similar chunks per user message, injected into system prompt as context. See D-019.

**Conversation summarization (PT-12):**
- Rolling summarization: when live turns exceed 30 since last cursor, oldest 10 turns compressed async with `gpt-4o-mini`. Stored as `conversation_summary TEXT` + `summarization_cursor INT`. See D-021.
- Cycle summary: on protest close (terminal outcome), `gpt-4o-mini` generates a ≤200-word summary stored as `cycle_summary TEXT`. Injected as "Prior year context" into next year's system prompt.

**ARB oral script (PT-17):**
- `POST /api/protest/:propertyId/generate-arb-script` — available when `status = 'arb'`.
- GPT-4o generates 6-step oral hearing script: negotiation thresholds (open ask / ideal settle / walk-away min), §41.41 and §41.43 arguments, IF/THEN appraiser rebuttals, closing ask, panel Q&A.
- Uses all available evidence: CAD evidence packet, equity comp notes, Redfin research notes, AI strategy. Persisted to `arb_script_json JSONB`.

**Evidence packet generation (PT-4, PT-4b):**
- PDF: cover page, DCAD comps table, Redfin sold comps table, horizontal $/sqft bar chart.
- Word (.docx): ARB Board section + Protestor Reference Sheet with oral script, negotiation table, quick-reference card.

**Filing deadline and notifications (PT-5):**
- `filing_deadline DATE` and `cad_portal_url TEXT` on `protest_worksheet`.
- In-app + email notifications at 30/7/1 days before filing deadline and hearing date. Deduped per 2-day window.

### 3.14 Export, Backup, and Restore (FR-11, PRD §19)

#### Manual export/restore
- **Export:** `POST /exports/household` downloads ZIP bundle (`.hfb`, export version 4).
- **Restore:** `POST /exports/household/import` (upload ZIP); restores tables, categories, rules, and transaction history.
- **Restore history:** Table of last 5 jobs (status, timestamp, stats).

#### Automated cloud backup (Phase 1 = Google Drive only)

**Settings — Backup & Restore Tab:**

**Section A — Manual Export/Restore:**
- "Export household data" button → ZIP download.
- "Restore from file" upload → `POST /exports/household/import`.
- Restore history table.

**Section B — Google Drive Backup:**
- "Connect Google Drive" button → OAuth 2.0 flow (scope: `drive.file`).
- Connected state: Google account email + "Disconnect" button.
- Configuration:
  - Backup folder path in Drive (default: `HouseholdFinanceBackups/`).
  - Frequency: Daily / Weekly (day-of-week) / Monthly (day-of-month).
  - Keep last N backups in Drive: 1 / 3 / 5 / 10 / unlimited.
  - Keep last N local export jobs: prunes old `export_job` rows and ZIPs.
- "Backup Now" button: manual trigger.
- Last backup status: timestamp, file name, Drive link, size.
- Backup history: date, file name, size, location (local/Drive), status (success/failed).

#### Backend additions
- **Tables:** `cloud_backup_credential`, `backup_schedule`, `backup_job`.
- **API routes:** OAuth start/callback, credential management, schedule read/write, job trigger and history.
- **Worker:** Runs per schedule; calls export pipeline; uploads to Drive; prunes old backups; updates schedule next_run_at.

#### Security and format
- **Format:** Same **`.hfb`** payload as HTTP export (export version 4).
- **Optional encryption:** AES-GCM via `BACKUP_ENCRYPTION_KEY` env var.
- **OAuth tokens:** Encrypted at rest (AES-256 with key from `JWT_SECRET` or dedicated `ENCRYPTION_KEY`).
- **Refresh token rotation:** Automatic (Google rotates periodically).
- **Naming:** `household-backup-{YYYY-MM-DD-HHmm}-{householdShortId}.zip`.

#### Phase 2 (backlog)
- OneDrive (Microsoft OAuth 2.0 + Graph API; same job runner abstraction).

---

## 4. Architecture Decisions Log

### D-001: Base Platform Choice
**Date:** 2026-03-23  
**Decision:** Use Actual Budget as the base platform.  
**Context:** Need modern household UX and budgeting-centric reporting with open-source flexibility.  
**Consequence:** Avoid rebuilding ledger/reporting core from scratch.

### D-002: Ingestion Strategy
**Date:** 2026-03-23  
**Decision:** Build custom ingestion pipeline for PDF/CSV/Excel normalization.  
**Context:** PDF is primary input; native PDF support in base products is insufficient.  
**Consequence:** Extra implementation complexity, but critical workflow fit.

### D-003: Privacy and Deployment
**Date:** 2026-03-23  
**Decision:** Self-hosted, LAN-first, air-gapped capable design.  
**Context:** Financial data sensitivity and user preference.  
**Consequence:** No dependency on external OCR/AI APIs for core path; optional AI for insights only.

### D-004: Deduplication Policy
**Date:** 2026-03-23  
**Decision:** Strict dedupe by deterministic fingerprint + unresolved queue for ambiguities.  
**Context:** Duplicate transactions are high-risk and unacceptable.  
**Consequence:** Conservative posting behavior; possible manual review for edge cases; nothing silently dropped.

### D-005: Review Workflow
**Date:** 2026-03-23  
**Decision:** Single import inbox with bulk actions and resolution queue.  
**Context:** User rejects per-transaction approval toil.  
**Consequence:** Requires grid/bulk UX and batched operation support.

### D-006: Transfer Semantics
**Date:** 2026-03-23  
**Decision:** Separate expense recognition from settlement transfer.  
**Context:** Avoid double-counting credit card and loan payment flows.  
**Consequence:** Transfer matcher and confidence-based resolution logic required.

### D-007: Data Retention
**Date:** 2026-03-23  
**Decision:** Purge raw PDFs after successful extraction + validation checkpoint.  
**Context:** Privacy requirements and storage minimization.  
**Consequence:** Need explicit retention worker and failure-safe behavior; operator cleanup script (Story 2.4) for staged-import files.

### D-008: Phase 1 Scope
**Date:** 2026-03-23  
**Decision:** USD-only reporting; India/FX deferred.  
**Context:** Reduce MVP complexity and time-to-value.  
**Consequence:** Multi-currency model designed now, enabled later.

### D-009: Build Quality
**Date:** 2026-03-23  
**Decision:** Robustness-first execution (not quick throwaway MVP hacks).  
**Context:** Financial correctness is critical.  
**Consequence:** Strong testing and reconciliation gates required before release.

### D-010: Database and Search Strategy
**Date:** 2026-03-23  
**Decision:** Use Postgres as the system-of-record DB (SQLite in WAL mode was original MVP choice; production uses Postgres 18).  
**Context:** Local-first deployment, low user concurrency (2–4 users), air-gapped operation.  
**Consequence:** Repository/search abstractions clean so alternative backends can be added later without rewriting domain logic. Search: indexed numeric/date filters + text search abstraction.

### D-011: MVP Defaults for Open Questions
**Date:** 2026-03-23  
**Decision:** Reconciliation mismatches warn-only in MVP (not finalization-blocking); category taxonomy starts compact with modular extension support; first parser profiles: BoA checking, Citi credit cards, Chase credit cards; low-confidence ownership defaults to household head.  
**Context:** Reduce MVP friction while preserving finance correctness.  
**Consequence:** Faster implementation path with explicit defaults.

### D-012: Per-Institution Adapters + Single Canonical Ingest Path
**Date:** 2026-03-24  
**Decision:** Split ingestion into (a) per-bank/format adapters producing normalized rows, and (b) single canonical ingest service persisting and deduping. Do not attempt one parser for all institutions.  
**Context:** Real-world exports (BoA summary sections, Citi Debit/Credit columns, Chase activity CSV) cannot be reliably mapped by one generic mapper without high error risk.  
**Consequence:** Higher upfront adapter count for top institutions, but lower systemic risk and stable core logic.

### D-013: Home = Cash Dashboard; Import Not in Primary Nav
**Date:** 2026-03-24  
**Decision:** Authenticated home route (`/`) is the cash/KPI dashboard. Import is started only from header "New import" action — no Import item in primary nav. `/dashboard` redirects to `/` for bookmarks.  
**Context:** Users should land on decision metrics after login; import is secondary to ongoing cashflow review.  
**Consequence:** Simpler IA; reduced duplicate entry points.

### D-014: Category Management IA — Two-Tier, No Merge
**Date:** Accepted 2026-03-27 (Decision DOC-008 in CHANGE_HISTORY.md)  
**Decision:** Two-tier IA (no merge with ledger hub for MVP):
- **Primary hub:** Transactions (`/transactions`). Inline category picker for row-by-row assignment.
- **Secondary:** `/categories` (full-tree browse, add parents/children). `/categories/rules` (dedicated route for pattern rules, not row-by-row assignment).  
**Context:** Original tension: full category tree page vs. ledger picker seemed duplicative. **Resolution:** Picker covers common case; Categories + Rules cover taxonomy and automation — complementary roles.  
**Consequence:** Sidebar keeps Categories; taxonomy expansion independent of this IA choice.

### D-015: Ledger Category Display
**Date:** 2025-03-25 (Decision PRD-001 in CHANGE_HISTORY.md)  
**Decision:** On the Ledger table, category control shows only assigned category name (one line), whether parent or leaf. Visual differentiation (muted gray vs. strong blue) replaces "Parent › Child" display.  
**Context:** User feedback — stacked parent/child made rows too tall.  
**Consequence:** Deviates from optional display in Story 5.3; full path could return later via tooltip.

### D-016: Ledger Table — Omit Status Column
**Date:** 2025-03-25 (Decision PRD-001 in CHANGE_HISTORY.md)  
**Decision:** Transactions ledger view does not show Status column (posted/pending/etc.).  
**Context:** User preference — not useful in this view; saves horizontal space.  
**Consequence:** Any wireframes assuming a status column on the ledger are out of date.

### D-017: Safe-to-Spend and Savings Rate — Windowed Cash Summary
**Date:** 2026-03-27 (Decision PRD-002 in CHANGE_HISTORY.md)  
**Decision:** Implement safe-to-spend and savings rate on `GET /reports/cash-summary` using posted inflows/outflows for selected preset window. Safe-to-spend = net − prorated monthly savings target. Savings rate = (inflows − outflows) ÷ inflows with two-decimal ratio rounding.  
**Context:** PRD §8 "first release" line describes MTD only; shipped API supports rolling 30/90, calendar month, YTD.  
**Consequence:** PRD §8 now includes MVP shipped formulas. Deviation and rationale in CHANGE_HISTORY.md PRD-002.

### D-018: External PFM Inspiration — UX Patterns vs. Feature Parity
**Date:** 2026-03-28 (Decision DECISIONS_LOG.md D-018)  
**Decision:** Treat consumer cloud PFM products (Quicken Simplifi, Rocket Money, Mint/Credit Karma) as reference for positioning, copy tone, and sectioning patterns only — **not** as feature backlog.  
**Consequence:** Ongoing UX/copy improvements may cite PFM_COMPETITIVE_UX_REFERENCE.md; no obligation to match commercial feature matrices.

### D-019: pgvector RAG for Protest Document Store — Rejected LLM-Side Storage
**Date:** 2026-06-02 (PT-12)  
**Decision:** Store protest document chunks + embeddings in Postgres (`protest_document_chunks`, `vector(1536)`, HNSW index). Retrieve top-K similar chunks per chat message and inject into system prompt. Rejected: Claude Projects, OpenAI Assistants API file storage.  
**Context:** LLM-side storage creates vendor lock-in, limits cross-year and cross-session retrieval, and gives no control over what gets injected. pgvector keeps data under household ownership, works with the existing Postgres stack (both local Docker and Koyeb managed), and allows deterministic similarity thresholds. `protest_document_chunks` is registered in `EXPORT_EPHEMERAL_TABLES` — embeddings are regenerable, excluded from backup payload.  
**Consequence:** `CREATE EXTENSION vector` required on Postgres. Local dev uses `pgvector/pgvector:pg18` Docker image. Koyeb managed Postgres (Neon-backed) supports `vector` natively. Chunking at 300 words / 40-word overlap; embedding model configured via `EMBEDDING_MODEL` env var (default `text-embedding-3-small`, 1536 dims — changing requires DB migration + re-embed). RAG search tunable via `RAG_TOP_K` (default 5) and `RAG_MIN_SIMILARITY` (default 0.65). CAD evidence PDF gets dual treatment: structured JSON extraction for precise prompt injection + raw text chunked for RAG narrative retrieval.

### D-020: CAD Adapter Pattern — Generic County Extensibility
**Date:** 2026-06-01 (PT-14)  
**Decision:** Abstract all county CAD API calls behind a `CadAdapter` interface (`searchByAddress`, `getValueHistory`, `getTaxable`, `getAppeal`). `DcadAdapter` (Denton County, TX via TrueProdigy public API) is the only shipped implementation. Registry in `cad-adapters/registry.ts` maps provider string → adapter instance.  
**Context:** Initial implementation hardcoded DCAD-specific field names (`pid`, `appraisedValue`, `pAccountID`) and API behavior (short-lived public JWT, browser-mimicking headers) throughout the protest module. This made adding Harris County (HCAD) or other counties require deep changes. The adapter pattern isolates all county-specific logic to one file per county.  
**Consequence:** DB columns renamed to generic `cad_property_id`, `cad_account_id`, `cad_provider` (migration 0061). Adding a new county = one new adapter file + one registry entry, no other changes. HCAD and Travis County adapters are in the deferred backlog (PT-6).

### D-021: Protest Chat — Rolling Summarization Over Sliding Window
**Date:** 2026-06-02 (PT-12)  
**Decision:** When live conversation turns (since last summarization cursor) exceed 30, compress the oldest 10 turns into a running `conversation_summary TEXT` using `gpt-4o-mini`, advance `summarization_cursor`, and store both on `protest_worksheet`. Rejected: sliding window (drop oldest N turns without summarization).  
**Context:** Sliding window loses information silently — comp prices mentioned early in a session, negotiation context, user-stated constraints. A protest conversation is research-dense; losing early turns means the AI re-asks questions already answered. True summarization preserves key facts (values, comps, decisions) at low token cost (~800 tokens output). Cycle summary (generated on protest close, injected as "Prior year context" next year) gives multi-year continuity without replaying full history.  
**Consequence:** Two async `gpt-4o-mini` calls possible per chat turn (summarization + cycle summary on close). Both are fire-and-forget after response is sent. `summarization_cursor INT` and `conversation_summary TEXT` and `cycle_summary TEXT` on `protest_worksheet` (migration 0064).

### D-022: Scheduler Anchoring — TZ=America/Chicago + node-cron for Wall-Clock Targets
**Date:** 2026-06-02 (FIX-TZ-1)  
**Decision:** Set `TZ=America/Chicago` as a required process environment variable (Koyeb env vars + `.env.example`). Schedulers with specific wall-clock targets (stock quote refresh at NYSE close) use `node-cron` with IANA timezone strings. Interval-based schedulers (GDrive backup heartbeat, realty valuation check, export file purge) remain as `setInterval` — they are elapsed-time checks with no time-of-day requirement.  
**Context:** Cloud servers (Koyeb) default to UTC. The stock quote scheduler used a narrow 5-minute UTC-window `setInterval` check that silently missed the window when the heartbeat misaligned with the start time. `TZ` env var anchors `new Date()` locale methods and log timestamps to CT. `node-cron` with explicit timezone handles DST transitions automatically with no UTC offset math.  
**Consequence:** NYSE close (4 PM ET / 3 PM CT) is expressed as `15 16 * * 1-5` with `timezone: 'America/New_York'` in `node-cron` — New York tz is correct since market hours are defined in ET regardless of where the app is hosted. OPS-1/2/3/4 backlog items will migrate remaining interval schedulers to node-cron with CT-anchored times.

---

## 5. Categorization System Design

### Default Category Taxonomy (Source of Truth)

**Location:** `backend/db/seeds/0001_bootstrap.sql` and migrations (e.g., migration 0029).

#### Top-Level Buckets (13 parents)
| Parent | Child Categories | Notes |
|--------|------------------|-------|
| **Income** | Salary, Interest, Dividends, Refunds, Rental income | All income types; deposits and credits. |
| **Shopping** | Groceries, Clothing, Electronics | Consumer goods and personal items. |
| **Home** | Housing, Furniture, Maintenance, Home improvement, Appliances, HOA Fees | All housing-related. |
| **Utilities** | Energy, City Water, Mobile phone | Ongoing household utilities (split from former Home, migration 0027). |
| **Mobility** | Public Transit, Auto Maintenance, Taxi | Transportation other than car ownership. |
| **Borrowing** | Credit card payments, Loan payments, Personal lending | Debt servicing and transfers. |
| **Investments** | Stocks, 529 plan, Real estate, Crypto | Investment accounts and transfers. |
| **Healthcare** | Medical, Pharmacy, Fitness, Wellness | Health and wellness spending. |
| **Food** | Dining out, Coffee, Snacks | Food and beverage beyond groceries. |
| **Insurance** | Home, Auto, Health, Life, Other | All insurance premiums. |
| **Education** | Tuition, Childcare, Activities, Camps | Learning and childcare. |
| **Giving** | Charity, Gifts | Charitable and gift giving. |
| **Taxes** | Federal income tax, State income tax, Sales tax, Refunds (both) | Tax payments and refunds. |
| **Transfers** | Transfers in, Transfers out | Internal household and external transfers. |
| **Loans** | Auto, HELOC, Home, Personal | Loan account categories (not payments). |
| **Travel** | Airfare, Car Rental, Hotel | Travel and lodging. |

#### Classification Rules
- **Leaf categories only:** Rules target leaf categories; parents are grouping labels.
- **Match types:** `contains`, `prefix`, `regex` (regex only in household rules, not defaults).
- **Precedence:** Household rules applied first; global defaults second; first match wins.
- **Unknown fallback:** If no rule matches, row inserted with null category and queued in "Needs Review".

### Rule Learning and Improvement

#### At canonicalize time
1. **Load household rules** (`category_rule` table) in priority order.
2. **Load global defaults** (`category_rule_global` table).
3. **Normalize description** (whitespace, case, punctuation).
4. **First match wins** — apply first matching rule's category.
5. If no match → insert with null category + `resolution_item(unknown_category)`.

#### Category Rules UI (`/categories/rules`)
- **Browse and filter** combined household + global rule list.
- **Test description:** Enter sample text/amount; preview what would match (dry-run without save).
- **Add or edit rules:** Household rules (pattern, match type, category, priority, confidence); admin can edit global built-in rules.
- **Session preview:** Paste import session ID; show how current rules would classify each raw row (dry-run for tuning before/after canonicalize).
- **Recategorize action:** Run `POST /categories/rules/recategorize` on all or uncategorized rows only; existing transactions updated without re-importing.

#### Fuzzy and AI enhancements (future tiers, optional)
- **Tier B — Fuzzy matching:** Address typos and noisy suffixes (e.g., RapidFuzz or TS equivalent).
- **Tier C — Lightweight ML:** Offline TF–IDF or small local model trained on user-labeled rows.
- **Tier D — Cloud LLM:** Only where policy allows (optional; not default).

### Non-Goals for Categorization
- No mandatory cloud APIs or third-party services.
- No ML in core MVP flow.

---

## 6. Competitive Reference (PFM Landscape)

### Source: `PFM_COMPETITIVE_UX_REFERENCE.md`

Grove does **not** target parity with commercial cloud PFM products (Quicken Simplifi, Rocket Money, Mint/Credit Karma). Instead, we borrow specific UX patterns while explicitly rejecting features that conflict with self-hosted design.

#### From Quicken Simplifi
- **Adopt:** Unified narrative (dashboard ↔ ledger ↔ import); forward-looking clarity; data-dense layouts with clear sectioning.
- **Reject:** Bank linking (primary onboarding), investment depth (snapshots only), subscription-based revenue.

#### From Rocket Money
- **Adopt:** Supportive, plain-language copy; clear "see where money goes" (spending breakdown via categories and filters).
- **Reject:** Subscriptions as primary hero, bill negotiation, concierge services.

#### From Mint's transition to Credit Karma
- **Adopt:** Data portability and clear communication when IA changes (documented in CHANGE_HISTORY.md).
- **Reject:** Cloud lock-in; single-vendor dependency.

#### What we explicitly do NOT emulate
- Subscription billing or revenue-driven feature gating.
- Bank aggregation as primary onboarding.
- Third-party bill negotiation or credit products.
- Cloud-required sync for core workflows.

---

## 7. Future Roadmap (Deferred Items and V3+ Backlog)

### Phase 2 (Planned / Backlog)

**Multi-currency and FX:**
- INR account ingestion and FX conversion reporting.
- Multi-currency dashboard aggregation.

**Tax and Projections:**
- Annual tax projection helpers.
- Estimated quarterly payment tracking.
- Income-tax-specific line items on payslips.

**Search and Indexing:**
- Attachment search/indexing.
- Full-text search enhancement (FTS5 abstractions to support OpenSearch as optional backend).

**Approval and Audit:**
- Approval workflow for transactions and budget changes.
- Full audit trails (who changed what, when).

**Advanced Rules:**
- Household-scoped category custom categories and taxonomy.
- User-level rule override (when person rules differ from household rules).

**Notifications:**
- Alerts for unusual spending patterns.
- Bill due reminders (if bill tracking added).
- Reconciliation mismatch notifications.

### V3 Backlog (P1–P3 priorities)

**P1 Bugs:**
- 7 items; all shipped (see `docs/BACKLOG.md` §V3 Shipped Items for full list).

**P2 Features:**
- Bulk pattern resolve with rule learning.
- Payslip MoM delta comparison (PS-1).
- Estimated tax sufficiency (PS-2).
- Wealthfront PDF support.
- Capital One UI fixes.
- Export registry cleanup.
- HttpOnly cookies and password reset flow.

**P3 Items:**
- RBAC tightening.
- Balance sheet subtotals (filtering shipped; subtotals deferred).
- Staff PDF pay stub generation.
- Mileage log export.

### V4 and Beyond

**Async Canonicalize:**
- Large imports benefit from `202 { jobId }` response with background worker and client polling.
- Avoids HTTP timeouts on slow LLM-backed parses.
- GitHub [#12](https://github.com/mangatrai/household-finance-app/issues/12).

**Payslip Analytics (3.3d):**
- Wire payslip deduction line items into AI insights and savings rate calculations.
- True total savings rate including 401k/IRA/ESPP/HSA withholdings.
- Wealth-building rate = total investment contributions / take-home.
- Blocked on reliable line item extraction across all supported parsers.

**Cloud Backup Phase 2:**
- OneDrive provider (Microsoft OAuth + Graph API, same job runner).

**Staff Module Phase 2:**
- PDF pay stub generation for staff.
- Mileage log export.
- Multi-household-member payroll summary.

**Advanced Search:**
- Deeper investment analytics.
- Custom tags and semantic search.

**Multi-Household Model:**
- Deferred pending email as canonical identity and household invites.
- `user_household_membership` join table designed; future shape documented.

### Explicit Non-Goals (Permanently Deferred or Rejected)

**14 items permanently dropped** (see `docs/BACKLOG.md` §Dropped Items):
- High-complexity features requiring significant ongoing maintenance.
- Features that conflict with self-hosted design.
- Nice-to-haves without strong user demand.

---

## 8. Shipped Features Summary

### Core Import (Stable)
- Multi-file upload and session management (checksum, stage to disk).
- Per-file financial account mapping and profile selection.
- BoA checking CSV, Citi/Chase credit card CSV and PDF profiles; IBM and Deloitte payslip PDF profiles.
- Batch parse to `transaction_raw`; batch canonicalize to `transaction_canonical`.
- Strict dedupe (fingerprint + FITID); duplicate resolution items; idempotent re-parse.
- Transfer detection and confidence scoring.
- Category classification via DB rules (household + global defaults).

### Dashboard (KPIs and Trends)
- Home (`/`) cash summary dashboard (inflows, outflows, net, savings rate, safe-to-spend).
- Scope selector (all accounts vs. one account).
- Preset time windows (calendar month, YTD, rolling 30/90).
- KPI tooltips with definitions.
- Savings target slider (live updates safe-to-spend).
- Category breakdown and drill-down.
- Net worth page with balance snapshots and manual balance edits.

### Ledger and Corrections
- Transactions list (`/transactions`) with tabs (All, Needs review).
- Inline memo edit and pencil reveal.
- Bulk delete (soft-delete to Trash, permanent delete).
- Bulk recategorize (Needs Review and All tabs).
- Open resolution items visible via row expansion (`GET /transactions/:id/open-review`).
- Bulk category and transfer assignment via `PATCH /resolution/:id`.

### Payslips
- Upload and import via import session.
- IBM and Deloitte PDF parsers (OpenAI vision + JSON schema).
- Manual entry (`POST /payslips/manual`).
- List, detail, and upload UI.
- Income charts (YTD gross, net, tax trends).
- Rich detail view with line items accordion.
- Bank deposit matching (confirmed and suggested deposits, 7–10 day window, 1% variance).
- Period, Amounts, and Line Items cards.

### Category System
- Default taxonomy (13 parents, ~50 leaves).
- DB rules (`category_rule_global` + `category_rule`).
- Category Rules UI (`/categories/rules`): browse, test, add/edit, session preview, recategorize.
- Hierarchical picker on Ledger (inline, no page nav).

### Household and RBAC
- Owner/Admin: full visibility and edit rights.
- Member: own data by default.
- Staff: "My Timesheet" and "My Expenses" tabs only.
- Household settings: name, monthly savings target, mileage rate.
- Household member assignment on accounts and transactions.

### Export and Backup
- Manual export (`.hfb` bundle, export version 4).
- Manual restore (`POST /exports/household/import`).
- Restore history table.
- Google Drive scheduled backup (OAuth, cloud credentials, schedule config, job history).
- Optional backup encryption (AES-GCM, `BACKUP_ENCRYPTION_KEY`).

### Settings
- Profile settings (`GET/PATCH /household/profile`): income, employers, avatar.
- Household settings (`GET/PATCH /household/settings`): monthly savings target, mileage rate.
- Backup & Restore tab: manual export/restore, Google Drive backup config.
- Financial Insights sub-tab: AI provider config, personal profile (age, salary, risk tolerance, goals).
- Staff sub-tab: add/edit/deactivate staff, review timesheets and expenses, record payments.

### API Completeness
- OpenAPI 3.0 spec in `openapi/openapi.yaml` (machine-readable).
- Human-readable reference: `docs/API_REFERENCE.md` (all domains in one file).

---

## 9. Known Limitations and [⚠ CHECK] Items

### [⚠ CHECK] Payslip Parsing Risks
- **Vision model misreading:** LLM may misread column alignment (Current vs. YTD, or currency placement). Full `canonical_extract_json` stored for audit; manual correction deferred.
- **Deloitte fallback:** If post-tax deductions still null, narrow fallback sums `other_deductions` rows marked as `OTHER DEDUCTION(S)` — may require prompt iteration.

### [⚠ CHECK] ADP Payslip Profile
- Stub present; full line-item grids and extraction deferred.

### [⚠ CHECK] Per-Row Line Item Manual Entry
- Full per-row manual entry for payslip earnings/deduction rows deferred; manual form captures summary-level fields only.

### [⚠ CHECK] Restore and Dangling Category IDs
- After restore, transactions may reference custom categories that no longer exist.
- Mitigation: Always `LEFT JOIN category`, never `INNER JOIN`.

### [⚠ CHECK] Chase/Citi CSV Parsers
- Vestigial; both banks use OFX in practice. Do not develop or test; OFX profiles preferred.

### [⚠ CHECK] Multi-Household Model
- Deferred; email is canonical identity; `user_household_membership` designed but not fully built.

### [⚠ CHECK] Trash / Soft-Delete Policy
- Soft-delete with restore semantics shipped (Trash tab, permanent delete).
- Restore retention policy and audit rules for soft-delete not yet defined; defer Phase 2 if not locked.

---

## 10. Documentation and Handoff

### Source of Truth Documents
- **`docs/CHANGE_HISTORY.md`:** Rolling CR/UX/FIX/DOC entries with stable IDs; PRD deviations logged.
- **`openapi/openapi.yaml`:** OpenAPI 3.0 spec for all HTTP endpoints (machine-readable).

### Relevant Internal Docs
- **`docs/ADMIN_GUIDE.md`:** System design, deployment, environment variables, DB architecture, import classification, caching, email. Consolidates former ARCHITECTURE.md, RUNBOOK.md, PRODUCTION_SETUP.md, ENVIRONMENT_VARIABLES.md, DATABASE_ARCHITECTURE.md, CACHING.md, IMPORT_CLASSIFICATION.md, EMAIL_INFRASTRUCTURE.md, HOSTING_OPTIONS.md, OCI_DEPLOYMENT.md.
- **`docs/BACKLOG.md`:** All backlog items (shipped V3/V4, active, deferred, dropped). Consolidates all *_BACKLOG.md files and V3/V4 plan documents.
- **`docs/USER_GUIDE.md`:** End-user workflows (import, ledger, dashboard, settings).
- **`docs/API_REFERENCE.md`:** Detailed endpoint behavior for all domains (Household, Ledger, Categories, Imports, Reports, Notifications, etc.).
- **`docs/CHANGE_HISTORY.md`:** Release notes and feature changelog (canonical source for what shipped and when).

### Product Memory (Recurring Notes)
- **Multi-household deferred:** Email identity and household invites not yet built.
- **Mantine migration rule:** Any page touched MUST be migrated to Mantine in same pass.
- **Restore category integrity:** `LEFT JOIN category`, never `INNER JOIN`.
- **Export registry:** Every new DB table must be registered in `EXPORT_REGISTRY`.
- **Commit convention:** One commit per logical concern; CR-/FIX-/UX-/DB-/DOC-/PRD- prefixes. Docs (CHANGE_HISTORY, API docs, OpenAPI) in same commit as code.

---

## 11. Product Constraints and Design Principles

### Financial Correctness
- No silent failures or dropped transactions.
- Strict dedupe with user-visible resolution queue.
- Conservative transfer detection; unresolved transfers appear in review.
- Reconciliation checks at import time (warn-only in MVP; tighten later).

### User Experience
- **Minimal post-import effort:** Bulk actions and grid edits, not per-row approval toil.
- **Data density:** Scannable layouts with clear labels and filters (not aggressive minimalism).
- **Clear mental models:** Category assignment on ledger; taxonomy and rules on dedicated pages.
- **Transparent action:** All edits, deletions, and corrections tracked; undo available in time window.

### Self-Hosted and Privacy
- **Air-gapped capable:** Core import flows do not require external services.
- **Raw file cleanup:** PDFs purged after extraction; audit trail retained.
- **Data portability:** Export/backup formats documented; third-party restoration possible.
- **Optional external services:** AI insights, Google Drive backup — user opt-in with own API keys; no vendor lock-in.

### Operational Simplicity
- **Monolith + worker deployment:** Single Node.js process + Postgres (or Postgres in prod, SQLite for single-user deployments).
- **Minimal infra dependencies:** No required cloud services, CDNs, or third-party APIs.
- **Robustness over speed:** Strong testing and reconciliation gates before release.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Canonicalize** | Transform raw parsed rows into normalized, deduplicated, classified transaction records (`transaction_canonical`). |
| **Dedupe** | Eliminate duplicate transactions using fingerprint (SHA256 hash) or FITID (OFX reference). |
| **Fingerprint** | SHA256 hash of household_id + account_id + date + amount + normalized_description; uniqueness key for transactions. |
| **Financial Account** | User-owned checking, savings, credit card, loan, or investment account. |
| **Household** | Family or group for which financial data is aggregated; one or more users have access. |
| **Inflows** | Posted credits (income, refunds, transfers in). |
| **Outflows** | Posted debits (expenses, transfers out, loan payments). |
| **Resolution Item** | Unresolved transaction-related issue (unknown category, duplicate ambiguity, transfer mismatch) surfaced in "Needs Review". |
| **RBAC** | Role-Based Access Control; Owner/Admin, Member, Staff roles with different data visibility and edit rights. |
| **Safe-to-Spend** | Net cashflow for the period minus prorated monthly savings target; discretionary spending power. |
| **Transaction** | Single cash flow event (debit or credit) posted to an account; can be categorized, tagged, and assigned to a household member. |
| **Transfer** | Internal household cash movement (not an expense) between owned accounts; excluded from income/expense aggregates. |

---

**Document Version:** 1.0  
**Last Updated:** 2026-05-25  
**Status:** Living document; updated with each major feature milestone or PRD deviation.
