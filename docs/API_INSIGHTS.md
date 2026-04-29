# API — Insights

All routes require `Authorization: Bearer <JWT>`.

## Endpoints

- `GET /insights/financial` — returns latest generated insight for caller scope (`household` for owner/admin, `personal` for member), or `null` when absent.
- `POST /insights/financial/refresh` — enqueues asynchronous generation and returns `202 { ok, jobId }`.
- `GET /insights/financial/status/:jobId` — poll async job status (`queued|running|complete|failed`).
- `GET /insights/financial/history?limit=&offset=` — paginated history for caller scope.
- `GET /insights/financial/:id` — read a specific historical insight row by id.

## Response contract

- Success responses follow service envelope: `{ ok: true, data: ... }`.
- `POST /insights/financial/refresh` returns `{ ok: true, jobId }`.
- Validation failures use `400 { errors: z.issues }` for path/query/body parse errors.
- Missing resources return `{ ok: false, code: "NOT_FOUND", message: "..." }`.

## Privacy contract

The LLM prompt includes only anonymized aggregates and profile/demographic fields.
No names, emails, account numbers, or raw transaction descriptions are sent.
