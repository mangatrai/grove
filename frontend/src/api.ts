const TOKEN_KEY = "hf_jwt";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
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
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${errBody}`);
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
  return fetch(path, { ...init, headers });
}
