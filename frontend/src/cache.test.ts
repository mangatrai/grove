import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bumpCacheVersion,
  CACHE_INVALIDATION_MAP,
  clearAllCaches,
  getCacheVersion,
  invalidateCacheByUrl,
  readCache,
  writeCache,
  type CacheScope,
} from "./cache.js";

// ── localStorage mock ─────────────────────────────────────────────────────────

function makeMockLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
    _store: store,
  };
}

let mockStorage: ReturnType<typeof makeMockLocalStorage>;

beforeEach(() => {
  mockStorage = makeMockLocalStorage();
  vi.stubGlobal("localStorage", mockStorage);
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Version counter ───────────────────────────────────────────────────────────

describe("getCacheVersion", () => {
  it("returns 0 when no version stored", () => {
    expect(getCacheVersion("dashboard")).toBe(0);
  });

  it("returns the stored integer", () => {
    mockStorage._store["hfa:v:dashboard"] = "5";
    expect(getCacheVersion("dashboard")).toBe(5);
  });

  it("returns 0 when stored value is non-numeric", () => {
    mockStorage._store["hfa:v:dashboard"] = "bad";
    expect(getCacheVersion("dashboard")).toBe(0);
  });

  it("tracks dashboard and networth independently", () => {
    mockStorage._store["hfa:v:dashboard"] = "3";
    mockStorage._store["hfa:v:networth"] = "7";
    expect(getCacheVersion("dashboard")).toBe(3);
    expect(getCacheVersion("networth")).toBe(7);
  });
});

describe("bumpCacheVersion", () => {
  it("increments from 0 to 1", () => {
    bumpCacheVersion("dashboard");
    expect(getCacheVersion("dashboard")).toBe(1);
  });

  it("increments from an existing value", () => {
    mockStorage._store["hfa:v:dashboard"] = "4";
    bumpCacheVersion("dashboard");
    expect(getCacheVersion("dashboard")).toBe(5);
  });

  it("does not affect the other scope", () => {
    mockStorage._store["hfa:v:networth"] = "2";
    bumpCacheVersion("dashboard");
    expect(getCacheVersion("networth")).toBe(2);
  });

  it("dispatches hfa:cache-invalidate custom event with the scope", () => {
    bumpCacheVersion("networth");
    const dispatchMock = window.dispatchEvent as ReturnType<typeof vi.fn>;
    expect(dispatchMock).toHaveBeenCalledOnce();
    const event = dispatchMock.mock.calls[0]?.[0] as CustomEvent<{ scope: CacheScope }>;
    expect(event.type).toBe("hfa:cache-invalidate");
    expect(event.detail.scope).toBe("networth");
  });
});

// ── readCache / writeCache ────────────────────────────────────────────────────

describe("writeCache + readCache round-trip", () => {
  it("stores and retrieves data", () => {
    writeCache("test-key", "dashboard", { amount: 42 });
    const result = readCache<{ amount: number }>("test-key", "dashboard", 60_000);
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ amount: 42 });
  });

  it("returns null when no entry exists", () => {
    const result = readCache("missing-key", "dashboard", 60_000);
    expect(result).toBeNull();
  });

  it("returns null when version counter was bumped since write", () => {
    writeCache("versioned-key", "dashboard", { ok: true });
    bumpCacheVersion("dashboard"); // invalidate
    const result = readCache<{ ok: boolean }>("versioned-key", "dashboard", 60_000);
    expect(result).toBeNull();
  });

  it("returns null when entry exceeds maxAgeMs", () => {
    writeCache("old-key", "dashboard", { value: 1 });
    // Backdate the cachedAt timestamp so the entry looks 10 seconds old,
    // then read with a 5-second TTL — should be null (expired).
    const storageKey = "hfa:cache:dashboard:old-key";
    const raw = JSON.parse(mockStorage._store[storageKey]!) as { cachedAt: number };
    raw.cachedAt = Date.now() - 10_000;
    mockStorage._store[storageKey] = JSON.stringify(raw);
    const result = readCache<{ value: number }>("old-key", "dashboard", 5_000);
    expect(result).toBeNull();
  });

  it("returns null when localStorage contains invalid JSON", () => {
    mockStorage._store["hfa:cache:dashboard:bad-json"] = "{not valid json}";
    const result = readCache("bad-json", "dashboard", 60_000);
    expect(result).toBeNull();
  });

  it("includes cachedAt timestamp", () => {
    const before = Date.now();
    writeCache("ts-key", "networth", { x: 1 });
    const result = readCache<{ x: number }>("ts-key", "networth", 60_000);
    expect(result!.cachedAt).toBeGreaterThanOrEqual(before);
    expect(result!.cachedAt).toBeLessThanOrEqual(Date.now());
  });

  it("dashboard and networth keys are stored independently", () => {
    writeCache("shared-key", "dashboard", { scope: "dashboard" });
    writeCache("shared-key", "networth", { scope: "networth" });
    expect(readCache<{ scope: string }>("shared-key", "dashboard", 60_000)!.data.scope).toBe("dashboard");
    expect(readCache<{ scope: string }>("shared-key", "networth", 60_000)!.data.scope).toBe("networth");
  });
});

// ── clearAllCaches ────────────────────────────────────────────────────────────

