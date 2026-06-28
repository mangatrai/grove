# Change history (CR, UX, fixes, PRD notes)

**Purpose:** Append-only log of **product tweaks**, **design fixes**, **engineering fixes**, and **explicit deviations** from the PRD / original design so future work (and AI sessions) can recover **why** something looks or behaves a certain way.

**Conventions**

| Prefix | Use for |
|--------|---------|
| **CR-** | Change request — explicit user/product direction (“make it do X”). |
| **UX-** | Design / UX polish — layout, visuals, affordances (not always a bug). |
| **FIX-** | Bug or correctness fix (backend, migrations, tests). |
| **DB-** | Schema / migration / seed semantics worth remembering. |
| **PRD-** | Documented deviation from historical PRD / backlog intent — *by design* after decision (see `docs/PRD_AND_CRS.md`). |

**GitHub issues:** For work also tracked on GitHub, add a **`GitHub:`** line on the entry with links to the issue(s). Repo: **`https://github.com/mangatrai/grove`**. When a fix ships, **close or update** the issue (and adjust this entry if the scope changed).

## FP-8 — PA quick-capture inbox (POST /family/agent/capture) (2026-06-27)

**What changed:** New `POST /family/agent/capture` endpoint accepts `{ note: string }` and returns `{ responseText, actions[] }` inline (synchronous, no email, no DB write). Agent parses freeform notes into suggested actions (`create_event`, `set_reminder`, `draft_message`, `note`). Uses shared tool loop with `search_web` available (Tavily, max 3 iterations). Added `CaptureAction` / `CaptureResult` types to `family.types.ts`.

**Files:** `backend/src/modules/family/family.types.ts`, `backend/src/modules/family/family-agent.service.ts`, `backend/src/modules/family/family-events.routes.ts`

**GitHub:** closes https://github.com/mangatrai/grove/issues/151

---

## FP-7 — Tool calling + Tavily search wired into family agent (2026-06-27)

**What changed:** Extracted Tavily web search into `backend/src/llm/tools/tavily.ts` (`tavilySearch()` + `SEARCH_WEB_TOOL` constant). Family agent now uses `getToolUseAdapter().runToolLoop()` with `search_web` as an available tool (max 4 iterations) — the model can search for public deadlines, school enrollment windows, camp sign-up dates etc. before producing its JSON analysis. Protest module updated to use shared `tavilySearch()` (removed inline fetch duplication).

**Files:** `backend/src/llm/tools/tavily.ts` (new), `backend/src/modules/family/family-agent.service.ts`, `backend/src/modules/protest/protest.routes.ts`

**GitHub:** closes https://github.com/mangatrai/grove/issues/150

---

## FIX-197 — JSON enforcement wired through shared LLM adapter (2026-06-27)

**What changed:** Added `responseFormat?: "json"` to the shared `CompletionOptions` interface. OpenAI chat path now passes `response_format: { type: "json_object" }` when set (hard enforcement). Anthropic chat path appends a "Return ONLY valid JSON" instruction to the system prompt. Family agent now passes `responseFormat: "json"` at its call site, replacing prompt-only JSON enforcement.

**Files:** `backend/src/llm/types.ts`, `backend/src/llm/providers/openai.ts`, `backend/src/llm/providers/anthropic.ts`, `backend/src/modules/family/family-agent.service.ts`

**GitHub:** closes https://github.com/mangatrai/grove/issues/149

---

## FIX-192 — Near-duplicate rows now inserted as status='duplicate' and flow through standard resolution (2026-06-27)

**What changed:** Near-duplicate canonical rows (same account/date/amount, different fingerprint) were previously skipped entirely — a `resolution_item` was created but no `transaction_canonical` row was inserted, so "Resolve" did nothing and the raw transaction was permanently buried. Now they are inserted with `status='duplicate'` (same as exact duplicates) so the existing resolution pipeline handles them: Needs Review shows them, "Resolve" promotes to posted, "Trash" moves to trashed.

**Fix:** Added `skipResolutionItem?: boolean` to `insertExactDuplicateForReview()`. In the `isNear` block the function is called with `skipResolutionItem=true` (the resolution_item was already created by the near-dup detection code above), inserting the canonical row without creating a second flag. Two test assertions updated to reflect that near-dup rows now count toward `canonicalRowCount` and `deletedCanonicalRows` on undo.

**Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/app.test.ts`

**GitHub:** closes https://github.com/mangatrai/grove/issues/148

Entries are **newest-first** within each calendar period. IDs are stable; do not renumber.

---

## UX-R06 — Net Worth: footnote on Household Total explaining real estate inclusion (2026-06-27)

**What changed:** The Household Breakdown table total includes property market values (from `property_value_snapshot`) but member rows only cover financial accounts — properties have no individual owner in the data model, so the gap was unexplained. Added a dimmed footnote below the table: "* Household Total includes $X in real estate market value. See Properties section below." Only shown when at least one property has a market value on record.

**Files:** `frontend/src/pages/NetWorthPage.tsx`

**GitHub:** closes https://github.com/mangatrai/grove/issues/147

---

## DOC-011 — ADMIN_GUIDE §10.1 wrong env var for Google Calendar OAuth redirect URI (2026-06-26)

**What changed:** Section 10.1 listed `GOOGLE_REDIRECT_URI` as the env var to set for Google Calendar OAuth, but the GCal backend (`gcal.routes.ts`, `gcal.service.ts`) reads `GOOGLE_CALENDAR_REDIRECT_URI`. The Drive module uses `GOOGLE_REDIRECT_URI` — they are distinct variables. Corrected the env block to show `GOOGLE_CALENDAR_REDIRECT_URI` with the correct callback path (`/gcal/oauth/callback`) and added a note distinguishing it from the Drive var.

**Files:** `docs/ADMIN_GUIDE.md`

**GitHub:** closes https://github.com/mangatrai/grove/issues/145

---

## FIX-197 — Settings: Family tab content duplicated under Data & Backup tab (2026-06-26)

**What changed:** `FamilySection` component was rendering unconditionally, ignoring its `active` prop. This caused the Family section to appear inside both the Family tab and the Data & Backup tab simultaneously.

**Fix:** Added `if (!active) return null;` guard in `FamilySection.tsx` before the return statement, matching the pattern already used by `BackupRestoreSection`.

**Files:** `frontend/src/pages/settings/FamilySection.tsx`

---

## FIX-196 — Family agent: add 'suggestion' to alert_type check constraint (2026-06-26)

**What changed:** `family_agent_alerts.alert_type` CHECK constraint was missing `'suggestion'`, causing a DB constraint violation when the LLM agent emitted suggestions alongside conflict/coverage alerts.

**Root cause:** Migration 0072 defined the constraint with only 4 values (`conflict`, `travel`, `coverage_gap`, `deadline_approaching`). The TypeScript type already included `"suggestion"` — the constraint was never updated to match.

**Fix:** Migration 0077 (`0077_family_alert_type_suggestion.sql`) drops and recreates the constraint to include all 5 values.

**Files:** `backend/db/migrations/0077_family_alert_type_suggestion.sql`

---

## v6.0.0 — Family Planner, GCal integration, payslip fixes (2026-06-25)

Includes all Family Planner work (FP-1 through FP-4): Google Calendar OAuth, Events/Deadlines pages, household assistant agent, proactive deadline reminders, member profile UI, help availability CRUD. Plus FIX-193 and FIX-194 (payslip detail regressions).

New env var required in production: `GOOGLE_CALENDAR_REDIRECT_URI` (GCal OAuth callback). DB migrations (oauth_integrations, person_profile extensions, household_help_availability) apply automatically on startup.

---

## FIX-194 — Payslip detail: added line items not rendering; Gross Pay not editable (2026-06-25)

**Issue 1 — newly added earnings rows invisible:** `PayslipDetailPage.tsx` had a `mergedLineItems` filter that removed earnings items whose names appeared in `other_deductions`. The filter was intended to prevent duplicate display when the LLM places the same item in two sections, but that is structurally impossible (each `payslip_line_item` row has exactly one `section` in the DB). In practice the filter was silently dropping user-added earnings rows whose names happened to match any `other_deductions` item. DB arithmetic changed (backend `applyDerivedSummary` ran correctly) but the rows never appeared on screen. Removed the earnings filter; `other_deductions` items are still merged into `post_tax_deductions` for display.

**Issue 2 — Gross Pay total not editable:** The "Gross Pay" row at the bottom of the Earnings section is a `LITotalRow` (read-only summary) backed by `payslip_snapshot.gross_pay_current`. At import time this value comes from the LLM PDF extraction; `applyDerivedSummary` (which recalculates from line item sums) only runs on subsequent line item mutations. Extended `LITotalRow` with optional edit props and wired a pencil icon on the Gross Pay row that opens inline NumberInput fields for current + YTD. Save calls `PATCH /payslips/:id` directly. Value will be recalculated from earnings line items on next line item mutation.

**Files changed:**
- `frontend/src/pages/PayslipDetailPage.tsx` — removed bad earnings filter; extended `LITotalRow`; added gross pay override state + `handleGrossPaySave`; added `IconCheck`, `IconX` to icon imports

**GitHub:** closes #140

---

## FIX-193 — V6 Family Planner: PATCH /members missing relationship field (2026-06-25)

`PATCH /api/family/members/:id` returned 400 when saving `notes` + `relationship: "employee"` together. Root cause: the Zod schema for the endpoint did not include `relationship`, and the service only updated `person_profile` — not `household_membership` where `relationship` lives. Fixed all three layers:

- `family.types.ts` — added `relationship` to `UpdateMemberProfileInput`
- `family-profiles.service.ts` — added a separate `UPDATE household_membership SET relationship = ?` when `input.relationship` is present
- `family-profiles.routes.ts` — added `relationship: z.enum([...])` to `updateMemberSchema`

**GitHub:** closes #139

---

## FIX-192 — V6 Family Planner: five UX/schema fixes (2026-06-24)

Five bugs and design issues reported after initial V6 testing:

1. **DB: age=0 constraint** (`person_profile_age_check`) — infants couldn't be saved because CHECK required `age > 0`. Migration 0076 widens to `age >= 0`. `backend/db/migrations/0076_family_fixes.sql`
2. **DB/API/UI: day_of_week → days_of_week** — single-day `INTEGER` column replaced with `TEXT` (comma-separated, e.g. "1,3,5"). Nanny schedule can now cover Mon–Fri in one row instead of five. Migration 0076 migrates existing data. `family-profiles.service.ts`, `family-profiles.routes.ts`, `family.types.ts`
3. **DB: employee relationship** — `household_membership.relationship` CHECK expanded to include `'employee'`. Migration 0076. Dropdown now shows "Employee / Nanny" option in Settings → Household. `SettingsPage.tsx`
4. **UI: recurring event form** — Replaced six hardcoded combo options with two independent fields: Frequency (Weekly/Biweekly/Monthly) + Days-of-week MultiSelect. Format stored: `"weekly:1,3,5"`. `FamilyEventsPage.tsx`
5. **UI: Family section layout + notes icon** — Member cards now in 2-col `SimpleGrid`. Day-of-week in schedule entry is now `MultiSelect`. Notes icon (`IconNotes`) added next to each household member in Settings → Household, opens a modal to edit `person_profile.notes`. `FamilySection.tsx`, `SettingsPage.tsx`

Migration: 0076. Tests: 573 pass (1 pre-existing backup test failure unchanged).

---

## CR-139 — V6 Family Planner FP-4: deadline reminder cron job — 30/7/1-day email alerts (2026-06-24)

Implements proactive email reminders for deadlines tracked in the Family → Deadlines page.
A daily cron job at 8:07am (`env.TZ`) scans all active upcoming deadlines within a 30-day window.
For each deadline, up to three reminder horizons fire: 30 days before (low urgency), 7 days (approaching), 1 day (urgent).
Each horizon is idempotent — a `reminder_*d_sent_at` column on `family_events` is stamped after the first successful send; subsequent daily runs skip already-sent horizons.
Reminders are sent to all household members with linked app accounts.
Email is a consolidated digest per household per run (not one email per deadline).
Files: `backend/db/migrations/0075_deadline_reminders.sql`, `backend/src/modules/mailer/templates/deadline-reminder.ts` (new), `backend/src/modules/family/deadline-reminder.service.ts` (new), `backend/src/modules/family/family-agent.scheduler.ts`.
GitHub: closes #130

## CR-138 — V6 Family Planner Phase 2C: agent enriched with full member profiles + caregiver roster (2026-06-24)
Replace `getHouseholdChildren()` (name + age only) with `listHouseholdMembers()` + `listAvailability()` from `family-profiles.service.ts`.
Agent prompt now includes all member relationships, ages, interests, and notes; plus the full `household_help_availability` schedule (service type, slot type, day/time per caregiver).
Coverage gap detection now checks actual caregiver schedule before flagging a conflict; activity suggestions match each child's registered interests.
Files: `family-agent.service.ts`.
GitHub: closes #138

## UX-137 — V6 Family Planner: FamilySection settings tab — member profiles + help schedule UI (2026-06-24)

**What changed:** Settings → Family tab replaced bare GCalSection with a full `FamilySection` component containing three subsections.

1. **Household Members** — cards per member showing interests (TagsInput, ≤30 tags), notes (Textarea, ≤2000 chars), age (TextInput); each saves independently via `PATCH /api/family/members/:profileId`.
2. **Care & Help Schedule** — table of active help availability slots with add/edit/delete; add form covers person, service type (nanny/babysitter/cleaner/activity_teacher/tutor/other), slot type (regular/one_off/unavailable), day-of-week or specific date, start/end times, label.
3. **Google Calendar** — existing GCalSection rendered at the bottom.

**Files:**
- `frontend/src/pages/settings/FamilySection.tsx` (new)
- `frontend/src/pages/SettingsPage.tsx` — import swapped GCalSection → FamilySection
- `docs/USER_GUIDE.md` — Family tab section added

**GitHub:** closes #137

---

## CR-136 — V6 Family Planner: member profile API + household help availability CRUD (2026-06-24)

**What changed:** Backend service and routes for household member profile editing and help schedule management.

1. **`family-profiles.service.ts`** (new) — `listHouseholdMembers`, `updateMemberProfile`, `listAvailability`, `createAvailability`, `updateAvailability`, `deleteAvailability`.
2. **`family-profiles.routes.ts`** (new) — `GET /api/family/members`, `PATCH /api/family/members/:profileId`, `GET /api/family/availability`, `POST /api/family/availability`, `PATCH /api/family/availability/:id`, `DELETE /api/family/availability/:id`.
3. **`family.types.ts`** extended — `HouseholdMember`, `HelpAvailabilitySlot`, `UpdateMemberProfileInput`, `CreateAvailabilityInput`, `UpdateAvailabilityInput`, `SlotType`, `ServiceType`.
4. **`app.ts`** — mounts `familyProfilesRouter` at `/api/family`.
5. **`openapi/openapi.yaml`** — 6 new endpoint entries + `HouseholdMember` and `HelpAvailabilitySlot` schemas.
6. **`docs/API_REFERENCE.md`** — new "Family Planner — Member Profiles & Help Availability" section.
7. **`backend/tests/family-profiles.test.ts`** — 12 tests covering list, update, and availability CRUD.

**Files:** `backend/src/modules/family/family-profiles.service.ts`, `backend/src/modules/family/family-profiles.routes.ts`, `backend/src/modules/family/family.types.ts`, `backend/src/app.ts`, `openapi/openapi.yaml`, `docs/API_REFERENCE.md`, `backend/tests/family-profiles.test.ts`
**GitHub:** https://github.com/mangatrai/grove/issues/136

---

## DB-074 — V6 Family Planner: person_profile extensions + household_help_availability (2026-06-24)

**What changed:** DB foundation for V6 Family Planner data model.

1. **`person_profile` extended** — two new columns: `interests_json TEXT NOT NULL DEFAULT '[]'` (hobbies, food preferences, activity interests — feeds agent context for all household members including spouse) and `notes TEXT` (freeform sticky note per person, same UX as property notes).
2. **`household_help_availability` table** — unified schedule roster for ALL household help (nanny regular hours, babysitter one-offs, house cleaner, activity teachers, tutors). Two orthogonal dimensions: `slot_type` (regular / one_off / unavailable — the schedule pattern) and `service_type` (nanny / babysitter / cleaner / activity_teacher / tutor / other — what they do). Indexed on household_id, person_profile_id, and (household_id, is_active, slot_type).
3. **Export registry updated** — `household_help_availability` added to EXPORT_REGISTRY at restoreOrder 28.

**Files:** `backend/db/migrations/0074_family_planner_profiles.sql`, `backend/src/modules/export/export-registry.ts`
**GitHub:** https://github.com/mangatrai/grove/issues/135

---

## FIX-195 — Family Planner: restore full PA scope, add kid context, fix recipient routing (2026-06-24)

**What changed:** The FIX-194 agent prompt fix overcorrected — restricting the agent to childcare-gap detection only, which broke the intended household executive assistant scope.

1. **Agent scope restored to full PA**: System prompt rewritten from "sole focus is CHILD-CARE coverage gaps" to household executive assistant managing calendars, logistics, and planning. Agent now surfaces schedule pressure, heavy days, travel implications, approaching deadlines, and seasonal planning opportunities — not just childcare gaps.

2. **Recipient routing fixed**: The root cause of the original bad alert (nanny asked to "manage scheduling conflicts") was wrong recipient assignment, not wrong scope. Rules now explicitly map each `recipientHint` to its correct `copyPasteText` shape: Nanny gets childcare requests, Spouse gets coordination asks, Self gets calendar action suggestions.

3. **Kid context injected**: `getHouseholdChildren()` queries `person_profile JOIN household_membership WHERE relationship='child'`. Ages are passed into the analysis prompt so the agent can make age-appropriate planning suggestions (e.g., summer camp types, activity ideas).

4. **New alert type `suggestion`**: Added `"suggestion"` alertType for proactive planning opportunities (seasonal activities, enrollment windows, annual appointments due). Displayed as "Planning" badge (teal) in the agent page.

5. **`conflict` alert renamed to "Schedule pressure"** in the UI (orange) to distinguish it from `coverage_gap` (red — children need care, nobody available).

**Files:** `backend/src/modules/family/family-agent.service.ts`, `frontend/src/pages/FamilyAgentPage.tsx`
**GitHub:** closes #128

---

## FIX-194 — Family Planner: agent prompt, digest recipients, layout polish (2026-06-24)

**What changed:** Three post-testing fixes to the V6 Family Planner module.

1. **Agent prompt tightened** — the LLM was flagging parent-vs-parent scheduling conflicts (overlapping work meetings, medical appointments) and suggesting nanny involvement. Rewrote the system prompt and rules to make clear: a conflict is ONLY a child-care coverage gap (unmet pickup, dropoff, or supervised care window). Added explicit "NOT conflicts" examples. Nanny recipient hint now restricted to childcare schedule changes only.

2. **Digest log recipients** — added `recipients_json TEXT` column to `family_digest_log` (migration `0073_family_digest_recipients.sql`). Agent now records which parent emails were successfully sent in each run. `GET /api/family/digests` returns the `recipients` array. Agent page digest history table now shows recipient emails per run and supports click-to-expand full summary text (replaces `lineClamp={2}`).

3. **Page layout** — removed hardcoded `maxWidth: 800/820` from `FamilyEventsPage`, `FamilyDeadlinesPage`, and `FamilyAgentPage` root Stack wrappers so content fills the available content area.

**Files changed:**
- `backend/db/migrations/0073_family_digest_recipients.sql` (new)
- `backend/src/modules/family/family-agent.service.ts` — prompt rewrite, recipients tracking in email loop + UPDATE query, `DigestLogEntry` + `listDigestLog` updated
- `frontend/src/pages/FamilyAgentPage.tsx` — `DigestEntry.recipients`, expandable summary row, recipients column, removed maxWidth
- `frontend/src/pages/FamilyEventsPage.tsx` — removed maxWidth
- `frontend/src/pages/FamilyDeadlinesPage.tsx` — removed maxWidth

**GitHub:** refs #129 (agent), #128 (digest)

---

## CR-193 — V6 Family Planner: phase 2 — Agent page, scheduled cron worker, alert system (2026-06-23)

**What changed:** Completed the Family Planner module with the background agent, alert system, digest log, and Agent page UI.

**DB migrations:**
- Migration `0072_family_agent_tables.sql`:
  - `gcal_last_synced_at` column on `oauth_integrations` — stores per-user GCal fetch timestamp for delta sync
  - `family_agent_alerts` table — agent writes one row per detected conflict (reason, copy_paste_text, recipient_hint, alert_type, resolved tracking)
  - `family_digest_log` table — one row per agent run (run_type, status, alerts_created, emails_sent, summary_text)
- `export-registry.ts`: `family_agent_alerts` at restoreOrder 26, `family_digest_log` at 27

**Backend — family-agent.service.ts:**
- `runFamilyAgent(householdId, runType)` — main entry point; fetches GCal events for all connected parents, fetches DB family_events, calls LLM for conflict analysis + digest generation, writes alerts, sends per-parent emails, updates gcal_last_synced_at, writes digest log
- GCal delta: daily_delta runs pass `updatedMin=gcal_last_synced_at`; sunday/monday/manual runs do full 14-day fetch
- LLM: `getChatAdapter().complete()` with strongModel(); JSON-only response — conflicts array + per-parent digest email content
- `listAlerts`, `resolveAlert`, `listDigestLog` — read/update helpers for the Agent tab
- `runFamilyAgentForAllHouseholds(runType)` — iterates all households with connected calendars

**Backend — family-events.routes.ts (extended):**
- `GET /api/family/alerts?includeResolved=true` — list active (or all) alerts
- `PATCH /api/family/alerts/:id/resolve` — dismiss an alert
- `GET /api/family/digests` — digest run history
- `POST /api/family/agent/run` — manual trigger (owner only)

**Backend — family-agent.scheduler.ts + server.ts:**
- Cron: Sunday 7:00pm (sunday_preview), Monday 7:03am (monday_digest), Tue–Sat 6:32am (daily_delta)
- All use `env.TZ` for timezone; registered in server.ts startup block

**Frontend — FamilyAgentPage.tsx (full implementation):**
- Alert cards: reason text, colored left border by type, pre-written copy-paste message in a Code block with clipboard button, dismiss button
- "Show resolved" toggle reveals dismissed alerts grayed out
- Digest history table: run type, timestamp, status badge, alerts_created, emails_sent, summary_text
- "Run now" menu (owner only) — manual trigger with run type selection
- Refreshes alert + history panels after manual runs

**Files changed:**
`backend/db/migrations/0072_family_agent_tables.sql` (new),
`backend/src/modules/family/family-agent.service.ts` (new),
`backend/src/modules/family/family-agent.scheduler.ts` (new),
`backend/src/modules/family/family-events.routes.ts` (extended),
`backend/src/modules/export/export-registry.ts`,
`backend/src/server.ts`,
`frontend/src/pages/FamilyAgentPage.tsx` (full rewrite)

---

## CR-192 — V6 Family Planner: phase 1 — Events, Deadlines, GCal settings (2026-06-23)

**What changed:** Built the first functional phase of the Family Planner module.

**Bug fix:**
- `frontend/vite.config.ts`: added `/gcal` and `/api/family` to Vite proxy list — GCal Settings page was getting back `index.html` instead of JSON, causing "Unexpected token '<'" parse error.

**GCal settings improvements:**
- Migration `0070_gcal_calendar_selection.sql`: added `selected_calendar_ids` (TEXT) and `calendars_fetched_at` (TIMESTAMPTZ) to `oauth_integrations`.
- New `GET /gcal/calendars` — lists user's accessible Google Calendars with color dots.
- New `PATCH /gcal/calendars` — saves selected calendar IDs for the agent to filter on.
- `gcal.service.ts`: `listUserCalendars`, `saveCalendarSelection`, `getCalendarSelection` functions added. `listUpcomingEvents` updated to use selected calendars only (falls back to all if nothing selected).
- `GCalSection.tsx`: full Mantine redesign — connection status card with connect/reconnect/disconnect, calendar picker (checkbox list with color dots) shown post-connection.

**V6 family_events backend:**
- Migration `0071_family_events.sql`: unified `family_events` table with `record_type` (event/deadline), `source` (gcal/tavily/manual), `gcal_event_id`, `gcal_calendar_id`, `assignee_ids` (JSON), soft delete.
- `family_events.service.ts`: `listFamilyEvents`, `getFamilyEvent`, `createFamilyEvent`, `updateFamilyEvent`, `deleteFamilyEvent`, `upsertGcalEvent` (used by agent sync later).
- `family-events.routes.ts`: CRUD at `GET/POST /api/family/events` and `GET/PATCH/DELETE /api/family/events/:id`. GET allows member role (nanny-accessible); write operations owner/admin only.
- `export-registry.ts`: `family_events` registered at restoreOrder 25.
- `app.ts`: router mounted at `/api/family`.

**V6 routing + UI:**
- Planner sub-page removed — `FamilyPlannerPage.tsx` and `FamilyActivitiesPage.tsx` deleted.
- Sidebar: "Planner" and "Activities" removed; "Events" added at `/family/events`.
- App.tsx: `/family` and `/family/activities` redirect to `/family/events`.
- `FamilyEventsPage.tsx`: list view with source + recurring badges, add drawer (title, start/end, location, recurring select, all-day, notes), per-row delete.
- `FamilyDeadlinesPage.tsx`: list with urgency countdown badges (overdue/today/Nd), add drawer (title, due date, notes), per-row delete.

**Files changed:**
`frontend/vite.config.ts`, `frontend/src/App.tsx`, `frontend/src/layout/AppSidebar.tsx`,
`frontend/src/pages/FamilyEventsPage.tsx` (new), `frontend/src/pages/FamilyDeadlinesPage.tsx` (rewritten),
`frontend/src/pages/settings/GCalSection.tsx` (rewritten),
`backend/db/migrations/0070_gcal_calendar_selection.sql` (new),
`backend/db/migrations/0071_family_events.sql` (new),
`backend/src/modules/gcal/gcal.service.ts`, `backend/src/modules/gcal/gcal.routes.ts`,
`backend/src/modules/family/` (new module: types, service, routes),
`backend/src/modules/export/export-registry.ts`, `backend/src/app.ts`

---

## DOC-003 — Family Planner PRD-F: architecture revision after design session (2026-06-23)

**What changed:** Major decisions from design review session — updated `docs/PRD_AND_CRS.md` section 12 (PRD-F) and commented on GH issues #127–#130.

**Key decisions recorded:**
- **Planner sub-page dropped** — native Google Calendar handles side-by-side calendar views better; not worth building
- **Events + Deadlines = one table** (`family_events`) with `record_type` (event/deadline) and `source` (gcal/tavily/manual)
- **Activities renamed to Events** — broader scope: recurring kid activities AND one-off appointments; agent extracts both from GCal
- **Agent is a scheduled background worker, not a chat interface** — no suggestion-card approval flow
- **Revised digest cadence:** Sunday always, Monday always (with duty assignments), Tue–Sat only if conflict found (delta via GCal `updatedMin`)
- **GCal delta mechanism:** store `gcal_last_synced_at` per user; use `updatedMin` param — no event content stored in DB
- **Alert model simplified:** agent writes alert record with conflict reason + pre-written copy-paste text; owner acts manually; no in-app send infrastructure in V6
- **Agent tab UI:** top = active alerts, bottom = digest history; RBAC-scoped
- **Nanny schedule V6:** simple fields on staff profile; full employment module is V7

**Files:** `docs/PRD_AND_CRS.md` (section 12 — UI Placement, Agent Architecture, Notification Strategy, Feature Phasing all updated)
**GitHub:** comments added to https://github.com/mangatrai/grove/issues/127, /128, /129, /130

---

## UX-R05 — Family sidebar section + GCal connect UI in Settings [FP-1c] (2026-06-23)

Added the "Family" navigation group to the sidebar (hidden for `member` role) with four stub pages — Planner, Activities, Deadlines, Agent — all guarded by `RequireOwnerOrAdmin`. Added a "Family" tab to Settings (visible to owner/admin) containing `GCalSection`: per-user Google Calendar connect/disconnect UI that shows connection status, handles `?gcal=connected|error` callback params, and calls `GET /gcal/oauth/url` → redirect on connect.

**Files:** `frontend/src/layout/AppSidebar.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/settings/GCalSection.tsx` (new), `frontend/src/pages/FamilyPlannerPage.tsx` (new), `frontend/src/pages/FamilyActivitiesPage.tsx` (new), `frontend/src/pages/FamilyDeadlinesPage.tsx` (new), `frontend/src/pages/FamilyAgentPage.tsx` (new). GH: refs #127.

---

## CR-135 — Google Calendar OAuth backend: connect/status/events [FP-1b] (2026-06-22)

Added `backend/src/modules/gcal/` module implementing per-user Google Calendar OAuth2 (`calendar.readonly` scope). Both parents (owner + admin roles) connect their own Google accounts independently; tokens stored in the existing `oauth_integrations` table with `provider = 'google_calendar'`, `user_id = userId` (user-scoped). The same Google Cloud project (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) is reused; a separate redirect URI (`GOOGLE_CALENDAR_REDIRECT_URI`) is added to `env.ts`.

**Routes added (base `/gcal`):**
- `GET /gcal/oauth/url` — returns Google consent URL (owner, admin)
- `GET /gcal/oauth/callback` — OAuth redirect handler (public; state HMAC-signed)
- `POST /gcal/connect` — direct code exchange used by SPA flow (owner, admin)
- `GET /gcal/status` — per-user connection state; exposes `needsReauth` flag (owner, admin)
- `DELETE /gcal/disconnect` — removes requesting user's tokens only (owner, admin)
- `GET /gcal/events?days=N` — lists upcoming events across all user's calendars; defaults 14d, max 90d (owner, admin)

Token encryption uses AES-256-GCM with a separate key purpose string (`household-finance:gcal-token:…`) distinct from Drive tokens. On Google 401/403, the service marks `needs_reauth = TRUE` and returns `401 GCAL_NEEDS_REAUTH`. `oauth_integrations` is in `EXPORT_EPHEMERAL_TABLES` — tokens never appear in `.hfb` backups.

**Files:** `backend/src/modules/gcal/gcal.service.ts` (new), `backend/src/modules/gcal/gcal.routes.ts` (new), `backend/src/app.ts` (register `/gcal`), `backend/src/config/env.ts` (`GOOGLE_CALENDAR_REDIRECT_URI`), `backend/tests/gcal.test.ts` (new, 15 tests), `docs/API_REFERENCE.md` (Google Calendar section added)

**GitHub:** closes #134 (FP-1b Calendar OAuth backend)

---

## DB-002 — Unified oauth_integrations table replaces household_gdrive_config (2026-06-22)

Replaced the narrow `household_gdrive_config` table with a new `oauth_integrations` table that handles both Google Drive (household-scoped, `user_id IS NULL`) and Google Calendar (user-scoped, one row per parent). Partial unique indexes enforce uniqueness per scope since standard UNIQUE constraints treat NULLs as distinct. Drive-specific columns (`folder_id`, `folder_name`, `backup_frequency_hours`, `backup_retention_count`, `last_scheduled_backup_at`) live in the same table and are NULL for Calendar rows. Added `access_token`/`access_token_expiry` columns for Calendar token caching. `oauth_integrations` is in `EXPORT_EPHEMERAL_TABLES` — OAuth credentials must never appear in `.hfb` backups; users re-connect after restore.

**Files:** `backend/db/migrations/0069_oauth_integrations.sql` (create + migrate + drop), `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/gdrive/gdrive-scheduler.service.ts`, `backend/src/modules/export/export-registry.ts`, `backend/tests/gdrive*.test.ts` (4 files)

**GitHub:** #127 (FP-1 Google Calendar integration)

---

## DOC-002 — Family Planner: iOS Shortcut setup documented in ADMIN_GUIDE (2026-06-22)

Work calendar mirroring via iOS Shortcuts → Google Calendar confirmed working during FP-5 spike. Key finding: "Show Compose Sheet" toggle must be OFF on the "Add New Event" action to suppress per-event confirmation dialogs — without this, automated runs stall waiting for user input. Full setup instructions added to ADMIN_GUIDE §10 covering Google Cloud project setup, OAuth consent screen (must publish to Production to avoid 7-day token expiry), per-parent Google Calendar connect, and Shortcut build steps with automation scheduling.

**Files:** `docs/ADMIN_GUIDE.md` (§10 added)

**GitHub:** #131 (FP-5 work calendar discovery spike)

---

## DOC-001 — Family Planner Module: requirements captured, PRD-F added (2026-06-22)

Requirements gathered via structured PM session for a new household coordination assistant. Covers both parents (same O365 locked-down calendars), two kids (elementary school + infant), nanny (to be hired). Key decisions: V1 ships with Google Calendar integration only; work calendar is a tracked discovery item (O365 passkey-auth blocks external sharing); weekly digest is per-person (Sunday preview + Monday full); agent uses existing LLM adapter with Tavily tool use in suggest+approve mode; new Family sidebar section with Planner / Activities / Deadlines / Agent sub-pages.

**Files:** `docs/PRD_AND_CRS.md` (§12 added)

**GitHub:** See V6 milestone — Family Planner issues (Google Calendar integration, weekly digest, household agent, deadline tracker, work-cal discovery spike).

---

## FIX-191 — Payslip employer lookup scoped to session user, not account owner (2026-06-21)

When Head imports a member's payslip (e.g. spouse with Deloitte), two callsites queried the session user's profile instead of the file owner's profile → `INVALID_EMPLOYER`.

**Bind step** (`import-file-binding.service.ts`): Added `findEmployerByPersonProfileId` (profile-scoped) and `findEmployerAcrossHousehold` (household-wide). When `ownerPersonProfileId` is set, validates against that profile; otherwise falls back to household-wide search.

**Parse step** (`import-parser.service.ts`): `requireEmployerForPayslipImport` and `findEmployerById` both used session `userId` (Head's IBM profile). Fixed: employer count now reads from `file.owner_person_profile_id` when set (via `getEmployersByPersonProfileId`), and the employer ID lookup uses `findEmployerAcrossHousehold` — finds the employer regardless of which household member owns it.

Added `getEmployersByPersonProfileId` and `findEmployerByPersonProfileId` to `household.service.ts` / `payslip-employer-resolve.service.ts`.

**Files:** `backend/src/modules/household/household.service.ts`, `payslip-employer-resolve.service.ts`, `import-file-binding.service.ts`, `payslip.routes.ts`, `import-parser.service.ts`

**GitHub:** closes #126

## UX-R04 — ESPP stat grid responsive breakpoints (2026-06-21)

ESPP year-summary stat grid was `SimpleGrid cols={5}` with no responsive breakpoints — on a ~390 px phone each card was ~78 px wide causing label truncation and right-edge overflow. Changed to `cols={{ base: 2, xs: 3, sm: 5 }}`: 2-column grid on mobile, 3 on tablet, 5 on desktop.

**Files:** `frontend/src/pages/EsppPage.tsx`

**GitHub:** closes #125

---

## UX-R03 — Mobile ledger card layout + FIX model hardcoding in year-summary (2026-06-20)

**UX-R03:** Transactions ledger now renders a card-per-row layout below 640 px instead of the horizontal-scroll table. Uses `useMediaQuery("(max-width: 640px)")` from `@mantine/hooks`; table is unchanged on wider viewports. Cards include all functionality: checkbox selection, date/amount/status/transfer badges, merchant, memo inline edit, category picker with classification hint, recurring toggle, trash/restore/delete actions. Needs-review tab: "Why" reasons inline + collapsible "Context" button that expands the full resolution-item panel (unknown category picker, transfer ambiguity radio + confirm, near-duplicate details, resolve/reopen/trash actions). Bulk action bar above the list is unchanged and works on mobile.

**Model hardcoding fix:** `year-summary.service.ts` was passing the literal string `"gpt-4o"` to `client.chat.completions.create()` instead of `env.OPENAI_STRONG_MODEL`. Fixed to use the env var so the "Wrapped" summary follows the same model config as the rest of the strong-model paths.

**Files:** `frontend/src/pages/TransactionsPage.tsx`, `backend/src/modules/reports/year-summary.service.ts`

**GitHub:** closes #29

---

## FIX-190 — Register property_valuation_failed notification type (2026-06-20)

**Problem:** FIX-188 added `createNotification({ type: "property_valuation_failed" })` calls to `realty-scheduler.service.ts` but never registered the type in `NotificationType` or `NOTIFICATION_DEFAULTS`. TypeScript compiled locally (tsc was not run in strict mode at commit time) but Heroku's production build failed with `TS2820: Type '"property_valuation_failed"' is not assignable to type 'NotificationType'`.

**Fix:** Added `"property_valuation_failed"` to the `NotificationType` union and to `NOTIFICATION_DEFAULTS` with `enabledEmail: true, enabledInapp: true, audience: "owner"` — matching the pattern of `backup_failed`.

**Files:** `backend/src/modules/notifications/notification.service.ts`

---

## CR-193 — Mantine AppShell migration Phase 4: dead CSS purge (2026-06-20)

Removed all CSS rules whose selectors no longer match any element in the DOM after Phases 1–3.

**Removed:**
- `.app-shell` and `.app-shell-main` — replaced by Mantine `<AppShell>` and `<AppShell.Main>`
- `.app-sidebar` (root geometry: `width`, `position: sticky`, `height: 100vh`, `z-index`, `transition`) — replaced by `<AppShell.Navbar>`
- `.app-sidebar--collapsed { width: 3.5rem }` — AppShell now controls width via CSS vars (240/56px via props)
- `.app-sidebar__link-abbr` and `.app-sidebar--collapsed .app-sidebar__link-abbr` — class never rendered in TSX
- `.app-topbar` (root geometry: `position: sticky`, `z-index`, `flex-shrink`) — replaced by `<AppShell.Header>`
- `.app-topbar__menu-btn` (base + mobile `display: inline-flex`) — replaced by `<ActionIcon hiddenFrom="sm">` in Phase 3
- `.app-topbar__icon-btn` and `.app-topbar__icon-btn:hover` — class never rendered in TSX

**Kept intact:** all `app-sidebar__*` internal rules, `app-topbar__inner/spacer/actions/import-btn`, `app-sidebar-backdrop`, `app-sidebar--collapsed .app-sidebar__*` descendant rules, `app-frame*`, `app-main`.

CSS bundle: 253KB → 252KB (−1.35KB minified).

**Files:** `frontend/src/index.css`

**GitHub:** closes #35

---

## CR-192 — Mantine AppShell migration Phase 3: hamburger → ActionIcon (2026-06-20)

Replaced the raw `<button class="app-topbar__menu-btn">` hamburger with Mantine `<ActionIcon hiddenFrom="sm">`. Same `IconMenu2` icon — zero visual change. `hiddenFrom="sm"` replaces the CSS show/hide pattern; `.app-topbar__menu-btn` rules are now dead code (Phase 4 cleanup).

Nav links, collapse button, import button, theme switcher, and user menu deferred — migrating nav links to Mantine `NavLink` would require new CSS overrides to match the left-border active design, which contradicts the standing rule against new custom CSS.

**Files:** `frontend/src/layout/AppTopBar.tsx`

**GitHub:** relates to #35

---

## CR-191 — Mantine AppShell migration Phase 2: mobile drawer cleanup (2026-06-20)

Removed dead CSS that Mantine AppShell now owns, and replaced the manual `useState` mobile-open setter with `useDisclosure`.

**What changed:**
- `ShellLayout.tsx`: Replaced `const [mobileNavOpen, setMobileNavOpen] = useState(false)` with `useDisclosure(false)`. Route-change close effect uses stable `closeMobileNav`. Both render paths pass `onCloseMobile={closeMobileNav}` and `onOpenMobileNav={openMobileNav}` directly instead of inline arrow wrappers.
- `index.css` (mobile `@media max-width: 768px`): Removed `.app-sidebar { position: fixed; transform: translateX(-100%) }`, `.app-sidebar--mobile-open { transform: translateX(0) }`, `.app-sidebar--collapsed:not(.app-sidebar--mobile-open) { width: 15rem }`, and `.app-shell-main { overflow-x: hidden }` — all dead since Phase 1. Comment updated on `.app-main { overflow-x: hidden }` (still live).
- `index.css`: Removed entire `@media (min-width: 769px)` block — it only contained `.app-sidebar--mobile-open { transform: none }` which is now dead.

**What stays:** `app-sidebar-backdrop` CSS and component render (Mantine AppShell has no built-in overlay; we keep the custom backdrop for click-outside-to-close UX). Desktop dead-code CSS (`.app-shell`, `.app-sidebar`, `.app-topbar` geometry) deferred to Phase 4 cleanup.

**Files:** `frontend/src/layout/ShellLayout.tsx`, `frontend/src/index.css`

---

## CR-190 — Mantine AppShell migration Phase 1: structural swap (2026-06-20)

Replaced the hand-rolled shell wrappers with Mantine v7 `AppShell` primitives. All internal content (nav links, topbar buttons, hamburger, theme switcher, notifications, user menu) is unchanged — Phase 1 is structural only.

**What changed:**
- `ShellLayout.tsx`: `<div class="app-shell">` + `<div class="app-shell-main">` → `<AppShell layout="alt" navbar=... header=...>` + `<AppShell.Main>`. Both authed render paths updated. Sidebar collapse drives `width: 240|56`. Mobile open state drives `collapsed: { mobile: !mobileNavOpen }`. `transitionDuration={200}` preserves the width animation.
- `AppTopBar.tsx`: `<header class="app-topbar">` → `<AppShell.Header style={{...}}>`. Visual styles (bg, border, shadow) moved inline.
- `AppSidebar.tsx`: `<aside class="app-sidebar [...]">` → `<AppShell.Navbar className={collapsed ? "app-sidebar--collapsed" : undefined} style={{...}}>`. `app-sidebar` and `app-sidebar--mobile-open` removed from element (Mantine manages those). `app-sidebar--collapsed` kept for descendant CSS effects (link layout, text hiding).
- `index.css`: Merged `max-width: 1500px; margin: 0 auto; box-sizing: border-box` into `.app-main` directly — the `.app-shell-main > main.app-main` selector is dead after the DOM change. Other shell CSS left as dead code for Phase 4 cleanup.

**Why `layout="alt"`:** Current design has sidebar spanning full viewport height and header only spanning the main column (not above the sidebar). Mantine default `layout="default"` makes the header full-width — wrong for this design.

**Files:** `frontend/src/layout/ShellLayout.tsx`, `frontend/src/layout/AppTopBar.tsx`, `frontend/src/layout/AppSidebar.tsx`, `frontend/src/index.css`

**GitHub:** relates to #35

---

## FIX-188 — Property refresh: eliminate duplicate API calls; emit failure notification from scheduler (2026-06-20)

**Problem (duplicate calls):** `PropertyDetailPage.refreshValuation()` tried `/household/properties/:id/refresh` first, got a 404 (endpoint never existed), then fell back to `/refresh-valuation` — resulting in 2 API calls per button click. Additionally, rapid double-clicks could fire a second call before the `refreshing` guard had updated.

**Fix (frontend):** Removed the dead fallback; now calls `/refresh-valuation` directly. Added `if (!propertyId || refreshing) return;` in-flight guard so double-clicks and re-renders during a pending refresh are harmless.

**Problem (silent scheduler failures):** When the monthly realty scheduler's `refreshPropertyValuation()` returned `ok: false` or threw an exception, the error was only logged — no in-app notification was created, leaving users unaware.

**Fix (backend):** `realty-scheduler.service.ts` now calls `createNotification` with `type: property_valuation_failed` in both failure paths (soft failure and exception). Added `address_line1` to the scheduler property query so the notification body includes the property address.

**Files:** `frontend/src/pages/PropertyDetailPage.tsx`, `backend/src/modules/household/realty-scheduler.service.ts`

**GitHub:** closes #118

---

## FIX-189 — Non-DCAD properties no longer trigger DCAD enrichment calls (2026-06-20)

**Problem:** Properties outside Denton County (e.g. Memphis TN) incorrectly triggered DCAD API calls at three sites in `protest.routes.ts`: manual comp addition (`POST /comps`), comp refresh (`POST /refresh-comps`), and the AI chat `fetch_dcad_comps` tool. The check `cadProvider === "dcad" ? "Denton" : null` computed a null county but still passed it through to `fetchDcadCanonical` / `runDcadBackfill`, causing unnecessary API calls and potential failures.

**Fix:** Added explicit `if (property.cadProvider === "dcad")` guards at all three call sites. Non-DCAD properties now skip the enrichment entirely. Hardcoded `county: "Denton"` (no longer nullable) within the guarded blocks. The AI chat tool returns an informative message when `fetch_dcad_comps` is invoked for a non-DCAD property. `dcadStarted` in the `refresh-comps` response is now accurately `false` for non-DCAD properties.

**Files:** `backend/src/modules/protest/protest.routes.ts`

**GitHub:** closes #117

---

## FIX-186 — Payslip import: wrong parser inferred when owner uploads for spouse/member with different employer (2026-06-18)

**Problem:** When the household owner uploaded a payslip for a spouse whose payslip account is linked to a different employer (e.g., Deloitte), the Import Workspace showed the owner's employer (IBM) in the "Ready:" label, and the wrong `parser_profile_id` was written to the DB on binding. Root cause: `ImportWorkspacePage` built the `incomeInference` employer context from `GET /household/settings`, which returns the **currently logged-in user's** employers only — not the selected account's owner's employers.

**Fix (backend):** `listHouseholdFinancialAccounts` now does a secondary `person_profile` lookup for each unique `owner_person_profile_id` referenced by payslip accounts, and includes the parsed `owner_employers` list inline in the `GET /imports/accounts` response.

**Fix (frontend):** Added `accountIncomeCtx()` helper that substitutes `account.owner_employers` when the account is of type `payslip` and the backend has provided a non-null employer list. Applied at all four `inferParserProfile` call sites (render-loop label, `onAccountChange`, `onEmployerChange` reset, new-account creation path). Also corrected `accountEmps` used for `showEmployerSelect` and auto-employerId selection so they reference the account owner's employers rather than the current user's.

**Files:** `backend/src/modules/imports/import-file-binding.service.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`

**GitHub:** https://github.com/mangatrai/grove/issues/115

---

## CR-187 — RAG chunk size: 300 → 150 words; make configurable via RAG_CHUNK_WORDS; tighten EMBEDDING_MAX_INPUT_CHARS (2026-06-17)

**Problem:** `EMBEDDING_MAX_INPUT_CHARS=8000` was a misleading env var — it was only a safety truncation applied before the OpenAI API call, not the actual chunk size. The real chunk size was `CHUNK_WORDS=300` (hardcoded), equivalent to ~1,500–2,000 characters. For structured tax documents (CAD evidence PDFs with tables, dollar amounts, comp addresses), 300-word chunks are too coarse — the embedding vector has to represent too many distinct facts, degrading nearest-neighbour precision.

**Change:** Dropped `CHUNK_WORDS` from 300 → 150 with the same 40-word overlap. At ~750–1,000 chars per chunk, each chunk maps to one semantic unit (a single comp row, a value breakdown, a paragraph) rather than a mixed block. `EMBEDDING_MAX_INPUT_CHARS` lowered from 8000 → 1500 (appropriate safety cap for 150-word chunks; ~8 chars/word × 150 = ~1,200 chars). Both values are now configurable via env.

**Caveat:** Existing stored chunks in `protest_document_chunks` are not re-processed. Only new uploads benefit. Re-upload protest documents to get sharper retrieval.

**Files:** `backend/src/modules/protest/chunking.service.ts`, `backend/src/config/env.ts`

**New env vars:**
- `RAG_CHUNK_WORDS` (default: 150) — word count per chunk
- `EMBEDDING_MAX_INPUT_CHARS` default lowered from 8000 → 1500

---

## FIX-185 — protest brief: use all active comps for §41.43; prefer DCAD stored data; add land/improvement to CAD breakdown; improve AI instructions (2026-06-17)

**§41.43 comps were blank:** The protest brief's Section 4 filtered equity comps to `dcad_search | cad_evidence` sources only, showing "No equity comps loaded" even when Redfin comps with DCAD-enriched `cadAssessedValueUsd` were present. Changed to use all non-excluded comps (`!c.excluded`) — matching the UI's `equityComps = activeComps` behaviour. Same comps back both §41.41 (via sold price) and §41.43 (via CAD assessed value).

**Section 2 showed Redfin assessed value when DCAD data was stored:** When no CAD evidence PDF was uploaded, the brief fell through to `vd.taxCurrent.assessedValue` (Redfin, may lag one year) even though `property.cadAssessedValueUsd / cadLandValueUsd / cadImprovementValueUsd` were already in the DB from DCAD enrichment. Added middle branch: if `property.cadAssessedValueUsd != null`, use DCAD stored data with land/improvement breakdown.

**YoY history was Redfin-sourced:** Changed the YoY table to call `adapter.getValueHistory(cadAccountId)` inline (same source as the property details page chart), with a silent fallback to Redfin `vd.taxHistory` if DCAD returns empty.

**CAD Breakdown missing land/improvement:** Added `property.cadLandValueUsd` and `property.cadImprovementValueUsd` lines to the CAD Valuation Breakdown section. Updated the `if` condition to also trigger when these fields are populated.

**AI instructions improved:** Updated data-source annotations to reflect actual sources; added reference to Section 6 strategy notes (when present); added §41.43 land/improvement sub-argument guidance (over-valued improvements relative to comps is independently protestable); added instruction to factor in YoY history and prior strategy in target-value recommendation.

**Files:** `backend/src/modules/protest/protest.routes.ts`

---

## FIX-184 — protest chat agent: inject comp data + worksheet context; rewrite system prompt; upgrade protest brief (2026-06-16)

**Chat agent — comps now visible:** The chat agent's system prompt previously had zero visibility into comps already loaded in `protest_comp`. This caused the agent to trigger a redundant DCAD backfill (via `fetch_dcad_comps`) even when comps were already present. Fixed by loading existing comps (`listWorksheetComps`) before building the system prompt and injecting them via a new `buildCompsContext` function. The context now includes equity comp $/sqft table with median/mean/range, and sold comp table with sale prices and $/sqft — with a clear instruction not to re-fetch unless the user explicitly asks.

**Chat agent — worksheet context:** `hearingDate`, `filingDeadline`, `informalOfferUsd`, and previously saved `strategyJson` are now included in the system prompt so the agent can factor in deadlines, settlement offers, and prior analysis without asking the user to re-state them.

**Chat agent — system prompt rewrite:** Rewrote the system prompt to add:
- A pre-computed equity strength signal (subject $/sqft vs. comp median $/sqft) in the property facts block
- Status-aware tactical instructions (`not_filed` → ask preliminary questions and size up grounds; `filed` → evidence gaps and informal prep; `informal` → settlement vs. ARB trade-off; `arb` → hearing talking points; `resolved` → lessons learned)
- Instruction to always call `update_strategy` after giving an assessment

**Protest brief — CAD valuation breakdown:** Added a "CAD Valuation Breakdown" sub-section to Section 2 showing `cadMarketValueUsd`, `cadAppraisedValueUsd`, `cadNetAppraisedValueUsd`, and `cadTaxLimitationValueUsd` from DCAD records when available. Flags if assessed value exceeds CAD market value (§41.41 signal).

**Protest brief — multiple reduction scenarios:** Section 4 equity comp stats now shows comp $/sqft mean in addition to median, and computes three reduction scenarios: comp median $/sqft, comp mean $/sqft, and Redfin AVM (if AVM < assessed).

**Protest brief — CAD evidence sales comps:** Section 5 now has two subsections: Redfin/manual sold comps (existing) and a new "CAD Evidence PDF — Sales Analysis Comps" table showing DCAD's own sales comps from the uploaded evidence PDF with distance, sale date, sale price, DCAD market value, and individual value. This is the strongest §41.41 evidence because it uses DCAD's own data.

**Protest brief — expanded AI instructions:** The "Instructions for AI Assistant" section at the bottom of the brief now includes structured data-source annotations, a required 5-section analysis format (evidence summary, ground-by-ground analysis, target value, ARB talking points, red flags), and explicit rules around using DCAD's own data.

**Files:** `backend/src/modules/protest/protest.routes.ts` (buildCompsContext, buildSystemPrompt, POST /chat, GET /protest-brief)

---

## FIX-183 — re-enrich comps on every Refresh; hide stale ARB hearing banner (2026-06-16)

**Step C re-enrichment**: `runDcadBackfill` Step C was filtering `cad_enriched_at IS NULL`, meaning redfin/manual comps were only DCAD-enriched once. Subsequent Refresh calls skipped them even if the address had been corrected or CAD values had changed. Changed the filter to `source != 'dcad_search'` so all non-dcad_search comps are re-enriched on every Refresh (dcad_search comps are already refreshed in Step B via ON CONFLICT).

**ARB banner**: The "Upcoming ARB Hearing" banner used `hearingDays <= 30` as its only upper bound but had no lower bound, so it continued showing after the hearing passed (e.g., "-7 days away"). Added `hearingDays >= 0` so the banner disappears once the hearing date is in the past.

**Files:** `backend/src/modules/protest/protest-worksheet.service.ts` (Step C query), `frontend/src/pages/TaxProtestPage.tsx` (banner condition)

---

## FIX-182 — protest comp duplicate-key crash (unhandled rejection) (2026-06-15)

When a user added a comp from the CAD search UI with a `cadPropertyId` that the DCAD backfill had already inserted, `addManualComp` fired a plain `INSERT` with no `ON CONFLICT` clause, violating `protest_comp_by_cad_pid`. Express 4 does not catch async route handler rejections automatically, so the error became an unhandled rejection that crashed the `tsx watch` process. A secondary vector: `void runDcadBackfill(...)` in `POST /refresh-comps` had no `.catch()`.

**Fix:**
- `protest-worksheet.service.ts` (`addManualComp`): before inserting, check if a comp with the same `cadPropertyId` already exists for the property/year; if so, return the existing row instead of inserting a duplicate
- `protest.routes.ts` (`POST /:propertyId/comps`): wrapped handler body in try/catch; returns 500 on unexpected DB errors
- `protest.routes.ts` (`POST /:propertyId/refresh-comps`): added `.catch()` to `void runDcadBackfill(...)` so any error escaping the per-iteration try/catches is logged rather than crashing the process

**GitHub:** https://github.com/mangatrai/grove/issues/111

---

## CR-186 — DCAD architectural refactor: single canonical service across all paths (2026-06-15)

`fetchDcadCanonical` is now the only DCAD function called outside `dcad-enrichment.service.ts`. All paths — property add, manual comp add, refresh — route through it.

**Changes:**
- `fetchDcadCanonical` accepts optional `prefetchedRow?: DCADProperty` to skip the redundant search when the caller already has the search result (Step B)
- New exports from `dcad-enrichment.service.ts`: `searchDcadComps`, `getCompImprovementFeatures` — low-level `searchDCADByAddress` and `getDCADImprovementFeatures` no longer imported anywhere outside the enrichment service
- `runDcadBackfill` is now 4 steps (A/B/C/D) instead of 5:
  - Step B: calls `fetchDcadCanonical(prefetchedRow)` per search result → full canonical INSERT in one shot
  - Step C (was D): removed source restriction — now enriches ALL unenriched comps (`redfin`, `cad_evidence`, `manual`) via `fetchDcadCanonical`; old Step C deleted
- New export `applyCanonicalToComp(compId, canonical)` — shared helper used by Step C and the manual comp route
- Manual comp add (`POST /:propertyId/comps`) now fires `fetchDcadCanonical` + `applyCanonicalToComp` immediately after insert (fire-and-forget)

**Files changed:**
- `backend/src/modules/protest/dcad-enrichment.service.ts`
- `backend/src/modules/protest/protest-worksheet.service.ts`
- `backend/src/modules/protest/protest.routes.ts`

GitHub: https://github.com/mangatrai/grove/issues/110

---

## CR-185 — DCAD pool/spa notes: propagate misc improvement details to property and comp notes (2026-06-15)

When DCAD enrichment finds pool/spa entries in `Misc Imp` improvements, the formatted note (e.g., `"Pool (DCAD: $15,000, built 2010); Spa (DCAD: $5,000)"`) is now written to:

- **Subject property** (`property.property_notes`) — only when currently NULL, so user-entered notes are never overwritten
- **DCAD search comps** (`protest_comp.notes`, Step C) — `COALESCE(notes, ?)` so existing user notes win
- **Redfin/CAD evidence comps** (`protest_comp.notes`, Step D both merge and non-merge paths) — same COALESCE logic

**Root cause of gap:** `fetchDcadCanonical` fetched `miscImprovements[]` from `getDCADImprovementFeatures` but only propagated the `hasPool` boolean, discarding the description/value/yearBuilt detail. `DcadCanonicalProperty` now carries `miscImprovements: MiscImprovement[]`.

No new migration — `property_notes` and `protest_comp.notes` already exist.

**Files changed:**
- `backend/src/modules/protest/dcad-enrichment.service.ts` — added `miscImprovements` field to `DcadCanonicalProperty`; import `MiscImprovement` type
- `backend/src/modules/protest/protest-worksheet.service.ts` — added `buildPoolNote()` helper; Steps A/C/D write pool notes

GitHub: https://github.com/mangatrai/grove/issues/109

---

## CR-184 — Realty API: schema-driven Redfin comp parsing via avm.__att_names (2026-06-15)

Replaced hardcoded `__atts` positional indices in `parseComps` with a schema-driven approach using Redfin's own `avm.__att_names` descriptor.

**How it works:** `avm.__att_names` is an array-of-arrays where `att_names[N]` lists field names in position order for type N. Every encoded object carries `__t_idx: N`. We build `AttSchema` (`Map<typeIdx, Map<fieldName, position>>`) from this at parse time, then look up fields by name via `attField(obj, "city", schema)` instead of `facts[3]`.

**Failure modes now covered:**
- **Position shifts** (what broke FIX-183): invisible — `attField` always finds the right slot
- **Field rename/removal**: `checkSchemaFields()` emits WARN at production log level before any comp fails to parse, listing exactly which fields went missing
- **`__att_names` itself missing**: WARN logged; `parseComps` returns 0 with clear message
- **Total comp parse failure** (0 from non-empty): existing WARN retained

**Removed dead code:** `atIdx<T>()` helper and `parseSashDate()` (both replaced by schema-driven lookup and `msToDate`).

**Files:** `backend/src/modules/household/realty-api.service.ts`

**GitHub:** closes #108

---

## FIX-183 — Realty API: Redfin comparable sales parser broken after API schema change (2026-06-14)

`parseComps` in `realty-api.service.ts` returned 0 comps despite the API returning 6 results. Root cause: Redfin changed their `__atts` positional encoding schema.

**Three things shifted (confirmed against saved live response + `avm.__att_names` schema descriptor):**

1. **Listing block** moved from `outerAtts[4]` → `outerAtts[5]` (new `editableHomeFact` slot inserted at [4]). Within the listing array: `listingPrice` [21→22], `numBedrooms` [26→27], `numBathrooms` [27→28], `salePrice` [50→51].
2. **Property/facts block** (still at `outerAtts[7]`) positions shifted: `sqFtFinished` now at [0] (was [21]); `city` moved [2→3] (slot [2] is now `countryCode` via `$ref`); `streetNumber` [5→6]; `streetType` [6→7]; `postalCode` [9→10]; `lotSqFt` [17→18]; `streetName` [19→20]; `state` [0→1].
3. **Sold date** was reading the wrong path (`outerAtts[6].__atts[2]['1'][0].lastSaleDate`). Correct path: `outerAtts[6].__atts[0].__atts[3]` (`lastSaleInfo.saleListingLastSaleDate`, unix ms).

Validated new mapping against all 6 comps in the saved API response before committing.

**Files:** `backend/src/modules/household/realty-api.service.ts`

**GitHub:** closes #107

---

## FIX-182 — Protest: openapi duplicate /comps path, missing protest-brief docs, dead code cleanup (2026-06-13)

Three follow-up fixes for PT-18:

1. **openapi.yaml duplicate path**: `/api/protest/{propertyId}/comps` was defined twice — once with only `post:` (add manual comp) and once with only `get:` (list comps). In YAML, duplicate keys cause the second to silently overwrite the first. Merged both operations under one path key.

2. **`GET /protest-brief` undocumented**: Endpoint shipped in CR-172 but was never added to `openapi/openapi.yaml` or `docs/API_REFERENCE.md`. Added full documentation: query params (`year`), response type (`text/plain`), sections in the output, `Content-Disposition` header.

3. **Dead code removed from protest module**: Unused imports and unreachable functions left over from the PT-18 migration:
   - `protest.routes.ts`: removed `type UnifiedComp`, `syncAppealStatus`, `CadProperty` imports (all unused); removed `formatCompSummary` function (defined but never called); removed `ratio` local variable in protest-brief loop (computed but not in output string)
   - `protest-evidence-docx.service.ts`: removed `CadEquityComp`, `BorderStyle` imports; removed `ProtestComp` type alias; removed `ppsf`, `bullet`, `noBorderTable` helper functions (all defined but never called)
   - `protest-service.test.ts`: removed `import crypto` (unused)

GitHub: closes #105

Files: `openapi/openapi.yaml`, `docs/API_REFERENCE.md`, `backend/src/modules/protest/protest.routes.ts`, `backend/src/modules/protest/protest-evidence-docx.service.ts`, `backend/tests/protest-service.test.ts`

---

## FIX-181 — Protest: Redfin comps never saved on new property creation (2026-06-11)

**Root cause:** `POST /properties` receives the full `valuationDetailJson` (including 6 Redfin comps) from the frontend after the preview-valuation flow, saves the Redfin IDs and estimate, and sets `valuation_fetched_at = NOW()`. However, it never called `saveRedfinComps` — those comps only reach `protest_comp` via `refreshPropertyValuation`, which is blocked by the 7-day rate limit since `valuation_fetched_at` was just set. Result: a newly-created TX property showed blank Market Evidence and Unequal Appraisal tables.

**Fix:** After the `UPDATE property SET ... valuation_fetched_at = NOW()` block in `POST /properties`, call `saveRedfinComps(id, householdId, taxYear, detail.comps)` immediately with the comp data already in memory. This is a pure DB write (no extra API call) and completes before the 201 response is sent, so comps are available as soon as the user navigates to the protest worksheet.

Files: `backend/src/modules/household/household.routes.ts`.

GitHub: closes #106

---

## FIX-180 — Protest: Redfin comps race condition; appraisal notice 400 (wrong office in JWT) (2026-06-10)

Two root-cause fixes:

1. **Redfin comps never in `protest_comp` (race condition)**: `refreshPropertyValuation` called `saveRedfinComps` with `void` — fire-and-forget. The `refresh-comps` route `await`s `refreshPropertyValuation` then immediately queries `listWorksheetComps`, but `saveRedfinComps` hadn't committed yet. All 6 parsed comps were silently lost on every refresh. Fixed: changed to `await saveRedfinComps(...)` so inserts complete before the function returns. Files: `backend/src/modules/household/property.service.ts`.

2. **Appraisal notice DCAD 400 (wrong office in JWT) + centralized service**: Both appraisal-notice routes derived `county` via `property.cadProvider?.replace("dcad_", "")` — for Denton properties where `cadProvider = "dcad"`, this produces `"dcad"` instead of `"Denton"`. `getToken("dcad")` then requests a JWT with `"office":"dcad"`, which DCAD's `shownoticelink` endpoint rejects with 400. All other protest routes correctly use `property.cadProvider === "dcad" ? "Denton" : null`. Fixed both routes. Additionally, the PDF route was calling `getToken` and `fetch` directly in `protest.routes.ts`, duplicating DCAD auth logic that belongs in `dcad-enrichment.service.ts`. Added `fetchDcadAppraisalNoticePdf(s3Id, county)` to the central service; route now calls it. Exported `BROWSER_HEADERS` from `dcad.service.ts`; `dcad-enrichment.service.ts` now uses static import instead of dynamic. Response body logging added on non-2xx. Files: `backend/src/modules/protest/protest.routes.ts`, `backend/src/modules/protest/dcad-enrichment.service.ts`, `backend/src/modules/protest/dcad.service.ts`.

GitHub: closes #104

---

## FIX-179 — Protest flow: market evidence empty, sold date deed fallback, saveCadEvidenceComps param mismatch, appraisal notice 404 UX (2026-06-10)

Five bug fixes:

1. **Market Value Evidence table empty after DCAD backfill**: `marketComps` filtered to `source === 'redfin' || 'manual'` only. When Step D merges a Redfin comp into an existing `dcad_search` row, the merged row keeps `source='dcad_search'`, causing it to be invisible in market evidence. Per the original plan design ("no strategy flags — all comps show in both views"), changed both `marketComps` and `equityComps` to use the same filter: all non-excluded comps. Added DCAD source badge (blue) to market evidence table rows.

2. **Sold date falls back to DCAD deed date**: When Step D enriches a Redfin comp and `sold_date` is null (common in TX non-disclosure), now sets `sold_date = COALESCE(sold_date, deedDate)`. For merge path (Redfin → existing dcad_search), uses `COALESCE(sold_date, redfin_sold_date, cad_deed_date)`. Market evidence table also shows `soldDate ?? cadDeedDate` in the Sold Date column.

3. **`saveCadEvidenceComps` param count mismatch**: Sales comp INSERT had 10 `?` placeholders but 11 params were passed — `perSqft` (always null for PDF comps) was included in params but not in the column list. Removed the extra param; `cad_per_sqft_assessed` will be set later by Step D DCAD enrichment.

4. **Appraisal Notice "not available" UX**: DCAD `shownoticelink` returns 400 when no notice is published for a property (expected, especially early in the season). Our server returns 404. Frontend now shows a yellow informational toast ("Appraisal notice not yet available for this property") instead of a red error for 404 responses.

5. **`cadDeedDate` missing from frontend `UnifiedComp` type**: Added `cadDeedDate: string | null` so the deed-date fallback in the Sold Date column compiles.

Files: `frontend/src/pages/TaxProtestPage.tsx`, `backend/src/modules/protest/protest-worksheet.service.ts`

GitHub: closes #103

---

## FIX-178 — Protest flow: appraisal notice modal, land/improvement display, $/sqft and sold date fixes (2026-06-10)

Four bug fixes in the protest worksheet and property detail pages:

1. **Appraisal Notice PDF — auth error**: The "View Appraisal Notice" button was a plain `<a target="_blank">` link which cannot send Bearer tokens, causing a 401. Changed to a click handler that `fetch()`es the PDF with `Authorization: Bearer`, wraps the bytes in a blob URL, and opens it in a Mantine `<Modal>` with an `<iframe>`. No new tab; no auth leak.

2. **$/sqft missing in Market Value Evidence**: `pricePerSqft` is pre-computed server-side and stored in `protest_comp.price_per_sqft`. If parsing yielded null (e.g., close-price index miss), the column showed "—" even when `soldPriceUsd` and `sqft` were visible. Added frontend inline fallback: `comp.pricePerSqft ?? round(comp.soldPriceUsd / comp.sqft)`.

3. **Sold Date clobbered on upsert**: `saveRedfinComps` ON CONFLICT set `sold_date = EXCLUDED.sold_date` unconditionally, overwriting a previously-stored date with null if the sash block failed to parse on a subsequent refresh. Fixed to `COALESCE(EXCLUDED.sold_date, protest_comp.sold_date)`. Same fix for `price_per_sqft`.

4. **Land + Improvement values not surfacing**: `property` table gained `cad_land_value_usd` and `cad_improvement_value_usd` in migration 0068 (populated by `runDcadBackfill`), but `property.service.ts` never read them back and they weren't exposed in any API response. Added all 6 DCAD value columns (`cadLandValueUsd`, `cadImprovementValueUsd`, `cadMarketValueUsd`, `cadAppraisedValueUsd`, `cadNetAppraisedValueUsd`, `cadTaxLimitationValueUsd`) to `PropertyRecord`, `PropertyRow`, `toPropertyRecord()`, and the `PropertyRecord` types in both `TaxProtestPage.tsx` and `PropertyDetailPage.tsx`. Subject property card now shows Land Value and Improvement Value columns. Property detail CAD Assessed section shows land/improvement breakdown inline.

Also fixed pre-existing TS errors from PT-18 migration: `ProtestComp`/`ManualSoldComp` imports removed from `arb-script.service.ts`, `protest-evidence.service.ts`, `protest-evidence-docx.service.ts`; `arb-script.service.ts` now uses `UnifiedComp` with correct field names (`cadAssessedValueUsd`, `cadPerSqftAssessed`); `ArbScriptInput.soldCompsNotes` removed; missing `CadProperty` import added to `protest.routes.ts`; `audience` field fixed in `notification.service.ts`.

Files: `backend/src/modules/household/property.service.ts`, `backend/src/modules/protest/protest-worksheet.service.ts`, `backend/src/modules/protest/arb-script.service.ts`, `backend/src/modules/protest/protest-evidence.service.ts`, `backend/src/modules/protest/protest-evidence-docx.service.ts`, `backend/src/modules/protest/protest.routes.ts`, `backend/src/modules/notifications/notification.service.ts`, `frontend/src/pages/TaxProtestPage.tsx`, `frontend/src/pages/PropertyDetailPage.tsx`

---

## UX-177 — Recurring Payments card: replace inline expand with modal (2026-06-09)

Clicking "+ N more" on the Recurring Payments dashboard card now opens a Mantine Modal listing all recurring charges instead of expanding the card inline. The card always shows the top 5 items; the modal shows all items with the same dismiss buttons. Fixes the visual issue where inline expansion caused all peer cards in the same `SimpleGrid` row to stretch to the same height.

**GitHub:** closes #100

Files: `frontend/src/pages/DashboardPageV2.tsx`

---

## FIX-176 — Notifications: add audience RBAC; fix large-transaction debit-only (2026-06-09)

Added `audience: "owner" | "triggering_user" | "all"` to every `NotificationType` default. `createNotification` now resolves recipients by audience when no `userId` is provided: `owner` queries `app_user WHERE role = 'owner'`; `triggering_user` without a `userId` logs a warning and skips (no fan-out); `all` preserves existing fan-out behaviour. Audience assignments: `backup_complete`, `backup_failed`, `restore_complete`, `property_valuation_updated`, `protest_filing_deadline_approaching`, `protest_hearing_approaching` → `owner`; `import_complete`, `export_ready` → `triggering_user`; budget and large-transaction types → `all`. Settings UI now shows a "Tax Protest" group with both protest deadline types; owner-only notification rows are hidden for non-owner members. `large_transaction` alert now fires only for debits (money leaving the account).

**GitHub:** closes #99

Files: `notification.service.ts`, `canonical-ingest.service.ts`, `frontend/src/pages/SettingsPage.tsx`

---

## FIX-175 — GDrive backup: failed jobs no longer cause perpetual nightly retries (2026-06-09)

`checkAndQueueDueBackups` previously queried only `status = 'complete'` to compute the last-backup timestamp. After any failure, `lastCompleteMs = 0`, making `due` always `true` — the scheduler re-queued a new backup job on every subsequent nightly cron tick. Fixed by changing the query to `status IN ('complete', 'failed')` so a failed attempt resets the 24h due-window the same way a success does.

**GitHub:** closes #98

Files: `gdrive-scheduler.service.ts`

---

## FIX-174 — Tax Protest: Redfin sqft=1 survives DCAD enrichment for sold comps (2026-06-08)

Three-layer bug caused Redfin's sqft=1 for sold comps to persist through DCAD enrichment: (1) `enrichSoldCompsCad` skipped `getDCADImprovementFeatures` when DCAD initial search result already had a non-null sqft (e.g., pool row returning sqft=1); (2) even if improvement features ran, `cache[addr].sqft ??` kept the bad value; (3) `buildSoldComps` preferred Redfin's `r.sqft` over DCAD cache sqft; (4) cache skip filter `!(a in existingCache)` prevented re-fetching once bad sqft was cached.

Fix: `enrichSoldCompsCad` now always calls `getDCADImprovementFeatures` when `cadAccountId` is available, and always uses `features.sqft` as the authoritative value (not a fallback). Cache filter re-fetches any address with cached sqft ≤ 1. `buildSoldComps` now prefers `cached?.sqft` over Redfin sqft. Trigger a "Refresh Comps" on existing properties to clear bad cached sqft values.

**GitHub:** closes #97

Files: `protest-worksheet.service.ts`, `protest.routes.ts`

---

## FIX-173 — Tax Protest: protest-brief crash + stale DCAD assessed value (2026-06-08)

**protest-brief: UNDEFINED_VALUE crash fixed (critical)**
`GET /:propertyId/protest-brief` called `getExcludedSoldComps(worksheet.id, householdId)` — two bugs in one line: (a) `worksheet.id` is the worksheet UUID not the property ID, and (b) the required `taxYear` third argument was missing, passing `undefined` to postgres. The postgres driver throws `UNDEFINED_VALUE` which then corrupts the connection pool, causing every subsequent DB call to fail with 500 until the process restarts. Fix: corrected to `getExcludedSoldComps(property.id, householdId, year)`. File: `protest.routes.ts`.

**property.cad_assessed_value_usd — new column (migration 0067)**
`saveCadSubjectIds` previously stored only `cad_property_id`, `cad_account_id`, and `cad_provider` on the `property` row, discarding the DCAD-sourced `assessedValue`. This meant the ARB script, evidence packet, and protest brief all fell back to Redfin's `taxCurrent.assessedValue` (which lags by one year) when no CAD evidence PDF was uploaded. Fix: added `cad_assessed_value_usd BIGINT` to the `property` table; `saveCadSubjectIds` now stores `subject.assessedValue` there on every refresh-comps / backfill run. The fallback chain in all three consumers is now: `cadEv.assessedValueUsd ?? property.cadAssessedValueUsd ?? taxCurrent.assessedValue`. Trigger a refresh-comps to populate the value for existing properties. Files: `migrations/0067_property_cad_assessed_value.sql`, `protest-worksheet.service.ts`, `property.service.ts`, `protest.routes.ts`.

**GitHub:** none

---

## CR-172 — Tax Protest: "Copy Protest Brief" button + accountId persistence fix (2026-06-07)

**accountId gap fixed (POST /comps path)**
When a comp was added via the CAD search UI (cad-search → POST /comps), the DCAD `accountId` was available in memory but not persisted — `addCADComp` wrote `raw_json = {}`. Any subsequent re-enrichment (e.g., pool notes backfill) would skip that comp because `accountId` was missing. Fix: `CadSearchResult` now includes `accountId`; POST /comps schema accepts it; `addCADComp` stores it in `raw_json: { accountId }` when provided. Files: `protest.routes.ts`, `protest-worksheet.service.ts`, `TaxProtestPage.tsx`.

**cad-search: always enrich sqft from improvement features**
Removed the conditional `(sqft == null || sqft <= 1)` guard. Now always calls `getDCADImprovementFeatures` for every comp with a known `accountId`, regardless of whether the raw search result already has an sqft value. Fixes properties where DCAD search returns a non-zero but wrong sqft (e.g., pool row returned first). File: `protest.routes.ts`.

**"Try property ID" hint on zero cad-search results**
When cad-search returns no results, the UI now shows an explanatory hint: DCAD address search can fail when street suffix differs (Rd vs Dr), and suggests trying the DCAD Property ID directly. File: `TaxProtestPage.tsx`.

**"Copy Protest Brief" button + backend formatter**
New `GET /protest/:propertyId/protest-brief?year=YYYY` endpoint. Deterministically formats all protest data (subject property, YoY valuations, CAD equity comps with $/sqft analysis, Redfin + manual sold comps, strategy notes, prior-year cycle summary) into a structured plain-text brief. Every number is read directly from the database — no LLM generation. Excluded sold comps are omitted. Includes opinionated analysis instructions that work with any AI assistant (Claude, ChatGPT, Gemini). Frontend: violet "Copy Protest Brief" button with Tooltip explanation; copies text to clipboard on click. Files: `protest.routes.ts`, `TaxProtestPage.tsx`.

## FIX-171 — Tax Protest: extend backfill to enrich comp sqft + pool notes via improvement API (2026-06-06)

`triggerCadBackfill` in `protest-worksheet.service.ts` now calls `getDCADImprovementFeatures` for every comp after the bulk DCAD address search. New function `enrichAndUpdateCadCompsImprovement` iterates non-subject comps, fetches improvement features, and UPDATEs `protest_comp_cad` with: corrected sqft (always prefer improvement-features over raw search result), beds/baths (fill-in if null), and pool/spa notes in the `notes` column when Misc Imp entries are found. Previously this enrichment only happened in the real-time manual search UI path — historically stored comps with sqft=1 required the user to manually re-add them. DCAD is a free public API; 20–30 calls per property creation is not a concern. File: `protest-worksheet.service.ts`. GitHub: https://github.com/mangatrai/grove/issues/92

## FIX-170 — Tax Protest: 6 bug fixes + pool detection feature (2026-06-05)

**Bug 1 — CRITICAL: Property ID overwrite in `saveCadSubjectIds`**
Removed `?? comps[0]` fallback. When subject not found by house-number match in DCAD search results, function now logs a warning and exits cleanly — never overwrites `property.cad_property_id` with a random comp's CAD ID. File: `protest-worksheet.service.ts`.

**Bug 2 — Stale 2025 assessed value in evidence packet**
`cadAssessed` in the evidence-packet route now prefers `cadEv?.assessedValueUsd` (from uploaded CAD evidence PDF, always current year) over `property.valuationDetail.taxCurrent.assessedValue` (Redfin data, can lag a year). File: `protest.routes.ts`.

**Bug 3 — ARB script JSON parse failure**
Model occasionally returns JS numeric literal syntax (`1_077_571`) which is valid JS but invalid JSON. Added `replace(/(\d)_(\d)/g, "$1$2")` to the raw-cleanup step before `JSON.parse`. File: `arb-script.service.ts`.

**Bug 4 — sqft = 1 for comps with pools**
`getDCADImprovementFeatures` now sums sqft only from Residential improvements (excludes Misc Imp entries like pools). `mapProperty` treats sqft ≤ 0 as null. The comp-search enrichment triggers when sqft is null or ≤ 1 (DCAD placeholder), and now always overwrites sqft with improvement-features value when available. Files: `dcad.service.ts`, `protest.routes.ts`.

**Bug 5 — Research notes leaking into ARB hearing packet (Document B)**
Removed `soldCompsNotes` rendering from Document B's Section 4B (Recent Market Sales table). Research notes are private and belong in Document A only. File: `protest-evidence-docx.service.ts`.

**Bug 6 — Account creation date default shows UTC date (wrong day after ~6pm CST)**
`SettingsPage.tsx` was using `new Date().toISOString().slice(0, 10)` (UTC) for `initialBalanceDate` default. Replaced with `localDateStr()` (uses local timezone `getFullYear/getMonth/getDate`) — pattern already used in `TransactionsPage.tsx`. File: `frontend/src/pages/SettingsPage.tsx`.

**Feature 7 — Pool / Misc Imp detection from DCAD improvements**
`getDCADImprovementFeatures` now collects Misc Imp entries (pools, spas, outbuildings) into a `miscImprovements: MiscImprovement[]` array. Returned in `GET /:propertyId/cad-search` results as `miscImprovements` per comp so the UI can display pool/spa presence. Files: `dcad.service.ts`, `protest.routes.ts`.

---

## CR-169 — Tax Protest: Evidence packet restructured into two purpose-built documents (2026-06-05)

**Evidence packet DOCX now generates two documents in one file:**

**Document A: Protest Filing Letter** — Formal letter to the ARB stating grounds (§41.41 market value, §41.43 unequal appraisal) with the requested value and $/sqft. Auto-selects which ground paragraphs to include based on available evidence. Ends with signature block.

**Document B: ARB Hearing Packet** — Modeled on real-world ARB packet structure:
- Section 1: Subject property detail table (DCAD ID, sqft, beds, baths, lot, condition %, assessed value, $/sqft, improvements, land, purchase price)
- Section 2: Taxpayer's Requested Value + supporting evidence data points table
- Section 3: Problems with DCAD's Evidence (3A: sales comp table with upward adjustment, sale age ≥ 18 months, distance ≥ 1 mi automatically flagged; 3B: equity analysis showing subject is the highest-assessed)
- Section 4: Taxpayer's Supporting Evidence (4A: DCAD equity comps table; 4B: market sales with notes)
- Section 5: Assessment Comparison Summary — all comps sorted by $/sqft with subject row highlighted (★)
- Negotiation Tracker — blank table for use during hearing

**Technical changes:**
- `protest-evidence-docx.service.ts` — complete rewrite (~390 lines); new helpers: `buildFilingLetter`, `buildSubjectDetailTable`, `buildRequestedValueSection`, `buildDcadProblemsSection`, `identifySalesCompIssues`, `buildTaxpayerEvidenceSection`, `buildAssessmentSummary`
- `protest-evidence.service.ts` — `EvidencePacketInput` expanded with 13 new fields: `city`, `state`, `cadPropertyId`, `avm`, `equityMedianUsd`, `sqft`, `beds`, `baths`, `yearBuilt`, `lotSqft`, `percentGood`, `improvementsUsd`, `landValueUsd`, `purchasePrice`, `purchaseDate`, `hearingDate`; also added `city` to `SoldComp` type
- `protest.routes.ts` — evidence-packet route updated to spread all new fields from worksheet into `packetInput`

**GitHub:** https://github.com/mangatrai/grove/issues/89

---

## FIX-168 — Tax Protest: Multiple data quality and UX fixes from E2E testing (2026-06-05)

**Issues fixed (from E2E testing session):**

1. **DCAD enrichment missing on initial load** — Redfin sold comps (Market Value Evidence / Unequal Appraisal) showed no sqft/beds/baths/assessed values until user manually clicked "Refresh Comps". Root cause: `triggerCadBackfill` (fire-and-forget at property creation) only fetched DCAD equity comps, not sold comp enrichment. Fix: added `enrichSoldCompsCad()` service function (extracted from `refresh-comps` route) and called it from `triggerCadBackfill` if `valuationDetailJson` is present. `household.routes.ts` now passes `valuationDetailJson` to `triggerCadBackfill`.

2. **Sqft decimal display** — DCAD returns sqft as a float (e.g., "4523.9"). All sqft values from `saveCADComps`, `matchCadAssessedValue`, `enrichSoldCompsCad`, and improvement features lookups now go through `Math.round()` before storage.

3. **Manual sold comp city field missing** — "Add Comparable Sale" modal had no city input; the full address including city went into the address field and city column showed "—". Fix: added city TextInput to modal, `city` field to `ManualSoldComp` type (both backend and frontend), wired through API schema and `addManualSoldComp` call.

4. **Notes missing for Redfin comps in Unequal Appraisal table** — Redfin comp rows in the Unequal Appraisal evidence section had an empty notes cell. Fix: added `CompNotePopover` using the shared `soldCompsNotes` state (same as Market Value Evidence notes).

5. **Agent chat: yes-man behavior and "I am limited" language** — System prompt rewritten to act as a property tax advisor, not a cheerleader. Agent now commits to positions, pushes back when evidence doesn't support user's target, and is instructed to try alternative DCAD search terms before giving up.

6. **`matchCadAssessedValue` moved to service** — Extracted from `protest.routes.ts` local scope to `protest-worksheet.service.ts` as an exported function, enabling reuse in `enrichSoldCompsCad` and eliminating duplication.

**Files changed:** `protest-worksheet.service.ts` (new: `matchCadAssessedValue`, `enrichSoldCompsCad`, `asRecord` helper; updated: `triggerCadBackfill`, `saveCADComps`, `ManualSoldComp`), `protest.routes.ts` (system prompt, schema, sqft rounding, removed local `matchCadAssessedValue`), `household.routes.ts` (`triggerCadBackfill` call site), `TaxProtestPage.tsx` (city field, notes for Redfin comps)

---

## FIX-162 — Tax Protest: Subject property appearing twice in Unequal Appraisal table (2026-06-05)

**Root cause:** `saveCADComps` saved every result from `cadAdapter.searchByAddress()` to `protest_comp_cad`, including the subject property itself. `listWorksheetComps` then returned all rows — so the subject appeared once as a regular DCAD comp row and again as the dedicated subject row shown separately in the UI. Because the CAD API returns different assessed values across tax years, a property that had been refreshed for both 2025 and 2026 would accumulate two subject rows with different valuations.

**Fix — prevention:** Added `searchAddress?: string` param to `saveCADComps`. When provided, the subject is identified by house-number prefix (same logic as `saveCadSubjectIds`) and excluded before the INSERT loop. All three call sites updated to pass the search address.

**Fix — existing data:** `listWorksheetComps` query now JOINs `property` and filters `pcc.cad_property_id != p.cad_property_id`, so any subject rows already persisted in `protest_comp_cad` are silently excluded from results without requiring a migration.

**Files changed:** `protest-worksheet.service.ts` (`saveCADComps`, `listWorksheetComps`, `triggerCadBackfill`), `protest.routes.ts` (two call sites)

---

## FIX-161 — Tax Protest: CAD evidence PDF parser broken for Denton CAD column-order extraction + sqft from improvement API (2026-06-05)

**Parser column-order bug:** Denton CAD evidence PDFs extract text column-by-column, meaning comp data appears *before* each section heading (not after). The original `parseCadEvidencePdf` used `findSection(header)` which slices from the heading forward — capturing only the median summary, missing all comp rows. Added `findSectionBefore(text, header, prevMarker)` and restructured parsing: `findSectionBefore` for comp data, `findSection` retained for medians (which correctly follow their heading).

**sqft from improvement API:** `getDCADImprovementFeatures` only returned `{ beds, baths }`. Extended to also return `sqft` aggregated from `livingArea` on the improvement list response (step 1). Updated cad-search enrichment and both refresh-comps callers in `protest.routes.ts` to populate `sqft` from the features result.

**Test fixtures updated:** Both `protest-service.test.ts` and `protest.test.ts` synthetic CAD evidence fixtures were rewritten to match real Denton CAD extraction order (comp data before headings).

**Files changed:** `cad-evidence-parser.service.ts`, `dcad.service.ts`, `protest.routes.ts`, `tests/protest-service.test.ts`, `tests/protest.test.ts`

**GitHub:** https://github.com/mangatrai/grove/issues/87

**Parser addendum (same commit):** Added `extractAddress()` helper to stop comp address extraction at Denton CAD section boundaries ("Situs Address", "Subject", "PROPERTY ID") — prevents last comp's address from bleeding into the public card section. Also corrected `equityMapText` source to use `findSection("EQUITY COMPARABLES MAP", "PUBLIC CARD WITH SKETCH")` (rows are after the heading, not before). Regex for both map parsers updated to handle Denton CAD's concatenated format with proper grouping.

---

## FIX-160 — Tax Protest: ARB script crash + sqft fallback + CAD search enrichment + evidence packet AVM removal (2026-06-05)

**ARB script crash:** `generateArbScript` (arb-script.service.ts) threw "invalid JSON" because GPT-4o wraps JSON responses in ```json…``` markdown fences even when the prompt says not to. Fixed by stripping leading/trailing fences before JSON.parse. Added log.error with response preview for future debugging.

**sqft/yearBuilt from CAD evidence:** When Redfin valuation detail is missing sqft or yearBuilt (common), the evidence packet, ARB script, and chat agent prompt all showed "—". Added fallback to `worksheet.cadEvidenceJson.livingAreaSqft` and `.yearBuilt` in the three places in protest.routes.ts that assemble these fields.

**CAD search beds/baths enrichment:** The cad-search endpoint returned beds/baths as null for DCAD results because the search API doesn't include improvement details. Now calls `getDCADImprovementFeatures()` for any result where beds or baths are null (same pattern already used in sold-comps refresh). Results are fetched in parallel.

**Evidence packet — removed AVM:** The valuation summary showed "AVM Estimate" (Redfin automated value) which is not valid Texas ARB evidence. Replaced with: CAD Assessed Value, Requested Value, Reduction Requested, DCAD Equity Median, Overassessment vs Equity. DCAD equity median comes from `cadEvidenceJson.equityAnalysis.medianIndValueUsd`. Bar chart retitled "§41.43 Unequal Appraisal — Assessed Value Comparison" and now plots assessed values (not market values) to support the unequal appraisal argument. Both PDF and DOCX updated.

**Files changed:** `arb-script.service.ts`, `protest.routes.ts`, `protest-evidence.service.ts`, `protest-evidence-docx.service.ts`

---

## FIX-159 — Tax Protest: JSONB double-encode bug + data repair migration + test coverage (2026-06-05)

**Bug:** Five write functions in `protest-worksheet.service.ts` passed `JSON.stringify(value)` into JSONB columns. The postgres driver re-serialized the string as a JSONB text value, causing reads to return `null` / `[]` instead of the real data. Silent data loss — no errors logged.

**Affected columns (all JSONB):** `cad_evidence_json`, `manual_sold_comps_json`, `sold_comps_cad_json`, `arb_script_json`. (`excluded_sold_comps_json` is TEXT — `JSON.stringify` is correct there.)

**Impact:** CAD evidence uploads and manual sold comps were stored but unreadable, so evidence packets silently omitted those sections.

**Fix:** `protest-worksheet.service.ts` — removed `JSON.stringify()` wrapper from `saveCadEvidence`, `saveManualSoldComps`, `saveSoldCompsCadCache`, `saveArbScript`. No data repair migration needed: all affected columns were introduced in v5 migrations (0063, 0066) and never reached production.

**Tests added:** `backend/tests/protest-service.test.ts` (24 new tests) covering worksheet state machine, manual comp CRUD, conversation persistence, deadline notifications, and CAD parser. `backend/tests/protest.test.ts` extended with 13 HTTP route integration tests (CAD comps, worksheet PATCH, CAD evidence upload/delete). Total backend: 551 tests.

## FIX-158 — E2E: ESPP import modal test updated for topbar button ambiguity (2026-06-04)

**GitHub:** closes #84

After the topbar "New import" button was added (I-2 async import), `getByRole('button', { name: 'Import' })` resolved to two elements. Updated selector to `{ exact: true }`, scoped `Purchase PDF` / `Allocation CSV` assertions to the dialog, and updated submit button label to its actual value `Import Files`.

**File:** `e2e/espp.spec.ts`

## FIX-156 — Net Worth: Trend and Balance Sheet refresh buttons decoupled (2026-06-04)

**GitHub:** closes #81

Pressing either refresh button on the Net Worth page triggered both the Trend chart and Balance Sheet to reload because both `useLocalStorageCache` hooks shared the `"networth"` scope.

- `frontend/src/cache.ts`: Added `"networth-history"` to `CacheScope`; updated property value/valuation CACHE_INVALIDATION_MAP entries to invalidate both `"networth"` and `"networth-history"` (property changes affect both sections).
- `frontend/src/pages/NetWorthPage.tsx`: History/Trend hook changed to `"networth-history"` scope; Balance Sheet refresh icon changed to call `refreshSheetCache()` only instead of `reloadAll()`. Error "Retry load" button intentionally retains `reloadAll()` since it appears when both sections are in error.

## FIX-157 — Payslip import: non-IBM employer profile no longer defaults to IBM (2026-06-04)

**GitHub:** closes #82

When importing a payslip PDF via an account of type `payslip`, the backend always returned the IBM profile (`ibm_pay_contributions_pdf`) regardless of which employer was configured. The `inferParserProfile` function returned IBM unconditionally for `payslip`+`.pdf` (line 81-83), bypassing the employer `parserProfileId` lookup that existed for PDF files matched by filename heuristic only.

The fix mirrors the frontend logic:
- Single employer → use `employer.parserProfileId ?? IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID`
- Multiple employers → return `null` (user selects manually)
- No employers → fall back to IBM

**File:** `backend/src/modules/imports/infer-parser-profile.ts`

---

## SEC-155 — Member RBAC read isolation: payslips, export download, account list (2026-06-04)

**GitHub:** closes #78

Members could previously read financial data belonging to other household members because read paths were unscoped — write-path enforcement existed but read paths relied on optional client-driven query params.

**Payslips (`backend/src/modules/payslip/payslip.routes.ts`):**
- `GET /payslips` — member requests are now forced to `ownerScope=person, ownerPersonProfileId=authUser.personProfileId`; client-supplied scope params are ignored.
- `GET /payslips/:id` — returns 404 if member is not the payslip owner.
- `PATCH /payslips/:id` — returns 403 if member is not the payslip owner.
- `POST /payslips/manual` — member cannot set `ownerPersonProfileId` to another profile; it is silently overridden to their own.

**Export jobs (`backend/src/modules/export/exports.routes.ts`):**
- `GET /exports/:jobId` — member gets 403 for jobs they did not create (`requested_by_user_id`).
- `GET /exports/:jobId/download` — same gate. Full household `.hfb` exports created by owner/admin are inaccessible to members.
- Restore remains owner-only (unchanged).

**Accounts (`backend/src/modules/imports/imports.routes.ts`, `import-file-binding.service.ts`):**
- `GET /imports/accounts` — members see only `household`-scoped accounts plus their own `person`-scoped accounts. Added `memberPersonProfileId` option to `listHouseholdFinancialAccounts`.

**Docs:** `docs/PRD_AND_CRS.md` §3.11 data visibility expanded with explicit per-resource rules. `docs/API_REFERENCE.md` updated for `GET /exports/{jobId}`, `GET /exports/{jobId}/download`, `GET /imports/accounts`.

---

## FIX-228 — DCAD improvement two-step fix + manual sold comps + Redfin TTL 7d (2026-06-04)

**What:**
1. DCAD improvement features call was hitting `/improvement/{pAccountId}/features` (wrong — pAccountId used where imprvID expected → 204 No Content). Now does two steps: `GET /propertyaccount/{pAccountId}/improvement` to get imprvID, then `GET /propertyaccount/improvement/{imprvID}/features`.
2. Manual sold comp add/delete for Market Value Evidence — `POST/DELETE /api/protest/:propertyId/sold-comps`. Persisted in new `manual_sold_comps_json` column on `protest_worksheet`. On Refresh, DCAD fills in assessed value and improvement features for any manual comps missing them.
3. Redfin refresh TTL extended from 24 hours to 7 days — Redfin sold comp data does not change daily.
4. Consolidated two duplicate Refresh buttons (Market Value + Unequal Appraisal) into one — both sections share the same underlying data.

**Changes:**
- `backend/db/migrations/0066_pt_manual_sold_comps.sql` — add `manual_sold_comps_json JSONB` to `protest_worksheet`.
- `backend/src/modules/protest/dcad.service.ts` — `getDCADImprovementFeatures`: two-step flow, proper imprvID resolution, 204 handling.
- `backend/src/modules/protest/protest-worksheet.service.ts` — `ManualSoldComp` type; `addManualSoldComp`, `removeManualSoldComp`, `saveManualSoldComps` functions; `manualSoldComps` in `ProtestWorksheetRecord`.
- `backend/src/modules/protest/protest.routes.ts` — `POST/DELETE /:propertyId/sold-comps`; `GET /sold-comps` returns `manualSoldComps`; `refresh-comps` processes manual comps through DCAD.
- `backend/src/modules/household/property.service.ts` — Redfin TTL 7 days.
- `frontend/src/pages/TaxProtestPage.tsx` — `ManualSoldComp` type; state + callbacks; Add button + modal in Market Value Evidence; manual comp rows in table; remove duplicate Refresh from Unequal Appraisal.

**GitHub:** closes #80

---

## FIX-227 — Redfin comp parser regression + DCAD improvement features for beds/baths (2026-06-03)

**What:**
1. Redfin comp parser regression from commit 36cda59: sash date index changed from `[2]` to `[3]`, but the actual Redfin API response has it at `[2]`. All comp sold dates were null.
2. Redfin comp sqft index wrong: parser read `facts[22]` but actual JSON shows sqft at `facts[21]`. All comp sqft values were null from Redfin.
3. DCAD has authoritative beds/baths via `GET /propertyaccount/improvement/{pAccountId}/features` (features array with "Bedrooms: X", "Plumbing: X"). Added `getDCADImprovementFeatures` to fetch these during comp refresh.
4. `SoldCompCadEntry` extended with `cadAccountId`, `beds`, `baths`, `sqft` — populated from DCAD search and improvement features. `buildSoldComps` now falls back to cached DCAD data when Redfin values are null.

**Changes:**
- `backend/src/modules/household/realty-api.service.ts` — fix sash index `[3]`→`[2]`; fix sqft index `facts[22]`→`facts[21]`; update comments.
- `backend/src/modules/protest/dcad.service.ts` — add `getDCADImprovementFeatures(pAccountId)` parsing "Bedrooms:" / "Plumbing:" feature strings.
- `backend/src/modules/protest/protest-worksheet.service.ts` — extend `SoldCompCadEntry` with `cadAccountId`, `beds`, `baths`, `sqft`.
- `backend/src/modules/protest/protest.routes.ts` — import `getDCADImprovementFeatures`; `matchCadAssessedValue` now captures `accountId`, `beds`, `baths`, `sqft`; refresh loop calls improvement features for comps with null beds/baths; `buildSoldComps` resolves beds/baths/sqft as `Redfin ?? DCAD`. Fixed `office` parameter: was passing `property.state` ("TX") to `getDCADImprovementFeatures` which caused `countyToOffice` to return "TX" instead of "Denton", resulting in auth failure — now passes `property.cadProvider === "dcad" ? "Denton" : null`.

**GitHub:** closes #78

## FIX-226 — DCAD appeal wiring + Unequal Appraisal pre-load + evidence section redesign (2026-06-03)

**What:**
1. DCAD appeal API endpoint existed but was never called by the frontend — appeal hearing date/status never shown.
2. `getDCADAppeal` mapped wrong field names: used `r.hearingDate` but actual API returns `docketDt`; used `r.filedDate` but API returns `informalDt`. `appealType` was not extracted at all.
3. Unequal Appraisal Evidence section only showed manually added DCAD comps, not the Redfin comps already present in Market Value Evidence.
4. CAD Evidence section had confusing layout: one card called "CAD Evidence Packet" with two unrelated upload actions sharing the same visual level — redesigned into "Evidence Documents" with two clearly separated sub-sections.
5. After evidence PDF upload with 0 extracted comps, UI showed nothing with no feedback.
6. Pre-existing TS error: `LlmUsage.total_tokens` should be `totalTokens` in `payslip-async-import-reconcile.service.ts`.

**Changes:**
- `backend/src/modules/protest/dcad.service.ts` — `DCADAppealEntry`: add `appealType` field. `getDCADAppeal`: fix field mapping (`docketDt` → `hearingDate`, `informalDt` → `filedDate`, `appealType`/`appealStatus` correct precedence).
- `backend/src/modules/protest/cad-adapters/cad-adapter.types.ts` — add `appealType` to `CadAppealEntry`.
- `backend/src/modules/imports/payslip-async-import-reconcile.service.ts` — fix `total_tokens` → `totalTokens` (TS error from LLM refactor).
- `frontend/src/pages/TaxProtestPage.tsx` — add `DcadAppeal` type; add `dcadAppeals` state; add `loadDcadAppeals` callback; wire into main useEffect; display DCAD appeal record (status badge, docket date, type, "Sync hearing date" button) in Protest Status card. Unequal Appraisal Evidence: pre-populate with Redfin sold comps (Redfin badge, violet), remove button excludes via `removeSoldComp`, CAD assessed ppsf for equity comparison. Evidence Documents: renamed from "CAD Evidence Packet"; split into two vertical sub-sections with matching header+description+action layout; zero-comps warning after upload.

**GitHub:** closes #77

## FIX-225 — DCAD value history field mapping + taxable parsing (2026-06-03)

**What:**
1. DCAD value history chart showed null/zero for all years because the code read `r.appraisedValue`, `r.marketValue`, etc., but the TrueProdigy API actually returns `owner*`-prefixed fields (`ownerAppraisedValue`, `ownerMarketValue`, `ownerLandValue`, `ownerImprovementValue`). All mapped values were null.
2. `getDCADTaxable` returned an empty array because it called `extractRows(body)` against a response where `body.results` is an **object** (not array). `extractRows` couldn't handle this shape, returning `[]`. The taxable breakdown — including the current-year `estimatedTaxes` total — was never returned.
3. Added debug logging (`log.debug`) on all DCAD request/response paths (valuehistory, taxable, appeal) for diagnosability.

**Changes:**
- `backend/src/modules/protest/dcad.service.ts` — `getDCADValueHistory`: add `owner*` prefix fallbacks first in all field reads. `getDCADTaxable`: remove `extractRows`, directly parse `body.results.taxingUnits` + `body.results.estimatedTaxes`; change return type from `Record<string, unknown>[]` to `DCADTaxableResult | null`; add `DCADTaxableUnit` and `DCADTaxableResult` types. Add `log.debug` throughout all DCAD API calls.
- `backend/src/modules/protest/cad-adapters/cad-adapter.types.ts` — add `CadTaxableUnit` + `CadTaxableResult` types; update `CadAdapter.getTaxable` signature to `Promise<CadTaxableResult | null>`.
- `backend/src/modules/protest/cad-adapters/dcad.adapter.ts` — import `CadTaxableResult`; update `getTaxable` return type.
- `frontend/src/pages/PropertyDetailPage.tsx` — add `dcadEstimatedTaxes` state; add `loadDcadTaxable` callback calling `/dcad/taxable`; trigger in the CAD account `useEffect`; use `estimatedTaxes` to fill `taxesDue` for the most recent DCAD year in `chartData`.
- `openapi/openapi.yaml` — update `/dcad/taxable` response schema to structured object.

**GitHub:** Closes #76

---

## FIX-224 — Payslip async scheduler + line item add refresh (2026-06-03)

**What:**
1. IBM (and Deloitte) payslips uploaded via import were stuck in "processing" indefinitely after I-2 unified both profiles to the async queue. There was no background scheduler to drive the queue — `PAYSLIP_ASYNC_POLL_INTERVAL_MS` existed in env.ts but was wired to nothing.
2. Adding a new line item to an existing payslip on the detail page (+ Add row → Add) saved correctly to the DB but the new row did not appear in the UI until the page was refreshed. Root cause: incremental state update in `handleAddLineItem` did not reliably reflect the server's grouped response in all rendering paths. Fixed by replacing the optimistic state merge with an `await load()` call that fetches the authoritative server state after a successful POST.

**Changes:**
- `backend/src/modules/imports/payslip-async-scheduler.service.ts` — new scheduler that queries all pending `openai_llm_payslip` import files across all households and calls `reconcilePayslipAsyncImportSession` for each unique session. Runs at `PAYSLIP_ASYNC_POLL_INTERVAL_MS` (default 120 s), fires once on startup.
- `backend/src/server.ts` — import and call `startPayslipAsyncScheduler()` in the non-TEST branch (alongside existing schedulers).
- `frontend/src/pages/PayslipDetailPage.tsx` — `handleAddLineItem`: replaced `applyLineItemMutation(data) + manual state merge` with `await load()` for guaranteed server-authoritative refresh after POST.

**GitHub:** Closes #75

---

## FIX-222 — Net worth cache no longer wiped on logout (2026-06-03)

**What:** `setToken(null)` called `clearAllCaches()` on logout, deleting all `hfa:*` localStorage keys including the `networth` and `dashboard` cached payloads. For a single-household app this is wrong — all members share the same household data, so there is no isolation reason to clear caches on session end. Every re-login hit the network cold, negating the 7-day / 24-hour TTL design. Also corrected ADMIN_GUIDE: balance-sheet snapshot TTL was documented as 1 hour but the code has used 24 hours since FIX-221.

**Changes:**
- `frontend/src/api.ts` — removed `clearAllCaches()` call and import from `setToken(null)` logout path; JWT removal remains the security boundary
- `frontend/src/cache.ts` — updated JSDoc on `clearAllCaches` (function kept, used in tests)
- `docs/ADMIN_GUIDE.md` — §7.2 snapshot TTL corrected 1h → 24h; §7.4 Logout updated to reflect new behaviour

**GitHub:** Closes #74

---

## I-2 — IBM payslip imports unified to async queue in Import flow (2026-06-03)

**What:** IBM payslip PDFs now go through the same async queue as Deloitte when imported via `POST /imports/sessions/:id/parse`. Previously IBM called OpenAI inline (synchronously during the HTTP request); Deloitte was already queued. The unification makes all LLM-based payslip profiles behave identically in the Import flow.

**Changes:**
- `payslip.types.ts` — added `LLM_PAYSLIP_PROFILE_IDS = [IBM_PAY_CONTRIBUTIONS_PDF_PROFILE_ID, DELOITTE_PAYSLIP_PDF_PROFILE_ID]` as the single source of truth for which profiles are async
- `import-parser.service.ts` — widened `if (profileId === DELOITTE_PAYSLIP_PDF_PROFILE_ID)` to `if (LLM_PAYSLIP_PROFILE_IDS.includes(profileId))`. Log message de-branded from "Deloitte" to generic "LLM payslip"
- `payslip-async-import-reconcile.service.ts` — SQL queries use `IN (?, ?)` for both IBM and Deloitte profile IDs (was single-value `= ?` hardcoded to Deloitte). Hardcoded `DELOITTE_PAYSLIP_PDF_PROFILE_ID` in JSON confidence_summary fields replaced with `file.parser_profile_id`
- `ImportWorkspacePage.tsx` — 4 banner/help strings de-branded from "Deloitte PDF(s)" to "payslip PDF(s)"
- `tests/payslip-upload.test.ts` — IBM import session test updated to expect `asyncPayslipPending: 1`, call `reconcile-payslip-async?force=true`, then check payslip list

**Scope:** Direct `POST /payslips/upload` for IBM is unchanged — it still calls OpenAI inline (acceptable; not a timeout risk in practice). Only the Import session path is affected.

**Why:** Root cause of the drift: IBM was originally parsed by a local PDF library (synchronous, no LLM) so inline processing was correct. When IBM was switched to LLM, the async queue path was never extended to cover it. The design intent was always to treat all payslips the same.

**GitHub:** Closes #26

---

## LLM-1 followup — Payslip vision uses chatModel(); OPENAI_MODEL default → gpt-4.1-mini (2026-06-02)

**What:** Reverted payslip PDF extraction (`extract-payslip-llm.ts`) from `strongModel()` back to `chatModel()`. Also updated `OPENAI_MODEL` default from `gpt-4o-mini` to `gpt-4.1-mini` (newer, confirmed working on both IBM and Deloitte stubs). `strongModel()` is now exclusively for the protest tool-use loop and ARB script.

**Why:** The LLM-1 refactor inadvertently moved payslip from `OPENAI_MODEL` (what it was using before, i.e. `gpt-4.1-mini`) to `OPENAI_STRONG_MODEL` (`gpt-4o`), a ~6× cost increase with no observed quality benefit for IBM stubs. Deloitte stubs were also working on mini in testing. Backlog item LLM-2 tracks: if Deloitte extraction errors appear in prod, revisit.

**Files:** `backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts`, `backend/src/config/env.ts`, `.env.example`, `docs/BACKLOG.md`

---

## LLM-1 — Provider-agnostic LLM adapter layer; no hardcoded model names (2026-06-02)

**What changed:**
- Introduced `backend/src/llm/` module: four typed adapters (`ChatCompletionAdapter`, `ToolUseAdapter`, `VisionAdapter`, `EmbeddingAdapter`) with OpenAI and Anthropic implementations.
- All six LLM call sites refactored to use adapters — no raw SDK imports remain outside the `llm/providers/` directory.
- Two model tiers surfaced via `chatModel()` (fast/cheap: `OPENAI_MODEL` / `ANTHROPIC_MODEL`) and `strongModel()` (capable: `OPENAI_STRONG_MODEL` / `ANTHROPIC_STRONG_MODEL`).
- New env vars: `OPENAI_STRONG_MODEL` (default `gpt-4o`), `ANTHROPIC_STRONG_MODEL` (default `claude-sonnet-4-6`), `EMBEDDING_PROVIDER` (default `openai`). `ANTHROPIC_MODEL` default changed to `claude-haiku-4-5-20251001`.
- `isLlmConfigured()` is now provider-aware (checks correct key for active `LLM_PROVIDER`).
- All `OPENAI_NOT_CONFIGURED` error codes → `LLM_NOT_CONFIGURED`.
- Payslip `LlmUsage.total_tokens` renamed to camelCase `totalTokens` throughout.

**Why:** Every LLM call site previously hard-coded `"gpt-4o"` or `"gpt-4o-mini"` strings and imported the OpenAI SDK directly. Switching provider or model required touching six separate files. The adapter layer lets `LLM_PROVIDER=anthropic` work end-to-end with only env changes.

**Files:** `backend/src/llm/types.ts`, `backend/src/llm/chat.ts`, `backend/src/llm/tool-use.ts`, `backend/src/llm/vision.ts`, `backend/src/llm/embeddings.ts`, `backend/src/llm/index.ts`, `backend/src/llm/providers/openai.ts`, `backend/src/llm/providers/anthropic.ts`, `backend/src/config/env.ts`, `backend/src/modules/insights/llm-provider.service.ts`, `backend/src/modules/protest/arb-script.service.ts`, `backend/src/modules/protest/embedding.service.ts`, `backend/src/modules/protest/protest.routes.ts`, `backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts`, `backend/src/modules/payslip/payslip-parse.service.ts`, `.env.example`, `docs/ADMIN_GUIDE.md`

**GitHub:** closes #73

---

## OPS-1/2/3/4 — Convert all schedulers to node-cron; add import file purge (2026-06-02)

**What changed:**
- **OPS-1 (GDrive backup):** Replaced 30-minute `setInterval` heartbeat with `node-cron` firing nightly at 11 PM CT (`"0 23 * * *"`, `America/Chicago`). `checkAndQueueDueBackups()` logic unchanged — still guards per-household `backup_frequency_hours`.
- **OPS-2 (Realty valuation):** Replaced 6-hour `setInterval` heartbeat with `node-cron` firing on the 1st of every month at 10 PM CT (`"0 22 1 * *"`). 28-day SQL guard in `checkAndRefreshProperties()` unchanged.
- **OPS-3 (Export cleanup):** Replaced `setInterval` hourly with `node-cron` `"0 * * * *"`. No timezone dependency; purely TTL-based cleanup.
- **OPS-4 (Import file purge — new):** Nightly at 2 AM CT (`"0 2 * * *"`), `purgeStaleImportFiles()` deletes on-disk staged import files for sessions older than 30 days and sets `stored_path = NULL`. DB rows (import_session, import_file) are never deleted — audit trail preserved.

**Why:** All schedulers now use deterministic wall-clock firing via IANA timezones rather than elapsed-time heartbeats that could drift or be skipped on cold start. OPS-4 prevents unbounded disk growth from abandoned import sessions.

**Files:** `backend/src/modules/gdrive/gdrive-scheduler.service.ts`, `backend/src/modules/household/realty-scheduler.service.ts`, `backend/src/modules/export/export-job.service.ts`, `backend/src/modules/imports/import-session.service.ts`, `backend/src/server.ts`

**GitHub:** closes #68, closes #69, closes #70, closes #71

---

## OPS — Env-drive embedding/RAG config; remove hardcoded model strings (2026-06-02)

**What:** Moved all hardcoded embedding/RAG values out of source code and into env vars:
- `EMBEDDING_MODEL` (default `text-embedding-3-small`) — controls OpenAI embedding model; changing it requires a DB migration + re-embed
- `EMBEDDING_MAX_INPUT_CHARS` (default `8000`) — truncation limit per chunk before embedding API call
- `RAG_TOP_K` (default `5`) — number of nearest-neighbour chunks returned by similarity query
- `RAG_MIN_SIMILARITY` (default `0.65`) — cosine similarity floor; chunks below filtered from context
- Added `optionalFloatEnv()` helper to `env.ts` for bounded float env vars (no prior helper existed)

**Why:** Model names and RAG tuning values change frequently; hardcoding forces code edits for operational changes. All values now configurable without a redeploy for tuning, and switchable to another embedding provider with only env changes.

**Files:** `backend/src/config/env.ts`, `backend/src/modules/protest/embedding.service.ts`, `backend/src/modules/protest/document-store.service.ts`, `.env.example`, `docs/ADMIN_GUIDE.md`, `docs/PRD_AND_CRS.md` (D-019 updated)

---

## PT-18 — Protest flow architectural redesign: unified protest_comp, DcadEnrichmentService, 5-step backfill (2026-06-09)

- **Migration 0068** (`0068_protest_comp_unified.sql`): new `protest_comp` table replaces `protest_comp_cad` + 4 JSONB blobs (`sold_comps_cad_json`, `sold_comps_notes_json`, `excluded_sold_comps_json`, `manual_sold_comps_json`); adds `appeal_json JSONB` to `protest_worksheet`; adds 14 CAD value columns to `property` (land, improvement, market, appraised, SU exclusion, homestead cap, net appraised, full value history JSON, taxable JSON, sqft/beds/baths/pool, enriched_at, appraisal notice S3 id + fetched_at)
- **New `dcad-enrichment.service.ts`**: `DcadCanonicalProperty` unified output type; `fetchDcadCanonical()` (search → improvement → optional value history + taxable); `fetchDcadCanonicalBatch()`; `fetchDcadAppeal()`; `fetchDcadAppraisalNoticeS3Id()` (appraisal notice PDF link via shownoticelink endpoint)
- **Rewritten `protest-worksheet.service.ts`**: `UnifiedComp` type mapping `protest_comp` columns; `listWorksheetComps()` reads from `protest_comp`; `addManualComp()`, `excludeComp()`, `deleteComp()`, `updateCompNote()` all by UUID; `saveCadEvidenceComps()` inserts PDF comps; `saveRedfinComps()` saves Redfin comps at valuation fetch; `runDcadBackfill()` 5-step pipeline (subject enrichment, DCAD comps insert, improvement enrichment with 150ms throttle, Redfin/cad_evidence merge with deduplication, appeal sync); `syncAppealStatus()` persists appeal data + hearing_date to worksheet
- **Updated `property.service.ts`**: `refreshPropertyValuation` saves Redfin comps to `protest_comp` via `saveRedfinComps()` (fire-and-forget)
- **Updated `protest.routes.ts`**: removed `/sold-comps` endpoints (GET/POST/DELETE); removed `/sold-comps/exclusions` and `/sold-comps/notes`; comp endpoints use UUID `id` instead of `cadPropertyId`; new `PATCH /comps/:compId/exclude`; `POST /refresh-comps` simplified to `refreshPropertyValuation` + fire-and-forget `runDcadBackfill`; evidence-packet and protest-brief read from `protest_comp` directly
- **Updated `household.routes.ts`**: property creation fires `runDcadBackfill` instead of old `triggerCadBackfill`
- **Updated `export-registry.ts`**: `protest_comp` registered (replaced `protest_comp_cad`)
- **Updated `TaxProtestPage.tsx`** (2026-06-10): migrated from multi-endpoint sold-comps approach to unified `protest_comp` API; removed `soldComps`/`manualSoldComps`/`excludedSoldComps`/`soldCompsNotes` state; added `marketComps` + `equityComps` memos; Market Evidence table reads from `marketComps` (source filter: redfin/manual/cad_evidence); Equity Evidence table reads from all non-excluded `equityComps`; source badges (DCAD/Redfin/Manual/CAD Evidence) on every comp row; comp notes and removal use UUID; "View Appraisal Notice" button in property header (opens `/api/protest/:id/appraisal-notice-pdf` in new tab when `cadAccountId` is set)
- **Bug fixes (2026-06-10)**: `runDcadBackfill` was missing `cad_provider = 'dcad'` in the UPDATE, causing DCAD display routes to return 404; DCAD display routes now use `inferCadProvider(property.state)` as fallback when `cadProvider` is null; `getDCADAppeal` crashed on 204 No Content (no-appeal response) with "Unexpected end of JSON input" — fixed by short-circuiting before `res.json()`; `RATE_LIMITED` error code from Redfin refresh was mapping to HTTP 500 instead of 429
- **GitHub:** closes #101

**Files:** `backend/db/migrations/0068_protest_comp_unified.sql`, `backend/src/modules/protest/dcad-enrichment.service.ts` (new), `backend/src/modules/protest/dcad.service.ts`, `protest-worksheet.service.ts`, `protest.routes.ts`, `backend/src/modules/household/property.service.ts`, `backend/src/modules/household/household.routes.ts`, `backend/src/modules/export/export-registry.ts`, `backend/db/seeds/dev/dev_0008_seed_properties.sql`, `frontend/src/pages/TaxProtestPage.tsx`

---

## PT-17 — AI oral ARB script generation (2026-06-02)

- New `POST /api/protest/:propertyId/generate-arb-script?year=N` endpoint generates a 6-step oral hearing script via GPT-4o
- Script includes: negotiation thresholds (open ask / ideal settle / walk-away min), §41.41 and §41.43 arguments with IF/THEN appraiser rebuttals, closing ask, panel Q&A
- Script persisted to `protest_worksheet.arb_script_json` (migration 0065); survives page reload
- Frontend: ARB Oral Script card visible when `status === 'arb'`; Accordion sections, negotiation table, Copy Script and Regenerate buttons
- Uses all available evidence: CAD evidence packet, equity comps with notes, Redfin sold comp research notes, AI strategy
- **GitHub:** closes #66

**Files:** `backend/db/migrations/0065_pt17_arb_script.sql`, `backend/src/modules/protest/arb-script.service.ts` (new), `protest-worksheet.service.ts`, `protest.routes.ts`, `frontend/src/pages/TaxProtestPage.tsx`, `docs/API_REFERENCE.md`, `docs/USER_GUIDE.md`, `openapi/openapi.yaml`

---

## PT-12 — RAG document store + conversation summarization (2026-06-02)

- New `protest_document_chunks` table with pgvector 1536-dim embeddings (migration 0064)
- CAD evidence PDF and arbitrary uploaded files (PDF + image) chunked + embedded at upload time
- Chat route retrieves top-5 similar chunks per query and injects into system prompt
- Rolling summarization: conversation history > 30 turns triggers async gpt-4o-mini compression
- Cycle summary generated on protest close; injected as prior-year context next cycle
- New endpoints: POST/GET/DELETE `/api/protest/:propertyId/documents`, updated POST `/api/protest/:propertyId/chat`
- `docker-compose.yml` switched to `pgvector/pgvector:pg18`
- **GitHub:** closes #62

**Files:** `backend/db/migrations/0064_pt12_document_chunks.sql`, `embedding.service.ts`, `chunking.service.ts`, `document-store.service.ts`, `protest-worksheet.service.ts`, `protest.routes.ts`, `export-registry.ts`, `frontend/src/pages/TaxProtestPage.tsx`, `docs/API_REFERENCE.md`, `openapi/openapi.yaml`

---

## PT-9 (2026-06-02): CAD evidence PDF upload + parse + comp annotations — closes #59

**What changed:**
- New upload endpoint `POST /api/protest/:id/cad-evidence` (multer memoryStorage, 20 MB limit). Parses the official DCAD evidence packet PDF using `extractPdfText` + regex section detection. Extracts both comp tables (sales + equity), medians, and subject property details from the public card page.
- New `DELETE /api/protest/:id/cad-evidence` to clear stored evidence.
- Migration 0063: `cad_evidence_json JSONB`, `cad_evidence_filename TEXT`, `sold_comps_notes_json JSONB` added to `protest_worksheet`; `notes TEXT` added to `protest_comp_cad`.
- New `PATCH /api/protest/:id/sold-comps/notes` — saves a free-text annotation on any Redfin sold comp (keyed by address in `sold_comps_notes_json` via `jsonb_set`).
- New `PATCH /api/protest/:id/comps/:cadPropertyId/notes` — saves a free-text annotation on any equity comp (`protest_comp_cad.notes`).
- `GET /api/protest/:id/worksheet` now returns `cadEvidenceJson`, `cadEvidenceFilename`, `soldCompsNotesJson`.
- `GET /api/protest/:id/comps` now returns `notes` on each comp row.
- `buildSystemPrompt` updated: injects parsed CAD evidence (both comp tables, medians, §41.43 delta) and all comp annotations into the AI system prompt context.
- New parser service `cad-evidence-parser.service.ts`: section-detection + regex extraction for DCAD evidence packet format.
- **UI — CAD Evidence card**: Upload button, §41.43 signal badge (green if CAD equity median < assessed value), DCAD Sales comps table (§41.41), DCAD Equity comps table (§41.43).
- **UI — Comp annotations**: Notebook icon on every row in Market Value + Unequal Appraisal tables. Clicking opens a Popover Textarea; saves on blur with optimistic UI update.

**Files:** `backend/db/migrations/0063_pt9_cad_evidence.sql`, `backend/src/modules/protest/cad-evidence-parser.service.ts` (new), `protest-worksheet.service.ts`, `protest.routes.ts`, `frontend/src/pages/TaxProtestPage.tsx`, `docs/API_REFERENCE.md`, `openapi/openapi.yaml`

---

## PT-11 (2026-06-01): Auto-fetch CAD assessed values for Redfin sold comps (§41.43 support)

- **Type:** Feature — closes #61
- **What changed:**
  - `POST /api/protest/:propertyId/refresh-comps` now auto-fetches CAD-assessed values for Redfin sold comp addresses (TX properties only) using the registered CAD adapter. Lookups are sequential with a 200 ms delay; up to 6 new addresses per refresh.
  - CAD assessed values are cached in a new `sold_comps_cad_json JSONB` column on `protest_worksheet` (migration 0062). Already-cached addresses are skipped on subsequent refreshes.
  - `GET /api/protest/:propertyId/sold-comps` now returns `cadAssessedValueUsd` on each comp, sourced from the cache.
  - `SoldComp` type gains `cadAssessedValueUsd: number | null` in both backend (`protest-evidence.service.ts`) and frontend.
  - Market Value Evidence table gains two new columns for TX properties: **CAD Assessed** and **§41.43 Ratio** (CAD ÷ Sold Price). Comps with a lower ratio than the subject are highlighted green.
  - Subject row shows its own CAD assessed value and ratio in the new columns.
  - Evidence PDF (`drawSoldCompsTable`) gains CAD Assessed and §41.43 Ratio columns when any comp has data.
  - Toast updated: shows "N §41.43 values" when new CAD values are fetched.
  - `POST /refresh-comps` response now includes `soldCompsCadFetched: number`.
- **Migration:** `0062_pt11_sold_comps_cad.sql` — adds `sold_comps_cad_json JSONB DEFAULT '{}'::jsonb` to `protest_worksheet`.
- **New service function:** `saveSoldCompsCadCache(propertyId, householdId, taxYear, cache)` in `protest-worksheet.service.ts`.
- **Files changed:** `backend/db/migrations/0062_pt11_sold_comps_cad.sql`, `backend/src/modules/protest/protest-worksheet.service.ts`, `backend/src/modules/protest/protest-evidence.service.ts`, `backend/src/modules/protest/protest.routes.ts`, `frontend/src/pages/TaxProtestPage.tsx`, `docs/API_REFERENCE.md`, `openapi/openapi.yaml`
- **GitHub:** https://github.com/mangatrai/grove/issues/61

---

## PT-13 (2026-06-01): On-demand comps refresh button

- **Type:** Feature — closes #63
- **What changed:**
  - "Refresh" button added to both the Market Value Evidence card header and the Unequal Appraisal Evidence card header on TaxProtestPage.
  - Single click refreshes both Redfin sold comps (via RealtyAPI) and CAD comps (via the registered adapter) in one round-trip. UI state (`comps`, `soldComps`) updates immediately from the response — no page reload needed.
  - Stale comps alert text updated to reference the Refresh button rather than asking the AI.
  - Empty sold-comps state replaced "Ask AI" button with a direct "Refresh Comps" button.
  - 24-hour Redfin cooldown respected: `RATE_LIMITED` surfaces as a yellow toast, not an error.
- **New backend route:** `POST /api/protest/:propertyId/refresh-comps` — calls adapter `searchByAddress` + `saveCADComps` + `refreshPropertyValuation`; returns `{ cad, redfin, comps, soldComps }`.
- **Files changed:** `backend/src/modules/protest/protest.routes.ts`, `frontend/src/pages/TaxProtestPage.tsx`, `docs/API_REFERENCE.md`, `openapi/openapi.yaml`
- **GitHub:** https://github.com/mangatrai/grove/issues/63

---

## PT-15 (2026-06-01): Fix Add Comp modal — address-only CAD search with real IDs

- **Type:** Feature — closes #65
- **What changed:**
  - Add Comp modal is now a 3-step flow: **search → results → (manual fallback)**
  - Step 1: user types an address and clicks "Search CAD". Backend calls the registered CAD adapter (`searchByAddress`) and returns stripped `CadSearchResult[]` plus `hasAdapter` flag.
  - Step 2 (CAD results): shows selectable result cards (address, sqft/bd/ba/year, assessed/market values). "Add Selected" submits with the real `cadPropertyId` from the adapter — no more `manual-<uuid>` for CAD-sourced comps.
  - Auto-advance to manual step when `hasAdapter: false` (county not supported) with an explanatory alert.
  - Step 3 (manual): all original fields preserved; "Back" returns to search.
- **New backend route:** `GET /api/protest/:propertyId/cad-search?address=&year=` — adapter lookup, `raw` field stripped before response.
- **Backend service:** `addCADComp` now accepts optional `existingCadPropertyId`; if supplied, uses it directly and sets `raw_json: {}` instead of `{ manual: true }`.
- **Files changed:**
  - `backend/src/modules/protest/protest.routes.ts` — new route + `cadPropertyId` in `addCompBodySchema`
  - `backend/src/modules/protest/protest-worksheet.service.ts` — `addCADComp` signature
  - `frontend/src/pages/TaxProtestPage.tsx` — new state, `searchCad`/`resetAddCompModal` callbacks, modal JSX
- **GitHub:** closes #65

---

## PT-14 (2026-06-01): CAD adapter pattern — generic county support

- **Type:** Architecture refactor — closes #64
- **Migration:** `0061_pt14_cad_adapter_columns.sql`
  - `property.dcad_property_id` → `property.cad_property_id`
  - `property.dcad_p_account_id` → `property.cad_account_id`
  - `property.cad_provider TEXT` (new) — stores adapter key e.g. `"dcad"`
  - `protest_comp_cad.dcad_property_id` → `protest_comp_cad.cad_property_id`
  - Unique index renamed `uq_protest_comp_property_year_cadid`
- **New files:** `backend/src/modules/protest/cad-adapters/`
  - `cad-adapter.types.ts` — `CadProperty`, `CadValueHistoryEntry`, `CadAppealEntry`, `CadAdapter` interface
  - `dcad.adapter.ts` — `DcadAdapter` implements `CadAdapter`; wraps existing `dcad.service.ts` API calls
  - `registry.ts` — `getCadAdapter(provider)`, `inferCadProvider(state)` (TX → `"dcad"`)
- **Updated services/routes:**
  - `protest-worksheet.service.ts` — `triggerDCADBackfill` → `triggerCadBackfill` (uses registry, supports any state); `saveDCADSubjectIds` → `saveCadSubjectIds` (sets `cad_provider` column); `saveCADComps`/`deleteCADComp`/`addCADComp`/`listWorksheetComps` use `cad_property_id` column; `ProtestComp.dcadPropertyId` → `cadPropertyId`
  - `protest.routes.ts` — all DCAD data routes (`/dcad/value-history`, `/dcad/taxable`, `/dcad/appeal`) now use registry + adapter; `fetch_dcad_comps` AI tool uses adapter; no direct `dcad.service.ts` imports remain in routes
  - `household.routes.ts` — `triggerDCADBackfill` → `triggerCadBackfill`; state guard removed (adapter handles unsupported states gracefully)
  - `property.service.ts` — `PropertyRecord.dcadPropertyId`/`dcadPAccountId` → `cadPropertyId`/`cadAccountId`/`cadProvider`
  - `frontend/src/pages/PropertyDetailPage.tsx` + `TaxProtestPage.tsx` — field renames to match
- **Adding Shelby County TN:** create `shelby.adapter.ts` implementing `CadAdapter`, register as `{ "shelby-tn": new ShelbyAdapter() }` in `registry.ts`, add `inferCadProvider("TN")` → `"shelby-tn"`.

---

## PT-10 (2026-06-01): Comp management UI — Add/Remove on evidence tables

- **Type:** Feature — closes #60
- **Backend:**
  - Migration `0060_pt10_excluded_sold_comps.sql` — adds `excluded_sold_comps_json TEXT DEFAULT '[]'` to `protest_worksheet`.
  - `protest-worksheet.service.ts` — added `deleteCADComp`, `addCADComp`, `setExcludedSoldComps`, `getExcludedSoldComps` (plus `ManualComp` type).
  - `protest.routes.ts`:
    - `DELETE /api/protest/:propertyId/comps/:dcadPropertyId?year=` — hard-deletes a CAD comp from `protest_comp_cad`.
    - `POST /api/protest/:propertyId/comps` — manually adds a CAD comp (body: `year`, `addressLine1`, optional `city/sqft/beds/baths/yearBuilt/assessedValueUsd/marketValueUsd`). Returns updated `comps` array.
    - `PATCH /api/protest/:propertyId/sold-comps/exclusions` — saves an exclusion list of Redfin sold-comp addresses per worksheet year.
    - `GET /api/protest/:propertyId/sold-comps` — now accepts `?year=` and returns `excluded: string[]` alongside `comps`.
    - Evidence packet (`GET /api/protest/:propertyId/evidence-packet`) — now filters sold comps by `excluded_sold_comps_json` so the PDF/DOCX respects removals.
- **Frontend:** `TaxProtestPage.tsx`
  - Market Value Evidence table — trash icon per row (optimistically updates `excludedSoldComps`, PATCHes exclusions). Header count shows `(N hidden)` when comps are removed.
  - Unequal Appraisal Evidence table — trash icon per row (DELETEs comp), "Add Comp" button opens a modal form (address, city, sqft, beds, baths, year built, assessed value). Backend returns updated comp list on success.
- **Files:** `backend/db/migrations/0060_pt10_excluded_sold_comps.sql`, `backend/src/modules/protest/protest-worksheet.service.ts`, `backend/src/modules/protest/protest.routes.ts`, `frontend/src/pages/TaxProtestPage.tsx`, `openapi/openapi.yaml`, `docs/API_REFERENCE.md`
- **GitHub:** closes #60

---

## FIX-RE-8 (2026-06-01): Equity chart empty with single snapshot; Assessment History missing DCAD years

- **Type:** Bug fix + feature integration — refs #45
- **Issues fixed:**
  1. **Equity chart**: Frontend required `equityHistory.length >= 2` before showing chart. First-time property always has exactly 1 snapshot. Changed threshold to `>= 1`. Added `dot={{ r: 4 }}` to lines so single-point data is visible. Updated empty state message.
  2. **Assessment History**: Chart only consumed `valuationDetail.taxHistory` (Redfin public records). 2023/2024 data missing because Redfin didn't have it. Now fetches `GET /api/protest/:propertyId/dcad/value-history` after property loads (if `dcadPAccountId` is set). **DCAD is the authority for tax assessed values** — for every year DCAD has data, it overrides Redfin's assessedValue. DCAD also adds years Redfin didn't return. Slice extended from 5 to 7 years.
- **Frontend:** `PropertyDetailPage.tsx` — added `dcadPAccountId` to type, `dcadValueHistory` state, `loadDcadValueHistory` callback, secondary useEffect, DCAD merge in `chartData` useMemo.
- **Files:** `frontend/src/pages/PropertyDetailPage.tsx`

---

## PT-8 (2026-06-01): DCAD account APIs — value history, taxable breakdown, appeal status

- **Type:** Feature — closes #56
- **What:** Three new protest routes backed by TrueProdigy account-specific endpoints:
  - `GET /api/protest/:propertyId/dcad/value-history` → year-by-year CAD tax assessed value history
  - `GET /api/protest/:propertyId/dcad/taxable` → current taxable value breakdown after exemptions
  - `GET /api/protest/:propertyId/dcad/appeal` → live protest/appeal status from DCAD
- **How subject is identified:** `triggerDCADBackfill` (and the `fetch_dcad_comps` AI tool call) now extract `dcadPropertyId` and `dcadPAccountId` from DCAD search results and store them on the `property` row. Subject is matched by house number prefix in the search address; falls back to the first result.
- **Migration:** `0059_pt8_dcad_property_ids.sql` — adds `dcad_property_id TEXT` and `dcad_p_account_id BIGINT` to `property` table.
- **Files:** `backend/db/migrations/0059_pt8_dcad_property_ids.sql`, `backend/src/modules/household/property.service.ts`, `backend/src/modules/protest/protest-worksheet.service.ts`, `backend/src/modules/protest/protest.routes.ts`, `backend/src/modules/protest/dcad.service.ts` (unchanged — functions already written), `openapi/openapi.yaml`
- **GitHub:** https://github.com/mangatrai/grove/issues/56

---

## FIX-RE-6 (2026-06-01): Add diagnostic logging for empty Redfin comps on protest page

- **Type:** Observability improvement — refs #45
- **What:** `GET /:propertyId/sold-comps` returns an empty array when `property.valuation_detail_json.comps` is empty, but nothing surfaced why. Root cause unknown (API may omit `avmRoot.comparables` in `/detailsbyid` responses; or `parseComps` structure may no longer match).
- **Fix:** Added two warn-level logs in `parseRedfinResponse()` (`realty-api.service.ts`):
  1. Logs `avmRoot` keys when `comparables` is missing or empty — distinguishes "API didn't return it" from "it's there but parse fails".
  2. Logs first-entry keys when `parseComps` discards all entries from a non-empty array — surfaces structure mismatch.
  Also added `compsCount` to `refreshPropertyValuation: done` log in `property.service.ts`.
- **FIX-RE-7 note:** 24h cooldown on `refreshPropertyValuation()` was already implemented at `property.service.ts:366-371`. Issue #46 closed as already-fixed.
- **Files:** `backend/src/modules/household/realty-api.service.ts`, `backend/src/modules/household/property.service.ts`
- **GitHub:** https://github.com/mangatrai/grove/issues/45

---

## FIX-ESPP-12 (2026-05-31): ESPP salary/other deduction not summed across dual payslips — test gap + stale data fix

- **Type:** Test coverage gap + data-repair endpoint — closes #55
- **What:** FIX-ESPP-11 (`c4cd463`) removed `GROUP BY ps.id LIMIT 1` from `findPayslipLink`, which correctly aggregates `espp_discount_payslip`, `espp_salary_deduction`, and `espp_other_deduction` across all payslips on the purchase date. However:
  1. The ESPP-11 test only asserted `esppDiscountPayslip` — salary/other were never verified and could silently regress.
  2. Batches imported before FIX-ESPP-11 still had single-payslip values in the DB. No repair path existed without full PDF re-import.
- **Fix:**
  - Extended ESPP-11 test: seeds "ESPP (Stock Salary)" ($500 + $400) and "ESPP (Stock Other)" ($10 + $5) on both payslips; asserts totals $900 and $15 respectively alongside the $120 discount.
  - Added `recalculatePayslipLinks(householdId)` service function that re-runs `findPayslipLink` for every batch and updates `payslip_id`, `espp_discount_payslip`, `espp_salary_deduction`, `espp_other_deduction`.
  - Exposed as `POST /espp/recalculate-payslip-links` (auth-gated, returns `{ ok: true, updated: N }`). Call once to repair existing batch rows without re-importing PDFs.
- **Files:** `backend/tests/espp.test.ts` (test extension retained); recalculate endpoint reverted — use the one-time SQL below instead.
- **One-time data repair SQL** (run in psql, single date first to verify, then full):
  ```sql
  -- Single date (verify first):
  BEGIN;
  UPDATE espp_batch b SET ... WHERE b.purchase_date = '2026-MM-DD';
  SELECT purchase_date, espp_salary_deduction, espp_other_deduction FROM espp_batch;
  ROLLBACK; -- or COMMIT once satisfied
  ```
  See CHANGE_HISTORY for full SQL.
- **GitHub:** https://github.com/mangatrai/grove/issues/55

---

## FIX-ESPP-2c (2026-05-31): `/espp/stock-quote` missing from Vite dev proxy — chip never loads in dev

- **Type:** Bug fix — closes #54
- **What:** `frontend/vite.config.ts` listed specific ESPP sub-routes in the Vite proxy (`/espp/batches`, `/espp/summary`, etc.) but omitted `/espp/stock-quote`. In dev mode, Vite forwards proxied paths to the Express backend (port 4000). Without the entry, the browser resolved `/espp/stock-quote` to the Vite dev server (port 3000), got no response, and `stockQuote` state stayed null — the IBM price chip never appeared.
- **Fix:** Added `"/espp/stock-quote": api` to the proxy list.
- **Files:** `frontend/vite.config.ts`, `docs/CHANGE_HISTORY.md`
- **GitHub:** https://github.com/mangatrai/grove/issues/54

---

## FIX-ESPP-2b (2026-05-31): Stock quote scheduler mode + API path prefix bugs

- **Type:** Bug fixes — closes #52, closes #53
- **What:**
  - `startStockQuoteScheduler()` was inside the `MODE !== TEST` guard in `server.ts`. Since `MODE` defaults to `"TEST"`, the scheduler never started in dev and the IBM price chip showed nothing. Yahoo Finance is free and keyless — no reason to gate it. Moved above the guard so it runs in all modes. (GH #53)
  - `/espp` was missing from `API_PATH_PREFIXES` in `app.ts`. In PROD, the SPA middleware intercepts any unregistered path and serves `index.html`. All ESPP endpoints returned the SPA shell instead of JSON in production. (GH #52)
  - Removed 1-hour TTL from `getStockQuote()`. Cache is now served as-is until the scheduler updates it — on-demand Yahoo Finance calls at arbitrary hours made no sense. First request after server start fetches once if cache is empty.
- **Files:** `backend/src/server.ts`, `backend/src/app.ts`, `backend/src/modules/espp/espp-stock.service.ts`, `docs/USER_GUIDE.md`, `docs/ADMIN_GUIDE.md`

---

## CR-ESPP-2 (2026-05-31): IBM last close price chip on ESPP screen

- **Type:** Feature — closes #36
- **What:** Adds a compact IBM stock quote chip to the ESPP page header row ("IBM · $XXX.XX · close YYYY-MM-DD").
  - **New service** (`espp-stock.service.ts`): Fetches IBM quote via `yahoo-finance2` v3 (`new YahooFinance()`). 1-hour in-memory TTL. Scheduled refresh at ~4:15 PM ET weekdays (checked on 5-min interval; both EDT=20:15 UTC and EST=21:15 UTC windows covered). Initial fetch on server startup.
  - **New route** (`GET /espp/stock-quote`): Returns `{ symbol, price, previousClose, asOf }`. 503 if no quote cached yet.
  - **Frontend** (`EsppPage.tsx`): `Badge` chip added to page header Group, next to the ESPP title. Fetched once on mount; silently absent if endpoint returns an error or is still loading.
  - **Scheduler wired** in `server.ts` via `startStockQuoteScheduler()`.
  - **Dep:** `yahoo-finance2@^3.15.2` added to `backend/package.json`.
  - **Bug fix (incidental):** `searchDCADByAddress` call in `protest-worksheet.service.ts` was missing the required `county` arg — fixed (passes `null`).
- **Files:** `backend/src/modules/espp/espp-stock.service.ts` (new), `backend/src/modules/espp/espp.routes.ts`, `backend/src/server.ts`, `backend/src/modules/protest/protest-worksheet.service.ts`, `frontend/src/pages/EsppPage.tsx`, `backend/package.json`

---

## CR-PT-7 (2026-05-31): Protest status — branching flow + outcome tracking

- **Type:** Feature — closes #51
- **What:** Replaces the flat `Select` dropdown for protest status with a branching, context-sensitive action panel. The horizontal stepper remains as a progress indicator.
  - **New DB columns** (`0058_pt7_protest_outcome.sql`): `outcome TEXT CHECK (outcome IN ('settled_informal','won_arb','lost_arb','withdrawn'))` and `informal_offer_usd INTEGER` on `protest_worksheet`.
  - **Backend service** (`protest-worksheet.service.ts`): Added `ProtestOutcome` type. `updateWorksheetStatus()` refactored to accept `opts: { hearingDate?, outcome?, informalOfferUsd? }` instead of positional `hearingDate` arg. `getWorksheet()` SELECT and `rowToRecord()` updated to include both new fields.
  - **Backend route** (`protest.routes.ts`): `patchWorksheetBodySchema` extended with `outcome` (enum nullable) and `informalOfferUsd` (int nullable). PATCH handler passes both to `updateWorksheetStatus()`.
  - **Frontend** (`TaxProtestPage.tsx`): Status flow shows contextual action buttons per stage — `not_filed` → "Mark as Filed"; `filed` → offer amount input + "Informal Offer Received"; `informal` → "Accept Offer — Settle" (green, sets `resolved/settled_informal`) or "Reject — Escalate to ARB" (orange, sets `arb`); `arb` → "Won at ARB" / "Lost at ARB" / "Withdrew Protest"; `resolved` → outcome badge + optional settlement value + "Reset protest status" button. `statusIndex()` positions stepper at step 3 (not 4) when settled at informal. Removed dead `statusDraft` state.
- **Deferred:** PT-5b (Web Push, GH #49) and PT-6 (non-TX CAD, GH #50) moved to Deferred in backlog.
- **Files:** `backend/db/migrations/0058_pt7_protest_outcome.sql` (new), `backend/src/modules/protest/protest-worksheet.service.ts`, `backend/src/modules/protest/protest.routes.ts`, `frontend/src/pages/TaxProtestPage.tsx`, `docs/BACKLOG.md`
- **GitHub:** https://github.com/mangatrai/grove/issues/51

## FIX-RE-7 + FIX-RE-6 (2026-05-31): Redfin cooldown guard + stale comps banner

- **Type:** Bug fix — closes #46, closes #45
- **What:**
  - **FIX-RE-7:** `refreshPropertyValuation()` now checks `valuation_fetched_at` before calling Redfin. If the valuation is less than 24 hours old, returns `{ ok: false, code: "RATE_LIMITED", message: "..." }` immediately — no external API call. Prevents the protest AI's `refresh_redfin_comps` tool from hammering RealtyAPI on every chat turn.
  - **FIX-RE-6:** `protest.routes.ts` handles the new `RATE_LIMITED` code in the tool handler (tells the LLM comps are still fresh) and includes `valuationAgeHours: number | null` in the chat response. `TaxProtestPage.tsx` shows a dismissible yellow `Alert` banner when `property.valuationFetchedAt` is >24 h old, prompting the user to ask the AI to refresh. Banner auto-dismisses when `soldCompsRefreshed` is true and resets on property switch.
- **Files:** `backend/src/modules/household/property.service.ts`, `backend/src/modules/protest/protest.routes.ts`, `frontend/src/pages/TaxProtestPage.tsx`
- **GitHub:** https://github.com/mangatrai/grove/issues/46, https://github.com/mangatrai/grove/issues/45

## FIX-PT-6 (2026-05-30): DCAD comparable search — county-derived office, street-name fallback, debug logging

- **Type:** Bug fix — closes #47
- **What:**
  - `getToken(office)` now accepts the office name as a parameter. `searchDCADByAddress()` and `getDCADPropertyById()` accept `county: string | null | undefined` and derive the TrueProdigy office via `countyToOffice()` — strips " County" suffix so "Denton County" → "Denton". Token cache is keyed by office name so multi-county households work correctly.
  - Call site in `protest.routes.ts` passes `property.valuationDetail?.county` — the county Redfin already stored in the DB — eliminating any hardcoded or config-based assumption about which CAD to query.
  - `searchDCADByAddress()` refactored around private `doSearch()`. If the full address returns 0 results, automatically retries with street-name-only (house number stripped, city/state/zip stripped at first comma).
  - When `doSearch()` extracts 0 rows, logs `responseSnippet` (first 500 chars of raw API body) at `debug` level.
- **Files:** `backend/src/modules/protest/dcad.service.ts`, `backend/src/modules/protest/protest.routes.ts`
- **GitHub:** https://github.com/mangatrai/grove/issues/47

## UX-PT-7 (2026-05-29): TaxProtestPage — chat drawer Mantine theming + dark/light mode fix

- **Type:** UX / bug fix — closes #48
- **What:**
  - User message bubbles were `bg="dark.8" c="white"` — invisible in dark mode. Changed to `bg="forest.6" c="white"` (app primary color, renders correctly in both modes).
  - Assistant and "thinking" bubble `bg="gray.1"` → `gray.1` in light / `dark.5` in dark using `useComputedColorScheme`.
  - Table subject-row highlight on both evidence tables: replaced `style={{ background: "var(--mantine-color-blue-light)" }}` (not dark-mode aware) with `bg={colorScheme === "dark" ? "blue.9" : "blue.0"}` prop.
  - Replaced manual `<Box style={{ overflowY: "auto" }}>` scroll container with Mantine `<ScrollArea>`.
  - Added `disabled={sending}` to `Textarea` and the attach `ActionIcon` so the input is visually locked while a request is in flight.
  - Fixed keyboard shortcut hint from hardcoded `⌘↵` to platform-aware `Ctrl/⌘+↵` using `navigator.platform`.
  - Cleaned up `Drawer` body styles: `flex: 1; overflow: hidden` instead of fragile `height: calc(100% - 60px)`.
- **Files:** `frontend/src/pages/TaxProtestPage.tsx`
- **GitHub:** closes #48

---

## DOC-PT-5-1 (2026-05-29): User Guide and Admin Guide updates for PT-4b and PT-5

- **Type:** Documentation
- **What:** Updated `docs/USER_GUIDE.md` and `docs/ADMIN_GUIDE.md` to cover PT-4b (DOCX format option) and PT-5 (filing deadline, CAD portal URL, deadline notifications) which shipped in earlier commits this session.
- **USER_GUIDE changes:** Expanded "Generating the ARB Evidence Packet" section — now covers both PDF and Word formats with two-section DOCX structure described. Added new "Filing Deadline and CAD Portal" section documenting the DateInput, CAD portal URL field, external-link icon, red alert banner, and notification cadence (30/7/1 days before deadline and hearing).
- **ADMIN_GUIDE changes:** Updated §4.5 to reference both `pdfkit` and `docx` npm packages; added note on deadline notification types, email SMTP requirement, fire-and-forget trigger pattern, and 2-day dedup window.
- **Files:** `docs/USER_GUIDE.md`, `docs/ADMIN_GUIDE.md`, `docs/CHANGE_HISTORY.md`

---

## CR-PT-5 (2026-05-29): Tax Protest — filing deadline tracking and notifications

- **Type:** Feature
- **What:** Adds `filing_deadline` (DATE) and `cad_portal_url` (TEXT) columns to `protest_worksheet`. Users can record the CAD filing deadline and a link to the CAD portal (e.g. DCAD online protest URL) directly on the protest page.
- **Notifications:** Two new notification types — `protest_filing_deadline_approaching` and `protest_hearing_approaching`. Both default to in-app + email delivery. `checkProtestDeadlines()` fires on every worksheet load (fire-and-forget); it checks all non-resolved worksheets in the household and emits notifications at 30/7/1 days before `filing_deadline` or `hearing_date`. Deduped — skips if a matching notification was created within the last 2 days.
- **Frontend:** Filing Deadline DateInput and CAD Portal URL TextInput added to the Protest Status card. CAD Portal URL shows an open-in-new-tab ActionIcon. Red Alert shown if filing deadline is within 7 days and status is not resolved.
- **Migration:** `0057_pt5_protest_deadlines.sql` — `ALTER TABLE protest_worksheet ADD COLUMN IF NOT EXISTS filing_deadline DATE, ADD COLUMN IF NOT EXISTS cad_portal_url TEXT`
- **Files:** `backend/db/migrations/0057_pt5_protest_deadlines.sql` · `backend/src/modules/notifications/notification.service.ts` · `backend/src/modules/protest/protest-worksheet.service.ts` · `backend/src/modules/protest/protest.routes.ts` · `frontend/src/pages/TaxProtestPage.tsx`

---

## CR-PT-4b (2026-05-29): Tax Protest — DOCX evidence packet format

- **Type:** Feature
- **What:** The existing `GET /api/protest/:propertyId/evidence-packet` endpoint now accepts `?format=pdf|docx` (default `pdf`). `format=docx` generates a Word document using the `docx` npm package (v9). No new route.
- **DOCX structure:** Two sections in one file — (1) **ARB Board Packet**: valuation summary table, property facts table, DCAD comps table, recent sales table, key arguments; (2) **Protestor Reference Sheet** (after a page break): numbered oral script, blank negotiation table, quick-reference card.
- **Frontend:** A `SegmentedControl` (PDF / Word) added next to the "Generate Document" button in `TaxProtestPage.tsx`. Download filename matches selected format.
- **Test:** New assertion in `backend/tests/protest.test.ts` verifying `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` and `.docx` filename for `format=docx`.
- **Files:** `backend/src/modules/protest/protest-evidence-docx.service.ts` (new) · `backend/src/modules/protest/protest.routes.ts` · `frontend/src/pages/TaxProtestPage.tsx` · `backend/tests/protest.test.ts` · `backend/package.json`

---

## FIX-PWA-1 (2026-05-29): PWA stale after new release — cache-control fix

- **Type:** Bug fix
- **What:** Installed PWA (iOS / macOS) showed stale content or broke after every new deployment because `index.html` was served with no `Cache-Control` header — browsers and iOS cached it indefinitely. On a new deploy, Vite's hashed JS/CSS filenames change, but the cached shell still referenced the old names, causing load failures.
- **Fix (Option A from GH #43):** Two changes in `backend/src/app.ts`:
  1. `index.html` catch-all now sets `Cache-Control: no-cache` before `res.sendFile()` — forces the browser to revalidate the HTML shell on every load without blocking (ETag/304 still works).
  2. `express.static()` now sets `Cache-Control: public, max-age=31536000, immutable` for files under `assets/` (Vite's content-hashed output directory) so JS/CSS chunks are cached aggressively and do not cause unnecessary network round-trips.
- **Non-hashed assets** (manifest.json, icons, favicon) continue with browser-default caching.
- **Not included:** service worker / offline support (Option B from issue). Can be added later with `vite-plugin-pwa` if needed.
- **Files:** `backend/src/app.ts`
- **GitHub:** closes #43

## FIX-ESPP-11 (2026-05-29): ESPP dual-payslip discount sum

- **Type:** Bug fix
- **What:** `findPayslipLink()` in `espp.service.ts` used `GROUP BY ps.id LIMIT 1`, picking only the first payslip found on the purchase date. When month-end has two payslips (salary + commissions) each carrying an ESPP deduction line, the second payslip's deduction was silently discarded, causing an understated `espp_discount_payslip` on the batch.
- **Fix:** Removed `GROUP BY ps.id LIMIT 1`; query now aggregates all ESPP line items across all payslips for the given date via a single `MIN(ps.id) AS id` + bare `SUM(...)`. The `id` column used as `payslip_id` FK now records the earliest matching payslip (acceptable — exact FK linkage is cosmetic when multiple payslips share the date).
- **Test:** Added ESPP-11 case to `backend/tests/espp.test.ts` — seeds two payslips on the same pay_date with $80 and $40 ESPP Discount line items, imports a batch, asserts `espp_discount_payslip` = $120. 513 tests passing.
- **Files:** `backend/src/modules/espp/espp.service.ts`, `backend/tests/espp.test.ts`
- **GitHub:** closes #42

## DOC-PT4-1 (2026-05-29): PT-4 docs, tests, and PT-4b backlog

- **Type:** Documentation + Test
- **What:**
  - Added **Tax Protest** section to `docs/USER_GUIDE.md` — covers property/year selection, chat assistant capabilities, strategy panel, DCAD/Redfin comps tabs, PDF export contents, and protest status reference table.
  - Added §4.5 Tax Protest AI to `docs/ADMIN_GUIDE.md` — documents `OPENAI_API_KEY`, `OPENAI_MODEL`, `TAVILY_API_KEY` env vars and `pdfkit` PDF generation (no system font dependency).
  - Added `backend/tests/protest.test.ts` — 4 integration tests for `GET /api/protest/:propertyId/evidence-packet`: 200+`application/pdf` for seeded property, 200 with year omitted (defaults to current year), 404 for unknown property, 401 without token. All 512 tests passing.
  - Added **PT-4b** backlog entry (`docs/BACKLOG.md`) — Word (.docx) format for ARB evidence packet using `docx` npm library. Full spec captured (5-page ARB Board section + Protestor section with oral script + negotiation table). GH #41.
- **Files:** `docs/USER_GUIDE.md`, `docs/ADMIN_GUIDE.md`, `docs/BACKLOG.md`, `backend/tests/protest.test.ts`
- **GitHub:** #41 opened for PT-4b

## CR-PT4-1 (2026-05-29): ARB Evidence Packet PDF export

- **Type:** Feature — Generate Document button, pdfkit PDF
- **What:**
  - New `GET /api/protest/:propertyId/evidence-packet?year=N` endpoint streams a multi-page PDF ARB hearing packet.
  - PDF pages: (1) cover with valuation summary boxes + property facts + strategy panel, (2) DCAD comps table with vs-subject colour coding + subject row highlighted yellow, (3) Redfin sold comps table, (4) horizontal bar chart comparing AVM vs DCAD comp market values.
  - New `protest-evidence.service.ts` encapsulates all pdfkit drawing logic; no new DB table or migration.
  - Added `pdfkit` + `@types/pdfkit` to backend dependencies.
  - Frontend: enabled "Generate Document" button on `TaxProtestPage` — triggers fetch → blob → anchor download; shows `loading` spinner while generating.
- **Files:** `backend/src/modules/protest/protest-evidence.service.ts` (new), `backend/src/modules/protest/protest.routes.ts`, `backend/package.json`, `frontend/src/pages/TaxProtestPage.tsx`, `docs/CHANGE_HISTORY.md`, `docs/API_REFERENCE.md`
- **GitHub:** closes #40

## CR-PT3-1 (2026-05-29): Protest AI — Tavily web search tool (`search_web`)

- **Type:** Feature — AI autonomous web search for comparable sales and market data
- **What:**
  - Added `search_web` AI tool to the protest chat handler. The AI can now call Tavily's search API to find recent comparable sales, market trends, ARB outcomes, and county assessor data for any query.
  - Added `TAVILY_API_KEY` optional env var to `backend/src/config/env.ts`. Tool gracefully disabled when key is absent.
  - No new DB table, no migration, no frontend change.
- **Files:** `backend/src/config/env.ts`, `backend/src/modules/protest/protest.routes.ts`, `docs/CHANGE_HISTORY.md`, `docs/API_REFERENCE.md`
- **GitHub:** https://github.com/mangatrai/grove/issues/39

---

## UX-PT2-1 (2026-05-29): TaxProtestPage — Redfin comparable sold prices in Market Value Evidence table

- **Type:** Feature — market value evidence from real sold comps
- **What:**
  - **Market Value Evidence table** now shows actual Redfin comparable sold prices (`soldPrice`, `pricePerSqft`, `soldDate`) instead of DCAD estimated market values. Data is read from `property.valuation_detail.comps` (already stored as part of the Redfin property fetch — no new DB table or migration).
  - **TX non-disclosure note:** When `soldPrice` is null (common in TX), shows `listPrice` in dimmed text as a fallback and displays a note explaining the limitation.
  - **New endpoint `GET /api/protest/:propertyId/sold-comps`:** Returns shaped Redfin comp data (address, sqft, beds, baths, soldPrice, soldDate, pricePerSqft, listPrice). No `year` param — comps are property-level not year-specific.
  - **New AI tool `refresh_redfin_comps`** in protest chat handler: calls `refreshPropertyValuation()` to re-fetch Redfin data. Returns `soldCompsRefreshed: true` in chat response; frontend re-fetches and updates Market Value table.
  - **Files:** `backend/src/modules/protest/protest.routes.ts`, `frontend/src/pages/TaxProtestPage.tsx`

---

## FIX-PT1-1 (2026-05-29): TaxProtestPage — FAB overlap + OPENAI_MODEL env wire-up

- **Type:** UI bug fix + config fix
- **What:**
  - **FAB overlap:** Chat FAB (floating ActionIcon) was visible behind/over the open Drawer. Fixed by conditionally rendering FAB only when `!chatOpen`. (`frontend/src/pages/TaxProtestPage.tsx`)
  - **OPENAI_MODEL env:** Protest chat route hardcoded `model: "gpt-4.1"`. Switched to `model: env.OPENAI_MODEL` so the `OPENAI_MODEL` env var (already defined in `env.ts` with default `"gpt-4o-mini"`) controls the model. (`backend/src/modules/protest/protest.routes.ts`)

---

## UX-PT1-1 (2026-05-29): TaxProtestPage — prototype-faithful redesign with floating chat FAB

- **Type:** UX redesign + backend endpoint addition
- **What:**
  - **Page layout:** Complete rewrite from chat-centric skeleton to prototype-faithful single-column layout (View A — Evidence File). Page now shows: signal card (CAD / AVM / over% / est. savings / sqft / beds / year built), Market Value Evidence table, Unequal Appraisal Evidence table, AI Strategy panel (conditionally rendered), Protest Tracker with horizontal stepper.
  - **Floating chat FAB:** Chat demoted from a 58vh pane to a fixed bottom-right ActionIcon that opens a 400px right-side Mantine Drawer. Removed the separate "Attach URL" button (URLs can be pasted directly in the chat input). Fixed the flex-layout height bug that was clipping the textarea below the visible region.
  - **Evidence tables:** Both Market Value and Unequal Appraisal tables show DCAD comparable properties fetched via new GET `/api/protest/:propertyId/comps` endpoint. Each table shows subject row at bottom (highlighted), $/sqft, and color-coded "vs Subject" column (green if comp is lower, helps the case).
  - **DB migration `0056_pt1_market_value.sql`:** Adds `market_value_usd NUMERIC` column to `protest_comp_cad`. `saveCADComps()` now stores `comp.marketValue` in this column; `listWorksheetComps()` returns full comp data (dcadPropertyId, city, sqft, beds, baths, yearBuilt, marketValueUsd).
  - **New endpoint `GET /api/protest/:propertyId/comps?year=N`:** Returns saved DCAD comps for a property/year. Added to `protest.routes.ts`; backed by the updated `listWorksheetComps()` service function.
  - **Strategy panel:** Rendered only when AI has generated a `strategyJson`. Shows case strength Progress bar, target value, primary strategy, draft arguments, and red flags Alert.
  - **Deadline banner:** Amber/red Alert appears when hearing date is ≤ 30 days away.
  - **Chat refresh:** After AI fetches comps (`compsAdded > 0`), the comps endpoint is re-fetched and evidence tables update automatically.
- **Files:** `backend/src/modules/protest/protest-worksheet.service.ts`, `backend/src/modules/protest/protest.routes.ts`, `backend/db/migrations/0056_pt1_market_value.sql`, `frontend/src/pages/TaxProtestPage.tsx`
- **Not in scope (Phase 2):** Redfin comparable sales search (actual sold prices), MLS data, PDF export.

---

## FIX-RE5 (2026-05-28): Property page — mortgage display, edit modal pre-fill, dropdown filter, Add form persistence

- **Type:** Bug fix (5 issues)
- **What:**
  - **Mortgage in detail table (issue 1):** `getProperty()` now LEFT JOINs `financial_account` on `property_id` + `type='loan'` to fetch the linked mortgage. `PropertyRecord` gains `linkedMortgageId`, `linkedMortgageInstitution`, `linkedMortgageMask`. PropertyDetailPage shows "Linked Mortgage" and "Mortgage Balance" rows in the details table (balance sourced from the latest equity history point, no extra API call).
  - **Edit modal pre-fill (issue 2):** AddPropertyModal now reads `linkedMortgageId` from the property response and sets `linkedAccountId` in state, so the dropdown shows the already-linked mortgage selected on open.
  - **Dropdown filter (issue 3):** Mortgage dropdown filters out accounts where `property_id` is non-null and not this property. Prevents already-linked mortgages from appearing selectable in Add/Edit modal.
  - **Purchase price/date persist on Add (issue 4):** POST `/properties` Zod schema was missing `purchasePrice` and `purchaseDate`. Added both fields; `createProperty()` now INSERTs them into the `property` table.
  - **Market value persists on Add (issue 5):** `initialValueUsd`/`initialValueAsOf` were already in the schema and service — this was the same root cause as issue 4 (the field names matched but purchasePrice/purchaseDate were stripped). With issue 4 fixed, all fields now reach the DB correctly.
- **Files:** `backend/src/modules/household/property.service.ts`, `backend/src/modules/household/household.routes.ts`, `frontend/src/components/AddPropertyModal.tsx`, `frontend/src/pages/PropertyDetailPage.tsx`

## UX-RE4 (2026-05-28): PropertyDetailPage — layout refinements, AVM fallback, charts side-by-side, seed fix

- **Type:** UX polish + bug fix
- **What:**
  - **Dev seed fix:** Mortgage account ID `40000000-0000-0000-0000-000000000006` collided with Marcus savings account in `dev_0003`; `ON CONFLICT DO NOTHING` silently swallowed the insert. Changed to `40000000-0000-0000-0000-000000000011`. Added 8 months of `account_balance_snapshot` rows for the mortgage so the equity chart renders with real data after `npm run db:reset:dev`.
  - **AVM fallback:** Valuation card now shows purchase price with label "Purchase Price (no AVM yet)" when `latestValueUsd` is null. Estimate range hidden in that case.
  - **Protest Readiness moved to right column:** Card is now stacked below Valuation in the span-4 right column. Left column is now image + Property Details only (less crowded).
  - **Charts side-by-side:** Value · Mortgage · Equity chart and Assessment History chart now sit in a 2-column `Grid` (each `span={{ base: 12, md: 6 }}`) instead of two stacked full-width cards. Both chart heights normalized to 240px; Y-axis width tightened to 48px to reclaim horizontal space at half-width.
- **Files:** `backend/db/seeds/dev/dev_0008_seed_properties.sql`, `frontend/src/pages/PropertyDetailPage.tsx`

## UX-RE3 (2026-05-28): PropertyDetailPage — equity/mortgage/AVM chart + layout redesign

- **Type:** Feature + UX redesign
- **What:**
  - New backend endpoint `GET /household/properties/:propertyId/equity-history` — lateral join across `property_value_snapshot` and `account_balance_snapshot` (linked mortgage); returns `{ date, avm, mortgageBalance, equity }[]` per snapshot date. Equity is `avm - mortgageBalance` (simple subtraction; no new complexity).
  - New full-width **Value · Mortgage · Equity** line chart (3 lines: AVM green, Mortgage red, Equity blue). Mortgage line only shown when a linked loan account has balance snapshots. Legend included.
  - Assessment History chart moved to full-width below the equity chart (was in left span-8 column).
  - Layout restructured: left col (span 8) now holds image + Property Details + Protest Readiness. Right col (span 4) holds Valuation numbers + compact Data Sources row. Charts are full-width below the grid.
  - AVM-only sparkline removed from Valuation card — equity chart fully replaces it.
  - Data Sources card shrunk to a single compact row (text + Refresh button inline, no padding waste).
  - `snapshots` state + `loadSnapshots` callback removed (now redundant).
- **Files:** `backend/src/modules/household/property.service.ts`, `backend/src/modules/household/household.routes.ts`, `frontend/src/pages/PropertyDetailPage.tsx`

## UX-RE2 (2026-05-28): Property detail page polish — edit button wired, purchase fields, theme colors fixed

- **Type:** UX polish + feature gap fill
- **What:**
  - `PropertyDetailPage.tsx`: Edit button (Property Details card) was greyed/disabled placeholder — now wired to `<AddPropertyModal existingPropertyId={property.id} />`. Clicking Edit opens the full edit modal inline.
  - `AddPropertyModal.tsx`: Added purchase price (USD) and purchase date fields. Both are loaded from the API in edit mode and sent in the PATCH body on save. Create mode includes them in the POST body. Fields sit between "Property use" and "Market value".
  - `PropertyDetailPage.tsx`: Replaced hardcoded hex colors (`#4dabf7` on tax line chart, `#2d6a4f` on AVM sparkline) with Mantine CSS variables (`var(--mantine-color-blue-5)`, `var(--mantine-color-green-7)`) so both charts respect light/dark theme.
- **Files:** `frontend/src/pages/PropertyDetailPage.tsx`, `frontend/src/components/AddPropertyModal.tsx`

## CR-RE1-ADD-MODAL (2026-05-28): AddPropertyModal extracted + dev seeds for real estate

- **Type:** Change request — modal extraction + test data
- **What:**
  - Extracted `frontend/src/components/AddPropertyModal.tsx` from the inline modal in `SettingsPage.tsx`. Props: `opened`, `onClose`, `onSaved`, optional `accountId` (hides mortgage picker when set), optional `existingPropertyId` (edit mode).
  - When `accountId` is not provided (opened from RE list), the modal fetches and shows a "Link to mortgage account (optional)" Select.
  - `SettingsPage.tsx`: replaced 27-field `propertyModal` state + `openPropertyModal` / `retrieveValuation` / `savePropertyDetails` functions with a 3-field state + `<AddPropertyModal>` component. SettingsPage auto-open after mortgage creation still works via `accountId` prop.
  - `RealEstatePage.tsx`: "Add Property" button now opens `AddPropertyModal` directly; no longer redirects to `/settings?tab=accounts`.
  - Added `backend/db/seeds/dev/dev_0008_seed_properties.sql` — 2 fictional properties (TX primary + TN rental), 8-month value snapshots each, mortgage account, protest worksheet + 3 DCAD comps.
- **Files:** `frontend/src/components/AddPropertyModal.tsx` (new), `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/RealEstatePage.tsx`, `backend/db/seeds/dev/dev_0008_seed_properties.sql` (new)
- **GitHub:** https://github.com/mangatrai/grove/issues/37

## CR-RE1-DETAIL (2026-05-28): PropertyDetailPage full redesign per prototype + hybrid assessment chart + AVM sparkline

- **Type:** Change request — real estate detail page UX
- **What:** Full rewrite of `PropertyDetailPage.tsx` to match prototype spec:
  - **Property Details card** — Property Type, Address, Beds/Baths, Above-Grade Sqft, Lot Size, Year Built, Stories, APN, County/CAD, Appeal Process, Monthly Rent (rental only), Notes (if set). Label/value grid layout, no editable fields.
  - **Assessment History chart** — Hybrid `ComposedChart`: Bar (assessed value, left Y-axis) + Line (taxes due, right Y-axis). Dual Y-axis both labelled in `$XXXk`. Year-over-year label on bars.
  - **Valuation card** — AVM sparkline using `property_value_snapshot` timeseries from `GET /household/properties/:id/values`. Shows trajectory month-over-month.
  - **`cadInfo()` helper** — derives CAD name and appeal process from `state` + `county`: TX (Denton→DCAD/ARB, Harris→HCAD, Travis→TCAD, Collin→CCAD, generic TX), TN (Shelby→Shelby Assessor/Board of Equalization, generic TN).
  - Removed purchase price / purchase date editable inputs (one-time at add time; not on detail page).
- **Files:** `frontend/src/pages/PropertyDetailPage.tsx`

---

## CR-RE1-REDFIN-PARSE (2026-05-28): Parse photo URL, county, stories, property type from Redfin response

- **Type:** Change request — Redfin data enrichment
- **What:**
  - `ValuationDetail` extended with `county`, `photoUrl`, `thumbnailUrl`, `subject.stories`, `subject.propertyType`.
  - `parseRedfinResponse()` in `realty-api.service.ts` extracts:
    - **County** — `details.aboveTheFold.mainHouseInfo.selectedAmenities` entry where `header === "County"`
    - **Exterior photo** — `details.aboveTheFold.photoTags.tagsByPhotoId` — first entry tagged "Exterior" (falls back to first entry); `photoUrl` (bigphoto) + `thumbnailphotoUrl` (midphoto)
    - **Stories** — `details.aboveTheFold.basicInfo.numStories`
    - **Property type** — `details.aboveTheFold.basicInfo.propertyTypeName`
  - `refreshPropertyValuation()` in `property.service.ts` persists `photo_url` from `result.detail.photoUrl ?? null`.
  - Property cards on `RealEstatePage.tsx` show the photo as a 120px thumbnail; diagonal-stripe placeholder when no photo.
- **Files:** `backend/src/modules/household/realty-api.service.ts`, `backend/src/modules/household/property.service.ts`, `frontend/src/pages/RealEstatePage.tsx`

---

## DB-RE1-PHOTO (2026-05-28): Add photo_url column to property table (migration 0055)

- **Type:** DB migration
- **What:** `ALTER TABLE property ADD COLUMN IF NOT EXISTS photo_url TEXT;`
- **Files:** `backend/db/migrations/0055_re1_photo_url.sql`

---

## CR-RE1-DCAD-BACKFILL (2026-05-28): Async DCAD backfill at property add time (TX only)

- **Type:** Change request — DCAD data enrichment
- **What:** When a TX property is created with a sufficiently complete address (street + city + state), a fire-and-forget `triggerDCADBackfill()` call runs after the 201 response. It calls `searchDCADByAddress()`, creates the protest worksheet if needed, and saves CAD comps. Errors are caught and logged; they do not affect the creation response.
- **Why:** DCAD assessment data is more reliable than Redfin for tax values and is needed before the protest flow begins. Pre-populating at add time means the protest worksheet starts with comps already loaded.
- **Files:** `backend/src/modules/protest/protest-worksheet.service.ts` (`triggerDCADBackfill` function), `backend/src/modules/household/household.routes.ts` (property creation POST handler)

---

## FIX-RE1-JSONB (2026-05-28): Fix valuation_detail_json always storing NULL

- **Type:** Bug fix — critical data persistence
- **Root cause:** All JSONB writes used `qExec` with `?::jsonb` SQL cast and `JSON.stringify(obj)` as the string param. The `postgres` npm library's `sql.unsafe()` sends JavaScript strings as the `text` OID; PostgreSQL's `::jsonb` cast on a typed-text parameter silently produces NULL rather than coercing it. The fix is to pass the plain JavaScript object/array — the driver then sends it with the JSONB OID, no cast needed.
- **Files fixed:**
  - `backend/src/modules/household/property.service.ts` — `refreshPropertyValuation`: `valuation_detail_json = ?::jsonb` + `JSON.stringify(result.detail)` → `valuation_detail_json = ?` + `result.detail`
  - `backend/src/modules/protest/protest-worksheet.service.ts` — `appendConversationTurn`: `conversation_json || ?::jsonb` + `JSON.stringify([turn])` → `conversation_json || ?` + `[turn]`; `updateStrategy`: `strategy_json = ?::jsonb` + `JSON.stringify(strategy)` → `strategy_json = ?` + `strategy`; `saveCADComps`: `?::jsonb` + `JSON.stringify(comp.raw)` → `?` + `comp.raw`
  - `backend/src/modules/household/household.routes.ts` — property creation path: same pattern fixed
- **Impact:** Subject facts (beds/baths/sqFt/yearBuilt), CAD assessment value, tax history, and comps were all invisible on Real Estate and Tax Protest pages because the JSONB column was always NULL.

---

## FIX-RE1-FIELDS (2026-05-28): Fix field-name mismatches across RE-1/PT-1 pages and API

- **Type:** Bug fix — data display
- **Fixes:**
  - `subject.sqFt` (capital F) was referenced as `sqft` (lowercase) in RealEstatePage, PropertyDetailPage, TaxProtestPage, and protest.routes.ts system prompt — caused sqft/beds/baths/yearBuilt to always show "—"
  - `.assessment.assessedValue` → `.taxCurrent.assessedValue` in RealEstatePage, PropertyDetailPage, TaxProtestPage, protest.routes.ts — CAD assessed value was always null
  - `.taxesPaid` → `.taxesDue` in RealEstatePage; added fallback chain `taxCurrent.taxesDue` first, then `taxHistory[0].taxesDue` — Annual Property Tax KPI always showed "—"
  - `detail.estimate.value` (wrong — `estimate` is a plain number) → `typeof detail.estimate === "number" ? detail.estimate : null` in protest.routes.ts system prompt
  - Image placeholder in PropertyDetailPage hardcoded "123 Example St" → `property.addressLine1 ?? "Property image"`
  - Vite dev proxy: added `"/api": api` so `/api/protest/...` calls reach Express instead of 404-ing
  - TaxProtestPage property switcher: `navigate()` + `setSearchParams` were both called on selection → double history entry; removed redundant `navigate()` call
- **Files:** `frontend/src/pages/RealEstatePage.tsx`, `frontend/src/pages/PropertyDetailPage.tsx`, `frontend/src/pages/TaxProtestPage.tsx`, `backend/src/modules/protest/protest.routes.ts`, `frontend/vite.config.ts`

---

## PT-1d (2026-05-27): TaxProtestPage frontend — chat + strategy + status tracker

- **Type:** Change request — protest assistant UI
- **What:** Added `TaxProtestPage` at `/tax-protest` with two-column layout: left-side worksheet chat (year selector, attachment helpers, optimistic send, assistant thread) and right-side context panel (property switcher, valuation/overassessment context, strategy panel, protest status stepper with hearing-date/status updates).
- **Files:** `frontend/src/pages/TaxProtestPage.tsx`, `frontend/src/App.tsx`
- **GitHub:** closes #23

---

## PT-1b (2026-05-27): DCAD service, worksheet service, and protest chat API

- **Type:** Change request — protest assistant backend
- **What:** Added `dcad.service.ts` with TrueProdigy public token auto-refresh + search helpers; added worksheet/comps persistence service; added `/api/protest/:propertyId/worksheet` (GET/PATCH) and `/api/protest/:propertyId/chat` with GPT-4.1 tool-use loop (`fetch_dcad_comps`, `update_strategy`) and conversation persistence.
- **Files:** `backend/src/modules/protest/dcad.service.ts`, `backend/src/modules/protest/protest-worksheet.service.ts`, `backend/src/modules/protest/protest.routes.ts`, `backend/src/app.ts`, `docs/API_REFERENCE.md`
- **GitHub:** closes #23

---

## PT-1a (2026-05-27): protest_worksheet and protest_comp_cad tables

- **Type:** DB migration — property tax protest worksheet + CAD comps cache
- **What:** Added migration `0054_pt1_protest_worksheets.sql` creating `protest_worksheet` and `protest_comp_cad` with household/property scoping, uniqueness indexes, and supporting indexes. Registered both tables in export coverage to prevent backup omissions.
- **Files:** `backend/db/migrations/0054_pt1_protest_worksheets.sql`, `backend/src/modules/export/export-registry.ts`
- **GitHub:** closes #23

---

## RE-1c/RE-1d/RE-1e (2026-05-27): Real Estate list/detail pages + sidebar nav

- **Type:** Change request — real estate UX delivery
- **What:** Added `RealEstatePage` (`/real-estate`) with KPI strip, property card grid, hearing/protest signals, and actions (`Add Property`, `Refresh All`). Added `PropertyDetailPage` (`/real-estate/:propertyId`) with two-column facts/valuation/protest/source layout, editable property metadata form, and assessment-history chart. Added sidebar group **Property & Tax** with links to Real Estate and Tax Protest. Wired protected routes in `App.tsx`.
- **Files:** `frontend/src/pages/RealEstatePage.tsx`, `frontend/src/pages/PropertyDetailPage.tsx`, `frontend/src/layout/AppSidebar.tsx`, `frontend/src/App.tsx`

---

## RE-1a/RE-1b (2026-05-27): Property metadata columns + PATCH fields

- **Type:** Change request — real estate property user metadata
- **What:** Added `purchase_price`, `purchase_date`, `monthly_rent`, and `property_notes` to the `property` table (migration `0053_re1_property_metadata.sql`). Extended `PropertyRecord` and `PATCH /household/properties/:propertyId` to read/write `purchasePrice`, `purchaseDate`, `monthlyRent`, and `propertyNotes`. `updateProperty` now sets only columns present in the patch body (undefined keys are not overwritten).
- **Files:** `backend/db/migrations/0053_re1_property_metadata.sql`, `backend/src/modules/household/property.service.ts`, `backend/src/modules/household/household.routes.ts`, `docs/API_REFERENCE.md`, `openapi/openapi.yaml`
- **GitHub:** closes #37

---

## FIX-237 (2026-05-27): Dashboard "Other" link — categoryIds multi-filter now expands parent categories to children

- **Type:** Bug fix — multi-category filter missing parent expansion
- **What:** Clicking "Other" on the "Where Money Went" dashboard strip navigated to the Transactions page with multiple `categoryIds` in the URL. The filter showed "5 categories" selected but returned 0 transactions. Root cause: the `ledgerFilterClause` single-ID path expands parent category IDs to include child transactions (`WHERE parent_id = ?`), but the multi-ID path (`= ANY(?)`) did a flat match only — no parent expansion. Dashboard category IDs can be parent IDs; transactions are stored with leaf/child IDs.
- **Fix:** Multi-ID path in `ledgerFilterClause` now also matches children: `tc.category_id = ANY(?) OR tc.category_id IN (SELECT id FROM category WHERE parent_id = ANY(?) ...)`.
- **Files:** `backend/src/modules/ledger/ledger.service.ts`

---

## FIX-ESPP-10 (2026-05-27): ESPP batch status — "Fully Sold" threshold raised to match display precision

- **Type:** Bug fix — floating-point epsilon mismatch
- **What:** Batches where `shares_transferred == shares_sold` (visually 0 held shares) could show "Partially Sold" instead of "Fully Sold". Root cause: `held` was compared against a `0.000001` epsilon, but Postgres NUMERIC → `parseFloat` floating-point residuals can produce `held ≈ 0.00003` — above the old threshold but below display precision (4dp). The batch would display held=0 yet show "Partially Sold".
- **Fix:** Raised the epsilon in `listBatchesWithSales` from `0.000001` to `0.00005` (half a unit at 4dp, matching `formatShares` display precision). Any held value that rounds to 0 at 4dp is now treated as "Fully Sold".
- **Files:** `backend/src/modules/espp/espp.service.ts`

---

## FIX-ESPP-9 (2026-05-27): ESPP Record Sale — allow 4-decimal sale price input

- **Type:** Bug fix — frontend precision truncation
- **What:** The "Price / share" `NumberInput` in the Record Sale modal had `decimalScale={2}`, silently truncating any price with more than 2 decimal places before it reached the backend. Example: entering 307.3951 was stored as 307.39, so 3 shares produced proceeds of $922.17 instead of the correct $922.19. DB schema (`sale_price_per_share NUMERIC(12,4)`) and backend computation (multiply-then-round) were already correct — only the frontend input was the bottleneck.
- **Fix:** `decimalScale={2}` → `decimalScale={4}`, `min={0.01}` → `min={0.0001}` on the price `NumberInput`.
- **Files:** `frontend/src/pages/EsppPage.tsx`

---

## FIX-PARSER-1 (2026-05-27): Parser robustness — case-insensitive section headers and flexible CSV column matching

- **Type:** Bug fix / hardening — bank import parsers
- **What:** Seven parsers had brittle exact-string or exact-case matches that would silently drop all data if the bank made a minor format change.
  - `marcus-online-savings-pdf.ts`: `"ACCOUNT ACTIVITY"` and activity column header were case-sensitive exact-string matches. Now uses `/ACCOUNT ACTIVITY/i` and a flexible `startsWith("datedescription") && includes("balance")` check.
  - `wealthfront-investment-pdf.ts`: `"II. Account Activity"` was an exact match. Now uses `/(?:II\.\s*)?Account Activity\b/i` — tolerates section numbering changes and casing.
  - `boa-credit-card-csv.ts`, `discover-card-csv.ts`, `wealthfront-investment-csv.ts`: Column lookups used exact-case string keys (`row["Posted Date"]`, `row["Trans. Date"]`, `row["Transaction date"]`, etc.). A bank export with different casing (e.g., `"Transaction Date"` vs `"Transaction date"`) would silently produce empty output. Now use a new `pickCol()` helper that tries exact match first, then case-insensitive, then tries common aliases.
  - `boa-estatement-pdf.ts`: Added `"Deposits and other additions - continued"` and `"ATM and debit card subtractions - continued"` handlers (matching the existing pattern for `"Other subtractions - continued"` and `"Withdrawals - continued"`). Also extended the transaction date regex from `/\d{2}\/\d{2}\/\d{2}/` to `/\d{2}\/\d{2}\/\d{2,4}/` to handle 4-digit-year statements.
- **New helper:** `pickCol(row, ...candidates)` in `tabular-helpers.ts` — exact then case-insensitive column lookup with alias fallback.
- **Files:** `backend/src/modules/imports/profiles/tabular-helpers.ts`, `marcus-online-savings-pdf.ts`, `wealthfront-investment-pdf.ts`, `boa-credit-card-csv.ts`, `discover-card-csv.ts`, `wealthfront-investment-csv.ts`, `boa-estatement-pdf.ts`

---

## FIX-BOA-1 (2026-05-27): BoA eStatement PDF — flat Withdrawals section silently dropped all transactions

- **Type:** Bug fix — backend parser
- **What:** The `"Withdrawals and other subtractions"` section header was encountered and simply skipped (`i++; continue`) without entering any parse zone. Any transactions directly under this header (rather than inside an `"ATM and debit card subtractions"` or `"Other subtractions"` subsection) were silently discarded.
- **Why it matters:** BoA "Adv Relationship Banking" and similar account types use a flat layout — all withdrawals sit directly under the top-level header with no subsections. Months where there are no ATM or debit card transactions also hit this case even on standard checking accounts.
- **Fix:** Added `"withdrawals"` as a first-class parse zone. When the header is encountered, `zone = "withdrawals"` and `pendingHeader = true`. The `"ATM and debit card subtractions"` and `"Other subtractions"` checks still fire first (before zone dispatching), so nested-section statements continue to work unchanged. `"Total withdrawals and other subtractions"` resets the zone.
- **Files:** `backend/src/modules/imports/profiles/boa-estatement-pdf.ts`, `backend/tests/boa-parser.test.ts` (3 new unit tests + 1 PDF integration test)

---

## FIX-ESPP-8 (2026-05-27): ESPP — DD-MMM-YY date parsing + transferred accumulation

- **Type:** Bug fix — backend
- **What:** Two fixes triggered by EquatePlus's second CSV export format.
  1. **DD-MMM-YY date parsing:** `parseMonthDate` now handles `15-Jan-26` / `30-Jan-26` format (EquatePlus allocation CSV uses this for multi-event exports). Previously all rows were silently skipped → import fell back to PDF-only path → used PDF "Distributed" (running total) as `sharesTransferred`.
  2. **CSV `sharesTransferred` accumulation:** Each EquatePlus CSV represents one transfer event delta, not a cumulative total. On UPSERT conflict (same household+date), `shares_transferred` is now accumulated (`existing + delta`), capped at `shares_granted` to prevent double-import inflation. PDF-only imports preserve the existing `shares_transferred` — PDF's "Distributed" is a running total that includes cross-batch events and must not be accumulated.
- **Why:** Batch A showed stale `sharesTransferred` after second CSV (partial remainder not accumulated). Batch B showed the PDF Distributed running total instead of the CSV per-event delta. Root cause was the date parsing failure silently dropping all second-CSV rows.
- **Files modified:** `backend/src/modules/espp/espp-parse.service.ts` (`parseMonthDate`), `backend/src/modules/espp/espp.service.ts` (split UPSERT logic, remove PDF sharesTransferred override), `backend/tests/espp.test.ts` (DD-MMM-YY parse test, accumulation integration test)

---

## FIX-ESPP-7 (2026-05-27): ESPP info icons, multi-batch import, discount fallback

- **Type:** Bug fix + UX — backend + frontend
- **What:** Three fixes.
  1. **Multi-batch CSV import:** `importBatch` now creates one `espp_batch` row per CSV row (previous version dropped all but the first date). PDF enriches the matching date; other dates get CSV-only batches with null FMV. `POST /espp/import` response changed from `{ batch }` to `{ batches: [] }`.
  2. **Discount Received YTD fallback:** `getYearSummary` now uses `CASE WHEN espp_discount_payslip IS NOT NULL THEN espp_discount_payslip ELSE discount_per_share * shares_transferred END` so Discount Received is non-zero for batches without a linked payslip.
  3. **StatCard info icons:** Replaced plain `sub` text on Discount Received, Ordinary Income, and Capital Gain/Loss cards with Mantine `Tooltip` + `IconInfoCircle` icon — formulas visible on hover.
- **Files modified:** `backend/src/modules/espp/espp.service.ts`, `backend/src/modules/espp/espp.routes.ts`, `backend/tests/espp.test.ts` (array assertions + multi-batch test), `frontend/src/pages/EsppPage.tsx`, `docs/USER_GUIDE.md` (ESPP section), `docs/ADMIN_GUIDE.md` (ESPP tables §5.2), `docs/BACKLOG.md` (ESPP-1 shipped)

---

## CR-ESPP-1 (2026-05-27): IBM ESPP Equity Tracker — backend (ESPP-1)

- **Type:** Feature — backend + DB
- **GitHub:** https://github.com/mangatrai/grove/issues/31
- **What:** Full backend for IBM ESPP purchase batch tracking and sale history. Migration `0052_espp_tracker.sql` creates `espp_batch` (one row per purchase date, upserted on re-import) and `espp_sale` (time-series disposals). Five REST endpoints under `/espp`: list batches with sales, year summary, import from EquatePlus PDF/CSV, record sales, delete sale. OI and cap gain/loss computed server-side on sale insert. Import auto-links batch to matching payslip and stores IBM-authoritative discount/deduction amounts. Both `espp_batch` and `espp_sale` registered in export registry (restoreOrder 21–22).
- **Files created:** `backend/db/migrations/0052_espp_tracker.sql`, `backend/src/modules/espp/espp.types.ts`, `backend/src/modules/espp/espp-parse.service.ts`, `backend/src/modules/espp/espp.service.ts`, `backend/src/modules/espp/espp.routes.ts`, `backend/tests/espp.test.ts`
- **Files modified:** `backend/src/app.ts` (register esppRouter), `backend/src/modules/export/export-registry.ts` (2 new entries), `docs/API_REFERENCE.md` (ESPP section)
- **Why:** V5 feature — user needs tax visibility (OI vs cap gain) and P&L tracking for IBM ESPP grants across purchase batches and sale disposals.

---

## CR-ESPP-1 (2026-05-26): IBM ESPP tracking page — frontend (ESPP-1)

- **Type:** Feature — frontend
- **What:** Added `/espp` page for IBM Employee Stock Purchase Plan tracking: year summary strip, purchase batch table with expandable sale history, import modal (PDF + CSV drop zones), and record-sale modal.
- **Files created:** `frontend/src/pages/EsppPage.tsx`, `e2e/espp.spec.ts`
- **Files modified:** `frontend/src/App.tsx` (route), `frontend/src/layout/AppSidebar.tsx` (Daily nav item), `frontend/vite.config.ts` (`/espp` API proxy)
- **Why:** ESPP-1 frontend slice; backend endpoints wired via bare `/espp/*` paths (Vite proxy). Custom file drop zones (no `@mantine/dropzone` dep); native date input (no `@mantine/dates`). E2E: sidebar nav, summary strip, empty/table state, import modal, year selector, no console errors.

## FIX-ESPP-4 (2026-05-27): ESPP PDF parser regex + structured logging

- **Type:** Bug fix — backend + tests
- **What:** Real EquatePlus web-app PDFs concatenate field labels and values with no whitespace (e.g., `Allocated4.06578`, `Cost basis$ 203.68`, `Allocation dateMar 31, 2026`). All five extraction regexes failed on this format → all fields null → 422 NO_DATE. Fixed: regexes now use `\s*` for zero-or-more-space separators; "Allocation date" added as primary date label (EquatePlus uses this, not "Purchase date:"). Added structured `log.debug/warn` calls to `espp-parse.service.ts` and `log.debug/warn/info` to the import route so parse failures are visible in logs. Added test case for the real concatenated format (now 501 passing backend tests).
- **Files modified:** `backend/src/modules/espp/espp-parse.service.ts`, `backend/src/modules/espp/espp.routes.ts`, `backend/tests/espp.test.ts`

## FIX-ESPP-3 (2026-05-27): RecordSaleModal layout + import UX

- **Type:** Bug fix — frontend
- **What:** RecordSaleModal 7-column grid (`"7fr 90px 120px 120px 110px 120px 34px"`) overflowed its container → horizontal scroll; batch dropdown rendered too small. Redesigned to 5 columns (`"1fr 80px 108px 112px 30px"`): Batch | Shares | Price | Proceeds | ✕. OI and cap gain are shown as small live-calc text below the Proceeds box (gold OI · forest/terracotta CG) — informational, not a separate column. ImportModal: disable backdrop/escape dismiss during submit so accidental close no longer swallows error feedback.
- **Files modified:** `frontend/src/pages/EsppPage.tsx`

## FIX-ESPP-2 (2026-05-26): ESPP page crash + dark-mode color mismatch

- **Type:** Bug fix — frontend
- **What:** Two bugs. (1) `formatUsd(batch.fmvPerShare)` crashed with `Cannot read properties of null (reading 'toLocaleString')` — CSV-only batches have null FMV and discount; now renders "—" for null fields. (2) `EsppPage` T object hardcoded light-mode hex values (#efebe3, #fdfcfb, etc.) instead of CSS variables, so the page rendered with light linen backgrounds in dark mode while the rest of the shell was dark. Replaced all T values with `var(--color-*)` and `var(--fs-*)` tokens that adapt to both color schemes.
- **Files modified:** `frontend/src/pages/EsppPage.tsx`

## FIX-ESPP-1 (2026-05-26): ESPP page blank — API envelope + Vite proxy scope

- **Type:** Bug fix — frontend
- **What:** `GET /espp/batches` returns `{ batches: [...] }` but `EsppPage` treated the body as a bare array → `batches.map is not a function` and a white screen. Unwrap `batchesRes.batches`. Vite proxy: replaced catch-all `/espp` with `/espp/batches`, `/espp/summary`, `/espp/import`, `/espp/sales` so the React route `/espp` is not forwarded to Express on hard refresh.
- **Files modified:** `frontend/src/pages/EsppPage.tsx`, `frontend/vite.config.ts`

---

## CR-226 (2026-05-25): Playwright E2E test suite — initial setup (I-8)

- **Type:** Test infrastructure
- **What:** Added Playwright end-to-end tests (I-8 from V4 backlog). Three test suites, 13 tests total covering the critical user paths.
- **Files created:** `e2e/auth.spec.ts`, `e2e/dashboard.spec.ts`, `e2e/transactions.spec.ts`, `e2e/helpers/auth.ts`, `playwright.config.ts`
- **Files modified:** `package.json` (added `test:e2e` script + `@playwright/test` dev dep), `backend/db/seeds/0001_bootstrap.sql` (added `e2e@example.com` test user with `force_password_change=false`)
- **Test suites:**
  - `auth.spec.ts` — login form render, invalid credentials error, successful login, force-password-change redirect for bootstrap owner
  - `dashboard.spec.ts` — dashboard load, cash/net-worth/budget sections visible, no console errors
  - `transactions.spec.ts` — table render, filter input, row data, needs-review URL param
- **Why:** Bootstrap user has `force_password_change=true`; added `e2e@example.com` (same password hash, `force_password_change=false`) to bootstrap seed so tests bypass the mandatory-reset redirect without modifying production user flow.
- **Run:** Requires `npm run start:dev` (ports 3000/4000) + `npm run db:reset:dev`, then `npm run test:e2e`

---

## DOC-217 (2026-05-25): Documentation consolidation — 40+ files → 5 canonical docs (T-1)

- **Type:** Maintenance / documentation restructure
- **What:** Reduced the `docs/` directory from 40+ markdown files to 5 canonical documents. 25 source files were retired; their content was synthesized into the new structure.
- **New documents:**
  - `docs/USER_GUIDE.md` — enhanced end-user guide; covers every major screen, workflow, and key UI element; reads frontend React pages for accuracy
  - `docs/ADMIN_GUIDE.md` — new operator guide; consolidates RUNBOOK.md, PRODUCTION_SETUP.md, HOSTING_OPTIONS_AND_HOME_LAB.md, OCI_DEPLOYMENT.md, ENVIRONMENT_VARIABLES.md, DATABASE_ARCHITECTURE.md, ARCHITECTURE.md, CACHING.md, IMPORT_CLASSIFICATION.md, EMAIL_INFRASTRUCTURE.md
  - `docs/BACKLOG.md` — Jira/Trello-style board; consolidates V4_PLAN.md, V4_BACKLOG.md, V3_PLAN.md, V3_BACKLOG.md, EXPORT_IMPORT_BACKLOG.md, IMPORT_PIPELINE_SIMPLIFICATION_BACKLOG.md, MOBILE_UX_BACKLOG.md, MULTI_HOUSEHOLD_BACKLOG.md, RECURRING_PAYMENTS_BACKLOG.md, SECURITY_HARDENING_BACKLOG.md; includes shipped V3/V4, active items, deferred, dropped
  - `docs/PRD_AND_CRS.md` — product requirements + architecture decisions; consolidates archive/FINANCE_APP_PRD.md, archive/CATEGORIZATION_ROADMAP.md, archive/DECISIONS_LOG.md, archive/PFM_COMPETITIVE_UX_REFERENCE.md, archive/PROJECT_CONTEXT.md, PAYSLIP_V1.md
  - `docs/CHANGE_HISTORY.md` — kept as-is; untouched
- **Untouched:** All `docs/API_*.md` files and `openapi/openapi.yaml`
- **README.md:** Documentation table updated to point to the 5 new canonical docs
- **CHANGE_HISTORY.md:** PRD-prefix note updated (archive/FINANCE_APP_PRD.md retired; PRD_AND_CRS.md is the new canonical PRD)
- **Files created:** `docs/ADMIN_GUIDE.md`, `docs/BACKLOG.md`, `docs/PRD_AND_CRS.md` (new); `docs/USER_GUIDE.md` (rewritten)
- **Files deleted:** 21 files in `docs/`, 5 files in `docs/archive/` (archive/ is now empty)

---

## FIX-225 (2026-05-26): Year-in-review — investment contributions excluded from spending + NetWorth manual-refresh-only

- **Type:** Data quality + UX
- **Investments excluded from spending:** Transactions under `Investments` parent (Stocks, IRA, 529, Crypto, Bonds, and any user-created subcategories) were counted as spending in the year-in-review. Fixed by fetching all investment category IDs at runtime (parent + leaves by `parent_id` JOIN) and excluding them from income/spending aggregates, `topCategories`, and `largestTransaction`. A separate `investmentContributions` total is computed and passed to the LLM so it can narrate "invested $X" rather than treating contributions as spending. `CACHE_VERSION` bumped to `"3"` to bust stale reports.
- **NetWorth balance save no longer triggers page reload:** `saveRow` and `runBulkAsOf` switched from `apiJson` to `apiFetch` — no auto `invalidateCacheByUrl` fires on save. `/reports/balance-sheet/manual` removed from `CACHE_INVALIDATION_MAP`. A `IconRefresh` button added to the "Balance sheet" section header so users can reload once after editing all accounts.
- **Missing investment IDs added:** `investmentsParent`, `investmentsStocks`, `investmentsFiveTwentyNinePlan`, `investmentsCrypto` added to `DEFAULT_CATEGORY_IDS` in `category-ids.ts`.
- **Tests updated:** `cache.test.ts` updated to assert that `/balance-sheet/manual` correctly produces no scope invalidation.
- **Files:** `backend/src/modules/category/category-ids.ts`, `backend/src/modules/reports/year-summary.service.ts`, `backend/src/modules/reports/year-summary.types.ts`, `frontend/src/cache.ts`, `frontend/src/cache.test.ts`, `frontend/src/pages/NetWorthPage.tsx`

## FIX-224 (2026-05-25): Year-in-review — transfer contamination, effective-rate = 0, stale cache not busted

- **Type:** Data quality / calculation bug
- **Income/spending inflated by transfers:** `computeIncomeSpending`, `computeTopCategories`, `computeLargestTransaction` all included inter-account transfer transactions (category IDs: `transfersIn`, `transfersOut`, `transfersCashWithdrawal`, `transfers` parent). This inflated reported income from ~$136K actual to $1.1M and made "Transfers out" 70% of spending. Fixed by adding `AND NOT (category_id = ANY(?))` using `TRANSFER_CATEGORY_IDS` constant from `DEFAULT_CATEGORY_IDS`.
- **effectiveFederalRatePct / effectiveTotalRatePct = 0:** `payslip_snapshot.effective_federal_rate_ytd` stores a decimal ratio (e.g. 0.283), but the service returned it as-is. Multiplied by 100 to convert to percentage points.
- **Stale cache not busted on logic change:** Cache hash only covered data row counts and timestamps — logic fixes silently returned stale results. Added `CACHE_VERSION` constant; bumped to `"2"` and included in hash so any query-logic change busts existing cached reports.
- **Files:** `backend/src/modules/reports/year-summary.service.ts`

## FIX-223 (2026-05-25): NetWorth page — overly aggressive cache invalidation on mutations + GDrive reconnect broken

- **Type:** Bug fixes — two issues
- **GDrive reconnect:** "Reconnect Google Drive" button in the `needsReauth` alert called `handleGDriveConnect()` with no argument. The handler reads `gdriveFolderIdInput` (always empty at this point) and returns early with "Enter the Drive folder ID first." Fix: `handleGDriveConnect` now accepts an optional `overrideFolderId`; reconnect button passes `gdriveStatus.folderId` (already stored from the original connect).
- **Cache over-invalidation on NetWorthPage:**
  - `refreshPropertyValuation` used `apiJson` POST → `invalidateCacheByUrl` fired → `hfa:cache-invalidate` event → trend chart and balance sheet refetched immediately, before the user even confirmed the Redfin estimate. Changed to `apiFetch` to prevent premature invalidation.
  - `saveEdit` / `runBulkAsOf` / `savePropertyMarketValue` each called explicit `refreshSheetCache()` + `refreshHistoryCache()` AFTER `apiJson` POST — redundant because those URLs are already in `CACHE_INVALIDATION_MAP` and `apiJson` auto-fires the invalidation event. Removed the duplicate explicit calls (one reload per save, not three).
- **Files:** `frontend/src/pages/settings/BackupRestoreSection.tsx`, `frontend/src/pages/NetWorthPage.tsx`

## FIX-221 (2026-05-25): Net Worth page cache keys change daily — trend and account charts reload on every visit

- **Type:** Bug fix — cache miss on every new calendar day because cache keys embedded today's full `YYYY-MM-DD` date
- **Root cause:**
  - `historyCacheKey` was `"bs-history:" + historyQs` where `historyQs` included `to=<todayIso()>`. Every new calendar day the `to` date changed → different key → cache miss → re-fetch
  - `acctCacheKey` (individual account mini-charts) was `"bs-acct-history:<id>:<from>:<to>"` — same daily-drift problem
  - Snapshot `maxAgeMs` was 1 hour; with scope-version invalidation already in place on mutations, 1 hour was unnecessarily short
- **Fix:**
  - `historyCacheKey` for non-custom presets now uses `"bs-history:<preset>:<interval>:<belongsTo>:<YYYY-MM>"` — stable for the entire month. Custom date ranges keep exact `from:to` in the key.
  - `acctCacheKey` now uses `"bs-acct-history:<id>:<YYYY-MM>"` — stable for the month.
  - Snapshot `maxAgeMs` raised from 1 hour to 24 hours; invalidation via networth scope version bump (on balance save / property update) handles freshness correctly.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`

## FIX-220 (2026-05-25): Dashboard caching for 5 slow home-page cards

- **Type:** Performance fix — reduce page-open latency for 5 cards that were refetching on every navigation
- **What:**
  - Converted Net Worth snapshot, Net Worth 6-month history, 6-month transactions (By Account), and Recurring Payments from `loadAll` uncached fetches to individual `useLocalStorageCache` hooks
  - Added "recurring" cache scope to `cache.ts` so recurring-override dismisses can invalidate independently without touching the dashboard/networth scopes
  - `dismissRecurring` now calls `bumpCacheVersion("recurring")` after a successful POST so the stale cached override list is evicted immediately
  - `loadAll` now only fetches 3 items (resolution summary, budget, prior-year transactions) — 4 fewer network calls on cache-hit page loads
  - Each card uses its own loading flag instead of the global `loading` from `loadAll`: "Where money went" → `cashCacheLoading`, Net Worth → `netWorthCacheLoading`, Recurring → `recurringCacheLoading`, By Account → `recentTxnsCacheLoading`
  - Fixed "Other" bucket sort in "Where money went": always pinned last regardless of its total, even if it exceeds a named category
- **Files:** `frontend/src/pages/DashboardPageV2.tsx`, `frontend/src/cache.ts`

## FIX-219 (2026-05-25): Settings > Data & Backup causes logout on expired Google Drive token

- **Type:** Hot production break — clicking Settings > Data & Backup signed the user out when Google Drive auth was expired
- **Root cause:** `GET /gdrive/backups` returned HTTP 401 with `code: GDRIVE_NEEDS_REAUTH` when the Google OAuth token had expired. The frontend's `apiJson`/`apiFetch` treat any 401 as a JWT session expiry and call `setToken(null)` (clearing the JWT and signing the user out). The two 401 meanings (JWT invalid vs Google token expired) were conflated.
- **Fix:**
  - `gdrive.routes.ts`: Changed `needs_reauth` response from `res.status(401)` to `res.status(409)` — 401 is now reserved exclusively for JWT auth failures
  - `BackupRestoreSection.tsx`: `loadDriveBackups` catch block now propagates the server error message (e.g. "Google Drive authorization has expired. Reconnect in Settings.") instead of a hardcoded generic string
- **Files:** `backend/src/modules/gdrive/gdrive.routes.ts`, `frontend/src/pages/settings/BackupRestoreSection.tsx`

## CR-216 (2026-05-25): F-1 — In-app notification system

- **Type:** New feature — unified notification center with bell icon, per-type preferences, and 8 trigger types
- **What:**
  - Migration `0051`: `notification` table (id, household_id, user_id, type, title, body, action_url, read_at), `notification_preference` table (per-user per-type email+inapp toggles), `large_txn_threshold_usd NUMERIC(12,2)` on `household` table
  - **`notification.service.ts`** (new): `createNotification()` (broadcast or targeted, checks prefs, dispatches email), `listNotifications()`, `getUnreadCount()`, `markNotificationRead()`, `markAllNotificationsRead()`, `getNotificationPreferences()`, `upsertNotificationPreferences()`, `checkBudgetThresholds()`, `purgeOldNotifications()`
  - **`notifications.routes.ts`** (new): `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`, `GET /notifications/preferences`, `PUT /notifications/preferences`
  - **`app.ts`**: registered `/notifications` router
  - **`server.ts`**: calls `purgeOldNotifications()` on startup (90-day retention)
  - **`export-registry.ts`**: `notification` and `notification_preference` added to `EXPORT_EPHEMERAL_TABLES`
  - **`gdrive-backup.service.ts`**: fires `backup_complete` / `backup_failed` notifications; FIX-215 manual `sendMail` replaced with `createNotification` (email now respects preference)
  - **`export-job.service.ts`**: fires `export_ready` notification
  - **`import-household-bundle.service.ts`**: fires `restore_complete` notification
  - **`realty-scheduler.service.ts`**: fires `property_valuation_updated` notification on each successful refresh
  - **`canonical-ingest.service.ts`**: fires `large_transaction` per row exceeding `large_txn_threshold_usd`; calls `checkBudgetThresholds()` after import (fires `budget_threshold_80` / `budget_threshold_100` at most once per category per month)
  - **`household.service.ts`** / **`household.routes.ts`**: `largeTxnThresholdUsd` added to GET/PATCH `/household/settings`
  - **`NotificationPanel.tsx`** (new): bell icon with red badge, Popover panel, 60s unread polling, mark-read / mark-all-read, settings link
  - **`AppTopBar.tsx`**: `NotificationPanel` inserted between Import button and user menu
  - **`SettingsPage.tsx`**: "notifications" tab added; preference matrix (In-app / Email toggles per type); `largeTxnThresholdUsd` field in Household tab; placeholder Divider removed from Profile tab
- **Notification types (9):** `import_complete`, `export_ready`, `restore_complete`, `backup_complete`, `backup_failed`, `property_valuation_updated`, `budget_threshold_80`, `budget_threshold_100`, `large_transaction`
- **UX fixes (post-launch):** Added `import_complete` type; fixed `e.currentTarget.checked` crash (switched to Mantine `Checkbox` + capture value before state update); redesigned notification grid with section groups (Data & Backup / Budget & Spending / Properties); clearer descriptions; large_transaction row notes threshold location in Household settings; Vite proxy added `/notifications`
- **Design decisions:** Per-user rows for broadcast (each member gets own `read_at`); budget check at import finalize time; auto-delete >90 days on startup; `large_txn_threshold_usd` in Household settings

## FIX-215 (2026-05-25): Google Drive — handle expired refresh token (invalid_grant)

- **Type:** Bug fix — production backup failure with no recovery path
- **What:** Google OAuth refresh tokens issued by apps in "Testing" status expire after 7 days. Previously the backup job and list-backups endpoint logged `invalid_grant` and failed silently with no user-visible signal.
  - Migration `0050`: added `needs_reauth BOOLEAN DEFAULT FALSE` to `household_gdrive_config`
  - `gdrive-backup.service.ts` `runBackupJob`: catches `invalid_grant` GaxiosError, sets `needs_reauth = TRUE` on the config, and sends an email to the household owner
  - `gdrive-backup.service.ts` `listDriveBackups`: catches `invalid_grant`, sets `needs_reauth = TRUE`, returns new `needs_reauth` reason (→ 401 from route)
  - `gdrive.service.ts`: `markGDriveNeedsReauth()` helper; `connectGDrive()` clears `needs_reauth = FALSE` on successful reconnect; `needsReauth` field added to `GDriveStatus` type and SELECT
  - `gdrive.routes.ts` `/backups`: handles `needs_reauth` reason → 401 `GDRIVE_NEEDS_REAUTH`
  - `BackupRestoreSection.tsx`: orange alert banner + "Reconnect Google Drive" button shown when `needsReauth = true`
- **Why:** App is in Google OAuth "Testing" status (personal use, no Google verification); tokens expire every 7 days. Backup had been silently failing for ~3 days before user noticed. Fix surfaces the expiry via email + in-app banner with a one-click reconnect.
- **Files:** `backend/db/migrations/0050_gdrive_needs_reauth.sql`, `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `frontend/src/pages/settings/BackupRestoreSection.tsx`

---

## UX-214 (2026-05-24): Year in Review — revised LLM narrative prompt

- **Type:** Prompt quality — narrative tone and structure
- **What:** Rewrote `buildPrompt()` in `year-summary.service.ts`. Moved advisor role to a dedicated OpenAI system message (`NARRATIVE_SYSTEM_PROMPT`). Restructured three paragraphs: wins first → notable observation → forward-looking opportunity. Removed `topMerchant` from the data payload (was leading the LLM to call out specific merchants). Spending categories can be named as factual observations but the LLM is explicitly instructed not to suggest lifestyle changes, cheaper alternatives, or category reductions.
- **Why:** Previous output lectured the household on dining out habits; `topMerchant` + "actionable suggestion" framing caused the LLM to reach for the cheapest move (cut the top spend category). Good → notable → opportunity is the correct advisor arc.
- **Files:** `backend/src/modules/reports/year-summary.service.ts`

---

## FIX-213 (2026-05-24): Error logging — GDrive and export preview routes (I-10)

- **Type:** Observability — log Drive/OAuth/HFB failures before 4xx/5xx responses
- **What:** `gdrive.service.ts` OAuth exchange; `gdrive-backup.service.ts` non-Gaxios list errors; `gdrive.routes.ts` connect/list/download/preview/restore; `exports.routes.ts` HFB manifest preview.
- **Why:** I-10 audit cluster 2 — GDrive module failures were invisible in server logs.
- **Files:** `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `backend/src/modules/export/exports.routes.ts`

---

## FIX-212 (2026-05-24): Error logging — imports, payslips, startup, background jobs (I-10)

- **Type:** Observability — log swallowed import/payslip/startup/job errors
- **What:** Startup IIFE try/catch + `process.exit(1)`; `import-parser` / `import-upload` parse failures; payslip LLM/PDF sniff failures; export/import/backup job handlers pass full `err` to `log.error`. `CLAUDE.md` documents `log.*` API (not `logger.*`).
- **Why:** I-10 audit cluster 1 — core user flows failed with no stack trace in logs.
- **Files:** `backend/src/server.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/src/modules/imports/import-upload.service.ts`, `backend/src/modules/payslip/payslip-parse.service.ts`, `backend/src/modules/payslip/payslip-sniff.service.ts`, `backend/src/modules/export/export-job.service.ts`, `backend/src/modules/export/import-household-bundle.service.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `CLAUDE.md`

---

## CR-211 (2026-05-24): Year in Review — backend service, migration, and routes (F-7)

- **Type:** New feature — backend half of F-7 Year-End Wrapped
- **Migration:** `0049_year_summary_cache.sql` — `year_summary_cache` table (Postgres); stores `data_json`, `narrative_json`, SHA-256 `data_hash` for lazy invalidation; `UNIQUE(household_id, year)`.
- **Service:** `year-summary.service.ts` — aggregates income/spending from `transaction_canonical`, net worth + investment + bank balance growth from `account_balance_snapshot`, top categories, best/worst month, largest transaction, top merchant, payslip YTD aggregates from last payslip per household member. Generates 3-paragraph LLM narrative (OpenAI gpt-4o, cached). Hash-based cache invalidation — never auto-regenerates on import; waits for user to open overlay.
- **Routes:** `GET /reports/year-summary?year=YYYY` (returns `YearSummaryResponse`), `POST /reports/year-summary/:year/email` (sends static summary email via existing mailer).
- **Env:** Added `VITE_MODE=TEST` to `.env` — frontend reads `import.meta.env.VITE_MODE === 'TEST'` to show Year in Review button outside the Feb–Mar production window.
- **Why:** F-7 Year-End Wrapped feature. F-1 (notification system) dependency removed — existing SMTP/nodemailer is sufficient for the email endpoint.
- **Files:** `backend/db/migrations/0049_year_summary_cache.sql`, `backend/src/modules/reports/year-summary.types.ts`, `backend/src/modules/reports/year-summary.service.ts`, `backend/src/modules/reports/reports.routes.ts`, `.env`

---

## UX-211 (2026-05-24): Year in Review — frontend wrapped summary overlay

- **Type:** New feature (frontend only; backend `GET /reports/year-summary` built in parallel)
- **What:** Dashboard button (Feb–Mar, or always in `VITE_MODE=TEST`) opens a confirmation modal, then a full-screen 12-slide “Year in Review” overlay with animated stats, charts, and AI narrative. New files: `year-review/types.ts`, `useYearSummary.ts`, `YearInReviewOverlay.tsx`, `YearInReviewSlides.tsx`; CSS in `index.css`. Slide 12 email CTA (when `emailEnabled` from `/auth/capabilities`) posts `POST /reports/year-summary/:year/email` with JSON body `{ email }`, not a query param.
- **Why:** Spotify-style year-end household finance recap for prior calendar year.
- **Files:** `frontend/src/components/year-review/*`, `frontend/src/hooks/useYearSummary.ts`, `frontend/src/pages/DashboardPageV2.tsx`, `frontend/src/index.css`

---

## UX-210 (2026-05-23): PS-2b follow-on — filter insurance from contributions card; add post-tax savings rate badge

- **Type:** Correctness fix + UX enhancement
- **What:**
  - Added `isContributionItem(item)` classifier to `contributions.ts` using a regex that matches investment/savings items (401k, 403b, 457, Roth, ESPP, RSU, HSA, FSA, deferred comp, pension, after-tax, stock salary/other/purchase, profit sharing, savings plan). Items like Group Life Insurance, AD&D, LTD, Health Care Premium, Legal Insurance, and dental/vision premiums do NOT match and are excluded.
  - Contributions YTD sidebar card now filters both pre-tax and post-tax sections through `isContributionItem` — only true investment contributions appear.
  - Added `computeFilteredPostTaxSavingsRate(ps)` to `savingsUtils.ts` — sums `amountCurrent` for filtered post-tax line items divided by gross.
  - `SavingsRateBanner` extended with `postTaxRate` prop; shows a second `📈 X% of gross to post-tax investments this period` row when non-null. Banner now renders if either pre-tax or post-tax rate is present.
- **Why:** Post-tax deductions include both insurance (non-savings) and investment contributions. Displaying all post-tax items as "contributions" was misleading.
- **Files:** `frontend/src/payslip/contributions.ts`, `frontend/src/payslip/savingsUtils.ts`, `frontend/src/payslip/SavingsRateBanner.tsx`, `frontend/src/pages/PayslipDetailPage.tsx`

---

## UX-209 (2026-05-23): PS-2b — post-tax contribution grouping in payslip sidebar

- **Type:** UI enhancement (V4 backlog item PS-2b)
- **What:** The "Contributions YTD" sidebar card on `PayslipDetailPage` now shows both pre-tax and post-tax deduction line items. When both sections are present, "Pre-Tax" / "Post-Tax" section labels appear; if only one type exists the label is omitted. Post-tax items are sourced from `detail.lineItems.post_tax_deductions` (raw, not merged with `other_deductions`). Null `amountYtd` renders as `—` via `formatMoney`, same as pre-tax.
- **Also:** Added `computePostTaxSavingsRate`, `computePostTaxSavingsRateYtd`, and `computeWealthBuildingRateYtd` to `savingsUtils.ts` for future use.
- **Cleanup:** Removed unused `contribGroups` useMemo + `groupContributions` import (the IIFE in the card handles the show/hide logic directly). Fixed pre-existing test fixture gap: `payslipChartsModel.test.ts` `base()` fixture missing `effectiveFederalRateYtd`/`effectiveTotalTaxRateYtd`.
- **Files:** `frontend/src/payslip/savingsUtils.ts`, `frontend/src/pages/PayslipDetailPage.tsx`, `frontend/src/payslip/payslipChartsModel.test.ts`

---

## CR-208 (2026-05-23): PS-5 — recalculate stored tax rates on payslip edit

- **Type:** Correctness fix (follow-on to CR-207)
- **What:** When a payslip is edited — either its summary fields (`grossPayYtd`, `employeeTaxesYtd`, etc.) or any line item (add, edit, delete) — the stored `effective_federal_rate_ytd` and `effective_total_tax_rate_ytd` are now recomputed and written in the same operation.
  - **`PATCH /payslips/:id`** (summary edit): fetches current line items before the UPDATE, merges patched values with existing values to compute new rates, includes rate columns in the single UPDATE.
  - **`PATCH /payslips/:id/line-items/:itemId`**, **`POST /payslips/:id/line-items`**, **`DELETE /payslips/:id/line-items/:itemId`**: all three run inside a transaction; `computeAndWriteTaxRatesInTx()` executes after `applyDerivedSummary` (so `employee_taxes_ytd` is already re-summed) but before the final snapshot SELECT, so the returned snapshot carries fresh rates.
- **Why:** Without recalculation on edit, stored rates became stale after any correction to LLM-extracted numbers. The stored value preference in `savingsUtils.ts` means stale stored rates would shadow the correct runtime fallback.
- **Files:** `backend/src/modules/payslip/payslip.service.ts`

---

## CR-207 (2026-05-23): PS-5 Phase 1 — store effective tax rates at payslip import

- **Type:** Reliability fix / data quality (V4 backlog item PS-5 Phase 1)
- **What:** At payslip import time, `effective_federal_rate_ytd` and `effective_total_tax_rate_ytd` are now computed from extracted line items and stored on `payslip_snapshot`. `TaxSufficiencyAlert` and `computeFederalRateYtd` prefer the stored values; fall back to runtime line-item scan for older snapshots.
  - Migration **0048**: adds `effective_federal_rate_ytd NUMERIC` and `effective_total_tax_rate_ytd NUMERIC` to `payslip_snapshot`.
  - Federal rate: sums `tax_deductions` line items matching the federal heuristic (name contains "federal", or `authority="Federal"` + name contains "withholding"/"income"), divides by `gross_pay_ytd`. Handles both Deloitte-style ("Federal Income Tax") and IBM-style ("TX Withholding Tax" with `authority="Federal"`).
  - Total tax rate: `employee_taxes_ytd / gross_pay_ytd` (aggregate column, not line-item sum).
  - No LLM prompt or JSON schema changes — pure service-layer arithmetic on already-extracted data.
- **Why:** Runtime heuristic in `TaxSufficiencyAlert` was brittle — IBM uses "TX Withholding Tax" with authority="Federal", not "federal" in the name. Moving computation to import time eliminates rendering-layer string matching and is format-agnostic via the `authority` field.
- **Files:** `backend/db/migrations/0048_ps5_tax_rate_columns.sql`, `backend/src/modules/payslip/payslip.service.ts` (type + `computeTaxRatesFromLineItems` helper + INSERT), `frontend/src/payslip/types.ts`, `frontend/src/payslip/savingsUtils.ts`, `backend/tests/app.test.ts` (3 new PS-5 tests)

---

## CR-206 (2026-05-22): Account closed/inactive status (F-5)

- **Type:** Feature (V4 backlog item F-5)
- **What:** Financial accounts can be marked **closed** without deleting history.
  - Migration **0047**: `financial_account.status` (`active` | `closed`) and `closed_at`.
  - **`GET /imports/accounts`**: active-only by default; `?includeClosedAccounts=true` returns closed rows with `status` and `closed_at`.
  - **`PATCH /imports/accounts/:id`**: optional `status` — closing sets `closed_at` (preserved on re-close); reopen clears `closed_at`.
  - Closed accounts excluded from import binding list and AI insight net-worth context; still on balance sheet API for historical snapshots.
  - **Settings → Accounts:** Close/Reopen actions, “Show closed accounts” toggle, Closed badge.
  - **Net Worth:** “Show closed” toggle, Closed badge on closed rows (UI filter only; API returns all).
- **Files:** `backend/db/migrations/0047_account_status.sql`, `import-file-binding.service.ts`, `imports.routes.ts`, `insight-prompt.service.ts`, `balance-sheet.service.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/NetWorthPage.tsx`, `docs/API_IMPORT_SESSIONS.md`, `openapi/openapi.yaml`, `docs/V4_PLAN.md`

---

## CR-205 (2026-05-22): Delete property (F-4)

- **Type:** Feature (V4 backlog item F-4)
- **What:** Owner/admin can now delete a property from the Net Worth page.
  - **`DELETE /household/properties/:propertyId`** — permanently removes the property and all its value snapshots (cascade). Any `financial_account` with `property_id` pointing to the deleted property is auto-unlinked via `ON DELETE SET NULL`; count returned in `unlinkedAccounts`.
  - **Frontend:** Trash icon added to each property row in the Real Estate section (Net Worth page). Confirmation dialog warns when a linked mortgage account will be unlinked.
- **Why:** No way existed to remove a property created by mistake or sold. Every other entity has a delete path; properties were stuck forever.
- **Files:**
  - `backend/src/modules/household/property.service.ts` — added `deleteProperty()`
  - `backend/src/modules/household/household.routes.ts` — added `DELETE /household/properties/:propertyId`; imported `deleteProperty`
  - `frontend/src/pages/NetWorthPage.tsx` — `IconTrash` import; `deletePropertyTarget` / `deletePropertyError` state; `doDeleteProperty` callback; trash icon in property row; ConfirmDialog with linked-mortgage warning
  - `backend/tests/app.test.ts` — 4 integration tests (delete success, snapshot cascade, mortgage unlink, 404)
  - `docs/API_HOUSEHOLD.md` — documented new endpoint

---

## CR-204 (2026-05-22): Transfer pair visibility + manual pair/unpair UI (TM-2)

- **Type:** Feature (V4 backlog item TM-2)
- **What:** Users can now see, manually create, and dissolve confirmed transfer pairs directly from the Transactions → All tab.
  - **`GET /transactions`** now returns `transferGroupId` (UUID or null) on every row.
  - **`GET /transactions?transferPaired=true`** filters to only paired rows.
  - **`POST /transactions/pair`** — body `{ ids: [uuid, uuid] }` — pairs two transactions: must be posted, different accounts, opposite directions (one debit / one credit), abs amounts within 0.01. Returns `{ transferGroupId }`.
  - **`DELETE /transactions/pair/:groupId`** — nulls `transfer_group_id` on all rows sharing that group; returns 204.
  - **Frontend:** "Has transfer pair" checkbox in the More Filters section (server-side filter). `↔` badge on paired rows in the Amount cell. Bulk bar: when exactly 2 rows are selected, "↔ Link as transfer" appears when amounts match and directions are opposite; "✕ Unlink transfer" appears when both share the same `transferGroupId`.
- **Why:** No way existed to see which transactions were paired as transfers, or to pair/unpair manually (e.g., check float > 4 days, missed by auto-detection). The Needs Review queue handles detection-based ambiguity; TM-2 adds general-purpose visibility and control. Resolution queue is untouched.
- **Files:**
  - `backend/src/modules/ledger/ledger.service.ts` — `transferGroupId` on `CanonicalTransactionRow`; `transferPaired` on `LedgerListFilters`; updated `txSelectSql`, `mapRow`, `ledgerFilterClause`; added `pairTransactions()`, `unpairTransactions()`
  - `backend/src/modules/ledger/ledger.routes.ts` — `transferPaired` in query schema; new `POST /pair`, `DELETE /pair/:groupId`
  - `frontend/src/ledger/ledgerListQuery.ts` — `transferPaired` in `appendLedgerListFilters`
  - `frontend/src/pages/TransactionsPage.tsx` — `transferGroupId` on `TxRow`; filter toggle; `↔` badge; bulk bar Link/Unlink buttons
  - `backend/tests/app.test.ts` — 6 integration tests

---

## CR-203 (2026-05-22): Cash account — auto-update balance snapshot on manual transaction (F-10)

- **Type:** Feature (V4 backlog item F-10)
- **What:** When a manual transaction is created, edited, or hard-deleted against a `type='cash'` financial account, the `account_balance_snapshot` table is now automatically updated. Delta model: create → `+amount`; hard delete → `−amount`; amount edit → `+newAmount − oldAmount`. If no prior snapshot exists, the starting balance is treated as 0. Non-cash accounts (checking, savings, etc.) are unaffected.
- **Why:** Cash accounts are tracked exclusively through manual entry. Without auto-update, users had to visit the Net Worth page after every transaction to keep the balance current.
- **Known limitation (deferred):** Backdated transactions read the *latest* snapshot as the base, then write the result to the *transaction's* date. This can produce a logically inverted snapshot (a past-dated row with a value derived from a future balance). User can correct via the Net Worth manual balance entry. Fixing this properly requires summing all manual transactions from scratch — deferred to a future pass.
- **Files:**
  - `backend/src/modules/reports/balance-sheet.service.ts` — added `computeAndUpsertCashBalanceIfApplicable()`
  - `backend/src/modules/ledger/ledger.service.ts` — added `updateManualTransactionAmount()`, updated `CreateManualTransactionResult` to carry `amount`
  - `backend/src/modules/ledger/ledger.routes.ts` — POST/PATCH/DELETE wired to cash balance helper; `amount` field added to PATCH schema
  - `backend/tests/app.test.ts` — 4 integration tests covering create, delete, amount-edit, and non-cash guard

---

## FIX-202 (2026-05-22): BoA eStatement — store both beginning and ending balance snapshots

- **Type:** Bug fix
- **What:** Import pipeline only stored the ending balance in `account_balance_snapshot` after parsing a BoA eStatement PDF. Beginning balance was extracted but silently discarded. Now both the beginning (`asOfStart`) and ending (`asOfEnd`) balance points are written as separate `source='import'` snapshots, giving the Net Worth page two data points per statement period.
- **Why:** BoA PDFs have both "Beginning balance on {date}" and "Ending balance on {date}" in their account summary. Only storing the ending balance meant no historical beginning balance was ever recorded.
- **Files:** `backend/src/modules/imports/import-parser.service.ts`, `backend/tests/boa-parser.test.ts`

---

## UX-201 (2026-05-22): PayslipsPage TrendCard — total tax rate YTD next to Net YTD

- **Type:** UX enhancement
- **What:** Added `totalTaxRateYtd` (all employee taxes ÷ gross, from the most recent payslip for the person) to the `TrendCard` component on the payslip list page. Displays inline next to the Net YTD dollar value in a smaller muted monospace label: `"26.2% tax"`. Shows `⚠` prefix in amber only when the rate is below 24% (≈ below-average federal threshold adjusted for FICA — roughly < 16% federal + 7.65% SS+Medicare). No green tick for healthy cases — the list stays quiet when things are fine. Tooltip on hover explains the metric.
- **Why:** Surfaces a key health signal (are you withholding enough?) at the list level without requiring the user to open each detail page.
- **Files:** `frontend/src/pages/PayslipsPage.tsx`

---

## FIX-200 (2026-05-22): BoA PDF parser — balance date regex misses spelled-out month format

- **Type:** Bug fix
- **What:** `extractBoaEStatementBalancesFromText` in `boa-estatement-pdf.ts` used a regex that only matched dates in `MM/DD/YYYY` format. Real BoA eStatements use `"April 21, 2026"` (spelled-out month). Result: `statementBalances` was always `null` for BoA PDFs → ending balance never written to `account_balance_snapshot` → users had to manually update balances after every import.
- **Fix:** Replaced the single date-format regex with a combined pattern matching both `MM/DD/YYYY` and `"Month DD, YYYY"` (full and abbreviated month names). Added `parseDateToIso()` helper that handles both formats, replacing `mmddyyyyToIsoFlexible()`. The rest of the pipeline (writing the ending balance to `account_balance_snapshot` via `upsertImportBalanceSnapshotFromStatement`) was already correct — only the regex was broken.
- **Why:** The balance snapshot write path in `import-parser.service.ts` was wired and working; `statementBalances` was just never populated due to the date mismatch.
- **Files:** `backend/src/modules/imports/profiles/boa-estatement-pdf.ts`

## UX-200 (2026-05-22): TaxSufficiencyAlert — revert to compact banner (spec-correct)

- **Type:** UX correction
- **What:** The redesigned `TaxSufficiencyAlert` (UX-199) used a large card with stat blocks that made it the visual centrepiece of the payslip detail page. The spec prototype shows a compact single-line amber banner (same visual weight as `SavingsRateBanner`). Reverted to a compact inline banner: icon + bold `"Federal X.X% YTD · current period"` + `"all taxes Y.Y%"` secondary + tier hint sentence. Coloured background per tier (amber for under-withheld/below-average, forest-subtle for on-track, info-subtle for over-withheld).
- **Why:** Visual hierarchy was wrong — the tax signal should be a quiet informational note, not the dominant element on the page.
- **Files:** `frontend/src/payslip/TaxSufficiencyAlert.tsx`

---

## UX-199 (2026-05-21): PayslipDetailPage — PS-4 redesign, bold total rows, column alignment, breadcrumb link + seed payslips

- **Type:** UX redesign + feature + dev tooling
- **What:**
  - **PS-4 TaxSufficiencyAlert complete redesign:** Dropped annualisation entirely. Now uses direct YTD percentages: `fedTaxYtd / grossPayYtd` and `employeeTaxesYtd / grossPayYtd`. Always renders when data is available (was: conditional on < 20%). New tiered badge: < 10% = Under-withheld (amber), 10–16% = Below average (amber), 16–28% = On track (green), > 28% = Over-withheld (blue). Shows both Federal and All-employee tax rates (current + YTD) in monospace. Commentary explains what to do.
  - **`savingsUtils.ts` refactored:** Removed `TAX_BENCHMARK_PCT`, `computeFederalRateAnnualised`, `isTaxRateLow`. Added `computeFederalRateYtd`, `computeFederalRateCurrent`, `computeTotalTaxRateYtd`, `computeTotalTaxRateCurrent`.
  - **Bold section total rows:** Added `LITotalRow` component (bold, `borderTop: 1px solid border`). Renders "Gross Pay" after earnings, "Total pre-tax" after pre-tax deductions, "Total taxes" after tax deductions, "Total post-tax" after post-tax deductions. Net Pay at bottom unchanged (heavier `2px` border).
  - **Column alignment fix:** `SectionHdr` "Current"/"YTD" headers now include a 52 px placeholder div at the end to align with data rows (which have pencil/trash icon gutter). `minWidth` on all amount columns bumped 72 → 80 for clearer number boundaries.
  - **Breadcrumb person link:** Person name in `Payslips › Owner › period` breadcrumb is now a clickable `<Anchor>` linking to `/payslips?ownerPersonProfileId=<id>` when the payslip is person-scoped.
  - **`PayslipsPage.tsx`:** Added `useSearchParams` lazy init — reads `ownerPersonProfileId` from URL on mount and pre-selects the person filter pill.
  - **YTD sidebar:** Net row value uses `var(--fs-forest)` (green). Each row has a bottom border. Header shows `{year} YTD · {firstName}`.
  - **Dev seed `dev_0007_seed_payslips.sql`:** 6 bi-weekly IBM payslips for Alex Owner (Texas, 18.5% federal = on track) + 3 monthly Deloitte payslips for Sam Spouse (California, 16% federal = below average, CA state tax rows). All payslips `owner_scope = 'person'` + `owner_person_profile_id`. Detailed line items on the two most recent payslips per person.
- **Why:** Annualisation was wrong for real-world data (users have 24 or 26 pay periods, not always 26). Drop it in favour of direct YTD ratios which need no pay-period count. Column header misalignment and missing bold totals were spec regressions. Seed data needed to exercise person filters.
- **Files:** `frontend/src/payslip/savingsUtils.ts`, `frontend/src/payslip/TaxSufficiencyAlert.tsx`, `frontend/src/pages/PayslipDetailPage.tsx`, `frontend/src/pages/PayslipsPage.tsx`, `backend/db/seeds/dev/dev_0007_seed_payslips.sql`

---

## UX-198 (2026-05-21): PayslipDetailPage — spec-correct line item layout + PS-4 fix + remove invented section

- **Type:** UX fix + bug fix
- **What:**
  - **Line item layout regression fixed:** Replaced all `<Table withTableBorder striped highlightOnHover>` wrappers in the line items panel with spec-correct compact div-based rows (flex layout: name left, Current/YTD right-aligned, pencil/trash icons). Matches `LIRow` in `docs/payslip-redesign/shared.jsx`. Edit mode expands to an inline `<Paper>` form with labelled inputs; delete mode shows inline confirmation — no table context required.
  - **"Correct pay amounts" section removed:** The section was invented and not in the redesign spec. Removed the Paper block and all supporting code (`SummaryAmountRow`, `AmountRowDef`, `PatchableAmountField`, `AMOUNT_ROWS`, `SummaryEditState`, `patchSummary`, `handleSaveSummaryRow`, related state variables). Line item pencil/trash icons provide the spec-correct correction path.
  - **PS-4 TaxSufficiencyAlert fix:** `federalRate` was computed as `computeFederalRateAnnualised(detail, detail.payPeriodCountYtd ?? 1)`. The `?? 1` fallback inflated the annualised rate 26× when `payPeriodCountYtd` was absent, keeping the alert permanently suppressed. Changed to only call `computeFederalRateAnnualised` when `payPeriodCountYtd != null`; otherwise `federalRate` stays `null` (no alert, correct).
- **Why:** UI regression from prior session where LineItemRow was Table.Tr-based; spec uses compact flex rows. "Correct pay amounts" Paper was not in spec and confused users. PS-4 alert was silently broken by an aggressive numeric fallback.
- **Files:** `frontend/src/pages/PayslipDetailPage.tsx`

---

## CR-197 (2026-05-21): F-3 frontend — payslip pages full redesign (PS-1 through PS-4)

- **Type:** Feature (F-3 V4 plan — full payslip UI overhaul)
- **What:**
  - **New utility/component files** (all in `frontend/src/payslip/`):
    - `deltaUtils.ts` — `computeDelta()` + `DeltaBadge` colored pill (↑↓ + abs + pct)
    - `contributions.ts` — `groupContributions()` with regex name-pattern matching for 401k/HSA/ESPP/pension buckets
    - `savingsUtils.ts` — savings rate, YTD rate, annualised federal rate, tax sufficiency threshold
    - `SparklineMini.tsx` — SVG polyline + area + animated draw; skips animation under `prefers-reduced-motion`
    - `PayslipListCard.tsx` — per-payslip row with avatar, period dates, Gross/Net/Taxes + DeltaBadge
    - `ContribBucket.tsx` — collapsible accordion for grouped contribution line items
    - `KpiStrip.tsx` — 4-column KPI grid with forest-green accent on Net Pay
    - `SavingsRateBanner.tsx` — green banner showing savings rate this period + YTD (PS-3)
    - `TaxSufficiencyAlert.tsx` — amber alert when annualised federal rate < 20% (PS-4)
  - **`PayslipsPage.tsx`** — complete rewrite: person filter pills, TrendCard per person with SparklineMini, month-grouped list using PayslipListCard, collapsible "Income analytics" section, client-side person filtering (loads all 200)
  - **`PayslipDetailPage.tsx`** — complete rewrite of layout, all CRUD logic preserved: KpiStrip + SavingsRateBanner + TaxSufficiencyAlert above 2-column body (line items left, YTD sidebar right); edit mode via `<Collapse>` panel; contributions grouped with ContribBucket; sparkline from person's payslip list secondary fetch
  - **`AddPayslipPage.tsx`** — new add form replacing `PayslipManualPage`: 1fr 270px grid, 5 editable line tables (Earnings/Tax/Pre-Tax/Post-Tax/Other), live sidebar with balance check badge; routes `/payslips/new`
  - `App.tsx` updated to route `/payslips/new` → `AddPayslipPage`; `PayslipManualPage.tsx` deleted
- **Why:** F-3 V4 — full payslip UX overhaul per `docs/payslip-redesign/` spec. Features: PS-1 delta badges, PS-2 contribution grouping, PS-3 savings rate banner, PS-4 tax sufficiency signal. Edit capability preserved (Deloitte extraction is unreliable).
- **Files:** `frontend/src/payslip/` (9 new files), `frontend/src/pages/PayslipsPage.tsx`, `frontend/src/pages/PayslipDetailPage.tsx`, `frontend/src/pages/AddPayslipPage.tsx`, `frontend/src/App.tsx`, deleted `frontend/src/pages/PayslipManualPage.tsx`

---

## CR-196 (2026-05-21): F-3 AddPayslipPage — post-tax deductions section added

- **Type:** Feature (gap vs. spec)
- **What:** `AddPayslipPage` includes a fifth editable line-item table for **Post-Tax Deductions** (section `post_tax_deductions`), and `PayslipDetailPage` renders post-tax deductions in both view mode and edit mode. The original redesign spec omitted this section.
- **Why:** User identified the omission — post-tax deductions (e.g. Roth after-tax, garnishments) exist in the data model and must be editable since LLM extraction can hallucinate or miss them.
- **Files:** `frontend/src/pages/AddPayslipPage.tsx`, `frontend/src/pages/PayslipDetailPage.tsx`

---

## CR-195 (2026-05-21): F-3 backend — prior-period window function + payPeriodCountYtd

- **Type:** Feature (PS-1 / PS-4 backend prerequisite)
- **What:**
  - `listPayslipSnapshots()` now uses a CTE with `LAG()` window function (partitioned by `owner_person_profile_id`, ordered by `COALESCE(pay_period_end, pay_date, created_at::text) ASC`) to attach `prior: { grossPayCurrent, netPayCurrent, employeeTaxesCurrent, preTaxDeductionsCurrent }` to each list item. `prior` is `null` for a person's first payslip.
  - `getPayslipSnapshotForHousehold()` adds a COUNT subquery returning `payPeriodCountYtd` — number of payslips in the same calendar year for the same person. Used by the frontend to annualise the federal withholding rate (PS-4).
  - `PayslipSnapshotRow` backend type and `PayslipSnapshotDetail` frontend type both extended. New `PriorPayslipValues` type exported from `types.ts`.
- **Why:** F-3 payslip redesign requires delta badges (PS-1) on the list page and tax sufficiency signal (PS-4) on the detail page. Both need prior-period data not previously returned by the API.
- **Files:** `backend/src/modules/payslip/payslip.service.ts`, `frontend/src/payslip/types.ts`, `openapi/openapi.yaml`

---

## FIX-193 (2026-05-20): TM-4 near-duplicate detection: drop description gate (TM-4)

- **Type:** Bug fix
- **What:** Near-duplicate detection now flags **any** rows with same `account_id` + `txn_date` + amount (±0.0001 tolerance) but different fingerprint as a `duplicate_ambiguity` resolution item, **regardless of description similarity**. Removed the `descriptionsCompatibleForNearDuplicate()` gate that was allowing masked ACH descriptions (from CSV: "XXXXX1234") to slip past when they differed from PDFs with real digits ("ACH123451234").
- **Why:** TM-4 — Bank descriptions from different sources (CSV vs PDF) can differ while representing the same transaction. The gate was too conservative; same account/date/amount is sufficient to flag duplicates. False positives (two unrelated same-day same-amount charges) land in the resolution queue, not silently duplicated or deleted. Transfer matching is unaffected (cross-account only).
- **Files:** `backend/src/modules/canonical/transaction-fingerprint.ts` (removed function), `backend/src/modules/canonical/canonical-ingest.service.ts` (removed description gates at lines ~705 and ~728)

---

## UX-118 (2026-05-20): Display name field on recurring payments tag modal

- **Type:** UX
- **What:** **RecurringTagModal** now includes a **Display name** field; saved value is sent as `displayName` on confirm (blank clears to merchant-key default on the server).
- **Why:** Backend and dashboard/settings already support `display_name`; the modal was the only missing edit surface.
- **Files:** `frontend/src/components/RecurringTagModal.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/SettingsPage.tsx`

---

## CR-194 (2026-05-20): Net Worth snapshot + per-account row-expansion caching (F-6b)

- **Type:** Performance (F-6b, V4 plan)
- **What:** Extended the `localStorage` caching layer to the two remaining expensive Net Worth queries that F-6 left uncached. (1) **Balance-sheet snapshot** (`GET /reports/balance-sheet`) — now served from cache on all subsequent loads with a 1-hour TTL; re-fetches when `tableAsOf` or `belongsTo` filter changes. (2) **Per-account row-expansion history** (`GET /reports/balance-sheet/history?accountIds=…`) — first expand triggers a fetch and writes to cache under key `bs-acct-history:{accountId}:{from}:{to}`; subsequent expands (and re-mounts) read from cache with a 7-day TTL. Both use the existing `networth` scope so the refresh icon already on the page busts all keys together.
- **Why:** F-6b — these were the two hot paths not covered by F-6: the snapshot fires on every page load + every filter change; the per-account history fires once per expanded row (10–20 calls if all rows open).
- **Files:** `frontend/src/pages/NetWorthPage.tsx`

---

## UX-117 (2026-05-19): "Other" slice link on WHERE MONEY WENT card (I-12)

- **Type:** UX (I-12, V4 plan)
- **What:** The **Other** spending slice on the dashboard WHERE MONEY WENT card is now a link to Transactions, filtered to all constituent categories (beyond the top 5) and the active month date window.
- **Why:** I-12 — Other was the only unclickable slice; spending in Other was a dead end.
- **Files:** `frontend/src/pages/DashboardPageV2.tsx`

---

## CR-193 (2026-05-19): Balance sheet member subtotals + Household Breakdown card (F-2)

- **Type:** Feature (F-2, V4 plan)
- **What:** `GET /reports/balance-sheet` now includes **`memberSummary[]`** — per-person asset, liability, and net-worth totals when the household has ≥ 2 person profiles (empty array otherwise). Net Worth page shows a **Household Breakdown** table beside the liquidity card (side-by-side on tablet/desktop).
- **Why:** F-2 — compare all household members at once without switching the belongs-to filter.
- **Files:** `backend/src/modules/reports/balance-sheet.service.ts`, `frontend/src/pages/NetWorthPage.tsx`, `docs/API_BALANCE_SHEET.md`, `openapi/openapi.yaml`, `docs/V4_PLAN.md`, `backend/tests/app.test.ts`

---

## CR-192 (2026-05-19): Client-side localStorage caching for Dashboard + Net Worth (F-6)

- **Type:** Performance / UX (F-6, V4 plan)
- **What:** Introduced `localStorage`-based caching for the two most expensive report endpoints (`GET /reports/cash-summary` — ~30–40 table scans; `GET /reports/balance-sheet/history` — up to 180 sequential queries). Subsequent page loads and tab opens serve cached data immediately with no network request. Cache is invalidated automatically by a URL-pattern interceptor in `apiJson()` that bumps a per-scope version counter whenever any relevant write endpoint succeeds. Two scopes: `dashboard` (staled by imports + ledger mutations) and `networth` (staled by balance-sheet/manual + property value writes). TTL safety net: 7 days. Logout clears all `hfa:*` localStorage keys.
- **New files:**
  - `frontend/src/cache.ts` — version counters, `CACHE_INVALIDATION_MAP`, read/write helpers, `invalidateCacheByUrl()`, `clearAllCaches()`
  - `frontend/src/hooks/useLocalStorageCache.ts` — `useLocalStorageCache<T>()` hook; serves cache on mount, listens for `hfa:cache-invalidate` custom events for same-page invalidation, exposes `refresh()` that bumps scope version and force-refetches
  - `docs/CACHING.md` — full architecture doc: scope map, invalidation table, hook API, storage impact, what is and isn't cached
- **Modified files:**
  - `frontend/src/api.ts` — added `invalidateCacheByUrl()` call after every successful non-GET in `apiJson()`; added `clearAllCaches()` call in `setToken(null)` (logout)
  - `frontend/src/pages/DashboardPageV2.tsx` — `GET /reports/cash-summary` now goes through `useLocalStorageCache`; refresh icon added (top-right of inflow/outflow KPI card)
  - `frontend/src/pages/NetWorthPage.tsx` — `GET /reports/balance-sheet/history` now goes through `useLocalStorageCache`; refresh icon added; `refresh()` called after balance/property write completes
  - `docs/API_CASH_SUMMARY.md`, `docs/API_BALANCE_SHEET.md` — caching notes added
  - `openapi/openapi.yaml` — `x-cache-scope` on cached GET endpoints; `x-cache-invalidates` on all write endpoints that affect a scope

---

## FIX-192 (2026-05-19): Transfer date tolerance bumped from 2 → 4 days (TM-1)

- **Type:** Bug fix (TM-1, V4 plan)
- **What:** Bank-to-bank ACH transfers routinely settle in 3 business days, causing confirmed transfer pairs to miss the ±2-day auto-pairing window and land in the unmatched resolution queue. Widened the tolerance to ±4 calendar days (3 business days). The pair score threshold (45) and same-account exclusion both still apply, so false-positive risk is unchanged — the scorer does not consider date proximity; only amount and account differ.
- **Fix:** Changed `<= 2` to `<= 4` in the debit→credit and credit→debit filter passes; updated `closeDateToleranceDays` telemetry in all three ambiguity reason JSON blobs.
- **Test:** New integration test `"pairs transfer across a 3-day ACH settlement gap (TM-1)"` in `app.test.ts` — debit on 2000-01-10, credit on 2000-01-13, verifies `transfer_group_id` is set on both rows.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts` (lines 922, 1004, 964/1050/1113), `backend/tests/app.test.ts`

---

## UX-116 (2026-05-18): BY ACCOUNT card — add YoY delta arrow alongside MoM arrow (R-2)

- **Type:** UX enhancement (R-2, V4 plan)
- **What:** Each account row in the "By Account — This Month" card now shows **two arrows side by side**: the existing MoM arrow (vs prior month) and a new YoY arrow (vs same month last year). Both are bare arrow symbols (↑↓→) — no year label. Meaning is conveyed via Mantine `Tooltip`: hover shows "vs April 2026" and "vs May 2025" respectively. Card heading also has a tooltip: "First arrow = vs last month · second arrow = vs same month last year". The count < 3 guard and ±5% threshold apply to both; same colour semantics apply (liabilities: ↑ terracotta, ↓ forest; assets: ↑ gold, ↓ forest).
- **Implementation:** Added a separate `GET /transactions` fetch (8th in `Promise.allSettled`) for the prior-year month. `priorYearMap` useMemo builds a `Map<accountId, {outflow, count}>` from those transactions. `yoyArrow()` function mirrors `accountArrow()`. Recharts `Tooltip` aliased to `RechartsTooltip` to avoid naming conflict with Mantine `Tooltip`. No backend changes.
- **Dev seed:** `dev_0006_seed_rolling_ledger.sql` — 72 transactions across 3 accounts (BoA Checking, BoA CC, Citi CC) using `CURRENT_DATE`-relative dates (M0–M5 + M-12) so the seed stays fresh in any month after `db:reset:dev`. Designed to show all three arrow-color paths: BoA Checking ↑gold/↑gold, BoA CC ↑terra/↓forest, Citi CC ↓forest/↑terra.
- **Files:** `frontend/src/pages/DashboardPageV2.tsx`, `backend/db/seeds/dev/dev_0006_seed_rolling_ledger.sql`

---

## UX-115 (2026-05-18): BY ACCOUNT card — account filter, top-3 cap, empty state (F-8)

- **Type:** UX redesign (F-8, V4 plan)
- **What:** Redesigned the "By Account — This Month" dashboard card:
  - **Account types filtered** to `credit_card`, `checking`, `savings` only. Loans (steady decrease, no monthly signal), investment, retirement, and property excluded. Filter applied inside `computeAccountBuckets` via `ACCOUNT_CARD_TYPES`.
  - **Row cap:** top 3 credit cards + top 3 checking/savings = max 6 rows, sorted by `thisMonthOutflow` descending within each group.
  - **Metric stays as transaction outflow** — genuinely "this month" data that fits the month-navigation UX. Outflow is accurate when OFX statements are imported (the primary data entry path).
  - **Empty state:** card always renders once transactions load; shows "No spending recorded this month for linked accounts." when no matching outflow exists, instead of hiding the card entirely.
  - **Arrow colors corrected:** checking/savings ↑ = gold (cautionary), ↓ = forest. Previously checking was incorrectly in `LIABILITY_ACCOUNT_TYPES` causing terracotta ↑ (fixed by R-3/UX-114); this pass corrects the broader asset vs liability colour logic.
- **Files:** `frontend/src/pages/DashboardPageV2.tsx`

---

## UX-114 (2026-05-18): Fix checking account arrow color in BY ACCOUNT card (R-3)

- **Type:** Bug fix / UX (R-3, V4 plan)
- **What:** `LIABILITY_ACCOUNT_TYPES` incorrectly included `"checking"`, causing the BY ACCOUNT dashboard card to show a red ↑ arrow when checking outflow increased month-over-month — the same signal used for a rising credit card balance. Checking is a liquid asset, not a liability; its ↑ should be gold (cautionary/neutral), not terracotta (bad).
- **Fix:** Removed `"checking"` from the set. Correct list: `new Set(["credit_card", "loan"])`.
- **Files:** `frontend/src/pages/DashboardPageV2.tsx` (line 175)

---

## SEC-003 (2026-05-17): Force password change for all users after household restore

- **Type:** Security hardening (R-1, V4 plan)
- **What:** After a household bundle restore completes, all `app_user` rows for the household are flagged `force_password_change = true` inside the same transaction. Previously, restored users could log in immediately with whatever password was in the backup — potentially stale or compromised credentials.
- **Fix:** Added a `txExec` UPDATE at the end of the restore transaction in `import-household-bundle.service.ts`. Runs atomically with the data restore; if the transaction rolls back, the flag is not set. The existing `auth.service.ts` login flow already enforces the flag (redirects to password-change flow), so no UI or middleware changes needed.
- **Files:** `backend/src/modules/export/import-household-bundle.service.ts`

---

## FIX-193 (2026-05-16): Export registry missing `property`, `property_value_snapshot`, `payslip_deposit_match`

- **Type:** Bug fix (backup coverage — three V3 tables omitted from .hfb exports)
- **What:** Three tables added in V3 migrations were never registered in `EXPORT_REGISTRY`, so they were silently excluded from every household `.hfb` backup. Koyeb logs surfaced the warning on startup via the export coverage check. Affected user data:
  - `property` — property address, Redfin IDs, valuation metadata (migration 0041)
  - `property_value_snapshot` — full market-value time series per property (migration 0041)
  - `payslip_deposit_match` — confirmed payslip ↔ deposit canonical links (migration 0045)
- **Fix:** Added all three entries to `EXPORT_REGISTRY` with correct `restoreOrder` to satisfy FK constraints:
  - `property` at order 4 (before `financial_account` at 5, which holds `property_id → property ON DELETE SET NULL`)
  - `property_value_snapshot` at order 6 (after `property`)
  - `payslip_deposit_match` at order 16 (after both `payslip_snapshot` at 14 and `transaction_canonical` at 12)
  - All subsequent entries renumbered (5→5 was financial_account, everything ≥5 shifted by 1–3)
  - `property` and `property_value_snapshot`: `memberScopeInclude: false` (household-level, not per-person)
  - `payslip_deposit_match`: `memberScopeInclude: true` scoped via `payslip_snapshot.owner_person_profile_id`
- **Files:** `backend/src/modules/export/export-registry.ts`

---

## UX-192 (2026-05-15): Grove branding loader — replace Mantine Skeleton in hero card and Net Worth page

- **Type:** UX polish — loading state consistency
- **What:** Replaced Mantine `<Skeleton>` (solid gray animated rectangle) with the custom `<GroveCardLoader>` component in all remaining locations that had not yet been migrated:
  - `DashboardPageV2.tsx` — hero cash flow card (inflow/outflow section)
  - `NetWorthPage.tsx` — main net worth trend chart (340 px height preserved via wrapper Box), balance sheet table skeleton, individual account history expand rows, individual property history expand rows
- **Why:** Net Worth categories, budget, and top-categories cards already use GroveCardLoader. The hero card and trend chart were the visible exceptions. Skeleton imports removed from both files.
- **V4 backlog (I-11):** PWA mode (Chrome installed app) hangs on any function that programmatically triggers `<input type="file">.click()`. Affects Import, Backup/Restore, and Category Rules CSV import. Fix requires PWA display-mode detection + File System Access API fallback or a user-facing warning. Added as P3 in V4 plan.
- **Files:** `frontend/src/pages/DashboardPageV2.tsx`, `frontend/src/pages/NetWorthPage.tsx`

---

## FIX-191 (2026-05-15): Property create 503 — CASE WHEN untyped param + no try-catch on async handler

- **Type:** Bug fix (production — property valuation create path)
- **What:**
  - **Root cause:** `POST /household/properties` handler had no try-catch. When `apiPropertyId` was present, the UPDATE ran `CASE WHEN ? IS NOT NULL THEN NOW() ELSE valuation_fetched_at END` — PostgreSQL cannot resolve the type of an untyped parameter (`$4`) in a `CASE WHEN … IS NOT NULL` predicate position when using the extended query protocol with OID 0. The Postgres error propagated as an unhandled async exception in Express 4.x → Node 20 treated the unhandled rejection as fatal → process crash → Koyeb returned 503. The INSERT had already committed so the property row was persisted without api details.
  - **Fix (backend):** Replaced the `CASE WHEN` with `valuation_fetched_at = NOW()` directly (we always want to stamp fetched_at when storing Redfin data). Removed the duplicate `detailJson` parameter. Wrapped the create/link block in try-catch to return 500 instead of crashing the process.
  - **Fix (backend):** Added `PROPERTY_ALREADY_LINKED` 409 guard — before creating a new property, `POST /properties` now checks whether the linked `accountId` already has a `property_id` set. Returns 409 with a human-readable message if so. Prevents orphan property rows when the user somehow opens the create modal on an already-linked account.
- **Why it only appeared with Redfin retrieval:** The `if (parsed.data.apiPropertyId)` block only runs when the frontend passes the Redfin IDs (i.e., after clicking "Retrieve Redfin estimate"). Without Redfin data, the entire UPDATE is skipped, so the crash path was never hit.
- **Logging improvements (same commit):** `realty-api.service.ts` — `realtyGet` now logs endpoint + status before throwing on HTTP error; `parseRedfinResponse` logs structured warn at each early-return path (missing `details`, invalid `predictedValue`, missing `propertyId`) so API response shape changes are visible in Koyeb logs without reading source; `parseComps` logs malformed comp entries instead of silently swallowing them. V4 backlog item I-10 added for a full app-wide logging audit.
- **Files:**
  - `backend/src/modules/household/household.routes.ts` (fix UPDATE, add try-catch, add 409 guard, add `log` import)
  - `backend/src/modules/household/realty-api.service.ts` (error/warn logging in `realtyGet`, `parseRedfinResponse`, `parseComps`)

---

## UX-190 (2026-05-15): Home page hero redesign — animated preview cards

- **Type:** UX / design
- **Files:** `frontend/src/pages/HomePage.tsx`, `frontend/src/index.css`, `frontend/index.html`
- **What changed:** Replaced the static bullet-list + feature-pill hero with two animated preview cards (Net Worth card with SVG line chart that draws itself, Budget ring card with arc fill animation) and three staggered transaction rows. Added JetBrains Mono to the font stack for monospaced values. Hero panel widened to 60%; aside is 40% (flex split replacing the old 1.1fr/0.9fr grid).
- **Removed:** `.home-landing__lead`, `.home-landing__bullets`, `.home-landing__check`, `.home-landing__pills`, `.home-landing__pill` CSS classes; `featurePills` constant in TSX.
- **Added:** `.home-landing__sub`, all `hl-*` CSS classes + `@keyframes hl-*` animations; `nwValueRef` counter effect.
- **Auth card:** untouched — all Mantine components, handlers, reset-success banner, forgot-password flow unchanged.

---

## CR-189 (2026-05-15): D-2 — Property valuation UX polish

- **Type:** UX fix (D-2 follow-on)
- **What:**
  - **Settings modal button gate**: "Retrieve/Update Redfin estimate" button now requires all four address fields (street, city, state, zip) before enabling — prevents partial-address API calls.
  - **Settings modal label logic**: Button reads "Update Redfin estimate" when the property already has a market value set (regardless of `apiPropertyId`); "Retrieve Redfin estimate" on first-time lookup only.
  - **valuation_detail_json stored on create**: `POST /household/properties` now accepts `valuationDetailJson` in body and writes it (plus `valuation_fetched_at`) immediately on property creation. Previously only the Redfin IDs were saved; the full detail JSON was lost. Frontend passes `detail` from the preview response through on save.
  - **Net Worth refresh button**: Replaced "Redfin" text button with a compact refresh icon (`IconRefresh`) + native `title` tooltip "Refresh market value from Redfin". Cleaner inline edit row.
- **Files:**
  - `backend/src/modules/household/household.routes.ts` (+valuationDetailJson field, updated UPDATE to write detail + fetched_at)
  - `frontend/src/pages/SettingsPage.tsx` (valuationDetail in modal state, correct gate/label logic, pass detail on save)
  - `frontend/src/pages/NetWorthPage.tsx` (IconRefresh + title tooltip replaces text button)

---

## CR-188 (2026-05-15): D-2 — Redfin comps parser fix + property valuation UI (Settings + Net Worth)

- **Type:** Bug fix + UI feature (D-2 follow-on)
- **What:**
  - **Comps parser corrected** (`realty-api.service.ts`): Live `/detailsbyaddress` responses have 8 top-level `__atts` entries (not 10+). Corrected all positional offsets confirmed against live API data: facts at `[7]` (was `[9]`), sash date at `sashAtts[3]` (was `[2]`), list price at `listingArr[21]` (was `[23]`), beds/baths from `listingArr[26/27]` (more reliable than facts array), sqft at `facts[22]` (was `[21]`). Debug log removed.
  - **Settings → Property modal** (`SettingsPage.tsx`): "Retrieve Redfin estimate" / "Update Redfin estimate" button below the market value field. Calls `POST /household/properties/preview-valuation`; auto-fills market value from AVM estimate and resets as-of date to today. Redfin property/listing IDs stored in modal state and passed through on save to `POST /household/properties`. Button disabled when address fields are empty.
  - **Net Worth page inline edit** (`NetWorthPage.tsx`): "Redfin" button in the edit row. Calls `POST /household/properties/:id/refresh-valuation`; auto-fills the market value and date inputs with the returned estimate + fetchedAt. Save/Cancel disabled while retrieving.
- **Why:** The comps bug caused all `comps: []` in API responses. UI surfaces complete the end-to-end D-2 workflow — users can now retrieve Redfin AVM without leaving either the Settings or Net Worth page.
- **Files:**
  - `backend/src/modules/household/realty-api.service.ts` (comps parser positions corrected, debug log removed)
  - `frontend/src/pages/SettingsPage.tsx` (+retrieveValuation, apiPropertyId/apiListingId in modal state, Retrieve button)
  - `frontend/src/pages/NetWorthPage.tsx` (+refreshPropertyValuation, propertyRowRetrieving state, Redfin button in edit row)

---

## CR-187 (2026-05-14): D-2 — Real estate auto-valuation (Redfin via RealtyAPI)

- **Type:** Feature (D-2 — pulled forward from deferred)
- **What:**
  - **`POST /properties/preview-valuation`** — pre-save address lookup via Redfin (2 API credits). Returns estimate, Redfin propertyId/listingId, and compact `ValuationDetail` JSON. Client passes IDs back on save to avoid a second API call.
  - **`POST /properties/:propertyId/refresh-valuation`** — on-demand or scheduler-triggered refresh for an existing property. Uses stored Redfin IDs (1 credit) when available; falls back to address lookup (2 credits) if IDs not yet stored.
  - **Monthly background scheduler** (`realty-scheduler.service.ts`) — 6h heartbeat, refreshes any `property` row with `api_property_id` set that hasn't been fetched in 28 days.
  - **`ValuationDetail` JSON** stored in `property.valuation_detail_json` (JSONB). Contains: Redfin AVM estimate + range, last-sold event (price hidden in TX non-disclosure), current + historical tax assessments from public records, up to 6 comparable recent sales with address/sqft/beds/baths/list price/close price/sold date. Rebuilt on every refresh — overwrites previous.
  - **Schema migration `0046`**: `api_listing_id TEXT`, `valuation_detail_json JSONB`, `valuation_fetched_at TIMESTAMPTZ` added to `property` table.
  - **`POST /properties` schema updated**: `apiPropertyId` + `apiListingId` optional fields (passed through from preview); `zip` validated to 5-digit US format; `state` validated to 2-char; `addressLine1` enforces min length 1.
  - **`REALTYAPI_KEY`** added to `env.ts` and `.env.example`.
- **Why:** Property value on net worth page was a static manual entry. API auto-refresh keeps equity display accurate. The `ValuationDetail` JSON also captures comparable sale data + county tax assessment history for future property tax protest use.
- **API provider:** Redfin via RealtyAPI.io (free tier: 250 req/month). Both Zillow and Redfin endpoints on RealtyAPI proxy Redfin data. Redfin chosen as primary: has AVM, comp sales with close prices, and authoritative tax-from-public-records data.
- **Non-disclosure states (TX):** Last sold price is hidden (`isPriceAdminOnly`); comp prices are fully visible as they come from separate listings.
- **Files:**
  - `backend/db/migrations/0046_d2_realty_valuation.sql` (new)
  - `backend/src/config/env.ts` (+REALTY_API_KEY)
  - `backend/src/modules/household/realty-api.service.ts` (new)
  - `backend/src/modules/household/realty-scheduler.service.ts` (new)
  - `backend/src/modules/household/property.service.ts` (+refreshPropertyValuation, +previewValuationByAddress, extended types)
  - `backend/src/modules/household/household.routes.ts` (+2 routes, updated POST /properties schema)
  - `backend/src/server.ts` (+startRealtyScheduler)
  - `.env.example` (+REALTY_API_KEY)

---

## CR-186 (2026-05-14): I-1 — AI insights: Loans > Personal prompt clarification

- **Type:** Prompt update (P3 / I-1)
- **What:** Updated AI insights system prompt (`buildSystemPrompt` in `llm-provider.service.ts`) to explain that `Loans > Personal` subcategory transactions are informal cash lending to friends/family — not a bank loan or discretionary overspend. The outgoing and incoming sides net to zero over time and should be treated as a temporary receivable, not a spending spike.
- **Why:** Without this context the LLM misreads a lend/repay cycle as a spending surge followed by an income bump. The loan event tracker (original I-1 proposal) was scoped down — category-based tracking is sufficient; the prompt fix closes the AI interpretation gap.
- **Prompt version:** bumped `PROMPT_VERSION` from `v1.1` → `v1.2` (ensures cached insight rows are regenerated on next request).
- **Files:** `backend/src/modules/insights/llm-provider.service.ts`

---

## CR-185 (2026-05-14): F-5 — Payslip deposit matching: stored pairing + multi-transaction support

- **Type:** Feature (P2 / CR-185)
- **What:**
  - New **`payslip_deposit_match`** join table stores confirmed deposit links (1-to-N per payslip).
  - **`GET /payslips/:id`** returns **`confirmedDeposits`** (join table) and **`suggestedDeposits`** (dynamic search, only populated when `confirmedDeposits` is empty). The old **`matchedDeposits`** field is removed.
  - **`PUT /payslips/:id/deposits/:canonicalId`** — add a confirmed link (idempotent).
  - **`DELETE /payslips/:id/deposits/:canonicalId`** — remove one confirmed link.
  - Dynamic search window expanded from ±3 to **±7** calendar days; **`pay_period_end`** fallback added (**±10** days); **`tc.status = 'posted'`** filter added.
  - **`MatchedDeposit`** carries **`dateDelta`** and **`amountDelta`** confidence fields.
  - **UI:** confirmed deposits with **Remove**; suggestions with **Confirm**; **Search ledger…** modal for manual linking (multi-link via repeated **Link**). Split deposit across multiple transactions supported.
- **Files:** `backend/db/migrations/0045_f5_payslip_deposit_match.sql`, `backend/src/modules/payslip/payslip.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`, `frontend/src/payslip/types.ts`, `frontend/src/pages/PayslipDetailPage.tsx`, `openapi/openapi.yaml`, `backend/tests/payslip-upload.test.ts`.

---

## F-5e (2026-05-14): Payslip deposit matching — detail UI (F-5 slice 5)

- **Type:** UX / Feature (V3 F-5)
- **What:** `PayslipDetailPage` Bank deposit card always visible: **Confirmed** table with remove, **Suggestions** table with confirm (when no confirmed links), empty-state copy, **Search ledger** modal with debounced `GET /transactions` search (`amountMin=0.01`, credits only). PATCH / line-item mutations preserve `confirmedDeposits` / `suggestedDeposits` in local state; PUT/DELETE deposit endpoints update state and refetch detail when the last confirmed link is removed.
- **Why:** End-user confirm/unlink and manual multi-link against stored `payslip_deposit_match` rows.
- **Files:** `frontend/src/pages/PayslipDetailPage.tsx`, `frontend/src/payslip/payslipChartsModel.test.ts` (mock snapshots include deposit arrays).

---

## F-5c (2026-05-14): Payslip deposit matching — HTTP routes (F-5 slice 3)

- **Type:** Feature (V3 F-5)
- **What:** `GET /payslips/:id` returns `confirmedDeposits` (always from `payslip_deposit_match`) and `suggestedDeposits` (ephemeral search only when confirmed is empty); removes `matchedDeposits`. New `PUT` / `DELETE /payslips/:id/deposits/:canonicalId` (registered before `GET /:id`) return `{ snapshot, confirmedDeposits }`. Path params validated with Zod (`depositCanonicalIdParamSchema`).
- **Why:** Stored confirmation + API for add/remove links; Express route order avoids `:id` capturing `deposits`.
- **Files:** `backend/src/modules/payslip/payslip.routes.ts`, `backend/tests/payslip-upload.test.ts`, `openapi/openapi.yaml`, `docs/PAYSLIP_V1.md`, `docs/V3_BACKLOG.md`.

---

## F-5b (2026-05-14): Payslip deposit matching — service layer (F-5 slice 2)

- **Type:** Feature (V3 F-5)
- **What:** `MatchedDeposit` gains `dateDelta` and `amountDelta`. `findMatchedDeposits` anchors on `pay_date` else `pay_period_end`, uses ±7-day window (±10 when anchored on period end only), filters `transaction_canonical.status = 'posted'`, and maps deltas in JS. New exports: `getConfirmedDeposits`, `addConfirmedDeposit`, `removeConfirmedDeposit` (join table `payslip_deposit_match`). `GET /payslips/:id` passes `payPeriodEnd` into the search helper.
- **Why:** Prepare stored confirmed links (F-5) and widen/tune ephemeral deposit suggestions without split-deposit auto-detection.
- **Files:** `backend/src/modules/payslip/payslip.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`, `frontend/src/payslip/types.ts`, `backend/tests/payslip-upload.test.ts`, `openapi/openapi.yaml`, `docs/PAYSLIP_V1.md`.

---

## F-5a (2026-05-14): Payslip deposit matching — join table (migration only)

- **Type:** DB- / Feature slice (V3 F-5)
- **What:** Added `payslip_deposit_match` (`payslip_snapshot_id`, `household_id`, `transaction_canonical_id`, `confirmed_at`) with unique pair per payslip+canonical row and index on `payslip_snapshot_id`. Cascade deletes from payslip, household, and canonical transaction. IDs use **TEXT** + `gen_random_uuid()::text` default to match `0001_baseline` (`payslip_snapshot.id` / `household.id` are TEXT, not UUID).
- **Why:** Foundation for stored confirmed net-pay deposit links (1-to-N split deposits); API and UI follow in later F-5 slices.
- **Files:** `backend/db/migrations/0045_f5_payslip_deposit_match.sql`.

---

## I-3 (2026-05-14): Category taxonomy + rule audit

- **Type:** Improvement (V3 I-3)
- **What:**
  - **Builtin rule fixes (`0044_i3_rule_taxonomy_fix.sql` + `0001_bootstrap.sql`):** Shell, Exxon, Chevron, BP were routed to `Mobility > Public Transit` — corrected to `Mobility > Fuel`. `parking` and `toll` patterns corrected to `Mobility > Parking & Tolls`. Rule keys renamed to match (`fuel_0_shell`, `parking_0_parking`, etc.).
  - **Apple Pay bug fix (`category-rules-house.csv`):** `APPLE` rule narrowed to `APPLE STORE`. The broad `apple` pattern was matching the bank-appended suffix `TXAPPLE PAY ENDING IN XXXX`, miscategorizing 40 transactions (Hareli Fresh Market, Patel Brothers, India Bazaar, Gwalia Sweets, Chipotle, etc.) as `Shopping > Electronic`.
  - **Household rules CSV audit:** `DIRECTPAY FULL BALANCE` consolidated to `any` (was `debit_only` only). Synced 6 rules that existed in DB but were missing from master file: FLEX PLAN, ROCKET MORTGAGE LOAN, PENNYMAC CASH, NEWREZ-SHELLPOIN ACH PMT, WF HOME MTG AUTO PAY (→ Loans > Rental Prop), and DIRECTPAY credit variant. Zelle rule removed (was disabled; too broad for P2P). Added 12 new rules: GEXA ENERGY, ENERGY OGRE, ENERGY TEXAS (→ Utilities > Energy); ROYAL CARIBBEAN, MSC CRUISES (→ Travel > Cruise); A2Z EV, FRANCIS ENERGY (→ Mobility > EV Charging); AMC (→ Entertainment > Movies); DESI MANDI (→ Shopping > Groceries).
  - **Custom categories in bootstrap seed + fixture:** `Bonds` (Investments > Bonds, `11d3b2b9-*`) and `Rental Prop` (Loans > Rental Prop, `dd347c5f-*`) added to `0001_bootstrap.sql` and `fixtures/category-import/categories.csv`. New installs will create these automatically.
- **Why:** 441 transactions (13%) were unclassified at import time; all manually fixed by user. Root causes: broad `apple` rule; gas station builtins pointing to wrong category; missing rules for recurring energy vendors, cruise lines, EV chargers; household CSV drifted from DB state.
- **Decisions recorded:**
  - `Income > Reimbursements` stays under Income — employer per diems and FSA drawdowns are genuine cash-positive inflows; no structural rename.
  - Spouse P2P payments: `Income > Reimbursements` is the correct bucket until both accounts are imported (Transfer In implies a paired out-transfer that doesn't exist yet; transfer detection pairs retroactively using amount/date/account — category is irrelevant to pairing).
  - Zelle rule permanently removed — P2P credits cannot be safely classified by payment method; manual per-transaction resolution is correct.
- **Files:** `backend/db/migrations/0044_i3_rule_taxonomy_fix.sql`, `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/category-rules-house.csv`, `fixtures/category-import/categories.csv`.

---

## F-7/F-8 (2026-05-14): AI insights — flow classification + budget suggestion cleanup

- **Type:** Feature (V3 F-7 + F-8)
- **What:**
  - **F-7 — LLM data feed overhaul (`insight-prompt.service.ts`):**
    - Added flow-class taxonomy (compile-time category UUID constants): `MOVEMENT`, `COMMITTED_EXPENSE`, `WEALTH_BUILDING`, `TAX`, `INCOME`, non-lifestyle set.
    - Replaced flat `flowTotals12m` with `flowBreakdown12m` which returns four separated 12-month aggregates in a single query: `inflow12` (Income category only), `lifestyleSpend12`, `committedExpenses12` (Loans), `uncategorized12`.
    - `InsightPromptInput` interface updated: `avgMonthlyOutflow` + `avgMonthlySavingsRate` → `avgMonthlyLifestyleSpend`, `avgMonthlyCommittedExpenses`, `cashBufferRate` ((income−lifestyle−committed)/income). `netWorth` block gains `healthSavingsTotal` and `educationSavingsTotal`. New `uncategorizedMonthlyAvg` field separates uncategorized debits from `topCategories`.
    - `topSpendCategories12m` now excludes all non-lifestyle categories (movement/investments/taxes/loans/income) and uncategorized; `topCategories` is lifestyle-only.
    - Added `investmentPortfolioTrend` function: CTE with window function picks latest snapshot per account per month, aggregates across investment/retirement/health/education accounts, returns 6-month trend. Uses `account_balance_snapshot.financial_account_id` and `.amount` columns (not `.account_id`/`.balance`).
    - `overBudgetCategories` now filters budget rows to lifestyle + loans only — movement/investments/taxes do not trigger over-budget alerts.
  - **F-7 — LLM system prompt (`llm-provider.service.ts`):** Bumped `PROMPT_VERSION` → `v1.1`. Added field-definition block explaining `cashBufferRate` formula and noting that `investmentPortfolioTrend` reflects both contributions and market movements.
  - **F-8 — Budget suggestions (`budget.service.ts`):** `EXCLUDED_PARENTS` expanded from 3 to 6 IDs — added Taxes, Borrowing (CC payments/personal lending), Banking (fees). Loans intentionally kept so mortgage/auto payments appear as budget suggestions. SQL `IS DISTINCT FROM` placeholder count updated from 3×2 to 6×2.
- **Why:** Transfer-polluted and movement-category transactions were inflating the LLM's view of household spending; uncategorized amounts were appearing as a top "category"; the old savings rate included investment outflows making it misleadingly low. Budget suggestions were surfacing Taxes and Borrowing/Banking rows that households can't meaningfully budget for.
- **Decisions recorded:**
  - Loans = committed_expense (not movement); households must plan around mortgage/auto payments — they stay in budget + LLM feed.
  - Investment account balances sent via `investmentPortfolioTrend` (not per-month transaction sums which miss payroll 401k deductions).
  - `cashBufferRate` definition: fraction of take-home income remaining after lifestyle discretionary spend and committed loan obligations.
  - Custom household categories default to lifestyle class (documented choice, revisit in I-3).
- **Files:** `backend/src/modules/insights/insight-prompt.service.ts`, `backend/src/modules/insights/llm-provider.service.ts`, `backend/src/modules/budget/budget.service.ts`.

---

## FIX-179 (2026-05-13): Knip dead-code sweep — orphaned files, dead exports, stale re-exports

**Why:** Knip audit identified confirmed orphans — files and exports with no live consumers and no future-use intent documented in CHANGE_HISTORY. Items flagged "keep" (e.g., `GrovePageLoader`, `subscribeToken`/`getTokenSnapshot`) were verified as intentional placeholders or substrate-level API and left alone.

**What was removed:**

*Files deleted:*
- `frontend/src/pages/ResolutionQueuePage.tsx` — CR-018 said "deleted" but the file survived on disk; router already redirects away from it
- `frontend/src/components/PageHeader.tsx` — pre-Mantine shared component, superseded by Mantine primitives
- `frontend/src/components/SectionCard.tsx` — same
- `frontend/src/import/startImportSession.ts` — extracted helper that was never adopted; pages inline the `POST /imports/sessions` call directly

*Dead exports/functions removed:*
- `backend/src/modules/payslip/profiles/ibm-payslip-pdf.ts` — `parseIbmPayslipPdf`, `PayslipPdfParseFailureReason`, `PayslipPdfParseResult`; CHANGE_HISTORY said "kept for tests" but no test ever imported it; IBM parsing routes through LLM extract path
- `backend/src/modules/canonical/canonical-ingest.service.ts` — removed re-export block for `computeTransactionFingerprint` / `normalizeAmountForFingerprint` / `normalizeDescriptionForFingerprint` / `normalizeTxnDateForFingerprint`; all consumers import directly from `transaction-fingerprint.ts`
- `backend/src/paths.ts` — removed `export` from `repoRoot`; `env.ts` defines its own local copy and never imported this one
- `backend/src/modules/imports/profiles/boa-estatement-pdf.ts` — removed `parseBoaEStatementPdf`; callers use `parseBoaEStatementFromTextDetailed` from the same file
- `backend/src/modules/budget/budget.service.ts` — removed `getBudgetEntry`; no call site anywhere
- `frontend/src/components/HierarchicalSearchPicker.tsx` — removed `lookupLabel` alias; `ledgerListQuery.ts` (the only consumer) updated to call `lookupTriggerLabel` directly

**Files changed:** `frontend/src/pages/ResolutionQueuePage.tsx` (deleted), `frontend/src/components/PageHeader.tsx` (deleted), `frontend/src/components/SectionCard.tsx` (deleted), `frontend/src/import/startImportSession.ts` (deleted), `backend/src/modules/payslip/profiles/ibm-payslip-pdf.ts`, `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/src/paths.ts`, `backend/src/modules/imports/profiles/boa-estatement-pdf.ts`, `backend/src/modules/budget/budget.service.ts`, `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/ledger/ledgerListQuery.ts`, `docs/CHANGE_HISTORY.md`

---

## FIX-178 (2026-05-13): Drop unused `react-currency-input-field`

**Why:** `CurrencyInput` is implemented with Mantine only; the npm package was never imported.

**Changed:**
- `frontend/package.json` — removed `react-currency-input-field`
- `package-lock.json` — lockfile updated accordingly

**Correction (same day):** A brief `knip.json` top-level `exclude` was added in the same commit to reduce Knip noise; that was **reverted** immediately after — maintainers want `npm run knip` to keep reporting unused files, exports/types, and duplicates for intentional dead-code review, not only dependency hygiene.

---

## CR-176 (2026-05-13): Add Knip config for the npm workspaces monorepo

**Why:** Running Knip without config treated Vitest suites, root `scripts/*.mjs`, and backend one-off tooling as unreachable, producing a noisy and misleading dead-code report.

**Changed:**
- `knip.json` — per-workspace `project` globs; **Vite** + **Vitest** plugins on `frontend`; **Vitest** on `backend` so entries implied by `vite.config.ts` / `vitest.config.ts` / `package.json` scripts are not duplicated; explicit backend entries only for `tests/**/*.test.js` (outside Vitest `include`) and `backend/scripts/**/*.mjs` (manual one-offs); root workspace `scripts/**/*.mjs` with `ignoreDependencies` for `better-sqlite3` / `dotenv` still imported by legacy root scripts (Postgres-only stack).
- `package.json` (root) — `knip` script and `knip` devDependency; `package-lock.json` must list `knip` so `npm run knip` resolves `node_modules/.bin/knip` (fresh clones need `npm install`).

---

## CR-175 (2026-05-12): Rename "Household Finance" → "Grove" in package metadata and test fixtures

**Why:** App was rebranded to Grove; frontend/backend code was already updated but package.json names, README title, and SMTP_FROM test fixture strings still carried the old name.

**Changed:**
- `package.json` (root) — name `household-finance-app` → `grove-app`
- `backend/package.json` — name `@household-finance/backend` → `@grove/backend`
- `frontend/package.json` — name `@household-finance/frontend` → `@grove/frontend`
- `README.md` — top-level heading updated to `# Grove`
- `backend/tests/member-invite.test.ts`, `password-reset.test.ts` — SMTP_FROM sender display name updated

**Intentionally unchanged:** crypto key-derivation salt strings in `dob-crypto.ts` and `gdrive.service.ts` (renaming would break decryption of existing data); `docker-compose.yml` `POSTGRES_DB` name (live database identifier).

---

## UX-172 (2026-05-12): Wire GroveLoader across all loading states

**Why:** Production pages with slow/complex queries (budget aggregation, net worth, transaction list) showed no visual feedback — just plain "Loading…" text or blank space. Replaced with Grove brand loader using three design patterns from the Claude design spec.

**Patterns added:**
- `GroveCardLoader` — new export in `GroveLoader.tsx`; centered column (loader above label) inside a card or section panel, no full-page height. Used for complex aggregations.
- In-context horizontal (`GroveLoader` + `Group`) — loader and label side by side within a list/section. Used for list fetches.
- `GrovePageLoader` — existing export, unchanged. Full-page centered for top-level page loads.

**Pages updated:**
- `DashboardPageV2.tsx` — 3 Paper cards (spending breakdown, net worth, recurring payments) → `GroveCardLoader` with contextual labels
- `TransactionsPage.tsx` — transaction list fetch → in-context `GroveLoader size="lg" color="forest" speed="slow"`
- `BudgetPage.tsx` — main budget load → `GroveCardLoader size="lg" speed="slow"`; suggestions load → in-context `GroveLoader size="sm" color="muted"`
- `PayslipDetailPage.tsx` — payslip detail fetch → `GroveCardLoader` inside Paper
- `PayslipsPage.tsx` — payslip list fetch → in-context `GroveLoader size="sm" color="muted"`
- `SettingsPage.tsx` — 3 section loads (profile, members, household) → in-context `GroveLoader size="sm" color="muted"`

---

## UX-171 (2026-05-12): Replace Mantine Loader with GroveLoader

**Why:** Mantine's `<Loader>` uses a generic spinner; GroveLoader uses the Grove Stems mark animation (three bars, brand colors) for visual consistency with the Grove identity.

**What changed:**
- `frontend/src/components/FinancialHealthCard.tsx` — removed `Loader` from Mantine imports; added `GroveLoader` import; replaced all 3 `<Loader size="sm" />` with `<GroveLoader size="sm" color="muted" />` (inline card loading states: initial load, generating analysis, loading history).

---

## UX-170 (2026-05-12): Grove branding — email templates

**Why:** All 5 mailer templates still referenced "Household Finance" and "HF ·" in subject lines, body text, header brand, and footer. Renamed to "Grove" to match the shipped app identity.

**What changed:**
- `backend/src/modules/mailer/templates/layout.ts` — header brand replaced with Grove Mark C (G letterform) SVG + "Grove" wordmark; footer "member of Grove"; background `#f5f7f6` → `#efebe3` (warm linen).
- `backend/src/modules/mailer/templates/member-invite.ts` — subject, title, and body text updated to "Grove".
- `backend/src/modules/mailer/templates/password-reset.ts` — subject, both title branches, and body/plain text updated to "Grove".
- `backend/src/modules/mailer/templates/password-changed.ts` — subject, title, and body text updated to "Grove".
- `backend/src/modules/mailer/templates/export-ready.ts` — subject, both title branches, and body/plain text updated to "Grove".

**Acceptance:** `grep -r "Household Finance" backend/src/modules/mailer/` returns zero results.

---

## UX-169 (2026-05-12): Mobile layout — transactions scroll, grids, toolbars

**Why:** On narrow viewports (e.g. iPhone 15 Pro Max), the transactions ledger and several pages caused horizontal scroll or cramped layouts; the transactions toolbar needed safer wrapping and bulk bar styling wired to the bulk `Group`.

**What changed:**
- `frontend/src/pages/TransactionsPage.tsx` — horizontal scroll wrapper around the main ledger `Table`; `txn-col--secondary` on Account and Belongs-to columns (hidden ≤640px); `className="transactions-bulk-bar"` on bulk selection `Group`s.
- `frontend/src/index.css` — `overflow-x: hidden` on `.app-shell-main` / `.app-main` under 768px; expanded 640px rules (toolbar fields, bulk bar, hidden secondary columns, Recharts max-width, tighter `.app-main` Card/Paper padding, page header actions, topbar actions nowrap); sticky toolbar comment aligned with topbar height.
- `frontend/src/pages/DashboardPageV2.tsx`, `BudgetPage.tsx`, `NetWorthPage.tsx` — responsive `SimpleGrid` `cols` with `xs` breakpoints for mid-width phones.

---

## UX-168 (2026-05-12): Grove — product name and PWA chrome

**Why:** Rebrand the user-visible app name to Grove and align tab/install/manifest chrome with the new mark and forest palette.

**What changed:**
- `frontend/index.html` — document title, apple web app title, theme color, favicon link.
- `frontend/public/manifest.json` — `name` / `short_name` / theme and background colors.
- `frontend/public/favicon.png`, `frontend/public/icons/icon-192.png`, `frontend/public/icons/icon-512.png` — regenerated from `frontend/public/icons/grove-app-icon.svg` via `npm run icons:gen` (`scripts/gen-icons.mjs`, `@resvg/resvg-js`).
- `frontend/src/components/GroveMark.tsx` — shared stems mark for sidebar and landing.
- `frontend/src/layout/AppSidebar.tsx`, `frontend/src/pages/HomePage.tsx` — brand row uses mark + “Grove”.

---

## FIX-B8 (2026-05-12): Settings — Add institution modal stacking fix

**Why:** The "Add institution name…" button lives inside the `HierarchicalSearchPicker` footer, which renders its dropdown in a `createPortal` at `zIndex: 1300`. Clicking the button opened the Mantine modal without closing the picker first, so the modal appeared behind the picker overlay regardless of the modal's own z-index.

**What changed:**
- `frontend/src/components/HierarchicalSearchPicker.tsx` — `footer` prop now accepts `ReactNode | ((close: () => void) => ReactNode)`. When a render function is provided, it receives a `close` callback that calls `setOpen(false)` + `setSearch("")`. Existing `ReactNode` usages are unaffected.
- `frontend/src/pages/SettingsPage.tsx` — institution picker `footer` updated to the render-function form; button handler calls `close()` before `openAddInstitutionModal()`, ensuring the picker dismisses before the modal mounts.

---

## UX-167b (2026-05-12): CurrencyInput — custom cash-register implementation

**Why:** `react-currency-input-field` v4 does not have a right-to-left digit-shifting (cash register) mode — `fixedDecimalLength` only pads decimals on blur. Controlled-value round-trips also reset the library's internal cursor state on every keystroke, preventing any digit-shift behavior.

**What changed:**
- `frontend/src/components/CurrencyInput.tsx` — replaced `react-currency-input-field` with a custom implementation: stores value as integer cents, intercepts `onKeyDown` for digit/backspace/delete, uses `Intl.NumberFormat` for display. Passes navigation/modifier keys through. Blocks paste and cut. No upper limit on value.

---

## CR-183 (2026-05-12): Cash On Hand account type (F-11)

**Why:** Users keep physical cash (e.g. a $1,000 home emergency fund) with no bank account to track it against. Manual ledger entries required an account; there was no suitable type for physical cash.

**What changed:**
- Migration `0043` widens `financial_account_type_check` to include `'cash'`.
- `accountUpsertSchema` in `imports.routes.ts` accepts `"cash"` as a valid type.
- `defaultLiquidity("cash")` returns `"liquid"`.
- `accountSide("cash")` returns `"asset"` — cash accounts appear on the net worth balance sheet.
- AI insights `buildNetWorthBlock` rolls cash balances into `checkingSavingsTotal`.
- `"Cash & Wallet"` added to both institution catalogs as a built-in suggestion (no custom institution needed).
- `SettingsPage` type picker adds a Cash entry with searchText `cash on hand wallet petty cash liquid`.

**Flow:** Settings → Accounts → Add account → Institution: "Cash & Wallet" → Type: Cash → set initial balance → record payments as manual debit transactions.

**Files:** `backend/db/migrations/0043_cash_account_type.sql`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/imports/import-file-binding.service.ts`, `backend/src/modules/reports/balance-sheet.service.ts`, `backend/src/modules/insights/insight-prompt.service.ts`, `backend/src/modules/imports/institution-catalog.ts`, `frontend/src/import/institutionCatalog.ts`, `frontend/src/pages/SettingsPage.tsx`

---

## UX-167 (2026-05-12): Cash register dollar amount inputs

**Why:** Dollar fields used Mantine `NumberInput` or plain numeric text without consistent decimal-first entry.

**What changed:** Added `react-currency-input-field` and `CurrencyInput` (Mantine `Input.Wrapper` styling, two fixed decimals). Wired into net worth manual balance, Settings salary/balance fields, budget amounts, payslip manual dollar fields, and manual transaction amount.

**Files:** `frontend/package.json`, `frontend/src/components/CurrencyInput.tsx`, `frontend/src/pages/NetWorthPage.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/BudgetPage.tsx`, `frontend/src/pages/PayslipManualPage.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`, `docs/V3_BACKLOG.md`

---

## UX-166 (2026-05-12): Consistent USD display formatting

**Why:** Dollar amounts used bare `toFixed(2)` without thousands separators.

**What changed:** Added `formatUsd` (`en-US`, two decimals) and replaced dollar `toFixed(2)` display in payslips, dashboard, import reconciliation, settings recurring anchor, and payslip charts/detail/manual views.

**Files:** `frontend/src/utils/format.ts`, `frontend/src/pages/PayslipsPage.tsx`, `frontend/src/pages/DashboardPageV2.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/payslip/PayslipIncomeCharts.tsx`, `frontend/src/pages/PayslipDetailPage.tsx`, `frontend/src/pages/PayslipManualPage.tsx`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`, `docs/V3_BACKLOG.md`

---

## I-6 (2026-05-12): Drive folderId query guard

**Why:** `folderId` is interpolated into Drive API `q` strings; validate DB-sourced IDs before use.

**What changed:** `listHfbFilesInFolder` rejects `folderId` values that are not `[\w-]+`.

**Files:** `backend/src/modules/export/gdrive-backup.service.ts`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`, `docs/SECURITY_HARDENING_BACKLOG.md`, `docs/V3_BACKLOG.md`

---

## I-5 (2026-05-12): Export/restore housekeeping

**Why:** Completed restore jobs left staging `.hfb` files on disk; successful restore did not warn that Google Drive must be reconnected.

**What changed:** `runImportJob` deletes the uploaded staging file in `finally`. Restore success UI shows a yellow alert to reconnect Drive under Settings → Data → Backup.

**Files:** `backend/src/modules/export/import-household-bundle.service.ts`, `frontend/src/pages/settings/BackupRestoreSection.tsx`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`, `docs/EXPORT_IMPORT_BACKLOG.md`, `docs/V3_BACKLOG.md`

---

## I-4 (2026-05-12): Password reset token periodic cleanup

**Why:** Used and expired `password_reset_token` rows were never purged outside per-user token rotation.

**What changed:** `purgeStalePasswordResetTokens` deletes rows with `used_at` set or `expires_at` in the past; called from the existing hourly export purge schedule (no new timer).

**Files:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/export/export-job.service.ts`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`, `docs/SECURITY_HARDENING_BACKLOG.md`, `docs/V3_BACKLOG.md`

---

## FIX-182 (2026-05-12): CR-177 post-review cleanup

**Why:** Code review after CR-177/FIX-177 found two small issues.

1. `multiSelectLabel="selections"` on the belongs-to picker — trigger showed "3 selections" instead of "3 members" when 3+ members selected. Changed to `"members"`.
2. `formatDateLabel` in `TransactionAggregateSummary.tsx` was defined but never called (dead code). Removed.

Note: `byMerchant` normalization and `byMonth` ascending-order tests were confirmed present in `app.test.ts` (lines 4452, 4490) — no new tests needed.

**Files:** `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/components/TransactionAggregateSummary.tsx`

---

## FIX-B8 (2026-05-12): Settings add institution Mantine modal

**Why:** The Connected accounts institution picker used `window.prompt` for custom institution names.

**What changed:** Settings → Accounts → Add institution prompt replaced with a Mantine modal. State: `institutionModalOpen` / `institutionModalName` / `institutionModalSaving` / `institutionModalError`.

**Files:** `frontend/src/pages/SettingsPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## FIX-181 (2026-05-11): CR-177 backlog sync and row ownership PATCH test

**Why:** `V3_BACKLOG.md` still described Transactions row belongs-to as `person:<uuid>` and belongs-to filter triggers as `N members` after FIX-180. Row ownership persistence had only frontend helper unit tests.

**What changed:** Backlog text matches Transactions raw UUID picker values and `selections` / summary chip copy. `app.test.ts` asserts `PATCH /transactions/:id` assigns and clears `ownerScope` / `ownerPersonProfileId` via the ledger API.

**Files:** `docs/V3_BACKLOG.md`, `backend/tests/app.test.ts`, `docs/CHANGE_HISTORY.md`

---

## UX-180 (2026-05-11): Hierarchical picker child row alignment

**Why:** Multi-select child rows inherited `justify-content: space-between` from the shared parent/child button rule, pushing labels toward the right pane edge away from the parent column.

**What changed:** Parent rows keep space-between (label + chevron); child rows use `flex-start` so labels sit on the left next to the optional ✓ marker.

**Files:** `frontend/src/index.css`, `docs/CHANGE_HISTORY.md`

---

## FIX-180 (2026-05-11): Row belongs-to picker vs filter UUID values

**Why:** CR-177 belongs-to filter groups use raw person profile UUIDs, but the per-row belongs-to editor still used `person:<uuid>` values. Selecting a member from the row menu did not update ownership; closed labels could not resolve.

**What changed:** Row and manual-entry pickers use `belongsToPickerValueFromRow` / `parseBelongsToPickerValue` (raw UUID + legacy `person:` support). Removed unused single-select belongs-to filter state. Active-filter chip copy uses `formatActiveBelongsToSummary`; belongs-to multi-select label is “selections”. `belongsTo` query params dedupe in `ledger.routes.ts`.

**Files:** `frontend/src/ledger/ledgerListQuery.ts`, `frontend/src/ledger/ledgerListQuery.test.ts`, `frontend/src/pages/TransactionsPage.tsx`, `backend/src/modules/ledger/ledger.routes.ts`, `docs/CHANGE_HISTORY.md`

---

## FIX-179 (2026-05-11): CR-177 multi-select and aggregate test coverage

**Why:** CR-177 added multi-select ledger filters and aggregate parity on the API, but integration coverage was thin and the Transactions page had no automated tests for URL/query wiring or picker parent multi-select behavior.

**What changed:** `backend/tests/ledger-filters.test.ts` now uses an isolated household fixture for `categoryIds`, `accountIds`, `belongsTo`, `ownerPersonProfileIds`, aggregate signed totals, and list/aggregate count parity. Frontend helpers moved to `frontend/src/ledger/ledgerListQuery.ts` and `frontend/src/components/hierarchicalPickerMultiSelect.ts` with Vitest unit tests.

**Files:** `backend/tests/ledger-filters.test.ts`, `frontend/src/ledger/ledgerListQuery.ts`, `frontend/src/ledger/ledgerListQuery.test.ts`, `frontend/src/components/hierarchicalPickerMultiSelect.ts`, `frontend/src/components/hierarchicalPickerMultiSelect.test.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/components/HierarchicalSearchPicker.tsx`, `docs/CHANGE_HISTORY.md`

---

## DB-178 (2026-05-11): Dev sample ledger seed

**Why:** Default dev seeding only created financial accounts; Transactions and aggregation needed a realistic posted ledger volume for manual testing.

**What changed:** `backend/db/seeds/dev/dev_0004_seed_sample_ledger.sql` adds two household member profiles and 520 deterministic pseudo-random posted rows (2024–2025, six accounts, mixed categories/merchants, signed amounts). Generator: `scripts/generate-dev-ledger-seed.mjs` (`npm run db:generate:dev-ledger`).

**Files:** `backend/db/seeds/dev/dev_0004_seed_sample_ledger.sql`, `scripts/generate-dev-ledger-seed.mjs`, `package.json`, `backend/db/README.md`, `docs/CHANGE_HISTORY.md`

---

## FIX-177 (2026-05-11): CR-177 corrective pass

**Why:** Initial CR-177 shipped with picker UX gaps, deferred belongs-to multi-select, a redundant aggregate Count cell, and a By month tab that could overwhelm long ranges.

**What changed:** `HierarchicalSearchPicker` parent click selects the parent value plus all children; removed the right-pane “(direct)” row; replaced Mantine checkboxes with inline ✓ and `hs-picker__child--active`. Belongs-to multi-select on Transactions via repeated `belongsTo` URL params (`household` and/or person profile UUIDs) with backend `LedgerListFilters.belongsTo` and mixed household/person SQL; legacy `ownerScope` params still work. Aggregate strip drops the duplicate Count cell; Inflows/Outflows use plain `$` amounts; stat labels have `title` tooltips; By month shows the last six months with a cap notice; context row shows category/account/month counts. Prior filter memoization, server-backed strip gating, and signed-amount aggregate totals remain.

**Files:** `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/components/TransactionAggregateSummary.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `backend/src/modules/ledger/ledger.service.ts`, `backend/src/modules/ledger/ledger.routes.ts`, `docs/API_LEDGER.md`, `docs/CHANGE_HISTORY.md`

---

## CR-177-d (2026-05-11): Transaction aggregation strip — breakdown tabs

**Why:** Filtered Transactions views need category / merchant / account / month rollups without leaving the page.

**What changed:** `TransactionAggregateSummary` adds Mantine tabs with ranked horizontal bars (dashboard pattern): top-8 + show-all for category and merchant, all accounts, month tab when more than one month. Breakdown tabs hide when the filtered set has only one transaction.

**Files:** `frontend/src/components/TransactionAggregateSummary.tsx`, `docs/CHANGE_HISTORY.md`, `docs/API_LEDGER.md`

---

## CR-177-c (2026-05-11): Transaction aggregation strip — headline row

**Why:** Users need full-filter-set totals while the table stays paginated.

**What changed:** New summary strip above the transactions table fetches `GET /transactions/aggregate` from current URL filters (independent of page size). Collapsible header shows transaction count; headline row shows net, inflows, outflows, average, and date span with Forest Studio styling.

**Superseded (FIX-177):** Body row no longer duplicates count in a Count cell; inflows/outflows use plain `$` formatting; stat labels have tooltips; By month caps at six buckets with a notice; context stats row when `count > 1`.

**Files:** `frontend/src/components/TransactionAggregateSummary.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## CR-177-b (2026-05-11): Transactions multi-select filters + URL params

**Why:** Aggregation use cases require combining multiple categories and accounts in one filter.

**What changed:** `HierarchicalSearchPicker` gains optional multi-select (parent select-all, count chips). Transactions page reads/writes `categoryIds` and `accountIds` repeated params with legacy `categoryId` / `accountId` compat; list and aggregate requests share filter query building.

**Superseded (FIX-177):** No Mantine `Checkbox` in the menu, no right-pane “(direct)” row; parent click toggles parent value plus all children; inline ✓ + `hs-picker__child--active`. Belongs-to filter multi-select and `belongsTo` URL params shipped in the corrective pass (see FIX-177 / FIX-180).

**Files:** `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## CR-177-a (2026-05-11): Ledger aggregate endpoint + multi-select filters

**Why:** Client-side pagination cannot compute totals over the full filtered ledger.

**What changed:** `GET /transactions/aggregate` reuses ledger filter parsing and returns headline totals plus capped breakdowns. `GET /transactions` accepts `categoryIds`, `accountIds`, and `ownerPersonProfileIds` (merged with legacy singular params). Integration tests cover aggregate auth, filters, merchant normalization, and month buckets.

**Files:** `backend/src/modules/ledger/ledger.routes.ts`, `backend/src/modules/ledger/ledger.service.ts`, `backend/tests/app.test.ts`, `openapi/openapi.yaml`, `docs/API_LEDGER.md`, `docs/CHANGE_HISTORY.md`

---

## CR-176 / UX-176 (2026-05-11): Forest Studio Phase F — authed layout cap + Inter Tight headings

**Why:** Wide monitors stretched route content edge-to-edge; headings and KPI numerals read small and generic next to the Forest Studio chrome.

**What changed:** `max-width: 1500px` + horizontal centering on `.app-shell-main > main.app-main` (and fallbacks for `.app-content` / `[role="main"]`) so sidebar/topbar column stays full width while page body caps. Google Fonts link adds **Inter Tight**; `:root` gains `--font-heading`; global rules for `h1`–`h4`, `.mantine-Title-root`, and `.kpi-value`; Mantine `createTheme({ headings: … })` aligns `<Title>` sizes. No TSX logic or inline hero KPI edits.

**Files:** `frontend/index.html`, `frontend/src/index.css`, `frontend/src/theme.ts`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`, `docs/V3_BACKLOG.md`

---

## CR-175 / UX-175 (2026-05-11): Forest Studio prompt #2 — dashboard polish & status colors

**Phase A — dashboard resolution badges:** Replaced bright yellow Mantine badges and unicode glyphs (⚠ ⟳ ◑) with neutral `color="gray"` badges plus Tabler icons (`IconAlertCircle`, `IconArrowsExchange`, `IconCopy`); same `Link` targets and query strings.

**Phase B — positive status text → forest:** Replaced `c="green"` on status `<Text>` with `style={{ color: "var(--fs-forest)" }}`; `Badge` / `Button` / `ActionIcon` positives use `color="fsForest"`. Post-action success `<Alert color="green">` unchanged. Inline import session `<Alert>` uses `color="fsForest" variant="light"`.

**Files (Phase A):** `frontend/src/pages/DashboardPageV2.tsx`, `docs/CHANGE_HISTORY.md`

**Files (Phase B):** `frontend/src/pages/HomePage.tsx`, `ImportWorkspacePage.tsx`, `PayslipManualPage.tsx`, `SettingsPage.tsx`, `settings/BackupRestoreSection.tsx`, `TransactionsPage.tsx`, `ResetPasswordPage.tsx`, `docs/CHANGE_HISTORY.md`

**Phase C — informational yellow → fsGold:** Softened non-destructive hints (backup staleness, import duplicate note, payslip validation banners) to `Alert color="fsGold" variant="light"`. Remove-member dialog data-loss warning stays `color="yellow"` with an inline comment.

**Files (Phase C):** `BackupRestoreSection.tsx`, `SettingsPage.tsx`, `TransactionsPage.tsx`, `PayslipManualPage.tsx`, `PayslipDetailPage.tsx`, `docs/CHANGE_HISTORY.md`

**Phase D — collapsed sidebar brand:** Removed HF abbreviation and full brand row when `collapsed && !mobileOpen`; mobile drawer still shows brand. Removed unused `.app-sidebar__brand-abbr` CSS; added collapsed `.app-sidebar__top` spacing.

**Files (Phase D):** `frontend/src/layout/AppSidebar.tsx`, `frontend/src/index.css`, `docs/CHANGE_HISTORY.md`

**Phase E — spending card ranked bars:** Replaced Recharts pie + legend on the Home dashboard “spending this month” card with a descending horizontal bar list (same `slices` data, links preserved). Added `--color-track` for bar track contrast in light/dark. Removed unused `Pie` / `PieChart` / `Cell` imports.

**Files (Phase E):** `frontend/src/pages/DashboardPageV2.tsx`, `frontend/src/index.css`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`, `docs/V3_BACKLOG.md`

---

## CR-174 / UX-174 (2026-05-10): Forest Studio — design tokens, money palette, nav grouping

**Why:** Align the UI with the Forest Studio palette: reserve pure red for destructive actions only, use terracotta for financial “down / over,” earthy Recharts colors, grouped sidebar, and warm-cream active states instead of mint.

**Phase 1 — tokens:** CSS `--fs-*` custom properties (light + dark overrides) and `frontend/src/theme/chartPalette.ts` for Recharts.

**Phase 2 — money / charts:** Mantine theme colors `fsForest`, `fsTerracotta`, `fsGold`. Budget progress and KPI borders; Net worth trend gradients and top bars; dashboard pie (`FS_CAT_PALETTE`), 6‑month trend bars, hero net/outflow, budget strip, sparkline stroke, account trend arrows; transactions status badges; payslip KPI cards (gross forest / net gold) and list net color; payslip breakdown slice colors. `.kpi-delta-chip--down` uses terracotta. Removed shim `DashboardPage.tsx` — `HomeRoute` imports `DashboardPageV2` directly.

**Phase 3 — chrome:** `AppSidebar` nav grouped Daily / Reports / Setup; collapsed mode shows dividers between groups; `--color-sidebar-active` → cream via `--fs-sidebar-active`; guest landing logo gradient (`--fs-gold` → `--fs-forest`); theme switcher, import button, user menu hover, landing check/pill, and dark auth links use cream/forest instead of mint.

**Files:** `frontend/src/index.css`, `frontend/src/theme.ts`, `frontend/src/theme/chartPalette.ts`, `frontend/src/layout/AppSidebar.tsx`, `frontend/src/pages/HomeRoute.tsx`, `frontend/src/pages/BudgetPage.tsx`, `frontend/src/pages/NetWorthPage.tsx`, `frontend/src/pages/DashboardPageV2.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/PayslipsPage.tsx`, `frontend/src/payslip/payslipChartsModel.ts`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`, `docs/V3_BACKLOG.md` (deleted `frontend/src/pages/DashboardPage.tsx`)

---

## CR-173 / DB-042 (2026-05-10): F-9 — Date of birth encrypted at rest, computed age

**Why:** Manually-entered age is a stale value requiring yearly updates. Storing DOB allows the app to compute current age automatically. DOB is PII and must not be stored plaintext.

**What changed:**

- Migration **0042**: `date_of_birth_encrypted TEXT` column added to **`person_profile`**.
- **`backend/src/modules/household/dob-crypto.ts`** (new): `encryptDob`, `decryptDob`, `computeAgeFromDob`. Key = SHA-256(`"household-finance:dob:" + JWT_SECRET`) — same derivation pattern as gdrive OAuth token encryption. Format: base64(`iv[12] || tag[16] || ciphertext`).
- **`household.service.ts`**: all profile SELECT queries now include `date_of_birth_encrypted`. Profile row mapping computes effective age from DOB when present, with manual age fallback. Single mapper (`toHouseholdMemberProfile`) keeps `dateOfBirth: null` for safety; an own-profile helper (`toOwnProfile`) reveals the decrypted DOB. `patchCurrentUserProfile` accepts `dateOfBirth?: string | null` — setting clears manual age; clearing leaves manual age input editable. Own-profile responses include decrypted `dateOfBirth`. Member-list/detail responses include `hasDob` + computed `age` but NOT raw `dateOfBirth`.
- **`household.routes.ts`**: `profilePatchSchema` accepts `dateOfBirth` (`YYYY-MM-DD` regex, nullable, optional).
- **`insight-prompt.service.ts`**: selects `date_of_birth_encrypted`, computes effective age (DOB-first, manual fallback) for both `assembleHouseholdPromptInput` (head + spouse) and `assemblePersonalPromptInput` before building AI prompt context.
- **`export-registry.ts`**: `person_profile` entry gets `onExport` hook stripping `date_of_birth_encrypted` before `.hfb` export. Restore notice should say: "Date of birth must be re-entered after restore."
- **`SettingsPage.tsx`**: profile edit replaces the age `NumberInput` with a DOB date picker. When DOB set: date input + computed age display + "Clear DOB" button. When DOB unset: date picker placeholder + manual age fallback input. Save unconditionally sends `dateOfBirth`; manual `age` is only sent when no DOB is set.

**Files:** `backend/db/migrations/0042_person_profile_dob.sql` (new), `backend/src/modules/household/dob-crypto.ts` (new), `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`, `backend/src/modules/insights/insight-prompt.service.ts`, `backend/src/modules/export/export-registry.ts`, `frontend/src/pages/SettingsPage.tsx`, `openapi/openapi.yaml`, `docs/API_HOUSEHOLD_PROFILE.md`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`

---

## FIX-172 (2026-05-10): OpenAPI — `property_id` / `linked_account_id` not account-upsert inputs

**Why:** CR-171 OpenAPI listed **`linkedAccountId`** and **`propertyId`** on **`ImportAccountUpsertRequest`**, implying the importer account PATCH/POST could set them. **`property_id`** is set only when **`POST /household/properties`** includes **`accountId`**; **`linked_account_id`** is reserved for future HELOC pairing (**D-5**) and is not writable via account upsert.

**What changed:** Removed those two properties from **`ImportAccountUpsertRequest`** in **`openapi/openapi.yaml`**; documented **`linked_account_id`** and **`property_id`** on **`FinancialAccountListItem`** with **`readOnly: true`** and clarifying descriptions. **`docs/API_HOUSEHOLD.md`** account-enrichment prose aligned (writable: `subType`, `memo`, `liquidity` only).

**Files:** `openapi/openapi.yaml`, `docs/API_HOUSEHOLD.md`, `docs/CHANGE_HISTORY.md`

## CR-171 / UX-171 (2026-05-10): F-2 display complete + F-3 liquidity breakdown + OpenAPI doc remediation (CR-169 gap)

**Why:** Properties stored in DB since CR-169 but invisible on NetWorthPage — market values excluded from totals and no UI display. OpenAPI spec and API_HOUSEHOLD.md were not updated in CR-169 commit (doc gap). F-3 (liquidity breakdown) is a natural extension of the same page once liquidity field is surfaced from the backend.

**What changed:**

- `balance-sheet.service.ts`: SELECT now includes `liquidity` column from `financial_account`. New property query runs after accounts loop — LEFT JOIN LATERAL to latest `property_value_snapshot` ≤ asOf, then finds linked mortgage via `financial_account.property_id`. Property market values added to `assetSum`/`assetHasAny`. Result includes `properties[]` array and `PropertySheetRow` type. `BalanceSheetAccountRow` now includes `liquidity` field.
- `reports.routes.ts`: `properties` forwarded in GET /reports/balance-sheet response.
- `NetWorthPage.tsx`:
  - F-2: property rows folded into Assets table under a "Real Estate" sub-label. Each row shows address, property use type, market value, equity sub-text (market value − mortgage balance). Pencil edit posts new market value snapshot to POST /household/properties/:id/values. Expand-on-click shows Recharts LineChart of value history from GET /household/properties/:id/values.
  - F-3: Liquidity breakdown Paper section added between KPI cards and Trend chart. Groups asset balances by liquidity tier (liquid/semi_liquid/restricted/uncategorized). Property market values always count as restricted. Uncategorized row shows link to Settings → Accounts. Only rendered when at least one account has a liquidity tag or a property has a value.
- `openapi/openapi.yaml`: Added all 6 /household/properties routes. Added PropertyRecord and PropertyValueSnapshot component schemas. Updated account upsert request with sub_type, memo, liquidity (camelCase) and corrected type enum (health/education added, mortgage removed); account list response documents read-only `linked_account_id` / `property_id` (see **FIX-172** for input-schema correction). Updated /reports/balance-sheet response schema with properties[] and liquidity on account rows.
- `docs/API_HOUSEHOLD.md`: Added Property routes section and Account enrichment fields section.
- `docs/API_INDEX.md`: Added property route entries.
- `docs/API_BALANCE_SHEET.md`: Documented `liquidity`, `properties[]`, and corrected account-type lists for the balance sheet response.
- `import-file-binding.service.ts`: `GET /imports/accounts` list rows now include `linked_account_id` (OpenAPI parity).

**Files:** `backend/src/modules/reports/balance-sheet.service.ts`, `backend/src/modules/reports/reports.routes.ts`, `backend/src/modules/imports/import-file-binding.service.ts`, `frontend/src/pages/NetWorthPage.tsx`, `openapi/openapi.yaml`, `docs/API_HOUSEHOLD.md`, `docs/API_INDEX.md`, `docs/API_BALANCE_SHEET.md`, `docs/CHANGE_HISTORY.md`, `docs/V3_PLAN.md`

## CR-169 / DB-041 (2026-05-10): Account enrichment + Property entity (F-1/F-2)

**Why:** Accounts lacked sub-classification (HSA vs FSA vs 401k), free-text context for AI insights, and a structured way to track property assets linked to mortgages. Net worth was also missing health/education account types.

**What changed:**

- **Migration `0041_v3_account_enrichment.sql`:**
  - New columns on `financial_account`: `sub_type TEXT`, `memo TEXT`, `liquidity TEXT CHECK('liquid','semi_liquid','restricted')`, `linked_account_id` (self-referential FK, for future HELOC→mortgage pairing), `property_id FK → property`
  - New `property` table: address fields, property use, API provider/ID for future valuation API
  - New `property_value_snapshot` table: time-series market values per property (mirrors `account_balance_snapshot` pattern); unique index on `(property_id, as_of_date)`
  - Migrated all existing `type='mortgage'` rows → `type='loan', sub_type='mortgage_primary'`
  - Widened `type` CHECK: added `health`, `education`; removed `mortgage`
  - `defaultLiquidity()` auto-sets liquidity at create/update time based on type+subtype (user can override)

- **Backend:**
  - `import-file-binding.service.ts`: `listHouseholdFinancialAccounts`, `createHouseholdFinancialAccount`, `updateHouseholdFinancialAccount` — all updated for new fields; `defaultLiquidity()` exported helper
  - `imports.routes.ts`: `accountUpsertSchema` updated — `mortgage` removed, `health`/`education` added, `subType`/`memo`/`liquidity` added
  - `household/property.service.ts` (new): `createProperty`, `getProperty`, `listPropertiesForHousehold`, `updateProperty`, `addPropertyValueSnapshot`, `listPropertyValueSnapshots`
  - `household.routes.ts`: property CRUD routes — `GET/POST /household/properties`, `GET/PATCH /household/properties/:id`, `GET/POST /household/properties/:id/values`
  - `balance-sheet.service.ts`: `accountSide()` — added `health`/`education` as assets, removed `mortgage` from liabilities
  - `insight-prompt.service.ts`: removed `mortgage` from loan liability aggregation

- **Frontend:**
  - `SettingsPage.tsx`: flat `Select` for account type replaced with `HierarchicalSearchPicker` (type → subtype two-pane picker); added memo `Textarea`; added liquidity override `Select`; added `+ Property` button for mortgage accounts opening a property details `Modal` (address + market value snapshot); accounts table shows formatted type·subtype label + memo preview
  - `NetWorthPage.tsx`: `ACCOUNT_TYPE_LABELS` — added `health`/`education`, removed `mortgage`
  - `DashboardPageV2.tsx`: `LIABILITY_ACCOUNT_TYPES` — removed `mortgage`

**Files:** `backend/db/migrations/0041_v3_account_enrichment.sql`, `backend/src/modules/household/property.service.ts` (new), `backend/src/modules/imports/import-file-binding.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/household/household.routes.ts`, `backend/src/modules/reports/balance-sheet.service.ts`, `backend/src/modules/insights/insight-prompt.service.ts`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/NetWorthPage.tsx`, `frontend/src/pages/DashboardPageV2.tsx`

---

## FIX-168 / DB-040 (2026-05-10): Transfer ambiguity — debit-only items, excluded flag, live candidates (B-1/B-2/B-3)

**Why:** Three interconnected transfer detection bugs blocked users from resolving ambiguous transfer pairs:
- **B-1:** "Confirm as transfer" button never appeared — confirm logic required `creditId` (singular) in reason JSON, but ingest always wrote `creditCandidateIds` (plural array). Additionally, resolution items were created for every involved transaction (debit + all credits) creating queue noise.
- **B-2:** Dismissed "Not a transfer" items re-surfaced on every new import — canonical row had no memory of the dismissal decision.
- **B-3:** Two same-amount transfers on consecutive days each claimed the same two credit candidates — impossible to resolve even if the button had worked.

**What (backend):**
- **Migration 0040:** `transfer_excluded BOOLEAN NOT NULL DEFAULT FALSE` on `transaction_canonical`. Partial index on excluded rows.
- **Ingest (all three ambiguity paths):** Changed to create resolution items for the **debit only** (not the credit candidates). Credits are shown as selectable candidates in the UI instead. `creditCandidateIds` stays in the reason JSON as candidate hints. `transfer_excluded` rows skipped from candidate query so dismissed rows never re-surface. Low-pair-score path now also uses `creditCandidateIds: [credit.id]` (unified shape). Credit→multiple-debits path now creates one item per debit with the credit as the single candidate.
- **`confirmTransferPairForHousehold`:** Accepts explicit `creditId` from caller (user-selected) instead of reading from reason JSON. Validates: credit is posted, unpaired, household matches, abs amounts match within 1¢.
- **`buildResolutionItemRow`:** For `transfer_ambiguity` items, live-queries candidate transactions (`status = posted`, `transfer_group_id IS NULL`) and returns them as `transferCandidates[]` (`id`, `txnDate`, `amount`, `description`, `accountName`). Handles both legacy `creditId` and current `creditCandidateIds` shapes.
- **Dismiss path (`updateResolutionStatusForHousehold` + bulk):** On `resolved` for `transfer_ambiguity`, sets `transfer_excluded = TRUE` on the target canonical row. Prevents re-detection on future imports.
- **`bulkConfirmTransferPairsForHousehold`:** Returns descriptive error for all items — bulk confirm is not supported for ambiguous pairs that require user candidate selection.
- **Route:** `POST /resolution/:id/confirm-transfer` now requires `{ creditId: string (UUID) }` in body (validated with Zod).
- **Tests:** Updated `app.test.ts` to assert debit-only item creation (1 item instead of 3) and verify `creditCandidateIds` shape and target alignment.

**Files:** `backend/db/migrations/0040_transfer_excluded.sql`, `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/src/modules/resolution/resolution.service.ts`, `backend/src/modules/resolution/resolution.routes.ts`, `backend/tests/app.test.ts`

---

## CR-162 (2026-05-09): Needs Review — transfer ambiguity candidate list + confirm body

**Why:** Backend `transfer_ambiguity` resolution items now expose `transferCandidates` so the user can pick the correct other-leg transaction instead of a single implicit pair from `reasonDetail`.

**What:** Extended `ResolutionDetailItem` with optional `transferCandidates`. Replaced the old single “Confirm as transfer” button (gated on `reasonDetail` debit/credit IDs) with a compact Mantine list: date, currency-formatted amount, account name, truncated description, per-candidate `Button variant="light" size="xs"` calling `POST /resolution/:id/confirm-transfer` with `{ creditId: candidate.id }`. Empty array shows a dimmed hint; missing field leaves confirm UI absent (legacy queue). “Not a transfer” dismiss unchanged. Bulk confirm path untouched.

**Files:** `frontend/src/pages/TransactionsPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-165 (2026-05-09): AI insight refresh — surface rate-limit message with retry countdown

**Why:** When the cooldown 429 fired, the frontend showed the raw string "HTTP 429". The `retryAfterMs` field in the response body was never read.

**What:** `startRefresh` now reads the response body before throwing. On `status === 429` / `code === "RATE_LIMITED"`, it formats a human-readable message: "Analysis was refreshed recently — try again in X minutes." using `retryAfterMs` from the payload (falls back to 5 minutes if absent).

**Files:** `frontend/src/components/FinancialHealthCard.tsx`

---

## FIX-164 (2026-05-09): AI insight cooldown — in-memory Map replaced with DB query (SEC)

**Why:** The per-household cooldown Map reset on every process restart, allowing unbounded OpenAI API calls if the process was restarted frequently. `insight_job` already existed and records every job with `created_at`, making it the authoritative source of truth.

**What:** Replaced `insightRefreshLastByHousehold: Map<string, number>` and the synchronous `refreshCooldownRemainingMs()` with an async DB query against `insight_job` — selects the most recent `created_at` for the household and computes remaining cooldown from that. Removed the post-enqueue `Map.set()` call (no longer needed; the DB row itself is the record). `TEST` mode bypass retained.

**Files:** `backend/src/modules/insights/insights.routes.ts`

---

## FIX-163 (2026-05-08): Net Worth — remove period delta cards re-introduced by Cursor

**Why:** The three ASSETS/LIABILITIES/NET WORTH delta summary cards (period-over-period change) were removed in the V2 design pass. Cursor's CR-161 commit left them in the file — they had always been present in the source but never rendered before because the user had no full 3-month history with non-null values at both endpoints. Once real balance history existed, they re-appeared. User confirmed they should be gone.

**What:** Removed `periodSummary` useMemo and its three-card JSX block. Also removed the now-unused `formatSignedDelta` helper.

**Files:** `frontend/src/pages/NetWorthPage.tsx`

---

## FIX-162 (2026-05-08): Net Worth — per-account balance history chart expand now works correctly

**Why:** Cursor's CR-161 implementation had three bugs that made the expand-on-click feature completely non-functional: (1) the API call was missing the required `from` and `to` query params, so every request returned 400 and every account landed in the failed state showing "No balance history available". (2) The data mapping read `p.month` (undefined) instead of the actual field `p.asOf` for the X-axis label. (3) A fabricated `AccountHistoryResponse` type was used instead of the existing `BalanceSheetHistoryResponse`. A fourth UX issue: `showNoHistory` fired immediately on first expand (before loading started) because it only checked `historyPoints.length === 0`, not whether a fetch had completed.

**What:**
- `loadAccountHistory`: added `from` (12-month lookback) and `to` (today) to the query params.
- Changed mapping from `p.month` → `p.asOf` for chart X-axis.
- Changed `p.accounts?.[0]?.balance` lookup to `p.accounts?.find(a => a.financialAccountId === accountId)?.balance` (correct field, correct account lookup).
- Removed fabricated `AccountHistoryPoint` and `AccountHistoryResponse` types; now uses existing `BalanceSheetHistoryResponse`.
- `showNoHistory` guard now only triggers after a fetch has actually settled (`hasFetched = accountHistoryById.has(id) || accountHistoryFailedIds.has(id)`).

**Files:** `frontend/src/pages/NetWorthPage.tsx`

---

## FIX-160 (2026-05-08): Marcus Online Savings PDF — ACH deposits and summary block now parsed correctly

**Why:** `pdf-parse` does not reconstruct columnar layout. Wrapped ACH deposit lines split across two output lines (date+description on line 1, dollar amounts on line 2), causing all ACH deposits to be silently dropped. The pre-activity summary block (Beginning Balance, Ending Balance, Statement Period) was also not captured.

**What:**
- Added a **pre-scan pass** over the full PDF text to extract `Beginning Balance`, `Ending Balance`, and `Statement Period` date range before entering the activity table.
- Added a **`pendingLine` state machine** in the activity loop: when a date-prefixed line carries fewer than 2 dollar amounts, it is saved as a pending line. The next line that carries ≥2 amounts is joined with the pending line and parsed as one combined row. Extra description-only continuation lines (e.g. "account ****3560") are appended to the pending line and kept accumulating.
- Added `buildStatementBalances()` helper to construct the `BoaStatementBalances` result; table-extracted ending balance / date takes precedence over the summary block values.
- Added 4 new unit tests in `backend/tests/pdf-parsers.test.ts` covering: wrapped ACH deposit rows, multiple wraps in one statement, summary block extraction (beginning/ending/period), and no spurious balance rows emitted.

**Files:** `backend/src/modules/imports/profiles/marcus-online-savings-pdf.ts`, `backend/tests/pdf-parsers.test.ts`

---

## CR-161 (2026-05-08): Net Worth account rows now expand inline to show per-account balance history

**Why:** Net Worth provided only aggregate trend context. Users needed quick account-level history without leaving the page, especially when validating balance changes account-by-account.

**What:**
- Added expand/collapse support on individual asset/liability rows in `NetWorthPage` using chevron toggles and per-row expanded state (multiple rows can stay open).
- Implemented lazy per-account history loading on first expand via `GET /reports/balance-sheet/history?accountIds=<id>&interval=month`.
- Added in-memory cache for fetched account history so repeated expands do not refetch.
- Rendered an inline 120px `LineChart` in an expanded `<tr>` (`colSpan=5`) with month axis, currency-formatted y-axis/tooltip, and balance line series.
- Added expanded-row fallback states: loading `Skeleton`, and dimmed `No balance history available` message for empty/error responses.

**Files:** `frontend/src/pages/NetWorthPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## FIX-159 (2026-05-09): LedgerCategoryPicker Mantine migration + Add Group/Subcategory fully fixed

**Why:** `LedgerCategoryPicker` had three bugs introduced during partial migration:
1. Footer actions and error text still used custom CSS (`className="row"`, `className="secondary"`, `className="error"`).
2. "Add group" and "Add subcategory" both called `window.prompt()` — a browser native dialog that doesn't respect the app's Mantine theme.
3. "Add subcategory" was permanently disabled in Needs Review where `value={null}`, AND even when enabled it did nothing — `onActiveParentChange` emitted the picker's internal label-derived key (e.g. `"food & dining"`) rather than the category UUID, so `byId.get(activeParentIdFromPicker)` always returned `undefined` and the create call silently exited.

**What:**
- Migrated `LedgerCategoryPicker` footer and error from custom CSS to Mantine: `Box`, `Group justify="space-between"`, `Button variant="default" size="xs"`, `Text c="red" size="xs" mt={4}`.
- Replaced both `window.prompt()` calls with a Mantine `Modal` + `TextInput`. "Add group" and "Add subcategory" open the modal; Enter key or "Create" button submits; loading state shown on the button during API call.
- Fixed `HierarchicalSearchPicker.onActiveParentChange` to emit `activeParent?.selectableValue` (the actual category UUID) instead of `activeParentId` (the internal lowercased label key). `selectableValue` is populated from "General" group items in `buildCategoryAssignmentGroups` and is always the database UUID.
- "Add subcategory" enabled state and parent resolution now use `activeParentIdFromPicker ?? selectedParentId`, so hovering any parent group enables the button and targets the correct parent regardless of whether a category is pre-selected.

**Files:** `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/components/LedgerCategoryPicker.tsx`, `docs/CHANGE_HISTORY.md`

---

## FIX-158 (2026-05-08): Import "Belongs To" now auto-set from account's owner when account is selected

**Why:** In the import binding table, selecting a financial account did not update the "Belongs To" (owner scope) field. Four separate code paths all read `ownerScope` from the existing draft state or from the user's role instead of from the selected/matched account's own `owner_scope`. Accounts scoped to a specific person were silently ignored — the field defaulted to "Household" every time, requiring a manual correction.

**What:**
- Added `owner_scope` and `owner_person_profile_id` to the frontend `FinancialAccount` type (fields already returned by `GET /imports/accounts` but missing from the type).
- **`onAccountChange` — three branches** (inferred profile, payslip + multi-employer, fallthrough): `nextOwnerScope` and `nextOwnerPersonProfileId` now read from `account.owner_scope` / `account.owner_person_profile_id` first, falling back to the existing draft.
- **OFX auto-bind block**: looks up the matched account from `accRes.accounts` (the locally fetched array, not the `accounts` state variable — adding state to the `loadDetail` dep array caused an infinite re-render loop) and uses its `owner_scope` / `owner_person_profile_id`; falls back to role-based logic only when the account is not found.
- **Inline account creation flow**: after creating a new account, `ownerScope` now reads from `freshAccount.owner_scope` / `freshAccount.owner_person_profile_id` rather than the stale draft, so "Belongs To" is correctly set for newly created accounts too.

**Behaviour after fix:** Selecting or creating any account with `owner_scope: "person"` in the import binding table immediately sets "Belongs To" to that person. OFX auto-detect honours the matched account's owner. Household-scoped accounts continue to default to "Household". User can still override manually.

**Files:** `frontend/src/pages/ImportWorkspacePage.tsx`, `docs/CHANGE_HISTORY.md`

---

## FIX-157 (2026-05-08): Payslip list sorted by pay period, not upload time

**Why:** `GET /payslips` returned stubs sorted by `created_at DESC` (upload order). Payslips uploaded out of chronological order (backfilling older stubs, re-uploads) appeared randomly interspersed with recent ones.

**What:** Changed `ORDER BY` in `listPayslipSnapshots` to `pay_period_end DESC NULLS LAST, pay_period_start DESC NULLS LAST, created_at DESC, id DESC`. Pay period end date is the primary sort; start date breaks ties (mid-period vs end-of-period stubs); upload time is the final tiebreaker. `NULLS LAST` keeps stubs with no period dates at the bottom rather than the top.

**Files:** `backend/src/modules/payslip/payslip.service.ts`, `docs/CHANGE_HISTORY.md`

---

## FIX-156 (2026-05-07): Request logger now uses correct log level per HTTP status code

**Why:** `requestLoggerMiddleware` in `app.ts` called `log.info()` for every HTTP response unconditionally. 5xx responses (including proxy 504s) were logged at INFO, making them invisible when `LOG_LEVEL=warn` or `LOG_LEVEL=error`. Errors were effectively silent at the HTTP layer.

**What:** Added status-code-based log level selection in `requestLoggerMiddleware`:
- `>= 400` (4xx and 5xx) → `log.error` — visible at production `LOG_LEVEL=error`
- `2xx` / `3xx` → `log.info` (unchanged)

**Files:** `backend/src/app.ts`, `docs/CHANGE_HISTORY.md`

---

## SEC-155 (2026-05-07): GDrive OAuth scope narrowed to drive.file + drive.metadata.readonly

**Why:** Post-review analysis confirmed all backup files are app-created (.hfb uploaded by the app itself). `drive.file` covers create/list/download/delete on app-created files. The only non-app-owned resource is the user-supplied folder — `files.get(folderId)` to verify it exists needs `drive.metadata.readonly` (metadata only, no file content). Together these are significantly narrower than the original `drive` scope.

**What:**
- OAuth consent URL scope changed from `["drive"]` to `["drive.file", "drive.metadata.readonly"]`.
- Code comment explains the scope split and what each covers.
- Existing refresh tokens issued under the old `drive` scope remain functional at the Google API level; new OAuth flows will request the narrower pair. Users can disconnect and reconnect via Settings → Data to downgrade to the narrower token.

**Post-merge backlog created:** `docs/SECURITY_HARDENING_BACKLOG.md` — tracks remaining deferred items from the pre-merge review (insight cooldown, token cleanup, Drive query escaping, etc.).

**Files:** `backend/src/modules/gdrive/gdrive.service.ts`, `docs/SECURITY_HARDENING_BACKLOG.md`, `docs/EXPORT_IMPORT_BACKLOG.md`, `docs/CHANGE_HISTORY.md`

---

## SEC-154 (2026-05-06): GDrive refresh token encrypted at rest; OAuth scope corrected

**Why:** Pre-merge review identified two related risks: (1) the OAuth refresh token was stored as plaintext in `household_gdrive_config`; (2) the scope was too broad (`drive`). A scope change to `drive.file` was initially applied but reverted — `drive.file` only covers files the app created via the API and cannot access arbitrary user-supplied folders. The correct mitigation is encrypting the long-lived token, not restricting scope to a value that breaks functionality.

**What:**
- **Refresh token encrypted at rest** — `connectGDrive` now encrypts the token with AES-256-GCM before storing it. `getGDriveCredentials` decrypts on read. Format: `base64(iv[12] || authTag[16] || ciphertext)`. Key is `SHA-256("household-finance:gdrive-token:" || JWT_SECRET)` — dedicated purpose, separate from `BACKUP_ENCRYPTION_KEY`. (`backend/src/modules/gdrive/gdrive.service.ts`)
- **Graceful fallback for pre-encryption deployments** — if decryption fails (e.g. a plaintext token from before this change), `getGDriveCredentials` returns `null` (Drive shown as "not configured"). The user reconnects Drive; no data is lost.
- **OAuth scope `drive` retained with comment** — scope narrowing to `drive.file` was reverted because the app reads/writes an existing user-supplied folder, which requires `drive`. A comment in the source explains why and points to token encryption as the blast-radius mitigation.
- **Test updated** — `gdrive.test.ts` now asserts the stored token is not the raw plaintext (is non-empty and differs from the input), which is the correct post-encryption invariant.

**Files:** `backend/src/modules/gdrive/gdrive.service.ts`, `backend/tests/gdrive.test.ts`, `docs/CHANGE_HISTORY.md`

---

## SEC-153 (2026-05-06): Pre-merge security and hardening fixes

**Why:** Pre-merge review of v2 identified several security and correctness issues before merging to main.

**What:**
- **Drive OAuth scope narrowed** — changed from `drive` (full Drive access) to `drive.file` (only files the app creates). Limits blast radius if the refresh token is ever compromised. (`backend/src/modules/gdrive/gdrive.service.ts`)
- **`storagePath` removed from export download error response** — the 404 JSON for a missing/not-ready export was leaking an absolute server filesystem path to API clients. Removed. (`backend/src/modules/export/exports.routes.ts`)
- **`generateTempPassword` uses `crypto.randomBytes`** — replaced `Math.random()` with `randomBytes(4)` per group; consistent with how `createPasswordResetToken` uses `webcrypto`. (`backend/src/modules/household/household.service.ts`)
- **JWT_SECRET default rejected in PROD** — added a startup guard that throws if `MODE=PROD` and `JWT_SECRET` is still the hardcoded dev default. Prevents silent insecure deployments. (`backend/src/config/env.ts`)
- **Recurring overrides require admin/owner role** — `POST /recurring-overrides` and `DELETE /recurring-overrides/:id` now require `requireRole(['owner', 'admin'])`. Read (`GET`) remains accessible to all authenticated members. (`backend/src/modules/recurring/recurring.routes.ts`)
- **Lint: 3 unused imports/vars in tests** — removed unused `beforeAll` from `category-rule-learning.test.ts`, unused `afterAll` from `payslip-upload.test.ts`, and unused `SEED_BOA_CHECKING` constant from `rbac.test.ts`.
- **Test: `waitForExportComplete` hardened** — replaced inner `expect(poll.status).toBe(200)` with a throw (gives a clearer error on 401/5xx) and added a 50ms inter-poll delay to reduce ordering sensitivity in the full suite. (`backend/tests/app.test.ts`)
- **CLAUDE.md: Anthropic SDK note** — clarified that `@anthropic-ai/sdk` is retained for the AI insights pipeline (`LLM_PROVIDER=anthropic`), not just for categorization (which was removed). Prevents future sessions from incorrectly removing the dependency.
- **CHANGE_HISTORY UX-151: remove stale "still to migrate" note** — UX-152 completed the work; the stale bullet has been removed.

**Files:** `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/export/exports.routes.ts`, `backend/src/modules/household/household.service.ts`, `backend/src/config/env.ts`, `backend/src/modules/recurring/recurring.routes.ts`, `backend/tests/category-rule-learning.test.ts`, `backend/tests/payslip-upload.test.ts`, `backend/tests/rbac.test.ts`, `backend/tests/app.test.ts`, `CLAUDE.md`, `docs/CHANGE_HISTORY.md`

---

## UX-152 (2026-05-06): SettingsPage ConfirmDialog messages migrated to Mantine

**Why:** The remove-member and reset-password confirmation dialogs still rendered `message` content with raw HTML (`<div>/<p>` plus inline style objects), which diverged from the Mantine-only UI surface target.

**What:**
- Replaced remove-member dialog `message` wrapper from raw `<div style={...}>` to Mantine `Stack`.
- Replaced custom red/amber styled warning blocks with Mantine `Alert color="red"` and `Alert color="yellow"`.
- Replaced confirmation text `<p style={...}>` with Mantine `Text size="sm"`.
- Replaced reset-password dialog `message` `<p style={...}>` with Mantine `Text size="sm"`.
- Kept all logic/state/handlers/API behavior unchanged (UI-surface-only change).

**Files:** `frontend/src/pages/SettingsPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-151 (2026-05-06): Mantine migration — codified intentional non-Mantine exceptions

**Why:** After the full Mantine migration pass (UX-145–UX-150) an audit flagged several patterns as "remaining native HTML." Some are legitimate exceptions that should not be migrated; documenting them here prevents future sessions from treating them as bugs.

**Codified exceptions (do not migrate):**

| Location | Pattern | Reason |
|---|---|---|
| `HomePage.tsx` — `home-landing__*` classes | Branded landing shell: `.home-landing`, `.home-landing__glow`, `.home-landing__grid`, `.home-landing__hero`, `.home-landing__pills`, etc. | Custom designed marketing/branding layout. CSS-driven glow animation, two-column hero grid, and pill badges are intentional visual design. The interactive auth surface (sign-in card, forgot-password) is fully Mantine. Do not replace with Mantine `Grid`/`Stack`. |
| `ImportWorkspacePage.tsx` — `<input type="file" multiple>` | Native file input element | No Mantine equivalent that preserves multi-file OS picker UX. `FileButton` changes the interaction model. Keep as bare `<input>`. |
| Any `Box` or layout element — `style={{ zIndex: N }}` | Inline z-index | Mantine v7 `Box` has no `zIndex` prop; `style={{ zIndex }}` is the correct approach. |
| `Box style={{ overflowX: "auto" }}` wrappers | Overflow containers for tables | Mantine has no overflow prop on layout primitives; `style=` is correct here. |
| `Table.Th style={{ letterSpacing }}` | Letter-spacing on headers | `lts` is a Mantine v7 style prop; either form is acceptable. `style={{ letterSpacing }}` is not a migration miss. |
| `Table.Td style={{ minWidth }}` | Column min-widths | `miw=` is the Mantine equivalent but `style={{ minWidth }}` is not a structural native-HTML issue; either is acceptable. |

**Files:** `docs/CHANGE_HISTORY.md`

---

## UX-150 (2026-05-06): ImportWorkspacePage — full Mantine migration (2080 lines, 0% → 100%)

**Why:** Largest frontend page, entirely native HTML — `.card`, `.muted`, custom `<dl>/<dt>/<dd>`, `<table className="ledger-table">`, `<details>/<summary>`, `<button>`, `<select>`, `<input>` throughout. No Mantine imports at start.

**What:**
- Added full Mantine import block: `ActionIcon`, `Alert`, `Anchor`, `Badge`, `Box`, `Button`, `Code`, `Collapse`, `Group`, `List`, `Paper`, `Select`, `SimpleGrid`, `Skeleton`, `Stack`, `Table`, `Text`, `TextInput`, `Title`.
- Added `@tabler/icons-react` icons: `IconArrowBackUp`, `IconChevronDown`, `IconChevronRight`, `IconPlayerPlay`, `IconTrash`, `IconUpload`.
- Replaced `SessionStatusBadge` with Mantine `Badge` (color map: created/gray, processing/blue, review/yellow, finalized/green, failed/red).
- Added `StatRow` helper component for key/value stat display using `Group`/`Text`.
- Added `showPayslipHelp` and `showSeparateSteps` state for controlled `Collapse` toggles.
- **Hub view (no sessionId):** `<div>/<h1>/<h2>/<ul>/<li>` → `Stack > Paper > Group/Title/Alert/Button` for header + session list rows with `Code`/`SessionStatusBadge`/`Anchor`.
- **Session control band:** `<div className="card">` → `Paper` with `Group`/`Title`/`Code`/`Button`/`Alert`.
- **Last import summary:** `<div className="card">` → `Paper` with `List`/`List.Item`/`Text`/`Anchor`.
- **Upload files:** `<div className="card">` → `Paper`; native `<input type="file">` kept (no Mantine equivalent).
- **Files & account table:** `<details>/<summary>` payslip help → `Collapse` + `Anchor` toggle; `<table>` → Mantine `Table withRowBorders`; `<select>` employer → `Select`; advanced format `<select>` → `Select`; OFX hints `<div>/<p>` → `Stack`/`Text`/`Anchor`; inline create-account form `<div style={{ grid }}>` → `Paper withBorder` + `Group`/`Select`/`TextInput`/`Button`; `<button>` remove → `ActionIcon`.
- **Outcomes by file:** `<dl className="import-file-outcome-stats">` → `Stack` with `StatRow` entries; `<div className="import-file-outcomes">` → `SimpleGrid cols={{ base:1, sm:2, lg:3 }}`; `<div className="import-file-outcome-card">` → `Paper withBorder`.
- **Generic tabular mapping:** `<div className="row">/<label>/<input>` → `Group` with 4 `TextInput` components.
- **Run import:** `<button>` → `Button leftSection={<IconPlayerPlay>}`; `<details>/<summary>` separate steps → `Collapse` with `Anchor` toggle + `showSeparateSteps` state; secondary `<button>` → `Button variant="default"`.
- **Classification matcher preview:** `<button>` → `Button variant="default"`; `<span className="muted">` → `Text c="dimmed"`; `<table className="ledger-table">` → Mantine `Table`; `<code>` → `Code fz="xs"`.
- **Undo ledger posting:** `<button className="secondary">` → `Button variant="default" leftSection={<IconArrowBackUp>}`.
- Outer session view `</div>` → `</Stack>`.

**Files:** `frontend/src/pages/ImportWorkspacePage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-149 (2026-05-06): DashboardPageLegacy — remove dead code, clean up V2 toggle

**Why:** The classic view toggle was removed from the UI in a recent commit. `DashboardPageLegacy` was no longer reachable from any UI path. Keeping it added dead weight (1425 lines at 0% Mantine) and a stale import.

**What:**
- Deleted `frontend/src/pages/DashboardPageLegacy.tsx`.
- Removed `DashboardPageLegacy` import from `DashboardPageV2.tsx`.
- Removed `useClassicView` state and all guards from `loadCashSummary`, `loadAll`, and `useEffect`.
- Removed the `if (useClassicView) { return <DashboardPageLegacy /> }` render branch and "Switch to new view" button.
- Removed stale TODO comment referencing the toggle cleanup.

**Files:** `frontend/src/pages/DashboardPageV2.tsx`, `frontend/src/pages/DashboardPageLegacy.tsx` (deleted)

---

## UX-148 (2026-05-06): ResolutionQueuePage — full Mantine migration

**Why:** Page had zero Mantine imports — entirely native HTML (`.card`, `.muted`, `.error`, native `<table>`, `<p>`, `<div>`).

**What:**
- Replaced page wrapper with `Stack` + `Paper withBorder`.
- Replaced `<h1>` with `Title`, `<p className="muted">` with `Text c="dimmed"`, `<p className="error">` with `Alert color="red"`.
- Loading state replaced with `Skeleton`.
- Replaced native `<table>/<thead>/<tbody>/<tr>/<th>/<td>` with Mantine `Table` primitives with uppercase dimmed headers.
- Replaced `<Link>` with `<Anchor component={Link}>` throughout.
- Overflow wrapper `<div>` → `Box`.

**Files:** `frontend/src/pages/ResolutionQueuePage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-147 (2026-05-06): PayslipsPage — migrate custom list rows to Mantine

**Why:** Page shell was Mantine but every payslip list row was a hand-rolled div/span nest with raw CSS vars, inline flex layout, and custom border/padding styles.

**What:**
- Removed `className="payslips-page"` from `Stack`.
- Replaced KPI card `style={{ color: accent }}` with Mantine `c=` color prop and Mantine color tokens for `borderTop`.
- Replaced belongs-to filter `<div>` wrapper with `Box`.
- Replaced entire list row section: `div/span` nest → `Paper withBorder` + `Group`/`Box`/`Text` with Mantine size/fw/c props.
- Actions `<div>` gap wrapper → `Group gap={6}`.

**Files:** `frontend/src/pages/PayslipsPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-146 (2026-05-06): HomePage — migrate sign-in form and auth links to Mantine

**Why:** Sign-in card used native `<input type="email">`, `<input type="password">`, `<label>`, `<button>` (forgot password), raw error `<p className="error">`, and a bare `<div>` auth-links container. Branded hero section intentionally stays custom CSS.

**What:**
- Replaced sign-in card outer `<div className="home-landing__card card">` with `Paper withBorder`.
- Replaced native email input with `TextInput`, password input with `PasswordInput` (shows inline error).
- Removed separate `<p className="error">` — error now passed to `PasswordInput error=` prop.
- `<Button>` already Mantine; removed `className="home-landing__submit"` and `disabled={loading}` → `loading={loading}`.
- Replaced native `<button>` "Forgot password?" links with `<Anchor component="button">`.
- Replaced inline `<div style={...}>` tip box with `Paper withBorder`.
- Replaced `<a>` request-access link with `<Anchor>`.
- Replaced auth-links `<div>/<span>` layout with `Text size="xs"` inline.
- Forgot-password form wrapper `<div>/<form style=...>` → `Stack component="form"`.
- Sign-in form `<form className="...">` → `Stack component="form"`.

**Files:** `frontend/src/pages/HomePage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-145 (2026-05-06): BudgetPage + NetWorthPage — Mantine polish pass

**Why:** Both pages had no `className=` but accumulated native `<div>`, `<span>`, `<form>` remnants from earlier migrations, plus raw CSS var color strings instead of Mantine color props.

**BudgetPage changes:**
- Added `Box` to imports.
- Overflow `<div style={{ overflowX: "auto" }}>` (×2) → `Box`.
- Spacer `<span style={{ width: 22 }}>` → `Box w={22}`.
- Inline `<span title="...">` annotations → `Text span`.
- `leftSection={<span>$</span>}` → `Text size="xs"`.
- Progress bar `<div style={{ flex: 1 }}>` → `Box`.
- Bottom Edit button wrapper `<div>` → `Group`.

**NetWorthPage changes:**
- Chart container `<div style={{ width: "100%", height: 340 }}>` → `Box`.
- Both overflow `<div style={{ overflowX: "auto" }}>` → `Box`.
- Both inline-edit `<form onSubmit={saveRow}>` → `Group component="form" onSubmit={saveRow}` (no wrapper needed).
- Recharts tooltip `<div>/<span>` → `Text`/`Text span` with Mantine size/fw props.
- Top-assets/liabilities section `<div>/<div style=...>` header → `Box` + `Text fz={11} fw={600} tt="uppercase" lts="0.05em" c="dimmed"`.

**Files:** `frontend/src/pages/BudgetPage.tsx`, `frontend/src/pages/NetWorthPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-146 (2026-05-06): Transactions page — full Mantine UI migration

**Why:** `TransactionsPage` still relied on mixed native controls and class/style-driven wrappers in key interaction areas, which diverged from the Mantine-first visual system and led to inconsistent theming.

**What:**
- Replaced remaining native/class-based sections with Mantine primitives across the full page surface: bulk bars, action rows, ledger table cells/actions, expanded review detail panels, and add-transaction modal.
- Replaced native form/table controls with Mantine components (`TextInput`, `NativeSelect`, `Checkbox`, `Radio.Group`, `Button`, `ActionIcon`, `Table.*`, `Modal`, `Alert`, `Badge`, layout `Stack/Group/Box/SimpleGrid/Paper`).
- Removed remaining `muted/error/card` class-based rendering on `TransactionsPage` and reduced inline styles to unavoidable cases.
- Preserved all logic, handlers, state transitions, API calls, and routing/query-param behavior.

**Files:** `frontend/src/pages/TransactionsPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-144 (2026-05-06): Payslip detail page — Mantine-only body migration

**Why:** `PayslipDetailPage` had a Mantine shell but the core interaction surface (summary inline edits, line-item edit/delete flows, section tables, matched deposit table, diagnostics toggles) still used native HTML controls and custom inline/class styling, causing inconsistent theming behavior.

**What:**
- Replaced native `<input>/<select>/<button>` in the detail body with Mantine `TextInput`, `NumberInput`, `Select`, `Button`, and `ActionIcon`.
- Replaced all native table markup in the detail body with Mantine `Table` primitives (`Table.Thead`, `Table.Tbody`, `Table.Tr`, `Table.Th`, `Table.Td`).
- Replaced raw layout wrappers and class/style-driven text with Mantine `Stack`, `Group`, `Box`, `Text`, `Alert`, and `Code`.
- Replaced native disclosure blocks (`details/summary`) with controlled Mantine button toggles for line-item sections and parser diagnostics.
- Preserved all existing state, handlers, API calls, and routing behavior.

**Files:** `frontend/src/pages/PayslipDetailPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-143 (2026-05-06): Payslip manual entry page — Mantine-only UI migration

**Why:** `PayslipManualPage` still used native form controls (`input`, `select`, `table`, `details`) and mixed custom layout/styling patterns, which prevented consistent theme/dark-mode behavior and diverged from the Mantine-only frontend direction.

**What:**
- Replaced native form controls with Mantine components (`TextInput`, `NumberInput`, `Select`, `Button`, `ActionIcon`).
- Replaced native table markup with Mantine `Table` primitives for both summary amounts and optional line-item rows.
- Replaced raw layout containers with Mantine layout primitives (`Stack`, `Group`, `Box`) and removed class-based/error-muted text rendering in favor of Mantine `Text`/`Alert`.
- Replaced `<form>` wrapper with Mantine form wrapper (`<Stack component="form">`).
- Replaced `<details>/<summary>` line-item section with controlled Mantine toggle UI and retained all existing data/submit behavior.

**Files:** `frontend/src/pages/PayslipManualPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-142 (2026-05-06): BudgetPage — full Mantine migration + setup table UX fixes

**Why:** BudgetPage had zero Mantine usage — all layout was raw HTML with inline styles and two custom CSS classes (`budget-kpi-grid`, `card`). Setup table had three UX issues: input box was left-aligned in its column, the × remove button felt visually detached from its row, and the ►/▲ expand chevrons used the wrong convention (▼ on a collapsed row is ambiguous).

**What:**
- **Full Mantine migration:** Replaced all raw `<button>`, `<input>`, `<select>`, `<table>`, `<h1/h2>`, layout `<div>` elements with Mantine equivalents (`Button`, `ActionIcon`, `NumberInput`, `Select`, `Table.*`, `Title`, `Stack`, `Group`, `SimpleGrid`, `Paper`, `Progress`, `Text`).
- **Custom CSS removed:** `budget-kpi-grid` block (and its `@media` rule) removed from `index.css`; replaced by `<SimpleGrid cols={{ base: 1, sm: 3 }}>`.
- **`card` className removed:** Replaced by `<Paper p="md" withBorder radius="md">` throughout.
- **Setup table — 4→3 columns:** Merged the separate action column into the "Your budget" column. Input + × icon now sit together in a right-aligned `<Group justify="flex-end">`, so the remove button is adjacent to the value it deletes.
- **Input alignment fixed:** `NumberInput` now right-aligns within the cell via `Group justify="flex-end"`.
- **Chevron semantics fixed:** Expand/collapse button changed from text ▼/▲ to `IconChevronRight` (collapsed) / `IconChevronDown` (expanded) — standard tree/accordion convention.
- **`ProgressBar` component:** Replaced custom div with Mantine `<Progress>`.
- **`AmountInput` component:** Replaced raw `<input type="number">` with Mantine `<NumberInput hideControls>`.
- **`NavBtn` component:** Replaced raw `<button>` with `<ActionIcon variant="default">`.

**Files:** `frontend/src/pages/BudgetPage.tsx`, `frontend/src/index.css`

---

## UX-141 (2026-05-06): Category accordion layout + deletion UX fixes + remove Classic view link

**Why:** The flat parent/child table required heavy scrolling and made hierarchy ambiguous. Deleting a parent category with subcategories silently failed (409 in devtools, no visible error — error rendered behind the ConfirmDialog or at the top of a long page). Dashboard "Classic view" button was kept alive past its useful life.

**What:**
- **Accordion layout:** "All categories" section replaced flat `<Table>` with a Mantine `<Accordion multiple>`. Each parent group is one collapsible item; its label shows name + source badge + subcategory count + edit/delete actions. Children are listed in a compact table inside the panel. Dramatically reduces page scroll.
- **Parent with children — blocked delete modal:** Delete button pre-checks `categoryHasChildren()` client-side; if true, opens a focused `<Modal>` ("Delete or move all subcategories first") instead of the silent 409 or a page-level error behind the old dialog.
- **Error visibility:** Removed `throw err` from `confirmDeleteCategory` — errors now surface on the page after the dialog closes.
- **Page-level error close button:** Added `withCloseButton` to the top-level `<Alert>` so errors can be dismissed.
- **Classic view button removed:** `DashboardPageV2.tsx` no longer renders the "Classic view" toggle. `DashboardPageLegacy` and `useClassicView` state retained for future cleanup (TODO comment added).

**Files:** `frontend/src/pages/CategoriesPage.tsx`, `frontend/src/pages/DashboardPageV2.tsx`, `docs/CHANGE_HISTORY.md`

---

## UX-140 (2026-05-06): Mantine migration + bug fixes — CategoriesPage and CategoryRulesPage

**Why:** Both pages retained custom CSS, hand-rolled dialogs, and raw HTML form elements. Bugs: permission gap where `member`-role users could see delete buttons on household child categories; dead ternary code; inline rule editing collapsed multi-line patterns; CSV file input didn't reset after import; `runTest` fired on empty input; `<details>` collapsed on every `load()` re-render.

**What:**
- **Permission gap (CategoriesPage):** Child delete button now gates on `c.householdScoped && canManageCategories` (was missing `canManageCategories`).
- **Dead code (CategoriesPage):** Two dead ternaries and `canEditBuiltIns` tautology alias removed.
- **Inline edit pattern corruption (CategoryRulesPage):** Changed from `<input>` to `<Textarea autosize>` — multi-line patterns no longer collapsed on edit.
- **File input reset (CategoryRulesPage):** Controlled `selectedFile` state; `<FileInput>` cleared on successful import.
- **`runTest` guard:** Rejects empty description before hitting the API.
- **`<details>` state reset:** Replaced with controlled `<Accordion multiple value={openedSections}>` — open state survives `load()` re-renders.
- **Mantine migration:** `Modal`, `Badge`, `Radio.Group`, `Select`, `TextInput`, `Table` (+`ScrollContainer`), `ActionIcon`, `Paper`, `Accordion`, `FileInput`, `Textarea`, `NumberInput`, `Checkbox`, `Code`, `Alert`, `Skeleton`, `Anchor`.
- **CSS cleanup:** Removed all `categories-page__*` and `category-rules-page__*` classes including dark-mode overrides.

**Files:** `frontend/src/pages/CategoriesPage.tsx`, `frontend/src/pages/CategoryRulesPage.tsx`, `frontend/src/index.css`

---

## UX-139 (2026-05-06): Net Worth page — remove misleading account links, fix type labels, full Mantine migration

**Why:** Account names in the Assets/Liabilities tables were wrapped in `<Link>` that drilled to `/transactions` filtered to a single as-of date, which almost always returned zero results. The "Transactions from import file" sub-link had the same problem. The Type column surfaced raw DB enum values (`credit_card`, `investment`) instead of human-readable labels. Several non-Mantine patterns remained: raw `<table>`, custom `<button>` with hand-rolled CSS, raw `<input type="date">`, and a `<details>/<summary>` for the bulk re-date section.

**What:**
- **Account names** are now plain text — no link.
- **"Transactions from import file"** sub-link removed entirely.
- **`transactionsHref`** helper removed (no longer used on this page).
- **Type column** now displays human-readable labels via `formatAccountType()` (`credit_card` → "Credit Card", `checking` → "Checking", etc.).
- **Tables** migrated from `<table className="ledger-table">` to Mantine `Table` with `withTableBorder` + `withRowBorders`.
- **Edit icon** migrated from `<button className="net-worth-page__edit-icon">` to Mantine `ActionIcon variant="subtle"`.
- **Inline edit form** migrated from `<form className="row">` to `<form>` with Mantine `Group`.
- **Date inputs** (snapshot date, custom range, inline edit, bulk re-date) migrated from raw `<input type="date">` to Mantine `TextInput type="date"`.
- **Bulk re-date section** migrated from `<details>/<summary>` to Mantine `Collapse` with a toggle `Button`.
- **CSS** — removed `net-worth-page`, `net-worth-page__edit-icon`, `net-worth-page__edit-icon:hover`, `net-worth-page__bulk-asof > summary` rules from `index.css`; removed orphaned `.net-worth-page__edit-icon` entry from the `@media (hover: none)` block.

**Files:** `frontend/src/pages/NetWorthPage.tsx`, `frontend/src/index.css`

---

## FIX-138 (2026-05-05): v2 doc accuracy + restore hardening (Claude/Cursor punch list)

**Why:** Operators and future sessions were misled by stale **ZIP / exportVersion 3** copy, missing **CHECKPOINT/MVP** pointers on the archived PRD, backlog headers that contradicted shipped mobile/recurring/import work, and two small restore hygiene gaps called out in **`docs/EXPORT_IMPORT_BACKLOG.md`**.

**What:**
- **Docs:** **`docs/RUNBOOK.md`** — `.hfb`, **`exportVersion` 4**, Settings → **Data**; **`CLAUDE.md`** export row; **`docs/API_GDRIVE.md`** preview example; **`docs/archive/FINANCE_APP_PRD.md`** — implementation-status line + **§19** backup format (**.hfb** / v4) instead of removed CHECKPOINT/MVP pointers and stale ZIP/v3 copy; **`docs/USER_GUIDE.md`** backup bullet; **`docs/DATABASE_ARCHITECTURE.md`** — **DB-136** squashed baseline + archive pointer; **`docs/MOBILE_UX_BACKLOG.md`**, **`docs/RECURRING_PAYMENTS_BACKLOG.md`**, **`docs/IMPORT_PIPELINE_SIMPLIFICATION_BACKLOG.md`**, **`docs/EXPORT_IMPORT_BACKLOG.md`** — status headers aligned with shipped reality.
- **Code:** **`restore-insert-validation.ts`** — enforce lowercase snake_case column keys before dynamic `INSERT` during restore; **`exports.routes.ts`** — **`unlinkSync`** on **`POST /exports/household/import`** when extension is not `.hfb`.
- **Tests:** **`backend/tests/restore-insert-validation.test.ts`**.

**Files:** `backend/src/modules/export/restore-insert-validation.ts`, `backend/src/modules/export/import-household-bundle.service.ts`, `backend/src/modules/export/exports.routes.ts`, `backend/tests/restore-insert-validation.test.ts`, `docs/RUNBOOK.md`, `CLAUDE.md`, `docs/API_GDRIVE.md`, `docs/archive/FINANCE_APP_PRD.md`, `docs/USER_GUIDE.md`, `docs/DATABASE_ARCHITECTURE.md`, `docs/MOBILE_UX_BACKLOG.md`, `docs/RECURRING_PAYMENTS_BACKLOG.md`, `docs/IMPORT_PIPELINE_SIMPLIFICATION_BACKLOG.md`, `docs/EXPORT_IMPORT_BACKLOG.md`, `docs/CHANGE_HISTORY.md`

---

## FIX-137 (2026-05-06): Expand test coverage — rule learning, RBAC, payslip deposits, ledger filters, recurring overrides

**Why:** Pre-release coverage audit identified five gaps: (1) category rule learning endpoints had zero tests; (2) RBAC was only tested at the coarse "member blocked from household routes" level with no admin role tests and no positive member permission tests; (3) `matchedDeposits` on `GET /payslips/:id` (CR-068) was shipped but never asserted in tests; (4) ledger filter parameters (dateFrom/dateTo, accountId, amountMin/Max, trashOnly) were exercised only implicitly via the full import pipeline tests; (5) recurring override validation and household isolation had no dedicated tests.

**What:**
- `backend/tests/category-rule-learning.test.ts` — 9 new tests: auth guard + 404 + invalid body + classification preview happy path (verifies PAYROLL classifies as Salary) + cross-household isolation; `from-ledger` auth/RBAC/404/parent-category/happy-path
- `backend/tests/rbac.test.ts` — 15 new tests covering: member CAN read transactions/cash-summary/budget/categories; member CANNOT call rule write endpoints (PATCH/DELETE/recategorize/from-ledger/household-clear) or bulk-reassign-owner; admin CAN manage members/settings/rules/gdrive-status; admin CANNOT restore/export-preview/gdrive-connect/gdrive-disconnect
- `backend/tests/ledger-filters.test.ts` — 11 new tests using an isolated test household: dateFrom, dateTo, dateFrom+dateTo, accountId (two accounts), amountMin, amountMax, amountMin+amountMax, trashOnly (include/exclude), combined accountId+dateFrom, and two input-validation 400 errors
- `backend/tests/payslip-upload.test.ts` — updated existing "returns full snapshot after upload" to assert `matchedDeposits` and `validationWarnings` are arrays; added 2 new tests verifying deposit match within ±3 days/1% tolerance and exclusion outside the window
- `backend/tests/recurring-overrides.test.ts` — added 4 validation tests (missing merchantKey, missing verdict, invalid verdict enum, whitespace merchantKey) and 2 household isolation tests

**Result:** Tests grow from ~397 to 422 backend tests; all pass.

---

## DB-136 (2026-05-05): Squash 33 migrations into single baseline

**Why:** 33 migration files had accumulated since v1, including redundant constraint-drop/re-add patterns, 3 dead columns (0003 `unstructured_*` — zero code references), 3 data migrations already covered by bootstrap, and one pure no-op (0039). Squashing simplifies fresh-install setup and makes the schema readable in one place.

**What:**
- Replaced `backend/db/migrations/0001_baseline.sql` with a single squashed file representing the complete final schema post-0039.
- Archived `0002–0039` to `backend/db/migrations/archive/` — not deleted, preserved for historical reference.
- **Squash decisions applied:**
  - `transaction_canonical.status`: final form (includes `'trashed'`)
  - `uq_transaction_canonical_fingerprint`: partial index (`WHERE status NOT IN ('duplicate', 'trashed')`)
  - `financial_account.type`: final form (includes `'retirement'`)
  - `export_job.status`: final form (includes `'expired'`)
  - `household_gdrive_config`: final form — `connected_by_user_id` nullable ON DELETE SET NULL, scheduler columns, `oauth2_refresh_token` only (no `service_account_json`)
  - 0003 `unstructured_*` columns on `import_file`: omitted (confirmed dead — zero references in backend/src/)
  - 0013/0014/0015 category INSERTs: omitted (already in `0001_bootstrap.sql`)
  - 0032 index: folded into `insight_job` table definition
  - 0039 DROP COLUMN: omitted (columns `oauth2_access_token*` were never added by any migration)
  - All 9 performance indexes from 0021 included
- **Existing DBs:** safe — migration runner tracks by filename; `0001_baseline.sql` is already recorded in `schema_migrations`, so it is skipped. Files 0002–0039 are gone from the active directory and are not re-evaluated.
- **Verified:** `npm run db:reset:dev` applied the squashed baseline cleanly (26 tables); `npm run test -w backend` — 371/371 tests passed.

**Files:** `backend/db/migrations/0001_baseline.sql`, `backend/db/migrations/archive/` (0002–0039), `docs/CHANGE_HISTORY.md`

---

## CR-135 (2026-05-05): Unified Backup & Restore UI + Drive file preview endpoint
**Why:** Manual (device) backup/restore and Google Drive backup/restore were two separate UI flows with duplicated logic. Device restore had a preview step; Drive restore did not — users had to restore blind. Unifying into one component gives a consistent preview-then-confirm flow for both paths.
**What:**
- **New endpoint `POST /gdrive/backups/:fileId/preview`** (owner only): downloads the named Drive file to a temp path, calls the shared `readHfbManifestFromFile()`, returns the same preview shape as `POST /exports/preview`, always deletes the temp file. Errors: 409 if not connected, 404/403/502 for Drive download failures, 422 for encrypted-no-key.
- **`readHfbManifestFromFile(filePath)`** extracted to `import-household-bundle.service.ts` as a named export (decrypts if encrypted, unzips, reads `manifest.json`, returns `HfbManifestPreview`). Both `/exports/preview` and the new Drive preview route share it.
- **`BackupRestoreSection`** new component (`frontend/src/pages/settings/BackupRestoreSection.tsx`): owns all backup/restore state. "Create Backup" section covers device download and Drive upload. "Restore" section has a `SegmentedControl` to switch between device file and Drive file restore — both paths go through the same preview modal before confirming. Compact Drive footer shows connection status, scheduler settings, connect/disconnect.
- **`SettingsPage`** refactored: data tab replaced with `<BackupRestoreSection authRole={authRole} active={tab === "data"} />`. Removed ~500 lines of backup/gdrive state, effects, handlers, and UI. Added back `Table`, `Modal`, `SegmentedControl` imports; removed `Badge`, unused backup-only symbols.
- **OAuth callback redirect fix**: `buildSettingsGdriveRedirectUrl` now builds `/settings?tab=data&gdrive=connected` (BrowserRouter path) instead of `/#/settings?…` (which BrowserRouter ignored, always rendering the home route). Meta-refresh HTML used instead of inline script (CSP-safe).
**Files:** `backend/src/modules/export/import-household-bundle.service.ts`, `backend/src/modules/export/exports.routes.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `backend/src/modules/gdrive/gdrive.service.ts`, `backend/tests/gdrive.test.ts`, `frontend/src/pages/settings/BackupRestoreSection.tsx`, `frontend/src/pages/SettingsPage.tsx`, `openapi/openapi.yaml`, `docs/API_GDRIVE.md`, `docs/CHANGE_HISTORY.md`

---

## CR-134 (2026-05-04): GDrive OAuth return URL + MODE-scoped backup folder on Drive
**Why:** OAuth **`Location`** was relative (`/#/settings?…`), so the browser resolved it on the **API** host (e.g. :4000) instead of the Vite SPA (:3000). Backups also needed to live under **`{configuredFolder}/TEST/`** or **`/PROD/`** per server **`MODE`** so environments do not mix in Drive.
**What:** **`FRONTEND_APP_URL`** env (optional); **`resolveSpaOriginForGdriveRedirect()`** picks **`FRONTEND_APP_URL` → `PUBLIC_BASE_URL` → `http://localhost:3000` in `MODE=TEST` → else relative** for **`buildSettingsGdriveRedirectUrl`**. **`gdrive-backup.service`**: **`ensureDriveBackupEnvSubfolderId`** lists/creates **`TEST`** or **`PROD`** under the configured folder; list/upload/prune use that id.
**Files:** `backend/src/config/env.ts`, `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `backend/tests/gdrive.test.ts`, `backend/tests/gdrive-backup.test.ts`, `backend/tests/gdrive-restore.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `.env.example`, `openapi/openapi.yaml`, `docs/API_GDRIVE.md`, `docs/API_INDEX.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/CHANGE_HISTORY.md`

---

## CR-133 (2026-05-04): Replace GDrive service account auth with OAuth2 user-delegated auth
**Why:** Service accounts have no Drive storage quota; uploads to a personal Gmail user’s folder fail with **`storageQuotaExceeded`** (403). OAuth2 with a user refresh token stores backups under the user’s quota.
**What:** Migration **`0038_gdrive_oauth2.sql`** drops **`service_account_json`**, adds **`oauth2_refresh_token`** only. Backend env **`GOOGLE_CLIENT_ID`**, **`GOOGLE_CLIENT_SECRET`**, **`GOOGLE_REDIRECT_URI`**. **`gdrive.service`** implements **`buildOAuth2Client`**, signed **`encodeGDriveOAuthState` / `decodeGDriveOAuthState`**, **`buildOAuthConsentUrl`**, **`exchangeAndConnect`**, **`buildSettingsGdriveRedirectUrl`**, **`assertOwnerOfHousehold`**. **`gdrive.routes`**: public **`GET /gdrive/oauth/callback`**, owner **`GET /gdrive/oauth/url`**, **`POST /gdrive/connect`** body **`{ code, folderId }`**. Backup/restore/prune use OAuth. Frontend Settings: folder ID + **Connect with Google Drive** (redirect flow); hash query **`gdrive=connected|error`** handling. Vitest sets **`GOOGLE_*`** in **`vitest.config.ts`**. OpenAPI + **`docs/API_GDRIVE.md`**, **`docs/API_INDEX.md`**, **`docs/ENVIRONMENT_VARIABLES.md`**, **`.env.example`** updated.
**Files:** `backend/db/migrations/0038_gdrive_oauth2.sql`, `backend/src/config/env.ts`, `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `backend/vitest.config.ts`, `backend/tests/gdrive.test.ts`, `backend/tests/gdrive-backup.test.ts`, `backend/tests/gdrive-restore.test.ts`, `backend/tests/gdrive-scheduler.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `openapi/openapi.yaml`, `docs/API_GDRIVE.md`, `docs/API_INDEX.md`, `docs/ENVIRONMENT_VARIABLES.md`, `.env.example`, `docs/CHANGE_HISTORY.md`

---

## FIX-133a (2026-05-04): GDrive OAuth error query encoding + drop unused access token columns
- **Type:** FIX / polish
- **What:** OAuth error redirect passes the raw **`message`** into **`URLSearchParams`** (no **`encodeURIComponent`**); Settings reads **`searchParams.get("message")`** without **`decodeURIComponent`**. Removed never-read **`oauth2_access_token`** / **`oauth2_access_token_expires_at`** from persistence (**`connectGDrive`** only stores **`oauth2_refresh_token`**); migration **`0039`** drops those columns for DBs that received them from an earlier **`0038`** revision; current **`0038`** only adds **`oauth2_refresh_token`**.
- **Files:** `backend/db/migrations/0038_gdrive_oauth2.sql`, `backend/db/migrations/0039_drop_gdrive_oauth_access_columns.sql`, `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## FIX-132b (2026-05-04): Log full Google Drive API error body on server
- **Type:** FIX / ops
- **What:** On any **`GaxiosError`** from the Drive API (connect **`files.get`**, backup **`files.create`**, list/download/prune), the backend now logs **`httpStatus`**, **`httpStatusText`**, **`responseBody`**, and **`message`** via **`logGoogleDriveApiError`** (`log.warn` for connection test, **`log.error`** elsewhere). User-facing strings and **`backup_job.error_text`** are unchanged.
- **Files:** `backend/src/modules/gdrive/log-google-drive-api-error.ts`, `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `docs/API_GDRIVE.md`, `docs/CHANGE_HISTORY.md`

---

## FIX-132a (2026-05-03): CR-132 follow-up — staleness anchor, PATCH 409, prune wrapper
- **Type:** FIX / polish
- **What:** Drive **staleness banner** in Settings now keys off the latest **`complete`** row from **`GET /gdrive/backups/history`** (`completed_at`) instead of **`lastScheduledBackupAt`**, so a manual success clears the alert and a failed “recent” queue no longer hides overdue gaps. **`PATCH /gdrive/settings`** returns **409** **`GDRIVE_NOT_CONFIGURED`** (same as other GDrive routes), not **404**. Removed a dead **`try/catch`** around **`pruneOldDriveBackups`** in **`runBackupJob`** because pruning already swallows errors internally.
- **Files:** `frontend/src/pages/SettingsPage.tsx`, `backend/src/modules/gdrive/gdrive.routes.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `backend/tests/gdrive.test.ts`, `docs/API_GDRIVE.md`, `docs/API_INDEX.md`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`

---

## CR-132 (2026-05-03): Automated Google Drive backup scheduler + backup history
**Files:** `backend/db/migrations/0037_gdrive_scheduler_settings.sql`, `backend/src/server.ts`, `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `backend/src/modules/gdrive/gdrive-scheduler.service.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `backend/tests/gdrive-scheduler.test.ts`, `backend/tests/gdrive-backup.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/API_GDRIVE.md`, `docs/API_INDEX.md`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`
**What:** Migration adds **`backup_frequency_hours`**, **`backup_retention_count`**, and **`last_scheduled_backup_at`** on **`household_gdrive_config`**. A server-side heartbeat (**30s** grace, then **every 30 minutes**, skipped when **`MODE=TEST`**) calls **`checkAndQueueDueBackups`**: for each household with frequency greater than 0, queues **`backup_job`** with **`triggered_by_user_id` null** when the last **complete** job is older than the interval (or no complete job ever), skips when a **queued/running** job exists, updates **`last_scheduled_backup_at`**, and in **PROD** logs a **staleness warning** if the last success is older than twice the interval. **`runBackupJob`** prunes excess **`.hfb`** files on Drive after each successful upload (**`pruneOldDriveBackups`**; delete failures are warn-only). **`PATCH /gdrive/settings`** (owner), **`GET /gdrive/backups/history`** (owner/admin), extended **`GET /gdrive/status`**. Settings **Data & Backup** adds automatic backup controls, staleness **Alert**, and a **Recent backup history** table.

---

## FIX-131a (2026-05-03): CR-131 review — backups list status, download settle guard
- **Type:** FIX / polish
- **What:** `downloadDriveFile` uses a **`settled`** guard so `writeStream.destroy()` after a read/write error does not also invoke **`resolve()`** from the **`close`** listener (Promise only settles once, but the double callback was misleading). **`mapDriveListError`** no longer duplicates Gaxios 403/404 branches already handled in **`listDriveBackups`**. **`GET /gdrive/backups`** returns **409** **`GDRIVE_NOT_CONFIGURED`** when Drive is not connected, and **502** **`DRIVE_LIST_FAILED`** only for upstream Drive API failures.
- **Files:** `backend/src/modules/export/gdrive-backup.service.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `backend/tests/gdrive-restore.test.ts`, `docs/API_GDRIVE.md`, `docs/API_INDEX.md`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`

---

## CR-131 (2026-05-03): Restore from Google Drive
**Files:** `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `backend/src/modules/export/export-registry.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `backend/tests/gdrive-restore.test.ts`, `docs/API_GDRIVE.md`, `docs/API_INDEX.md`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`
**What:** Owners (and admins for listing) can **`GET /gdrive/backups`** to list recent `.hfb` files in the connected folder (Drive `files.list`, max 20). Owners can **`POST /gdrive/restore`** with a Drive `fileId`; the server streams the file via `files.get` alt=media into `data/gdrive-backup-staging/`, then **`queueHouseholdImport`** renames it into `data/imports-restore/` and runs the existing import job processor. Settings **Data & Backup** adds **Restore from Drive** (load/refresh list, confirm, poll **`GET /exports/import/:jobId`**). **`STAGING_DIR`** and **`ServiceAccountKey`** are exported for reuse; **`downloadDriveFile`** cleans partial files on error. **`transaction_canonical` `onExport`** strips generated **`search_document`** so `.hfb` round-trips and Drive restores do not fail inserts.

---

## FIX-130a (2026-05-03): CR-130 review — backup job error paths + polish
- **Type:** FIX / polish
- **What:** `runBackupJob` now loads Drive credentials inside the same `try` as `buildHfbFile` / upload so a DB failure cannot leave the row stuck in `running`; not-configured uses `throw` and the shared failure `UPDATE`. Removed redundant `mkdirSync` in `runBackupJob` (staging dir still ensured in `queueBackupJob`). Export-ready email HTML drops duplicate headline copy; plain-text lead line aligned. Settings disconnect clears backup UI state only after a successful API call. Backup integration test asserts `sizeBytes > 0` on success. Restored `qGet` import in `gdrive-backup.service.ts` (`getBackupJob` still depends on it — a missing import caused runtime failures on `GET /gdrive/backup/:jobId`).
- **Files:** `backend/src/modules/export/gdrive-backup.service.ts`, `backend/src/modules/mailer/templates/export-ready.ts`, `frontend/src/pages/SettingsPage.tsx`, `backend/tests/gdrive-backup.test.ts`, `docs/CHANGE_HISTORY.md`

---

## CR-130 (2026-05-03): On-demand Google Drive backup + export-ready email
**Files:** `backend/db/migrations/0036_backup_job.sql`, `backend/src/modules/export/export-job.service.ts`, `backend/src/modules/export/gdrive-backup.service.ts`, `backend/src/modules/export/export-registry.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `backend/src/modules/mailer/templates/export-ready.ts`, `backend/tests/gdrive-backup.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/API_GDRIVE.md`, `docs/API_EXPORTS.md`, `docs/API_INDEX.md`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`
**What:** (1) **Google Drive backup** — `backup_job` table; `POST /gdrive/backup` (owner, rate-limited) queues an async job that writes a temp `.hfb` under `data/gdrive-backup-staging/`, streams it to Drive via `files.create`, then deletes the temp file in `finally`. `GET /gdrive/backup/:jobId` (owner or admin) returns status and Drive metadata. Settings **Data & Backup** adds **Back up now** when Drive is connected. (2) **Export email** — after a local export job completes, a fire-and-forget email notifies the requester with expiry text and a link to Settings → Data when `PUBLIC_BASE_URL` is set. Shared **`buildHfbFile`** in `export-job.service.ts` is used by both HTTP exports and Drive backups.

---

## FIX-129c (2026-05-02): Vite dev proxy missing `/gdrive`
- **Type:** FIX
- **Issue:** `POST /gdrive/connect` from the Vite dev server (port 3000) returned **404** because only other API path prefixes were proxied to the backend; requests never reached Express.
- **Fix:** Added `"/gdrive"` to `server.proxy` in `frontend/vite.config.ts`.
- **Files:** `frontend/vite.config.ts`, `docs/CHANGE_HISTORY.md`

---

## FIX-129b (2026-05-02): GDrive connect — parse response body safely
- **Type:** FIX
- **Issue:** `handleGDriveConnect` called `Response.json()` on every response; empty or non-JSON bodies (e.g. proxy/gateway, odd status codes) threw `Unexpected end of JSON input` and masked the real failure.
- **Fix:** Read `res.text()`, `JSON.parse` only when non-empty, then rely on `GET /gdrive/status` for success state and the success toast message.
- **Files:** `frontend/src/pages/SettingsPage.tsx`, `docs/CHANGE_HISTORY.md`

---

## FIX-129a (2026-05-02): GDrive review — FK, errors, admin UI, tests, API doc
- **Type:** FIX / engineering
- **What:** `connected_by_user_id` is now nullable with `ON DELETE SET NULL` (migration `0035`) so removing an `app_user` does not block deletes. `testDriveConnection` maps HTTP **403/404** via `GaxiosError.response.status` instead of substring checks on the message. Settings **Data & Backup** shows Google Drive status to **admins** (read-only) as well as owners. Added `docs/API_GDRIVE.md`, `backend/tests/gdrive.test.ts` (mocked `googleapis`, no real network), and explicit `gaxios` dependency for typed errors. `household_gdrive_config` is listed in `EXPORT_EPHEMERAL_TABLES` so `.hfb` exports never embed the service account key.
- **Files:** `backend/db/migrations/0035_gdrive_connected_by_set_null.sql`, `backend/package.json`, `backend/package-lock.json`, `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/export/export-registry.ts`, `frontend/src/pages/SettingsPage.tsx`, `backend/tests/gdrive.test.ts`, `docs/API_GDRIVE.md`, `docs/API_INDEX.md`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`

---

## CR-129 — Google Drive Service Account Connection
**Date:** 2026-05-01
**Files:** `backend/db/migrations/0034_gdrive_config.sql`, `backend/package.json`, `backend/package-lock.json`, `backend/src/modules/gdrive/gdrive.service.ts`, `backend/src/modules/gdrive/gdrive.routes.ts`, `backend/src/app.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/API_INDEX.md`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`
**What:** Google Drive Service Account connection. New `household_gdrive_config` table stores the service account JSON, folder ID, folder name (cached), and connection metadata. Three new endpoints: `GET /gdrive/status`, `POST /gdrive/connect` (validates key format + pings Drive API to confirm access), `DELETE /gdrive/disconnect`. Data & Backup settings tab gains a Connect/Disconnect UI (owner only). `getGDriveCredentials()` exported for use by CR-130 upload service.

---

## UX-128b — Forced password change via reset-password handoff
**Date:** 2026-05-01
**Files:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.routes.ts`, `frontend/src/layout/ShellLayout.tsx`, `frontend/src/pages/SettingsPage.tsx`, `backend/tests/password-reset.test.ts`, `docs/CHANGE_HISTORY.md`, `docs/API_INDEX.md`, `openapi/openapi.yaml`
**What:** Replaced the forced-password-change gate (settings-only tabs + yellow banners + `Navigate` to settings) with a full-page redirect to the existing reset-password flow. New `POST /auth/setup-forced-change-token` issues a short-lived reset token for authenticated users with `force_password_change = true`. `ShellLayout` detects the flag from `/auth/me`, calls the endpoint, clears `localStorage` JWT, and uses `window.location.replace` to `/reset-password?token=...` (pathname; matches `BrowserRouter`), reusing `ResetPasswordPage` and `POST /auth/reset-password` (which already clears the flag, bumps `token_version`, and sends the password-changed email). Removed dead `securityOnlyMode` logic from Settings.

## FIX-128f (2026-05-02): No dashboard flash on first-login forced password reset
- **Type:** FIX
- **Issue:** After sign-in, `/auth/me` ran asynchronously so one frame could render the authed shell and dashboard before `forcePasswordChange` was applied.
- **Fix:** `POST /auth/login` now returns `forcePasswordChange` (read with the credential check). `HomePage` sets a one-shot `sessionStorage` hint before storing the JWT; `ShellLayout` treats the hint like the forced flag for the shell gate and for starting the setup-token redirect, and clears the hint when `/auth/me` completes or the session ends.
- **Files changed:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.routes.ts`, `frontend/src/layout/ShellLayout.tsx`, `frontend/src/pages/HomePage.tsx`, `docs/API_INDEX.md`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`.

---

## FIX-128e (2026-05-02): Forced-change redirect URL must use pathname (BrowserRouter)
- **Type:** FIX
- **Issue:** `window.location.replace('/#/reset-password?token=...')` left `location.pathname` as `/`, so React Router matched `HomeRoute` (sign-in) instead of `ResetPasswordPage`.
- **Fix:** Redirect to `/reset-password?token=...`. ResetPasswordPage “Back to sign in” anchors now use `href="/"` instead of `/#/`.
- **Files changed:** `frontend/src/layout/ShellLayout.tsx`, `frontend/src/pages/ResetPasswordPage.tsx`, `docs/CHANGE_HISTORY.md`.

---

## FIX-128d (2026-05-02): ShellLayout forced-change redirect polish
- **Type:** FIX
- **What:** Reset `setupRedirecting` when JWT is cleared so a later sign-in cannot skip the setup-token effect. While `forcePasswordChange` is true (before `location.replace`), return `null` instead of rendering the full authed shell to avoid a brief sidebar flash.
- **Files changed:** `frontend/src/layout/ShellLayout.tsx`, `docs/CHANGE_HISTORY.md`.

---

## CR-128 — Settings five tabs + dashboard financial health history
**Date:** 2026-05-01
**Files:** `frontend/src/pages/SettingsPage.tsx`, `frontend/src/components/FinancialHealthCard.tsx`
**What:** Collapsed Settings to five tabs (`profile`, `household`, `accounts`, `recurring`, `data`): removed stub Notifications and Insights tabs; folded change-password and notifications copy into Profile; moved export/restore to **Data & Backup**. Dashboard **Financial Health** card replaces “View history →” settings link with a Mantine modal listing past analyses (re-fetch after new analysis via cache bust on `loadInsight`).

---

## FIX-128c (2026-05-01): Export preview read path and CR-127 backup test FK
- **Type:** FIX
- **What:** Moved `.hfb` extension validation inside the preview `try` so a rejected extension does not leave a dangling temp upload file. Use `Buffer` from `fs.readFileSync` / `decryptBackup` without redundant `Buffer.from` wrapping.
- **Tests:** Backup preview integration seed now inserts a `financial_account` row and binds the import file to that account id (avoids FK issues vs a hardcoded BoA fixture id).
- **Files changed:** `backend/src/modules/export/exports.routes.ts`, `backend/tests/app.test.ts`.

---

## CR-127 — Backup Preview Before Restore
**Date:** 2026-04-30
**Files:** `backend/src/modules/export/exports.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `backend/tests/app.test.ts`, `docs/API_EXPORTS.md`, `docs/CHANGE_HISTORY.md`, `openapi/openapi.yaml`
**What:** Added `POST /exports/preview` so the server can read a `.hfb` backup (including decrypting it when `BACKUP_ENCRYPTION_KEY` is configured) and return manifest metadata/table row counts without touching the database. Updated Household Settings restore UX to a two-step flow: user uploads `.hfb`, clicks **Preview & Restore**, reviews export timestamp/encryption/scope/per-table rows in a modal, and only then confirms destructive restore.

---

## FIX-126a (2026-04-30): Restore FK-safe delete order for import metadata
- **Type:** FIX
- **Issue:** Household restore could fail with `import_file_financial_account_id_fkey` when existing `import_file` rows referenced `financial_account` rows that restore was about to delete.
- **Fix:** In restore transaction, clear ephemeral import pipeline tables for the household in FK-safe order (`transaction_raw` → `import_file` → `import_session`) before deleting export-registry tables.
- **Regression coverage:** Extended export/import roundtrip test to seed `import_session` + `import_file` + `transaction_raw` rows and assert restore completes with those rows cleared.
- **Files changed:** `backend/src/modules/export/import-household-bundle.service.ts`, `backend/tests/app.test.ts`.

---

## CR-126 — .hfb Format + Backup Encryption
**Date:** 2026-04-30
**Files:** `backend/src/modules/export/backup-crypto.ts` (new), `backend/src/modules/export/export-job.service.ts`, `backend/src/modules/export/import-household-bundle.service.ts`, `backend/src/modules/export/exports.routes.ts`, `backend/src/config/env.ts`, `frontend/src/pages/SettingsPage.tsx`, `backend/tests/app.test.ts`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/API_EXPORTS.md`
**What:** All backup files now use the `.hfb` extension (Household Finance Backup). Added optional AES-256-GCM encryption via `BACKUP_ENCRYPTION_KEY` env var (64-char hex = 32-byte key). Encrypted files are prefixed with `HFB1` magic bytes + IV + auth tag. Restore auto-detects encrypted files and decrypts before processing. If a backup is encrypted and `BACKUP_ENCRYPTION_KEY` is absent, restore fails with a clear error message. Frontend FileInput now accepts `.hfb` only, and download filenames now use `.hfb`.

---

## CR-125 — Export/Import Parity (exportVersion 4)
**Date:** 2026-04-30
**Files:** `backend/src/modules/export/export-registry.ts` (new), `backend/src/modules/export/export-household-bundle.service.ts`, `backend/src/modules/export/import-household-bundle.service.ts`, `backend/src/server.ts`, `backend/src/db/export-coverage-check.ts`, `backend/tests/app.test.ts`
**What:** Introduced `EXPORT_REGISTRY` as the single source of truth for backed-up tables. Export now uses `SELECT *` with no hardcoded column lists. Added five missing tables: `budget_category`, `payslip_line_item`, `recurring_merchant_override`, `resolution_item`, `household_ai_insight`. Fixed silently missing columns on `household`, `person_profile`, and `payslip_snapshot` (added by migrations 0022 and 0031 but absent from prior hardcoded SELECT lists). Added startup coverage check that warns if any non-ephemeral DB table is absent from the registry. Bumped `exportVersion` to 4. Import service handles v1/v2/v3 bundles with graceful skip for absent table keys.

---

## UX-127 (2026-04-30): Surface account freshness dates in Settings and Import workspace
- **Type:** UX
- **What changed:** Added `Last upload` and `Statement ending` account freshness context in two high-use UI surfaces.
- **Settings UI:** Connected Accounts table now includes an `Import freshness` column with both dates per account.
- **Import UI:** Account picker keeps compact account labels; freshness dates are shown below the selected account row (not inside picker option labels).
- **Display behavior:** Missing upload is shown as `Never`; missing statement end date is shown as `Not detected`.
- **Files changed:** `frontend/src/import/accountDisplay.ts`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`.

---

## CR-127 (2026-04-30): Account import freshness metadata on `/imports/accounts`
- **Type:** CR
- **What changed:** `GET /imports/accounts` now returns per-account freshness metadata: `last_uploaded_at` (latest parsed upload timestamp) and `last_statement_end_date` (latest detected statement period end date).
- **Backend behavior:** Freshness is derived from parsed `import_file` rows; statement end date is read from parser metadata (`confidence_summary.statementBalances.asOfEnd`) when available.
- **Test coverage:** Added backend integration assertion that `/imports/accounts` includes freshness fields after a successful upload.
- **Files changed:** `backend/src/modules/imports/import-file-binding.service.ts`, `backend/tests/import-upload-flow.test.ts`, `docs/API_IMPORT_SESSIONS.md`, `openapi/openapi.yaml`.

---

## FIX-095e (2026-04-30): Disable outbound email delivery in TEST mode
- **Type:** FIX
- **Issue:** Invite/password-reset integration tests set SMTP env fields to exercise token/invite flows, which allowed real email delivery attempts when transport resolved.
- **Fix:** `sendMail()` now hard-stops outbound delivery when `MODE=TEST`, returning `DELIVERY_DISABLED_IN_TEST` after logging a skip message.
- **Behavior impact:** Auth/member invite flows still execute and generate reset tokens during tests; only SMTP transmission is suppressed.
- **Files changed:** `backend/src/modules/mailer/mailer.service.ts`.

---

## CR-095d (2026-04-29): Password-changed security notification email
- **Type:** CR
- **What changed:** `POST /auth/change-password` now sends a security notification email after a successful password update.
- **When email configured:** `changePassword()` fires `sendMail()` as fire-and-forget after DB update succeeds.
- **When not configured:** No-op; existing behavior remains unchanged.
- **New template:** Added `backend/src/modules/mailer/templates/password-changed.ts`.
- **Files changed:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/mailer/templates/password-changed.ts`, `backend/tests/password-reset.test.ts`.

---

## UX-095c (2026-04-29): Explain guarded member delete in remove dialog
- **Type:** UX
- **Issue:** When removing a member with a linked login and leaving "Also delete their login account" unchecked, backend correctly returned `409 HAS_LOGIN_ACCOUNT` but the dialog showed no inline feedback.
- **Fix:** Added explicit inline error messaging inside the remove-member confirmation dialog so users understand why deletion was blocked and what action is required.
- **Files changed:** `frontend/src/pages/SettingsPage.tsx`.

---

## FIX-095c (2026-04-29): Household member delete/login guard correctness
- **Type:** FIX
- **Issue:** Deleting a member with `deleteLogin=true` failed with FK violation (`person_profile.linked_user_id -> app_user.id`) because delete order removed `app_user` first.
- **Issue:** Deleting with `deleteLogin=false` still removed members even when a linked login existed, contrary to intended guard behavior.
- **Fix:** `deleteHouseholdMember` now returns `HAS_LOGIN_ACCOUNT` when a linked login exists and `deleteLogin` is false, and when `deleteLogin` is true it deletes `household_membership` + `person_profile` before deleting `app_user`.
- **Route mapping:** `DELETE /household/members/:memberId` now maps `HAS_LOGIN_ACCOUNT` to HTTP 409.
- **Regression test:** Added backend coverage for both guarded delete (409) and full delete with login removal (204 + user row removed).
- **Files changed:** `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`, `backend/tests/member-invite.test.ts`, `openapi/openapi.yaml`.

---

## CR-095c (2026-04-29): Member invite email + admin reset-password email
- **Type:** CR
- **What changed:** Wired member login creation and admin-triggered member password reset to SMTP email infrastructure using existing `password_reset_token` flow (no new tables, no new routes).
- **Create login (email configured):** `createHouseholdMember` and `createLoginForMember` now set an unguessable hash and send invite email with a 24-hour reset link (`inviteSent: true`).
- **Create login (no email):** Existing `ChangeMe123!` + force-change fallback remains unchanged (`inviteSent: false`).
- **Admin reset (email configured):** `resetMemberPassword` now invalidates session (`token_version` bump), creates a 1-hour reset token, sends reset email, and does not expose temp password.
- **Admin reset (no email):** Existing temporary password flow and modal fallback remains unchanged.
- **New template:** Added `backend/src/modules/mailer/templates/member-invite.ts`.
- **Files changed:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `backend/src/modules/mailer/templates/member-invite.ts`, `openapi/openapi.yaml`, `backend/tests/member-invite.test.ts`.

---

## CR-095b-fix (2026-04-29): Password reset regressions (link, capabilities, login UX)
- **Type:** FIX
- **Reset link:** `requestPasswordReset` now builds `PUBLIC_BASE_URL/reset-password?token=...` for BrowserRouter instead of `/#/reset-password` (HashRouter). File: `backend/src/modules/auth/auth.service.ts`.
- **Email readiness:** `isEmailConfigured()` now requires a non-empty `PUBLIC_BASE_URL` so reset links are always buildable when the UI reports email enabled. File: `backend/src/config/env.ts`.
- **Forgot password UX:** When email is enabled, the reset form is gated behind a "Forgot password?" click (`showForgotForm`) instead of showing immediately. File: `frontend/src/pages/HomePage.tsx`.
- **Tests:** `backend/tests/password-reset.test.ts` sets `PUBLIC_BASE_URL` in the SMTP test harness so integration tests still exercise token creation after the stricter `isEmailConfigured()` check; `beforeEach` clears email-related `env` fields so `GET /auth/capabilities` stays deterministic when the repo `.env` defines SMTP for local dev.

## CR-095b (2026-04-29): Email infrastructure + self-service password reset
- **Type:** CR
- **Motivation:** Introduce production-ready email infrastructure and end-user password reset without exposing account enumeration, while keeping the existing admin reset path as fallback.
- **Database:** Added migration `backend/db/migrations/0033_password_reset_token.sql` with `password_reset_token` table (`token_hash`, one-hour expiry, single-use via `used_at`) plus `idx_prt_user`.
- **Backend mailer module:** Added `backend/src/modules/mailer/` with typed payloads (`mailer.types.ts`), reusable HTML wrapper (`templates/layout.ts`), password reset template (`templates/password-reset.ts`), and lazy singleton SMTP transport (`mailer.service.ts`) using nodemailer.
- **Backend auth APIs:** Added `GET /auth/capabilities`, `POST /auth/forgot-password`, and `POST /auth/reset-password` in `auth.routes.ts` with Zod validation, TEST-mode-aware rate limits, and invariant `200` response for forgot-password.
- **Auth service logic:** Added reset token issuance/rotation, SHA-256 token hashing, one-hour expiry, single-use token consumption in transaction, password change with bcrypt cost 12, and `token_version` bump to revoke prior JWTs.
- **Config/env:** Added SMTP and public URL env vars in `backend/src/config/env.ts`, `.env.example`, and docs (`docs/ENVIRONMENT_VARIABLES.md`), including Resend and Gmail App Password examples.
- **Frontend UX:** Added public `ResetPasswordPage` route (`/#/reset-password?token=...`) and updated `HomePage` to fetch `/auth/capabilities`; shows legacy admin tip when email is disabled and an inline forgot-password form when enabled; adds `?reset=1` success alert after reset.
- **Contract docs:** Updated `openapi/openapi.yaml` with full schemas for the three new auth endpoints and error shapes; updated `docs/EMAIL_INFRASTRUCTURE.md` status to implemented.
- **Tests:** Added `backend/tests/password-reset.test.ts` covering capabilities, forgot-password invariants, token lifecycle, reset success + JWT invalidation, invalid/expired/used token handling, weak password validation, and same-password rejection.

---

## UX-126 (2026-04-29): Net Worth page — Mantine migration + layout redesign
- **Type:** UX
- **Motivation:** Net Worth page was the last major page on the old `.card`/raw-div layout, inconsistent with the Mantine-first standard established by Dashboard V2 (UX-120). Layout was also flat — KPI totals were buried inside a section rather than promoted to the top.
- **KPI hero strip:** Assets / Liabilities / Net Worth promoted to a `SimpleGrid` (3-col on sm+, stacked on mobile) at the top of the page. Each tile is a `Paper` with a color-coded top border (`--color-success` for assets, `--color-warm` for liabilities, accent/danger adaptive for net worth sign). Values use tabular-numeral font variant for alignment.
- **Delta chips:** Period summary section now renders three delta chips (ASSETS, LIABILITIES, NET WORTH) showing signed change (`+$X` / `–$X`) over the selected trend window with green/red backgrounds keyed to financial direction (liabilities decreasing = green).
- **`formatSignedDelta` helper:** New utility formats a signed numeric delta with `+`/`–` prefix and `$` amount — used exclusively by the delta chips.
- **Period preset pills:** 3M / 6M / 12M / 2Y / 3Y / YTD / Custom controls retained but styled via existing CSS variables (pending full Mantine `SegmentedControl` migration in a later pass).
- **Balance sheet table split:** Assets and Liabilities account tables now rendered as separate `Paper` sections rather than interleaved. Clarifies the two-sided structure.
- **Mantine 7 migration:** All layout shells migrated — `Paper` (with `withBorder shadow="sm"`), `Stack`, `Group`, `SimpleGrid`, `Title`, `Text`, `Anchor`, `Alert`, `Skeleton`, `Button`, `Select`, `Divider`, `Box`. Chart tooltip shell converted to `Paper`.
- **Recharts `Legend` removed:** Replaced with a manual legend using `Text`/`Group` Mantine primitives to match the visual language of the rest of the page.
- **CSS delta:** 136 Net Worth-specific utility classes added mid-migration then fully removed once Mantine tokens replaced them — net zero CSS delta.
- **No backend or API changes.** Pure presentation migration.
- **Files changed:** `frontend/src/pages/NetWorthPage.tsx`, `frontend/src/index.css` (net zero).

---

## UX-125 (2026-04-29): Forest Studio design theme + 3-way OS-aware color scheme toggle
- **Type:** UX
- **Motivation:** App was visually monotonous (single green everywhere) and "harsh on eyes" due to cold blue-gray backgrounds and neon accent colors. Dark mode used cold navy blacks. Theme toggle had no "Auto (follow OS)" option despite Mantine already supporting it.
- **Palette redesign: "Forest Studio"** — warm neutrals throughout, mature Pantone-forest greens, forest-night chrome. Grounded in UX research on warm vs cold color perception for extended use.
  - **Light mode:** Page background changed from cold `#f0f4f8` → warm linen `#efebe3`. Surface from pure white → warm `#fdfcfb`. All borders warm stone-toned. Text warm stone-900 (`#1c1917`) instead of cold slate-900.
  - **Dark mode:** Page bg changed from cold navy `#0f1420` → warm brown-black `#131009`. Surfaces warm brown-dark. Eliminates the "electric navy" look that's harsh at night.
  - **Sidebar chrome:** Changed from cold navy (`#1a2540`) → dark forest night (`#1a2b1f`). Now has a clear semantic relationship to the forest green identity instead of feeling like a different app.
  - **Active accent:** Changed from neon lime `#4ade80` → soothing mint teal `#6ee7b7`. Less fatiguing, more refined.
  - **Primary color ramp:** Replaced with mature Pantone Forest family — `#2d6a4f` as default shade. Not aggressive lime-green, but sophisticated earthy forest.
  - **Shadows:** Warm-tinted (rgba warm stone) instead of cold blue-tinted.
- **3-way theme switcher** in `AppTopBar`: replaced the 2-state sun/moon toggle with a compact Sun | Monitor | Moon segmented control. "Monitor" sets `'auto'` which follows OS preference via `useMantineColorScheme({ setColorScheme('auto') })`. User preference persists in localStorage (`hf_color_scheme`). OS-auto was already wired in `main.tsx` via `defaultColorScheme="auto"` — this exposes it in the UI.
- **Component updates:** KPI cards, KPI delta chips, table headers, category picker flyout, hs-picker, transaction toolbar, dashboard scope bar, bulk action bar, settings tabs, category rules section — all updated to use CSS variables instead of hardcoded cold blue-grays.
- **KPI income/expense colors:** `kpi-in` and `kpi-out` now use `--color-success` and `--color-expense` (warm terracotta) instead of harsh hardcoded greens/reds.
- **Files changed:** `frontend/src/theme.ts`, `frontend/src/index.css`, `frontend/src/layout/AppTopBar.tsx`, `frontend/src/pages/PayslipsPage.tsx` (fixed pre-existing unused import).

## CR-124 (2026-04-28): AI Financial Health Analysis (on-demand)
- **Type:** CR + DB
- Added migration `backend/db/migrations/0031_ai_financial_insight.sql` with new demographic fields on `household` (`city`, `state`, `combined_gross_income_usd`) and `person_profile` (`age`, `sex`, `individual_gross_income_usd`, `risk_tolerance`, `financial_goals_json`), plus new `household_ai_insight` and `insight_job` tables.
- Added backend insights module under `backend/src/modules/insights/` with 5 routes: `GET /insights/financial`, `POST /insights/financial/refresh`, `GET /insights/financial/status/:jobId`, `GET /insights/financial/history`, `GET /insights/financial/:id`.
- Added LLM provider abstraction in `llm-provider.service.ts` with `LLM_PROVIDER=openai|anthropic` and Anthropic SDK support.
- Extended household/profile APIs and services to read/write demographics and financial profile fields.
- Added dashboard financial health card (`frontend/src/components/FinancialHealthCard.tsx`) and integrated into `DashboardPageV2`; added Settings `insights` history tab plus new profile/household demographic form fields.
- Added integration coverage in `backend/tests/insights.test.ts` for insights refresh/status and new household/profile fields.
- Completed strict Mantine 7 sweep for `frontend/src/pages/SettingsPage.tsx` (all legacy tab controls migrated to Mantine components across profile, household, accounts, recurring, security, notifications, and insights sections).
- Normalized validation error shape to `400 { errors: z.issues }` in household and insights route validators; aligned insights service/route envelope behavior and OpenAPI/docs response contracts.
- Expanded OpenAPI household contract to match runtime handlers for `/household/members/{memberId}/data-count` and `/household/members/{memberId}/create-login`, plus detailed request/response/error mappings across household settings/profile/member endpoints.
- Final UI polish pass: refined Settings tab/header density, restored pill-shaped top-bar controls, moved AI card below core dashboard KPIs, improved compact AI card presentation, prevented duplicate insight refresh triggers, fixed Security tab crash on password input, and enforced Security-only tab access during forced first-login password change.
- Added migration `backend/db/migrations/0032_insight_job_household_index.sql` to index `insight_job(household_id)` for faster household-scoped job lookups.
- Added server-side refresh rate limit in `backend/src/modules/insights/insights.routes.ts` (one refresh per household per 5 minutes, `429 RATE_LIMITED`), with test-mode bypass to keep integration tests deterministic.
- Refactored `overBudgetCategories` in `backend/src/modules/insights/insight-prompt.service.ts` to replace per-budget-row spend lookups with a single grouped aggregate query (removes N+1 query pattern).
- Expanded user and API docs for insights behavior and contracts: `docs/USER_GUIDE.md`, `docs/API_INSIGHTS.md`, and `openapi/openapi.yaml` (including `429` response contract).
- Fixed desktop sidebar behavior so Settings/collapse controls stay visible within viewport-height navigation on long pages (`frontend/src/index.css` sidebar now viewport-anchored with internal nav scrolling).
- Added All-tab bulk action parity in Transactions by wiring "Move to trash" into the existing household bulk-trash flow (`frontend/src/pages/TransactionsPage.tsx`).
- Improved restore upload affordance in Settings with clearer Mantine `FileInput` presentation (placeholder, upload icon, full-width input, explicit action button width) while retaining disabled restore safety until a ZIP is selected (`frontend/src/pages/SettingsPage.tsx`).
- Normalized landing sign-in CTA to Mantine `Button` so the first-page auth action follows the app theme contract and no longer renders as a legacy gray control (`frontend/src/pages/HomePage.tsx`).
- Migrated Payslips list and Add-manual payslip pages toward Mantine-first presentation by replacing legacy card/header/action/button primitives with Mantine `Paper`/`Title`/`Text`/`Button`/`ActionIcon`/`Alert` wrappers while preserving existing backend/API behavior (`frontend/src/pages/PayslipsPage.tsx`, `frontend/src/pages/PayslipManualPage.tsx`).
- Continued payslip Mantine pass on detail and confirmation UX: `frontend/src/pages/PayslipDetailPage.tsx` now uses Mantine layout shells (`Paper`/`Stack`/`Title`/`Text`/`Alert`/`Anchor`) for key sections, and shared delete confirmations were upgraded to Mantine buttons in `frontend/src/components/ConfirmDialog.tsx`.
- Fixed visual alignment of Add-manual payslip field rows (`Who / employer`, `Salary / rate`) by normalizing row layout and control heights in `frontend/src/pages/PayslipManualPage.tsx`.
- Fixed Add-manual line-item crash on environments without `crypto.randomUUID()` by adding a safe draft-id fallback generator in `frontend/src/pages/PayslipManualPage.tsx`.
- Replaced remaining legacy Add-row controls in payslip detail line-item section with Mantine buttons (`frontend/src/pages/PayslipDetailPage.tsx`), reducing mixed button styling.

---

## FIX-123 (2026-04-28): Recurring overrides — hardening fixes across Phase 1/2/3
- **Backend validation gap (whitespace key):** `merchantKey` Zod schema in `recurring.routes.ts` changed from `z.string().min(1)` to `z.string().trim().min(1)` — a single-space input like `" "` previously passed the `min(1)` check and reached the service where `.trim()` produced an empty string that could be persisted. Now rejected at the boundary with a 400.
- **Case normalization:** `recurring.service.ts` now lowercases `merchantKey` before insert/upsert (was trim-only). The DB `UNIQUE (household_id, merchant_key)` constraint is case-sensitive; without this, `"Netflix"` and `"netflix"` created two separate rows with ambiguous matching behaviour. The frontend modal was already lowercasing client-side, but the API is now the authoritative normalizer.
- **DELETE response not checked (Phase 2/3):** Three sites updated to throw on non-2xx DELETE responses instead of silently updating UI state as if the request succeeded:
  - `TransactionsPage.tsx` — `onRemove` in the recurring modal wiring
  - `SettingsPage.tsx` — `handleRemoveDismissed` inline handler
  - `SettingsPage.tsx` — `onRemove` in the settings modal wiring
  Errors now propagate to the modal's catch block and are surfaced to the user.
- Files: `backend/src/modules/recurring/recurring.routes.ts`, `backend/src/modules/recurring/recurring.service.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/SettingsPage.tsx`

---

## CR-123 (2026-04-28): Recurring overrides management tab in Settings (Phase 3)
- Added a new `Recurring` tab to `frontend/src/pages/SettingsPage.tsx` with:
  - Separate confirmed and dismissed override tables.
  - Confirmed row edit action wired to `RecurringTagModal` (save/remove).
  - Dismissed row remove action for unsuppressing merchants.
- Added recurring tab state/effects to fetch and maintain override data via existing API calls only (`GET`, `POST`, `DELETE` on `/recurring-overrides`).
- Updated recurring API documentation in `docs/API_RECURRING.md` with a Phase 3 Settings management section.
- Why: Phase 3 provides a centralized management surface for recurring tagging decisions so users can audit and adjust overrides without returning to dashboard suggestions or individual transaction rows.

---

## CR-122 (2026-04-28): Recurring payments hybrid tagging Phase 2 in transactions view
- Added recurring tagging UX to `frontend/src/pages/TransactionsPage.tsx`:
  - Loads recurring overrides alongside transactions/categories/accounts.
  - Adds per-row recurring icon for posted debit transactions (`○` untagged, `●` confirmed) and opens a tagging modal.
  - Adds client-side `recurringOnly=true` URL filter in More filters and includes it in active-filter/clear-filter behavior.
- Added new modal component `frontend/src/components/RecurringTagModal.tsx` for confirm/edit/remove recurring overrides, including:
  - Editable merchant match key, amount anchor, tolerance %, and live match count against loaded transactions.
  - Confirm via existing `POST /recurring-overrides` and remove via existing `DELETE /recurring-overrides/:id`.
- Updated recurring API doc `docs/API_RECURRING.md` with frontend tagging flow notes so future work understands how the transactions page consumes existing endpoints without backend changes.
- Why: Phase 2 wires the already-shipped recurring override backend into day-to-day transaction triage, letting users tag and filter recurring debits directly where they review ledger rows.

---

## CR-121 (2026-04-28): Recurring payments hybrid tagging Phase 1 override store + dashboard dismiss flow
- Added migration `backend/db/migrations/0030_recurring_merchant_override.sql` introducing `recurring_merchant_override` with household-scoped unique `(household_id, merchant_key)` rows and confirm/dismiss verdict support.
- Added new backend recurring module (`backend/src/modules/recurring/recurring.service.ts`, `backend/src/modules/recurring/recurring.routes.ts`, `backend/src/modules/recurring/recurring.types.ts`) and registered router in `backend/src/app.ts` for:
  - `GET /recurring-overrides` (list)
  - `POST /recurring-overrides` (upsert confirmed/dismissed override)
  - `DELETE /recurring-overrides/:id` (delete by id in household scope)
- Updated dashboard recurring module (`frontend/src/pages/DashboardPageV2.tsx`) to:
  - Fetch recurring overrides with other dashboard data.
  - Persist dismiss actions via `POST /recurring-overrides` and optimistically hide dismissed heuristic candidates.
  - Render confirmed overrides above heuristic suggestions, while filtering suggestions against confirmed/dismissed overrides.
- Added backend test coverage in `backend/tests/recurring-overrides.test.ts` for CRUD upsert behavior, conflict update semantics, list responses, delete/not-found behavior, and auth guards.
- Added docs/API updates for recurring endpoints: `docs/API_RECURRING.md` (new), `docs/API_INDEX.md`, `openapi/openapi.yaml`.

---

## FIX-120d (2026-04-28): Expand recurring category lists and treat checking as liability in account trend arrows
- Updated `DashboardPageV2` recurring-payment constants to broaden category gating coverage: `EXCLUDE_CATEGORIES` now includes food/coffee/snacks, expanded shopping variants, travel/parking/taxi, entertainment/movies, gifts, and tax-related tokens; `ALLOW_CATEGORIES` now includes utility subtypes, housing/hoa, subscriptions/streaming/software, fitness, and childcare/tuition.
- Updated `LIABILITY_ACCOUNT_TYPES` in the same file to include `checking` so the By Account MoM arrow color logic treats checking accounts with the liability color policy.
- Files: `frontend/src/pages/DashboardPageV2.tsx`

---

## FIX-120c (2026-04-28): Recurring category gate now uses substring token matching
- `detectRecurring` category gate in `DashboardPageV2` previously used exact `Set.has()` checks for `EXCLUDE_CATEGORIES` / `ALLOW_CATEGORIES`, which missed common variants (for example names with suffixes/prefixes).
- Fix: switched both gates to substring token checks (`[...SET].some((token) => cat.includes(token))`) so exclusion/allow logic still uses the same token lists but matches normalized category strings more reliably.
- Files: `frontend/src/pages/DashboardPageV2.tsx`

---

## FIX-120b (2026-04-27): Net-worth sparkline never rendered — API shape mismatch
- `NetWorthHistoryPoint` type in DashboardPageV2 declared `{ date, netWorth }` but `/reports/balance-sheet/history` returns `{ asOf, totals: { netWorth } }`. The sparkline filter checked `p.date` and `p.netWorth` — both `undefined` on every point — so the gate (`points.length < 2`) always failed and the sparkline never rendered.
- Fix: corrected the `apiJson` generic to match the real response shape (`Array<{ asOf: string; totals: { netWorth: number | null } }>`), then mapped `asOf → date` and `totals.netWorth → netWorth` before setting state. Frontend display type unchanged.
- Files: `frontend/src/pages/DashboardPageV2.tsx`

## UX-120 (2026-04-27): Dashboard Mantine reference + pulse breakdown, tighter recurring, per-account module, net-worth sparkline
- DashboardPageV2 migrated entirely to Mantine 7 primitives (Paper, Stack, Group, SimpleGrid, Text, Title, Button, Progress, Badge, Anchor, Box, Skeleton). This is the project's first reference page for the Mantine pattern; all other pages remain on the existing project CSS classes (`.card`, `.muted`, `.secondary`, `.dashboard-page` in `frontend/src/index.css`). The dashboard's hard-coded greys/borders are now Mantine tokens (`c="dimmed"`, `Paper withBorder`), so the dashboard now follows the `data-mantine-color-scheme` dark/light flip that `index.css` already wires up. Recharts strokes/fills keep hex literals — Recharts does not read Mantine theme.
- Pulse hero card: added inflow/outflow breakdown line under the headline net number (green ↑ inflow, red ↓ outflow).
- `detectRecurring`: 3-layer filter — Layer 1 drops merchants whose name contains TRANSFER / E-PAYMENT / AUTOPAY / PAYDOWN / PAYMENT / DIRECT DEP / DIRECT DEPOSIT / REFUND; Layer 2 requires CV<0.25 amount stability; Layer 3 modal-category gate drops groceries/dining/restaurant/gas/fuel/shopping/entertainment buckets and relaxes the CV cap to 0.5 for utilities/subscriptions/insurance/rent/mortgage/loan. Section renamed "Monthly Commitments" → "Recurring Payments" with microcopy "Estimated from repeated charges".
- New "By Account — This Month" card in the responsive SimpleGrid (top 5 accounts by `activeMonth` outflow, MoM arrow with 5% threshold, account-type-aware color: liability accounts (`credit_card`/`loan`/`mortgage`) ↑=red ↓=green, asset accounts ↑=orange ↓=green, → for flat or insufficient prior data; arrow omitted when prior month has fewer than 3 txns; whole module hidden when `recentTxns` is null or has fewer than 5 rows).
- Net-worth card: headline 1.7rem→1.5rem, sub-lines (assets/liabilities and as-of) normalised to `size="sm"`, sparkline color now compares first vs last (green/red/gray) instead of absolute sign, height 48px (was 52), only renders with ≥2 distinct non-zero points.
- LedgerRow type widened to surface `accountId`, `institution`, `accountType`, `accountMask`, `categoryName` fields the `/transactions` API already returns — no new API calls, no backend changes.
- Follow-ups deferred (not in this PR): (a) audit of `frontend/src/pages` and `frontend/src/components` for Mantine vs `index.css` usage; (b) `docs/backlog/PRD-mantine-migration.md` describing the rollout pattern and migrate-when-touched rule; (c) cleanup of orphaned `.dashboard-page` / `.dashboard-page__hero` rules in `frontend/src/index.css` once no other file references them.
Files: frontend/src/pages/DashboardPageV2.tsx, docs/CHANGE_HISTORY.md

---

## FIX-120a (2026-04-27): Fix dashboard home-page crash loop on net worth history sort
- Fixed `DashboardPageV2` crash when a net worth history point has missing/invalid `date` by validating rows before sparkline sort (`localeCompare`) and render.
- Prevented V2 data fetch effects from running while classic view is active, avoiding background fetch churn under legacy fallback mode.
Files: frontend/src/pages/DashboardPageV2.tsx, docs/CHANGE_HISTORY.md

---

## CR-120 (2026-04-27): Home screen overhaul with legacy fallback
- Rebuilt the home screen into a new three-zone dashboard layout (Pulse, Action Items, Summary Cards, and 6-month trend) with month navigation and partial data rendering.
- Added `DashboardPageLegacy.tsx` as a preserved one-click fallback and introduced `dashboard_classic` localStorage toggle between classic and new views.
- Rewired `DashboardPage.tsx` to transparently export the new implementation (`DashboardPageV2`) without route changes.
Files: frontend/src/pages/DashboardPageLegacy.tsx, frontend/src/pages/DashboardPageV2.tsx, frontend/src/pages/DashboardPage.tsx, docs/CHANGE_HISTORY.md

---

## FIX-119 (2026-04-27): Route silent duplicate drops to Needs Review with FITID-aware messaging
- canonical-ingest.service.ts: in-session FITID dedup and in-session fingerprint dedup no longer silently drop transactions
- Both paths now call insertExactDuplicateForReview: status='duplicate' canonical row + resolution_item created, visible in Transactions -> Needs Review
- Cross-import fingerprint check now compares FITIDs: different FITID + same fingerprint shows "likely legitimate separate charge" message; same/missing FITID shows "exact duplicate"
- Root cause: CitiCard OFX file had 3 charges (ENERGY OGRE, 2024-05-29, $10) with unique FITIDs but identical fingerprints — 2 were silently lost
Files: backend/src/modules/canonical/canonical-ingest.service.ts, backend/tests/app.test.ts

---

## CR-119b (2026-04-26): Fix sticky regression and extend inline account creation
- Removed all localStorage sticky account logic from ImportWorkspacePage (dead for CSV/PDF and regression-prone for OFX shared profile key).
- Extended inline `create new account` flow to non-OFX file rows (CSV/PDF/XLSX), reusing the existing in-row OFX create-account form/state and save path.
- No backend or API changes.
Files: frontend/src/pages/ImportWorkspacePage.tsx, docs/CHANGE_HISTORY.md

---

## CR-119 (2026-04-26): Kill ImportPage, restore workspace as primary import UX
- Deleted frontend/src/pages/ImportPage.tsx
- /imports and /import routes now redirect to /imports/workspace
- Removed Finalize button and finalize flow from ImportWorkspacePage
- Undo is now available on any session regardless of status (removed status=review guard from rollback service)
- Added sticky last-used account per parser profile (localStorage) in workspace file binding
- Backend CR-118 endpoints (POST /imports/upload, GET /imports/history) retained for API use
Files: frontend/src/App.tsx, frontend/src/layout/AppTopBar.tsx, frontend/src/pages/ImportWorkspacePage.tsx, backend/src/modules/imports/import-session-rollback.service.ts, backend/src/modules/imports/imports.routes.ts, backend/tests/app.test.ts, docs/API_IMPORT_SESSIONS.md, CLAUDE.md, openapi/openapi.yaml

---

## CR-118c — Import parity upgrades on `/imports`
Date: 2026-04-26
Files: backend/src/modules/imports/import-upload.service.ts, backend/src/modules/imports/imports.routes.ts, frontend/src/pages/ImportPage.tsx, openapi/openapi.yaml, docs/CHANGE_HISTORY.md
What:
- **Backend:** Persist `import_session.stats_json` after successful canonicalize on `POST /imports/sessions/:sessionId/ofx-confirm` and `POST /imports/sessions/:sessionId/canonicalize`; add `accountType` on `GET /imports/history` bank items.
- **Frontend:** Session-based multi-file bank and payslip import on `/imports`; Add account from picker (type list aligned with Advanced Import); lazy expandable per-import details from session summary; Needs Review link for duplicate triage; payslip employer UX for 0/1/many employers.
Why: CR-118b hid outcomes and dropped multi-file and add-account parity relative to Advanced Import.

---

## CR-118b — ImportPage complete rebuild with Mantine UI + full feature parity
Date: 2026-04-26
Files: frontend/src/pages/ImportPage.tsx (complete rewrite)
What: Full Mantine UI, OFX detection using existing session API (create session + upload + ofx-suggestion + ofx-confirm), inline account creation, belongs-to assignment, client-side format inference label, import history with undo. No new backend endpoints.
Why: CR-118 initial build used plain HTML and dropped OFX detection, belongs-to, and account creation.

---

## 2026-04-26 (CR-118 import simplification — v2)

### CR-118 — One-shot import upload, unified history, and primary Import page

- **Type:** CR / feature
- **What:**
  1. Added `POST /imports/upload` to run one-shot upload flows for both bank and payslip files, reusing existing parse/canonical/payslip services and returning `{ ok, data/code, message }` service-style outcomes.
  2. Added `GET /imports/history` to merge recent bank import sessions and payslip uploads into a single latest-first feed with undo affordance metadata.
  3. Added schema migration `0023_import_session_stats.sql` to store canonicalize summary counts in `import_session.stats_json`; upload flow writes `{ addedCount, duplicateCount }`.
  4. Added new frontend primary page `ImportPage` at `/imports` with one-shot form, success/error alerts, unified history table, and undo actions; kept `/imports/workspace` and `/imports/:sessionId` for advanced/manual flow.
  5. Added backend coverage in `backend/tests/import-upload-flow.test.ts` for bank happy path, duplicate behavior, inference failure, history, and undo impact.
- **Why:** CR-118 requires collapsing import UX into a simpler primary path while preserving advanced workspace behavior and existing backend pipelines.
- **Files:** `backend/db/migrations/0023_import_session_stats.sql`, `backend/src/modules/imports/import-upload.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/tests/import-upload-flow.test.ts`, `frontend/src/pages/ImportPage.tsx`, `frontend/src/App.tsx`, `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`

---

## 2026-04-25 (mobile UX — v2)

### UX-R01 through UX-R06 + UX-P01/P02/P03 — Mobile responsive fixes + PWA baseline

- **Type:** UX / mobile
- **What:**
  1. **Budget page** — `ProgressView` KPI bar converted from hard-coded
     `repeat(3, 1fr)` to `.budget-kpi-grid` class with `@media (max-width: 640px)`
     single-column fallback. Both budget tables (setup/suggestion and progress)
     wrapped in `overflowX: auto` containers.
  2. **Import Workspace** — file-binding table wrapped in `overflowX: auto`.
  3. **Transaction toolbar** — `@media (max-width: 640px)` reduces padding and
     makes filter fields flex-wrap cleanly at 50% width pairs.
  4. **Payslip Detail** — pencil/edit buttons converted to `.payslip-inline-edit-btn`
     CSS class; `@media (hover: none)` rule forces full opacity on touch devices.
  5. **Settings page** — audit confirmed the only `ledger-table` instance is already
     wrapped; no change needed.
  6. **app-main padding** — reduced to `0.75rem` side padding on ≤640px viewports.
  7. **PWA manifest** — `frontend/public/manifest.json` created with `display:
     standalone`, matching app theme colors.
  8. **PWA meta tags** — `frontend/index.html` updated with manifest link,
     Apple PWA tags, and `theme-color`.
  9. **PWA icons** — `frontend/public/icons/icon-192.png` and `icon-512.png`
     created (HF initials on dark navy).
- **Why:** App is live and primary access is from phone browser. Viewport audit
  (UX-R01) found three broken pages (Budget, Import Workspace broken; Payslip
  edit controls invisible on touch). Mobile nav drawer was already implemented.
  PWA baseline enables iOS/Android "Add to Home Screen."
- **Files:** `frontend/src/pages/BudgetPage.tsx`,
  `frontend/src/pages/ImportWorkspacePage.tsx`,
  `frontend/src/pages/PayslipDetailPage.tsx`,
  `frontend/src/index.css`,
  `frontend/index.html`,
  `frontend/public/manifest.json`,
  `frontend/public/icons/icon-192.png`,
  `frontend/public/icons/icon-512.png`

---

## 2026-04-21 (docs + backlog)

### DOC-020 — OCI Always Free deployment guide + mobile UX backlog

- **Type:** DOC / backlog
- **What:**
  1. **`docs/OCI_DEPLOYMENT.md`** (new) — end-to-end deployment guide for Oracle Cloud Infrastructure Always Free Tier. Covers: VM creation (A1 Flex 4 OCPU/24 GB, Ubuntu 22.04), OCI Security List + ufw firewall config, block volume attach/mount, PostgreSQL 17 installation and performance tuning for 24 GB RAM (`shared_buffers`, `effective_cache_size`, `work_mem`, connection limits), Postgres security hardening (localhost-only, `pg_hba.conf`), Node 20 via nvm, GitHub SSH deploy key generation, `.env` setup including JWT secret generation (`openssl rand -base64 48`), `npm run build` + `db:seed` first-time bootstrap, systemd service unit, DuckDNS free subdomain, nginx reverse proxy, Let's Encrypt HTTPS via Certbot, update deploy flow, and backup cron.
  2. **`docs/MOBILE_UX_BACKLOG.md`** (new) — backlog for mobile responsive UX and PWA. Items: UX-R01 (viewport audit), UX-R02 (AppShell mobile drawer), UX-R03 (ledger table → card list), UX-R04 (Recharts ResponsiveContainer audit), UX-R05 (form Grid → Stack), UX-R06 (touch inline edit). PWA items: UX-P01 (manifest.json), UX-P02 (index.html meta tags), UX-P03 (app icons), UX-P04 (optional service worker). Status: backlogged.
  3. **`docs/HOSTING_OPTIONS_AND_HOME_LAB.md`** (updated) — OCI section expanded, marked as current recommended self-hosted path, linked to new `OCI_DEPLOYMENT.md`. Related docs table updated.
- **Why:** App is going to production on OCI Always Free Tier. Existing `PRODUCTION_SETUP.md` covers Koyeb/Docker only. A self-hosted OCI guide needed to cover VCN/firewall layering, Postgres direct install, systemd, nginx, and DuckDNS — all specific to the OCI bare-VM path. Mobile backlog added because primary access will be from phone browser.
- **No code changes.** `trust proxy` was already set in FIX-118; nginx handles SSL termination without app modifications.
- **Files:** `docs/OCI_DEPLOYMENT.md` (new), `docs/MOBILE_UX_BACKLOG.md` (new), `docs/HOSTING_OPTIONS_AND_HOME_LAB.md` (updated), `docs/CHANGE_HISTORY.md`

---

## 2026-04-19 (backlog)

### PRD-019 — Import pipeline simplification backlogged

- **Type:** PRD / backlog
- **What:** Documented a backlog item to collapse the current 6-step import flow (create session → upload → bind → parse → canonicalize → finalize) into 3 user-facing steps (upload → review → confirm). New proposed API: `POST /imports/upload`, `POST /imports/{id}/confirm`, `DELETE /imports/{id}`. Parser auto-detection, immediate preview on upload, undo from import history.
- **Why:** Current pipeline exposes internal ETL stages as user-facing actions. Not building now — too close to production release. Grooming notes and open decisions captured for future sprint.
- **Files:** `docs/IMPORT_PIPELINE_SIMPLIFICATION_BACKLOG.md` (new)

---

## 2026-04-18 (pre-production hardening sweep)

### FIX-118 — Graceful shutdown, trust proxy, request logging, change-password rate limit

- **Type:** FIX / ops hardening
- **What:**
  1. **Graceful shutdown** (`backend/src/server.ts`) — Added `SIGTERM` and `SIGINT` handlers that stop accepting new connections, drain in-flight requests, then call `closeSql()` before exiting. A 10-second forced-exit timeout ensures a hung keep-alive doesn't stall container replacement. Previously the process was killed immediately by the orchestrator.
  2. **`trust proxy` setting** (`backend/src/app.ts`) — Added `app.set('trust proxy', 1)` so that Express reads the real client IP from `X-Forwarded-For` when running behind Oracle Cloud / any load balancer. Without this, the login rate limiter sees every request coming from the proxy address, making it ineffective.
  3. **Request logging middleware** (`backend/src/app.ts`) — Added `requestLoggerMiddleware()` that logs `METHOD /path STATUS Xms` for every non-static request using the existing `log` infrastructure. No new dependency. Skips requests for static assets (JS, CSS, images) to keep logs readable.
  4. **Rate limit on `POST /auth/change-password`** (`backend/src/modules/auth/auth.routes.ts`) — Added `changePasswordRateLimit` (10 attempts per 15 minutes per IP). Same `skip: MODE === "TEST"` guard as the login limiter so tests are unaffected.
  5. **Dockerfile JWT_SECRET comment** (`Dockerfile`) — Corrected `<min 16 chars>` to `<min 32 chars>` to match the Zod enforcement in `env.ts`.
- **Why:** Pre-production sweep before Oracle Cloud free-tier deployment. All five issues were found in the sweep; none individually critical but collectively important for correct prod behavior.
- **Files:** `backend/src/server.ts`, `backend/src/app.ts`, `backend/src/modules/auth/auth.routes.ts`, `Dockerfile`, `docs/CHANGE_HISTORY.md`

---

## 2026-04-18 (payslip line item CRUD + cross-validation + manual page redesign)

### CR-117 — Payslip line item edit, delete, add + cross-validation warnings

- **Type:** CR / feature
- **What:**
  1. **Line item CRUD** — three new endpoints: `POST /payslips/:id/line-items`, `PATCH /payslips/:id/line-items/:itemId`, `DELETE /payslips/:id/line-items/:itemId`. Each mutates a single row and cascades: re-sums the affected section(s) from remaining line items and updates the matching `payslip_snapshot` summary column in the same transaction.
  2. **Cross-validation** — new `payslip-validation.ts` with `validatePayslipBalance()`. Checks section sums against summary columns (tolerance $0.01) and arithmetic invariant `gross − pre_tax − taxes − post_tax ≈ net` (tolerance $1.00). Warnings returned on `GET /payslips/:id`, `PATCH /payslips/:id`, and all line item endpoints. Non-blocking.
  3. **Summary PATCH now returns `validationWarnings`** — so the UI can immediately show whether a manual correction resolved or created a mismatch.
  4. **POST /payslips/manual now accepts `lineItems[]`** — optional array of individual rows sent at creation time. Same cascade logic as above.
  5. **IBM parser fix** — `ibm-payslip-pdf.ts` was missing `hoursOrDaysYtd`, `taxableEarningsCurrent`, `taxableEarningsYtd`, `otherInformationCurrent`, `otherInformationYtd` fields from `ParsedPayslipSummary`. Added as `null` to satisfy strict type.
- **Cascade mapping** (line items → summary columns):
  - `earnings` → `gross_pay_current / _ytd`
  - `pre_tax_deductions` → `pre_tax_deductions_current / _ytd`
  - `tax_deductions` → `employee_taxes_current / _ytd`
  - `post_tax_deductions + other_deductions` (combined) → `post_tax_deductions_current / _ytd`
  - `other_information` → `other_information_current / _ytd`
  - `taxable_earnings` → `taxable_earnings_current / _ytd`
  - `net_pay` intentionally excluded — it is the bank-deposit anchor for `matchedDeposits` and must not be auto-derived.
- **Files:** `backend/src/modules/payslip/payslip-validation.ts` (new), `payslip.service.ts`, `payslip.routes.ts`, `payslip.types.ts` (IBM fix), `openapi/openapi.yaml`, `docs/CHANGE_HISTORY.md`.

### UX-030 — Payslip detail page: line item edit + delete + validation banner

- **Type:** UX
- **What:** Detail page (`PayslipDetailPage.tsx`) now supports inline edit (✏) and delete (✕) per line item row. Edit mode: name, authority, amounts, hours, rate go into inputs; Enter saves, Escape cancels. Delete mode: inline confirm row ("Delete X? [Delete] [Cancel]") — no modal. After any mutation, summary amounts in the Amounts table update automatically (cascade from backend). Validation warnings banner shows above the Amounts table when mismatches exist — color-coded amber for section sum mismatches, red for arithmetic imbalance. Also added Authority column to tax section display when any row has a non-null authority.
- **Files:** `frontend/src/pages/PayslipDetailPage.tsx`, `frontend/src/payslip/types.ts`.

### UX-031 — Manual payslip page redesign + line item entry

- **Type:** UX
- **What:** Full redesign of `PayslipManualPage.tsx` (`/payslips/new`):
  - Shorter header copy ("Enter totals from any pay stub — no PDF required." instead of paragraph).
  - Logical card grouping: Who/Employer, Pay Period, Amounts, Line Items (optional, collapsed), Salary/Rate.
  - **Reordered amounts**: Gross → Pre-tax deductions → Employee taxes → Post-tax deductions → Net pay (result last). Supplemental rows (Hours, Taxable earnings, Other information) separated by a visual divider.
  - **Live arithmetic indicator**: computes `implied net = gross − pre_tax − taxes − post_tax` as you type. Green when it matches stated net (≤$1 diff), amber for $1–$50 diff, red for >$50.
  - **Line items section**: collapsible `<details>` with a table (Section, Name, Current, YTD, ✕). "+ Add line item" button appends a blank row. Items are POSTed as `lineItems[]` with the summary fields.
  - Statement template (parser profile) now shown inline as a labelled select instead of hidden in `<details>`.
- **Files:** `frontend/src/pages/PayslipManualPage.tsx`.

## 2026-04-18 (payslip inline editing)

### UX-028 — Inline edit for payslip summary amounts

- **Type:** UX / feature
- **What:** Added inline editing to the Amounts table on the payslip detail page. Each summary row (Gross pay, Taxable earnings, Employee taxes, Pre-tax deductions, Post-tax deductions, Other information, Net pay) now has a muted ✏ pencil button. Clicking it puts that row into edit mode: Current and YTD become number inputs. Save (✓) calls `PATCH /payslips/:id` with just the two changed fields; Cancel (✗) restores the read-only view. Only one row is editable at a time. Enter saves; Escape cancels.
- **Why:** LLM extraction (especially on complex Deloitte stubs) occasionally produces wrong summary totals. Re-processing is costly; manual correction is the practical fix. Line items cannot be individually edited (no backend endpoint) — only the summary totals are patchable.
- **Design decisions:**
  - All 7 amount rows are always visible (removed conditional hiding of Taxable earnings / Other information when null). This lets users add a value even when the LLM returned null.
  - Pencil button is always rendered but at low opacity (0.45), fully opaque on hover — visible without cluttering the read-only view.
  - Blank input = `null` (clears the field). Invalid number = inline error, no save.
  - After PATCH succeeds, local state is updated preserving `lineItems` and `matchedDeposits` (those are not returned by PATCH).
  - Line items section remains read-only with no change.
- **Files changed:**
  - `frontend/src/pages/PayslipDetailPage.tsx` — `SummaryAmountRow` component, `AMOUNT_ROWS` config, `patchPayslip` / `handleSaveRow` handlers, merged edit state.
  - `frontend/src/payslip/payslipChartsModel.test.ts` — updated base fixture to include fields added in CR-072 (`hoursOrDaysYtd`, `taxableEarningsCurrent`, `taxableEarningsYtd`, `otherInformationCurrent`, `otherInformationYtd`, `employmentRate`, `employmentRateType`).
- **No backend changes.** Uses existing `PATCH /payslips/:id` endpoint.

---

## 2026-04-18 (payslip tax deduction YTD regression after model upgrade)

### FIX-116 — Employee taxes YTD wrong after gpt-4.1 upgrade (summary value beats line items)

- **Type:** FIX
- **What:** After the FIX-115 model upgrade to `gpt-4.1`, employee taxes YTD displayed incorrectly ($6409.41 instead of $6909.02). The LLM was producing a wrong `summary.tax_deductions_ytd` while extracting the three individual tax rows correctly (their YTD values sum to $6909.02).
- **Root cause:** Tax deductions used a different precedence rule than pre-tax: line item sums were only used when the summary field was `null`. Since `gpt-4.1` populated `tax_deductions_ytd` with a wrong header-read value ($6409.41), the correct line item sums were ignored.
- **Fix:** Applied the same "always prefer line item sums when line items exist" rule to tax deductions that already governs pre-tax and post-tax deductions. Summary values are now only used when the `tax_deductions` line items array is empty.
- **Files changed:**
  - `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts` — tax deductions now prefer line item sums when items exist
  - `backend/tests/payslip-canonical-map.test.ts` — new test: "prefers line item sum over summary for tax deductions when both exist"

---

## 2026-04-18 (payslip model upgrade + hours contamination guard)

### FIX-115 — Deloitte extraction failures on gpt-4.1-mini: model upgrade + defensive hours guard

- **Type:** FIX
- **What:** `gpt-4.1-mini` was producing multiple structural errors on Deloitte payslips despite detailed prompt instructions: (a) dollar amounts written into `hours_or_days` fields for deduction rows (e.g. Tax Advance `hours_or_days.ytd=152.68`), (b) row-level amount mix-up (Equalization Tax Adv receiving Recognition Award's current amount), (c) Regular Salary gaining spurious `hours_or_days.current=8`, (d) Imp Inc Core Life/LTD persisting in `line_items.earnings` despite explicit prompt exclusion.
- **Root cause:** `gpt-4.1-mini` has insufficient column-type disambiguation capability for the Deloitte two-column-group payslip layout. This is a model-quality problem, not a prompt-engineering problem — the model conflates money columns with hours columns when both appear adjacent in the deduction section.
- **Fixes:**
  1. **Model upgrade:** `OPENAI_MODEL` changed from `gpt-4.1-mini` → `gpt-4.1` in `.env`. `gpt-4.1` follows multi-step column-pairing instructions reliably; `gpt-4.1-mini` does not. `.env.example` updated to recommend `gpt-4.1` with a comment noting mini-model accuracy issues.
  2. **Defensive guard in `flattenLineItems`:** `hoursOrDaysCurrent` and `hoursOrDaysYtd` are now unconditionally set to `null` for all non-`earnings` sections before DB insert. Deduction rows (pre-tax, post-tax, tax, other_deductions, other_information, taxable_earnings) never carry meaningful hours — any value placed there by the model is an extraction error. This guard prevents contaminated values from reaching `payslip_line_item` regardless of model.
- **Files changed:**
  - `.env` — `OPENAI_MODEL=gpt-4.1`
  - `.env.example` — updated comment to recommend `gpt-4.1`
  - `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts` — defensive `isEarnings` guard in `flattenLineItems`
  - `backend/tests/payslip-canonical-map.test.ts` — new test: "flattenLineItems nulls hoursOrDaysCurrent/YTD for non-earnings sections"
- **No DB migration needed.** Guard is applied at write time; historical rows with dollar-in-hours contamination will remain until re-processed.

---

## 2026-04-18 (payslip Deloitte imputed-income dedup)

### FIX-114 — Deloitte Earnings section polluted by Imp Inc Core Life/LTD (duplicate rows)

- **Type:** FIX
- **What:** After FIX-113 merged `other_deductions` into the Post-Tax section, Deloitte imputed-income rows ("02/21 Imp Inc Core Life", "02/21 Imp Inc Core LTD") became visible in **both** the Earnings section and the Post-Tax Deductions section simultaneously. These rows appear in two places in the Deloitte PDF: the GROSS EARNINGS block (they inflate gross/taxable pay) and the OTHER DEDUCTION(S) block (they are deducted back so net pay is unaffected). The LLM was following the old prompt and placing them in both `line_items.earnings` and `line_items.other_deductions`.
- **Root cause:** The prompt instruction for Deloitte earnings explicitly told the LLM to capture Imp Inc items from the earnings section. Combined with the Other Deductions prompt that correctly places them there too, they ended up stored in both sections in the DB.
- **Fixes:**
  1. **UI dedup (handles historical data):** `PayslipDetailPage` now builds an `otherDeductionNames` set before rendering. Any earnings row whose name appears in `other_deductions` is filtered out of the Earnings display. Imp Inc items show only in Post-Tax Deductions.
  2. **Prompt fix (future re-processing):** Updated LLM instruction: Imp Inc Core Life/LTD must be placed **only** in `line_items.other_deductions` (with `hours_or_days.current` and `amount_current`); they must NOT be placed in `line_items.earnings`.
- **Expected Earnings section (Deloitte) after fix:** Regular Salary, Equalization Tax Adv, Recognition Award — 3 rows, no imputed-income entries.
- **Files changed:**
  - `frontend/src/pages/PayslipDetailPage.tsx` — dedup filter on earnings before render.
  - `backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts` — Deloitte earnings prompt updated.
- **No DB migration needed.** Historical snapshots are corrected at render time by the UI filter.

---

## 2026-04-17 (payslip canonical map + UI correctness fixes)

### FIX-113 — Deloitte pre-tax YTD wrong; post-tax missing other-deductions; IBM pay date missing

- **Type:** FIX
- **What:** Three inter-related payslip correctness bugs found against real Deloitte and IBM payslips after CR-072 shipped.
- **Root causes & fixes:**

  **1. Deloitte pre-tax YTD (e.g. $7332.50 instead of $7947.86)**
  - `mapCanonicalExtractToPersist` only fell back to line item sums when the LLM `summary.pre_tax_deductions_ytd` was null. In practice the LLM reads the PDF section header total ($7332.50, only 401k) for the summary field while correctly extracting all three rows (401k + Flex Spending Health + Flex Spending Dep Care) with their individual YTDs. The line item sum is always more accurate.
  - **Fix:** when `pre_tax_deductions` line items are present their computed sum is always preferred over the LLM summary value. The LLM summary is only used when the line items array is empty.

  **2. Deloitte post-tax total wrong (current $17.13 missing Imp Inc Core Life/LTD)**
  - `other_deductions` line items (Tax Advance, Award Received, Imp Inc Core Life, Imp Inc Core LTD) were only added to the post-tax total when `post_tax_deductions_current` was null. Since "After-Tax Ded" ($17.13) was already set, the other four rows were never included.
  - Deloitte's "OTHER DEDUCTION(S)" section is semantically post-tax, identical to "POST-TAX DEDUCTION(S)". The two sections must be combined.
  - **Fix:** `other_deductions` line items are now always combined with `post_tax_deductions` line items into a single post-tax total. Combined line item sums are preferred over the LLM summary value (same rule as pre-tax). Diagnostic flag `otherDeductionsFoldedIntoPostTax: true` added to `raw_extract_json` when folding occurs.

  **3. IBM pay date missing**
  - IBM payslips do not print a standalone pay date on the stub — it appears only in the "Payment Information" section. The LLM correctly extracts it into `payment_information[0].pay_date` but `mapCanonicalExtractToPersist` only read `pay_period.pay_date` (null for IBM).
  - **Fix:** canonical map now falls back to `payment_information[].pay_date` (first non-null entry) when `pay_period.pay_date` is null.
  - LLM prompt updated with explicit IBM instruction: "IBM: pay_period.pay_date must be populated from the pay date visible in the Payment Information section."

  **4. Hours column shown for deduction sections in UI**
  - Deloitte imputed income rows (Imp Inc Core Life, Imp Inc Core LTD) in `other_deductions` carry `hoursOrDaysCurrent` values because the PDF has an Hours column in that section. The `sectionHasHours` check was section-agnostic, causing an Hours column to appear in post-tax deduction line items.
  - No post-tax (or any deduction) row should ever display hours — hours are meaningful only in the Earnings section.
  - **Fix:** `sectionHasHours` now returns `false` for any section other than `earnings`.

  **5. "Other Deductions" and "Post-Tax Deductions" shown as separate sections in UI**
  - The line items panel listed both `post_tax_deductions` and `other_deductions` as distinct collapsible sections, which is confusing since they are the same concept for Deloitte.
  - **Fix:** UI merges `other_deductions` rows into `post_tax_deductions` at render time (applicable to both historical and new data). The `other_deductions` section no longer appears as a separate group.

- **Files changed:**
  - `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts` — rewrote pre-tax and post-tax sum logic; added IBM pay date fallback; removed `isOtherDeductionPostTaxRow` / `sumOtherDeductionsMarkedAsPostTax` helpers (superseded).
  - `backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts` — added IBM pay date prompt instruction.
  - `frontend/src/pages/PayslipDetailPage.tsx` — `sectionHasHours` gated to `earnings` only; `other_deductions` merged into `post_tax_deductions` for display.
  - `backend/tests/payslip-canonical-map.test.ts` — updated two tests (backfill and raw_section-null scenarios now use new diagnostic field names); added 7 new tests: Deloitte pre-tax line-item-over-summary preference, combined post-tax (realistic Deloitte scenario), IBM pay date fallback, pay_period.pay_date priority, null pay date, pre-tax/post-tax fallback-to-summary when no line items, `other_deductions` stored section preserved in DB.

---

## 2026-04-16 (payslip rich extraction + line item storage)

### CR-072 — Payslip rich extraction: per-row line items + 7 new snapshot columns

- **Type:** CR
- **What:** Expanded payslip data capture to store every structured field visible on IBM and Deloitte PDFs — not just summary buckets. All individual earnings, deduction, and tax rows are now queryable per payslip.
- **New migration `0022_payslip_line_items.sql`:**
  - Adds 7 columns to `payslip_snapshot`: `taxable_earnings_current`, `taxable_earnings_ytd`, `other_information_current`, `other_information_ytd`, `hours_or_days_ytd`, `employment_rate`, `employment_rate_type`.
  - Creates `payslip_line_item` table with `ON DELETE CASCADE` FK to snapshot — stores one row per earnings/deduction/tax line item, grouped by `section` enum: `earnings`, `pre_tax_deductions`, `post_tax_deductions`, `tax_deductions`, `other_deductions`, `other_information`, `taxable_earnings`.
  - Indexes: `idx_payslip_line_item_snapshot (payslip_snapshot_id, section, sort_order)`, `idx_payslip_line_item_household (household_id, section)`.
- **Backend changes:**
  - `payslip.types.ts`: new `PayslipLineItemSection`, `PayslipLineItemRow`, `PayslipLineItemsGrouped`, `LineItemForInsert` types; extended `ParsedPayslipSummary` (5 fields), `PayslipHybridColumns` (2 fields).
  - `payslip-canonical-map.ts`: added `flattenLineItems()` helper (iterates all 7 section arrays, preserves PDF sort order), new `CanonicalMapResult` return type; populates all 7 new fields from LLM extract.
  - `payslip-parse.service.ts`: `PayslipPdfParseSuccess` carries `lineItems`; passes through from canonical mapper.
  - `payslip.service.ts`: `insertPayslipSnapshot` now wraps snapshot + line item INSERTs in `qBegin` transaction (atomic). New `getPayslipLineItems(snapshotId, householdId)` query returns all 7 sections grouped. `PayslipSnapshotPatchInput` extended with 7 new optional fields.
  - `payslip.routes.ts`: upload path and reconcile path pass `parseResult.lineItems` to insert; `GET /payslips/:id` returns `lineItems` (parallel fetch with `matchedDeposits`); `POST /payslips/manual` Zod schema includes 7 new optional fields.
  - `payslip-async-import-reconcile.service.ts`, `import-parser.service.ts`: thread `lineItems` through reconcile/import paths.
  - `extract-payslip-llm.ts`: 8 new prompt lines (4 IBM-specific, 4 Deloitte-specific) clarifying: IBM OTHER INFORMATION section mapping, IBM 401k multi-row capture, IBM ESPP disambiguation (post-tax vs other_information), IBM employment_context rate/hours; Deloitte earnings row classification, Deloitte Flex Spending separate rows, Deloitte YTD-only other deductions, Deloitte biweekly rate type.
- **API changes:**
  - `GET /payslips/:id` response gains 7 new scalar fields + `lineItems: { earnings: [...], pre_tax_deductions: [...], ... }` (7 sections, each an array of `PayslipLineItemRow`).
  - `POST /payslips/manual` body accepts 7 new optional fields: `taxableEarningsCurrent`, `taxableEarningsYtd`, `otherInformationCurrent`, `otherInformationYtd`, `hoursOrDaysYtd`, `employmentRate`, `employmentRateType`.
- **Frontend changes:**
  - `frontend/src/payslip/types.ts`: added `PayslipLineItemSection`, `PayslipLineItemRow`, `PayslipLineItemsGrouped`, `SECTION_LABELS`, `SECTION_ORDER`; extended `PayslipSnapshotDetail`.
  - `PayslipDetailPage.tsx`: Period card shows Hours YTD inline + Salary/Rate row. Amounts table adds conditional Taxable Earnings and Other Information rows. New "Line Items" collapsible card below Amounts — one `<details>` accordion per non-empty section; Hours/Rate columns hidden when all rows are null.
  - `PayslipManualPage.tsx`: 8 new optional fields (taxable earnings current/YTD, other information current/YTD, hours/days YTD, salary/rate, rate type); backlog comment for full per-row line item entry UI.
- **Tests:** `payslip-canonical-map.test.ts` — 8 new cases (new field mappings + `flattenLineItems`); `payslip-upload.test.ts` — updated mock with realistic line items/rate/hours, extended GET /:id assertions, extended manual test. All 275 tests pass.
- **Files:** `backend/db/migrations/0022_payslip_line_items.sql`, `backend/src/modules/payslip/payslip.types.ts`, `payslip-canonical-map.ts`, `payslip-parse.service.ts`, `payslip.service.ts`, `payslip.routes.ts`, `payslip-async-import-reconcile.service.ts`, `import-parser.service.ts`, `extract-payslip-llm.ts`, `frontend/src/payslip/types.ts`, `PayslipDetailPage.tsx`, `PayslipManualPage.tsx`, `payslip-canonical-map.test.ts`, `payslip-upload.test.ts`

---

## 2026-04-16 (apiFetch 401 still leaking raw JSON)

### FIX-027 — `apiFetch` returning raw 401 body instead of throwing on session expiry

- **Type:** FIX
- **What:** After token expiry, some actions (file upload, delete payslip, delete category/rule, import) were showing `{"message":"Missing bearer token"}` to the user instead of the friendly "Session expired" message.
- **Root cause:** `apiJson` was correctly fixed to throw `"Session expired. Please sign in again."` on 401. `apiFetch` — used for operations that need the raw `Response` object (multipart uploads, DELETEs) — was only calling `setToken(null)` and then returning the 401 `Response`. Callers hit `if (!res.ok)` → `res.text()` → raw JSON displayed as error string.
- **Fix:** `apiFetch` now also throws `"Session expired. Please sign in again."` on 401. All callers are already inside try/catch blocks so the throw is handled correctly. `setToken(null)` still fires the listener, redirecting to login.
- **Files:** `frontend/src/api.ts`

---

## 2026-04-16 (database architecture review + index audit)

### DB-007 — Performance index audit: 9 missing indexes added (migration 0021)

- **Type:** DB
- **What:** Audited all query patterns in `backend/src/modules/` against the migration schema. Found critical index gaps:
  - `transaction_canonical` had only 2 indexes (fingerprint dedup + GIN full-text). Zero coverage for date-range queries, account-scoped queries, source_ref idempotency lookups, or transfer group joins.
  - `resolution_item` had **zero indexes** despite being queried on every Needs Review load and dashboard summary.
  - `transaction_raw`, `import_session`, `account_balance_snapshot`, `financial_account` had no query-supporting indexes.
- **Added in `0021_performance_indexes.sql`:**
  1. `idx_tc_household_date_status` on `transaction_canonical (household_id, txn_date DESC, status)` — covers all ledger list, cash summary, budget actuals, transfer detection date-window queries
  2. `idx_tc_household_account_date` on `transaction_canonical (household_id, account_id, txn_date DESC)` — near-duplicate detection, per-account queries, payslip deposit match
  3. `idx_tc_household_source_ref` partial on `transaction_canonical (household_id, source_ref) WHERE source_ref IS NOT NULL` — canonical ingest idempotency guard
  4. `idx_tc_transfer_group` partial on `transaction_canonical (household_id, transfer_group_id) WHERE transfer_group_id IS NOT NULL` — transfer group lookups
  5. `idx_ri_household_status_type` on `resolution_item (household_id, status, type)` — dashboard count, list by status/type
  6. `idx_ri_household_target` on `resolution_item (household_id, target_id)` — per-transaction resolution lookup and close
  7. `idx_transaction_raw_file_id` on `transaction_raw (file_id)` — canonical ingest join
  8. `idx_import_session_household_started` on `import_session (household_id, started_at DESC)` — session listing
  9. `idx_abs_household_account_date` on `account_balance_snapshot (household_id, financial_account_id, as_of_date DESC)` — balance sheet history
  10. `idx_financial_account_household` on `financial_account (household_id)` — account listing
- **New doc:** `docs/DATABASE_ARCHITECTURE.md` — records Postgres vs NoSQL rationale, full index inventory, and upgrade ladder (pg_trgm → materialized views → partitioning → TimescaleDB)
- **Files:** `backend/db/migrations/0021_performance_indexes.sql`, `docs/DATABASE_ARCHITECTURE.md`

---

## 2026-04-16 (bulk resolve by merchant — root cause fix)

### FIX-026 — "Resolve all by merchant name" always returned zero matches

- **Type:** FIX
- **What:** The pattern preview (`POST /resolution/pattern-preview`) and bulk apply (`POST /resolution/bulk-apply-by-pattern`) always returned 0 matches, even when uncategorized transactions with matching descriptions were visible in Needs Review.
- **Root cause:** `findUnknownCategoryItemsByDescriptionPattern` queried through `resolution_item` requiring `type = 'unknown_category'` AND `status = 'open'`. But canonical ingest has a comment at line 450 of `canonical-ingest.service.ts` explicitly stating: *"Uncategorized rows appear in Needs Review via `category_id IS NULL` — no `resolution_item` needed."* No `unknown_category` resolution items are ever created, so the join always returned empty.
- **Fix:** Rewrote both functions to query `transaction_canonical` directly for `category_id IS NULL, status = 'posted'` rows matching the pattern. The bulk apply continues to close any incidentally-existing resolution items as a best-effort cleanup.
- **Files:** `backend/src/modules/resolution/resolution.service.ts`

---

## 2026-04-16 (PRD expansion: AI health, cloud backup, staff timesheet)

### PRD-003 — Three new feature requirements added to PRD (§18, §19, §20)
- **Type:** PRD
- **What:** Added three fully specified requirements sections to `docs/archive/FINANCE_APP_PRD.md`:
  - **§18 / FR-13 — AI Financial Health Dashboard:** On-demand AI analysis on the Home page. User configures AI provider (OpenAI or Anthropic) + API key + personal profile (age, salary, goals, risk tolerance) in a new "Financial Insights" Settings sub-tab. Analysis is generated server-side and cached. Output: health rating, what's good/bad/ugly, expense reduction tips, investment gaps, demographic benchmarks, actionable next steps.
  - **§19 / FR-14 — Automated Cloud Backup & Restore:** New "Backup & Restore" Settings tab consolidating manual export/restore (moved) and Google Drive scheduled backup. Google OAuth `drive.file` scope. Configurable folder, frequency (daily/weekly/monthly), and retention. Phase 2: OneDrive.
  - **§20 / FR-15 — Household Staff Timesheet & Expenses:** New `staff` RBAC role. Staff see only "My Timesheet" and "My Expenses" tabs. Admins manage staff profiles, review/approve timesheets and expenses, record payments, and optionally post wages/expenses to the household ledger as categorized transactions. Clock-in/out, manual time entry, OT calculation, mileage reimbursement.
- **Also updated:** §4 RBAC (added staff role), §13 Phase D Settings (added new sub-tabs), §17 Future Phases (added OneDrive Phase 2 and staff Phase 2 items).
- **Why:** Requirements gathering session with product owner to shape next phase of development.
- **Files:** `docs/archive/FINANCE_APP_PRD.md`, `docs/CHANGE_HISTORY.md`

---

## 2026-04-16 (bulk recategorize All tab, bank category hint, backlog)

### CR-113 — Bulk recategorize on the All (Ledger) tab
- **Type:** CR
- **What:** Users can now select posted transactions on the main "All" tab and bulk-reassign their category — not just on the Needs Review tab. A checkbox column is now visible on all three tabs. Selecting one or more rows on the All tab reveals a bulk action bar with a category picker, "Apply category" button, and "Clear selection" button. The existing `POST /transactions/bulk-category` backend endpoint is reused (it was already accessible but had no All-tab UI). Per-page select-all checkbox works the same as on Needs Review. Selection is cleared automatically on tab switch, page navigation, and filter change.
- **Why:** Power users re-importing after rule changes, or correcting a batch of miscategorised transactions, had no way to bulk-update from the main ledger view. They had to go through Needs Review which only surfaces unknown-category items.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

### UX-030 — Bank-supplied category hint in Needs Review expand panel
- **Type:** UX / CR
- **What:** For banks that include a category column in their export (currently Discover: "Supermarkets", "Restaurants", "Gas Stations", etc.), the bank-assigned category is now surfaced in the classification hint shown in the Needs Review expand panel when the app could not classify the transaction. Appears as **"Bank suggested: Restaurants"** below the "no rule matched" reason. Only shown when the app's classifier returned `source: "none"` (i.e. no household or builtin rule fired) — avoids showing it when a rule already matched correctly.
- **Backend:** During canonical ingest (`canonical-ingest.service.ts`), both `insertCanonicalRow` and `insertExactDuplicateForReview` now check `parsed.source_row["Category"]` (non-empty, trimmed). If present, it is stored as `bankCategory` in the `classification_meta` JSON alongside the existing `source/ruleId/confidence/reason` fields. No schema migration needed — `classification_meta` is a free-form JSON column.
- **Frontend/service:** `ClassificationExplainMeta` in `ledger.service.ts` gains optional `bankCategory?: string | null`. `parseClassificationMetaJson` extracts it. `TxClassificationMeta` in `TransactionsPage.tsx` gains the same field. `CategoryClassificationHint` renders "Bank suggested: X" when `bankCategory` is present.
- **Why not a mapping:** A direct Discover→app category mapping (e.g. "Supermarkets" → Groceries) is too fragile — the boundary between "Supermarkets" and "General Merchandise" is institution-specific and doesn't generalise. Showing the bank label as informational context lets the user decide without the app making a wrong assumption.
- **Generality:** The `source_row["Category"]` key is Discover-specific today. Any future bank parser that stores a category hint under the same key will automatically surface it. Other banks that do not provide a category column produce an empty string → stored as null → nothing shown.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/src/modules/ledger/ledger.service.ts`, `frontend/src/pages/TransactionsPage.tsx`

### BACKLOG-003 — Notifications system (roadmap)
- **Type:** PRD / backlog
- **What:** The Notifications tab in Settings (`SettingsPage.tsx`) is intentionally kept as a placeholder. Planned use cases:
  1. **Export ready** — async export ZIP generation can take time on large households; notify the user in-app when the download is ready instead of requiring them to poll the Settings export section.
  2. **Password change confirmation** — in-app confirmation after a successful password change.
  3. **Unresolved items alert** — periodic reminder when the resolution queue grows (e.g. "You have 42 uncategorised transactions").
  4. Additional hooks TBD as the app grows.
- **Why not yet:** No notification delivery mechanism exists (no email, no WebSocket push). Implementation requires either a polling endpoint or a real-time channel. Scope is medium-to-large; not blocking first release.
- **Status:** Tab shows "No notification service is configured for the local MVP. This tab is reserved." — intentionally visible so the feature is discoverable.

### BACKLOG-004 — Recurring transaction detection / subscription tracker (roadmap)
- **Type:** PRD / backlog
- **What:** Automatically identify transactions that recur at a predictable cadence (monthly, weekly, annual) and surface them as a "Subscriptions" or "Recurring charges" list. Use cases:
  1. Show all subscriptions in one place — Netflix, Spotify, gym memberships, insurance premiums, auto-loan payments, etc.
  2. Flag missed auto-pays (expected charge didn't appear this month).
  3. Highlight subscriptions the user may have forgotten (e.g. a $14.99/mo charge for a service they stopped using).
- **Detection heuristic ideas:** Group by normalised merchant name; transactions with consistent amount ± 5% on consistent day-of-month ± 5 days over 3+ occurrences = candidate recurring. Flag as recurring in the ledger row (new `is_recurring` column on `transaction_canonical`, or a computed label from a `recurring_pattern` table).
- **Why not yet:** Requires a batch analysis job (or on-demand scan) across the household's full ledger history. Output is a new UI surface (dedicated page or dashboard widget). Medium-to-large scope; non-blocking for first release.

---

## 2026-04-16 (RBAC, login UX, dashboard budget widget)

### FIX-036 — Wrong-password shows "Session expired"
- **Type:** FIX
- **What:** The login form called `apiJson()` which intercepts every 401 and throws "Session expired. Please sign in again." — including 401 from wrong credentials. Changed `HomePage.tsx` login submit to use raw `fetch` so the 401 from `/auth/login` returns the server's actual "Invalid credentials" message instead.
- **Files:** `frontend/src/pages/HomePage.tsx`

### FIX-037 — Member can delete other members' payslips
- **Type:** FIX
- **What:** `DELETE /payslips/:id` only checked household ownership, not per-person ownership. A member user could delete any payslip in the household. Added `restrictToOwnerPersonProfileId` guard in `deletePayslipSnapshotForHousehold()`: when the caller is a `member`, the payslip's `owner_person_profile_id` must match their own `personProfileId`. Service now returns `"deleted" | "not_found" | "forbidden"`. Route returns 403 for ownership violation, 404 for genuinely missing payslip.
- **Files:** `backend/src/modules/payslip/payslip.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`

### FIX-038 — Members see edit/delete icons on Categories page
- **Type:** FIX
- **What:** `showEditForRow()` returned `true` for any `householdScoped` category regardless of role — so members saw the pencil icon and got "Not allowed to delete this category" errors when they clicked trash. Added `canManageCategories` check (`owner` or `admin` only). Both the edit and delete buttons now require `canManageCategories`.
- **Files:** `frontend/src/pages/CategoriesPage.tsx`

### UX-029 — Dashboard: richer budget widget with per-category breakdown
- **Type:** UX
- **What:** Budget widget was a single total progress bar always locked to the current calendar month. Three improvements: (1) When the period filter is set to "Calendar month", the budget widget now shows that month's budget instead of always today's month. (2) Full per-category breakdown: top 6 categories sorted by % used, each with an individual progress bar, colour-coded green/amber/red. Over-budget categories shown in red. (3) When no budget exists for the month, shows a "Set up budget →" CTA instead of nothing.
- **Files:** `frontend/src/pages/DashboardPage.tsx`

### FIX-039 — Pre-existing unused-var build error in TransactionsPage
- **Type:** FIX
- **What:** `const r = await apiJson<...>` at line 835 was declared but never used — TypeScript strict mode rejected the build. Removed the unused binding (`await` directly).
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

---

## 2026-04-15 (transfer filter, build fix, backlog)

### FIX-035 — Build error: Unicode escape in string literal
- **Type:** FIX
- **What:** `ImportWorkspacePage.tsx` contained `\u201c` / `\u201d` (curly-quote Unicode escapes) inside a string literal. Babel rejected the file at parse time, breaking the Vite dev server and the login page. Changed to a single-quoted string with straight double quotes.
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`

### UX-028 — Add "Transfer" to Needs Review type filter dropdown
- **Type:** UX
- **What:** `transfer_ambiguity` was missing from `LEDGER_RESOLUTION_TYPES` in `TransactionsPage.tsx`, so it never appeared as a filter option in the "Review type" dropdown on the Needs Review tab. Users could not filter the list to show only transfer items, making it impossible to select-all and bulk resolve. Added `transfer_ambiguity → "Transfer"` to the constant and label map. Updated the "Resolve flags" button tooltip to mention transfers. Bulk resolve already worked mechanically (the backend includes transfer_ambiguity items in `openReviewItems` and `POST /resolution/bulk` handles them) — the filter was the only missing piece for efficient triage.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

### CR-112 — Transfer confirmation: "Confirm as transfer" pairs both legs and clears cash flow distortion
- **Type:** CR / FIX
- **What:** `transfer_ambiguity` review items were previously inert — resolving them cleared the review queue but did nothing to the transactions. Both legs (outflow from one account, inflow to another) continued to appear as individual posted rows, double-counting in cash flow KPIs. Now:
  - **Per-row:** Expand panel for `transfer_ambiguity` items shows **"Confirm as transfer"** + **"Not a transfer"**. "Confirm as transfer" calls `POST /resolution/:id/confirm-transfer` — sets a shared `transfer_group_id` on both canonical rows and resolves all open transfer_ambiguity items for both legs in one request. "Not a transfer" is the old PATCH resolve (dismiss without pairing) — kept for coincidental amount matches that are not real transfers.
  - **Bulk:** When Transfer-filtered rows are selected, the bulk bar shows **"Confirm transfers (N)"** (calls `POST /resolution/bulk-confirm-transfers`) alongside **"Not a transfer / dismiss (N)"** for the simple-resolve path.
  - **Filter:** "Transfer" added to the Review type filter dropdown so users can filter to only transfer items, select-all, and confirm in 4 clicks.
- **Backend:** `confirmTransferPairForHousehold` + `bulkConfirmTransferPairsForHousehold` in `resolution.service.ts`. Two new routes in `resolution.routes.ts`. Reads `debitId`/`creditId` from the `low_pair_score` reason JSON — multi-candidate ambiguity items (no unambiguous pair IDs) return `MISSING_PAIR_IDS`.
- **Docs:** `API_RESOLUTION.md` updated with both new endpoints.
- **Files:** `backend/src/modules/resolution/resolution.service.ts`, `backend/src/modules/resolution/resolution.routes.ts`, `frontend/src/pages/TransactionsPage.tsx`, `docs/API_RESOLUTION.md`

### BACKLOG-002 — Manual transfer pairing (roadmap)
- **Type:** PRD / backlog
- **What:** When the transfer auto-matcher scores below the threshold (score 0, threshold 45), it creates a `transfer_ambiguity` review item instead of setting `transfer_group_id` on both sides. Resolving that item clears the review queue but does NOT pair the transactions — they remain as individual posted rows. Money moving between the user's own accounts (e.g. salary checking → high-yield savings via ACH) counts as an outflow on one side and an inflow on the other, distorting cash flow KPIs (inflow total, outflow total, savings rate, safe-to-spend). The correct fix is a "Mark as transfer pair" action in the Needs Review expand panel that accepts a debit ID and credit ID, sets a shared `transfer_group_id` on both `transaction_canonical` rows, and marks both resolution items resolved. The backend pair-score logic should also be extended with the household's actual bank description patterns once known. Until then, users can resolve the review items (clears noise) and optionally lower `TRANSFER_MIN_AUTO_PAIR_SCORE` in `.env` (risky without domain-specific patterns).
- **Why not yet:** Requires a UI for selecting the two legs of a transfer (debit from one account, credit from another) and a new backend endpoint. Scope is medium — not blocking first release since cash flow is usable with the distortion noted.

---

## 2026-04-15 (bug fixes: pattern-preview crash, auth, OFX, UX polish)

### FIX-030 — Pattern-preview backend crash: `tc.description` column does not exist
- **Type:** FIX (critical — backend crash)
- **What:** `findUnknownCategoryItemsByDescriptionPattern` in `resolution.service.ts` referenced `tc.description` which is not a column on `transaction_canonical` (table has `merchant` and `memo`). Every call to `POST /resolution/pattern-preview` or `POST /resolution/bulk-apply-by-pattern` raised PostgresError code 42703, crashing the backend and causing all subsequent requests to return 500 until restart. Fixed query to `COALESCE(tc.merchant, '') || ' ' || COALESCE(tc.memo, '')` with TRIM for display.
- **Files:** `backend/src/modules/resolution/resolution.service.ts`, `backend/tests/app.test.ts`

### FIX-031 — Wrong current password returned 401, treated as "Session expired" by frontend
- **Type:** FIX
- **What:** `POST /auth/change-password` returned HTTP 401 for `INVALID_CURRENT_PASSWORD`. `apiJson()` in `frontend/src/api.ts` treats all 401 responses as "Session expired" — it clears the token and throws, logging the user out instead of showing the actual error. Fixed: backend now returns 400 for wrong current password. Also improved `apiJson` error handling to extract the `message` field from JSON error bodies so the UI shows "Current password is incorrect" instead of "400 Bad Request: {raw json}".
- **Files:** `backend/src/modules/auth/auth.routes.ts`, `frontend/src/api.ts`, `backend/tests/app.test.ts`

### FIX-032 — Post-password-change: "Session expired" instead of clean sign-out
- **Type:** FIX
- **What:** After a forced first-login password change (or any self-service change), the server increments `token_version`, invalidating the old JWT immediately. The frontend dispatched `app:password-changed` to clear the `forcePasswordChange` banner, but left the old (now invalid) token in localStorage. The next API call (e.g. navigating away) got a 401, which `apiJson` converted to "Session expired". Fixed: `ShellLayout.tsx` handler for `app:password-changed` now calls `setToken(null)` — clears the token immediately, React re-renders, `RequireAuth` redirects to home/login page. Clean sign-out, no "Session expired" flash.
- **Files:** `frontend/src/layout/ShellLayout.tsx`

### FIX-033 — OFX new-account creation leaves Run Import disabled
- **Type:** FIX
- **What:** After creating a new account from the OFX prompt and clicking "Create account", `onAccountChange(fileId, result.id)` was called to auto-bind the file. But `onAccountChange` is a `useCallback` that captures the `accounts` array in its closure — that array was still the pre-creation list (React state update is async). `accountById(accounts, result.id)` returned undefined → `inferParserProfile` returned null → error "We couldn't match this file…" → binding not saved → Run Import stayed disabled. Fixed: after refreshing the accounts list, the creation handler now uses the fresh array directly to infer the profile and calls `persistBinding` without going through the stale closure.
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`

### FIX-034 — Remove dead "Check now (Deloitte payslip)" button
- **Type:** FIX / UX
- **What:** The "Check now (Deloitte payslip)" button in the "Separate steps" details section called `runReconcilePayslipAsync(true)`, which polls the backend for completed Deloitte payslip extraction. This button was dead in practice — the auto-poll useEffect already runs every 2 minutes automatically and on a 2.5s delay after upload. Removed the button. Updated three message strings that referenced "use Check now" to say "automatic check every 2 minutes" instead. The `runReconcilePayslipAsync` function is kept (still used by the auto-poll effect).
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`

### UX-025 — Classification matcher preview: collapse toggle
- **Type:** UX
- **What:** The "Load classification preview" button opened the table with no way to dismiss it other than leaving the page. Button label now toggles: shows "Hide preview" when rows are visible, "Load classification preview" when empty. Clicking when rows are visible clears them; clicking when empty loads them. Same button serves both purposes.
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`

### UX-026 — Rule learning dialog: per-merchant dedup in Needs Review
- **Type:** UX / CR
- **What:** After CR-110, the "Create classification rule?" dialog fired on every categorization in the Needs Review expand panel — resolving 30 WHOLEFDS items meant 30 consecutive modal interrupts. The dialog is now deduplicated per merchant key within the triage session. First time a given merchant (e.g. "WHOLEFDS") is categorized → dialog offered, key added to a session-scoped Set. Subsequent items with the same merchant → dialog silently skipped. Each unique merchant still gets one offer. A session with 30 WHOLEFDS + 5 AMAZON + 3 NETFLIX items produces 3 dialogs, not 38.
- **Why:** The dialog itself is useful — it's the right moment to create a rule. The problem was repetition for the same merchant, not the concept.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

### UX-027 — Needs Review toolbar: sticky on scroll
- **Type:** UX
- **What:** When the Needs Review table has many rows, the bulk action bar (category picker, Apply, Resolve flags, Move to trash) and the "Resolve all by merchant name" form scrolled off the top of the viewport. Both controls are now wrapped in a `position: sticky; top: 0` container so they remain visible while scrolling the transaction list.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

---

## 2026-04-15 (dashboard audit + pre-release polish)

### UX-DASH-001 — Dashboard audit: net worth widget, budget progress, inflows table, resolution alert, chart labels
- **Type:** UX
- **What:**
  - **Net worth widget** — Added a compact banner above the KPI grid that pulls from `GET /reports/balance-sheet` and shows assets, liabilities, and net worth with an "as of" date and a link to the full Net Worth page. Only renders when balance data is available.
  - **Budget progress bar** — Added a color-coded progress bar for the current calendar month's budget (green → amber at 85% → red over budget) with spent/budgeted totals and a "Manage budget →" link. Only renders when a budget exists for the month. Links budget feature to the dashboard for discoverability.
  - **Inflows by category: pie → table** — The inflows donut pie was replaced with a ranked table. Most households have 1–3 inflow categories (salary, interest); a donut with 2 slices is not useful. The table is sortable by amount and links to the ledger drill-down.
  - **Resolution alert: all types** — The uncategorized alert previously only fired for `unknown_category`. It now surfaces all open resolution types: uncategorized, transfers needing pairing, and possible duplicates — each with its own "Review" link.
  - **Chart labels: fixed 6-month scope** — Monthly trend charts (stacked outflows, monthly net) always show the trailing 6 months regardless of the period preset. Labels updated to say "trailing 6 months" and "Always shows the last 6 calendar months regardless of the period filter above" so users aren't confused when KPIs say "Last 7 days" but charts show 6 months.
- **Files:** `frontend/src/pages/DashboardPage.tsx`

### UX-IMPORT-001 — Disable unsupported parser profiles in file-binding UI
- **Type:** UX
- **What:** Parser profiles that are registered in the backend but not yet implemented (`capital_one_card_csv`, `adp_payslip_pdf`) were selectable in the file-binding dropdown, causing a server error on parse. Now they appear greyed out with "(not supported)" and a title tooltip explaining why. If a file is already bound to an unsupported profile, the format column shows a red warning instead of "Ready". `formatProfileLabel()` now delegates to `friendlyParserLabel()` so the dropdown shows human-readable labels.
- **Why:** Prevents a jarring server error. Users should not be able to walk into a wall.
- **Files:** `frontend/src/import/profileLabels.ts` (added `DISABLED_PROFILES` export), `frontend/src/pages/ImportWorkspacePage.tsx`

### CR-110 — Rule learning wired to category edit in transaction list
- **Type:** CR
- **What:** When a user changes a transaction's category in the main ledger (non-review path), a "Create classification rule?" dialog now appears after the save completes (owner/admin only). Accepting calls `POST /categories/rules/from-ledger` with a contains match on the normalized description. Previously this dialog only appeared in the resolution-review expand panel (`unknown_category` flow); the main list picker never triggered it. `closeOnClickOutside` set to `true` so a quick "Not now" is low-friction.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`

### CR-111 (BACKLOG-001) — Bulk resolve unknown-category items by description pattern
- **Type:** CR
- **What:**
  - **Backend service:** `findUnknownCategoryItemsByDescriptionPattern` and `bulkApplyCategoryByDescriptionPattern` in `resolution.service.ts` — find all open `unknown_category` resolution items whose linked transaction description contains a pattern (case-insensitive LIKE), apply category, mark resolved.
  - **Backend routes:** `POST /resolution/pattern-preview` (returns matched count + up to 5 example descriptions) and `POST /resolution/bulk-apply-by-pattern` (applies the category).
  - **Frontend:** In the "Needs review" tab of TransactionsPage, a "Resolve all by merchant name…" button expands an inline form: pattern input with live preview count and examples, category picker, Apply button. Replaces 40 one-by-one resolves with 1 action.
- **Why:** First import with multiple months of statements produces many repetitive `unknown_category` items for the same merchant. One-by-one resolution is unusable at scale.
- **Files:** `backend/src/modules/resolution/resolution.service.ts`, `backend/src/modules/resolution/resolution.routes.ts`, `frontend/src/pages/TransactionsPage.tsx`; docs: `openapi/openapi.yaml`

## 2026-04-15 (continued)

### UX-SEC-005 — Login page "Forgot password?" wired to real reset flow
- **Type:** UX
- **What:** "Forgot password?" on the login page was a dead `mailto:admin@household.local` stub. Replaced with a toggle button that shows an inline tip: "Ask your household admin to reset your password from Settings → Members → Reset password." Works in conjunction with SEC-005 (reset-password endpoint). `USER_GUIDE.md` updated to document login account management (create/reset password from Settings) and remove stale "operator must manage at DB level" note.
- **Files:** `HomePage.tsx`, `USER_GUIDE.md`

### SEC-005 — Self-service password reset (owner/admin resets member password)
- **Type:** CR (security / UX)
- **What:**
  - **`household.service.ts`:** `resetMemberPassword(householdId, memberId)` — generates a random 12-char temporary password (3×4 alphanum groups joined by `-`, guaranteed upper+lower+digit+special), hashes it at rounds 12, sets `force_password_change = true`, bumps `token_version` (invalidates existing JWTs). Returns `{ tempPassword }` to the caller.
  - **`household.routes.ts`:** `POST /household/members/:memberId/reset-password` (owner/admin only). 404 if member not found; 409 if member has no login account.
  - **`SettingsPage.tsx`:** "Reset password" button next to "✓ Has login account" for each member. Clicking opens a `ConfirmDialog` warning. On confirm, calls the API and shows a modal with the temporary password (monospace, `user-select: all` for easy copy). Member's session is invalidated immediately; they must change the password on next login.
- **Why:** Operators previously had to use the database directly to reset a forgotten password. This closes the last operator-managed account flow.
- **Files:** `household.service.ts`, `household.routes.ts`, `SettingsPage.tsx`; docs: `CHANGE_HISTORY.md`, `docs/API_HOUSEHOLD.md`, `openapi/openapi.yaml`

## 2026-04-15 (security hardening continued)

### CR-109 (slice 5) — RBAC redesign: member-scoped export + frontend Belongs-To pre-fill
- **Type:** CR (security/RBAC + UX)
- **What:**
  - **Migration `0020`:** Adds `person_profile_id TEXT REFERENCES person_profile(id)` to `export_job`. NULL = household-wide; non-NULL = member-scoped.
  - **`export-household-bundle.service.ts`:** `queryAllExportTables` accepts optional `personProfileId`. When set, filters transactions/accounts/payslips/balance_snapshots to that profile; includes only the member's `person_profile` row; omits users (security) and household/membership rows.
  - **`export-job.service.ts`:** `ExportJobRow` gains `personProfileId`; `queueHouseholdExport` accepts optional `personProfileId`; `runExportJob` reads `person_profile_id` from DB and threads it to `queryAllExportTables`. Manifest includes `scope:"member"` and `personProfileId` for member exports.
  - **`exports.routes.ts`:** `POST /exports/household` now open to members with a linked profile (403 if no profile). Members receive a personal-data ZIP (their transactions/accounts/payslips/balance snapshots + shared reference data). `GET /:jobId` response includes `scope` field. Restore (`POST /household/import`) remains owner-only.
  - **`UserContext.tsx`:** New React context exposing `{ role, personProfileId }` for child pages. `ShellLayout.tsx` provides it from the existing `/auth/me` state.
  - **`ImportWorkspacePage.tsx`:** Uses `useCurrentUser()`; file-binding drafts and OFX auto-bind default `ownerScope/ownerPersonProfileId` to the member's profile for unbound files. New-account creation form also defaults to member's profile via `useEffect`.
  - **`TransactionsPage.tsx`:** Uses `useCurrentUser()`; transaction list URL filter auto-defaults to `ownerPersonProfileId=<personProfileId>` for members on mount (if no filter already set); manual-entry `addBelongsTo` defaults to member's profile.
- **Files:** `backend/db/migrations/0020_export_job_person_scope.sql`, `backend/src/modules/export/export-household-bundle.service.ts`, `backend/src/modules/export/export-job.service.ts`, `backend/src/modules/export/exports.routes.ts`, `frontend/src/UserContext.tsx`, `frontend/src/layout/ShellLayout.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/TransactionsPage.tsx`

### CR-109 (slice 4) — RBAC redesign: member-scoped ledger writes
- **Type:** CR (security/RBAC)
- **What:** Members can only write/modify transactions they own (`owner_person_profile_id = personProfileId`). All checks are in-route (no service changes).
  - **`PATCH /transactions/:id`:** Pre-checks transaction ownership for members (404 if not found, 403 if not theirs). Also strips `ownerScope`/`ownerPersonProfileId` from member PATCH requests — members cannot reassign ownership.
  - **`DELETE /transactions/:id`:** Same ownership pre-check.
  - **`POST /transactions`** (manual entry): Members may only create transactions on accounts they own (`owner_person_profile_id = personProfileId`).
  - **`POST /transactions/bulk-category`, `bulk-trash`, `bulk-restore`, `bulk-delete`:** For members, IDs are filtered to owned-only using a single `= ANY($n)` query. Response includes `skippedNotOwned: number` for members when any were filtered out.
  - **`POST /transactions/bulk-reassign-owner`:** Locked to `requireRole(["owner","admin"])` — household-level admin operation.
  - Helper `filterOwnedTransactionIds(householdId, ids, personProfileId)` added inline in `ledger.routes.ts`.
- **Tests:** All 265 passing.
- **Files:** `backend/src/modules/ledger/ledger.routes.ts`

### CR-109 (slice 3) — RBAC redesign: member-scoped import sessions
- **Type:** CR (security/RBAC)
- **What:** Members can now create and manage their own import sessions end-to-end. All `requireRole(["owner","admin"])` gates removed from import session routes; ownership enforced in-handler instead.
  - **Migration `0019`:** Adds `created_by_user_id TEXT REFERENCES app_user(id)` to `import_session`.
  - **`createImportSession`:** Accepts `createdByUserId`; stored in DB.
  - **`listImportSessionsForHousehold`:** Accepts optional `creatorUserId` filter; members see only their own sessions, owners/admins see all. Result includes `createdByUserId`.
  - **`ImportSessionRow`:** Now includes `created_by_user_id`.
  - **`POST /imports/sessions`:** Open to members. Members without a linked person profile receive 403.
  - **`GET /imports/sessions`:** Members receive only their own sessions.
  - **`GET /imports/sessions/:id`, `GET /imports/sessions/:id/summary`:** Members scoped to their own sessions (404 if not theirs).
  - **`POST /imports/sessions/:id/files`:** Members must own the session.
  - **`PATCH /imports/sessions/:id/status`:** Members must own the session.
  - **`PATCH /imports/sessions/:id/files/:fileId`:** Members must own the session AND must bind to a financial account scoped to their person profile (`owner_person_profile_id = personProfileId`).
  - **`DELETE /imports/sessions/:id/files/:fileId`:** Members must own the session.
  - **`POST /imports/sessions/:id/parse`, `canonicalize`, `undo-import`, `reconcile-payslip-async`:** Members must own the session.
  - **`POST /imports/sessions/:id/ofx-confirm`:** Members must own the session and bind to their own account.
- **Tests:** Updated RBAC baseline comment — 403 on member session create now comes from the profile check (no linked profile) rather than a role gate.
- **Files:** `backend/db/migrations/0019_import_session_creator.sql`, `backend/src/modules/imports/import-session.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/tests/app.test.ts`
- **Next:** Slice 4 — member-scoped ledger writes.

### CR-109 (slice 2) — RBAC redesign: member-scoped category, account, and institution writes
- **Type:** CR (security/RBAC)
- **What:** Members can now create/edit/delete their own categories, accounts, and custom institutions. Owner/admin access unchanged.
  - **Categories:** `createHouseholdCategory` stores `created_by_user_id`. `updateHouseholdCategory` and `deleteHouseholdCategory` accept a `caller` argument and return `FORBIDDEN` when a member attempts to edit/delete a category they did not create. `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` are now open to all authenticated users (no more `requireRole` gate); the service enforces ownership for members.
  - **Accounts:** `POST /imports/accounts` open to members — scope is forced to `ownerScope=person` / `ownerPersonProfileId=<member's profile>`. Members without a linked profile receive 403. `PATCH /imports/accounts/:id` checks `owner_user_id = userId` for members.
  - **Custom institutions:** `createHouseholdCustomInstitution` stores `created_by_user_id`. New `deleteHouseholdCustomInstitution` enforces ownership for members. `POST /imports/institutions/custom` open to all authenticated. New `DELETE /imports/institutions/custom/:id` route added (open to all; members can only delete their own).
- **Tests:** Updated RBAC baseline — asserts 201 on member category create; asserts 403 on member account create (no linked profile); imports/export/restore blocks unchanged.
- **Files:** `backend/src/modules/category/categories.service.ts`, `backend/src/modules/category/categories.routes.ts`, `backend/src/modules/imports/household-institutions.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/tests/app.test.ts`
- **Next:** Slice 3 — member-scoped import sessions.

### CR-109 (slice 1) — RBAC redesign: foundation — member identity, creator columns, no-profile guard
- **Type:** CR (security/RBAC)
- **What:** Foundational layer for member-scoped RBAC redesign. Establishes the mechanism by which services know *who* a member is and *what they own*:
  - **Migration `0018`:** Adds `created_by_user_id TEXT REFERENCES app_user(id)` to `category` and `household_custom_institution`. Existing rows are NULL; new rows created by members will carry this. (`financial_account` already has `owner_user_id` for the same purpose.)
  - **`auth.service.ts`:** `verifyToken` and `findUserByEmail` now JOIN `person_profile` to resolve `personProfileId` (the caller's `person_profile.id`). Returned as `null` if no linked profile exists. Resolved fresh on every request — not stored in JWT.
  - **`types.ts`:** `AuthUser` gains `personProfileId: string | null`.
  - **`ShellLayout.tsx`:** Members with `personProfileId === null` (login exists but not linked to any household profile) see a locked screen: "Not part of a household — contact your household admin."
- **Files:** `backend/db/migrations/0018_rbac_creator_columns.sql`, `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/types.ts`, `frontend/src/layout/ShellLayout.tsx`
- **Next:** Slice 2 — member-scoped category and institution writes.

### SEC-004 — RBAC lock-down: imports, categories, rules, and exports restricted to owner/admin
- **Type:** FIX + CR (security backlog item)
- **What:** Members previously had broad write access. Now locked:
  - **Imports** (`imports.routes.ts`): all write ops (POST /sessions, file upload, file bind, file delete, status transition, parse, canonicalize, undo-import, ofx-confirm, reconcile-payslip) → `owner|admin`
  - **Categories** (`categories.routes.ts`): POST, PATCH /:id, DELETE /:id → `owner|admin`
  - **Category rules** (`category-rules.routes.ts`): POST, POST /bulk, PATCH /:id, DELETE /:id, DELETE /household, POST /recategorize, POST /from-ledger → `owner|admin`
  - **Exports** (`exports.routes.ts`): POST /household (start export) → `owner|admin`; POST /household/import (restore, wipes all data) → `owner` only
  - Read-only routes, `POST /categories/rules/test`, and `POST /categories/rules/rule-learning-preview` remain open to all authenticated users
  - Ledger writes (categorize, trash, manual entry) remain open — household members need to triage transactions
- **Tests:** Extended `app.test.ts` RBAC baseline to assert 403 on import session create, category create, rule create, export start, and restore
- **Files:** `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/category/categories.routes.ts`, `backend/src/modules/category/category-rules.routes.ts`, `backend/src/modules/export/exports.routes.ts`, `backend/tests/app.test.ts`

### UX-SEC-002 — First-login banner for owner forced password change
- **Type:** UX fix
- **What:** When an owner account with `force_password_change=true` is hard-redirected to `/settings?tab=security`, they now see an amber banner: "First login: Your account was created with a temporary password. Please set a permanent password below before using the app." Previously the redirect was silent — no explanation for why every click landed on the settings page.
- **Files:** `frontend/src/layout/ShellLayout.tsx`

### SEC-003 — Export ZIP 48-hour auto-cleanup
- **Type:** FIX + CR (security backlog item)
- **What:** Export ZIP files now expire and are purged after 48 hours.
  - **Backend:** `purgeExpiredExports()` in `export-job.service.ts` deletes the ZIP file from disk and marks `export_job.status = 'expired'` for all `complete` rows older than 48h. `startExportCleanupSchedule()` runs on server startup and repeats every hour via `setInterval`.
  - **Migration:** `0017_export_job_expired.sql` — adds `'expired'` to the `status` CHECK constraint on `export_job`.
  - **Download route:** `GET /exports/:jobId/download` now returns **410 Gone** with `code: EXPORT_EXPIRED` for purged files instead of 404 EXPORT_FILE_MISSING.
  - **Frontend:** Settings page export section now shows a notice: "Export files are available for 48 hours after generation. Please download a local copy before then." Expired-download error shows a clear message prompting a new export.
- **Files:** `backend/db/migrations/0017_export_job_expired.sql`, `backend/src/modules/export/export-job.service.ts`, `backend/src/modules/export/exports.routes.ts`, `frontend/src/pages/SettingsPage.tsx`

---

## 2026-04-15 (security hardening — public deployment readiness)

### SEC-001 — Security hardening: 5-piece hardening pass for OCI/internet-facing deployment
- **Type:** FIX + CR
- **What:** Comprehensive security hardening across auth, transport, file handling, and session management. Addressed issues identified in a pre-release security review. Changes shipped in 5 logical slices:

  **Piece 1 — Pure additions (no user-visible change):**
  - `helmet()` middleware added to `buildApp()` — sets `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, `Content-Security-Policy`, `Referrer-Policy`, and other standard security headers.
  - `express.json({ limit: '50kb' })` — explicit body size cap (was implicit Express default).
  - `path.basename(file.originalname)` on multer uploads — strips any directory traversal sequences from client-supplied filenames before writing to disk.
  - File upload size limits: imports 50 MB/file, 20 files max; payslips 25 MB/file, 1 file (previously unlimited — memory DoS vector).
  - `jwt.sign` now explicitly passes `{ algorithm: 'HS256' }`; `jwt.verify` now passes `{ algorithms: ['HS256'] }` — prevents algorithm confusion attacks.
  - **Timing oracle fix:** `login()` now always runs `bcrypt.compare` even when the email is not found (compares against a dummy hash). Previously, a missing email returned in ~1ms vs ~80ms for a wrong password, leaking which emails have accounts.

  **Piece 2 — bcrypt async + stronger rounds:**
  - All `bcrypt.compareSync` / `bcrypt.hashSync` calls replaced with `await bcrypt.compare` / `await bcrypt.hash` — synchronous bcrypt blocked the Node.js event loop for ~80-100ms per call.
  - Cost factor raised from `10` → `12` (OWASP 2023 recommendation; ~4× more work per hash for new passwords). Existing hashes remain valid — bcrypt reads the cost factor from the stored hash on compare.

  **Piece 3 — Login hardening + seed fix:**
  - `POST /auth/login` now rate-limited: 12 attempts per 15-minute window per IP via `express-rate-limit`. Returns 429 with descriptive message. Skipped in `MODE=TEST` so integration tests are unaffected.
  - Password strength enforced on `POST /auth/change-password`: min 10 chars + must include uppercase, lowercase, digit, and special character. Login schema unchanged (allows existing stored passwords to log in; strength only required when choosing a new password).
  - Bootstrap seed (`0001_bootstrap.sql`): default owner account (`owner@example.com`) now has `force_password_change = true`. Previously the owner was seeded without forced change — a public instance with the default credentials was accessible without any change prompt.

  **Piece 4 — Config hardening:**
  - `JWT_SECRET` minimum raised from 16 → 32 chars.
  - Server refuses to start in `PROD` if `JWT_SECRET` equals the default dev value — prevents accidental deployment with a well-known secret.
  - `ALLOWED_ORIGIN` env var added: when set, CORS header is locked to that origin. Unset in `TEST` (dev proxy keeps working); unset in `PROD` means no `Allow-Origin` header (browser cross-origin requests blocked). `.env.example` updated with guidance. Previously CORS was `Access-Control-Allow-Origin: *` unconditionally.

  **Piece 5 — Server-side logout:**
  - New `POST /auth/logout` (requires auth): increments `token_version`, immediately invalidating all existing JWTs for that user. Returns 204.
  - Frontend `AppTopBar.tsx` logout now fires `POST /auth/logout` (fire-and-forget) before clearing localStorage. If the server call fails the user is still logged out locally — no user-visible breakage.

- **Why:** App will be deployed on OCI free tier exposed to the internet. All items were identified in a pre-release security audit.
- **Files:** `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/config/env.ts`, `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.routes.ts`, `backend/src/modules/household/household.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/imports/import-session.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`, `backend/db/seeds/0001_bootstrap.sql`, `frontend/src/layout/AppTopBar.tsx`, `.env.example`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/CHANGE_HISTORY.md`.

### SEC-002 — Hard gate for owner force-password-change
- **Type:** FIX
- **What:** Owner accounts with `force_password_change = true` are now hard-redirected to `/settings?tab=security` on every route until the password is changed. Previously the banner said "must be changed before you continue" but nothing blocked navigation — the gate was purely visual. Member accounts retain the soft banner (redirect on their own time). Admin accounts follow member behavior (soft banner only).
- **Why:** A freshly seeded OCI/public instance with the default `owner@example.com` / `ChangeMe123!` credentials was fully usable without ever changing the password. The banner alone does not protect against an owner clicking away. Hard gate closes the gap.
- **Behavior:** `ShellLayout` now reads `role` from `GET /auth/me` alongside `forcePasswordChange`. If `forcePasswordChange && role === 'owner'` and the current path is not `/settings`, a `<Navigate replace>` fires immediately. The Settings page itself is always reachable so the owner can complete the password change.
- **Files:** `frontend/src/layout/ShellLayout.tsx`, `docs/CHANGE_HISTORY.md`.

---

## 2026-04-14 (multi-user onboarding + RBAC audit)

### CR-108 — Multi-user onboarding: login accounts for household members
- **Type:** CR
- **What:** Owner/admin can now create a login account when adding a household member, or for existing members later. Password defaults to `ChangeMe123!` and `force_password_change` is set — the member sees a banner on first login directing them to Settings → Security to change it.
- **Backend:**
  - Migration `0016_app_user_force_password_change.sql` — adds `force_password_change BOOLEAN NOT NULL DEFAULT false` to `app_user`
  - `household.service.ts` — `createHouseholdMember` extended with `createLogin?: boolean` (creates `app_user` + links `person_profile.linked_user_id`); new `createLoginForMember` for existing members; new `getHouseholdMemberDataCount`; `deleteHouseholdMember` now accepts `{ deleteLogin }` instead of blocking with `HAS_LOGIN_ACCOUNT`
  - `auth.service.ts` — `changePassword` clears `force_password_change`; new `getForcePasswordChange` helper
  - `auth.routes.ts` — `GET /auth/me` now returns `forcePasswordChange: boolean`
  - `household.routes.ts` — `POST /household/members` accepts `createLogin`; new `POST /household/members/:id/create-login`; new `GET /household/members/:id/data-count`; `DELETE /household/members/:id` accepts `{ deleteLogin }` body
  - `ledger.service.ts` + `ledger.routes.ts` — `POST /ledger/bulk-reassign-owner` reassigns all transactions from one person profile to another
- **Frontend:**
  - `SettingsPage.tsx` — new member rows show "Create login" checkbox with default-password note; existing members show "Has login account" (green) or "No login / Create login" button; delete confirmation warns about assigned transaction/payslip counts and offers "Also delete login account" checkbox
  - `ShellLayout.tsx` — fetches `GET /auth/me` after login; shows amber banner "Your password is temporary — change it now" if `forcePasswordChange`; banner clears on `app:password-changed` event
- **Default password:** `ChangeMe123!` — forced change on first login
- **Files:** `backend/db/migrations/0016_app_user_force_password_change.sql`, `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.routes.ts`, `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`, `backend/src/modules/ledger/ledger.service.ts`, `backend/src/modules/ledger/ledger.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/layout/ShellLayout.tsx`.

### PRD-006 — RBAC current state audit
- **Type:** PRD
- **What:** The `member` role currently has broad write access. Only the following are restricted to `owner`/`admin`:
  - Household settings, member management (`/household/*`)
  - Account create/edit (`POST/PATCH /imports/accounts`)
  - Custom institution create (`POST /imports/institutions/custom`)
  - Built-in category rule overrides (`/categories/rules/builtin/*`)
  - Everything else — ledger writes, categories, custom rules, imports, budgets, payslips, exports — is accessible to `member` role.
- **Decision:** Acceptable for household use where members are trusted family. A role-based lock-down of imports and category management is **backlog** (no CR yet).
- **Backlog items documented:**
  1. Lock `POST/DELETE /categories` (custom category CRUD) to owner/admin
  2. Lock `POST/DELETE /categories/rules` (custom rule CRUD) to owner/admin
  3. Lock import session create/finalize to owner/admin (members can view but not import)
  4. Lock export/restore to owner/admin
  5. Self-service "request access" invite flow from home page (member signs up using email already added by owner)

## 2026-04-14 (memo editing on transactions)

### CR-107 — Inline memo editing on transaction rows
- **Type:** CR
- **What:** Users can now add or edit a free-text memo on any posted or needs-review transaction directly from the transaction list. The memo line is hidden until the row is hovered (hover-reveal). If a memo is already set it is always visible. Clicking the pencil icon enters inline edit mode — Enter saves, Escape cancels. Trashed rows show memo as read-only (no edit affordance).
- **Backend:** `PATCH /ledger/:id` extended to accept `{ memo: string | null }` as a memo-only update path. New service function `updateCanonicalTransactionMemo` in `ledger.service.ts`.
- **Frontend:** `TransactionsPage.tsx` — new `editingMemoId` / `memoDraft` state, `startMemoEdit` / `cancelMemoEdit` / `saveMemo` handlers, description cell redesigned to show merchant as primary + memo as secondary hover-reveal line.
- **CSS:** New `.transactions-page__memo-line`, `.transactions-page__memo-pencil`, `.transactions-page__memo-edit`, `.transactions-page__memo-input`, `.transactions-page__memo-btn` rules in `index.css`.
- **Why memo not merchant:** Merchant is the source-parsed description and part of the dedup fingerprint — editing it would diverge from the import source. Memo is a separate annotation field, not in the fingerprint, safe to edit freely.
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `backend/src/modules/ledger/ledger.routes.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/index.css`.

## 2026-04-14 (transactions UX: pagination + clear filters; net worth: remove misleading eye icons)

### UX-018 — Transactions: improved pagination + "Clear all filters" button
- **Type:** UX
- **What:**
  1. Pagination bar now shows "Showing 1–100 of 905 transaction(s). Page 1 of 10." instead of the raw offset/limit debug text.
  2. Added a "Per page" selector (25 / 50 / 100 / 200) next to Prev/Next so users can control page size.
  3. Added a "Clear all filters" button in the filter toolbar (visible only when any filter is active) — one-click reset to default view, same as the existing link in the active-filters paragraph.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`.

### UX-019 — Net worth: remove misleading "View transactions" links from Trend card
- **Type:** UX
- **What:** The Period Summary table had eye-icon links and the Trend chart tooltip had a "View transactions →" link, both navigating to Transactions filtered by that date. These were misleading: net worth balances come from `account_balance_snapshot` (manual entries + import-sourced snapshots), not from the transaction ledger. There is no guarantee any transaction exists for a given balance date, so the links could lead to empty results and imply a relationship that does not exist. Both removed. The per-account drill-down links in the Balance Sheet table below (linking to an account's import file) are intentional and remain.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

## 2026-04-14 (net worth UX + balance resolution fix)

### FIX-007 — Net worth: balance resolution — most-recent wins (manual or import)
- **Type:** FIX
- **What:** The balance resolution order previously hard-coded **manual > import** regardless of date. If a manual snapshot existed from March 30 and an import snapshot existed from April 5 on the same account, the March 30 value was shown. Fixed: both manual and import snapshots are fetched concurrently; the one with the **more recent `as_of_date`** is used. Tie-break favours manual (explicit user entry). The legacy import-file-hint fallback is unchanged (only triggers when no `account_balance_snapshot` row exists at all).
- **Files:** `backend/src/modules/reports/balance-sheet.service.ts`.

### UX-013 — Net worth: remove overlay accounts from trend chart
- **Type:** UX
- **What:** Removed the "Overlay accounts on chart" MultiSelect from the Trend section. The feature added per-account line overlays but had rendering bugs and low utility given the Balance Sheet table below already shows per-account detail.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

### UX-014 — Net worth: default period changed to Last 3 months
- **Type:** UX
- **What:** Trend chart and custom range now default to **Last 3 months** (was Last 12 months). Reduces initial data load and focuses on recent activity.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

### UX-015 — Net worth: "Belongs to" filter aligned with Transactions page
- **Type:** UX
- **What:** Removed the spurious "Scope > All accounts" group from the `HierarchicalSearchPicker` dropdown. The picker's existing `clearable` prop already handles the "all accounts" state. Group labels now match TransactionsPage: `Household` / `Members`.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

### UX-016 — Net worth: more Period and Interval options + Period Summary "Date" label
- **Type:** UX
- **What:** Added **Last 2 years** (`2y`) and **Last 3 years** (`3y`) period presets. Added **Quarter-end** interval option (generates March 31, June 30, Sept 30, Dec 31 sample dates). Renamed "Sample" column in the Period Summary table to "Date". Updated backend to accept and generate `quarter` interval points.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`, `backend/src/modules/reports/balance-sheet.service.ts`, `backend/src/modules/reports/reports.routes.ts`.

### UX-017 — Net worth: Top 5 Assets + Top 5 Liabilities panels
- **Type:** UX
- **What:** Added ranked quick-view panels between the summary cards and the full account table. Each panel shows up to 5 accounts sorted by balance magnitude, with a clickable link to the account's transactions. Assets highlighted green, liabilities amber. Only renders when balance data exists.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

---

## 2026-04-13 (net worth, member management, security)

### FIX-003 — Net worth: retirement accounts excluded from balance sheet
- **Type:** FIX
- **What:** `accountSide()` in `balance-sheet.service.ts` only classified `checking`, `savings`, `investment` as assets. `retirement` fell through to `null` → those accounts were invisible on the Net Worth page. Added `retirement` to the asset branch.
- **Files:** `backend/src/modules/reports/balance-sheet.service.ts`, `docs/API_BALANCE_SHEET.md`.

### FIX-004 — Net worth: liability account balance sign normalization on import
- **Type:** FIX
- **What:** OFX files (and some PDF parsers) report credit-card / loan balances as **negative** values (e.g. `-500.00` = you owe $500). The net-worth formula stores liability magnitudes as **positive** (`netWorth = assetSum − liabilitySum`), so a stored `-500` was _adding_ $500 to net worth instead of subtracting it. Fixed: when persisting a statement balance snapshot for a `credit_card`, `loan`, or `mortgage` account, the value is negated if negative. Applies to any parser that returns `statementBalances`.
- **Files:** `backend/src/modules/imports/import-parser.service.ts`.

### FIX-005 — Wealthfront PDF: balance regex too strict + starting balance not extracted
- **Type:** FIX
- **What:** The ending-balance regex used literal `\n` as separator; if `pdf-parse` emitted different whitespace the match silently failed and no snapshot was persisted. Changed both starting and ending balance regexes to `\s+`. Also added **starting balance** extraction (was always `null` before) so `statementBalances.beginning` / `.asOfStart` are now populated.
- **Files:** `backend/src/modules/imports/profiles/wealthfront-investment-pdf.ts`.

### FIX-006 — Wealthfront import inference: `checking` account type not matched
- **Type:** FIX
- **What:** `inferParserProfile` only matched Wealthfront accounts with type `investment | savings | retirement`. Wealthfront Cash Account is typically set up as `checking` (also the default in the account form), so the auto-match returned `null` → "couldn't match this file". Added `checking` to the CSV condition and added a new Wealthfront PDF inference branch. Updated the stale "stub" comment in `profile-ids.ts`.
- **Files:** `frontend/src/import/inferParserProfile.ts`, `frontend/src/import/inferParserProfile.test.ts`, `frontend/src/import/profileLabels.ts`, `backend/src/modules/imports/profiles/profile-ids.ts`.

### CR-106 — Member management: remove member (DELETE /household/members/:id + UI)
- **Type:** CR
- **What:** Added `DELETE /household/members/:memberId` (owner/admin only). Deletes both `household_membership` and `person_profile` in a transaction. Returns **409 HAS_LOGIN_ACCOUNT** when the member has a linked `app_user`. Frontend: saved member rows now show a **Remove** button (confirm dialog, calls DELETE, refreshes list). Unsaved draft rows get a **Discard** button. Docs updated.
- **Files:** `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/API_HOUSEHOLD.md`.

### FIX-007 — 401 interceptor: auto-clear token + redirect to login on session expiry
- **Type:** FIX
- **What:** `apiJson` and `apiFetch` now call `setToken(null)` on a **401** response. `RequireAuth` re-renders on token change and redirects to home/login automatically. Previously, expired tokens caused raw error messages ("Missing bearer token") with no recovery.
- **Files:** `frontend/src/api.ts`.

---

## 2026-04-13 (developer ergonomics)

### DX-001 — One-command npm scripts map + setup `.env` bootstrap
- **Type:** DX + docs
- **What:** Root `package.json` adds **`start:dev`** / **`stop:dev`** (aliases for `services:start` / `services:stop`), **`db:reset`** (alias for `db:cleanup`), **`db:reset:dev`** (cleanup + dev seeds). **`scripts/setup.sh`** copies **`.env.example` → `.env`** when missing and reminds to start Docker Postgres. **`README.md`**, **`docs/RUNBOOK.md`**, **`CLAUDE.md`**, **`ENVIRONMENT_VARIABLES.md`**, **`LOGGING.md`**, **`frontend/README.md`** updated (Postgres quick start; `db:cleanup` no longer documented as `npm run db:cleanup -- --yes`).
- **Files:** `package.json`, `scripts/setup.sh`, `README.md`, `docs/RUNBOOK.md`, `CLAUDE.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/LOGGING.md`, `frontend/README.md`, `docs/CHANGE_HISTORY.md`.

---

## 2026-04-13 (bank parsers, cont.)

### CR-104 — BoA credit card CSV: date ISO output + test coverage
- **Type:** FIX + CR
- **What:** `boa-credit-card-csv.ts` was emitting `MM/DD/YYYY` into `txn_date` (same issue as Marcus before CR-101). Fixed to output `YYYY-MM-DD`. Added 5 unit tests covering date conversion, amounts, reference_id, and description.
- **Files:** `backend/src/modules/imports/profiles/boa-credit-card-csv.ts`, `backend/tests/csv-parsers.test.ts`.

### CR-105 — Wealthfront Cash Account PDF statement parser
- **Type:** CR (new parser)
- **What:** Built `wealthfront-investment-pdf.ts` for Wealthfront monthly PDF statements. Parses deposits (ACH Received), withdrawals (ACH/RTP Disbursed), and interest payments. Skips "Transfer between Wealthfront and Program Banks" rows — these are internal FDIC-sweep allocations with no cash-flow meaning. Extracts ending balance → `statementBalances` → auto-persisted as `account_balance_snapshot` (same pipeline as BoA/OFX/Marcus). Wired into `import-parser.service.ts` with full balance-snapshot pass-through. 11 new tests covering both Feb and March 2026 statement patterns (including RTP/FedNow with mid-row footnote).
- **Files:** `backend/src/modules/imports/profiles/wealthfront-investment-pdf.ts` (new), `backend/src/modules/imports/import-parser.service.ts`, `backend/tests/pdf-parsers.test.ts`.

### FIX-001 — BoaStatementBalances source union expanded; Marcus source corrected
- **Type:** FIX
- **What:** `BoaStatementBalances.source` was a narrow union that excluded `marcus_online_savings_pdf` and `wealthfront_investment_pdf`. Extended the union. Marcus was incorrectly using `"ofx_transactions"` as its source value — corrected to `"marcus_online_savings_pdf"`.
- **Files:** `backend/src/modules/imports/profiles/boa-checking-savings-csv.ts`, `backend/src/modules/imports/profiles/marcus-online-savings-pdf.ts`.

### BACKLOG-001 — Resolution queue: bulk-resolve by description pattern (not yet implemented)
- **Type:** Backlog
- **What:** After importing Discover / Wealthfront historical data, the `unknown_category` resolution queue will grow. A "apply this category to all transactions matching this description" action would significantly reduce per-item review work. Proposed: resolution item detail shows a "categorize all N matching" option that fires a new `POST /resolution/bulk-assign` endpoint, creates a category rule, and resolves all matching open items in one step.

---

## 2026-04-13 (bank parsers)

### CR-101 — Marcus Online Savings PDF: date normalization, balance snapshot, hardened sign detection
- **Type:** FIX + CR
- **What:** Three improvements to `marcus-online-savings-pdf.ts`:
  1. **Date output is now ISO (YYYY-MM-DD)** — previously emitted `MM/DD/YYYY` into `transaction_raw.txn_date`; canonical ingest normalized it for fingerprinting but the raw table stored the un-normalized form.
  2. **Ending balance snapshot extraction** — the `Ending Balance` row is now captured and returned as `statementBalances.ending` so `import-parser.service.ts` can persist an `account_balance_snapshot` (same path as BoA and OFX). Previously the row was silently dropped.
  3. **Sign keyword list expanded** — added `incoming`, `direct deposit`, `ach credit`, `refund`, `outgoing`, `wire out`, `fee` to cover common Marcus savings transaction types. Unknown types still default to debit with an explanatory comment.
- **Files:** `backend/src/modules/imports/profiles/marcus-online-savings-pdf.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/tests/pdf-parsers.test.ts`.

### CR-102 — Discover card CSV: preserve Discover-supplied Category in source_row
- **Type:** CR
- **What:** The Discover export includes a `Category` column (e.g. "Supermarkets", "Payments and Credits"). It is now preserved in `source_row["Category"]` so it is available if category-hint logic is added later. No change to how categories are assigned during classification.
- **Files:** `backend/src/modules/imports/profiles/discover-card-csv.ts`, `backend/tests/csv-parsers.test.ts`.

### CR-103 — Register stub profiles for Capital One card CSV and Wealthfront PDF
- **Type:** CR
- **What:** Added `capital_one_card_csv` and `wealthfront_investment_pdf` to `PARSER_PROFILE_IDS`. Both return `NOT_IMPLEMENTED` from the parser service. Capital One CSV format is TBD; Wealthfront PDF parser needs a sample statement before it can be implemented. These stubs allow accounts to be associated with the profile IDs in the UI without silent failures.
- **Files:** `backend/src/modules/imports/profiles/profile-ids.ts`, `backend/src/modules/imports/import-parser.service.ts`.

---

## 2026-04-13

### DB-006 — Rename `migrations_pg` / `seeds_pg` to `migrations` / `seeds`
- **Type:** DB + housekeeping
- **What:** Dropped the `_pg` suffix now that Postgres is the only database. `backend/scripts/gen-0026-migration.mjs` writes the built-in rules block using Postgres `INSERT ... ON CONFLICT DO NOTHING` into `backend/db/seeds/0001_bootstrap.sql`.
- **Files:** `backend/db/migrations/`, `backend/db/seeds/`, `backend/src/db/apply-pg-migrations.ts`, `scripts/db-pg.mjs`, `scripts/db.sh`, `backend/scripts/gen-0026-migration.mjs`, `Dockerfile`, `CLAUDE.md`, `backend/db/README.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/POSTGRES_CUTOVER.md`, `docs/PRODUCTION_SETUP.md`, `docs/RUNBOOK.md`, and related doc touch-ups.

### DB-005 — Built-in merchant scopes: selective `debit_only` -> `any`
- **Type:** DB
- **What:** Updated refund-prone **merchant** built-ins to **`any`** scope (kept broad/generic and directional finance rules unchanged). Changed keys: `dining_1..8`, `coffee_0..2`, `groceries_0..4`, `groceries_7..10`, `transit_0..6`, `transit_9`. Source-of-truth seed and fixture CSV kept in sync.
- **Files:** `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/classification-rules-builtin.csv`.

### DB-004 — Global category Shopping > Office (`0015` + bootstrap seed)
- **Type:** DB
- **What:** Added default leaf **`Office`** under **`Shopping`** (`id` **`30000000-0000-0000-0000-000000000167`**) for work-related spend (memberships, conference fees, supplies). Migration **`0015_category_shopping_office.sql`**, bootstrap seed, fixture categories list, and **`DEFAULT_CATEGORY_IDS.shoppingOffice`** updated.
- **Files:** `backend/db/migrations/0015_category_shopping_office.sql`, `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/categories.csv`, `backend/src/modules/category/category-ids.ts`.

### DB-003 — Global category Mobility > Parking & Tolls (`0014` + bootstrap seed)
- **Type:** DB
- **What:** Added default leaf **`Parking & Tolls`** under **`Mobility`** (`id` **`30000000-0000-0000-0000-000000000166`**). Migration **`0014_category_mobility_parking_tolls.sql`**; **`seeds/0001_bootstrap.sql`**; **`fixtures/category-import/categories.csv`**; **`DEFAULT_CATEGORY_IDS.mobilityParkingAndTolls`**.
- **Files:** `backend/db/migrations/0014_category_mobility_parking_tolls.sql`, `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/categories.csv`, `backend/src/modules/category/category-ids.ts`.

### DB-002 — Global category Shopping > Software (`0013` + bootstrap seed)
- **Type:** DB
- **What:** Added default leaf **`Software`** under **`Shopping`** (`id` **`30000000-0000-0000-0000-000000000165`**) for SaaS / subscription-style spend. Migration **`0013_category_shopping_software.sql`** inserts for existing DBs; **`backend/db/seeds/0001_bootstrap.sql`** includes the row for fresh **`db:seed`**. **`fixtures/category-import/categories.csv`** and **`DEFAULT_CATEGORY_IDS.shoppingSoftware`** in **`category-ids.ts`** updated.
- **Files:** `backend/db/migrations/0013_category_shopping_software.sql`, `backend/db/seeds/0001_bootstrap.sql`, `fixtures/category-import/categories.csv`, `backend/src/modules/category/category-ids.ts`.

### CR-101 — Home page redesign: remove diagonal cut, two-panel split, dark mode contrast
- **Type:** CR / UX / Frontend
- **What:**
  1. **Diagonal gradient removed** — the `linear-gradient(165deg, …42%…42%…)` hard-angle cut across the hero caused bullet text (Categories & rules, Budgets & net worth) to land on the light side and become invisible. Replaced with a CSS `::before` pseudo-element that covers the left 58% of the viewport in a solid dark navy gradient — true vertical split, no diagonal.
  2. **Mobile** — on narrow screens the `::before` panel is hidden; the whole background becomes the navy gradient (hero text always on dark).
  3. **Auth card** — removed `backdrop-filter: blur` and glass effect; card is now a clean `#fff` with a subtle box-shadow, matching polished SaaS finance app conventions.
  4. **Dark mode home** — both panels switch to a dark blue-charcoal palette; right panel uses `#161d2e` instead of translucent glass.
  5. **Dark mode dashboard contrast** — surface variables shifted from near-identical gray to slightly blue-tinted navy (`--color-surface: #1a2236`, `--color-surface-alt: #1f2940`, `--color-border: #2d3a52`) so cards visually separate from the page background. Dark mode card gets a subtle inset glow.
  6. **Glow orb** — repositioned to left panel only; uses teal radial gradient instead of sky-blue.
- **Files:** `frontend/src/index.css`.

### UX-001 — Categories page: icon buttons + SourceBadge on subcategory rows
- **Type:** UX / Frontend
- **What:**
  1. **Child row action buttons** — subcategory rows (child rows) previously used text buttons ("Edit" / "Delete" / "—"). Updated to match parent row style: `<IconPencil size={13} />` icon button for edit, `<IconTrash size={13} />` (red-tinted) for delete. Non-editable / non-deletable rows show no button (dash removed).
  2. **SourceBadge on child rows** — subcategory source column previously rendered raw text ("Built-in template"). Now renders the same `<SourceBadge>` pill badge as parent rows ("Built-in" gray / "Yours" emerald). `sourceLabel()` helper removed as it's no longer used.
- **Files:** `frontend/src/pages/CategoriesPage.tsx`.

### UX-002 — Remove broken /resolution-queue link; redirect to Needs Review
- **Type:** UX / Frontend
- **What:** A banner in the Needs Review tab linked to `/resolution-queue`, which rendered a blank page. The separate resolution queue concept is removed — all transaction review happens in the Transactions page itself. Changes:
  1. **Banner link removed** — near-duplicate orphan banner no longer links to `/resolution-queue`. Message updated to explain the items exist but can be ignored.
  2. **Route redirect** — `/resolution-queue` now redirects to `/transactions?needsReview=true` (same as the existing `/resolution` redirect). `ResolutionQueuePage` import removed from `App.tsx`.
- **Files:** `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/App.tsx`.

### CR-100 — Import Workspace page redesign: icon buttons, status badges, HelpIcon, hub card rows
- **Type:** CR / UX / Frontend
- **What:** Aesthetic overhaul of `ImportWorkspacePage.tsx`.
  1. **Hub page (no sessionId)** — Page h1 "Import" gets a `<HelpIcon>`. Nav links (Home / Classification rules) moved inline. "New import session" button gains `<IconUpload>`. Recent sessions table replaced with card-based rows — each row shows date, `<SessionStatusBadge>`, file count, truncated session id, and an "Open" link.
  2. **`SessionStatusBadge` component** — Colored pill badge for session status: Created (muted), Processing (blue), Review (amber), Finalized (emerald), Failed (red).
  3. **Session workspace header** — Removed the long `<p>` paragraph with session id. Replaced with compact inline row: `<SessionStatusBadge>`, truncated session id code, "Copy id" button. `<HelpIcon>` on h1.
  4. **Section headings** — Verbose description paragraphs removed from "Upload files", "Files & account", "Run import", "Classification matcher preview", "Undo ledger posting", and "Finalize session". Each replaced with an inline `<HelpIcon>` tooltip.
  5. **Run import button** — `<IconPlayerPlay size={15} />` added inline.
  6. **Undo posting button** — `<IconArrowBackUp size={15} />` added inline; label shortened to "Undo posting".
  7. **Finalize session button** — `<IconLock size={15} />` added inline.
  8. **Remove file button** — `<IconTrash size={12} />` + compact "Remove" label (red-tinted, replaces "Remove from session" text button).
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`.

### CR-099 — Classification Rules page redesign: badge pills, icon buttons, collapsible sections, HelpIcon
- **Type:** CR / UX / Frontend
- **What:** Aesthetic overhaul of `CategoryRulesPage.tsx`.
  1. **Page header** — Removed the 3-paragraph wall-of-text intro. Replaced with a compact `<HelpIcon>` tooltip on the "Classification rules" h1. Navigation links (Categories / Transactions / Import) moved inline to the header row.
  2. **`MatchTypeBadge` component** — Renders `CONTAINS` (blue), `PREFIX` (purple), `REGEX` (amber) as colored pill badges in the match type column for both household and built-in rules tables.
  3. **`AmountScopeBadge` component** — Renders `ANY` (muted gray), `CREDIT` (emerald green), `DEBIT` (red) as colored pill badges in the amount scope column.
  4. **Icon buttons** — Edit → `<IconPencil size={13} />`, Delete → `<IconTrash size={13} />` (red-tinted) in both household and built-in rule tables. Save/Cancel remain as text buttons (appropriate for inline form context).
  5. **Collapsible Import/Export section** — Wrapped in `<details><summary>` with a `<HelpIcon>` explaining create-only behavior. Closed by default to reduce visual noise for users who don't need it.
  6. **Collapsible Search & test + Re-apply section** — Wrapped in `<details><summary>` with a `<HelpIcon>`. Reduces initial page density.
  7. **Section headings** — All verbose description paragraphs under section h2s removed; replaced with inline `<HelpIcon>` tooltips.
- **Files:** `frontend/src/pages/CategoryRulesPage.tsx`.

### CR-098 — Categories page redesign: SourceBadge, icon buttons, HelpIcon
- **Type:** CR / UX / Frontend
- **What:** Aesthetic overhaul of `CategoriesPage.tsx`.
  1. **Page header** — Removed the 5-paragraph wall-of-text intro. Replaced with a compact `<HelpIcon>` tooltip on the "Categories" h1. Navigation links moved inline to the header row.
  2. **`SourceBadge` component** — Replaced plain text (`Built-in` / `Yours (household)`) in the Source column with a colored pill badge. Household-scoped categories render in emerald teal; built-ins render in muted gray. A `<HelpIcon>` added to the Source column header explains the distinction.
  3. **Icon buttons** — "Edit" and "Delete" text buttons replaced with `<IconPencil size={13} />` and `<IconTrash size={13} />` icon buttons (using `replace_all` to cover both table rows and inline editing state) with appropriate `title` attributes.
  4. **Inline edit state** — Save and Cancel buttons remain text labels (appropriate for a form-confirmation context).
- **Files:** `frontend/src/pages/CategoriesPage.tsx`.

### CR-095 — Net Worth page redesign: AreaChart gradient, stat cards, HelpIcon, icon buttons
- **Type:** CR / UX / Frontend
- **What:** Visual overhaul of `NetWorthPage.tsx`.
  1. **Page header** — Removed the 4-line wall-of-text intro paragraph. Replaced with a compact `<HelpIcon>` tooltip on the "Net worth" h1. "Manage accounts" link moved inline to the header row.
  2. **AreaChart with gradient** — Upgraded `LineChart` → `AreaChart`. Net worth renders as a bold emerald area with a soft gradient fill. Assets: lighter emerald line+fill. Liabilities: amber/orange with gradient. Account overlay lines remain as `<Line>` over the area chart.
  3. **Chart colors** — All hardcoded hex replaced: net worth `#059669` → `#15803d` (emerald-700), assets `#2563eb` → `#22c55e` (emerald-500), liabilities `#dc2626` → `#f59e0b` (amber — debts are a caution, not danger). Tooltip now shows color-coded series names.
  4. **Period summary** — "View" text links replaced with `<IconEye>` icon buttons. Change row color-coded green/red. Verbose description paragraph removed; replaced with `<HelpIcon>`.
  5. **Balance sheet KPI cards** — Replaced plain inline row with 3 stat cards matching Budget page style (colored `borderTop` accent: green for assets, amber for liabilities, conditional for net worth).
  6. **Balance sheet heading** — `<HelpIcon>` on h2; verbose description paragraph removed.
  7. **Edit pencil** — Custom inline SVG replaced with `<IconPencil size={15} />` from @tabler/icons-react.
- **Files:** `frontend/src/pages/NetWorthPage.tsx`.

### CR-097 — Payslips page redesign: KPI cards, card-based list, icon buttons, HelpIcon
- **Type:** CR / UX / Frontend
- **What:** Aesthetic overhaul of `PayslipsPage.tsx`.
  1. **Hero KPI cards** — 4 stat cards at the top when payslips exist: Latest gross, Latest net, YTD gross, YTD net. Each has a colored `borderTop` accent (emerald for gross/net current, muted for YTD). Derived from `data.items[0]` (newest payslip, sorted by backend).
  2. **Page header** — `<HelpIcon>` replaces the intro paragraph. Two action buttons added: "Import PDF" (links to /imports, outline style) and "Add manually" (emerald filled, `<IconPlus>`).
  3. **Belongs-to filter** — Compact inline label + `<HelpIcon>` tooltip; verbose explanation paragraph removed.
  4. **Charts section** — `<HelpIcon>` on "Income & payroll" heading.
  5. **Payslip list** — Replaced the plain `<table>` with card-based rows. Each row: period start/end + pay date, gross + net in a two-column mini-grid, eye icon (`<IconEye>`) + trash icon (`<IconTrash>`) action buttons. Net pay rendered in emerald green.
  6. **Empty state** — Updated copy to reference the two add actions.
- **Files:** `frontend/src/pages/PayslipsPage.tsx`.

### CR-096 — Transactions page: duplicate filter bug fix + aesthetic overhaul
- **Type:** FIX + CR / UX / Backend + Frontend
- **Bug fix (backend):** When `resolutionType=duplicate_ambiguity` was selected in Needs Review, exact duplicate rows (`status='duplicate'`) disappeared. Exact duplicates are created by fingerprint deduplication with no `resolution_item` — they surface via `status NOT IN ('posted','trashed')`. The `resolutionTypes` SQL predicate required an `EXISTS` on `resolution_item`, excluding them. **Fix:** when `duplicate_ambiguity` is in `resolutionTypes`, the predicate now also includes `tc.status = 'duplicate'` via an `OR` clause. Both exact and near-duplicates appear when the "Duplicate" filter is active.
- **Aesthetic changes (frontend):**
  1. **Page header** — Wall-of-text intro replaced with compact `<HelpIcon>` tooltip. Session/dashboard links moved inline.
  2. **Status badges** — Non-`posted` transactions now show a colored pill badge next to the amount (`Duplicate` → amber, `Trashed` → red, `Pending` → gray).
  3. **Icon buttons** — Trash → `<IconTrash>`, Restore → `<IconArrowBackUp>`, Hard-delete → red-tinted `<IconTrash>`.
  4. **Add transaction button** — `<IconPlus>` added alongside label, emerald primary styling.
  5. **More filters toggle** — Verbose FTS paragraph replaced with `<HelpIcon>`. Toggle label improved.
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `frontend/src/pages/TransactionsPage.tsx`.

### CR-094 — Budget page redesign: "Add a category" placement, icon nav, HelpIcon, CSS var colors
- **Type:** CR / UX / Frontend
- **What:** Aesthetic and UX improvements to `BudgetPage.tsx`.
  1. **"Add a category" placement** — Moved the category picker (select + Add button) from `<tfoot>` *after* the Total row to *before* it. Total row now correctly sits as the last summary row, with "Add a category" appearing above it. This is the correct UX — users add categories, then see the total update.
  2. **Progress bars use CSS vars** — `ProgressBar` now uses `var(--color-success)`, `var(--color-warning)`, `var(--color-danger)` instead of hard-coded hex (#16a34a, #d97706, #dc2626). Responds correctly to dark mode.
  3. **KPI summary cards** — Each card gets a color-coded `borderTop` accent: neutral (budgeted), green (remaining) or red (over budget), and red on "Spent" when over budget. Labels use uppercase tracking for cleaner finance aesthetic.
  4. **Chevron icon nav** — Month navigation `<` / `>` text replaced with `IconChevronLeft` / `IconChevronRight` icon buttons (`@tabler/icons-react`).
  5. **HelpIcon on page title** — Inline help tooltip added next to "Budget" heading via `<HelpIcon>`. SetupForm description paragraph condensed to one line with a `<HelpIcon>` for full detail.
  6. **Edit budget button** — Now includes `IconPencil` icon and cleaner inline-flex styling.
- **Files:** `frontend/src/pages/BudgetPage.tsx`.

### CR-090 — Design system foundation: emerald + amber palette, dark mode, Inter font, @tabler/icons-react
- **Type:** CR / UX / Frontend
- **What:** Established a unified design token layer used by every subsequent Epic 12 phase.
  1. **Color palette** — Replaced legacy sky-blue (#0284c7) with **emerald green** primary (#22c55e light / #4ade80 dark mode) + **amber/orange** complement (#f59e0b). Teal was an initial choice but discarded after dark-mode review (too close in hue to the dark navy sidebar, low contrast). Emerald sits at hue ~145° vs navy ~215° — clear separation and vibrant on both dark and light backgrounds.
  2. **CSS custom properties** — Full redesign of `:root` block. New tokens: `--color-accent`, `--color-accent-bright`, `--color-accent-hover`, `--color-accent-subtle`, `--color-warm`, `--color-warm-dark`, `--color-warm-subtle`, `--color-sidebar-*`, `--color-surface-alt`, `--color-text-secondary`, plus semantic success/warning/danger subtle tokens.
  3. **Dark mode** — `[data-mantine-color-scheme="dark"]` selector block covers all surfaces, inputs, tables, pickers, toolbars, dropdowns, modals, and the home-page hero. Persisted via `localStorageColorSchemeManager` (key: `hf_color_scheme`).
  4. **Mantine theme** (`frontend/src/theme.ts` — new) — `primaryColor: 'green'`, `primaryShade: {light:7, dark:4}`, Inter font, `defaultRadius: 'md'`, component defaults (Button sm, ActionIcon subtle, Modal centered+blur, Tooltip withArrow+multiline).
  5. **Inter font** — Added to Google Fonts preload in `index.html` alongside DM Sans.
  6. **@tabler/icons-react** — Installed as frontend dependency (natural Mantine companion).
- **Files:** `frontend/src/index.css`, `frontend/src/theme.ts` (new), `frontend/src/main.tsx`, `frontend/index.html`, `frontend/package.json`.

### CR-091 — Shared UI components: HelpIcon, PageHeader, SectionCard
- **Type:** CR / UX / Frontend
- **What:** Three reusable components that enforce design consistency across all pages going forward.
  - **`HelpIcon`** (`frontend/src/components/HelpIcon.tsx`) — `IconInfoCircle` wrapped in Mantine `Tooltip`. Replaces verbose inline `<p class="muted">` help paragraphs with a compact `ⓘ` icon badge. Usage: `<HelpIcon label="..." />` next to any label or heading.
  - **`PageHeader`** (`frontend/src/components/PageHeader.tsx`) — Consistent `h1` + optional subtitle + optional `HelpIcon` + right-aligned action slot. Eliminates per-page ad-hoc heading rows.
  - **`SectionCard`** (`frontend/src/components/SectionCard.tsx`) — Titled `.card` wrapper with optional `HelpIcon` and header action slot. Replaces ad-hoc `<div class="card"> + <h2>` combinations.
- **Files:** `frontend/src/components/HelpIcon.tsx` (new), `frontend/src/components/PageHeader.tsx` (new), `frontend/src/components/SectionCard.tsx` (new), `frontend/src/index.css` (PageHeader + SectionCard CSS added).

### CR-092 — Home page redesign: simplified auth card + hero pills
- **Type:** CR / UX / Frontend
- **What:** Rebuilt the guest landing page auth card and hero section.
  1. **Auth card** — Removed the 3-tab (Sign In / Sign Up / Forgot Password) Mantine Tabs that felt clunky. Reverted to a single clean sign-in form. Below the form: a compact footer row with `"New here? Request access"` and `"Forgot password?"` as lightweight mailto links — no disabled stub forms, no redundant UI. Proper CR stubs for backend sign-up and password-reset flows are tracked in the backlog (CR-095a, CR-095b).
  2. **Hero** — Added a fourth bullet ("Budgets & net worth"). Added a feature-pill row at the bottom of the hero (Cash flow · Budgets · Net worth · Payslips · Imports · Categories) in subtle emerald-green on dark background.
  3. **Dark mode home page** — Explicit `[data-mantine-color-scheme="dark"]` override for `.home-landing` gradient (both sides fully dark). Auth card gets dark-glass treatment (dark navy background, subtle white border) so it stands out clearly against the very dark page background.
- **Files:** `frontend/src/pages/HomePage.tsx`, `frontend/src/index.css`.

### CR-093 — Navigation redesign: dark navy sidebar with icons, slim dark topbar, dark mode toggle
- **Type:** CR / UX / Frontend
- **What:** Full visual overhaul of the app shell navigation.
  1. **Sidebar** — Background changed from white to dark navy (`#1a2540`). All six nav items now use `@tabler/icons-react` icons (Home → `IconHome`, Budget → `IconChartBar`, Net Worth → `IconScale`, Transactions → `IconReceipt`, Payslips → `IconFileText`, Categories → `IconTag`). Active state: emerald-green left border + emerald text + subtle emerald bg. Hover: semi-transparent white overlay. Settings moved from topbar user-menu only → also pinned as a bottom nav item (`IconSettings`). Collapsed state: icons only (letters removed). Collapse button uses `IconChevronLeft/Right`.
  2. **Topbar** — Background changed from white to dark navy (matches sidebar top). **Dark mode toggle** added (`IconSun` / `IconMoon`, hooks into `useMantineColorScheme()`). **Import button** restyled: emerald-green filled compact button with `IconUpload` icon. Mobile hamburger replaced with `IconMenu2`. User menu trigger: semi-transparent white pill on dark background. User dropdown: dark-glass treatment (dark navy, subtle borders).
- **Files:** `frontend/src/layout/AppSidebar.tsx`, `frontend/src/layout/AppTopBar.tsx`, `frontend/src/index.css`.

### Backlog CRs created (from Epic 12 Phase 1–4)
- **CR-095a** — Backend: User sign-up endpoint + household invitation flow (Medium priority, High complexity)
- **CR-095b** — Self-service forgot password via email reset link (Medium priority, Medium complexity) — see full spec below
- **CR-097a** — Payslip: Bulk PDF import (multiple files in one session) (Medium, Medium)
- **CR-097b** — Payslip: YTD analytics dashboard — income trends, tax rate history (Low, Medium)
- **CR-097c** — Payslip: Employer management from payslip list (currently only in Settings) (Low, Low)
- **CR-101** — Budget: Rollover unspent budget to next month (Low, Medium)
- **CR-102** — Dashboard: Spending alerts / push notifications (Low, High)
- **CR-103** — Transactions: Bulk recategorization (Medium, Low)
- **CR-104** — Net worth: Goal tracking — target net worth by date (Low, Medium)
- **CR-105** — Mobile: PWA manifest + install prompt (Low, Low)

---

## 2026-04-17 (email infrastructure decision + CR-095b spec)

### CR-106 — Email infrastructure: SMTP abstraction + provider decision

- **Type:** CR (architecture / backlog)
- **Status:** Decided, not yet implemented. Decision recorded in **`docs/EMAIL_INFRASTRUCTURE.md`**.
- **What:** Established the email infrastructure approach that will underpin multiple features: self-service password reset (CR-095b), household invites (CR-095a), staff provisioning (PRD §20), timesheet notifications, and budget alerts (CR-102).
- **Decision:**
  - Use **nodemailer** with standard SMTP — no vendor SDK in the codebase; provider is swapped by changing env vars.
  - **Recommended providers:** Resend (free, purpose-built transactional email, best deliverability) as production default; Gmail App Password as the easy personal setup path.
  - **6 new env vars** (all optional until first email feature ships): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
  - Email-dependent routes degrade gracefully when SMTP is not configured — admin-reset flow remains available as fallback.
- **Expected volume:** 10–20 emails/month today; up to ~500/month when Phase 3 ships. Both recommended providers' free tiers comfortably cover this.
- **Files:** `docs/EMAIL_INFRASTRUCTURE.md` (new)

---

### CR-095b — Self-service forgot password via email reset link (BACKLOG SPEC)

- **Type:** CR (backlog — Medium priority, Medium complexity)
- **Status:** Not yet implemented. Full spec in **`docs/EMAIL_INFRASTRUCTURE.md`**. Prerequisite: CR-106 (SMTP config).
- **Problem:** Currently "Forgot password?" shows a tip to ask the household admin. This works for members but not for the owner themselves (no one to ask). Also blocks any future self-managed user onboarding.
- **Approach:** Standard email-based time-limited token reset (not OAuth, not SMS). Admin-reset flow (Settings → Members) stays in place and is not replaced.
- **New DB table:** `password_reset_token` — token_hash (SHA-256 of raw token, never stored plain), user_id FK, expires_at (1 hour), used_at. One active token per user; creating new one invalidates prior tokens.
- **New mailer module:** `backend/src/modules/mailer/` — nodemailer transport, `sendMail()` wrapper (best-effort, returns `{ ok }` not throws), password-reset email template.
- **New API routes:**
  - `POST /auth/forgot-password` — unauthenticated; body `{ email }`; always `200` (no user enumeration); rate-limited 3/15min/IP.
  - `POST /auth/reset-password` — unauthenticated; body `{ token, newPassword }`; validates token (exists, unexpired, unused); sets new password, bumps token_version (invalidates all sessions).
- **Frontend changes:**
  - Login page "Forgot password?" shows email input form when SMTP is configured; keeps current admin tip when SMTP is absent.
  - New `/reset-password?token=...` page — new password + confirm fields; success → login with confirmation message.
- **Security:** raw token = 32 bytes base64url (43 chars); only SHA-256 hash in DB; single-use; 1-hour expiry; constant-time compare; no enumeration in responses.
- **Why not OAuth/social login:** OAuth is a parallel auth system (different feature, much higher architectural cost). Email reset is the correct minimal solution for this use case. Social login is a potential Phase 4 consideration only.
- **Files to create/modify when implemented:** `backend/db/migrations/0023_password_reset_token.sql`, `backend/src/modules/mailer/mailer.service.ts`, `mailer.types.ts`, `templates/password-reset.ts`, `backend/src/modules/auth/auth.routes.ts`, `backend/src/modules/auth/auth.service.ts`, `frontend/src/pages/HomePage.tsx`, new `frontend/src/pages/ResetPasswordPage.tsx`, `docs/ENVIRONMENT_VARIABLES.md`, `openapi/openapi.yaml`

---

## 2026-04-12

### DOC-081 — Full doc audit: budget API gap, CLAUDE.md stale module table + schema, import summary CR-080 accuracy
- **Type:** DOC
- **What:** Comprehensive audit of all documentation against shipped CRs (git log back 70+ commits). Gaps found and fixed:
  1. **`openapi/openapi.yaml`** — `budget` tag and all four `/budget/*` paths (`GET /budget/suggest`, `GET /budget/months`, `GET /budget/:month`, `PUT /budget/:month`) were entirely absent. Added with full request/response schemas.
  2. **`docs/API_BUDGET.md`** — File did not exist. Created new API guide covering suggestions, month list, budget GET, budget PUT, parent-level rollup semantics, and schema.
  3. **`docs/API_INDEX.md`** — `API_BUDGET.md` link was missing. Added.
  4. **`CLAUDE.md` module table** — `budget/` module row was absent (14th module). Added with key files and responsibility summary.
  5. **`CLAUDE.md` schema highlights** — `budget_category` and `import_job` tables were not listed; latest migration pointer was stale (`0007` — now `0012`). All corrected.
  6. **`docs/API_IMPORT_SESSIONS.md`** — `nearDuplicatesFlagged` and `notPostedExactDuplicateOrSkipped` descriptions were stale after CR-080. Updated: `canonicalRowCount` now explicitly includes `status='duplicate'` rows; `nearDuplicatesFlagged` now covers both exact and near duplicates; `notPostedExactDuplicateOrSkipped` formula note updated (exact duplicates cancel in the formula after CR-080).
- **Files:** `openapi/openapi.yaml`, `docs/API_BUDGET.md` (new), `docs/API_INDEX.md`, `CLAUDE.md`, `docs/API_IMPORT_SESSIONS.md`.

### FIX-073 — Startup warning when SPA is skipped (`MODE` / missing `frontend/dist`)
- **Type:** FIX / DX
- **What:** When **`NODE_ENV=production`** but **`MODE≠PROD`**, log a **warn** that the SPA is not served (common when **`--env-file .env`** overrides the image and `.env` has **`MODE=TEST`**). When **`MODE=PROD`** but **`frontend/dist`** is missing, log a **warn** linking to **Cannot GET /**. [`docs/PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) Compose **`docker run`** example now includes **`-e MODE=PROD`** and explains **`MODE=TEST`** vs SPA.
- **Files:** `backend/src/server.ts`, `docs/PRODUCTION_SETUP.md`.

### DOC-071 — Docker run: Compose network + `DATABASE_HOST=postgres`
- **Type:** DOC
- **What:** Added [`docs/PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) subsection *App container + Postgres from Compose* — **`127.0.0.1` inside a container**, **`--network <project>_default`**, **`DATABASE_HOST=postgres`**, port **5432** vs host **5433**, **`DATABASE_SSL=0`**, **`host.docker.internal`** alternative. [`CLAUDE.md`](../CLAUDE.md) Local Postgres note: host **`npm run dev`** vs container **`docker run`** DB addressing.
- **Files:** `docs/PRODUCTION_SETUP.md`, `CLAUDE.md`.

### DOC-070 — Production setup: Postgres-only, Docker lifecycle, Koyeb Dockerfile path
- **Type:** DOC
- **What:** Rewrote [`docs/PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md): removed stale SQLite / wrong migration paths; documented **image vs `docker run`**, **`--env-file`** / mounted `.env`, **volume** for `data/`, **amd64 buildx** note; **migrations** (auto on app start, ship in image → rebuild on schema change) vs **bootstrap seeds** (once via `npm run db:seed`, not idempotent on repeat); Koyeb **Dockerfile** vs **buildpack** table retained and corrected. Aligned [`docs/RUNBOOK.md`](RUNBOOK.md) §4–5, §7 Koyeb pointer, §10 DB confirmation, §11 with Postgres + **`PRODUCTION_SETUP`** (removed SQLite **`print-db-path`** guidance there). Updated [`CLAUDE.md`](../CLAUDE.md) repo tree (**`Dockerfile`** / **`.dockerignore`**), **Production Deployment** (Docker vs bare Node, migration/seed contract), and documentation index.
- **Files:** `docs/PRODUCTION_SETUP.md`, `docs/RUNBOOK.md`, `CLAUDE.md`.

### CR-080 — Exact duplicate transactions surfaced in Needs Review instead of silent drop
- **Type:** CR / Backend / Frontend
- **What:** Previously, when a bank export file was re-imported, exact-fingerprint or FITID duplicates were silently skipped — the user had no way to know the file had already been imported. Under CR-080 each exact duplicate is instead inserted into `transaction_canonical` with `status = 'duplicate'` and a linked `resolution_item(type = 'duplicate_ambiguity', kind = 'exact_duplicate')` so it surfaces in the **Needs Review** tab for the user to either:
  - **Resolve (keep)** — the resolution flag is closed, canonical promoted to `'posted'` with a fresh fingerprint (the original dedup fingerprint remains on the first import's row so future re-imports still detect it).
  - **Trash (discard)** — standard trash action sets `status = 'trashed'` and closes all linked flags.
- **Schema (migration 0012):** The global fingerprint unique index `uq_transaction_canonical_fingerprint` is narrowed to a partial index (`WHERE status NOT IN ('duplicate', 'trashed')`). This allows a `'duplicate'` row to share a fingerprint with the existing `'posted'` row while still preventing accidental double-inserts of live transactions.
- **Dedup idempotency guard:** A new early check (before FITID/fingerprint comparison) detects if the raw row already has any canonical at `source_ref = 'raw:' || raw_id`. This keeps repeated `canonicalize` calls idempotent — re-canonicalizing a session still returns `duplicates = N` without inserting new rows.
- **In-session dedup** (same file uploaded twice in one session) still silently continues — only cross-session (DB-persisted) duplicates are surfaced.
- **Review label:** `status = 'duplicate'` rows show **"Exact duplicate"** in the Needs Review "Why" column. The review-type filter dropdown label changed from "Near-duplicate" to "Duplicate" (covers both exact and near).
- **Resolve promote logic:** `POST /resolution/bulk` and `PATCH /resolution/:id` — when resolving a `duplicate_ambiguity` item, an UPDATE now promotes any linked `status = 'duplicate'` canonical to `'posted'` (with fingerprint reassignment) before closing the flag.
- **Files:** `0012_exact_duplicate_review.sql` (new), `canonical-ingest.service.ts`, `resolution.service.ts`, `ledger.service.ts`, `TransactionsPage.tsx`, `backend/tests/app.test.ts`.

### UX-067 — Budget: hierarchical grouped form + transaction UX polish
- **Type:** UX / Frontend / Backend
- **What:**
  1. **Budget grouped by parent** — Suggestions and edit form now group leaf categories under their parent (Food, Home, Shopping…). Each group defaults to a single "lump sum" input for the parent category. A ▼ button expands to individual sub-category rows with their own inputs; ▲ collapses back and sums amounts. Backend: `parentId` added to `BudgetSuggestionRow`. `getBudgetWithActuals` refactored to handle parent-level entries — spent rolls up all child transactions.
  2. **Exclude noise categories** — Transfers, Income, and Investments are excluded from budget suggestions (financial-flow categories, not household spending). Still addable manually via the "Add a category" picker.
  3. **Rule match hint hidden from All tab** — `CategoryClassificationHint` (rule name / confidence) now only renders in the Needs Review tab where it is relevant. On the All tab it cluttered the category column.
  4. **Review type filter inline** — The "Review types" MultiSelect was in its own row above the filter bar. Moved it as the first field in the main filter row, visible only on the Needs Review tab.
- **Design:** Each parent group is a single budgeted unit (lump sum) or a set of leaf units (detailed); the two modes are mutually exclusive per group to avoid double-counting. Actuals: parent entry → sum all children's spend; leaf entry → direct lookup. Unbudgeted spend excludes transactions covered by a parent-level entry.
- **Files:** `budget.service.ts`, `BudgetPage.tsx`, `TransactionsPage.tsx`.

### CR-079 — Monthly budget per category
- **Type:** CR / Backend / Frontend
- **What:** First-class budgeting feature. Per-month, per-category budgets with actual-spend tracking and pre-populated suggestions from last month's activity.
  1. **Migration 0011:** `budget_category` table — `(household_id, category_id, month YYYY-MM, amount)` with a unique constraint on `(household_id, category_id, month)` so each category gets at most one budget entry per month. Per-month rows preserve history: changing April's budget never touches March.
  2. **Budget suggestions (`GET /budget/suggest?month=YYYY-MM`):** Returns active categories (debit spend, no transfer-linked rows, last 3 months) sorted by heaviest last-month spender first. Each row carries `suggestedAmount` (last calendar month actual when > 0, else 3-month average), `basis`, `lastMonthActual`, and `threeMonthAvg`. Pre-populates the setup form so the user has a realistic starting point.
  3. **Budget view (`GET /budget/:month`):** Returns `exists` flag, summary (totalBudgeted / totalSpent / remaining / unbudgetedSpend), and per-category rows with `budgeted`, `spent`, `remaining`, `percentUsed`. Unbudgeted spend (outflows in categories not in the budget) is surfaced separately.
  4. **Save budget (`PUT /budget/:month`):** Full replace — deletes all entries for the month and inserts the provided set in a transaction. Returns the saved budget with actuals.
  5. **History (`GET /budget/months`):** Lists months with budgets (newest first) for future navigation.
  6. **Frontend `BudgetPage`:** Two modes — setup form (when no budget exists) shows editable table pre-populated from suggestions with last-month actual in a reference column; progress view shows progress bars per category (green < 80%, amber 80–99%, red ≥ 100%), three summary KPI cards, remaining/over amounts, and a drill-through link to Transactions filtered by category + month. Month nav (‹ ›) lets the user browse history.
  7. **Sidebar:** "Budget" added between Home and Net worth (abbr B).
  8. **Vite proxy:** `/budget` added.
- **Design decisions:** Only leaf categories with recent debit activity are suggested (no blank form); transfer-linked transactions excluded from actuals (same policy as cash-summary); global categories can be budgeted (FK to `category.id` regardless of `household_id`); "Edit budget" in progress view re-populates from current budget amounts (not last month's actuals, since the user already made those decisions).
- **Files:** `0011_budget_category.sql` (new), `backend/src/modules/budget/budget.service.ts` (new), `budget.routes.ts` (new), `app.ts` (+1 router, +1 API prefix), `frontend/src/pages/BudgetPage.tsx` (new), `App.tsx`, `AppSidebar.tsx`, `vite.config.ts`.
- **Post-ship fixes:**
  - **FIX: debit amount sign** — `transaction_canonical` stores debits as negative amounts (canonical convention). Budget suggestions query used `SUM(tc.amount)` and `HAVING SUM(tc.amount) > 0` which always evaluated to negative/false for debits, returning zero suggestions even with hundreds of categorized transactions. Fixed by negating in SQL: `SUM(-tc.amount)`. Same fix applied to `getBudgetWithActuals` `spent` aggregation. (`budget.service.ts`)
  - **FIX: dynamic anchor** — Suggestions were anchored to "calendar month − 1" which returns nothing when imported bank data lags the current date. Switched to `MAX(txn_date)` within a 24-month cap so the anchor tracks actual data rather than the wall clock. Added `dataAsOf` field to the response so the UI can show "Pre-filled from actual spend in **[Month]**". (`budget.service.ts`, `budget.routes.ts`, `BudgetPage.tsx`)
  - **FIX: LEFT JOIN categories** — After a household restore, transactions can reference deleted custom category IDs (dangling FK). An `INNER JOIN` silently drops those rows; switched to `LEFT JOIN` and filter `category_name IS NOT NULL` to surface only rows with live categories. (`budget.service.ts`)
  - **FIX: setup form race condition + missing add-category** — `SetupForm.entries` initialised via `useState(suggestions ?? [])` ran once at mount before the async suggestion fetch resolved, giving an empty form. Fixed by lifting `entries` state to the parent (`BudgetPage`) and gating render on `setupReady`. Added `AddCategoryRow` picker for categories not already in the list. Nav arrows changed from Unicode `‹›` (invisible in some fonts) to HTML entity `&lt;`/`&gt;`. (`BudgetPage.tsx`)

### DOC-069 — Docs + OpenAPI parity for household ZIP export / restore
- **Type:** DOC
- **What:** Replaced stale OpenAPI **`501`** stub for **`POST /exports/household/import`** with the real multipart restore contract, **`413`**, and **`GET /exports/import/{jobId}`**. Added **`docs/API_EXPORTS.md`** and linked it from **`docs/API_INDEX.md`**. **`docs/USER_GUIDE.md`** (Settings) now mentions backup/restore. **`CLAUDE.md`** export module row + doc table updated. **`docs/archive/MVP_BACKLOG.md`** Story **8.2** marked partial with CR-078 pointer.
- **Files:** `openapi/openapi.yaml`, `docs/API_EXPORTS.md`, `docs/API_INDEX.md`, `docs/USER_GUIDE.md`, `CLAUDE.md`, `docs/archive/MVP_BACKLOG.md`.

### CR-078 v2 — Export ZIP: split-file format (one file per table)
- **Type:** CR / Backend
- **What:** Redesigned the export ZIP to write each table as its own JSON file instead of a single monolithic `household-bundle.json`. Bumped `exportVersion` to 3.
  - **Format:** `manifest.json` + one file per table (e.g. `transactions.json`, `accounts.json`, etc.). Manifest includes a `tables` index: `{ [key]: { file, rows } }`.
  - **Export service:** `queryAllExportTables` returns `TableExport[]`; `runExportJob` iterates and appends each as a named ZIP entry.
  - **Import service:** `readZipEntries` handles v3 (reads per-table files from manifest index) and v1/v2 backward compat (reads `household-bundle.json`, maps legacy bundle keys → new table keys via `legacyMap`). `runImportJob` updated to use `tables: Map<string, Row[]>` from the new `readZipEntries` return type.
- **Why:** A single bundle file is impractical for large datasets — a household with years of transactions could have a single file > 50 MB. Split files allow streaming, partial reads, and easier inspection.
- **Files:** `export-household-bundle.service.ts`, `export-job.service.ts`, `import-household-bundle.service.ts`.

### CR-078 — Full household export + async restore from ZIP backup
- **Type:** CR / Backend / Frontend
- **What:** End-to-end backup and restore feature. Fixes the broken export (404 in dev), completes the bundle, and implements a working async restore.
  1. **Fix 404 (dev):** `/exports` was missing from the Vite dev proxy — added one line to `vite.config.ts`. All dev requests to `/exports/*` now proxy to the backend correctly.
  2. **Export bundle v2:** Added `password_hash` + `token_version` to `app_user` export (required for restore); added three previously-missing tables: `account_balance_snapshot` (net worth history), `payslip_snapshot` (employer payslips), `household_custom_institution` (custom institutions). Fixed incomplete `SELECT` column lists for `financial_account` (was missing `owner_scope`, `owner_person_profile_id`, `default_parser_profile_id`) and `transaction_canonical` (was missing `reference_id` from CR-074). Bumped `exportVersion` to 2.
  3. **Async restore (`POST /exports/household/import`):** Replaced 501 stub with a real async restore pipeline. Accepts a multipart `.zip` upload → queues an `import_job` → `setImmediate` fires the restore → wipes current household data (reverse FK order) → restores all tables in FK-safe order with householdId remapping (bundle's householdId → current instance's householdId). `app_user.token_version` is incremented on restore to invalidate all existing JWTs. `import_file_id` FK references in `account_balance_snapshot` and `payslip_snapshot` are set to NULL (import_file rows are not part of the backup). Returns restore stats (row counts per table) on completion.
  4. **Import job status (`GET /exports/import/:jobId`):** Polling endpoint with `{ status, error, stats }` payload.
  5. **Frontend Settings:** Export section redesigned — shows a persistent download link when ready (replaces unreliable auto-download). New "Restore from backup" section: file picker + "Restore from backup" (danger) button, live status during polling, stats summary on completion, then auto-signs-out after 3 seconds (token invalidated server-side by version bump).
  6. **Migration 0010:** `import_job` table (mirrors `export_job` structure + `stats_json` column).
  7. **FIX:** `canonical-ingest.service.ts` was missing `referenceId` from `PendingCanonInsert` construction (CR-074 oversight). Fixed.
  8. **FIX:** `ofx-parser.ts` `parseOfx2` was using removed cheerio option `lowerCaseTags`. Replaced with cheerio default mode (which also lowercases tags, preserving all OFX 2.x selectors).
- **Restore strategy:** Wipe-then-restore. On a fresh instance: export from source → restore on target. Password hashes are restored verbatim (bcrypt is already one-way). All users are forced to re-login after restore (token_version increment).
- **Backlog:** Add `force_password_reset` flag on app_user for post-restore first-login password change flow.
- **Files:** `vite.config.ts`, `export-household-bundle.service.ts`, `import-household-bundle.service.ts` (new), `exports.routes.ts`, `backend/db/migrations/0010_import_job.sql` (new), `SettingsPage.tsx`, `index.css` (danger button style), `canonical-ingest.service.ts` (bugfix), `ofx-parser.ts` (bugfix).

## 2026-04-11

### CR-076 — New CSV parsers: Discover card + Wealthfront investment
- **Type:** CR / Backend
- **What:** Two new bank adapter parsers to cover statement formats from Discover credit card and Wealthfront investment/savings accounts.
  1. **Discover card CSV (`discover_card_csv`):** Columns `Trans. Date, Post Date, Description, Amount, Category`. Date format MM/DD/YYYY. Sign convention: positive = charge (debit), negative = payment/credit — negated on ingest to match canonical convention. Profile label: "Discover card (CSV)". Inference: `institution.toLowerCase().includes("discover")` + `type === "credit_card"` + `.csv`.
  2. **Wealthfront investment CSV (`wealthfront_investment_csv`):** Columns `Transaction date, Description, Type, Amount`. Date format M/D/YYYY (single-digit month/day supported). Sign convention already canonical (positive = credit/deposit, negative = debit/withdrawal — no negation). Profile label: "Wealthfront savings / investment (CSV)". Inference: `institution.toLowerCase().includes("wealthfront")` + `type ∈ {investment, savings, retirement}` + `.csv`.
- **Why:** Real statement files from live accounts in `data/imports/` had no parsers. Both institution names normalise to "other" in the catalog, so inference uses raw institution string matching rather than the catalog normaliser.
- **Files:** `profiles/discover-card-csv.ts` (new), `profiles/wealthfront-investment-csv.ts` (new), `profiles/profile-ids.ts`, `import-parser.service.ts`, `profileLabels.ts` (frontend), `inferParserProfile.ts` (frontend).
- **Tests added:** `backend/tests/csv-parsers.test.ts` — 11 tests (5 Discover, 6 Wealthfront) covering row count, amount sign, date conversion, description mapping. `frontend/src/import/inferParserProfile.test.ts` — 5 new inference tests.

### CR-077b — Household category rules: second pass from AmEx QFX + Wealthfront CSV
- **Type:** CR / Data
- **What:** Second-pass rules from AmEx QFX and Wealthfront CSV, plus a fix to a first-pass mapping error:
  - **Fix:** `TESLA SUPERCHARGER` reclassified from `Mobility > Fuel` → `Mobility > EV Charging` (that subcategory exists in the DB and is the correct slot)
  - **AmEx QFX patterns:** `AUTOPAY PAYMENT` credit → Transfers > Transfers in (AmEx card self-payment record); `AMEX OFFER CREDIT` credit → Income > Refunds; `DELL` debit → Shopping > Electronic; `NTTA` debit → Mobility > Public Transit (NTTA = North Texas Tollway Authority — description "NTTA AUTOCHARGE" doesn't contain the word "toll" so the builtin `toll` rule doesn't fire); `STATE FARM` debit → Insurance > Auto (no insurance rules existed)
  - **Discover CSV pattern:** `H-E-B` debit → Shopping > Groceries (house rule "HEB" doesn't substring-match "H-E-B" due to dashes); `HULU` debit → Entertainment > Streaming (no streaming rules in builtins or house rules)
  - **Wealthfront CSV patterns:** `(Account ****` credit/debit → Transfers in/out (matches Wealthfront's account-reference format for inter-bank transfers); `GOLDMAN SACHS BANK USA` credit → Transfers > Transfers in (existing rule targets "GOLDMAN SACHS BA DES:P2P" which doesn't match Wealthfront's description format); `Automated Bond Portfolio` debit → Investments > Stocks
- **Skipped (covered):** `[Month] interest` and `Interest payment` → builtin `interest` → Income > Interest already fires; JPMorgan Chase Bank deposits → covered by "(Account ****" rule above
- **Files:** `fixtures/category-import/category-rules-house.csv` (+12 new rules, 1 rule updated).

### CR-077 — Household category rules expansion (live statement patterns)
- **Type:** CR / Data
- **What:** Appended 14 new rules to `fixtures/category-import/category-rules-house.csv` based on patterns from live statements not covered by the 120 global builtin rules. Rules are grouped by category:
  - **Groceries** (ethnic/specialty chains): `INDIA BAZAAR`, `PATEL BROTHERS`, `SWADESHI PLAZA`, `HARELI FRESH MARKET`, `PY *HARELI`, `TOM THUMB` → Shopping > Groceries
  - **EV charging**: `TESLA SUPERCHARGER` → Mobility > Fuel (priority 40, high confidence — specific enough)
  - **Credit card autopay/cashback**: `DIRECTPAY FULL BALANCE` → Transfers > Transfers out (Discover DirectPay); `CASHBACK BONUS REDEMPTION` → Income > Refunds (Discover cashback payout)
  - **FSA/benefits**: `ADVANTAGE FLEX T` → Healthcare > FSA / Benefits
  - **Retail**: `FIVE BELOW` → Shopping > General merchandise
  - **Indian/Asian restaurants**: `GWALIA SWEETS`, `SIMPLY SOUTH`, `ASIAN POT` → Food > Dining out
- **Skipped (already in house rules):** Wealthfront transfers, Goldman Sachs (DES:P2P form), FRONTIER, Fyle, NAVIA BENEFIT, PROTECTIVE LIFE, CITYOFLEWISVILLE, Fundrise rows, PRIMROSE SCHOOL
- **Skipped (covered by global builtins):** kroger, walmart, costco, whole foods, target, starbucks, shell/exxon/chevron, uber/lyft, mcdonald, irs, [month] interest → Income > Interest
- **Files:** `fixtures/category-import/category-rules-house.csv` (+14 rules, first pass).

### CR-075 — Settings: initial balance on account create, retirement account type, institution catalog
- **Type:** CR / Backend / UX
- **What:** Three related improvements to account setup.
  1. **Initial balance on account creation:** Settings → Accounts form now shows two optional fields when adding a new account: "Starting balance" (number) and "Balance as of" (date, defaults to today). On save, if a non-zero balance is provided, `upsertManualBalanceSnapshot` is called to create a manual balance snapshot — the same mechanism used by the Net Worth page. Fields are hidden when editing an existing account (existing balance data is managed via Net Worth). Backend: `accountUpsertSchema` extended with `initialBalance: number | null` and `initialBalanceDate: string | null` (YYYY-MM-DD); `POST /imports/accounts` handler calls `upsertManualBalanceSnapshot` after account creation if non-null.
  2. **Retirement account type:** New `'retirement'` type in `financial_account` (migration `0009`). Covers 401K, IRA, pension accounts. Added to the `accountUpsertSchema` enum and the Settings → Accounts type dropdown as "Retirement (401K / IRA / Pension)".
  3. **Institution catalog expansion:** Added 8 new institutions (alphabetically sorted) to both `frontend/src/import/institutionCatalog.ts` and `backend/src/modules/imports/institution-catalog.ts`: Betterment, Coinbase, E*TRADE, Fundrise, Robinhood, T. Rowe Price, Vanguard, Wealthfront.
- **Why:** Users adding investment, retirement, or crypto accounts had no institutions to pick and no account type for retirement accounts. Starting balance lets new accounts contribute to net worth immediately without needing to import a statement first.
- **Files:** `backend/db/migrations/0009_account_type_retirement.sql` (new), `imports.routes.ts`, `institution-catalog.ts` (backend + frontend), `SettingsPage.tsx`.

### CR-074 — FITID dedup + OFX ledger balance auto-snapshot
- **Type:** CR / Backend / UX
- **What:** Two related improvements to the OFX import pipeline.
  1. **FITID-based deduplication:** Added `reference_id TEXT` column to `transaction_canonical` (migration `0008`) with a partial unique index `(account_id, reference_id) WHERE reference_id IS NOT NULL`. During canonical ingest, if the raw payload carries a `reference_id` (FITID from OFX), a FITID check runs *before* the fingerprint check: if the same `(account_id, reference_id)` already exists in `transaction_canonical`, the row is counted as a duplicate and skipped. A `seenReferenceIdsThisRun` set catches within-batch duplicates. Non-OFX rows (no FITID) are unaffected — the partial index allows unlimited `NULL` reference_ids.
  2. **OFX LEDGERBAL auto-snapshot:** Both OFX 1.x and OFX 2.x parsers now extract `<LEDGERBAL><BALAMT>` and `<LEDGERBAL><DTASOF>`. These fields are stored in `confidence_summary.ofxMeta` at upload time and returned via `GET /imports/sessions/:id/files/:fileId/ofx-suggestion` alongside the account match. During parse (`POST /imports/sessions/:id/parse`), if the OFX file has a non-null ledger balance with a valid ISO date, `upsertImportBalanceSnapshotFromStatement` is called to persist a balance snapshot (source = `ofx_transactions`) — same pathway as BoA CSV/e-statement balance capture. Frontend shows balance info in the OFX account hint: "Balance as of YYYY-MM-DD: $X,XXX.XX (from OFX ledger balance — auto-saved to net worth)".
- **Why:** Without FITID dedup, re-importing an OFX file after minor description edits could insert duplicates (fingerprint = SHA256 of normalised description). FITID is the authoritative dedup key for OFX files. LEDGERBAL is a free balance anchor in every Chase QFX tested — parsing it avoids a manual net-worth entry after each statement import.
- **Files:** `backend/db/migrations/0008_canonical_reference_id.sql` (new), `canonical-ingest.service.ts`, `ofx-parser.ts`, `ofx-account-match.service.ts`, `import-parser.service.ts`, `imports.routes.ts`, `boa-checking-savings-csv.ts` (source union extended), `ImportWorkspacePage.tsx`.
- **Tests added:** `backend/tests/ofx-parser.test.ts` — 6 new tests for OFX 1.x and 2.x LEDGERBAL parsing (balance value, date conversion, null when absent).

### UX-073 — Replace all window.confirm/window.prompt with in-app dialogs
- **Type:** UX / FIX
- **What:** `window.confirm` in `PayslipsPage` and `PayslipDetailPage` (payslip delete) replaced with `ConfirmDialog` (already used throughout the rest of the app). `window.prompt` in `ImportWorkspacePage` for "Add institution…" replaced with an inline input row: click "Add institution…" → text input + Add/Cancel buttons appear; Enter submits, Escape cancels; new name saved via `POST /imports/institutions/custom`, catalog reloaded, value auto-selected. Inline create-account form layout also fixed from `flex+alignItems:flex-end` (staggered when Institution column was taller) to CSS grid so all labels/inputs align on the same baseline.
- **Why:** `window.confirm`/`window.prompt` show browser-native "localhost:3000 says" dialogs — visually inconsistent with the rest of the app. `ConfirmDialog` was already the app standard for confirmations; it just wasn't wired to payslip delete or institution add.
- **Files:** `PayslipsPage.tsx`, `PayslipDetailPage.tsx`, `ImportWorkspacePage.tsx`.

### FIX-072 — OFX import: Run Import disabled after account selection + institution text box
- **Type:** FIX / UX
- **What:** Two bugs in the CR-071 OFX import flow.
  1. **Run Import stays disabled after account selection:** `inferParserProfile` did not handle `.ofx` / `.qfx` / `.qbo` extensions, so `onAccountChange` inferred `null`, set `profileId: ""`, and skipped `persistBinding`. The server-side `financial_account_id` was never saved, so `allFilesBound` remained false and "Run import" stayed disabled. Fix: added OFX extension check at the top of `inferParserProfile` (before institution checks) returning `"ofx_transactions"`. Now `onAccountChange` calls `persistBinding` correctly for OFX files — same path as CSV/PDF.
  2. **Institution field was a free-text input:** The inline create-account form inside the OFX file table row used a plain `<input>` for institution. This let users type anything, producing inconsistent names ("Chase", "chase", "CHASE"). Fix: replaced with `HierarchicalSearchPicker` loaded lazily from `GET /imports/institutions` (same catalog as Settings → Accounts). "Add institution…" button calls `POST /imports/institutions/custom` and refreshes the picker. Catalog loads once when the form first opens (`ofxCreateAccountFileId` state transitions from null).
- **Why:** "Run Import" being disabled after following the new-account creation flow was a blocking regression. Free-text institution entry was creating naming inconsistencies across the household — same issue that motivated the picker in Settings.
- **Tests added:** `frontend/src/import/inferParserProfile.test.ts` — 4 new cases for `.ofx` / `.qfx` / `.qbo` extension inference. `backend/tests/ofx-parser.test.ts` — new test file covering OFX 1.x credit card (Chase QFX style), OFX 1.x checking, and OFX 2.x XML: transaction count, FITID → `reference_id`, date conversion, signed amounts, description join, account type detection, institution suppression for short/numeric ORG codes.
- **Files:** `frontend/src/import/inferParserProfile.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/import/inferParserProfile.test.ts`, `backend/tests/ofx-parser.test.ts`.

### DOC-068 — Hosting / home lab / $0 opex context
- **Type:** DOC
- **What:** New [`HOSTING_OPTIONS_AND_HOME_LAB.md`](HOSTING_OPTIONS_AND_HOME_LAB.md) — maintainer constraints (opex/capex), Pi vs cloud free tiers, Koyeb/OCI/AWS pointers, backup pattern (pg_dump, encryption, local + off-site, retention), hardware ≤ ~$100 notes; cross-links from [`CLAUDE.md`](../CLAUDE.md) and [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md).
- **Why:** Preserve hosting and backup discussion so future deploy decisions stay aligned.

### CR-071 — OFX/QFX/QBO parser + streamlined import confirm flow + payslip delete
- **Type:** CR / Backend / UX
- **What:** Three related changes.
  1. **OFX/QFX/QBO parser (`ofx_transactions` profile):** New parser `backend/src/modules/imports/profiles/ofx-parser.ts` handles both OFX 1.x (SGML-like unclosed leaf tags) and OFX 2.x (proper XML, via cheerio). Parses: FITID → `reference_id` (stronger dedup than fingerprint), DTPOSTED → ISO date, TRNAMT → amount (signed decimal), NAME + MEMO → description. Also extracts account header: ACCTID, ACCTTYPE, BANKID, FI/ORG. Profile ID `ofx_transactions` added to `PARSER_PROFILE_IDS`. Handles `.ofx`, `.qfx`, `.qbo` extensions.
  2. **Streamlined OFX import flow:** When an OFX/QFX/QBO file is uploaded, `persistSessionFiles` auto-detects the extension, sets `parser_profile_id = 'ofx_transactions'`, reads the account header, and stores it in `confidence_summary`. New service `ofx-account-match.service.ts` matches ACCTID last-4 against `financial_account.account_mask`. New endpoints: `GET /imports/sessions/:id/files/:fileId/ofx-suggestion` (returns matched account or null + account info), `POST /imports/sessions/:id/ofx-confirm` (bind + parse + canonicalize in one call). Frontend shows a dedicated **OFX / QFX / QBO — confirm account & import** card for any unbound OFX files: account picker pre-populated with suggestion, belongs-to picker, inline **Create account** form when no match, **Confirm & import** button. Non-OFX files keep the existing bind → Run import flow.
  3. **Payslip delete:** `DELETE /payslips/:id` backend endpoint. `deletePayslipSnapshotForHousehold` in `payslip.service.ts`. Delete button in `PayslipsPage` (list row) and `PayslipDetailPage` (header, navigates back on success). Uses `window.confirm` for confirmation.
- **Why:** OFX is a widely-supported open standard (QFX = OFX + Quicken header, QBO = OFX + QuickBooks header — one parser handles all three). FITID from OFX gives stronger deduplication than fingerprint alone. Streamlined import flow reduces required steps from Upload → Bind → Parse → Canonicalize → Undo → Finalize to Upload → Confirm → (Undo →) Finalize. Payslip delete was missing — no way to remove erroneous imports.
- **Future backlog:** CSV auto-detection from column headers (analogous to OFX auto-detection from extension) — not implemented in this CR; CSV stays with manual profile selection.
- **Files:** `ofx-parser.ts` (new), `ofx-account-match.service.ts` (new), `profile-ids.ts`, `import-parser.service.ts`, `import-session.service.ts`, `imports.routes.ts`, `payslip.service.ts`, `payslip.routes.ts`, `ImportWorkspacePage.tsx`, `PayslipsPage.tsx`, `PayslipDetailPage.tsx`.

## 2026-04-10

### CR-070 — Trash (soft delete) + remove transfer_ambiguity from Needs Review
- **Type:** CR / Schema / UX
- **What:** Three related changes shipped together.
  1. **Trash mechanism:** `transaction_canonical.status` gains a new valid value `'trashed'` (migration `0007`). Trashed rows are excluded from all reports and ledger views by a default `status != 'trashed'` filter added to `ledgerFilterClause`. New API: `PATCH /transactions/:id { status: "trashed" }` (soft-delete), `PATCH ... { status: "posted" }` (restore), `DELETE /transactions/:id` (hard delete, only when trashed), `POST /bulk-trash`, `POST /bulk-restore`, `POST /bulk-delete`. Frontend: new **Trash** tab (URL: `trashOnly=true`) with per-row Restore + Delete permanently buttons, select-all, and bulk bar.
  2. **Transfer ambiguity removed from Needs Review:** `transfer_ambiguity` type removed from `NEEDS_REVIEW_PREDICATE`, `OPEN_REVIEW_ITEMS_SUBQUERY`, `buildReviewReasons`, and the frontend resolution type filter. Transfer flags no longer surface to the user in Needs Review — they were generating false noise since both sides of an internal transfer net to zero in whole-household reporting.
  3. **Cash flow report fix:** `transferReportingExclusionClause` no longer hides rows with *suspected* (open `transfer_ambiguity`) flags — only confirmed transfer pairs (`transfer_group_id IS NOT NULL`) are excluded. Hiding suspected rows was silently dropping real expenses from reports.
- **Why:** (1) Users needed a way to remove clearly wrong/duplicate transactions without losing history. (2) Transfer ambiguity flags were confusing — they added items to Needs Review that the user couldn't meaningfully act on. (3) The suspected-transfer reporting exclusion was hiding real expenses.
- **Schema:** `backend/db/migrations/0007_transaction_canonical_trashed_status.sql` — alters CHECK constraint to include `'trashed'`.
- **Files:** `ledger.service.ts` (trash functions + filter), `ledger.routes.ts` (new routes), `cash-summary.service.ts` (fix exclusion clause), `TransactionsPage.tsx` (Trash tab + row actions), migration `0007`.

### CR-069 — Simplify Needs Review: eliminate unknown_category resolution items
- **Type:** CR / UX / Backend
- **What:** Removed the dual-tracking problem where a transaction could have a category assigned yet still appear in Needs Review because a lingering `unknown_category` resolution_item existed. **Single source of truth: `category_id IS NULL` is sufficient.** Changes: (1) `canonical-ingest.service.ts` no longer creates `unknown_category` resolution_items. (2) `ledger.service.ts` `NEEDS_REVIEW_PREDICATE` drops `unknown_category` from the type filter; `buildReviewReasons()` updated accordingly. (3) `createManualCanonicalTransaction` no longer inserts `unknown_category` items. (4) `category-recategorize.service.ts` closes any lingering old `unknown_category` items when a rule match reassigns a category. (5) `ledger.routes.ts` removes `unknown_category` from `LEDGER_RESOLUTION_TYPES` and adds `POST /bulk-category` route. (6) `ledger.service.ts` adds `bulkUpdateCategory()`. (7) `TransactionsPage.tsx`: "Unknown category only" quick filter link removed; bulk bar simplified to a category picker + **Apply category** + conditional **Resolve flags (N)** button (for transfer/duplicate flags only); `openFlagCountInSelection` memo replaces two separate memos.
- **Why:** Adding a rule and running Re-apply would fix `category_id` but the `unknown_category` resolution_item remained open, so the transaction stayed in Needs Review — confusing and incorrect. The new model: Needs Review = uncategorized (`category_id IS NULL`) **or** open transfer/duplicate flag. Once a category is assigned via any path (manual, bulk, rule re-apply), the row self-heals out of Needs Review.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/src/modules/ledger/ledger.service.ts`, `backend/src/modules/ledger/ledger.routes.ts`, `backend/src/modules/category/category-recategorize.service.ts`, `frontend/src/pages/TransactionsPage.tsx`.

### CR-068 — Payslip detail: bank deposit match section
- **Type:** CR
- **What:** `GET /payslips/:id` now appends a `matchedDeposits` array to the response. The backend (`payslip.service.ts: findMatchedDeposits`) searches `transaction_canonical` for `credit` rows within ±3 days of `pay_date` whose `amount` is within 1% (min $0.50) of `net_pay_current`. If the payslip is person-scoped and that person has a `salary_deposit_financial_account_id` configured on their `person_profile`, the search is restricted to that account; otherwise all household accounts are searched. Up to 5 candidates are returned, closest amount match first. `PayslipDetailPage.tsx` shows a new **Bank deposit** card (between Period and Amounts) with a table of matched transactions and a **View** link that opens `/transactions` pre-filtered to the account and ±3-day window; if no match is found a muted "No matching deposit found" note is shown. The card is suppressed entirely when `pay_date` or `net_pay_current` is null.
- **Why:** Close the loop between employer-reported net pay and the actual deposit in the bank ledger — the most requested payslip feature after manual entry shipped. No schema changes required; uses existing `salary_deposit_financial_account_id` on `person_profile`.
- **Files:** `backend/src/modules/payslip/payslip.service.ts` (new `MatchedDeposit` type + `findMatchedDeposits`), `backend/src/modules/payslip/payslip.routes.ts` (`GET /:id` enrichment), `frontend/src/payslip/types.ts` (`MatchedDeposit` type + `matchedDeposits` field), `frontend/src/pages/PayslipDetailPage.tsx` (Bank deposit card).

### FIX-067 — Net worth: remove useBlocker under BrowserRouter (blank page)
- **Type:** FIX / UX
- **What:** **`useBlocker`** only works with a **data router** (`createBrowserRouter` + `RouterProvider`). This app uses **`BrowserRouter`**, so the hook threw on `/net-worth` and the page rendered blank. Removed the in-app navigation blocker dialog; **`beforeunload`** remains for tab close/refresh when a row edit is dirty; added a short on-page hint when edits are unsaved.
- **Why:** Restore Net worth; SPA navigations are not blocked without migrating the shell to a data router.
- **Files:** [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx).

### UX-066 — Net worth balance edit UX + payslip list trim + backlog alignment
- **Type:** UX / DOC
- **What:** **Net worth** page wrapper **`net-worth-page`**; balance sheet **Snapshot date** copy; bulk re-date in **details**; **pencil** icon for row edit; **`useBlocker`** + **`beforeunload`** when unsaved balance edits; **Saved stubs** table columns reduced (period start/end, gross, net, View). **Manual payslip:** Employer + Belongs-to on one row; amounts table header **Description**. **Import / Transactions:** **`import-workspace-page`** / **`transactions-page__control-band`** spacing hooks. **`BALANCE_SHEET_BACKLOG.md`** updated for **CR-064**/**UX-065**; **`PAYSLIP_V1.md`** clarifies **PATCH** vs read-only detail UI.
- **Why:** Less redundant navigation and clearer snapshot semantics; safer navigation away from dirty edits; accurate backlog story.
- **Files:** [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`PayslipsPage.tsx`](frontend/src/pages/PayslipsPage.tsx), [`PayslipManualPage.tsx`](frontend/src/pages/PayslipManualPage.tsx), [`ImportWorkspacePage.tsx`](frontend/src/pages/ImportWorkspacePage.tsx), [`TransactionsPage.tsx`](frontend/src/pages/TransactionsPage.tsx), [`index.css`](frontend/src/index.css), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md), [`PAYSLIP_V1.md`](docs/PAYSLIP_V1.md).

### UX-065 — Net worth + manual payslip layout polish
- **Type:** UX / DOC
- **What:** **Net worth** — trend controls grouped; **period summary** as a **ledger-table** with **Ledger** links (first/last sample = chart endpoints); **Reload** removed from the toolbar and replaced by **Retry load** when a fetch fails. **Manual payslip** — pay period and **Current / YTD** amounts in aligned **ledger-table** rows instead of a wide grid.
- **Why:** Easier scanning on large screens; clearer relationship between chart samples and ledger drill-downs; less redundant chrome.
- **Files:** [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`PayslipManualPage.tsx`](frontend/src/pages/PayslipManualPage.tsx), [`index.css`](frontend/src/index.css), [`USER_GUIDE.md`](docs/USER_GUIDE.md).

### CR-064 — Net worth v2 UI + balance sheet API filters + manual payslip fields
- **Type:** CR / API / UX / DOC / TEST
- **What:** **`GET /reports/balance-sheet`** and **`/history`** accept optional **`ownerScope`** / **`ownerPersonProfileId`** (belongs-to). **`/history`** accepts **`accountIds`** (comma-separated, max 8) and returns optional **`accounts`** slices per point. **Net worth** page: period presets, merged start/end summary, single signed balance table, inline edit + bulk as-of, belongs-to filter, chart account overlays, transaction drill-downs (including **`fileId`** deep link). **Manual payslip** form: Current/YTD grid, pre/post tax and employee taxes YTD, template under Advanced when no employers. **Transactions** honors **`fileId`** query param when loading the ledger.
- **Why:** One place to understand net worth, optional member-scoped views, and full manual payslip parity with API fields.
- **Files:** [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`reports.routes.ts`](backend/src/modules/reports/reports.routes.ts), [`app.test.ts`](backend/tests/app.test.ts), [`payslip-upload.test.ts`](backend/tests/payslip-upload.test.ts), [`ibm-payslip-pdf.ts`](backend/src/modules/payslip/profiles/ibm-payslip-pdf.ts), [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`TransactionsPage.tsx`](frontend/src/pages/TransactionsPage.tsx), [`PayslipManualPage.tsx`](frontend/src/pages/PayslipManualPage.tsx), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`openapi.yaml`](openapi/openapi.yaml), [`USER_GUIDE.md`](docs/USER_GUIDE.md).

## 2026-04-09

### DOC-063 — Operator docs: net worth in user guide + API index + CLAUDE reports/schema
- **Type:** DOC
- **What:** [`USER_GUIDE.md`](docs/USER_GUIDE.md) **Net worth** section; [`API_INDEX.md`](docs/API_INDEX.md) links [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md); [`CLAUDE.md`](CLAUDE.md) **`reports/`** module row and **`account_balance_snapshot`** in schema highlights.
- **Why:** Keep day-to-day and contributor docs aligned with shipped net worth / history / import snapshots.

### CR-062 — Net worth trend chart + GET /reports/balance-sheet/history
- **Type:** CR / API / UX / DOC
- **What:** **`GET /reports/balance-sheet/history`** with **`from`**, **`to`**, **`interval`** (`month` \| `week` \| `day`); samples up to **120** `asOf` dates using existing **`getBalanceSheet`** resolution. **Net worth** page **Trend** card (Recharts: assets, liabilities, net).
- **Why:** Ship charts/history from balance sheet backlog without new balance semantics.
- **Files:** [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`reports.routes.ts`](backend/src/modules/reports/reports.routes.ts), [`app.test.ts`](backend/tests/app.test.ts), [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md), [`openapi.yaml`](openapi/openapi.yaml).

### CR-061 — Import balance snapshots: persist on parse + prefer in balance sheet
- **Type:** CR / DB / API / DOC
- **What:** Migration **`0006`** partial unique index on import snapshots; bank parse upserts **`source = import`** `account_balance_snapshot` rows when **`statementBalances.ending`** and **`asOfEnd`** (`YYYY-MM-DD`) are present; **`GET /reports/balance-sheet`** resolves **manual → persisted import → confidence_summary hint**.
- **Why:** Normalized balances for net worth history and stable re-parse behavior.
- **Files:** [`0006_account_balance_import_unique.sql`](backend/db/migrations/0006_account_balance_import_unique.sql), [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`import-parser.service.ts`](backend/src/modules/imports/import-parser.service.ts), [`app.test.ts`](backend/tests/app.test.ts), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md).

### UX-060 — Payslips list: Belongs-to label (replaces “View scope”)
- **Type:** UX / copy
- **What:** Payslip list filter uses the **Belongs-to** label and hint text aligned with **Transactions**; placeholder **All household activity**. No API or query changes.
- **Why:** “View scope” did not match household vs member semantics; consistent wording across ledger and payslip screens.
- **Files:** [`PayslipsPage.tsx`](frontend/src/pages/PayslipsPage.tsx), [`USER_GUIDE.md`](docs/USER_GUIDE.md).

### FIX-059 — Profile: persist per-employer salary deposit account + restore inference (replaces reverted WIP)
- **Type:** FIX / API / UX
- **What:** **`employers_json`** stores optional **`salaryDepositFinancialAccountId`** per employer; **`PATCH /household/profile`** validates accounts and syncs legacy **`person_profile.salary_deposit_financial_account_id`** from the first employer when the top-level field is omitted. **Settings → Profile** binds salary account **per employer row** (was incorrectly sharing one `select` across rows). **`inferParserProfile`** treats a checking account as the payslip target when it matches **any** employer’s salary account, not only the legacy column.
- **Why:** Uncommitted local fixes were dropped by a mistaken `git checkout --` during another commit; behavior matches existing API test intent (`per-employer salary deposit accounts`).
- **Files:** [`household.types.ts`](backend/src/modules/household/household.types.ts), [`household.service.ts`](backend/src/modules/household/household.service.ts), [`SettingsPage.tsx`](frontend/src/pages/SettingsPage.tsx), [`inferParserProfile.ts`](frontend/src/import/inferParserProfile.ts), [`ImportWorkspacePage.tsx`](frontend/src/pages/ImportWorkspacePage.tsx), [`inferParserProfile.test.ts`](frontend/src/import/inferParserProfile.test.ts).

### FIX-058 — Payslip mapper: infer OTHER DEDUCTION post-tax rows from line name when raw_section is blank
- **Type:** FIX / test / prompt
- **What:** **`sumOtherDeductionsMarkedAsPostTax`** also matches **`name` / `description`** with **`other deduction`**. Regression test + LLM prompt line clarifying **`line_items.other_deductions`** naming when **`raw_section`** is missing.
- **Why:** Epic 4 — some extractions omit **`raw_section`** on miscellaneous rows; post-tax totals were dropped.
- **Files:** [`payslip-canonical-map.ts`](backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts), [`extract-payslip-llm.ts`](backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts), [`payslip-canonical-map.test.ts`](backend/tests/payslip-canonical-map.test.ts).

### CR-057 — Net worth v1: account_balance_snapshot + balance-sheet APIs + /net-worth UI
- **Type:** CR / DB / API / UX / DOC
- **What:** Migration **`account_balance_snapshot`**; **`GET /reports/balance-sheet`**, **`POST/PATCH /reports/balance-sheet/manual`**; **Net worth** page and sidebar nav. Manual balances override import **`statementBalances`** hints per account.
- **Why:** Epic 2 minimal balance sheet — assets vs liabilities with manual entry; charts/history deferred in [`BALANCE_SHEET_BACKLOG.md`](BALANCE_SHEET_BACKLOG.md).
- **Files:** [`0005_account_balance_snapshot.sql`](backend/db/migrations/0005_account_balance_snapshot.sql), [`balance-sheet.service.ts`](backend/src/modules/reports/balance-sheet.service.ts), [`reports.routes.ts`](backend/src/modules/reports/reports.routes.ts), [`app.test.ts`](backend/tests/app.test.ts), [`NetWorthPage.tsx`](frontend/src/pages/NetWorthPage.tsx), [`App.tsx`](frontend/src/App.tsx), [`AppSidebar.tsx`](frontend/src/layout/AppSidebar.tsx), [`API_BALANCE_SHEET.md`](docs/API_BALANCE_SHEET.md), [`BALANCE_SHEET_BACKLOG.md`](docs/BALANCE_SHEET_BACKLOG.md), [`openapi.yaml`](openapi/openapi.yaml).

### CR-056 — Manual payslip: POST /payslips/manual + /payslips/new form
- **Type:** CR / API / UX / DOC
- **What:** **`POST /payslips/manual`** inserts **`payslip_snapshot`** with **`Manual entry`** file name and a **synthetic SHA-256 checksum** (`manual:` + UUID). **`/payslips/new`** form; list links **Add manually**. **`PATCH /payslips/:id`** remains the edit path.
- **Why:** Epic 1 / PAYSLIP_V1 §7 — income history without a parseable PDF.
- **Files:** [`payslip.service.ts`](backend/src/modules/payslip/payslip.service.ts), [`payslip.routes.ts`](backend/src/modules/payslip/payslip.routes.ts), [`payslip-upload.test.ts`](backend/tests/payslip-upload.test.ts), [`PayslipManualPage.tsx`](frontend/src/pages/PayslipManualPage.tsx), [`PayslipsPage.tsx`](frontend/src/pages/PayslipsPage.tsx), [`App.tsx`](frontend/src/App.tsx), [`PAYSLIP_V1.md`](docs/PAYSLIP_V1.md), [`openapi.yaml`](openapi/openapi.yaml).

### CR-055 — Cash summary: configurable custom range cap + maxCustomRangeDays in API; Dashboard alignment
- **Type:** CR / API / UX / DOC
- **What:** **`CASH_SUMMARY_MAX_CUSTOM_RANGE_DAYS`** env (default **1096**). **`GET /reports/cash-summary`** returns **`maxCustomRangeDays`** and enforces the limit. **Home** dashboard uses it for client-side validation and hint text.
- **Why:** Epic 7 follow-up — prior **366**-day cap was tight for multi-year analysis.
- **Files:** [`env.ts`](backend/src/config/env.ts), [`cash-summary.service.ts`](backend/src/modules/reports/cash-summary.service.ts), [`DashboardPage.tsx`](frontend/src/pages/DashboardPage.tsx), [`docs/API_CASH_SUMMARY.md`](docs/API_CASH_SUMMARY.md), [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md), [`.env.example`](.env.example), [`app.test.ts`](backend/tests/app.test.ts).

### CR-054 — Ledger list: expose classificationMeta; Transactions UI classification hint
- **Type:** API / UX / DOC
- **What:** **`GET /transactions`** responses include **`classificationMeta`** (rules audit: source, ruleId, confidence, reason). **Transactions** category column shows a short hint + link to **Category rules** for household rules.
- **Why:** Epic 5.1 explainability — data was already stored on **`transaction_canonical`**; list API omitted it.
- **Files:** [`ledger.service.ts`](backend/src/modules/ledger/ledger.service.ts), [`TransactionsPage.tsx`](frontend/src/pages/TransactionsPage.tsx), [`docs/API_LEDGER.md`](docs/API_LEDGER.md), [`backend/tests/app.test.ts`](backend/tests/app.test.ts).

### DOC-053 — Align async-canonicalize design note with current import behavior; deprioritize transfer-matcher follow-up in checkpoint
- **Type:** DOC
- **What:** **`docs/CANONICALIZE_ASYNC.md`** — added **Supersession / current reality**: payslip LLM uses **`reconcile-payslip-async`**; **`POST .../canonicalize`** remains synchronous; canonicalize does **not** call OpenAI (rules/fingerprinting only). Problem statement updated to large CSV/CPU/proxy timeouts. **`docs/archive/CHECKPOINT.md`** — **Good next picks**, **Sensible next steps**, and **Transfer matcher** table row now describe Epic 5.2 as **optional / low priority** if mispairing appears; classification scales via **household rules**.
- **Why:** Docs still implied “canonicalize + OpenAI” and mandatory post-MVP transfer tuning; product reality differs after payslip async reconcile and rules-first classification.

### CR-052 — Payslips: IBM OpenAI vision pipeline (parity with Deloitte) + Deloitte canonical/prompt hardening
- **Type:** CR / DOC / API
- **What:** **`ibm_pay_contributions_pdf`** now uses the **same** OpenAI vision + JSON-schema + Zod path as Deloitte (`extractPayslipFromPdf` → `mapCanonicalExtractToPersist` → **`payslip_snapshot`** with **canonical + hybrid** columns). Extraction accepts **`pdfPath`** (Import uses **`stored_path`** to avoid an extra temp copy) or **`pdfBuffer`** (upload). Missing **`OPENAI_API_KEY`** returns structured **`422`** on upload and marks import files failed (aligned with Deloitte). Legacy IBM regex parser (**`parseIbmPayslipPdf`**) remains in repo for tests/sniffing but is **not** the primary parse entry point. **Deloitte:** system prompt tightened for two-column Current/YTD grouping and **`OTHER DEDUCTION(S)`** semantics; canonical mapper derives post-tax from **`line_items.post_tax_deductions`** with a **narrow fallback** that sums **`line_items.other_deductions`** rows whose **`raw_section`** matches **`OTHER DEDUCTION(S)`** when post-tax current/YTD is still null (handles occasional LLM mis-bucketing). Follow-on prompt tweaks for mixed row shapes (YTD-only vs Current+YTD) in the same section.
- **Why:** IBM image-based or irregular PDF text made regex extraction unreliable; one extraction pipeline improves consistency and stored **`canonical_extract_json`**. Deloitte stubs vary by row layout; mapper + prompt reduce missing YTD without reintroducing broad `other_deductions` → post-tax coalescing.
- **Files:** `backend/src/modules/payslip/llm-extract/extract-payslip-llm.ts`, `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts`, `backend/src/modules/payslip/payslip-parse.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/tests/payslip-canonical-map.test.ts`, `backend/tests/payslip-upload.test.ts`, `docs/PAYSLIP_V1.md`, `docs/API_IMPORT_SESSIONS.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/archive/CHECKPOINT.md`, `docs/archive/MVP_BACKLOG.md`.

## 2026-04-08

### CR-051 — Deloitte payslips: replace Unstructured Jobs with async OpenAI LLM extract + hybrid snapshot storage
- **Type:** CR / DB / API / UX / DOC
- **What:** Import `deloitte_payslip_pdf` now **queues** `openai_llm_payslip` on `import_file` (requires **`OPENAI_API_KEY`**). Background reconcile via **`POST /imports/sessions/:sessionId/reconcile-payslip-async`** runs vision + JSON-schema + Zod, maps to `payslip_snapshot`, and stores **canonical JSON + hybrid columns**. Added **`PATCH /payslip/:id`** for manual summary edits. UI auto-polls + “Check now” target that endpoint; messages updated. Legacy Unstructured Jobs client modules, Deloitte table parser, and the temporary **`reconcile-unstructured`** alias were removed after cutover.
- **Why:** Single high-fidelity extractor for Deloitte without Unstructured cost/latency; preserve IBM local parser; enable richer stored payload for future payslip UI.
- **Files:** `backend/db/migrations/0004_payslip_llm_async_hybrid.sql`, `backend/src/config/env.ts`, `backend/src/modules/imports/payslip-async-import-reconcile.service.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/payslip/payslip.service.ts`, `backend/src/modules/payslip/payslip.routes.ts`, `backend/src/modules/payslip/llm-extract/payslip-canonical-map.ts`, `backend/tests/payslip-canonical-map.test.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `docs/API_IMPORT_SESSIONS.md`, `docs/PAYSLIP_V1.md`, `.env.example`.

## 2026-04-07

### CR-050 — Deloitte payslips: Unstructured Jobs async pipeline (HTML-first parser), remove local Deloitte parser
- **Type:** CR / FIX / DOC / DB / UX
- **What:** Deloitte profile switched to **Import-only async** processing through Unstructured Jobs (`POST /jobs`, poll status, download JSON). Added `import_file` job-tracking columns (`unstructured_job_id`, `unstructured_input_file_id`, `unstructured_last_poll_at`) and new reconcile endpoint **`POST /imports/sessions/:sessionId/reconcile-unstructured`** (throttled; `force=true` bypass). Added Deloitte parser that reads Unstructured **`Table.metadata.text_as_html`** first (fallback to `Table.text`) and extracts stable totals (`TOTAL GROSS`, `NET PAY`) plus date hints. Removed local `deloitte-payslip-pdf.ts` (`pdf-parse` + IBM-merge heuristic path) to prevent dead code and false positives. Import UI now reports `unstructuredPending`, auto-polls ~2 minutes for pending Deloitte jobs, and adds “Check Unstructured now”.
- **Why:** Real Deloitte PDFs had unusable local text extraction and produced incorrect values with local heuristics; Unstructured output is reliable for these stubs while preserving constrained free-tier usage through fixture-based tests and throttled polling.
- **Files:** `backend/src/modules/imports/unstructured-jobs.service.ts`, `backend/src/modules/imports/unstructured-import-reconcile.service.ts`, `backend/src/modules/imports/import-parser.service.ts`, `backend/src/modules/imports/imports.routes.ts`, `backend/src/modules/payslip/profiles/deloitte-unstructured-parse.ts`, deleted `backend/src/modules/payslip/profiles/deloitte-payslip-pdf.ts`, `backend/db/migrations/0003_import_file_unstructured.sql` (+ sqlite mirror), `frontend/src/pages/ImportWorkspacePage.tsx`, `docs/PAYSLIP_V1.md`, `docs/API_IMPORT_SESSIONS.md`, `docs/ENVIRONMENT_VARIABLES.md`.

---

## 2026-04-04

### DOC-049 — Production hygiene: README, user guide, docs archive, DB baseline, bootstrap seed
- **Type:** DOC / DB / CHORE
- **What:** Rewrote root **`README.md`** and added **`docs/USER_GUIDE.md`**. Moved planning/handoff/history docs into **`docs/archive/`** with **`docs/archive/README.md`**. Tracked sample CSVs under **`fixtures/category-import/`**. Replaced incremental migrations with **`backend/db/migrations/0001_baseline.sql`**; former **`0001`–`0032`** files live under **`backend/db/migrations_archive/`** (not run). Merged **`0001_seed_defaults`** + **`0002_seed_category_rule_global`** (+ former **`0003`** hook as comments) into **`backend/db/seeds/0001_bootstrap.sql`**. Updated **`gen-0026-migration.mjs`** to refresh only the global-rules section inside bootstrap. **`docs/RUNBOOK.md`**, **`PRODUCTION_SETUP`**, **`ENVIRONMENT_VARIABLES`**, **`backend/db/README`**, **`category-ids.ts`** comments, and dev seed README adjusted. Added **`docs/DEAD_CODE.md`** (keep optional AI; **`ts-prune`** pointer).
- **Why:** Leaner repo for first production deploy; single schema file for greenfield SQLite; one seed file for operator clarity; archived internal notebooks out of the primary doc set.
- **Files:** `README.md`, `docs/USER_GUIDE.md`, `docs/archive/*`, `fixtures/category-import/*`, `backend/db/migrations/0001_baseline.sql`, `backend/db/migrations_archive/*`, `backend/db/seeds/0001_bootstrap.sql`, removed `backend/db/seeds/0001_seed_defaults.sql`, `0002_seed_category_rule_global.sql`, `0003_seed_default_household_categories.sql`, `backend/scripts/gen-0026-migration.mjs`, `backend/src/modules/category/category-ids.ts`, `backend/db/README.md`, `docs/RUNBOOK.md`, `docs/PRODUCTION_SETUP.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/API_INDEX.md`, `docs/DEAD_CODE.md`, `backend/db/seeds/dev/README.md`.

## 2026-04-01 (classification + taxonomy expansion)

### FIX-047 — Fingerprint-aligned rule matching, five default leaves, rules UI, household rule delete
- **Type:** FIX / DB / UX / API / DOC
- **What:** **`contains`** / **`prefix`** classification now normalizes patterns with the same **fingerprint** rules as canonical import (so punctuation in bank text vs stored patterns no longer prevents matches). Added default leaves **Investments > IRA**, **Shopping > General merchandise**, **Taxes > Property tax**, **Taxes > Tax prep**, **Income > Reimbursements** (seed + migration **`0030`**, **`category-ids.ts`**). **`DELETE /categories/rules/:id`** for household rules; Category Rules page: section cards, grouped household **`<details>`**, split CSV export, horizontal Money In/Out on Add Transaction. **`data/imports/category-rules-house.csv`** paths aligned; duplicate mid-file header removed; ATT rule targets **Mobile phone**.
- **Why:** BOA-style descriptions failed many household rules; taxonomy gaps and UI density/export clarity from the rules roadmap.
- **Files:** `backend/src/modules/category/category-rules.ts`, `backend/tests/category-rules.test.ts`, `backend/db/seeds/0001_seed_defaults.sql`, `backend/db/migrations/0030_category_expansion_leaves.sql`, `backend/src/modules/category/category-ids.ts`, `backend/src/modules/category/category-rules.service.ts`, `category-rules.routes.ts`, `backend/tests/categories-resolve-leaf.test.ts`, `frontend/src/pages/CategoryRulesPage.tsx`, `frontend/src/pages/TransactionsPage.tsx` (modal), `frontend/src/index.css`, `data/imports/category-rules-house.csv`, `docs/API_CATEGORIES.md`, `openapi/openapi.yaml`.

## 2026-04-03

### FIX-048 — Household category rules honor `amount_scope`
- **Type:** FIX / DB / API / UX / DOC
- **What:** Migration **`0031_category_rule_household_amount_scope.sql`** adds **`amount_scope`** to **`category_rule`** (default `any`). API create/PATCH/bulk/from-ledger and CSV import/export persist scope; classifier uses stored values (parity with **`category_rule_global`**). **Category Rules** UI: household add/edit table includes amount scope; groups combine category + scope.
- **Why:** Credit vs debit often maps to different meanings; household rules previously ignored scope.
- **Files:** `backend/db/migrations/0031_category_rule_household_amount_scope.sql`, `backend/src/modules/category/category-rules.service.ts`, `category-rules.routes.ts`, `backend/tests/category-rules.test.ts`, `backend/tests/category-rules-api.test.ts`, `frontend/src/pages/CategoryRulesPage.tsx`, `docs/API_CATEGORIES.md`, `docs/IMPORT_CLASSIFICATION.md`, `openapi/openapi.yaml`.

### CR-047 — Delete all household classification rules
- **Type:** CR / API / UX / DOC
- **What:** **`DELETE /categories/rules/household`** returns **`{ deleted }`**; **Category Rules** import section adds **Delete all household rules** (confirm) for clean CSV re-import without duplicates.
- **Why:** Create-only bulk import has no dedupe; clearing the set is the practical workaround.
- **Files:** `category-rules.service.ts`, `category-rules.routes.ts`, `CategoryRulesPage.tsx`, `backend/tests/category-rules-api.test.ts`, `docs/API_CATEGORIES.md`, `openapi/openapi.yaml`.

### DOC-009 — Taxonomy seed alignment, built-in rule group summaries, PRD roadmap refresh
- **Type:** DB / DOC / UX
- **What:** Migration **`0029_sync_global_category_display_names.sql`** updates global **`category.name`** values to match current product copy for upgraded databases. **`0003_seed_default_household_categories.sql`** documents option B (household extensions) without duplicate global parents. **`docs/CATEGORIZATION_ROADMAP.md`** rewritten to match **`0001_seed_defaults`** + Loans/Travel/HOA; notes PRD vs CHECKPOINT as sources of shipped truth. **Classification rules UI:** built-in **`<details>`** group summary shows rule count and **min–max priority**. **`0002_seed_category_rule_global.sql`** unchanged (rules key by `category_id` only).
- **Why:** Keep seeds, migrations, and docs aligned; reduce built-in rule list noise with clearer group headers.
- **Files:** `backend/db/migrations/0029_sync_global_category_display_names.sql`, `backend/db/seeds/0003_seed_default_household_categories.sql`, `docs/CATEGORIZATION_ROADMAP.md`, `docs/CHECKPOINT.md`, `frontend/src/pages/CategoryRulesPage.tsx`.

## 2026-04-01

### CR-046 — Classification rules CSV, bulk APIs, built-in form grid, Home HOA Fees leaf
- **Type:** CR / UX / API / DB / DOC
- **What:** **`/categories/rules`** built-in add form uses CSS Grid (full-width intro + pattern). **CSV** export/import on the same page; **`POST /categories/rules/bulk`** and **`POST /categories/rules/builtin/bulk`** with per-row errors and **`categoryPath`** resolution (`Parent > Child`). Default taxonomy: **Home > HOA Fees** (**migration `0028`**, seed update, **`category-ids.ts`**).
- **Why:** Predictable rule authoring layout, safe bulk onboarding from spreadsheets, and a dedicated HOA leaf for imports/rules.
- **Files:** `frontend/src/pages/CategoryRulesPage.tsx`, `frontend/src/import/rulesCsv.ts`, `frontend/src/index.css`, `backend/src/modules/category/categories.service.ts`, `category-rules.service.ts`, `category-rules.routes.ts`, `backend/db/migrations/0028_category_hoa_fees.sql`, `backend/db/seeds/0001_seed_defaults.sql`, `docs/API_CATEGORIES.md`, `openapi/openapi.yaml`, `backend/tests/category-rules-api.test.ts`, `backend/tests/categories-resolve-leaf.test.ts`.

## 2026-04-02

### CR-045 — Connected accounts institutions, picker harmonization, import docs, OpenAPI, prod seeds
- **Type:** CR / UX / DOC / DB
- **What:** **Connected accounts:** curated U.S. institution list + searchable picker, **`POST /imports/institutions/custom`** for household names, **`GET /imports/institutions`**; removed default-parser UI (mapping remains automatic via `inferParserProfile`). **Migration `0023`** — `household_custom_institution`. **Categories:** shared `categoryPickerGroups` — filter vs **leaf-only** assignment aligned with rules. **Transactions:** Mantine `MultiSelect` for review types; Add Transaction **Money In / Money Out** radios and single **Description** field. **Docs:** `IMPORT_CLASSIFICATION.md`, `PRODUCTION_SETUP.md`, `API_INDEX.md`; **`openapi/openapi.yaml`**; **`PROJECT_CONTEXT`** doc map. **Seeds:** dev fixtures moved to **`seeds/dev/`** (second pass in `db.mjs`). **Copy:** shorter Home + Settings blurbs.
- **Why:** Reduce cognitive load, align assignment UX with category rules, document full import automation vs `/categories/rules`, and clarify production vs dev seeding.
- **Files:** `backend/db/migrations/0023_household_custom_institution.sql`, `backend/src/modules/imports/institution-catalog.ts`, `infer-parser-profile.ts`, `household-institutions.service.ts`, `imports.routes.ts`, `scripts/db.mjs`, `frontend/src/import/institutionCatalog.ts`, `SettingsPage.tsx`, `categoryPickerGroups.ts`, `LedgerCategoryPicker.tsx`, `TransactionsPage.tsx`, `index.css`, `openapi/openapi.yaml`, `docs/*`, `backend/db/README.md`.

### UX-013 — Cascade submenu pickers + add-transaction clarity pass
- **Type:** UX / FIX
- **What:** Reworked shared picker behavior from flat `Parent > Child` text to a hybrid cascade menu with search (left menu + right submenu) and consistent rendering for category/account/belongs-to across Transactions, Dashboard, Import, and Settings. Category creation affordance moved from confusing side `+ +` buttons into in-menu footer actions (`Add group`, `Add subcategory`). Dashboard Home scope controls now render account + belongs-to side-by-side in one horizontal row. Add Transaction modal now uses explicit `Money In` / `Money Out`, positive amount entry, required `Belongs-to`, and fixed picker layering so category dropdown renders above the modal.
- **Why:** Reduce cognitive load, align with expected menu/submenu interaction, remove ambiguous affordances, and fix blocking add-transaction modal picker bug.
- **GitHub (closed):** [#1](https://github.com/mangatrai/household-finance-app/issues/1) cascade picker parity · [#2](https://github.com/mangatrai/household-finance-app/issues/2) add-transaction category dropdown layering · [#3](https://github.com/mangatrai/household-finance-app/issues/3) horizontal Home scope · [#4](https://github.com/mangatrai/household-finance-app/issues/4) money direction + required belongs-to — all addressed in **UX-013** (see **What** above).
- **Files:** `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/components/LedgerCategoryPicker.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/index.css`.

### UX-012 — Picker UX modernization with searchable hierarchy across core workflows
- **Type:** UX
- **What:** Introduced a shared hierarchical searchable picker foundation in frontend and migrated core selectors in Transactions, Dashboard, Import, and Settings to it. Category/account/belongs-to pickers now support in-picker search and hierarchy labels (e.g., `Parent > Child`, `Household > Member`). Replaced the legacy Transactions row category portlet-style chooser with an inline searchable picker and kept quick category creation actions available from Transactions.
- **Why:** Improve selection speed as categories/accounts/members grow, preserve hierarchy clarity, and reduce friction from modal/portlet interactions.
- **Files:** `frontend/src/components/HierarchicalSearchPicker.tsx`, `frontend/src/components/LedgerCategoryPicker.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/main.tsx`, `frontend/package.json`.

### UX-011 — Ownership wording refinement to Belongs-to with hierarchical selectors
- **Type:** UX
- **What:** Refined ownership wording across Settings Connected Accounts, Import file binding, Transactions/Needs Review, and Dashboard from owner/scope-style labels to **`Belongs-to`**. Replaced two-step scope/person controls with a single hierarchical selector pattern: top-level **Household** and member children as **`Household > <Name>`** using profile names.
- **Why:** Improve clarity and reduce harsh ownership language while keeping household/member attribution explicit and consistent.
- **Files:** `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`.

### CR-044 — MVP closure: connected accounts + member ownership attribution across import/ledger/dashboard
- **Type:** CR / DB / UX / FIX
- **What:** Added migration **`0022_member_ownership_connected_accounts.sql`** introducing ownership primitives on `financial_account`, `import_file`, and `transaction_canonical` (`owner_scope`, `owner_person_profile_id`) plus `financial_account.default_parser_profile_id`. Implemented manual connected-account onboarding in **Settings → Connected accounts** (create/edit account, institution/type/mask, owner assignment, parser default metadata). Import file binding now supports owner tagging at file level and carries owner metadata into canonicalized ledger rows. Transactions now support owner filtering (`ownerScope`, `ownerPersonProfileId`) and inline owner retagging while preserving existing category flows. Dashboard/cash summary now supports owner filters and drill-down parity to transactions with owner context preserved.
- **Why:** Close the last MVP gap for air-gapped onboarding and household-member attribution without adding online bank integrations; keep model split-ready for post-MVP allocation enhancements.
- **Files:** `backend/db/migrations/0022_member_ownership_connected_accounts.sql`, `backend/src/modules/imports/*`, `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/src/modules/ledger/*`, `backend/src/modules/reports/*`, `backend/tests/app.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `docs/NEXT_SESSION_PROMPT.md`.

### CR-040 — Remove household-level salary/employer writes; employer resolution uses signed-in user profile
- **Type:** CR / **DOC** / **FIX**
- **What:** **`PATCH /household/settings`** now updates **only** **`monthlySavingsTargetUsd`**. Salary deposit and employers are read/written via **`person_profile`** (**`PATCH /household/profile`**). Removed legacy read fallback from **`household`** columns for salary/employers. Payslip employer lists and import binding resolve employers using **`getHouseholdSettings(householdId, userId)`** (threaded through upload, sniff, parse, import file binding). Updated **`docs/API_HOUSEHOLD.md`**, added **`docs/API_HOUSEHOLD_PROFILE.md`**, tests, and **`PAYSLIP_V1`** / **`MVP_BACKLOG`** pointers.
- **Why:** Completes Epic **12.5** cleanup — single source of truth on profile storage without silent household fallbacks.
- **Files:** `backend/src/modules/household/household.service.ts`, `household.routes.ts`, `payslip-employer-resolve.service.ts`, `payslip.routes.ts`, `payslip-sniff.service.ts`, `import-parser.service.ts`, `import-file-binding.service.ts`, `imports.routes.ts`, `backend/tests/app.test.ts`, `docs/API_HOUSEHOLD.md`, `docs/API_HOUSEHOLD_PROFILE.md`, `docs/PAYSLIP_V1.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `frontend/src/pages/SettingsPage.tsx` (avatar preview copy).

### CR-039 — Settings profile split fields + single household save; move salary/employers to profile ownership
- **Type:** CR / UX / DB
- **What:** **Settings → Profile** now captures **First name**, **Last name**, **Email**, **Phone**, avatar, salary deposit account, and employer rows (parser format). **Settings → Household** member rows now use **First name / Last name / Email** and a single **Save household** action (no per-row save). Added migration **`0020_profile_income_settings.sql`** to store salary deposit + employers on **`person_profile`**; household settings read path now sources these values from the signed-in user profile with legacy household fallback for compatibility.
- **Why:** Salary/employer data is person-specific, not household-global; member editing flow needed a simpler batch save UX.
- **Files:** `backend/db/migrations/0020_profile_income_settings.sql`, `backend/src/modules/household/household.service.ts`, `household.routes.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/CHANGE_HISTORY.md`.

### CR-038 — Settings Household RBAC: member tab hidden; backend 403 on management routes
- **Type:** CR / **UX**
- **What:** Enforced Household management RBAC so **owner/admin** can manage household settings/members while **member** cannot. Backend adds role guards on household management routes (members receive **403** on household settings mutation and members list/create/update). Frontend `Settings` hides the **Household** tab for members and redirects away if opened directly.
- **Why:** Household structure is an admin concern; member UX should avoid edit affordances they cannot use.
- **Files:** `backend/src/modules/household/household.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `docs/FINANCE_APP_PRD.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### DOC-013 — Epic 12/13 phase plan with first two sprints
- **Type:** DOC
- **What:** Added **`docs/EPIC_12_13_EXECUTION_PLAN.md`** with dependency-first sequence across Epics **12** and **13**, phase gates (A-D), explicit scope guardrails, and constrained **Sprint 1 / Sprint 2** definition of done to avoid oversizing the initiative. Added discoverability links from **`docs/MVP_BACKLOG.md`** and **`docs/CHECKPOINT.md`**.
- **Why:** Convert broad settings/account/security direction into an executable, low-risk rollout plan that can be delivered incrementally.
- **Files:** `docs/EPIC_12_13_EXECUTION_PLAN.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### DOC-012 — Settings/Auth direction: separate `user_account` and `person_profile`
- **Type:** DOC / PRD
- **What:** Updated **`docs/FINANCE_APP_PRD.md`** and **`docs/MVP_BACKLOG.md`** to lock architecture choice: **Option B** with separate auth identity (**`user_account`**) and human profile (**`person_profile`**), plus **`household_membership`** role/relationship model. Added backlog epics for identity/membership ownership attribution (**Epic 12**) and credentials lifecycle/security settings (**Epic 13**). Updated **`docs/CHECKPOINT.md`** planned rows + next-step priorities accordingly.
- **Why:** Household workflows need profile-only members (e.g., children/dependents), person-level attribution for documents/transactions, and long-term maintainable auth boundaries.
- **Files:** `docs/FINANCE_APP_PRD.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### CR-037 — Epic 3.3+: employer-driven parser, ADP profile stub, PDF sniff, `employer_id`
- **Type:** CR / **DB**  
- **What:** Migration **`0018_payslip_employer_ref.sql`** — nullable **`employer_id`** on **`payslip_snapshot`** and **`import_file`**. **Settings → Household:** per-employer **payslip format** (**IBM** vs **ADP** placeholder **`adp_payslip_pdf`**); **`resolvePayslipUploadContext`** — 0 employers → IBM default; 1 → that employer’s parser; 2+ → **`employerId`** required on **`POST /payslips/upload`** and payslip import parse unless file already has **`employer_id`**. **`POST /payslips/sniff`** — optional PDF text signals to suggest parser/employer before upload/binding. **Import:** **`PATCH`** import file accepts **`employerId`** for payslip profiles; parse routes **`parsePayslipPdfByProfile`** (ADP returns **`unsupported_parser`** until implemented). **Canonicalize:** payslip rows for any payslip profile linked to session. **UI:** employer column / dropdown on **`/payslips`** and Import when multiple employers; detail shows **Employer** when set. **Out of scope:** linking stub to bank deposit.  
- **Why:** Product-shaped multi-employer households without guessing parser; sniff reduces wrong-profile uploads.  
- **Files:** `backend/db/migrations/0018_payslip_employer_ref.sql`, `backend/src/modules/payslip/*`, `import-parser.service.ts`, `import-file-binding.service.ts`, `imports.routes.ts`, `canonical-ingest.service.ts`, `household.service.ts`, `frontend/src/pages/PayslipsPage.tsx`, `PayslipDetailPage.tsx`, `ImportWorkspacePage.tsx`, `SettingsPage.tsx`, `profileLabels.ts`, `inferParserProfile.ts`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`.

### UX-010 — Payslip charts: merge same pay date; clarify day vs month
- **Type:** UX  
- **What:** **Gross & net by pay date** — one chart point per **calendar day**; multiple stubs on the same day have **combined** totals (tooltip shows count). Renamed from “by paycheck”; **Totals by calendar month** copy explains **monthly budgeting** vs **per-payday** timeline. **`docs/PAYSLIP_V1.md`** — chart behavior note.  
- **Why:** Duplicate x-axis labels and flat lines when several uploads shared one date; users asked how the two charts differ.  
- **Files:** `frontend/src/payslip/payslipChartsModel.ts`, `PayslipIncomeCharts.tsx`, `payslipChartsModel.test.ts`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`.

### CR-036 — Epic 3.3: Payslips income charts (gross / net / taxes / MoM)
- **Type:** CR / **UX**  
- **What:** **`/payslips`** — **Recharts** section **Income & payroll**: line series **gross**, **net**, **employee taxes withheld** by paycheck (chronological); **calendar month** line chart (sums per month); **donut** of latest stub **current** buckets (net, taxes, pre/post deductions). Shared **`PayslipSnapshotDetail`** type in **`frontend/src/payslip/types.ts`**. List fetch **`limit=200`**. **`docs/PAYSLIP_V1.md`** — Story **3.3** UI progress.  
- **Why:** Move payslip UI from table-only to basic payment analytics without ledger merge.  
- **Files:** `frontend/src/payslip/types.ts`, `payslipChartsModel.ts`, `PayslipIncomeCharts.tsx`, `PayslipsPage.tsx`, `PayslipDetailPage.tsx`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`, `docs/CHECKPOINT.md`.

### CR-035 — Wire salary account / employers into payslip inference and snapshot `parser_profile_id`
- **Type:** CR  
- **What:** **`payslipParserProfileIdForHousehold`** — first employer’s **`parserProfileId`** when supported (v1: IBM only); **`POST /payslips/upload`** and import payslip parse use it for **`payslip_snapshot.parser_profile_id`**. **`inferParserProfile`** — optional **`IncomeInferenceContext`** from **`GET /household/settings`**: salary deposit account + ≥1 employer + PDF whose name does **not** look like a bank statement (**`filenameLooksLikeBankStatementPdf`**) → employer’s parser (IBM default). **Import workspace** loads settings and passes context; copy updated.  
- **Why:** Settings onboarding affects real behavior, not only storage.  
- **Files:** `backend/src/modules/payslip/payslip-profile-hints.ts`, `payslip.routes.ts`, `import-parser.service.ts`, `frontend/src/import/inferParserProfile.ts`, `ImportWorkspacePage.tsx`, `inferParserProfile.test.ts`, `docs/CHANGE_HISTORY.md`.

### CR-034 — Income onboarding (household settings); resolution queue + orphan banner; dashboard cash UX
- **Type:** CR / **DB** / **UX**  
- **What:** Migration **`0017_household_income_onboarding.sql`** — **`salary_deposit_financial_account_id`**, **`employers_json`** (default **`[]`**). **`GET/PATCH /household/settings`** — optional salary account + employer stubs (**IBM** parser id default); validate account belongs to household. **Settings → Household** UI. **`countOpenDuplicateAmbiguityNotOnLedger`** + **`GET /resolution/summary`** field **`openDuplicateAmbiguityNotOnLedger`** (DOC-005). **`/resolution-queue`** page lists **`GET /resolution?status=open`**; **Transactions → Needs review** banner when raw-only near-duplicates exist. **Dashboard:** friendlier **366-day** limit messaging, **safe-to-spend** tooltip clarification. **Docs:** **`API_HOUSEHOLD.md`**, **`API_RESOLUTION.md`**, **`PAYSLIP_V1.md`**.  
- **Why:** Close gaps on payslip/product story, invisible near-duplicate review items, and perceived cash-summary polish without new pipelines.  
- **Files:** `backend/db/migrations/0017_household_income_onboarding.sql`, `backend/src/modules/household/*`, `backend/src/modules/resolution/resolution.service.ts`, `resolution.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/SettingsPage.tsx`, `ResolutionQueuePage.tsx`, `App.tsx`, `TransactionsPage.tsx`, `DashboardPage.tsx`, `docs/API_HOUSEHOLD.md`, `docs/API_RESOLUTION.md`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`.

### FIX-009 — Import: auto-create payslip placeholder account if missing (dev DBs / no seed)
- **Type:** FIX  
- **What:** **`GET /imports/accounts`** calls **`ensurePayslipImportPlaceholderAccount(householdId, userId)`** before listing — idempotent **`payslip`** row with institution **`Employer payslip (IBM) — placeholder`** when the signed-in user has none (so UI instructions match without re-running seeds). Account list **`ORDER BY`** puts **`type = payslip`** first.  
- **Why:** Seed **`0004`** only applies on **`--seed`**; existing **`MODE=PROD`** DBs often never got the row; dropdown looked empty for the copy added in **CR-032**.  
- **Files:** `backend/src/modules/imports/import-file-binding.service.ts`, `imports.routes.ts`, `docs/CHANGE_HISTORY.md`.

### CR-032 — `financial_account.type` **payslip** + IBM placeholder; inference for generic PDF names
- **Type:** CR / **DB**  
- **What:** Migration **`0016_financial_account_type_payslip.sql`** — **`type`** may be **`payslip`** (table recreated for expanded **`CHECK`**). Seed **`0004_seed_payslip_placeholder_account.sql`** — **`Employer payslip (IBM) — placeholder`** for seed household **owner** (`owner_user_id`); import UI lists it like other accounts. **`inferParserProfile`:** **`payslip`** + **`.pdf`** → **`ibm_pay_contributions_pdf`** before institution rules so generic filenames are not mistaken for bank e-statements. **`formatAccountForSelect`** — institution-only label for payslip rows. **Follow-on (not shipped):** onboarding **N employers** + per-employer payslip accounts and **parser mapping** (IBM vs ADP vs …); multi-job households need that layer on top of this placeholder.  
- **Why:** Direction **A** — a dedicated bucket account for payslip imports without pretending the PDF is a bank statement; v1 single IBM stub until onboarding defines multiple employers/parsers.  
- **Files:** `backend/db/migrations/0016_financial_account_type_payslip.sql`, `backend/db/seeds/0004_seed_payslip_placeholder_account.sql`, `frontend/src/import/inferParserProfile.ts`, `accountDisplay.ts`, `inferParserProfile.test.ts`, `ImportWorkspacePage.tsx`, `docs/CHANGE_HISTORY.md`.

### CR-031 — Payslip: `GET /payslips/:id` + detail route; Epic 5.2 deferred post-MVP
- **Type:** CR  
- **What:** **`GET /payslips/:id`** — household-scoped read of full **`payslip_snapshot`** (invalid UUID → **400**, missing → **404** **`NOT_FOUND`**). **`PayslipDetailPage`** at **`/payslips/:payslipId`** — period, Current/YTD table, import file id when present, collapsible **`rawExtractJson`**. List links pay period / file / **View** to detail. **Docs:** **Epic 5.2** (**transfer matcher** continuation) marked **post-MVP / backlog** — further pattern work waits on **real-world statement validation** vs fixtures (**`MVP_BACKLOG`**, **`CHECKPOINT`**, **`PROJECT_CONTEXT`**).  
- **Why:** Complete the payslip **read path** after list + upload; align planning with deprioritizing transfer-matcher tuning until production-like data.  
- **Files:** `backend/src/modules/payslip/payslip.service.ts`, `payslip.routes.ts`, `backend/tests/payslip-upload.test.ts`, `frontend/src/pages/PayslipDetailPage.tsx`, `PayslipsPage.tsx`, `App.tsx`, `frontend/src/index.css`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/PROJECT_CONTEXT.md`, `docs/PAYSLIP_V1.md`, `docs/CHANGE_HISTORY.md`.

### CR-030 — Epic 5.2: transfer matcher CARD / HELOC / loan outgoing payment tokens
- **Type:** CR  
- **What:** **`transferPairScore`** — **`outgoingPaymentTokens`** adds specific **card / HELOC / loan** payoff memos that omit directional **“PAYMENT TO”** phrasing: **`CARD PAYMENT`**, **`HELOC PAYMENT`**, **`LOAN PAYMENT`**, **`MORTGAGE PAYMENT`**, **`INSTALLMENT PAYMENT`** (still gated with existing **PAYMENT** + card/loan context so generic ACH + **THANK YOU** pairs are not loosened). Tests extended in **`canonical-ingest.test.ts`**.  
- **Why:** More bank statements encode payoffs as **“… CARD PAYMENT”** / **“… HELOC PAYMENT”** rather than **“PAYMENT TO …”**; scoring the debit leg as **outgoing payment** improves auto-**`transfer_group_id`** linking for those cases.  
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/canonical-ingest.test.ts`, `docs/CHANGE_HISTORY.md`.

### CR-029 — Cash summary: byCategory prior-window totals/deltas
- **Type:** CR
- **What:** `GET /reports/cash-summary` now includes per-category previous-window totals and deltas in `byCategory[]` when `categoryBreakdown=true`:
  - `previousInflows`, `previousOutflows`, `previousNet`
  - `deltaInflows`, `deltaOutflows`, `deltaNet`
  using the same `comparison.previousPeriod` date rules as household KPIs.
- **Why:** Make category drill-down comparisons consistent with the dashboard’s KPI deltas.
- **Files:** `backend/src/modules/reports/cash-summary.service.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/DashboardPage.tsx` (types), `docs/API_CASH_SUMMARY.md`.

### DOC-011 — Docs sync: unified payslip import, migration **0015**, import API
- **Type:** DOC  
- **What:** **`docs/CHECKPOINT.md`** (payslip + import status, next steps), **`docs/API_IMPORT_SESSIONS.md`** (**`ibm_pay_contributions_pdf`**, parse/canonicalize behavior for payslip-only sessions), **`docs/PAYSLIP_V1.md`** (§1 progress — **`import_file`** link), **`docs/NEXT_SESSION_PROMPT.md`** (handoff bullets), **`docs/PROJECT_CONTEXT.md`** (immediate next focus). **`docs/API_CASH_SUMMARY.md`** — Epic **7** backlog pointer for per-category comparison fields (aligns with TODO in service).  
- **Why:** Repo behavior for unified Import + payslip was ahead of written contracts.  
- **Files:** those docs, **`docs/CHANGE_HISTORY.md`**.

### CR-028 — Import: IBM payslip through session pipeline + filename heuristic
- **Type:** CR  
- **What:** Migration **`0015_payslip_import_file.sql`** — **`payslip_snapshot.import_file_id`** → **`import_file`**. Parse profile **`ibm_pay_contributions_pdf`**: writes **`payslip_snapshot`**, **`parsedRows` 0**, no **`transaction_raw`**. Canonicalize: payslip-only IBM session completes (**`inserted: 0`**, staging purge) instead of **`NO_RAW_ROWS`**. **`inferParserProfile`** (frontend) suggests **`ibm_pay_contributions_pdf`** for **`.pdf`** files whose names look like employer payslips (paystub, payslip, SuccessFactors, pay and contribution, etc.) before institution PDF rules.  
- **Why:** Single Import intake for employer PDFs; less manual profile picking; **`GET /payslips`** shows **`importFileId`**.  
- **Files:** backend migrations/services (already shipped); **`frontend/src/import/inferParserProfile.ts`**, **`frontend/src/pages/ImportWorkspacePage.tsx`**, **`frontend/src/import/inferParserProfile.test.ts`**, Vitest in **`frontend/`**.

### UX-009 — Import workspace: payslip (IBM) guidance
- **Type:** UX  
- **What:** **Import session** — short callout under **Files & account**: choose **Employer payslip (IBM)** when the PDF is a pay stub; **parse** shows **0** ledger lines; **canonicalize** still finishes and clears staging; data appears under **Payslips**. **Last import** summary adds a line when **`parsedRows === 0`** and nothing posted, pointing to payslips.  
- **Why:** Reduces confusion for payslip-only sessions.  
- **Files:** **`frontend/src/pages/ImportWorkspacePage.tsx`**, **`docs/CHANGE_HISTORY.md`**.

---

## 2026-04-01

### UX-014 — Classification rules + import UX: session wayfinding, matcher preview on import, built-in category scope
- **Type:** UX / FIX
- **What:** **`GET /imports/sessions`** lists recent sessions for the household. **`/imports`** is an **Import** hub (recent sessions, **Continue**, **New import session**, deep link **`/imports?sessionId=`**). Header control opens the hub instead of silently starting a session. Session page adds **Copy id** and moves the read-only **classification matcher preview** from Classification Rules into the import workspace. **Built-in rule** forms only offer **global default leaves**; grouped built-in rules table by category + amount scope. API: invalid built-in category returns **`BUILTIN_REQUIRES_GLOBAL_LEAF`** with a clear message.
- **Why:** Align UI with the mental model (preview is a matcher dry-run; parsing persists in DB; global rules cannot target household-created categories).
- **Files:** `backend/src/modules/imports/import-session.service.ts`, `imports.routes.ts`, `category-rules.service.ts`, `category-rules.routes.ts`, `backend/tests/app.test.ts`, `backend/tests/category-rules-api.test.ts`, `frontend/src/App.tsx`, `frontend/src/layout/AppTopBar.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/CategoryRulesPage.tsx`, `docs/IMPORT_CLASSIFICATION.md`, `docs/CHANGE_HISTORY.md`.

### DOC-010 — Docs sync: payslip progress, checkpoint, next-session prompt
- **Type:** DOC  
- **What:** **`docs/CHECKPOINT.md`**, **`docs/PROJECT_CONTEXT.md`**, **`docs/PAYSLIP_V1.md`**, **`docs/NEXT_SESSION_PROMPT.md`** — reflect **FIX-006**–**FIX-008**, **UX-008**, IBM SuccessFactors parser behavior, dev **`/payslips`** proxy, and prioritized **next build** themes (unified import vs payslip-only UX).  
- **Why:** Single handoff for humans and AI sessions after payslip hardening.  
- **Files:** those docs, `docs/CHANGE_HISTORY.md`.

### UX-008 — Payslips upload: success path after async (form reset)
- **Type:** UX  
- **What:** **`PayslipsPage`** — capture **`HTMLFormElement`** before **`await`**; call **`form.reset()`** after successful upload + reload instead of touching **`e.currentTarget.elements`** (React synthetic event **`currentTarget`** is **`null`** after await → *Cannot read properties of null (reading 'elements')*).  
- **Why:** Upload succeeded server-side but UI threw; poor UX.  
- **Files:** `frontend/src/pages/PayslipsPage.tsx`, `docs/CHANGE_HISTORY.md`.

### FIX-008 — Vite dev proxy: `/payslips` → API
- **Type:** FIX  
- **What:** **`frontend/vite.config.ts`** — proxy **`/payslips`** to backend (same as **`/imports`**, **`/transactions`**). Without it, **`fetch('/payslips/...')`** in dev hit the Vite server and failed.  
- **Why:** Payslip list/upload appeared broken in **`npm run dev:frontend`** until proxy added.  
- **Files:** `frontend/vite.config.ts`, `docs/CHANGE_HISTORY.md`.

---

## 2026-03-31

### CR-043 — MVP final hardening: broader reconciliation balance-key support, bulk review throughput, and KPI drill-down parity
- **Type:** CR / UX / FIX
- **What:** Reconciliation diagnostics now detect running balance from any parsed `source_row` key containing `balance` (not only `source_row.balance`), including parenthesized negatives. Transactions bulk toolbar adds a high-throughput **Apply + resolve** action for unknown-category selections, plus mixed-selection guardrail copy. Dashboard unknown-category CTA now preserves current date/account scope, and by-account drill-down links preserve dashboard return context. Added integration tests for balance-key reconciliation and mixed `bulk-apply-category` behavior.
- **Why:** Close remaining P0 monthly-close friction by increasing reconciliation coverage across feasible parser outputs, reducing per-row review clicks, and keeping dashboard-to-ledger navigation consistent.
- **Files:** `backend/src/modules/imports/session-summary.service.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `backend/tests/app.test.ts`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `docs/NEXT_SESSION_PROMPT.md`.

### CR-042 — Import reconciliation diagnostics + file-scoped review links + custom-range guardrails
- **Type:** CR / UX / FIX
- **What:** Import session summary now includes per-file **reconciliation diagnostics** (when running balance is available in parsed rows): opening, net activity, expected closing, actual closing, variance, and status (`ok`/`mismatch`/`insufficient_data`). Import workspace surfaces session/file reconciliation stats and details in **Outcomes by file**. Added file-scoped review reliability: ledger API now supports **`fileId`** filter, and import outcome links use `sessionId+fileId` for both all-rows and needs-review drill-down. Dashboard custom range now validates client-side (date order and 366-day cap) before apply.
- **Why:** Tighten monthly-close trust checks, remove dead-end review navigation in multi-file sessions, and prevent avoidable custom-range UX errors.
- **Files:** `backend/src/modules/imports/session-summary.service.ts`, `backend/src/modules/ledger/ledger.routes.ts`, `backend/src/modules/ledger/ledger.service.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `docs/NEXT_SESSION_PROMPT.md`.

### CR-041 — Token-version session invalidation, top-bar avatar/name, and import employer guardrails
- **Type:** CR / FIX / UX
- **What:** Added migration **`0021_user_token_version.sql`** (`app_user.token_version` default `0`). JWTs now carry `tokenVersion`; auth verification rejects tokens when DB version differs. **`POST /auth/change-password`** now rotates password hash and increments token version so existing sessions are invalidated immediately. Added integration assertion in auth test that old token returns **401** after password change. UI shell now shows profile identity in top bar (`avatarKey` emoji + first name) by loading **`GET /household/profile`**. Import workspace now blocks parse/run-import when multi-employer payslip files are missing employer selection and shows actionable file-level guidance. Updated stale copy from **Settings → Household** to **Settings → Profile / Employer Setup** in payslip/import pages.
- **Why:** Complete practical Epic 13 security behavior (session invalidation on credential change), close visible profile continuity gap, and prevent avoidable multi-employer payslip import failures.
- **Files:** `backend/db/migrations/0021_user_token_version.sql`, `backend/src/modules/auth/auth.service.ts`, `backend/tests/app.test.ts`, `frontend/src/layout/AppTopBar.tsx`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/pages/PayslipsPage.tsx`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`, `docs/NEXT_SESSION_PROMPT.md`.

### FIX-007 — IBM payslip: multiline PDF text (real SuccessFactors layout)
- **Type:** FIX  
- **What:** **`parseIbmPayslipFromText`** — pay period from first **`MM/DD/YYYY-MM/DD/YYYY`** range; **Gross Pay** / **Hours** Current+YTD read from **same line** or **following** money-only lines; **Net Pay** Current+YTD from lines **above** the **`Net Pay`** label (IBM layout). **Pay date** from **Payment Information** block (`Pay Date` / `…USD`). Regression test with anonymized multiline extract.  
- **Why:** User PDFs (`Feb_Regular_paycheck.pdf`, `Feb_Commission_PayCheck.pdf`) extracted text with labels and amounts on **different lines**, so the old single-line regex never saw gross/net and returned **`PARSE_FAILED`**.  
- **Files:** `backend/src/modules/payslip/profiles/ibm-payslip-pdf.ts`, `backend/tests/pdf-parsers.test.ts`, `docs/CHANGE_HISTORY.md`.

### FIX-006 — Payslip PDF: broader label matching + clearer 422 reasons
- **Type:** FIX  
- **What:** **`parseIbmPayslipFromText`** — normalize NBSP; match **Total Earnings**, **Pay Begin/End Date**, and other common payroll labels; fallbacks when a line has two money columns. **`parseIbmPayslipPdf`** returns **`empty_pdf_text` / `no_summary_fields` / `pdf_read_error`** so **`422`** responses distinguish **scanned PDFs** from **unknown layouts**. **`PayslipsPage`** shows **`message`** from JSON errors.  
- **Why:** Real uploads often failed **`PARSE_FAILED`** despite readable PDFs; users need to know if the file is image-only vs unsupported wording.  
- **Files:** `backend/src/modules/payslip/profiles/ibm-payslip-pdf.ts`, `payslip.routes.ts`, `backend/tests/pdf-parsers.test.ts`, `frontend/src/pages/PayslipsPage.tsx`, `docs/CHANGE_HISTORY.md`.

---

## 2026-03-27

### CR-025 — Needs review UX: bulk category guardrails + clearer “why” copy
- **Type:** CR + UX  
- **What:** **Transactions → Needs review** — selection summary shows how many open **Unknown category** items apply to bulk **Apply category**; button disabled when none; error text explains transfer/duplicate/other flags. Toolbar link **Show unknown category only** sets **`resolutionType=unknown_category`**. Intro copy clarifies categorized rows can remain for non-category review. **`buildReviewReasons`** adds a line when a category is set but other resolution types remain.  
- **Why:** **`docs/CHECKPOINT.md`** pickup — reduce confusion when bulk apply appears inert or rows look “already categorized.”  
- **Files:** `frontend/src/pages/TransactionsPage.tsx`, `backend/src/modules/ledger/ledger.service.ts`, `docs/CHANGE_HISTORY.md`.

### CR-026 — Epic 3.3b starter: `GET /payslips` + Payslips page
- **Type:** CR  
- **What:** **`GET /payslips?limit&offset`** — household-scoped list (newest first) with **`total` / `items`**. **`PayslipsPage`** at **`/payslips`**: upload + table (period, pay date, gross, net, file, uploaded, parser). Sidebar **Payslips**. Integration test for list after upload.  
- **Why:** Read path for **`payslip_snapshot`**; basic UI for pay stubs without merging into ledger.  
- **Files:** `backend/src/modules/payslip/payslip.service.ts`, `payslip.routes.ts`, `frontend/src/pages/PayslipsPage.tsx`, `frontend/src/App.tsx`, `frontend/src/layout/AppSidebar.tsx`, `backend/tests/payslip-upload.test.ts`, `docs/CHANGE_HISTORY.md`.

### CR-027 — Epic 5.2: bill-pay memo pairing for transfer score
- **Type:** CR  
- **What:** **`transferPairScore`** — when **both** legs match bill-pay phrasing (**`BILL PAY`**, **`BILLPAY`**, **`ONLINE BILL PAY`**, **`BILL PAYMENT`**), score **77** (ordered before generic **TRANSFER** at 80). Unit tests.  
- **Why:** Stronger pairing for common bank bill-pay memos vs ambiguous amount/date matches.  
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/canonical-ingest.test.ts`, `docs/CHANGE_HISTORY.md`.

---

## 2026-03-30

### DOC-014 — CHECKPOINT handoff (next session context)
- **Type:** DOC
- **What:** Refreshed **`docs/CHECKPOINT.md`** — **Last updated** line, new **Handoff — next session** block (CR-040 stability summary, **`avatarKey`** preview vs top bar, suggested next picks, branch reminder), **Epic 12** row moved to **partial** (**0019**/**0020** + profile endpoints), **UI shell** row notes **`avatarKey`** not wired in **`AppTopBar`** yet. Updated **`docs/PROJECT_CONTEXT.md`** (recent shipped + immediate next focus) and **`docs/NEXT_SESSION_PROMPT.md`** (read list + summary prompt for **`0020`** / **CR-040**).
- **Why:** Preserve resume context after a stopping point without re-reading the full diff.
- **Files:** `docs/CHECKPOINT.md`, `docs/PROJECT_CONTEXT.md`, `docs/NEXT_SESSION_PROMPT.md`, `docs/CHANGE_HISTORY.md`.

### DOC-009 — Handoff: Needs review bulk category + “categorized on review” semantics
- **Type:** DOC  
- **What:** **`docs/CHECKPOINT.md`** new section **“Next session pickup — Needs review / bulk category”** — documents why bulk **Apply category** can show *Select rows with an open “Unknown category” review item* (UI sends only **`unknown_category`** **`resolution_item`** ids from **`openReviewItems`**; **`TransactionsPage`** **`collectUnknownCategoryResolutionIds`**); and why rows **with categories** can still appear (**`NEEDS_REVIEW_PREDICATE`** / open non-unknown resolution types). **`docs/PROJECT_CONTEXT.md`**, **`docs/NEXT_SESSION_PROMPT.md`** updated to point here.  
- **Why:** Resume after pause without re-discovering behavior in code.  
- **Files:** `docs/CHECKPOINT.md`, `docs/PROJECT_CONTEXT.md`, `docs/NEXT_SESSION_PROMPT.md`, `docs/CHANGE_HISTORY.md`.

---

## 2026-03-29

### FIX-005 — Ledger `search`: hybrid substring + FTS; rebuild migration `0014`
- **Type:** FIX  
- **What:** **`GET /transactions?search=`** no longer requires an **INNER JOIN** on **`ledger_search_fts`** only (empty or stale FTS returned **no rows**). Filter is **`instr(...)` substring OR `EXISTS` … `ledger_search_fts MATCH ?`** (SQLite requires **`MATCH`** on the **virtual table name**, not an alias — alias caused **500**). List order is **date** (newest first), not BM25. Migration **`0014_rebuild_ledger_search_fts`** re-syncs the FTS table from **`transaction_canonical`**. UI copy updated on **Transactions** toolbar.  
- **Why:** Search appeared “broken” when FTS was empty/out of sync or migrations were missing **`0011`**.  
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `backend/db/migrations/0014_rebuild_ledger_search_fts.sql`, `backend/tests/app.test.ts`, `docs/API_LEDGER.md`, `README.md`, `frontend/src/pages/TransactionsPage.tsx`, `docs/CHANGE_HISTORY.md`.

### CR-024 — Ledger search: SQLite FTS5 + BM25 (`0011`, `0013`)
- **Type:** CR + DB  
- **What:** Migration **`0011_ledger_search_fts`** — **`ledger_search_fts`** (body = merchant + memo), backfill, triggers; **`0013`** fixes delete/update trigger bodies for **`undo-import`** / row deletes. **`GET /transactions?search=`** uses **`MATCH`** with token **AND** semantics, **`ORDER BY bm25(...)`** then date.  
- **Why:** Epic **8.3** / **D-010** — ranked full-text search vs substring-only.  
- **Files:** `backend/db/migrations/0011_ledger_search_fts.sql`, `0013_fix_ledger_search_fts_triggers.sql`, `backend/src/modules/ledger/ledger.service.ts`, `backend/tests/app.test.ts`, `docs/API_LEDGER.md`, `frontend/src/pages/TransactionsPage.tsx` (toolbar copy).

### CR-023 — Epic 3.3a: payslip snapshot storage + IBM summary parser + upload API
- **Type:** CR + DB + FIX  
- **What:** Migration **`0012_payslip_snapshot`** (household-scoped payslip rows; **`raw_extract_json`** for parser diagnostics). **`POST /payslips/upload`** (multipart field **`file`**, auth) runs **`parseIbmPayslipPdf`** → **`parseIbmPayslipFromText`** (regex on Current/YTD summary lines); profile id **`ibm_pay_contributions_pdf`**. Dedupe on **`(household_id, file_checksum)`** → **409** **`DUPLICATE_PAYSLIP`** with existing snapshot. Unit tests on **`backend/tests/fixtures/ibm-payslip-sample.txt`**; integration test mocks PDF text extraction to exercise upload + DB. **FIX:** Migration **`0013`** replaces FTS5 delete/update triggers that used invalid **`INSERT … VALUES('delete', rowid)`** (undo-import and canonical **`DELETE`** failed with SQL logic error); **`ledger.service`** FTS join uses **`ledger_search_fts MATCH`** on the table name (no alias) so SQLite accepts the clause.  
- **Why:** Ship **3.3a** (parse + persist + API + tests) without payslip dashboard UI; keep payslip data separate from bank ledger.  
- **Files:** `backend/db/migrations/0012_payslip_snapshot.sql`, `0013_fix_ledger_search_fts_triggers.sql`, `backend/src/modules/payslip/*`, `backend/src/app.ts`, `backend/src/modules/ledger/ledger.service.ts`, `backend/tests/fixtures/ibm-payslip-sample.txt`, `backend/tests/pdf-parsers.test.ts`, `backend/tests/payslip-upload.test.ts`, `docs/PAYSLIP_V1.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### CR-022 — Import workspace: finalize session (review → finalized)
- **Type:** CR  
- **What:** When **`sessionStatus === review`**, **Finalize session** calls **`PATCH /imports/sessions/:sessionId/status`** with **`{ "status": "finalized" }`**. Confirm dialog states finalized sessions are immutable (no undo import). On success: reload session, success message, undo block hidden (not **`review`**). **409** **`INVALID_TRANSITION`** surfaced with readable copy (includes **`from`** / **`to`** when present). Placed next to **Undo ledger posting**.  
- **Why:** Expose session finalize in the UI instead of API-only; align with **CR-021** undo-before-finalize flow.  
- **Files:** `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/index.css` (minimal), `docs/API_IMPORT_SESSIONS.md`, `docs/CHANGE_HISTORY.md`.

### CR-021 — Epic 6.3: undo import before finalize + D-014 Categories copy
- **Type:** CR + UX  
- **What:** **`POST /imports/sessions/:sessionId/undo-import`** — while **`status === review`**, delete **`transaction_canonical`** rows sourced from this session’s **`transaction_raw`** (`source_ref`), clear affected **`transfer_group_id`** values, delete related **`resolution_item`** rows (including partner rows in those groups). **`finalized`** → **409** `SESSION_NOT_REVIEW`. Import workspace: **Remove posted transactions from this import**. **`CategoriesPage`:** short **D-014** copy — primary categorization on **Transactions**; this page + rules for taxonomy / automation. Tests: undo + re-canonicalize; finalized rejection. Docs: **`API_IMPORT_SESSIONS.md`**, **`MVP_BACKLOG.md`** Story **6.3**, **`CHECKPOINT.md`**.  
- **Why:** Epic **6.3** acceptance — safe rollback before session finalize; reinforce two-tier category IA.  
- **Files:** `backend/src/modules/imports/import-session-rollback.service.ts`, `imports.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `CategoriesPage.tsx`, `docs/API_IMPORT_SESSIONS.md`, `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### DOC-008 — D-014 accepted: two-tier category IA (ledger primary; Categories + Rules secondary)
- **Type:** DOC  
- **What:** **`docs/DECISIONS_LOG.md` D-014** moved from **proposed / partial** to **Accepted**. **Decision:** **Transactions** remain the **primary** categorization surface (**`LedgerCategoryPicker`**, inline create). **`/categories`** and **`/categories/rules`** stay as **secondary** routes — taxonomy browse/add and **pattern-rule** authoring are distinct jobs from row assignment; **no** single merged “ledger hub” for those in MVP. Optional future consolidation (e.g. rules as a tab under Categories) explicitly **out of scope** until usage warrants it.  
- **Why:** Unblock IA ambiguity before real-data rule tuning; aligns with holistic category strategy (ledger for assignment, dedicated surfaces for taxonomy + automation).  
- **Files:** `docs/DECISIONS_LOG.md`, `docs/CHECKPOINT.md`, `docs/MVP_BACKLOG.md`, `docs/API_CATEGORIES.md`, `docs/NEXT_SESSION_PROMPT.md`, `docs/PROJECT_CONTEXT.md`, `docs/CHANGE_HISTORY.md`.

### CR-018 — Epic 11 Story 11.5: Needs review parity + retire `/resolution` UI
- **Type:** CR + IA (**DOC-005**)  
- **What:** **`GET /transactions/:id/open-review`** — open / in_review **`resolution_item`** rows for one canonical id with the same **`context`** enrichment as **`GET /resolution`**. Ledger list (**`needsReview=true`**) **`openReviewItems`** now include **`status`**. **Transactions → Needs review:** **Show** row expansion loads context; per-item **In review / Resolve / Reopen** via **`PATCH /resolution/:id`**; inline category for **`unknown_category`** items in the panel. **Sidebar:** removed **Review queue**. **`/resolution`** route → **`Navigate`** to **`/transactions?needsReview=true`**. **Home** unknown-category banner and **Import** near-duplicate CTA link to Needs review (Import preserves **`sessionId`**). **Deleted** **`ResolutionQueuePage.tsx`**. Tests: ledger **`openReviewItems`** **`status`**, **`open-review`** integration. Docs: **`API_LEDGER.md`**, **`API_RESOLUTION.md`**, **`CHECKPOINT.md`**, **`MVP_BACKLOG.md`**.  
- **Why:** Close **Story 11.5** / **DOC-005** — one primary review surface without maintaining a second queue page.  
- **Intentional gaps:** Near-duplicate **`resolution_item`** rows whose **`target_id`** is a skipped raw line may still not appear under **`needsReview`** until link rules are extended; duplicate/transfer **special-case** UX beyond status/category may still trail the old queue.  
- **Files:** `backend/src/modules/resolution/resolution.service.ts`, `backend/src/modules/ledger/ledger.service.ts`, `ledger.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/App.tsx`, `AppSidebar.tsx`, `DashboardPage.tsx`, `ImportWorkspacePage.tsx`, deleted `ResolutionQueuePage.tsx`, `frontend/src/index.css`, `docs/API_LEDGER.md`, `docs/API_RESOLUTION.md`, `docs/CHECKPOINT.md`, `docs/MVP_BACKLOG.md`, `docs/CHANGE_HISTORY.md`.

### CR-019 — Epic 6: file-level import drill-down (summary API + workspace UI)
- **Type:** CR  
- **What:** **`GET /imports/sessions/:id/summary`** adds per-file and session totals: **`nearDuplicatesFlagged`**, **`openItemsNeedingReview`**, **`notPostedExactDuplicateOrSkipped`** (grouped SQL, no N+1). Import workspace shows **Outcomes by file** — cards with parsed / posted / near-duplicate / not-posted / open-review stats, **View in ledger** (`/transactions?sessionId=…`), **Needs review** when **`openItemsNeedingReview` > 0**.  
- **Why:** Per-file outcomes visible in one place after import.  
- **Files:** `backend/src/modules/imports/session-summary.service.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/ImportWorkspacePage.tsx`, `frontend/src/index.css`, `docs/API_IMPORT_SESSIONS.md`, `docs/CHANGE_HISTORY.md`.

### CR-020 — Epic 5.2: internal / mobile / EFT / RTP transfer memo scoring
- **Type:** CR  
- **What:** Additional **`transferPairScore`** paths: directional internal transfer memos (**74**), symmetric **mobile/app transfer** (**76**), **book transfer / EFT** (**73**), **RTP / real-time pay** (**72**), **Apple Cash / Google Pay** (**71**); ordering avoids generic `TRANSFER` swallowing specialized lines. New unit + integration tests.  
- **Why:** Fewer **`transfer_ambiguity`** rows for common bank/P2P phrasing without lowering global thresholds.  
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/canonical-ingest.test.ts`, `backend/tests/app.test.ts`.

---

## 2026-03-28

### DOC-007 — PFM competitive UX reference (Simplifi, Rocket Money, Mint)
- **Type:** DOC  
- **What:** Added **`docs/PFM_COMPETITIVE_UX_REFERENCE.md`** — analysis of public positioning/UX from [Quicken Simplifi](https://www.quicken.com/products/simplifi/), [Rocket Money](https://www.rocketmoney.com/), and [Mint](https://mint.intuit.com/) (transition to Credit Karma). **Adopt / adapt / reject** table vs self-hosted scope; backlog-friendly notes; **non-goals** (bank linking, subscription-first hero, SaaS metrics). **`docs/PROJECT_CONTEXT.md`** section + **`docs/DECISIONS_LOG.md`** **D-018**.  
- **Why:** Ground external PFM inspiration in explicit product boundaries so roadmap stays honest.  
- **Files:** `docs/PFM_COMPETITIVE_UX_REFERENCE.md`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS_LOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### CR-017 — Guest home: merged landing + sign-in (retire `/login` page)
- **Type:** CR + UX (IA)  
- **What:** **`/`** for guests is a single **hero landing** with inline **sign-in** form (fintech-style split layout: value props + credential card). Removed standalone **`LoginPage`**; **`/login`** redirects to **`/`**. **`RequireAuth`** and pages that required login now navigate to **`/`** instead of **`/login`**.  
- **Why:** One entry URL; fewer hops; aligns with common consumer finance products that combine marketing and access on one screen.  
- **PRD / backlog:** **PRD** does not mandate a separate login route; **MVP backlog** described “login” as a capability, not a dedicated route — **no PRD deviation** recorded; treat as **IA consolidation** (see **`docs/MVP_BACKLOG.md`** Epic **2.3** wording if updated).  
- **Files:** `frontend/src/pages/HomePage.tsx`, deleted `LoginPage.tsx`, `frontend/src/App.tsx`, `frontend/src/auth/RequireAuth.tsx`, `TransactionsPage.tsx`, `CategoriesPage.tsx`, `CategoryRulesPage.tsx`, `SettingsPage.tsx`, `frontend/src/index.css`, `frontend/README.md`, `README.md`, `docs/CHECKPOINT.md`.

### CR-014 — Epic 11 Story 11.5 (slice): Transactions → Needs review + ledger API
- **Type:** CR  
- **What:** **`GET /transactions`** supports optional **`resolutionType`** (with **`needsReview=true`**) using the same open-item link rules as the queue; when **`needsReview=true`**, each row includes **`openReviewItems`** (`id` + `type`) for **`POST /resolution/bulk`** / **`bulk-apply-category`**, and **`importSessionId`** when derivable from **`raw:`** **`source_ref`**. **Transactions** UI: **Needs review** tab — multi-select type filter, row checkboxes + select-all, bulk status/category, session link column; **Review queue** banner pointing at **`/transactions?needsReview=true`**.  
- **Why:** **DOC-005** / Story **11.5** — one review surface without removing **`/resolution`** yet.  
- **Superseded by CR-018:** standalone **`ResolutionQueuePage`** removed; **`/resolution`** redirects to **`/transactions?needsReview=true`**.  
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `ledger.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/TransactionsPage.tsx`, `ResolutionQueuePage.tsx` *(deleted CR-018)*, `frontend/src/index.css`, `docs/API_LEDGER.md`, `docs/MVP_BACKLOG.md`, `docs/CHANGE_HISTORY.md`.

### CR-015 — Epic 7: cash summary custom date range
- **Type:** CR  
- **What:** **`GET /reports/cash-summary`** accepts inclusive **`dateFrom`** / **`dateTo`** (`YYYY-MM-DD`, max **366** days); **`preset`** optional when both set; **`range.preset`** may be **`custom`**; prior-window comparison uses the same-length previous window (like rolling presets). **Home:** **Custom** period + from/to + **Apply**, URL sync.  
- **Why:** Epic **7.2** gap — presets-only was too limiting for analysis.  
- **Files:** `backend/src/modules/reports/cash-summary.service.ts`, `reports.routes.ts`, `backend/tests/app.test.ts`, `frontend/src/pages/DashboardPage.tsx`, `docs/API_CASH_SUMMARY.md`.

### CR-016 — Epic 5.2: transfer matcher payment / loan tokens
- **Type:** CR  
- **What:** Richer **`transferPairScore`** tokens (e-payment, loan/HELOC/mortgage cues, card networks, asymmetric **card payoff** when credit leg lacks `PAYMENT` but has incoming cues); **`transferPairScore` exported** for unit tests. Integration tests: card payoff + HELOC-style pairing.  
- **Why:** Fewer missed auto-**`transfer_group_id`** links for common payment memos without loosening generic ACH+`THANK YOU` matches.  
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/canonical-ingest.test.ts`, `backend/tests/app.test.ts`.

### FIX-004 — `POST /transactions`: TypeScript narrowing for manual create handler
- **Type:** FIX  
- **What:** **`ledger.routes.ts`** success path structured so **`tsc --noEmit`** accepts **`out.id`** after **`createManualCanonicalTransaction`**.  
- **Files:** `backend/src/modules/ledger/ledger.routes.ts`.

---

## 2026-03-27

### DOC-006 — Handoff: resume context aligned (wrap-up)
- **Type:** DOC  
- **What:** Refreshed **`README.md`** (API ledger line, Epic **11** / shell status — sidebar **Transactions**, **CR-013**), **`docs/NEXT_SESSION_PROMPT.md`** starter bullets, **`docs/PROJECT_CONTEXT.md`** recent shipped + next focus, **`docs/CHECKPOINT.md`** quick file map (**ledger** modules + **`TransactionsPage`**), **`docs/REQUIREMENTS_TRACEABILITY.md`** §13 / Epic **11** line (🟡 partial vs ⬜). Use **`CHECKPOINT.md`** + **`NEXT_SESSION_PROMPT.md`** to resume.  
- **Why:** Clean pickup after a dev session without re-deriving state from code.  
- **Files:** `README.md`, `docs/NEXT_SESSION_PROMPT.md`, `docs/PROJECT_CONTEXT.md`, `docs/CHECKPOINT.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/CHANGE_HISTORY.md`.

### DOC-005 — IA: one review surface (Transactions → Needs review); dual nav until port complete
- **Type:** DOC  
- **What:** Recorded **long-term direction:** all review work should live in **one place** — **`/transactions`**, **Needs review** tab — so items that need attention after import (and other flows) show there instead of treating **`/resolution`** as a separate product area. **Near term:** keep **Review queue** in the sidebar and both routes; backend **`needsReview`** already overlaps much of the queue definition. **Tracked follow-up:** **Epic 11 Story 11.5** in **`docs/MVP_BACKLOG.md`** — port **bulk status**, **bulk category**, type filters, duplicate/transfer/reconciliation actions, raw/session context, and dashboard deep-links; then remove or redirect **`/resolution`** and drop the extra nav item.  
- **Superseded (CR-018):** redirect **`/resolution`** → **`/transactions?needsReview=true`**, sidebar **Review queue** removed, standalone **`ResolutionQueuePage`** deleted — direction above is **done** for the primary IA; residual gaps remain in **`CHECKPOINT.md`**.  
- **Why:** User direction — single command center for transactions + review; avoid losing scope of remaining **`ResolutionQueuePage`** work.  
- **Files:** `docs/MVP_BACKLOG.md`, `docs/CHECKPOINT.md`, `docs/CHANGE_HISTORY.md`.

### CR-013 — Epic 11.2: Transactions command center (needs review, filters, manual POST)
- **Type:** CR  
- **What:** **GET `/transactions`** supports **`needsReview`**, **`search`** (substring on merchant+memo), **`amountMin` / `amountMax`**, and returns optional **`reviewReasons`** when **`needsReview=true`**. **POST `/transactions`** creates a **posted** manual canonical row (fingerprint dedupe, optional **`unknown_category`** resolution when uncategorized). **Transactions** UI: **All | Needs review** tabs, sticky filter toolbar (search, account, dates, category, **More filters** for amounts + FTS note), **Why** column on the review tab, **+ Add transaction** modal. Open resolution types for **`reviewReasons`** use a **`SELECT DISTINCT` subquery + `group_concat`** (SQLite rejects **`group_concat(DISTINCT col, sep)`**).  
- **Why:** PRD §13 — ledger as hub; one backend definition for “needs review” with visible reasons per row.  
- **Files:** `backend/src/modules/ledger/ledger.service.ts`, `ledger.routes.ts`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/index.css`, `backend/tests/app.test.ts`, `docs/API_LEDGER.md`.

### UX-007 — Epic 11.1 + 11.3 + 11.4: sidebar shell, dashboard scope, Settings
- **Type:** UX + CR (IA)  
- **What:** **Collapsible left sidebar** (collapse persisted `hf_sidebar_collapsed`), **vertical nav** (Home, **Transactions**, Categories, Review queue), **top bar** with **New import** + **Account** dropdown (**Settings** → **`/settings`**, **Sign out**). Mobile drawer + backdrop. **Home:** **Scope** strip — account dropdown at top of dashboard (removed duplicate from period row). **`/settings`** — tabbed **Profile** (stub), **Household** (**`GET/PATCH /household/settings`**), **Accounts** / **Notifications** / **Security** (stubs). User-facing **“Transactions”** replaces **“Ledger”** in nav and primary copy (**`TransactionsPage`** `<h1>`, links from Categories / Rules / Resolution / Home guest card). Removed **`AppHeader`** — replaced by **`AppSidebar`** + **`AppTopBar`**.  
- **As of CR-018:** **Review queue** is no longer a nav item; review is **Transactions → Needs review** (same **`/resolution`** APIs still used from that surface).  
- **Why:** **PRD §13** Phases A, C, D delivery slice.  
- **Files:** `frontend/src/layout/ShellLayout.tsx`, `AppSidebar.tsx`, `AppTopBar.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/pages/DashboardPage.tsx`, `TransactionsPage.tsx`, assorted link text; deleted `AppHeader.tsx`.

### DOC-004 — PRD §13 + Epic 11: Stessa-aligned shell, transactions hub, settings (phased)
- **Type:** DOC  
- **What:** **`docs/FINANCE_APP_PRD.md`** new **§13** (*Application shell, ledger hub, and settings*) — Phases **A–D** (collapsible nav, user menu, Transactions-first IA, **All \| Needs review** with one-sentence definition, sticky filters, **+ Add**, prominent dashboard account scope, **`/settings`** tabs, dual entry for savings target). **Data density** called out as intentional for analysis. **Trash** explicitly **deferred** without soft-delete. Renumbered former §13–§16 to **§14–§17**. **`docs/MVP_BACKLOG.md`** new **Epic 11** (Stories **11.1–11.4**), **P1** Trash note, dependency graph **#9**; planning note under **7.1** points to §13 / **11.4**. **`docs/CHECKPOINT.md`** Epic **11** row + key-doc link + next steps.  
- **Why:** User direction — document target IA before implementation.  

### UX-006 — Monthly savings target: slider + live safe-to-spend preview
- **Type:** UX  
- **What:** Replaced the number field with a **range** control ($0–dynamic max). **Safe to spend** and prorated commitment update **live** from the same formula as **`cash-summary.service.ts`** (`~30.437` days/month, inclusive calendar days). **Save target** is enabled only when the value differs from the server; **Clear** still **`PATCH`es** `null`.  
- **Why:** User direction — explore how the KPI moves before committing.  
- **Files:** `frontend/src/pages/DashboardPage.tsx`, `frontend/src/index.css`.

### PRD-002 — §8 Spending power + savings rate: shipped vs PRD shortcut
- **Type:** PRD  
- **Source:** `docs/FINANCE_APP_PRD.md` §8 (*Spending Power* first-release line: MTD income − MTD expense − monthly target; *Savings Rate* as ratio without rounding detail).  
- **Shipped behavior:** **Safe-to-spend** = **net for the cash-summary window** (not MTD-only) minus **monthly savings target prorated** by **inclusive calendar days ÷ ~30.437**; requires **`household.monthly_savings_target_usd`**. **Savings rate** = **(inflows − outflows) ÷ inflows** when inflows > 0, **two-decimal ratio** via `roundMoney` before UI percent. **Income/expense** in the UI = **posted inflows/outflows** for the preset (transfer exclusions per **CR-004**).  
- **Why:** One API serves rolling 30/90, calendar month, and YTD; avoids a separate “expected income” model in MVP.  
- **PRD updated:** §8 **MVP shipped formulas** + §11 **`monthly_savings_target_usd`**.  
- **Files:** `backend/src/modules/reports/cash-summary.service.ts`, `backend/src/modules/household/*`, `docs/FINANCE_APP_PRD.md`.

### UX-005 — Home KPI definitions: (i) tooltips instead of body copy
- **Type:** UX  
- **What:** Removed the always-visible **`spendingPower.explanation`** paragraph under the KPI grid. **Inflows**, **Outflows**, **Net**, **Safe to spend**, and **Savings rate** labels include a small **(i)** control; **hover** or **keyboard focus** shows a concise tooltip (see **`frontend/src/index.css`** `.kpi-info*`).  
- **Why:** User direction — definitions should feel like optional help, not clutter under the numbers.  
- **Files:** `frontend/src/pages/DashboardPage.tsx`, `frontend/src/index.css`.

### FIX-003 — Migration `0010` not applied: avoid 500 on Home / cash summary
- **Type:** FIX  
- **What:** If SQLite reports **no such column** **`monthly_savings_target_usd`**, **`getHouseholdMonthlySavingsTarget`** returns **null** so **`GET /reports/cash-summary`** still returns **200** (safe-to-spend empty). **`PATCH /household/settings`** returns **503** with **`MIGRATION_REQUIRED`** and a message to run **`npm run db:init`** with the same **`MODE`/`DB_PATH`**.  
- **Why:** Operators may start the API before applying **`0010`**; Home should not hard-fail.  
- **Files:** `backend/src/modules/household/household.service.ts`, `backend/src/modules/household/household.routes.ts`.

### CR-012 — Safe-to-spend + savings rate on cash summary (Epic 7.1)
- **Type:** CR  
- **What:** **`household.monthly_savings_target_usd`** (migration **`0010`**); **`GET/PATCH /household/settings`**; **`GET /reports/cash-summary`** includes **`spendingPower`**: prorated savings commitment for the report window (~30.437 days/month), **safe-to-spend** = net − commitment, **savings rate** = (inflows − outflows) / inflows. Home dashboard: KPI cards + target form. *(UI copy for definitions: see **UX-005**; PRD alignment: **PRD-002**.)*  
- **Why:** PRD spending-power metric with an explicit, documented formula.  
- **Files:** `backend/db/migrations/0010_household_savings_target.sql`, `backend/src/modules/household/*`, `backend/src/modules/reports/cash-summary.service.ts`, `frontend/src/pages/DashboardPage.tsx`, `docs/API_CASH_SUMMARY.md`, `docs/API_HOUSEHOLD.md`.

### DOC-003 — Docs corrected: resolution queue bulk category already shipped
- **Type:** DOC  
- **What:** At the time, **`ResolutionQueuePage.tsx`** implemented row checkboxes, **`POST /resolution/bulk-apply-category`**, and bulk status via **`POST /resolution/bulk`**. **`docs/CHECKPOINT.md`**, **`docs/MVP_BACKLOG.md`**, **`README.md`**, **`docs/REQUIREMENTS_TRACEABILITY.md`**, **`docs/NEXT_SESSION_PROMPT.md`**, **`frontend/README.md`** had incorrectly listed “bulk category” as missing.  
- **As of CR-018:** that page is **removed**; the same bulk APIs are used from **Transactions → Needs review**. **`GET /resolution`** remains for API clients.  
- **Why:** Align backlog/checkpoint with code + **`docs/API_RESOLUTION.md`**.

### DOC-002 — Epic 10 (P1) — design system, branding, UI polish in backlog
- **Type:** DOC  
- **What:** Added **`docs/MVP_BACKLOG.md`** **Epic 10** with stories: design tokens, optional light/dark (or theme toggle), screen consistency pass, lightweight **`docs/UI_BRAND.md`**. **`docs/CHECKPOINT.md`** row marks ⬜ until shipped.  
- **Why:** Track deliberate branding/beautification work instead of only ad hoc **UX-** entries in **`CHANGE_HISTORY.md`**.

### DOC-001 — Documentation reconciliation (resume context)
- **Type:** DOC  
- **What:** Aligned **`docs/CHECKPOINT.md`**, **`docs/MVP_BACKLOG.md`** (Stories 5.1, 5.2, 7.2), **`README.md`**, **`docs/PROJECT_CONTEXT.md`**, **`docs/REQUIREMENTS_TRACEABILITY.md`**, **`docs/NEXT_SESSION_PROMPT.md`**, **`docs/API_CATEGORIES.md`** with shipped behavior: **classification rules** UI + API, **transfer matcher env** tuning, **cash-summary** comparisons, resolution flows.  
- **Why:** So the next session can rely on **`CHECKPOINT.md`** + **`CHANGE_HISTORY.md`** without re-deriving state from code.

### CR-010 — Classification rules management UI
- **Type:** CR + UX  
- **What:** Authenticated page **`/categories/rules`** — list household rules, add (pattern, match type, leaf category, priority, confidence, enabled), edit row, toggle enabled. Linked from **`/categories`**. Uses **`GET/POST/PATCH /categories/rules`**.  
- **Why:** Close Epic 5.1 loop without API-only rule maintenance.  
- **Files:** `frontend/src/pages/CategoryRulesPage.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/CategoriesPage.tsx`, `frontend/src/index.css`.

### CR-011 — Transfer matcher thresholds configurable via environment
- **Type:** CR + CONFIG  
- **What:** **`MIN_AUTO_TRANSFER_PAIR_SCORE`** and multi-candidate disambiguation thresholds moved from hardcoded constants to **`backend/src/config/env.ts`** (`TRANSFER_*` variables). **`.env`** loaded from **repo root** in `env.ts` for consistent overrides.  
- **Why:** Operators can tune matcher strictness without code changes.  
- **Files:** `backend/src/config/env.ts`, `.env.example`, `backend/src/modules/canonical/canonical-ingest.service.ts`.

---

## 2025-03-25

### UX-003 — Ledger: category column density + status column
- **Type:** UX + CR  
- **What:** Removed the **Status** column from the Ledger (`TransactionsPage`) so the table is less noisy. Category control shows **one line** only: the **selected category’s own name** (leaf or parent), not “Parent / Child” stacked.  
- **Differentiation:** **Leaf** (subcategory): strong text + **blue** left accent. **Parent-only** selection: **slate** text + **neutral gray** left accent. **Uncategorized:** dashed border + muted text.  
- **Why:** User feedback — rows felt too tall; status was not useful on the ledger; single-line label matches mental model (“what I picked”) while still signaling parent vs leaf.  
- **PRD / backlog note:** `MVP_BACKLOG.md` Story 5.3 originally suggested optional “Parent › Child” display; we **deviate** from that for the ledger row **readout** (see **PRD-001**).

### UX-002 — Category picker: modal-style overlay, branding, layout
- **Type:** UX + FIX (layout)  
- **What:** Replaced in-table absolute flyout with **`createPortal` to `document.body`**, **fixed** positioning, viewport clamping, scroll/resize listeners, **dimmed backdrop** (no bleed-through from ledger rows), **three-column** layout (Groups | Subcategories | New category), **DM Sans** + refreshed global accent tokens.  
- **Why:** Prior implementation was clipped by horizontal scroll, required horizontal scroll to see actions, and looked visually thin/transparent over the table.  
- **Reference:** `frontend/src/components/LedgerCategoryPicker.tsx`, `frontend/src/index.css`, `frontend/index.html`.

### FIX-002 — Migration `0008` foreign key on fresh init
- **Type:** FIX  
- **What:** `0008_income_taxes_transfers_taxonomy.sql` inserts rows with `parent_id` = **Income** before seeds run; **migrations execute before seeds**, so Income did not exist → `SQLITE_CONSTRAINT_FOREIGNKEY` during `npm test` / `db.sh --init --seed`. Fixed by **`INSERT OR IGNORE`** for Income at the top of `0008`.  
- **Why:** Ordering invariant (migrations vs seeds) — documented so future migrations that reference seed-only parents repeat the same pattern.  
- **See also:** DB-001.

### DB-001 — Taxonomy migration `0008` (Income, Taxes, Transfers)
- **Type:** DB  
- **What:** `backend/db/migrations/0008_income_taxes_transfers_taxonomy.sql` adds Income **leaves** (Salary, Interest, Dividends, Refunds), reparents **Rental income** under Income, adds **Taxes** and **Transfers** parents + leaves. **Income parent row** must exist in migration for FK integrity.  
- **Aligned code:** `category-ids.ts`, `category-rules.ts`, tests in `category-rules.test.ts`.

### CR-004 — Cash summary: exclude transfer-linked rows from aggregates
- **Type:** CR  
- **What:** Reporting treats **transfer** rows as non-P&L for income/expense/category buckets when `transfer_group_id` is set or an open `transfer_ambiguity` resolution item targets the row. Implemented in `cash-summary.service.ts` + tests.  
- **Why:** Avoid double-counting income/expense when moving money between accounts.  
- **PRD alignment:** Matches D-006 (transfer semantics) in spirit.

### CR-003 — Transfer matcher (minimal) + ambiguity queue
- **Type:** CR  
- **What:** After canonical ingest, **minimal** pairing of debit/credit across accounts (amount match, date window, distinct accounts) sets **`transfer_group_id`**; ambiguous cases create **`resolution_item`** `type = transfer_ambiguity`.  
- **Why:** Foundation for Story 5.2; conservative automation with human escape hatch.  
- **Backlog:** `MVP_BACKLOG.md` Story 5.2 — still **partial** (not all payment patterns).

### CR-002 — Taxonomy: Income children, Taxes, Transfers
- **Type:** CR  
- **What:** Expand default taxonomy per **Income** subtypes and **Taxes** / **Transfers** groups (see DB-001). Rules map inflows to **leaf** income categories where appropriate.  
- **Why:** User direction — real-world buckets and reporting clarity.

### CR-001 — Ledger-first category UX (flyout + inline create)
- **Type:** CR  
- **What:** **`LedgerCategoryPicker`** on ledger rows: parent groups + subcategories, **Clear selection**, **`POST /categories`** for new parent or subcategory without leaving the page. **Supplements** `/categories` (not removed yet).  
- **Why:** Aligns with **D-014** — primary categorization from the ledger.  
- **See:** `frontend/src/components/LedgerCategoryPicker.tsx`, `frontend/src/pages/TransactionsPage.tsx`.

---
## 2026-03-25

### CR-009 — Transfer matcher: payment-pattern coverage + ambiguity guardrails
- **Type:** CR + FIX
- **What:** Extended transfer matching to score explicit **credit-card/loan payment** wording variants (`payment to`, `payment received`, `ach payment`, `autopay`, `loan`, etc.) while keeping conservative thresholds. Added tests for unambiguous payment pairing with date skew + memo variants, multi-candidate ambiguity queue behavior, and cash-summary exclusion for `transfer_ambiguity` rows.
- **Why:** Reduce `transfer_ambiguity` noise for common payment flows without increasing false positives.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/app.test.ts`.

### CR-005 — Resolution queue: type filter + unknown_category surfaced
- **Type:** CR + UX
- **What:** Added **resolution item type filtering** to `GET /resolution` (unknown_category, duplicate_ambiguity, transfer_ambiguity, etc.) and a **dashboard banner** that counts open `unknown_category` items and links to the queue.
- **Why:** “We don’t know this merchant” must become a first-class action path.
- **As of CR-018:** banner links target **Transactions → Needs review**; no dedicated queue page.
- **Files:** `backend/src/modules/resolution/resolution.routes.ts`, `backend/src/modules/resolution/resolution.service.ts`, `frontend/src/pages/ResolutionQueuePage.tsx` *(removed CR-018)*, `frontend/src/pages/DashboardPage.tsx`.

### UX-004 — Resolution queue: inline category assignment for unknown_category
- **Type:** UX
- **What:** For `unknown_category` rows, users can assign a category inline (using the same ledger category picker). The flow updates the linked ledger transaction (`PATCH /transactions/:id`) and resolves the resolution item.
- **Why:** Keep review + assignment in one workflow (don’t bounce between screens).
- **As of CR-018:** same flow on **Transactions → Needs review** (**`ResolutionQueuePage`** removed).
- **Files:** `frontend/src/pages/ResolutionQueuePage.tsx` *(removed CR-018)*, `frontend/src/pages/TransactionsPage.tsx` *(current)*.

### CR-006 — Transfer matcher: description/merchant+memo scoring
- **Type:** CR
- **What:** Extended the minimal transfer matcher to use **description-based scoring** (merchant/memo patterns like TRANSFER/XFER/ZELLE/WIRE/WEB PAY plus normalized description match) to pick the best match when multiple candidates exist; also widened the date tolerance slightly (still conservative).
- **Why:** Reduce the number of rows that end up as `transfer_ambiguity` while avoiding aggressive false positives.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`.

### CR-007 — Dashboard drill-down into ledger (category + account)
- **Type:** CR + UX
- **What:** Added chart/table drill-downs from the cash dashboard into the ledger:
  - Pie slices and “By category (period)” rows navigate to `/transactions` with `dateFrom/dateTo` plus `categoryId` (or `uncategorizedOnly=true`).
  - “By account” table includes a **View** link into `/transactions` with the same date window and `accountId`.
- **Why:** Connect aggregates to underlying ledger rows for fast validation and correction.
- **Files:** `frontend/src/pages/DashboardPage.tsx`.

### CR-008 — Ledger list filters: support `accountId`
- **Type:** CR
- **What:** Added `accountId` as an optional filter on `GET /transactions` so dashboard drill-down can pre-filter to a single account.
- **Files:** `backend/src/modules/ledger/ledger.routes.ts`, `backend/src/modules/ledger/ledger.service.ts`, `frontend/src/pages/TransactionsPage.tsx`.

### CR-009 — Transfer matcher hardening: anti-false-positive guardrails
- **Type:** CR + FIX
- **What:** Tightened transfer matching so generic “payment” words alone do not auto-match; matcher now requires directional complement or card/loan context for payment-style pairing. Added ambiguity telemetry (`candidateScores`) in `transfer_ambiguity.reason` JSON for easier triage/debugging.
- **Why:** Reduce false positives while preserving useful auto-match for genuine card/loan settlement flows.
- **Files:** `backend/src/modules/canonical/canonical-ingest.service.ts`, `backend/tests/app.test.ts`.

---

## PRD / design deviations (rolling)

### PRD-002 — Cash-summary safe-to-spend + savings rate vs §8 shortcut (summary)
- **Source:** `docs/FINANCE_APP_PRD.md` §8.  
- **Current behavior:** Windowed **net** minus **prorated monthly savings target**; **savings rate** from **ledger inflows/outflows** with **two-decimal** ratio rounding; **transfer exclusions** on aggregates (**CR-004**).  
- **Why:** Single reporting API for all date presets; explicit formulas in **`docs/API_CASH_SUMMARY.md`** and PRD §8 **MVP shipped formulas**.  
- **Full entry:** Dated block **PRD-002** above (2026-03-27).

### PRD-001 — Ledger category cell display vs Story 5.3 wording
- **Source:** `MVP_BACKLOG.md` Story 5.3 (optional “Parent › Child” in table).  
- **Current behavior:** **Single line** — show only the **name of the assigned `category_id`** (whether that ID is a parent or a leaf). Visual cues distinguish parent vs leaf (**UX-003**).  
- **Why:** Usability and row height; user preference.  
- **If we change later:** Drill-down or tooltip could show full path without widening rows.

---

## How to use this file

- When you ship a user-visible tweak or fix a surprising behavior, add a **short entry** with ID, **what**, **why**, and file pointers if non-obvious.  
- When a decision **contradicts** the PRD or backlog text, add or update a **PRD-** bullet here and optionally a one-line pointer in **`docs/DECISIONS_LOG.md`**.  
- **Implementation status** was summarized in **`docs/archive/CHECKPOINT.md`** (archived); this file remains the **audit trail** for shipped changes.
