# Epic 12/13 Execution Plan (docs-only)

**Scope:** plan implementation of **Epic 12** (identity/profile/membership/ownership) and **Epic 13** (credentials/security lifecycle) without expanding into unrelated product areas.

**Decision anchor:** Option B is locked — separate **`user_account`** (auth) and **`person_profile`** (human profile), connected through household membership.

---

## 1) Guardrails to keep this small

- Do **not** redesign ingestion, ledger, or dashboard logic in this initiative.
- Ship the minimum schema and API required for Settings **Profile / Household / Accounts / Security** to become real.
- Keep a compatibility bridge for current household-level employer settings until person-owned employer model is migrated.
- Air-gapped first: no external email/SMS dependency required for core onboarding.

---

## 2) Dependency order (must-follow)

1. **Data model foundation (Epic 12.1, 12.2)**  
   `user_account`, `person_profile`, `household_membership` boundaries and constraints.
2. **Auth migration baseline (Epic 13.1)**  
   DB-backed credentials before introducing deeper profile/membership UX.
3. **Settings Profile/Household surfaces (Epic 12.3)**  
   Manage profile + household membership from UI/API.
4. **Ownership attribution fields (Epic 12.4)**  
   Add person references to accounts/files/payslips/transactions and expose assign/filter paths.
5. **Employer ownership refactor (Epic 12.5)**  
   Move employer/parser mapping to person-owned structure with fallback compatibility.
6. **Security self-service (Epic 13.2)**  
   Change password/session invalidation on top of DB-backed auth.
7. **Manual member onboarding flow (Epic 13.3)**  
   Air-gapped invite/add-member lifecycle.

**Hard rule:** do not start 12.4/12.5 until 12.1/12.2 + 13.1 are stable.

---

## 3) Phase-by-phase plan

## Phase A — Identity foundation + auth cutover
**Includes:** 12.1 + 12.2 + 13.1 (minimal slice)  
**Goal:** establish clean schema boundaries and remove `.env` as normal runtime auth source.

### Deliverables
- Schema and migration plan for:
  - `user_account` (auth identity, credential hash, status)
  - `person_profile` (name, phone, avatar/icon, contact metadata)
  - `household_membership` (household, person, role, relationship)
- DB-backed login path with bootstrap-first-user path for fresh installs.
- Compatibility notes for existing auth/session behavior.

### Exit criteria
- Existing login still works after migration path.
- New schema supports profile-only members (no login required).
- Docs updated for setup/bootstrap and rollback notes.

---

## Phase B — Settings Profile + Household management
**Includes:** 12.3  
**Goal:** make Settings useful for household setup and member management.

### Deliverables
- Profile tab API/UI: name, email/contact, phone, avatar/icon selection.
- Household tab API/UI: create/rename household, add member profiles, set role/relationship.
- Minimal validation for duplicates and role constraints (one head of household policy if chosen).

### Exit criteria
- User can complete initial household setup from Settings.
- Member roster is editable and persisted.

---

## Phase C — Ownership attribution + employer migration
**Includes:** 12.4 + 12.5  
**Goal:** align ownership semantics to person profile and remove household-employer ambiguity.

### Deliverables
- Person attribution columns/relations on:
  - accounts
  - import files
  - payslip snapshots
  - canonical transactions
- Assign/filter support in APIs needed by Settings + import/transactions touchpoints.
- Employer/parser ownership moved to person; household-level fields retained only as migration fallback.

### Exit criteria
- Statements/transactions can be tagged to a specific person profile.
- Employer parser selection is person-owned, not household-generic.

---

## Phase D — Security self-service + onboarding hardening
**Includes:** 13.2 + 13.3  
**Goal:** finish account lifecycle in air-gapped mode.

### Deliverables
- Security tab: change password flow.
- Session/token invalidation policy on password change.
- Manual invite/add-member account creation flow for offline environments.

### Exit criteria
- User can rotate credentials from UI.
- Household admin can onboard member accounts without external services.

---

## 4) First two sprints (constrained scope)

## Sprint 1 (2 weeks) — Foundation only
**In scope**
- Epic 12.1 + 12.2 schema/API groundwork.
- Epic 13.1 DB-backed credential baseline.
- Docs/runbook updates for bootstrap/migration.

**Out of scope**
- Ownership attribution on transactions/accounts.
- Employer migration.
- Security tab UX.

**Sprint 1 definition of done**
- Login no longer depends on static `.env` for normal operation.
- Profile-only household members are representable in DB.
- No regressions in existing household-scoped authorization paths.

## Sprint 2 (2 weeks) — Settings profile/household + minimal security
**In scope**
- Epic 12.3 Profile + Household tabs functional.
- Epic 13.2 minimal change-password endpoint + UI wiring.
- Validation and UX polish for member role/relationship editing.

**Out of scope**
- Full ownership attribution roll-out (12.4).
- Employer ownership refactor (12.5).
- Full invite lifecycle (13.3).

**Sprint 2 definition of done**
- User can set profile details and manage household member roster in Settings.
- User can change password via Security tab.

---

## 5) Risks and mitigation

- **Migration risk:** auth and membership schema changes can break current login.
  - **Mitigation:** staged migrations + fallback bootstrap path + explicit smoke checklist.
- **Scope creep risk:** ownership attribution touches many modules.
  - **Mitigation:** defer 12.4 to Phase C after Settings core is stable.
- **Product confusion risk:** employer data currently lives under household settings.
  - **Mitigation:** keep transitional compatibility and explicit deprecation notes.

---

## 6) Acceptance checkpoints by milestone

- **Checkpoint A:** schema/auth baseline complete, no login regression.
- **Checkpoint B:** Settings Profile/Household usable end-to-end.
- **Checkpoint C:** ownership attribution live for targeted records.
- **Checkpoint D:** Security + onboarding complete for air-gapped operations.