describe("clearAllCaches", () => {
  it("removes all hfa: prefixed keys", () => {
    mockStorage._store["hfa:v:dashboard"] = "3";
    mockStorage._store["hfa:cache:dashboard:k1"] = "{}";
    mockStorage._store["hfa:v:networth"] = "1";
    mockStorage._store["other:key"] = "keep-me";

    clearAllCaches();

    expect(mockStorage._store["hfa:v:dashboard"]).toBeUndefined();
    expect(mockStorage._store["hfa:cache:dashboard:k1"]).toBeUndefined();
    expect(mockStorage._store["hfa:v:networth"]).toBeUndefined();
    expect(mockStorage._store["other:key"]).toBe("keep-me");
  });

  it("is a no-op when no hfa: keys exist", () => {
    mockStorage._store["other:key"] = "safe";
    clearAllCaches();
    expect(mockStorage._store["other:key"]).toBe("safe");
  });
});

// ── CACHE_INVALIDATION_MAP ────────────────────────────────────────────────────

describe("CACHE_INVALIDATION_MAP patterns", () => {
  function scopesFor(path: string): CacheScope[] {
    let pathname: string;
    try {
      pathname = new URL(path, "http://x").pathname;
    } catch {
      pathname = path.split("?")[0] ?? path;
    }
    const found = new Set<CacheScope>();
    for (const { pattern, scopes } of CACHE_INVALIDATION_MAP) {
      if (pattern.test(pathname)) scopes.forEach((s) => found.add(s));
    }
    return Array.from(found).sort();
  }

  // ── Dashboard scope
  it("canonicalize → dashboard", () => {
    expect(scopesFor("/imports/sessions/abc-123/canonicalize")).toEqual(["dashboard"]);
  });

  it("upload (one-shot) → dashboard", () => {
    expect(scopesFor("/imports/upload")).toEqual(["dashboard"]);
  });

  it("ofx-confirm → dashboard", () => {
    expect(scopesFor("/imports/sessions/xyz/ofx-confirm")).toEqual(["dashboard"]);
  });

  it("POST /ledger → dashboard", () => {
    expect(scopesFor("/ledger")).toEqual(["dashboard"]);
  });

  it("PATCH /ledger/:id → dashboard", () => {
    expect(scopesFor("/ledger/txn-id-abc")).toEqual(["dashboard"]);
  });

  it("POST /ledger/bulk-category → dashboard", () => {
    expect(scopesFor("/ledger/bulk-category")).toEqual(["dashboard"]);
  });

  it("POST /ledger/bulk-trash → dashboard", () => {
    expect(scopesFor("/ledger/bulk-trash")).toEqual(["dashboard"]);
  });

  // ── Net Worth scope
  // NOTE: /reports/balance-sheet/manual is intentionally NOT in the map.
  // Balance row saves use apiFetch (no auto-invalidation) so updating multiple
  // accounts doesn't reload the page after each save. Refresh is manual.
  it("POST /reports/balance-sheet/manual → no scope (manual refresh only)", () => {
    expect(scopesFor("/reports/balance-sheet/manual")).toHaveLength(0);
  });

  it("PATCH /reports/balance-sheet/manual/:id → no scope (manual refresh only)", () => {
    expect(scopesFor("/reports/balance-sheet/manual/snap-id-123")).toHaveLength(0);
  });

  it("POST /household/properties/:id/values → networth + networth-history", () => {
    expect(scopesFor("/household/properties/prop-uuid/values")).toEqual(["networth", "networth-history"]);
  });

  it("POST /household/properties/:id/refresh-valuation → networth + networth-history", () => {
    expect(scopesFor("/household/properties/prop-uuid/refresh-valuation")).toEqual(["networth", "networth-history"]);
  });

  // ── Non-matching paths (read-only or irrelevant)
  it("GET /reports/cash-summary → no scope (read endpoint)", () => {
    expect(scopesFor("/reports/cash-summary")).toHaveLength(0);
  });

  it("GET /reports/balance-sheet/history → no scope (read endpoint)", () => {
    expect(scopesFor("/reports/balance-sheet/history")).toHaveLength(0);
  });

  it("/resolution/summary → no scope", () => {
    expect(scopesFor("/resolution/summary")).toHaveLength(0);
  });

  it("/budget/:month → no scope", () => {
    expect(scopesFor("/budget/2026-05")).toHaveLength(0);
  });
});

// ── invalidateCacheByUrl ──────────────────────────────────────────────────────

describe("invalidateCacheByUrl", () => {
  it("bumps dashboard version for /ledger/bulk-category", () => {
    invalidateCacheByUrl("/ledger/bulk-category");
    expect(getCacheVersion("dashboard")).toBe(1);
    expect(getCacheVersion("networth")).toBe(0);
  });

  it("does NOT bump networth for /reports/balance-sheet/manual (manual refresh only)", () => {
    invalidateCacheByUrl("/reports/balance-sheet/manual");
    expect(getCacheVersion("networth")).toBe(0);
    expect(getCacheVersion("dashboard")).toBe(0);
  });

  it("strips query string before matching", () => {
    invalidateCacheByUrl("/ledger/some-id?foo=bar");
    expect(getCacheVersion("dashboard")).toBe(1);
  });

  it("does not bump any scope for an unrecognised path", () => {
    invalidateCacheByUrl("/household/settings");
    expect(getCacheVersion("dashboard")).toBe(0);
    expect(getCacheVersion("networth")).toBe(0);
  });
});
