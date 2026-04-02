# AI categorization (canonicalize)

## Status

**Primary categorization** is **deterministic**: household `category_rule` rows, then **built-in keyword rules** in code. **OpenAI categorization is optional and experimental** — keep `AI_CATEGORY_ENABLED` off for production unless you explicitly want model suggestions (slower, non-deterministic, costs tokens).

## What runs when

If **`AI_CATEGORY_ENABLED`** is set and **`OPENAI_API_KEY`** is present, after **deterministic category rules** (`classifyWithRules`) any row still **without** a category is sent to OpenAI in **batches**. Code: [`backend/src/modules/category/category-ai.service.ts`](../backend/src/modules/category/category-ai.service.ts), wired from [`backend/src/modules/canonical/canonical-ingest.service.ts`](../backend/src/modules/canonical/canonical-ingest.service.ts).

## Why log lines do not always show `AI_CATEGORY_BATCH_SIZE` transactions

The env value is the **maximum** rows per **single** HTTP request, not a guarantee every call has that many.

1. **Contiguous AI runs** — The importer builds an ordered queue of rows. Consecutive **uncategorized** rows are grouped into one **AI run** and split into chunks of up to **`AI_CATEGORY_BATCH_SIZE`**. You no longer flush the buffer on every rule-matched row, so runs are typically **larger** than before (fewer tiny batches).
2. **Last chunk** — The final chunk of a run is often **smaller** than the batch size.
3. **Prompt size** — If the JSON payload would exceed an internal limit (~100k chars), a batch is **split** recursively; a request may then include **fewer** rows than the batch size.
4. **Parallel waves** — With **`AI_CATEGORY_MAX_PARALLEL` > 1**, multiple requests run at once; each line in the log is still **one** HTTP call (its `txn(s)` count is that call’s size).

## Confidence and auto-apply

- **`confidence`** is **returned by the model**; the app only clamps it to `0..1`. It is **not** computed locally.
- **`AI_CATEGORY_AUTO_APPLY_MIN`** (default **0.9**): auto-assign only if the suggestion’s category id is valid **and** `confidence` is at or above this. Lower values (e.g. **0.7**) reduce the review queue but **increase wrong auto-labels**.
- **`AI_CATEGORY_REVIEW_MIN`** (default **0.6**): minimum confidence to embed AI in the **resolution item** `reason` JSON for review UI.

See [`docs/ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) for all related env vars.

## Performance

- **`AI_CATEGORY_BATCH_SIZE`** — Fewer round-trips when larger (watch token limits).
- **`AI_CATEGORY_MAX_PARALLEL`** — Concurrent OpenAI requests for **different** chunks of the same contiguous AI run (default **1**). Increase cautiously to avoid **429** rate limits.
- **`OPENAI_MODEL`** — Faster/cheaper models may trade quality; validate on your statements.

Total model time is dominated by **API latency**; see [`docs/CANONICALIZE_ASYNC.md`](CANONICALIZE_ASYNC.md) for a **background job** pattern that improves **perceived** UX without reducing total tokens (issue [#12](https://github.com/mangatrai/household-finance-app/issues/12)).

**Future:** Pass **account type** (checking vs credit card) into the batch payload — [#13](https://github.com/mangatrai/household-finance-app/issues/13).

## Debugging

- Set **`LOG_LEVEL=debug`** to emit **truncated** request/response details from category-AI (see **`LOG_AI_DEBUG_BODY_MAX_CHARS`**). Payloads may contain **PII** — use only in trusted environments.

## Payload sent to the model

Each transaction includes **`transactionId`**, **`normalizedDescription`**, **`signedAmount`**, and **`direction`** (`credit` / `debit`). Leaf categories are sent as **`id`** + **`name`** (see service code for the exact JSON shape).
