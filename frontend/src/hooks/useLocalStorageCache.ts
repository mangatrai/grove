import { useCallback, useEffect, useRef, useState } from "react";
import { bumpCacheVersion, type CacheScope, readCache, writeCache } from "../cache";

/** 7-day default TTL — safety net; real invalidation is version-counter based. */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CacheResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** When the cached data was last fetched from the server. Null while loading. */
  lastUpdatedAt: Date | null;
  /**
   * Force a fresh fetch regardless of cache state. Also bumps the scope version
   * counter so all other hooks sharing this scope on the same page refetch too.
   */
  refresh: () => void;
}

/**
 * Caches the result of `fetcher` in localStorage under `cacheKey`.
 *
 * Cache is served on subsequent mounts until:
 *   - The scope version counter is bumped (by a write to a relevant endpoint — see cache.ts)
 *   - The entry exceeds `maxAgeMs` (default 7 days)
 *   - `refresh()` is called explicitly
 *
 * Same-page hooks are notified via the `hfa:cache-invalidate` CustomEvent so
 * they refetch immediately when a write on the same page bumps their scope.
 *
 * @param cacheKey  Stable string key unique to this data slice (include all variant params).
 * @param scope     'dashboard' or 'networth' — determines which version counter to watch.
 * @param fetcher   Async function that returns fresh data.
 * @param maxAgeMs  Max cache age in ms. Default: 7 days.
 */
export function useLocalStorageCache<T>(
  cacheKey: string,
  scope: CacheScope,
  fetcher: () => Promise<T>,
  maxAgeMs = DEFAULT_MAX_AGE_MS
): CacheResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  // fetchTick triggers the effect; skipCacheRef signals whether to bypass the cache.
  const [fetchTick, setFetchTick] = useState(0);
  const skipCacheRef = useRef(false);

  // Always call the latest fetcher without needing it as a dep.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Listen for same-page cache-invalidate events (fired by invalidateCacheByUrl in api.ts).
  useEffect(() => {
    function onInvalidate(e: Event) {
      const evt = e as CustomEvent<{ scope: CacheScope }>;
      if (evt.detail.scope === scope) {
        skipCacheRef.current = true;
        setFetchTick((t) => t + 1);
      }
    }
    window.addEventListener("hfa:cache-invalidate", onInvalidate);
    return () => window.removeEventListener("hfa:cache-invalidate", onInvalidate);
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    const shouldSkipCache = skipCacheRef.current;
    skipCacheRef.current = false;

    async function load() {
      setLoading(true);
      setError(null);

      if (!shouldSkipCache) {
        const cached = readCache<T>(cacheKey, scope, maxAgeMs);
        if (cached) {
          setData(cached.data);
          setLastUpdatedAt(new Date(cached.cachedAt));
          setLoading(false);
          return;
        }
      }

      try {
        const result = await fetcherRef.current();
        if (cancelled) return;
        writeCache(cacheKey, scope, result);
        setData(result);
        setLastUpdatedAt(new Date());
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // fetchTick + cacheKey + scope + maxAgeMs drive re-fetches.
    // fetcher is intentionally excluded (kept in ref to avoid re-fetch on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, scope, maxAgeMs, fetchTick]);

  const refresh = useCallback(() => {
    bumpCacheVersion(scope);
    skipCacheRef.current = true;
    setFetchTick((t) => t + 1);
  }, [scope]);

  return { data, loading, error, lastUpdatedAt, refresh };
}
