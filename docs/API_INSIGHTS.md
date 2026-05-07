# API — Insights

All routes require `Authorization: Bearer <JWT>`.

## Endpoints

- `GET /insights/financial` — latest generated insight for caller scope (`household` for owner/admin, `personal` for member), or `null` when absent.
- `POST /insights/financial/refresh` — enqueue asynchronous insight generation (`202 { ok, jobId }`).
- `GET /insights/financial/status/:jobId` — poll async job state (`queued|running|complete|failed`).
- `GET /insights/financial/history?limit=&offset=` — paginated history for caller scope.
- `GET /insights/financial/:id` — fetch one historical insight by id.

## Response contract

- Success responses follow service envelope: `{ ok: true, data: ... }`.
- `POST /insights/financial/refresh` returns `{ ok: true, jobId }`.
- Validation failures use `400 { errors: z.issues }` for path/query/body parse errors.
- Missing resources return `{ ok: false, code: "NOT_FOUND", message: "..." }`.
- Refresh endpoint uses server-side rate limiting (one refresh per household every 5 minutes) and can return:
  - `429 { ok: false, code: "RATE_LIMITED", message, retryAfterMs }`

## Scope logic

- Owner/admin callers always read and generate `scope = household` insights.
- Member callers always read and generate `scope = personal` insights for their own `userId`.
- Scope is enforced server-side and cannot be overridden by client payload.

## Polling contract

1. Call `POST /insights/financial/refresh`.
2. Read `jobId` from the `202` response.
3. Poll `GET /insights/financial/status/:jobId` until:
   - `status = complete` -> use `insightId` or call `GET /insights/financial`.
   - `status = failed` -> display `errorText` and allow retry.
4. Optional: show history with `GET /insights/financial/history`.

## Insight payload fields

`InsightPayload` includes:

- `healthRating` — `strong | on_track | needs_attention | at_risk`
- `healthRationale` — concise top-level explanation
- `localBenchmark` — local comparison narrative
- `nationalBenchmark` — national comparison narrative
- `whatsWorking` — strengths list
- `concerns` — risk/attention list
- `spendingAnalysis` — spending-pattern observations
- `investmentGaps` — investing or savings gap observations
- `nextSteps` — concrete next-step recommendations

## Privacy contract

The LLM prompt includes only anonymized aggregates and profile/demographic fields.
No names, emails, account numbers, or raw transaction descriptions are sent.
