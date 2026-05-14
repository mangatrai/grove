# Payslip module — product intent and v1 scope

**Epic alignment:** **Epic 3 — Story 3.3** (payslip / paystub), implemented in **phases**.  
**Current priority (March–April 2026):** payslip **summary parse + list + detail** (**`GET /payslips`**, **`GET /payslips/:id`**, **`/payslips/:payslipId`**) shipped (**CR-031**). **Income onboarding** — **`GET /household/settings`** still returns salary + employers for the signed-in user (stored on **`person_profile`** after migration **`0020`**; edit via **`PATCH /household/profile`** — see **`docs/API_HOUSEHOLD_PROFILE.md`**). Legacy **`household.employers_json`** is no longer written. **`0018`** stores **`employer_id`** on snapshot/import file (**CR-037**). **`POST /payslips/sniff`** suggests parser from PDF text; multi-employer flows require choosing employer on upload/import. **IBM and Deloitte** payslip PDFs use **OpenAI vision + structured JSON** for the primary parse path (see [§3](#3-parsing-technical-approach)); regex IBM parsing remains for tests/sniffing only. **Manual entry:** **`POST /payslips/manual`** + **`/payslips/new`** ([§7](#7-manual-payslip-entry-shipped)).). ADP profile remains stub.

---

## 1. Why payslip is separate from the bank ledger

| Layer | Role |
|--------|------|
| **Bank import** (`transaction_canonical`) | Cash reality: what hit which account (e.g. BoA net pay deposit). |
| **Payslip module** | Employer-reported compensation: gross, taxes, deductions, period, YTD — **not** double-counting net pay unless we explicitly choose to link them. |

> **Progress:** Shipped — IBM and Deloitte use LLM + canonical map + hybrid snapshot (**CR-051**, **CR-052**). `422` reason codes when OpenAI is missing or extraction fails. `payslip_snapshot` + upload/list/detail/charts (**CR-031**, **CR-036**). Employer + sniff (**CR-037**). Manual entry (**CR-028**). ADP stub present; full line-item grids in UI still deferred. See **`docs/CHANGE_HISTORY.md`**.

**User mental model:** Net pay appears in the bank feed; payslip **explains** salary vs commission vs withholdings for **dashboards and analytics** on a **different screen** than the generic ledger.

---

## 2. v1 scope — rich extraction (“Current / YTD” buckets + per-row line items)

For **v1**, we persist **both** summary-level compensation buckets **and** individual line items for every earnings, deduction, and tax row visible on the PDF.

**Per stub, captured fields:**

- **Pay period** (and pay date when present on the stub).
- **Current + YTD column buckets:** Gross Pay, Employee Taxes, Pre-Tax Deductions, Post-Tax Deductions, Net Pay, Taxable Earnings, Other Information totals.
- **Hours/Days Worked** (current and YTD); **Employment Rate** (salary/rate + type: annual, biweekly, hourly).
- **Per-row line items** grouped by section: `earnings`, `pre_tax_deductions`, `post_tax_deductions`, `tax_deductions`, `other_deductions`, `other_information`, `taxable_earnings`. Each row captures: name, authority, date_raw, hours/days current, rate, amount current + YTD.

**Explicit v1 non-goals:**

- Guaranteed 100% accuracy (LLM may misread column alignment; `canonical_extract_json` stored for audit).
- Posting payslip rows into `transaction_canonical` by default (avoids **double-counting** with bank deposits).
- Full per-row manual entry in the browser (deferred; see [§7](#7-manual-payslip-entry-shipped)).

---

## 3. Parsing (technical approach)

### Shared: OpenAI vision + JSON schema

**IBM** (`ibm_pay_contributions_pdf`) and **Deloitte** (`deloitte_payslip_pdf`) both use **`extractPayslipFromPdf`** (renders PDF pages to images, single chat completion with **`response_format.json_schema`**), then **Zod** validation and **`mapCanonicalExtractToPersist`** into legacy summary columns plus **hybrid** JSON (`canonical_extract_json`, employer/employee display fields, etc.).

- **Prerequisites:** **`OPENAI_API_KEY`**; **Poppler** (`pdftoppm` on `PATH`) for rendering. See **`docs/ENVIRONMENT_VARIABLES.md`**.
- **Import:** when the file is already on disk, extraction uses **`pdfPath`** (session **`stored_path`**) to avoid writing a second temp copy. **Upload** uses **`pdfBuffer`** (temp file internally).
- **Deloitte import:** parse **queues** async reconcile; **`POST /imports/sessions/:sessionId/reconcile-payslip-async`** runs extraction and inserts **`payslip_snapshot`**. **IBM import:** parse runs extraction **synchronously** (same mapper/hybrid).

### Regex IBM parser (secondary)

**`parseIbmPayslipPdf`** (`pdf-parse` + heuristics on text) remains **exported** for **tests** and **sniff** helpers; it is **not** invoked from **`parsePayslipPdfByProfile`** for the primary upload/import path.

### Canonical mapping notes

- **Employee taxes:** summary totals, or sum of **`line_items.tax_deductions`** when summary is null.
- **Post-tax:** summary **`post_tax_deductions_*`**, or sum of **`line_items.post_tax_deductions`**. **Deloitte:** if still null, a **narrow fallback** sums **`line_items.other_deductions`** rows whose **`raw_section`** indicates **`OTHER DEDUCTION(S)`** (handles cases where the LLM puts those rows in `other_deductions` instead of `post_tax_deductions`).
- **Hours:** when the model omits **`hours_or_days_worked_current`**, the mapper applies a **product default of 80** (biweekly assumption) for Deloitte-shaped extracts — see canonical-map tests.

**Risks:** Vision models can misread column alignment (e.g. Current vs YTD, or placing currency in **`hours_or_days`**). v1 stores full **`canonical_extract_json`** for audit and future UI correction ([§7](#7-manual-payslip-entry-shipped)).

---

## 4. Storage (v1)

- **Dedicated payslip snapshot** (`payslip_snapshot`) — relational summary columns plus **`raw_extract_json`**, **`canonical_extract_json`**, and hybrid JSON columns (see migration **`0004`**, **`docs/CHANGE_HISTORY.md`** **CR-051**). Extended in **migration `0022`** (**CR-072**) with 7 new columns: `taxable_earnings_current/ytd`, `other_information_current/ytd`, `hours_or_days_ytd`, `employment_rate`, `employment_rate_type`.
- **Per-row line items** (`payslip_line_item`) — new table (migration **`0022`**) with `ON DELETE CASCADE` FK to snapshot. Stores one row per earnings/deduction/tax entry, keyed by `section` enum (7 values). Indexed by `(payslip_snapshot_id, section, sort_order)` and `(household_id, section)`. See **CR-072** for full column list.
- Keyed by **household**, **file checksum**, optional **`import_file_id`**, **`employer_id`**.
- **Not** merged into `transaction_canonical` unless we add an explicit product decision later.

---

## 5. UI

- **Shipped (v1 summary):** list, detail, upload, **`POST /payslips/manual`** (typed entry, synthetic checksum), and **income charts** on **`/payslips`** (**CR-031**, **CR-036**, **CR-051**, **CR-056**).
- **Rich detail view (CR-072, shipped):** Period card shows **Hours YTD** inline and **Salary / Rate** row when `employmentRate` is present. Amounts table adds conditional **Taxable Earnings** and **Other Information** rows. New **Line Items** collapsible card below Amounts — one `<details>` accordion per non-empty section (Earnings, Pre-Tax Deductions, Post-Tax Deductions, Tax Deductions, Other Deductions, Other Information, Taxable Earnings); Hours and Rate columns hidden when all rows in a section have null for those fields.
- **Manual add form (CR-072, shipped):** 7 new optional fields added: Taxable Earnings (current + YTD), Other Information (current + YTD), Hours/Days YTD, Salary/Rate, and Rate Type (Annual / Biweekly / Hourly). Full per-row line item entry (adding individual earnings/deduction rows manually) is a **deferred backlog item** — see §7.
- **API vs UI:** **`PATCH /payslips/:id`** accepts summary-field updates for integrations and future work; the **detail route** (`/payslips/:payslipId`) is **read-only** in the app today — there is no full in-browser editor for parsed or manual stubs yet.
- **Bank deposit match (CR-068, shipped):** `GET /payslips/:id` returns `matchedDeposits` — up to 5 `credit` transactions within ±3 days of `pay_date` whose amount is within 1% (min $0.50) of `net_pay_current`. Restricted to `salary_deposit_financial_account_id` on `person_profile` when set; otherwise all household accounts. Detail page shows a **Bank deposit** card with matched rows and **View** link into `/transactions`.
- **Later:** payslip MoM delta comparison (PS-1), estimated tax sufficiency / withholding health (PS-2), salary vs commission split charts, richer tax analytics, full in-browser edit of parsed stubs, per-row manual line item entry.

---

## 5.1 Deloitte Pay Statement (`deloitte_payslip_pdf`)

**Profile:** `deloitte_payslip_pdf` — employer parser option in Settings; same **`payslip_snapshot`** storage as IBM.

**Behavior:** Import **queues** OpenAI extraction on **`import_file`**; session stays **`processing`** until **`POST /imports/sessions/:sessionId/reconcile-payslip-async`** completes (UI auto-poll + “Check now”). Requires **`OPENAI_API_KEY`**.

**Direct upload:** **`POST /payslips/upload`** with Deloitte profile is **not** supported; response directs users to **Import** (async path).

**Extraction content:** Full validated **`PayslipLlmExtract`** JSON is stored in **`canonical_extract_json`**; summary columns are derived via **`mapCanonicalExtractToPersist`**. Prompts include Deloitte-specific layout hints (Current/YTD column pairing, **`OTHER DEDUCTION(S)`** treatment). Residual mis-bucketing (e.g. rows under **`line_items.other_deductions`** vs **`post_tax_deductions`**) may require prompt iteration or manual **PATCH** until manual entry ships.

**Sample PDFs:** e.g. under `data/imports/custom/`.

---

## 5.2 IBM Pay & Contributions (`ibm_pay_contributions_pdf`)

**Behavior:** **`POST /payslips/upload`** and **Import → parse** use the **same** OpenAI vision + canonical pipeline as Deloitte (not regex **`parseIbmPayslipPdf`** on the primary path). Requires **`OPENAI_API_KEY`**.

**CLI / debugging:** `npm run extract-payslip-llm -w backend` — optional PDF path argument; prints JSON to stdout (see **`backend/scripts/extract-payslip-llm.ts`**).

---

## 6. Phased roadmap (Story 3.3)

| Phase | Deliverable |
|--------|-------------|
| **3.3a — v1** | Summary buckets + period + YTD where extracted; dedicated storage; tests. |
| **3.3b** | List + detail + charts; read-only. |
| **3.3c** | Per-row line item storage + rich extraction (IBM + Deloitte); line items accordion in detail view; new manual add fields. Shipped (**CR-072**). Deposit match shipped (**CR-068**). |
| **3.3c+ backlog** | ADP (non-stub); optional OCR for scanned PDFs; full per-row manual line item entry UI; salary vs commission split charts. |
| **PS-1 (V3 P3)** | **Payslip MoM comparison** — delta badges on detail and list views showing ↑ / ↓ / — for net pay, gross pay, total taxes withheld, and total pre-tax deductions vs the prior payslip for the same person. No schema change — `payslip_snapshot` already has all data. Files: `payslip.service.ts` (prior-payslip lookup by person + `pay_period_end DESC LIMIT 1`), `PayslipDetailPage.tsx` (delta badges), `PayslipsPage.tsx` (optional summary column). |
| **PS-2 (V3 P3)** | **Estimated tax sufficiency** — "Am I withholding enough to avoid an underpayment penalty?" Annualised withholding rate from YTD federal + state tax withheld; flag if effective rate looks dangerously low vs a configurable threshold. Callout when ledger shows non-W2 income (investment, freelance) that may require estimated quarterly payments. Does NOT attempt full tax liability calculation (no filing status/deductions stored). Long-term: optional prior-year total tax Settings field enables the IRS safe-harbour test (100% of prior-year or 90% of current-year). Blocked on reliable `federal_income_tax` / `state_income_tax` extraction from `tax_deductions_json` across IBM + Deloitte parsers. Files when ready: `payslip.service.ts`, new `PayslipTaxHealthCard` component, optional Settings field. |
| **3.3d (V4)** | Analytics integration: wire payslip deduction line items (`pre_tax_deductions`, `tax_deductions`) into AI insights + savings rate calculations. Enables: (a) true total savings rate including payroll 401k/IRA/ESPP/HSA withholdings; (b) wealth-building rate = total investment contributions / take-home; (c) employer match separation. Blocked on reliable line item extraction for all supported parsers. See `docs/V3_BACKLOG.md` (V4 Backlog section) for the analytics-side design. |
| **Manual entry (shipped)** | [§7](#7-manual-payslip-entry-shipped) — **`POST /payslips/manual`**, **`/payslips/new`**. |

---

## 7. Manual payslip entry (shipped)

**Goal:** Add a payslip **without PDF parse** — same **`payslip_snapshot`** shape as upload/import so list, detail, and charts stay consistent.

**API:** **`POST /payslips/manual`** (JSON). Body matches **`PATCH /payslips/:id`** summary fields, plus optional **`employerId`** (required when multiple employers are configured), optional **`parserProfileId`** when **no** employers are configured (defaults to IBM otherwise), and **`ownerScope` / `ownerPersonProfileId`** for belongs-to. At least one of **pay date**, **gross (current)**, or **net (current)** is required. **`file_name`** is **`Manual entry`**; **`file_checksum`** is **`sha256("manual:" + uuid)`** so it never collides with PDF uploads.

**UI:** **`/payslips/new`** — form → **`201`** → redirect to **`/payslips/:payslipId`**. List page links **Add manually**.

**Explicitly out of scope for manual entry:** per-row line item entry (adding individual earnings/deduction rows manually). The manual form captures all **summary-level** fields including the 7 new CR-072 fields (taxable earnings, other information, hours/days YTD, employment rate/type). Full per-row line item input is a **backlog item** — tracked in **`docs/archive/FINANCE_APP_PRD.md`** and noted in `PayslipManualPage.tsx` source. (Bank deposit matching shipped in **CR-068** on the detail page; manual payslips are included when `pay_date` + `net_pay_current` are provided.)

---

## 8. Dependencies

- **Epic 4.2** — fingerprint dedupe / idempotency (parallel prerequisite for stable real-data confidence).
- **Epic 3.1** — parser profile contract (payslip profiles plug into import like bank PDFs).

---

## 9. Related

- **Epic 6** — inbox / resolution overlap when payslip needs **human fix** for bad extractions.
- **Implementation references:** `backend/src/modules/payslip/llm-extract/`, `payslip-canonical-map.ts`, `payslip-parse.service.ts`, `payslip-async-import-reconcile.service.ts`, `backend/tests/payslip-canonical-map.test.ts`, `backend/tests/payslip-upload.test.ts`.
