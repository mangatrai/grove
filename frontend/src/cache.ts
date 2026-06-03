/**
 * Client-side localStorage cache infrastructure.
 *
 * Two scopes: 'dashboard' and 'networth'. Each scope has an integer version
 * counter in localStorage. Any successful non-GET mutation to a relevant
 * endpoint bumps that counter via invalidateCacheByUrl(). Cache entries embed
 * the version at write-time; a version mismatch means the entry is stale.
 *
 * See docs/CACHING.md for the full design, scope map, and invalidation rules.
 */

export type CacheScope = "dashboard" | "networth" | "recurring";

const NS = "hfa";

/**
 * URL pattern → scope(s) that are invalidated when that endpoint is mutated
 * (any non-GET method with a 2xx response).
 *
 * IMPORTANT: add an entry here whenever a new write endpoint is added whose
 * effect is visible on the Dashboard or Net Worth page. See docs/CACHING.md
 * §Invalidation Map for the full rationale per entry.
 */
export const CACHE_INVALIDATION_MAP: Array<{ pattern: RegExp; scopes: CacheScope[] }> = [
  // ── Dashboard scope ────────────────────────────────────────────────────────
  // Import canonicalize — new transactions land in transaction_canonical
  { pattern: /^\/imports\/sessions\/[^/]+\/canonicalize$/, scopes: ["dashboard"] },
  // One-shot upload (runs parse + canonicalize internally)
  { pattern: /^\/imports\/upload$/, scopes: ["dashboard"] },
  // OFX one-shot confirm (bind + parse + canonicalize in one call)
  { pattern: /^\/imports\/sessions\/[^/]+\/ofx-confirm$/, scopes: ["dashboard"] },
  // Any ledger mutation: create, update category/memo, bulk ops, delete
  { pattern: /^\/ledger(\/|$)/, scopes: ["dashboard"] },

  // ── Net Worth scope ────────────────────────────────────────────────────────
  // NOTE: /reports/balance-sheet/manual is intentionally NOT here — balance row
  // saves use apiFetch (no auto-invalidation) so the user can edit multiple
  // accounts without triggering a page reload after each save. The Refresh
  // button on the Net Worth page triggers the reload when the user is done.
  // Property value snapshot (manual entry)
  { pattern: /^\/household\/properties\/[^/]+\/values$/, scopes: ["networth"] },
  // Property valuation refresh (calls Redfin API, inserts new snapshot)
  { pattern: /^\/household\/properties\/[^/]+\/refresh-valuation$/, scopes: ["networth"] },
];

// ── Version counter ──────────────────────────────────────────────────────────

function versionKey(scope: CacheScope): string {
  return `${NS}:v:${scope}`;
}

export function getCacheVersion(scope: CacheScope): number {
  const v = parseInt(localStorage.getItem(versionKey(scope)) ?? "0", 10);
  return isNaN(v) ? 0 : v;
}

export function bumpCacheVersion(scope: CacheScope): void {
  const next = getCacheVersion(scope) + 1;
  localStorage.setItem(versionKey(scope), String(next));
  // Notify any same-page hooks that are listening so they can refetch immediately.
  window.dispatchEvent(new CustomEvent("hfa:cache-invalidate", { detail: { scope } }));
}

// ── URL-based invalidation (called from api.ts after every successful write) ─

export function invalidateCacheByUrl(path: string): void {
  let pathname: string;
  try {
    pathname = new URL(path, "http://x").pathname;
  } catch {
    pathname = path.split("?")[0] ?? path;
  }

  const toInvalidate = new Set<CacheScope>();
  for (const { pattern, scopes } of CACHE_INVALIDATION_MAP) {
    if (pattern.test(pathname)) {
      scopes.forEach((s) => toInvalidate.add(s));
    }
  }
  toInvalidate.forEach(bumpCacheVersion);
}

// ── Logout / session clear ───────────────────────────────────────────────────

/** Clear all hfa:* keys from localStorage. Used in tests to reset state. */
export function clearAllCaches(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(`${NS}:`)) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

// ── Read / write ─────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  version: number;
}

function entryKey(cacheKey: string, scope: CacheScope): string {
  return `${NS}:cache:${scope}:${cacheKey}`;
}

export function readCache<T>(
  cacheKey: string,
  scope: CacheScope,
  maxAgeMs: number
): { data: T; cachedAt: number } | null {
  try {
    const raw = localStorage.getItem(entryKey(cacheKey, scope));
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw) as CacheEntry<T>;
    if (entry.version !== getCacheVersion(scope)) return null;
    if (Date.now() - entry.cachedAt > maxAgeMs) return null;
    return { data: entry.data, cachedAt: entry.cachedAt };
  } catch {
    return null;
  }
}

export function writeCache<T>(cacheKey: string, scope: CacheScope, data: T): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      cachedAt: Date.now(),
      version: getCacheVersion(scope),
    };
    localStorage.setItem(entryKey(cacheKey, scope), JSON.stringify(entry));
  } catch {
    // localStorage quota exceeded or unavailable — silently skip caching
  }
}
