# API documentation index

**Source of truth for routes:** [`openapi/openapi.yaml`](../openapi/openapi.yaml) (OpenAPI 3.1).

**Topic guides** (prose behavior and examples): [`API_HOUSEHOLD.md`](API_HOUSEHOLD.md), [`API_HOUSEHOLD_PROFILE.md`](API_HOUSEHOLD_PROFILE.md), [`API_IMPORT_SESSIONS.md`](API_IMPORT_SESSIONS.md), [`API_LEDGER.md`](API_LEDGER.md), [`API_CATEGORIES.md`](API_CATEGORIES.md), [`API_CASH_SUMMARY.md`](API_CASH_SUMMARY.md), [`API_BALANCE_SHEET.md`](API_BALANCE_SHEET.md), [`API_RESOLUTION.md`](API_RESOLUTION.md), [`API_EXPORTS.md`](API_EXPORTS.md), [`API_BUDGET.md`](API_BUDGET.md), [`API_RECURRING.md`](API_RECURRING.md), [`API_INSIGHTS.md`](API_INSIGHTS.md), [`API_GDRIVE.md`](API_GDRIVE.md).


## Auth routes

- `POST /auth/login` — Returns `{ token, forcePasswordChange }`. When `forcePasswordChange` is true, the client should not render the main app shell before handing off to reset-password (same flag as `GET /auth/me`).
- `POST /auth/setup-forced-change-token` — **Requires auth.** When `force_password_change` is true for the current user, returns `{ token }` (raw one-time reset token, same TTL as email reset). **403** with `code: NOT_FORCED` if the flag is not set. Used by the shell to redirect into the existing reset-password flow after clearing the JWT.

## Google Drive routes

Prose: [`API_GDRIVE.md`](API_GDRIVE.md).

- `GET /gdrive/status` — owner or admin. Returns `{ connected: bool, folderId?, folderName?, connectedAt?, connectedByUserId?, lastVerifiedAt?, lastError? }`. The service account key is never returned. `connectedByUserId` may be `null` after the connecting user is removed (audit FK `ON DELETE SET NULL`).
- `POST /gdrive/connect` — owner only. Body: `{ serviceAccountKeyJson: string, folderId: string }`. Validates key format, calls the Drive API to confirm folder access, then persists credentials. **422** with `code: DRIVE_CONNECTION_FAILED` when the Drive test fails. **429** when connect is rate-limited.
- `DELETE /gdrive/disconnect` — owner only. Removes stored credentials.

## Insights routes

- `GET /insights/financial`
- `POST /insights/financial/refresh`
- `GET /insights/financial/status/{jobId}`
- `GET /insights/financial/history`
- `GET /insights/financial/{id}`
