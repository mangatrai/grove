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

**Risks:** PDF text order can jumble; v1 should expose **parse confidence** and a path to **manual correction** later (Epic 6 overlap).

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

**v1 behavior (current):** Deloitte is processed via **Unstructured Jobs API** from Import flow (async), not local `pdf-parse`. The parser reads Unstructured partition JSON with **HTML-first** extraction from `Table.metadata.text_as_html` (fallback: `Table.text`). Imports should include `text_as_html` on the partitioned `Table` when the platform provides it; the plain-text path still resolves totals by preferring the real **`NET PAY $… $…`** line over an earlier summary-column **`Net Pay`** label in the same flattened string.

**Current extracted fields (Deloitte v1 async):**
- `grossPayCurrent`, `grossPayYtd` from `TOTAL GROSS`
- `netPayCurrent`, `netPayYtd` from `NET PAY` (totals row)
- `payPeriodStart`, `payPeriodEnd`, `payDate` from Deloitte header phrasing (e.g. `Period … Begin`, `End Date Paid`, and flat `Table.text` date triples), with IBM-style regexes as fallback
- `preTaxDeductionsCurrent`, `employeeTaxesCurrent`, `postTaxDeductionsCurrent` from the header **summary strip** (`Total Earnings` … `Net Pay` and five amounts); YTD for those buckets not taken from that strip

**Current non-goals (still deferred):**
- Full Deloitte line-item reconstruction (every earnings/deduction row, per-line tax breakdown, hours)
- Direct `/payslips/upload` Deloitte parse (Deloitte upload path instructs users to use Import + Unstructured)

**Sample PDFs in `data/imports/custom/`:** For image-like Deloitte PDFs, Import submits to Unstructured and stores job ids on `import_file`. Session remains `processing` until reconcile completes (auto poll ~2 min in UI, or manual “Check Unstructured now”).

**Potential data on real Deloitte stubs (not all captured in v1):** employer legal name, employee id, department, earnings breakdown lines, benefit deductions, tax breakdowns, banking instructions, leave balances. **Deferred** to Story 3.3c+ line-item / tax detail.

---

## 6. Phased roadmap (Story 3.3)

| Phase | Deliverable |
|--------|-------------|
| **3.3a — v1** | IBM profile: summary block + period + YTD; dedicated storage; tests on golden PDFs. |
| **3.3b** | List + detail + charts (**gross/net/tax** trends); read-only. |
| **3.3c+** | Additional employers (incl. Deloitte profile); line-item / tax detail; employer HSA, imputed income; reconciliation UX to bank deposit; OCR for scanned payslips. |

---

## 7. Dependencies

- **Epic 4.2** — fingerprint dedupe / idempotency hardening (parallel or prerequisite for stable “real data” confidence).
- **Epic 3.1** — parser profile contract (payslip profile plugs into the same abstraction as bank PDFs where practical).

---

## 8. Related backlog entries

- `docs/MVP_BACKLOG.md` — **Epic 3 Story 3.3** (updated to reference this doc).
- **Epic 6** — inbox / resolution / review-before-post may overlap when payslip needs **human fix** for bad extractions.
