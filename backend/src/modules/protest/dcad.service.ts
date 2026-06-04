import { log } from "../../logger.js";

type TokenCache = {
  token: string;
  expiresAt: number;
};

// Actual response shape: { user: { token: "..." } }
type TrueProdigyTokenResponse = {
  user?: { token?: unknown };
};

type TrueProdigySearchResponse = {
  data?: unknown;
  results?: unknown;
  rows?: unknown;
  items?: unknown;
};

export type DCADProperty = {
  dcadPropertyId: string;
  pAccountId: number | null;
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

export type DCADValueHistoryEntry = {
  year: number;
  marketValue: number | null;
  assessedValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
};

export type DCADAppealEntry = {
  year: string | null;
  appealType: string | null;
  status: string | null;
  hearingDate: string | null;
  filedDate: string | null;
  raw: Record<string, unknown>;
};

export type DCADTaxableUnit = {
  code: string | null;
  name: string | null;
  taxRate: number | null;
  netAppraisedValue: number | null;
  taxableValue: number | null;
  estimatedTaxes: number | null;
  estimatedTaxesWoutExemptions: number | null;
};

export type DCADTaxableResult = {
  estimatedTaxes: number | null;
  estimatedTaxesWoutExemptions: number | null;
  totalTaxRate: number | null;
  taxingUnits: DCADTaxableUnit[];
};

const DCAD_AUTH_URL = "https://prod-container.trueprodigyapi.com/trueprodigy/cadpublic/auth/token";
const DCAD_SEARCH_URL = "https://prod-container.trueprodigyapi.com/public/property/searchfulltext?page=1&pageSize=20";
const DCAD_SEARCH_BY_ID_URL = "https://prod-container.trueprodigyapi.com/public/property/search?page=1&pageSize=20";
const DCAD_ACCOUNT_BASE = "https://prod-container.trueprodigyapi.com/public/propertyaccount";

// Keyed by office name — different counties need different tokens.
const tokenCacheMap = new Map<string, TokenCache>();

// TrueProdigy validates the Origin header server-side — requests without it return HTTP 500.
const BROWSER_HEADERS = {
  "accept": "*/*",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  "dnt": "1",
  "origin": "https://denton.prodigycad.com",
  "priority": "u=1, i",
  "referer": "https://denton.prodigycad.com/",
  "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "cross-site",
  "sec-gpc": "1",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
} as const;

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

/** "Denton County" → "Denton", "Collin County" → "Collin", "Denton" → "Denton" */
function countyToOffice(county: string | null | undefined): string {
  if (!county?.trim()) return "Denton";
  return county.trim().replace(/\s+county$/i, "").trim();
}

/** Strip house number and city/state/zip — "123 Main St, Frisco, TX 75036" → "Main St" */
function toStreetName(address: string): string {
  const withoutNumber = address.replace(/^\d+\s+/, "");
  return withoutNumber.split(",")[0].trim();
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
  // Search results use `pid` (integer); detail endpoints may use propertyId/id/accountNumber
  const pidRaw = row.pid ?? row.propertyId ?? row.id ?? row.accountNumber ?? row.dcadPropertyId;
  const dcadPropertyId = typeof pidRaw === "number" ? String(pidRaw) : asString(pidRaw);
  if (!dcadPropertyId) return null;

  const pAccountIdRaw = row.pAccountID ?? row.pAccountId ?? row.accountID ?? row.accountId;
  const pAccountId = typeof pAccountIdRaw === "number" ? pAccountIdRaw : asNumber(pAccountIdRaw);

  return {
    dcadPropertyId,
    pAccountId,
    address: asString(row.streetPrimary) ?? asString(row.address) ?? asString(row.situsAddress) ?? asString(row.addrDeliveryLine),
    city: asString(row.city) ?? asString(row.addrCity),
    // Search returns appraisedValue; some endpoints use assessedValue
    assessedValue: asNumber(row.appraisedValue) ?? asNumber(row.assessedValue) ?? asNumber(row.assessed_value),
    marketValue: asNumber(row.marketValue) ?? asNumber(row.market_value),
    landValue: asNumber(row.landValue) ?? asNumber(row.land_value),
    sqft: asNumber(row.sqft) ?? asNumber(row.improvementSqft) ?? asNumber(row.livingArea),
    beds: asNumber(row.beds) ?? asNumber(row.bedrooms),
    baths: asNumber(row.baths) ?? asNumber(row.bathrooms),
    yearBuilt: asNumber(row.yearBuilt),
    owner: asString(row.name) ?? asString(row.owner) ?? asString(row.ownerName) ?? asString(row.displayName),
    legalDescription: asString(row.legalDescription),
    apn: asString(row.taxOfficeRef) ?? asString(row.apn) ?? asString(row.accountNumber) ?? dcadPropertyId,
    raw: row
  };
}

export async function getToken(office: string): Promise<string> {
  const now = Date.now();
  const cached = tokenCacheMap.get(office);
  if (cached && cached.expiresAt - now > 60_000) {
    return cached.token;
  }
  try {
    const res = await fetch(DCAD_AUTH_URL, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "content-type": "application/json",
        "authorization": "null"
      },
      body: JSON.stringify({ office })
    });
    if (!res.ok) {
      throw new Error(`token fetch failed (${res.status})`);
    }
    const body = (await res.json()) as TrueProdigyTokenResponse;
    const token = asString(body.user?.token);
    if (!token) {
      throw new Error("token missing from response");
    }
    const jwtExp = decodeJwtExpMs(token);
    const fallbackExp = Date.now() + 4 * 60_000;
    tokenCacheMap.set(office, { token, expiresAt: jwtExp ?? fallbackExp });
    return token;
  } catch (err) {
    log.error("DCAD token fetch failed", { err: err instanceof Error ? err.message : String(err), office });
    throw new Error("DCAD API unavailable");
  }
}

