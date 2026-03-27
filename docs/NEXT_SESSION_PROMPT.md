# Next Session Prompt (Copy/Paste)

Use this exact starter prompt in a new chat after switching projects:

```text
Read these files first and continue from there:
- docs/CHECKPOINT.md (implementation status + progress legend)
- docs/CHANGE_HISTORY.md (CR / UX / fixes + PRD deviations)
- docs/PROJECT_CONTEXT.md
- docs/DECISIONS_LOG.md
- docs/FINANCE_APP_PRD.md
- docs/ARCHITECTURE.md
- docs/MVP_BACKLOG.md

Then do the following in order:
1) Summarize the current state in 8-12 bullets. Include: migrations **`0008`** / **`0009`**; **`/categories`** + **`/categories/rules`** UI; DB **`category_rule`** + **`classification_meta`**; resolution **`unknown_category`** + inline assign; **transfer matcher** + **`TRANSFER_*`** env (**`backend/src/config/env.ts`**); **cash-summary** comparisons + dashboard drill-down; open work: **Epic 6** bulk category, **5.2** matcher coverage, **7** safe-to-spend, **D-014**.
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

