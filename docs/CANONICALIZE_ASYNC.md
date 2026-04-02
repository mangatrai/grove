# Async / background canonicalize (design)

**Status:** Design only — not implemented in the API yet. Tracking: GitHub [#14](https://github.com/mangatrai/household-finance-app/issues/14).

## Problem

Canonicalize + OpenAI can take **many minutes** on large imports. A synchronous HTTP request ties up the client and risks timeouts even when the server is healthy.

## Goal

1. Client **starts** canonicalize and receives a **job id** quickly.
2. A **worker** (same Node process with a poller, or a separate worker) runs canonicalize + AI.
3. Client **polls** job status (or uses SSE/WebSocket later).
4. On success, the user **reviews** summary (inserted, duplicates, review queue count) and chooses **finalize** or **rollback** (exact semantics depend on product: e.g. rollback deletes canonical rows and resolution items for that session only).

## Suggested data model

- Extend **`import_session`** (or add **`canonicalize_job`**) with: `canonicalize_status` (`idle` | `queued` | `running` | `succeeded` | `failed`), `canonicalize_error`, `canonicalize_started_at`, `canonicalize_finished_at`, optional **progress** JSON (batches completed, rows inserted).
- **Idempotency:** Re-running canonicalize for the same session should be safe (existing fingerprint dedupe already helps).

## API sketch

- `POST /imports/sessions/:id/canonicalize` → **202** `{ jobId }` or inline **200** when sync mode flag is set.
- `GET /imports/sessions/:id/canonicalize/status` → `{ status, error?, progress?, outcome? }`.

## UI sketch

- Import workspace shows **spinner** + **poll**; on completion, show counts and **Finalize** / **Rollback** (if rollback is supported).

## Risks

- Partial failure mid-session (retry policy, user messaging).
- Concurrent canonicalize requests for the same session (serialize with a lock or status check).

Implementation should follow after **batching + parallelism** in [`docs/AI_CATEGORIZATION.md`](AI_CATEGORIZATION.md) are tuned.
