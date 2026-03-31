# Next Session Prompt (Copy/Paste)

Use this exact starter prompt in a new chat after switching projects:

```text
Read these files first and continue from there:
- docs/CHECKPOINT.md (implementation status + **“Handoff — next session”** + **“MVP done vs deferred freeze”**)
- docs/CHANGE_HISTORY.md (CR / UX / fixes — e.g. **CR-043**, **CR-042**, **CR-041**, **CR-040**, **CR-039**, **CR-028**, **DOC-011**, **UX-009**, **FIX-006**–**FIX-008**)
- docs/API_HOUSEHOLD_PROFILE.md (if settings / profile / salary / employers)
- docs/PROJECT_CONTEXT.md
- docs/PAYSLIP_V1.md (if payslip / import work)
- docs/PFM_COMPETITIVE_UX_REFERENCE.md (optional — external PFM patterns vs our scope, **D-018**)
- docs/DECISIONS_LOG.md
- docs/FINANCE_APP_PRD.md
- docs/ARCHITECTURE.md
- docs/MVP_BACKLOG.md

Then do the following in order:
1) Summarize the current state in 8-12 bullets. Cover: migrations through **`0021`** (incl. **`0018`** employer ref, **`0019`**–**`0020`** profile/membership, **`0021`** token-version session invalidation); **`PATCH /household/settings`** vs **`PATCH /household/profile`** (**CR-040**); auth/session invalidation behavior (**CR-041**); **`/transactions`** (**FIX-005** + `fileId` filter from **CR-042** + bulk **Apply + resolve** from **CR-043**); needs-review guardrails; payslips + unified Import (CR-028/041/042/043); MVP done-vs-deferred freeze from **CHECKPOINT**.
2) List any open product/architecture questions that block implementation.
3) Start implementation from post-MVP items only (deferred list + next picks in **CHECKPOINT**), unless a production blocker is explicitly reported.
4) Keep changes minimal, tested, and aligned with strict dedupe + transfer correctness.
5) Do not introduce external SaaS dependencies; remain self-hosted and air-gapped capable.
```

## Optional alternate prompt (planning-only)
```text
Read docs/PROJECT_CONTEXT.md, docs/DECISIONS_LOG.md, docs/ARCHITECTURE.md, and docs/MVP_BACKLOG.md.
Do not code yet. Produce a detailed implementation plan for the next 2 weeks with dependencies and risk mitigations.
```