async function doSearch(token: string, query: string, taxYear: number): Promise<DCADProperty[]> {
  const res = await fetch(DCAD_SEARCH_URL, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "content-type": "application/json",
      "authorization": token
    },
    body: JSON.stringify({
      pYear: { operator: "=", value: String(taxYear) },
      fullTextSearch: { operator: "match", value: query }
    })
  });
  if (!res.ok) {
    log.error("DCAD search HTTP error", { status: res.status, query, taxYear });
    return [];
  }
  const body = (await res.json()) as TrueProdigySearchResponse;
  const rows = extractRows(body);
  if (rows.length === 0) {
    log.debug("DCAD search: 0 rows", {
      query,
      taxYear,
      responseSnippet: JSON.stringify(body).slice(0, 500)
    });
  }
  return rows.map(mapProperty).filter((x): x is DCADProperty => x != null);
}

export async function searchDCADByAddress(
  address: string,
  taxYear: number,
  county: string | null | undefined
): Promise<DCADProperty[]> {
  const office = countyToOffice(county);
  log.info("DCAD search start", { address, taxYear, office });
  try {
    const token = await getToken(office);

    const results = await doSearch(token, address, taxYear);
    if (results.length > 0) {
      log.info("DCAD search success", { address, taxYear, count: results.length });
      return results;
    }

    // Fallback: street name only (strip house number + city/state/zip)
    const streetName = toStreetName(address);
    if (streetName !== address && streetName.length > 0) {
      log.info("DCAD search: retrying with street name only", { streetName, taxYear, office });
      const fallback = await doSearch(token, streetName, taxYear);
      log.info("DCAD search fallback result", { streetName, taxYear, count: fallback.length });
      return fallback;
    }

    log.info("DCAD search: no results", { address, taxYear, office });
    return [];
  } catch (err) {
    log.error("DCAD search exception", { err: err instanceof Error ? err.message : String(err), address, taxYear, office });
    return [];
  }
}

