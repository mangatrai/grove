# Next Session Handoff — Household Finance App

**Written:** 2026-06-29  
**Current version:** 6.2.3  
**Branch:** main (clean)

---

## What Was Accomplished This Session

### FIX-195 — PA Agent Phase 1 Self-Review (GH #163) ✅

Performed a thorough self-review of `backend/src/modules/family/family-agent.service.ts` — the 5-domain PA Agent pipeline. Found and fixed **5 bugs**:

| Fix | Domain / Function | What was broken | What was done |
|-----|-------------------|-----------------|---------------|
| 1 | Domain 1 `analyzeCoverageGaps` | `parseJsonResponse` could throw, crashing the entire `Promise.all` group | Added try/catch; returns `{ hasOutput: false, gaps: [] }` on failure |
| 2 | Domain 2 `assessNannyCoordination` | Same — unprotected `parseJsonResponse` | Added try/catch; returns `{ hasOutput: false, items: [] }` on failure |
| 3 | Domain 4 `sweepDeadlines` | Same — unprotected final `parseJsonResponse` | Added try/catch; returns `{ hasOutput: false, alerts: [] }` on failure |
| 4 | Domain 5 `synthesizeDigest` | Unprotected parse meant email synthesis failure silently swallowed D1-D4 alerts | try/catch returns `allAlerts` from D1-D4 even if digest parse fails; `parentADigest/parentBDigest: null` |
| 5 | `fetchCalendarEvents` inner loop | No per-calendar guard — one bad ICS calendar crashed the whole fetch | Added per-calendar try/catch; bad calendar logs WARN and skips, rest continue |

- CHANGE_HISTORY.md updated with FIX-195 entry
- Version bumped 6.2.2 → 6.2.3
- GH #163 created and closed in commit

**Prior session fixes already in the codebase (do not re-apply):**
- Domain 3 `runProactiveResearch` — already had full try/catch coverage from earlier session
- Domain 4 — dynamic LLM-generated Tavily queries (BabyAGI-aligned, no hardcoded strings) — FIX-194 / GH #162
- `suggestion` alertType wired so D3 research items appear as UI-visible alerts — FIX-193 / GH #161
- `synthesizeDigest` maps D3 research items to `researchSuggestions` AlertItems before building `allAlerts`
- `fetchCalendarEvents` fetches and merges events from all selected calendar IDs per parent

---

## Current PA Agent Architecture (Phase 1 — Stable)

### Pipeline flow

```
runFamilyAgent(runType)
  └── buildContext()           — fetches GCal events per parent, DB family events, open alerts,
  |                              members, caregiver slots, finance summary
  └── Promise.all([
        analyzeCoverageGaps(ctx),     // D1 — LLM coverage gap detection
        assessNannyCoordination(ctx), // D2 — LLM nanny coordination items
        runProactiveResearch(ctx),    // D3 — Tavily + LLM proactive research
        sweepDeadlines(ctx),          // D4 — LLM-generated Tavily queries + deadline detection
      ])
  └── synthesizeDigest(ctx, domains) // D5 — per-parent email digest + summaryText
  └── persist alerts to family_agent_alerts
  └── send email if parentADigest/parentBDigest present
```

### runType semantics

| runType | D3 queryCount | D4 cutoffDays | When |
|---------|--------------|---------------|------|
| `daily_delta` | 2 | 7 | nightly cron |
| `sunday_preview` | 3 | 30 | Sunday ~7pm |
| `monday_digest` | 5 | 30 | Monday ~7am |
| `manual` | 5 | 30 | on demand via API |

### Key files
- `backend/src/modules/family/family-agent.service.ts` — entire pipeline
- `backend/src/modules/family/family.routes.ts` — REST endpoints including `POST /api/family/agent/run`
- `backend/src/modules/family/family-profiles.service.ts` — `listHouseholdMembers`, `listAvailability`
- `backend/src/modules/family/family.types.ts` — shared types
- `backend/src/llm/tools/tavily.ts` — `tavilySearch()` (returns string sentinel when unconfigured, does NOT throw)
- `backend/src/modules/gcal/gcal.service.ts` — `buildOAuth2Client`, `getDecryptedRefreshToken`

