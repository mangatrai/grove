# Payslip module — product intent and v1 scope

**Epic alignment:** **Epic 3 — Story 3.3** (payslip / paystub), implemented in **phases**.  
**Current priority (March–April 2026):** payslip **summary parse + list + detail** (**`GET /payslips`**, **`GET /payslips/:id`**, **`/payslips/:payslipId`**) shipped (**CR-031**). **Income onboarding** — **`GET /household/settings`** still returns salary + employers for the signed-in user (stored on **`person_profile`** after migration **`0020`**; edit via **`PATCH /household/profile`** — see **`docs/API_HOUSEHOLD_PROFILE.md`**). Legacy **`household.employers_json`** is no longer written. **`0018`** stores **`employer_id`** on snapshot/import file (**CR-037**). **`POST /payslips/sniff`** suggests parser from PDF text; multi-employer flows require choosing employer on upload/import. **Next:** real ADP parse; bank-deposit link remains out of scope for v1.

---

## 1. Why payslip is separate from the bank ledger

| Layer | Role |
|--------|------|
| **Bank import** (`transaction_canonical`) | Cash reality: what hit which account (e.g. BoA net pay deposit). |
| **Payslip module** | Employer-reported compensation: gross, taxes, deductions, period, YTD — **not** double-counting net pay unless we explicitly choose to link them. |

> **Progress:** **3.3a + 3.3b + income charts (🟡)** — IBM **SuccessFactors** multiline text (**FIX-007**), **`422`** reason codes (**FIX-006**), **`payslip_snapshot`** + **`POST /payslips/upload`** + **`GET /payslips`** + **`GET /payslips/:id`** + **`/payslips`** / **`/payslips/:payslipId`** (upload **UX-008**, detail **CR-031**, dev proxy **FIX-008**). **Payslips page:** Recharts — gross/net/taxes by paycheck, calendar month totals, latest-stub composition pie (**CR-036**). **Employer + sniff (🟡):** **`0018`**, **`POST /payslips/sniff`**, multi-employer picker, **`adp_payslip_pdf`** stub (**CR-037**). **Unified Import (🟡):** **`ibm_pay_contributions_pdf`** / ADP binding — **`payslip_snapshot.import_file_id`** (**`0015`**), parse → snapshot, payslip-only canonicalize (**CR-028**, **DOC-011**). **Still not:** line-item grids; ADP execution beyond stub. Details: **`docs/CHECKPOINT.md`**, **`docs/CHANGE_HISTORY.md`**.

**User mental model:** Net pay appears in the bank feed; payslip **explains** salary vs commission vs withholdings for **dashboards and analytics** on a **different screen** than the generic ledger.

---

## 2. v1 scope — first summary block only (“first table”)

For **v1**, extract and persist **only** the top **Current / YTD** summary strip (IBM-style PDFs), not full line-item reconstruction.

**Per stub, minimum fields:**

- **Pay period** (and pay date when present on the stub).
- **Current column:** Hours/Days Worked (if present), Gross Pay, Post Tax Deductions, Employee Taxes, Pre Tax Deductions, Net Pay.
- **YTD** for the same buckets (paired with Current in the PDF).

**Explicit v1 non-goals:**

- Full earnings grid (every commission line, every deduction line).
- Posting payslip rows into `transaction_canonical` by default (avoids **double-counting** with bank deposits).

---

## 3. Parsing (technical approach)

- **One payslip profile** to start (e.g. **IBM** “Pay and Contributions Statement”), driven by **`pdf-parse` text** (same stack as other PDF profiles).
- **Heuristics:** regex + line-oriented parsing on the **header/summary block** only; golden tests on fixtures — **not** full PDF table reconstruction.
- **fixtures (local / gitignored if sensitive):** e.g. `data/imports/custom/Feb_Commission_PayCheck.pdf`, `Feb_Regular_paycheck.pdf` — use copies in `backend/tests/fixtures/` for CI if policy allows.

