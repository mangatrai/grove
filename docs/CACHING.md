# Client-Side Caching Architecture

**Shipped:** F-6, 2026-05-19 (CR-192); F-6b, 2026-05-20 (CR-194).

The app uses `localStorage`-based caching to avoid re-running expensive backend aggregate queries on every page navigation or tab open. There is no server-side cache layer.

---

## Why localStorage, Not sessionStorage

sessionStorage is cleared when a tab closes. For a self-hosted personal finance app that is typically opened fresh each day, sessionStorage provides no cross-session benefit. localStorage persists across sessions and is cleared only on logout or when the 7-day TTL expires.

---

## Scopes

Two independent cache scopes, each with its own integer version counter in localStorage:

| Scope | `localStorage` key | Staled by |
|---|---|---|
| `dashboard` | `hfa:v:dashboard` | Any write to `transaction_canonical` (imports, manual transactions, category edits, bulk ops) |
| `networth` | `hfa:v:networth` | Any write to `account_balance_snapshot` or `property_value_snapshot` |

---

## What Is Cached

The four high-cost queries on the Dashboard and Net Worth pages are cached. Everything else (budget, resolution summary, recurring overrides, household profile) is always fetched fresh.

| Endpoint | Cache key | Scope | TTL | Why expensive |
|---|---|---|---|---|
| `GET /reports/cash-summary` | `cash-summary:{qs}` | `dashboard` | 7 days | ~30–40 `transaction_canonical` table scans per request (current + comparison + YoY × category breakdown) |
| `GET /reports/balance-sheet/history` | `bs-history:{qs}` | `networth` | 7 days | Up to 180 sequential queries (calls full `getBalanceSheet` for each date point in the range) |
| `GET /reports/balance-sheet` (snapshot) | `bs-snapshot:{ownerScope}:{asOf}` | `networth` | **1 hour** | Joins accounts, snapshots, and properties; fires on every page load and every filter change |
| `GET /reports/balance-sheet/history?accountIds=…` (per-account expansion) | `bs-acct-history:{accountId}:{from}:{to}` | `networth` | 7 days | One call per expanded row; can be 10–20 calls if all rows are opened |

---

## Cache Entry Format

```
localStorage key:  hfa:cache:{scope}:{cacheKey}
localStorage value: JSON{ data, cachedAt: <unix ms>, version: <int> }
```

`cacheKey` includes all variant parameters (e.g. active month, date range, ownerScope filter) so different views of the same endpoint have independent entries.

A cache entry is valid if **both**:
1. `entry.version === getCacheVersion(scope)` — version counter has not been bumped since write
2. `Date.now() - entry.cachedAt <= 7 days` — TTL safety net

---

## Invalidation Map

`CACHE_INVALIDATION_MAP` in `frontend/src/cache.ts` is the single source of truth. `apiJson()` in `frontend/src/api.ts` calls `invalidateCacheByUrl(path)` after every successful non-GET response. The URL's pathname is matched against this map:

| Pattern | Scope(s) invalidated | Reason |
|---|---|---|
| `POST /imports/sessions/:id/canonicalize` | `dashboard` | New transactions inserted into `transaction_canonical` |
| `POST /imports/upload` | `dashboard` | One-shot import runs canonicalize internally |
| `POST /imports/sessions/:id/ofx-confirm` | `dashboard` | OFX one-shot: bind + parse + canonicalize |
| `POST/PATCH/DELETE /ledger/*` | `dashboard` | Create/update/delete/bulk ops on `transaction_canonical` |
| `POST/PATCH /reports/balance-sheet/manual/*` | `networth` | Manual account balance snapshot created or updated |
| `POST /household/properties/:id/values` | `networth` | Manual property value snapshot inserted |
| `POST /household/properties/:id/refresh-valuation` | `networth` | Redfin API refresh inserts new `property_value_snapshot` |

### Adding a new mutation endpoint

If you add a backend route whose writes are visible on the Dashboard or Net Worth pages, add a new entry to `CACHE_INVALIDATION_MAP` in `frontend/src/cache.ts`. The pattern must match the **pathname only** (no query string). Specify all affected scopes. The interception happens automatically in `apiJson` — no per-call-site wiring needed.

---

## Logout

`setToken(null)` in `frontend/src/api.ts` calls `clearAllCaches()`, which removes all `hfa:*` keys from localStorage. This prevents a subsequent login from seeing a previous user's cached data.

---

## The `useLocalStorageCache` Hook

```typescript
import { useLocalStorageCache } from '../hooks/useLocalStorageCache';

const { data, loading, error, lastUpdatedAt, refresh } = useLocalStorageCache(
  cacheKey,   // stable string, include all variant params
  scope,      // 'dashboard' | 'networth'
  fetcher,    // () => Promise<T>
  maxAgeMs,   // optional, default 7 days
);
```

**Behaviour:**
- On mount: checks localStorage for a valid entry → serves cached data immediately (no network request).
- If no valid cache entry: calls `fetcher()`, stores result, renders data.
- Listens to `hfa:cache-invalidate` CustomEvent (dispatched by `bumpCacheVersion` in `invalidateCacheByUrl`) so same-page mutations cause an immediate refetch without waiting for remount.
- `refresh()`: bumps the scope version counter (invalidating all entries for that scope on this device), sets `skipCache = true`, triggers a fresh fetch.

---

## Refresh UX

Each cached page has **one** refresh icon (top-right of the primary data card). Clicking it calls the hook's `refresh()`, which bumps the scope version and refetches **all** cached data for that scope on that page. A "Last updated X ago" tooltip shows when data was last fetched from the server.

There are no per-component refresh icons. All data on a page stales from the same event (a write), so page-level refresh is sufficient and less noisy.

---

## Storage Impact

Typical payload sizes:
- `GET /reports/cash-summary`: ~5 KB per month-window
- `GET /reports/balance-sheet/history` (trend chart): ~15 KB per period view
- `GET /reports/balance-sheet` (snapshot): ~10–20 KB (accounts + properties + member summary)
- `GET /reports/balance-sheet/history?accountIds=…` (per-account): ~2–3 KB each; up to ~60 KB if all rows are expanded

Worst-case for a household with 20 accounts browsing all presets: ~400 KB. localStorage allows 5–10 MB. Not a practical constraint.

---

## What Is NOT Cached

| Data | Why not cached |
|---|---|
| `GET /resolution/summary` | Should always be fresh — actionable unresolved item count |
| `GET /budget/:month` | User-editable; must reflect changes immediately |
| `GET /recurring-overrides` | User-editable |
| `GET /transactions` (ledger list) | User-filtered pagination; stale data is confusing |
| `GET /household/*` | Tiny payloads, rarely change |