export async function getDCADPropertyById(
  dcadPropertyId: string,
  taxYear: number,
  county: string | null | undefined
): Promise<DCADProperty | null> {
  const office = countyToOffice(county);
  try {
    const token = await getToken(office);
    const res = await fetch(DCAD_SEARCH_BY_ID_URL, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "content-type": "application/json",
        "authorization": token
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
    log.error("DCAD search by id failed", { err: err instanceof Error ? err.message : String(err), dcadPropertyId, taxYear, office });
    return null;
  }
}

/** Year-by-year DCAD assessed/appraised value history for a property account. */
export async function getDCADValueHistory(
  pAccountId: number,
  county: string | null | undefined
): Promise<DCADValueHistoryEntry[]> {
  const office = countyToOffice(county);
  const url = `${DCAD_ACCOUNT_BASE}/${pAccountId}/valuehistory`;
  log.debug("DCAD value history request", { pAccountId, url, office });
  try {
    const token = await getToken(office);
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        "authorization": token
      }
    });
    log.debug("DCAD value history response", { pAccountId, status: res.status, ok: res.ok });
    if (!res.ok) {
      log.warn("DCAD value history HTTP error", { pAccountId, status: res.status });
      return [];
    }
    const body = await res.json() as unknown;
    const rows = extractRows(body);
    log.debug("DCAD value history rows", { pAccountId, count: rows.length, firstRow: rows[0] ?? null });
    const entries = rows
      .map(asRecord)
      .filter((r): r is Record<string, unknown> => r != null)
      .map((r) => ({
        year: asNumber(r.pYear ?? r.year ?? r.taxYear) ?? 0,
        // TrueProdigy uses owner* prefix for ownership-adjusted values — these are authoritative
        marketValue: asNumber(r.ownerMarketValue ?? r.marketValue ?? r.market_value),
        assessedValue: asNumber(r.ownerAppraisedValue ?? r.appraisedValue ?? r.assessedValue ?? r.appraised_value),
        landValue: asNumber(r.ownerLandValue ?? r.landValue ?? r.land_value),
        improvementValue: asNumber(r.ownerImprovementValue ?? r.improvementValue ?? r.improvement_value),
      }))
      .filter((e) => e.year > 0);
    log.debug("DCAD value history mapped", { pAccountId, entries: entries.map((e) => ({ year: e.year, assessedValue: e.assessedValue })) });
    return entries;
  } catch (err) {
    log.error("DCAD value history failed", { err: err instanceof Error ? err.message : String(err), pAccountId });
    return [];
  }
}

/** Current-year taxable value breakdown (after exemptions) for a property account. */
export async function getDCADTaxable(
  pAccountId: number,
  county: string | null | undefined
): Promise<DCADTaxableResult | null> {
  const office = countyToOffice(county);
  const url = `${DCAD_ACCOUNT_BASE}/${pAccountId}/taxable`;
  log.debug("DCAD taxable request", { pAccountId, url, office });
  try {
    const token = await getToken(office);
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        "authorization": token
      }
    });
    log.debug("DCAD taxable response", { pAccountId, status: res.status, ok: res.ok });
    if (!res.ok) {
      log.warn("DCAD taxable HTTP error", { pAccountId, status: res.status });
      return null;
    }
    const body = await res.json() as unknown;
    // Response shape: { results: { taxingUnits: [...], estimatedTaxes: "...", ... } }
    // extractRows() can't handle this because results is an object, not an array.
    const top = asRecord(body);
    const results = asRecord(top?.results);
    log.debug("DCAD taxable parsed results", { pAccountId, estimatedTaxes: results?.estimatedTaxes ?? null, unitCount: Array.isArray(results?.taxingUnits) ? (results.taxingUnits as unknown[]).length : 0 });
    if (!results) return null;

    const taxingUnits: DCADTaxableUnit[] = Array.isArray(results.taxingUnits)
      ? (results.taxingUnits as unknown[])
          .map(asRecord)
          .filter((u): u is Record<string, unknown> => u != null)
          .map((u) => ({
            code: asString(u.taxingUnitCode),
            name: asString(u.taxingUnitName),
            taxRate: asNumber(u.totalTaxRate),
            netAppraisedValue: asNumber(u.netAppraisedValue),
            taxableValue: asNumber(u.taxableValue),
            estimatedTaxes: asNumber(u.estimatedTaxes),
            estimatedTaxesWoutExemptions: asNumber(u.estimatedTaxesWoutExemptions),
          }))
      : [];

    return {
      estimatedTaxes: asNumber(results.estimatedTaxes),
      estimatedTaxesWoutExemptions: asNumber(results.estimatedTaxesWoutExemptions),
      totalTaxRate: asNumber(results.totalTaxRate),
      taxingUnits,
    };
  } catch (err) {
    log.error("DCAD taxable failed", { err: err instanceof Error ? err.message : String(err), pAccountId });
    return null;
  }
}

/** Beds/baths from DCAD for a property account.
 *  Two-step: /improvement list → imprvID → /improvement/{imprvID}/features */
