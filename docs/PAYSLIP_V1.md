# Payslip module — product intent and v1 scope

**Epic alignment:** **Epic 3 — Story 3.3** (payslip / paystub), implemented in **phases**.  
**Current priority (March–April 2026):** payslip **summary parse + list + detail** (**`GET /payslips`**, **`GET /payslips/:id`**, **`/payslips/:payslipId`**) shipped (**CR-031**). **Income onboarding** — **`GET /household/settings`** still returns salary + employers for the signed-in user (stored on **`person_profile`** after migration **`0020`**; edit via **`PATCH /household/profile`** — see **`docs/API_HOUSEHOLD_PROFILE.md`**). Legacy **`household.employers_json`** is no longer written. **`0018`** stores **`employer_id`** on snapshot/import file (**CR-037**). **`POST /payslips/sniff`** suggests parser from PDF text; multi-employer flows require choosing employer on upload/import. **IBM and Deloitte** payslip PDFs use **OpenAI vision + structured JSON** for the primary parse path (see [§3](#3-parsing-technical-approach)); regex IBM parsing remains for tests/sniffing only. **Manual entry:** **`POST /payslips/manual`** + **`/payslips/new`** ([§7](#7-manual-payslip-entry-shipped)).). ADP profile remains stub.

---

## 1. Why payslip is separate from the bank ledger

| Layer | Role |
|--------|------|
| **Bank import** (`transaction_canonical`) | Cash reality: what hit which account (e.g. BoA net pay deposit). |
| **Payslip module** | Employer-reported compensation: gross, taxes, deductions, period, YTD — **not** double-counting net pay unless we explicitly choose to link them. |

> **Progress:** **3.3a + 3.3b + income charts (🟡)** — **IBM** and **Deloitte** use **LLM + canonical map + hybrid snapshot** (**CR-051**, **CR-052**). **`422`** reason codes when OpenAI is missing or extraction fails. **`payslip_snapshot`** + **`POST /payslips/upload`** + **`GET /payslips`** + **`GET /payslips/:id`** + **`PATCH /payslips/:id`** + **`/payslips`** charts (**CR-031**, **CR-036**). **Employer + sniff:** **`0018`**, **`POST /payslips/sniff`**, multi-employer picker, **`adp_payslip_pdf`** stub (**CR-037**). **Unified Import:** **`ibm_pay_contributions_pdf`** / **`deloitte_payslip_pdf`** → snapshot (**`0015`**), parse → snapshot; payslip-only canonicalize (**CR-028**). **Still not:** full line-item grids in UI; ADP execution beyond stub. Details: **`docs/archive/CHECKPOINT.md`**, **`docs/CHANGE_HISTORY.md`**.

**User mental model:** Net pay appears in the bank feed; payslip **explains** salary vs commission vs withholdings for **dashboards and analytics** on a **different screen** than the generic ledger.

---

## 2. v1 scope — summary first (“Current / YTD” buckets)

For **v1**, we persist **summary-level** compensation buckets (period, pay date, gross, taxes, pre/post-tax deductions, net, YTD where extracted), not a full accounting-grade reconstruction of every PDF table.

**Per stub, minimum fields:**

- **Pay period** (and pay date when present on the stub).
- **Current column:** Hours/Days Worked (if present), Gross Pay, Post Tax Deductions, Employee Taxes, Pre Tax Deductions, Net Pay.
- **YTD** for the same buckets when the extractor provides them.

**Explicit v1 non-goals:**

- Guaranteed capture of every earnings/deduction line in the PDF (LLM may miss or mis-bucket rows; see [§3](#3-parsing-technical-approach)).
- Posting payslip rows into `transaction_canonical` by default (avoids **double-counting** with bank deposits).

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

- **Dedicated payslip snapshot** — relational summary columns plus **`raw_extract_json`**, **`canonical_extract_json`**, and hybrid JSON columns (see migration **`0004`**, **`docs/CHANGE_HISTORY.md`** **CR-051**).
- Keyed by **household**, **file checksum**, optional **`import_file_id`**, **`employer_id`**.
- **Not** merged into `transaction_canonical` unless we add an explicit product decision later.

---

## 5. UI

- **Shipped (v1 summary):** list, detail, upload, **`POST /payslips/manual`** (typed entry, synthetic checksum), and **income charts** on **`/payslips`** (**CR-031**, **CR-036**, **CR-051**, **CR-056**).
- **API vs UI:** **`PATCH /payslips/:id`** accepts summary-field updates for integrations and future work; the **detail route** (`/payslips/:payslipId`) is **read-only** in the app today — there is no full in-browser editor for parsed or manual stubs yet. Broader payslip UI (line-item grids, richer editing) tracks **Epic 3 — 3.3b+** in [`docs/archive/MVP_BACKLOG.md`](archive/MVP_BACKLOG.md).
- **Later:** line-item grids, salary vs commission split, richer tax analytics.

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
| **3.3c+** | Line-item / tax detail in UI; ADP (non-stub); reconciliation UX to bank deposit; optional OCR for scanned PDFs. |
| **Manual entry (shipped)** | [§7](#7-manual-payslip-entry-shipped) — **`POST /payslips/manual`**, **`/payslips/new`**. |

---

## 7. Manual payslip entry (shipped)

**Goal:** Add a payslip **without PDF parse** — same **`payslip_snapshot`** shape as upload/import so list, detail, and charts stay consistent.

**API:** **`POST /payslips/manual`** (JSON). Body matches **`PATCH /payslips/:id`** summary fields, plus optional **`employerId`** (required when multiple employers are configured), optional **`parserProfileId`** when **no** employers are configured (defaults to IBM otherwise), and **`ownerScope` / `ownerPersonProfileId`** for belongs-to. At least one of **pay date**, **gross (current)**, or **net (current)** is required. **`file_name`** is **`Manual entry`**; **`file_checksum`** is **`sha256("manual:" + uuid)`** so it never collides with PDF uploads.

**UI:** **`/payslips/new`** — form → **`201`** → redirect to **`/payslips/:payslipId`**. List page links **Add manually**.

**Explicitly out of scope:** full line-item grids in this flow; auto-link to bank deposits.

---

## 8. Dependencies

- **Epic 4.2** — fingerprint dedupe / idempotency (parallel prerequisite for stable real-data confidence).
- **Epic 3.1** — parser profile contract (payslip profiles plug into import like bank PDFs).

---

## 9. Related backlog entries

- `docs/archive/MVP_BACKLOG.md` — **Epic 3 Story 3.3**.
- **Epic 6** — inbox / resolution overlap when payslip needs **human fix** for bad extractions.
- **Implementation references:** `backend/src/modules/payslip/llm-extract/`, `payslip-canonical-map.ts`, `payslip-parse.service.ts`, `payslip-async-import-reconcile.service.ts`, `backend/tests/payslip-canonical-map.test.ts`, `backend/tests/payslip-upload.test.ts`.