**Risks:** PDF text order can jumble; v1 should expose **parse confidence** and a path to **manual correction** later (Epic 6 overlap). **Longer-term:** full **manual payslip entry** (see [§7](#7-epic--manual-payslip-entry-backlog)) if parsers fail or users prefer typing.

---

## 4. Storage (v1)

- **Dedicated payslip snapshot** — JSON blob **or** narrow relational columns — keyed by:
  - **household** (and user/tenant rules as applicable),
  - **pay period** (and optionally file checksum / `import_file` id),
  - **not** merged into `transaction_canonical` unless we add an explicit product decision later (e.g. link stub to deposit for reconciliation only).

**Schema evolution:** Line-item tables can come in **v2+** without breaking v1 snapshots.

---

## 5. UI

- **Shipped (v1 summary):** list, detail, upload, and **income charts** on **`/payslips`** (gross/net/taxes by **pay date** with same-day merge, **month** totals, latest-stub breakdown — **CR-036**, **UX-010**).
- **Later:** line-item grids, salary vs commission split, richer tax analytics.

---

## 5.1 Deloitte Pay Statement (`deloitte_payslip_pdf`)

**Profile:** `deloitte_payslip_pdf` — employer parser option in Settings; same import and `payslip_snapshot` storage as IBM.

**v1 behavior (current):** Deloitte Pay Statement PDFs in **Import** use **async OpenAI LLM extraction** (canonical JSON schema + Zod). Files are queued on `import_file` and finalized by background **`POST /imports/sessions/:sessionId/reconcile-payslip-async`** (auto-poll in UI). **IBM** remains local `pdf-parse`.

**Current extracted fields (Deloitte v1 async):**
- `grossPayCurrent`, `grossPayYtd` from `TOTAL GROSS`
- `netPayCurrent`, `netPayYtd` from `NET PAY` (totals row)
- `payPeriodStart`, `payPeriodEnd`, `payDate` from Deloitte header phrasing (e.g. `Period … Begin`, `End Date Paid`, and flat `Table.text` date triples), with IBM-style regexes as fallback
- `preTaxDeductionsCurrent`, `employeeTaxesCurrent`, `postTaxDeductionsCurrent` from the header **summary strip** (`Total Earnings` … `Net Pay` and five amounts); YTD for those buckets not taken from that strip

**Current non-goals (still deferred):**
- Full Deloitte line-item reconstruction (every earnings/deduction row, per-line tax breakdown, hours)
- Direct `/payslips/upload` Deloitte parse (Deloitte upload path instructs users to use Import with async LLM extraction)

**Sample PDFs in `data/imports/custom/`:** Deloitte PDFs are queued on `import_file` for OpenAI extraction. Session remains `processing` until reconcile completes (auto poll ~2 min in UI, or manual “Check now”).

**Potential data on real Deloitte stubs (not all captured in v1):** employer legal name, employee id, department, earnings breakdown lines, benefit deductions, tax breakdowns, banking instructions, leave balances. **Deferred** to Story 3.3c+ line-item / tax detail.

---

## 5.2 LLM payslip extraction (experimental POC)

**Not wired to import or `payslip_snapshot`.** A separate path uses **OpenAI** vision + **structured JSON** (`response_format.type: json_schema`) with a canonical schema ([`payslip.schema.json`](../backend/src/modules/payslip/llm-extract/payslip.schema.json)) and **Zod** validation ([`payslip-llm.schema.ts`](../backend/src/modules/payslip/llm-extract/payslip-llm.schema.ts)). Server fields (`page_count`, `parser_source`, `extraction_model`, `extracted_at`) are merged in TypeScript after the call.

**Prerequisites:** **Poppler** so `pdftoppm` is on `PATH` (e.g. macOS: `brew install poppler`). **Env:** `OPENAI_API_KEY`, optional `OPENAI_MODEL` (see repo root `.env` / [`backend/src/config/env.ts`](../backend/src/config/env.ts)).

**Run (from repo root):** `npm run extract-payslip-llm -w backend` — optional CLI argument: path to a PDF (defaults to `data/imports/custom/Pay Statement_2026_0206.pdf`). Output is pretty-printed JSON on stdout. Single request per run (no automatic retries).

---

## 6. Phased roadmap (Story 3.3)

| Phase | Deliverable |
|--------|-------------|
| **3.3a — v1** | IBM profile: summary block + period + YTD; dedicated storage; tests on golden PDFs. |
| **3.3b** | List + detail + charts (**gross/net/tax** trends); read-only. |
| **3.3c+** | Additional employers (incl. Deloitte profile); line-item / tax detail; employer HSA, imputed income; reconciliation UX to bank deposit; OCR for scanned payslips. |
| **Future — manual entry epic** | See [§7](#7-epic--manual-payslip-entry-backlog): form-based capture of the same summary fields as parse (period, pay date, Current/YTD buckets, pay type). |

---

## 7. Epic — Manual payslip entry (backlog)

**Goal:** Let users **add or correct a payslip without relying on PDF parse** (LLM extract, IBM regex, etc.). Same **`payslip_snapshot`** shape as upload/import so list, detail, and charts stay consistent.

**Why (product):**

- Parser variance (e.g. Deloitte LLM vs IBM regex) may fail or drift; users still need income history.
- Some users will prefer typing numbers once over fighting extraction.
- Complements **parse confidence** and **human fix** flows ([Epic 6](#9-related-backlog-entries) overlap).

**UX (high level):**

- **Date pickers:** pay period **start** and **end**, and **pay date** (aligned with v1 snapshot fields `payPeriodStart`, `payPeriodEnd`, `payDate`).
- **Pay type:** at minimum distinguish **regular pay** vs **commission** (and room for future splits); stored in snapshot metadata or dedicated columns when implemented.
- **Amounts:** collect **Current** and **YTD** for every summary bucket we surface today and expect on real stubs — mirror **`ParsedPayslipSummary`** / IBM-style summary: gross, employee taxes, pre-tax deductions, post-tax deductions, net pay, hours/days if used.
- **Screen template:** use the **IBM Pay and Contributions** stub as the **reference layout** — it has the richest summary block in-product; the manual form should expose the same categories (and optional advanced rows) so nothing important is missing for IBM households and others map into the same fields.

**Backend (directional):**

- **`POST /payslips`** (or **`POST /payslips/manual`**) with validated body → insert **`payslip_snapshot`** with **`import_file_id` null** (or a synthetic “manual” marker), **`parser_profile_id`** = employer-appropriate profile or a dedicated **`manual`** profile — **decide at implementation** to avoid breaking charts/filters.
- Reuse validation rules from parse path where possible.

**Explicitly out of scope for this epic definition:** full line-item grids (can follow in a later phase); auto-link to bank deposits (separate reconciliation story).

**Related:** Deloitte import path ([§5.1](#51-deloitte-pay-statement-deloitte_payslip_pdf)); IBM v1 summary ([§2](#2-v1-scope--first-summary-block-only-first-table)).

---

## 8. Dependencies

- **Epic 4.2** — fingerprint dedupe / idempotency hardening (parallel or prerequisite for stable “real data” confidence).
- **Epic 3.1** — parser profile contract (payslip profile plugs into the same abstraction as bank PDFs where practical).

---

## 9. Related backlog entries

- `docs/MVP_BACKLOG.md` — **Epic 3 Story 3.3** (updated to reference this doc).
- **Epic 6** — inbox / resolution / review-before-post may overlap when payslip needs **human fix** for bad extractions.
