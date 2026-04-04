# Dead code and optional features (audit notes)

## AI categorization

OpenAI-backed suggestions after deterministic rules remain **optional** and **off by default** (`AI_CATEGORY_ENABLED=false`). The code path is covered by tests (`category-ai-batch.test.ts`) and is intentionally retained for households that want model-assisted labeling.

## Finding unused exports

Run occasionally from the backend workspace:

```bash
cd backend && npx ts-prune
```

Review output before deleting: many entries are types or helpers marked “used in module” only, or are public API surfaces for future routes.

## Historical migrations

Pre-baseline incremental SQL lives in [`backend/db/migrations_archive/`](../backend/db/migrations_archive/) and is not executed by the app.
