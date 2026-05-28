import { log } from "../../logger.js";

type TokenCache = {
  token: string;
  expiresAt: number;
};

type TrueProdigyTokenResponse = {
  token?: unknown;
};

type TrueProdigySearchResponse = {
  data?: unknown;
  results?: unknown;
  rows?: unknown;
  items?: unknown;
};

export type DCADProperty = {
  dcadPropertyId: string;
  address: string | null;
  city: string | null;
  assessedValue: number | null;
  marketValue: number | null;
  landValue: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  owner: string | null;
  legalDescription: string | null;
  apn: string | null;
  raw: Record<string, unknown>;
};

const DCAD_AUTH_URL = "https://prod-container.trueprodigyapi.com/trueprodigy/cadpublic/auth/token";
const DCAD_SEARCH_URL = "https://prod-container.trueprodigyapi.com/public/property/searchfulltext?page=1&pageSize=20";
const DCAD_SEARCH_BY_ID_URL = "https://prod-container.trueprodigyapi.com/public/property/search?page=1&pageSize=20";

let tokenCache: TokenCache | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodeJwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")) as { exp?: unknown };
    const expSec = typeof payload.exp === "number" ? payload.exp : Number(payload.exp);
    if (!Number.isFinite(expSec) || expSec <= 0) return null;
    return expSec * 1000;
  } catch {
    return null;
  }
}

function extractRows(raw: unknown): Record<string, unknown>[] {
  const top = asRecord(raw);
  if (!top) return [];
  const candidate = top.data ?? top.results ?? top.rows ?? top.items;
  if (Array.isArray(candidate)) {
    return candidate
      .map(asRecord)
      .filter((x): x is Record<string, unknown> => x != null);
  }
  if (asRecord(candidate)?.rows && Array.isArray(asRecord(candidate)?.rows)) {
    return (asRecord(candidate)?.rows as unknown[])
      .map(asRecord)
      .filter((x): x is Record<string, unknown> => x != null);
  }
  return [];
}

function mapProperty(row: Record<string, unknown>): DCADProperty | null {
  const dcadPropertyId =
    asString(row.propertyId) ??
    asString(row.id) ??
    asString(row.accountNumber) ??
    asString(row.dcadPropertyId);
  if (!dcadPropertyId) return null;
  return {
    dcadPropertyId,
    address: asString(row.address) ?? asString(row.streetPrimary) ?? asString(row.situsAddress),
    city: asString(row.city),
    assessedValue: asNumber(row.assessedValue) ?? asNumber(row.assessed_value),
    marketValue: asNumber(row.marketValue) ?? asNumber(row.market_value),
    landValue: asNumber(row.landValue) ?? asNumber(row.land_value),
    sqft: asNumber(row.sqft) ?? asNumber(row.improvementSqft),
    beds: asNumber(row.beds) ?? asNumber(row.bedrooms),
    baths: asNumber(row.baths) ?? asNumber(row.bathrooms),
    yearBuilt: asNumber(row.yearBuilt),
    owner: asString(row.owner) ?? asString(row.ownerName),
    legalDescription: asString(row.legalDescription),
    apn: asString(row.apn) ?? asString(row.accountNumber),
    raw: row
  };
}

export async function getToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - now > 60_000) {
    return tokenCache.token;
  }
  try {
    const res = await fetch(DCAD_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ office: "Denton" })
    });
    if (!res.ok) {
      throw new Error(`token fetch failed (${res.status})`);
    }
    const body = (await res.json()) as TrueProdigyTokenResponse;
    const token = asString(body.token);
    if (!token) {
      throw new Error("token missing from response");
    }
    const jwtExp = decodeJwtExpMs(token);
    const fallbackExp = Date.now() + 4 * 60_000;
    tokenCache = {
      token,
      expiresAt: jwtExp ?? fallbackExp
    };
    return token;
  } catch (err) {
    log.error("DCAD token fetch failed", { err: err instanceof Error ? err.message : String(err) });
    throw new Error("DCAD API unavailable");
  }
}

export async function searchDCADByAddress(address: string, taxYear: number): Promise<DCADProperty[]> {
  log.info("DCAD search start", { address, taxYear });
  try {
    const token = await getToken();
    const res = await fetch(DCAD_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pYear: { operator: "=", value: String(taxYear) },
        fullTextSearch: { operator: "match", value: address }
      })
    });
    if (!res.ok) {
      log.error("DCAD search failed", { status: res.status, address, taxYear });
      return [];
    }
    const body = (await res.json()) as TrueProdigySearchResponse;
    const mapped = extractRows(body).map(mapProperty).filter((x): x is DCADProperty => x != null);
    log.info("DCAD search success", { address, taxYear, count: mapped.length });
    return mapped;
  } catch (err) {
    log.error("DCAD search exception", { err: err instanceof Error ? err.message : String(err), address, taxYear });
    return [];
  }
}

export async function getDCADPropertyById(dcadPropertyId: string, taxYear: number): Promise<DCADProperty | null> {
  try {
    const token = await getToken();
    const res = await fetch(DCAD_SEARCH_BY_ID_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pYear: { operator: "=", value: String(taxYear) },
        propertyId: { operator: "=", value: dcadPropertyId }
      })
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as TrueProdigySearchResponse;
    const first = extractRows(body).map(mapProperty).find((x): x is DCADProperty => x != null);
    return first ?? null;
  } catch (err) {
    log.error("DCAD search by id failed", { err: err instanceof Error ? err.message : String(err), dcadPropertyId, taxYear });
    return null;
  }
}

