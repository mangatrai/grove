# Multi-household and invite-code backlog

## Context

The RBAC redesign (CR-109, 2026-04-15) surfaced a structural constraint: today one
`app_user` belongs to exactly one household (`app_user.household_id` is a single
column). A user cannot be a member of two households with the same login.

The correct long-term shape is already partially in place:
`person_profile.linked_user_id` models "a financial entity in *a specific household*
linked to a login identity." Only `app_user` itself is the wrong shape.

---

## Current schema constraint

```
app_user
  household_id TEXT NOT NULL REFERENCES household(id)   ← single household
  role TEXT                                             ← role within that household
```

To support multiple households per user, `household_id` and `role` must move off
`app_user` and into a join table, e.g. `user_household_membership`:

```
user_household_membership
  user_id         → app_user.id
  household_id    → household.id
  role            TEXT  (owner | admin | member)
  joined_at       TIMESTAMPTZ
  PRIMARY KEY (user_id, household_id)
```

`app_user` would then only carry login identity: `email`, `password_hash`,
`token_version`. The JWT payload would need to include the *active* household
(selected at login or switchable post-login).

---

## Deferred features

### 1. Invite-code join flow
A user who has a login but no linked `person_profile` in any household currently
sees a "not part of any household" screen. Long-term:
- Household admin generates an invite code (short-lived token, e.g. 72 h).
- New user enters code on first login → automatically linked as a `person_profile`
  member of that household.
- Invite codes live in a new `household_invite` table (code, household_id, role,
  expires_at, used_at).

### 2. Create-your-own household
From the same "no household" screen, offer "Create a new household." Creates a new
`household` row and makes the current user the `owner`.

### 3. Switch active household (multi-household UX)
Once a user can belong to multiple households, the top bar needs a household
switcher. The JWT can carry `householdId` for the *active* household; switching
issues a new short-lived token scoped to the selected household.

---

## Email as canonical identity

`app_user.email` is unique today and is the right unique identity anchor.
When adding someone as a `person_profile` to a household, look up an existing
`app_user` by email first. If found, link `person_profile.linked_user_id` to that
user (after confirmation). This avoids duplicate accounts for the same person across
households.

---

## Migration path (when this ships)

1. Add `user_household_membership` table.
2. Backfill from existing `app_user.household_id` + `app_user.role`.
3. Drop `app_user.household_id` and `app_user.role` columns (or rename and keep as
   deprecated for one release).
4. Update JWT generation and `verifyToken` to include `householdId` from the
   membership table (active household).
5. Update all service-layer queries that filter by `household_id` — no change needed
   since the value is already carried in the JWT; only the *source* of that value
   changes.

**Why it is deferred:** The RBAC model (CR-109) already works correctly for a
single-household deployment, which is the target use case (self-hosted, one family).
The migration is additive but touches auth, JWT, and every service query. Not worth
the risk for v1.
