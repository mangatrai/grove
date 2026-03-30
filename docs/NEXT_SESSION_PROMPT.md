# Next Session Prompt (Copy/Paste)

Use this exact starter prompt in a new chat after switching projects:

```text
Read these files first and continue from there:
- docs/CHECKPOINT.md (implementation status + progress legend)
- docs/CHANGE_HISTORY.md (CR / UX / fixes + PRD deviations)
- docs/PROJECT_CONTEXT.md
- docs/PFM_COMPETITIVE_UX_REFERENCE.md (optional — external PFM patterns vs our scope, **D-018**)
- docs/DECISIONS_LOG.md
- docs/FINANCE_APP_PRD.md
- docs/ARCHITECTURE.md
- docs/MVP_BACKLOG.md

Then do the following in order:
1) Summarize the current state in 8-12 bullets. Include: migrations **`0008`**–**`0010`**; **`/categories`** + **`/categories/rules`**; DB **`category_rule`** + **`classification_meta`**; **`/transactions`** command center: **All \| Needs review**, **`GET /transactions?needsReview=true`**, **`GET /transactions/:id/open-review`**, bulk + per-item **`/resolution/*`**; **`/resolution`** has **no dedicated page** — client **redirect** to **`/transactions?needsReview=true`** (**CR-018** / **DOC-005**); **import:** **`GET /imports/sessions/:id/summary`** per-file **`nearDuplicatesFlagged`**, **`openItemsNeedingReview`**, **`notPostedExactDuplicateOrSkipped`** + Import workspace **Outcomes by file** (ledger / Needs review CTAs) (**CR-019**); **transfer matcher** + **`TRANSFER_*`** env; **cash-summary** + **Home** scope + savings target; **`/settings`** (Household wired). Open work: **Epic 6.2–6.3** and richer inbox if desired, **5.2** matcher coverage, **7** polish, ranked **FTS** (ledger search is substring today); near-duplicate visibility on Needs review if still a gap. **D-014** closed — **DOC-008** (two-tier categories IA).
2) List any open product/architecture questions that block implementation.
3) Start implementation from **`docs/CHECKPOINT.md`** “Sensible next steps” (not necessarily Epic 1 unless greenfield).
4) Keep changes minimal, tested, and aligned with strict dedupe + transfer correctness.
5) Do not introduce external SaaS dependencies; remain self-hosted and air-gapped capable.
```

## Optional alternate prompt (planning-only)
```text
Read docs/PROJECT_CONTEXT.md, docs/DECISIONS_LOG.md, docs/ARCHITECTURE.md, and docs/MVP_BACKLOG.md.
Do not code yet. Produce a detailed implementation plan for the next 2 weeks with dependencies and risk mitigations.
```

