# Next Session Prompt (Copy/Paste)

Use this exact starter prompt in a new chat after switching projects:

```text
Read these files first and continue from there:
- docs/CHECKPOINT.md (implementation status + **“Handoff — next session”** + **“Sensible next steps”**)
- docs/CHANGE_HISTORY.md (CR / UX / fixes — e.g. **CR-040**, **CR-039**, **CR-028**, **DOC-011**, **UX-009**, **FIX-006**–**FIX-008**)
- docs/API_HOUSEHOLD_PROFILE.md (if settings / profile / salary / employers)
- docs/PROJECT_CONTEXT.md
- docs/PAYSLIP_V1.md (if payslip / import work)
- docs/PFM_COMPETITIVE_UX_REFERENCE.md (optional — external PFM patterns vs our scope, **D-018**)
- docs/DECISIONS_LOG.md
- docs/FINANCE_APP_PRD.md
- docs/ARCHITECTURE.md
- docs/MVP_BACKLOG.md

Then do the following in order:
1) Summarize the current state in 8-12 bullets. Cover: migrations through **`0020`** (incl. **`0018`** employer ref, **`0019`**–**0020** profile/membership); **`PATCH /household/settings`** vs **`PATCH /household/profile`** (**CR-040**); **`/transactions`** (**FIX-005**); **Needs review** + **CR-025**; **payslips** + **unified Import** (**CR-028**: **`ibm_pay_contributions_pdf`**, **`import_file_id`**, payslip-only canonicalize); **UX-009** import copy + filename heuristic; **import** / **D-014** per **CHECKPOINT**.
2) List any open product/architecture questions that block implementation.
3) Start implementation from **`docs/CHECKPOINT.md`** “Sensible next steps” (prioritize **unified Import + payslip** if that matches product direction).
4) Keep changes minimal, tested, and aligned with strict dedupe + transfer correctness.
5) Do not introduce external SaaS dependencies; remain self-hosted and air-gapped capable.
```

## Optional alternate prompt (planning-only)
```text
Read docs/PROJECT_CONTEXT.md, docs/DECISIONS_LOG.md, docs/ARCHITECTURE.md, and docs/MVP_BACKLOG.md.
Do not code yet. Produce a detailed implementation plan for the next 2 weeks with dependencies and risk mitigations.
```