export async function getDCADImprovementFeatures(
  pAccountId: number,
  county: string | null | undefined
): Promise<{ beds: number | null; baths: number | null } | null> {
  const office = countyToOffice(county);
  try {
    const token = await getToken(office);

    // Step 1: get improvement list to find the imprvID
    const improvUrl = `${DCAD_ACCOUNT_BASE}/${pAccountId}/improvement`;
    log.debug("DCAD improvement list request", { pAccountId, url: improvUrl });
    const improvRes = await fetch(improvUrl, { headers: { ...BROWSER_HEADERS, authorization: token } });
    log.debug("DCAD improvement list response", { pAccountId, status: improvRes.status });
    if (!improvRes.ok || improvRes.status === 204) return null;
    const improvBody = await improvRes.json() as unknown;
    const improvements = extractRows(improvBody);
    if (!improvements.length) return null;

    // Prefer "MA" (main area) type; fall back to first improvement
    const primary = improvements.find(
      (r) => r.imprvDetailType === "MA" || r.imprvType === "MA"
    ) ?? improvements[0];
    // Try common field names for the improvement ID
    const imprvId = asNumber(primary.pDetailID) ?? asNumber(primary.imprvID)
      ?? asNumber(primary.improvementID) ?? asNumber(primary.id);
    if (!imprvId) {
      log.warn("DCAD improvement list: no imprvID found", { pAccountId, fields: Object.keys(primary) });
      return null;
    }

    // Step 2: get features for that improvement
    const featUrl = `${DCAD_ACCOUNT_BASE}/improvement/${imprvId}/features`;
    log.debug("DCAD improvement features request", { pAccountId, imprvId, url: featUrl });
    const featRes = await fetch(featUrl, { headers: { ...BROWSER_HEADERS, authorization: token } });
    log.debug("DCAD improvement features response", { pAccountId, imprvId, status: featRes.status });
    if (!featRes.ok || featRes.status === 204) return null;
    const featBody = await featRes.json() as unknown;
    const rows = extractRows(featBody);

    let beds: number | null = null;
    let baths: number | null = null;
    for (const row of rows) {
      const features = Array.isArray(row.features) ? (row.features as unknown[]) : [];
      for (const feat of features) {
        if (typeof feat !== "string") continue;
        if (/^bedrooms:/i.test(feat)) {
          const v = parseFloat(feat.split(":")[1] ?? "");
          if (!isNaN(v)) beds = v;
        } else if (/^plumbing:/i.test(feat)) {
          const v = parseFloat(feat.split(":")[1] ?? "");
          if (!isNaN(v)) baths = v;
        }
      }
    }
    log.debug("DCAD improvement features parsed", { pAccountId, imprvId, beds, baths });
    return { beds, baths };
  } catch (err) {
    log.error("DCAD improvement features failed", { err: err instanceof Error ? err.message : String(err), pAccountId });
    return null;
  }
}

/** Live protest/appeal status from DCAD for a property account. */
export async function getDCADAppeal(
  pAccountId: number,
  county: string | null | undefined
): Promise<DCADAppealEntry[]> {
  const office = countyToOffice(county);
  const url = `${DCAD_ACCOUNT_BASE}/${pAccountId}/appeal`;
  log.debug("DCAD appeal request", { pAccountId, url, office });
  try {
    const token = await getToken(office);
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        "authorization": token
      }
    });
    log.debug("DCAD appeal response", { pAccountId, status: res.status, ok: res.ok });
    if (!res.ok) {
      log.warn("DCAD appeal HTTP error", { pAccountId, status: res.status });
      return [];
    }
    const body = await res.json() as unknown;
    const rows = extractRows(body);
    return rows
      .map(asRecord)
      .filter((r): r is Record<string, unknown> => r != null)
      .map((r) => ({
        year: asString(r.pYear ?? r.year ?? r.taxYear),
        appealType: asString(r.appealType ?? r.appeal_type),
        status: asString(r.appealStatus ?? r.status ?? r.protestStatus),
        hearingDate: asString(r.docketDt ?? r.hearingDate ?? r.hearing_date),
        filedDate: asString(r.informalDt ?? r.filedDate ?? r.filed_date ?? r.protestDate),
        raw: r
      }));
  } catch (err) {
    log.error("DCAD appeal failed", { err: err instanceof Error ? err.message : String(err), pAccountId });
    return [];
  }
}
