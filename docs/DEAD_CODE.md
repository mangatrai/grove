# Dead code and optional features (audit notes)

## Finding unused exports

Run occasionally from the backend workspace:

```bash
cd backend && npx ts-prune
```

Review output before deleting: many entries are types or helpers marked “used in module” only, or are public API surfaces for future routes.

## Historical migrations

Older incremental SQL (pre-baseline) may still appear in **git history**; it is not shipped or executed by the app. Active schema deltas live only under [`backend/db/migrations/`](../backend/db/migrations/).
