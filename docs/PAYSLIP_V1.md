# Payslip module — product intent and v1 scope

**Epic alignment:** **Epic 3 — Story 3.3** (payslip / paystub), implemented in **phases**.  
**Current priority:** **Epic 4.2** (dedupe hardening) **+ UI polish** first; payslip v1 is a **follow-on** slice so this design is not lost.

---

## 1. Why payslip is separate from the bank ledger

| Layer | Role |
|--------|------|
| **Bank import** (`transaction_canonical`) | Cash reality: what hit which account (e.g. BoA net pay deposit). |
| **Payslip module** | Employer-reported compensation: gross, taxes, deductions, period, YTD — **not** double-counting net pay unless we explicitly choose to link them. |

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

## 5. UI (deferred beyond minimal)

- **Later:** list + summary cards + payslip-specific **dashboards** (salary vs commission vs tax trends).
- **Not** required to ship parsing + storage v1; **Epic 4.2 + ledger/import UI polish** stays primary until payslip UI is scheduled.

---

## 6. Phased roadmap (Story 3.3)

| Phase | Deliverable |
|--------|-------------|
| **3.3a — v1** | IBM profile: summary block + period + YTD; dedicated storage; tests on golden PDFs. |
| **3.3b** | Optional UI: list snapshots + read-only summary cards. |
| **3.3c+** | Additional employers; line-item / tax detail; employer HSA, imputed income; reconciliation UX to bank deposit. |

---

## 7. Dependencies

- **Epic 4.2** — fingerprint dedupe / idempotency hardening (parallel or prerequisite for stable “real data” confidence).
- **Epic 3.1** — parser profile contract (payslip profile plugs into the same abstraction as bank PDFs where practical).

---

## 8. Related backlog entries

- `docs/MVP_BACKLOG.md` — **Epic 3 Story 3.3** (updated to reference this doc).
- **Epic 6** — inbox / resolution / review-before-post may overlap when payslip needs **human fix** for bad extractions.
