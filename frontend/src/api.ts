import { useSyncExternalStore } from "react";
import { invalidateCacheByUrl } from "./cache";

const TOKEN_KEY = "hf_jwt";

const tokenListeners = new Set<() => void>();

function notifyTokenListeners(): void {
  tokenListeners.forEach((fn) => fn());
}

/** Subscribe for `useSyncExternalStore` — call when auth changes so UI re-renders without a route change. */
function subscribeToken(onStoreChange: () => void): () => void {
  tokenListeners.add(onStoreChange);
  return () => tokenListeners.delete(onStoreChange);
}

function getTokenSnapshot(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return getTokenSnapshot();
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
  notifyTokenListeners();
}

/** React hook: same as `getToken()` but re-renders when `setToken` runs (e.g. sign-out on same URL as `/`). */
export function useAuthToken(): string | null {
  return useSyncExternalStore(subscribeToken, getTokenSnapshot, () => null);
}

function authHeaders(): HeadersInit {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const h = authHeaders() as Record<string, string>;
  if (h.Authorization) {
    headers.set("Authorization", h.Authorization);
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    const errBody = await res.text();
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(errBody) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch { /* use status text */ }
    throw new Error(message);
  }

  // Invalidate cached data for any scope affected by this mutation.
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    invalidateCacheByUrl(path);
  }

  return (await res.json()) as T;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const h = authHeaders() as Record<string, string>;
  if (h.Authorization) {
    headers.set("Authorization", h.Authorization);
  }
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    throw new Error("Session expired. Please sign in again.");
  }
  return res;
}