### Tavily call budget per manual run
- D3: up to 5 calls (LLM generates query list)
- D4: up to 4 calls (LLM generates query list)
- Total: up to 9 calls per manual run

---

## Pending Before Moving to Phase 2

### CRITICAL — Re-authorize Google Calendar
A prior session added `userinfo.email` scope to `gcal.service.ts`. The existing OAuth token does **not** have this scope. The user must:
1. Go to app Settings → Google Calendar
2. Disconnect and reconnect
3. Re-authorize with the new consent screen

Without this, `provider_email` won't be stored on re-auth and per-parent email routing in D5 breaks.

### Validate Phase 1 end-to-end
After re-auth:
1. Deploy 6.2.3
2. Trigger `POST /api/family/agent/run` with `{ runType: "manual" }`
3. Check backend logs for any `"family-agent: Domain X ... parse failed"` warnings
4. Verify all 5 domains produce visible alerts in the Family → Agent UI
5. Verify per-parent digest emails arrive

---

## What's Next Logically (Priority Order)

### 1. PA Agent Phase 1 — Validate in prod (pre-condition for Phase 2)
Deploy 6.2.3, re-auth GCal, run manual scan. Only move to Phase 2 once all 5 domains produce real output.

### 2. PA Agent Phase 2 — BabyAGI-style ad-hoc task loop (GH #159)
- User can submit freeform requests: "remind me to book camp registration when it opens"
- Agent breaks into subtasks, tracks them, resurfaces proactively
- Architecture: new `family_agent_tasks` table, LLM decomposes request into goal + trigger condition + check interval
- See GH #159 for full spec. **Do not start until Phase 1 is validated.**

### 3. Family Planner PRD + GH Issues (deferred from earlier session)
There is a plan file at `/Users/mrai/.claude/plans/okay-i-have-a-moonlit-feather.md` with full gathered requirements. No code — just docs work:
- Add **PRD-F: Family Planner Module** section to `docs/PRD_AND_CRS.md`
- Create V6 GitHub milestone
- Create 6 GH issues (listed in the plan file)
- Add DOC- entry to CHANGE_HISTORY.md
- **No code ships this step.**

### 4. Outstanding FP feature backlog (GH issues already open)
These are sequenced after Phase 2 validation:

| GH # | Feature |
|-------|---------|
| #149 | LLM response_format / JSON enforcement in family agent |
| #151 | PA quick-capture inbox (freeform → structured action list) |
| #152 | Action approval + GCal write-back from agent suggestions |
| #153 | In-app message compose panel (agent pre-fills, user edits + sends) |
| #154 | Cross-module context (finance data in family agent prompt) ← already shipped per GH |
| #155 | Open suggestion follow-up — agent re-surfaces unresolved suggestions |
| #156 | Store GCal provider_email at OAuth time + auto-invite co-parents |

---

## GH Issues That Are Missing (to create next session)
Issues shipped without dedicated GH issues (gaps from earlier sessions):
- GCal per-calendar error handling (shipped in FIX-195 but bundled under #163)
- False-positive prompt rewrites for D1/D2 (shipped without issue)
- UI text color fix on FamilyAgentPage (shipped without issue)

---

## Active Open Questions (do not close)
1. **Work calendar access** — both parents on corporate O365 (IT-locked, passkey auth). V1 workaround is manual "busy blocks". Discovery spike is GH open (see plan file for options: Graph API, Power Automate, iOS Shortcuts, macOS Calendar bridge).
2. **PS-5 Tax Filing Profile** — `person_tax_profile` table design has 4 open user questions (see memory `project_ps5_tax_profile.md`). Do not build until resolved.
3. **PT-5b / PT-6 / UX-PT-7** — Property Tax Protest remaining items. Not started.

---

## Repo Health
- 575 backend tests passing as of last run (2026-06-29)
- ESLint clean
- No known TypeScript errors
- `openapi/openapi.yaml` and `docs/API_REFERENCE.md` are current through 6.2.3
