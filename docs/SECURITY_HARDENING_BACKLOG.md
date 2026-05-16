# Security hardening backlog

**Scope:** Security and correctness items deferred from pre-release review passes. Items are roughly ordered by risk for a self-hosted, single-household deployment.

---

## Shipped (v2 pre-merge — SEC-153/SEC-154, 2026-05-06)

- **SEC-153:** `storagePath` removed from export 404 response; `Math.random()` → `crypto.randomBytes()` for temp passwords; JWT_SECRET default rejected at startup in `MODE=PROD`; recurring overrides POST/DELETE restricted to owner/admin; lint fixes.
- **SEC-154:** GDrive refresh token encrypted at rest (AES-256-GCM, JWT_SECRET-derived key); OAuth scope narrowed to `drive.file` + `drive.metadata.readonly`.

---

## Shipped (2026-05-12 — I-4, I-6)

- **I-4:** Periodic purge of used/expired `password_reset_token` rows via `purgeStalePasswordResetTokens` on the existing hourly export cleanup schedule.
- **I-6:** `folderId` validated with `^[\w-]+$` before Drive API `q` interpolation in `gdrive-backup.service.ts`.

---

## Post-merge backlog

### HIGH

**AI insight cooldown: in-memory → DB-backed**
- **File:** `backend/src/modules/insights/insights.routes.ts` ~line 20
- **Issue:** The 5-minute rate-limit on OpenAI/Anthropic insight calls is tracked in `Map<householdId, timestamp>`. Resets on process restart; allows `N` requests per window across instances.
- **Fix:** Replace the Map check with a DB query: `SELECT created_at FROM insight_job WHERE household_id = ? ORDER BY created_at DESC LIMIT 1`. If `NOW() - created_at < 5 min`, return 429.
- **Why it matters:** Unbounded API cost if the server restarts frequently or if multi-instance.

---

### MEDIUM

**Login accepts 8-char passwords; change/reset requires 12 + complexity**
- **File:** `backend/src/modules/auth/auth.routes.ts`
- **Issue:** Login body schema uses `.min(8)` but the `PASSWORD_STRENGTH_REGEX` enforces 12+ chars with complexity. Users who set passwords before the strength policy was introduced can still log in but can't change their password without meeting the stronger rules.
- **Fix (optional):** Set `force_password_change = true` retroactively for all users whose passwords pre-date the strength policy introduction, OR document this as intentional backward compat.

**Insight cooldown: also a good time to add DB-backed `insight_job` table**
- Related to the HIGH item above. If/when a proper `insight_job` table is added, the in-memory cooldown and any polling/status checks should be migrated to use it.

---

### LOW

**Export TTL hours interpolated into SQL INTERVAL**
- **File:** `backend/src/modules/export/export-job.service.ts` ~line 243
- **Issue:** `INTERVAL '${EXPORT_TTL_HOURS} hours'` uses template literal interpolation. `EXPORT_TTL_HOURS` is a hardcoded constant so there is no real injection risk, but it's a copy-paste anti-pattern.
- **Fix:** Use `INTERVAL '1 hour' * $1` and pass `EXPORT_TTL_HOURS` as a parameter, or just document the constant as trusted.

**No automated test coverage report**
- `vitest --coverage` is not wired into any `package.json` script. There is no coverage gate in CI.
- **Fix:** Add `vitest run --coverage` as an optional script (not a default test blocker). Set a threshold once a baseline is measured.

---

## Acknowledged / accepted risk (self-hosted context)

| Item | Why accepted |
|------|-------------|
| Refresh token scope: existing `drive`-scoped tokens still work | New flows use narrow scope; re-auth optional for existing users |
| `DEFAULT_MEMBER_PASSWORD = "ChangeMe123!"` | `force_password_change` is set; shown in admin UI; self-hosted context |
| No HttpOnly cookie for JWT | JWT in Authorization header is the current pattern; cookie migration is a larger refactor (tracked in prior SEC backlog) |
| Multi-instance insight cooldown | Single-instance self-hosted deployment is the target; acceptable until a proper insight_job table is added |
