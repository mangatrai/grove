import { log } from "../../logger.js";
import {
  searchDCADByAddress,
  getDCADImprovementFeatures,
  getDCADValueHistory,
  getDCADTaxable,
  type DCADAppealEntry,
  getDCADAppeal,
} from "./dcad.service.js";

export type DcadCanonicalProperty = {
  cadPropertyId: string;    // pid (stable across years)
  cadAccountId: number;     // pAccountId for taxYear

  taxYear: number;

  // Address
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  legalAcreage: number | null;

  // Values from search result (current year row)
  landValueUsd: number | null;
  improvementValueUsd: number | null;
  marketValueUsd: number | null;
  appraisedValueUsd: number | null;
  deedDate: string | null;         // deedDt from search row — no extra API call

  // Values after homestead cap (from /valuehistory; subject property only)
  taxLimitationValueUsd: number | null;
  netAppraisedValueUsd: number | null;
  suExclusionValueUsd: number | null;
  valueHistoryJson: unknown[] | null;   // full year-by-year array

  // Taxable units breakdown (from /taxable; subject property only)
  taxableJson: unknown | null;

  // Improvement details (from /improvement + /features endpoints)
  sqft: number | null;
  grossBuildingArea: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  hasPool: boolean;

  // Raw search payload for this property + year
  rawSearchJson: unknown;
};

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return v.trim().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch all available DCAD data for one property and return as a canonical object.
 * Callers use only the fields they need.
 *
 * Pass `address` OR `cadPropertyId` (pid). If both provided, cadPropertyId takes precedence
 * for the search query.
 *
 * includeValueHistory=true  → fetches /valuehistory (homestead cap, net appraised, history)
 * includeTaxable=true       → fetches /taxable (estimated taxes, taxing units)
 *
 * Both defaults are false — they add extra API calls and are only needed for the subject property.
 */
export async function fetchDcadCanonical(opts: {
  address?: string;
  cadPropertyId?: string;
  taxYear: number;
  includeValueHistory?: boolean;
  includeTaxable?: boolean;
  county?: string;
}): Promise<DcadCanonicalProperty | null> {
  const { taxYear, includeValueHistory = false, includeTaxable = false, county } = opts;

  // ── Step 1: Search by address (all years returned; we filter to taxYear) ──────
  const searchQuery = opts.address ?? opts.cadPropertyId;
  if (!searchQuery) {
    log.warn("fetchDcadCanonical: no address or cadPropertyId provided");
    return null;
  }

  const allResults = await searchDCADByAddress(searchQuery, taxYear, county ?? null);
  if (allResults.length === 0) {
    log.info("fetchDcadCanonical: no results", { searchQuery, taxYear });
    return null;
  }

  // Pick the matching property. If cadPropertyId provided, find by pid; otherwise use house-number match.
  let match = opts.cadPropertyId
    ? allResults.find((r) => r.dcadPropertyId === opts.cadPropertyId) ?? allResults[0]
    : (() => {
        const houseNum = opts.address?.trim().match(/^\d+/)?.[0];
        return houseNum
          ? (allResults.find((r) => r.address?.startsWith(houseNum)) ?? allResults[0])
          : allResults[0];
      })();

  if (!match) return null;

  const cadPropertyId = match.dcadPropertyId;
  const cadAccountId = match.pAccountId;
  if (!cadAccountId) {
    log.warn("fetchDcadCanonical: no pAccountId on matched property", { cadPropertyId });
    return null;
  }

  const raw = match.raw as Record<string, unknown>;

  const base: DcadCanonicalProperty = {
    cadPropertyId,
    cadAccountId,
    taxYear,

    addressLine1: match.address,
    city: match.city,
    state: asString(raw.state) ?? asString(raw.addrState),
    zip: asString(raw.zip) ?? asString(raw.addrZip),
    latitude: asNumber(raw.latitude),
    longitude: asNumber(raw.longitude),
    legalAcreage: asNumber(raw.legalAcreage),

    landValueUsd: match.landValue,
    improvementValueUsd: asNumber(raw.improvementValue),
    marketValueUsd: match.marketValue,
    appraisedValueUsd: match.assessedValue,
    deedDate: toIsoDate(raw.deedDt),

    taxLimitationValueUsd: null,
    netAppraisedValueUsd: null,
    suExclusionValueUsd: null,
    valueHistoryJson: null,
    taxableJson: null,

    sqft: match.sqft,
    grossBuildingArea: null,
    beds: match.beds,
    baths: match.baths,
    yearBuilt: match.yearBuilt,
    hasPool: false,

    rawSearchJson: raw,
  };

  // ── Step 2: Improvement features (beds/baths/sqft/pool) ─────────────────────
  try {
    const features = await getDCADImprovementFeatures(cadAccountId, county ?? null);
    if (features) {
      base.sqft = features.sqft ?? base.sqft;
      base.beds = features.beds ?? base.beds;
      base.baths = features.baths ?? base.baths;
      base.hasPool = features.miscImprovements.some(
        (m) => /pool|spa/i.test(m.description)
      );
    }
  } catch (err) {
    log.warn("fetchDcadCanonical: improvement features failed", {
      cadPropertyId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Step 3 (optional): Value history → homestead cap, net appraised ──────────
  if (includeValueHistory) {
    try {
      const history = await getDCADValueHistory(cadAccountId, county ?? null);
      if (history.length > 0) {
        base.valueHistoryJson = history as unknown[];
        const current = history.find((h) => h.year === taxYear) ?? history[history.length - 1];
        if (current) {
          base.taxLimitationValueUsd = current.taxLimitationValue;
          base.netAppraisedValueUsd = current.netAppraisedValue;
          base.suExclusionValueUsd = current.suExclusionValue;
          // Refine base values with owner-adjusted amounts from history
          if (current.landValue != null) base.landValueUsd = current.landValue;
          if (current.improvementValue != null) base.improvementValueUsd = current.improvementValue;
          if (current.marketValue != null) base.marketValueUsd = current.marketValue;
          if (current.assessedValue != null) base.appraisedValueUsd = current.assessedValue;
        }
      }
    } catch (err) {
      log.warn("fetchDcadCanonical: value history failed", {
        cadPropertyId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Step 4 (optional): Taxable units breakdown ───────────────────────────────
  if (includeTaxable) {
    try {
      const taxable = await getDCADTaxable(cadAccountId, county ?? null);
      base.taxableJson = taxable as unknown;
    } catch (err) {
      log.warn("fetchDcadCanonical: taxable failed", {
        cadPropertyId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return base;
}

/**
 * Batch-enrich up to maxCount addresses with throttling between requests.
 * Returns a Map from address → DcadCanonicalProperty.
 * Addresses that fail or find no match are omitted from the map.
 */
export async function fetchDcadCanonicalBatch(opts: {
  addresses: string[];
  taxYear: number;
  maxCount?: number;
  throttleMs?: number;
  county?: string;
}): Promise<Map<string, DcadCanonicalProperty>> {
  const { taxYear, maxCount = 10, throttleMs = 200, county } = opts;
  const results = new Map<string, DcadCanonicalProperty>();
  const toFetch = opts.addresses.slice(0, maxCount);

  for (const address of toFetch) {
    try {
      await sleep(throttleMs);
      const result = await fetchDcadCanonical({ address, taxYear, county });
      if (result) {
        results.set(address, result);
      }
    } catch (err) {
      log.warn("fetchDcadCanonicalBatch: failed for address", {
        address,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Fetch appeal/protest status for a subject property account.
 * Returns empty array if not available.
 */
export async function fetchDcadAppeal(
  cadAccountId: number,
  county?: string
): Promise<DCADAppealEntry[]> {
  try {
    return await getDCADAppeal(cadAccountId, county ?? null);
  } catch (err) {
    log.warn("fetchDcadAppeal: failed", {
      cadAccountId,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Fetch the appraisal notice S3 key for a property account.
 * Returns null if not available or the account has no notice.
 */
export async function fetchDcadAppraisalNoticeS3Id(
  cadAccountId: number,
  county?: string
): Promise<string | null> {
  const office = county?.trim() ?? "Denton";
  const { getToken } = await import("./dcad.service.js");
  const DCAD_ACCOUNT_BASE = "https://prod-container.trueprodigyapi.com/public/propertyaccount";
  const BROWSER_HEADERS = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "dnt": "1",
    "origin": "https://denton.prodigycad.com",
    "referer": "https://denton.prodigycad.com/",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
  };

  try {
    const token = await getToken(office);
    const taxYear = new Date().getFullYear();
    const url = `${DCAD_ACCOUNT_BASE}/${cadAccountId}/shownoticelink?pYear=${taxYear}`;
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, authorization: token }
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      log.warn("fetchDcadAppraisalNoticeS3Id: HTTP error", { cadAccountId, status: res.status, body: errBody });
      return null;
    }
    const body = await res.json() as Record<string, unknown>;
    const results = body.results as Record<string, unknown> | undefined;
    if (!results?.showNoticeLink) return null;
    return typeof results.s3ID === "string" ? results.s3ID : null;
  } catch (err) {
    log.warn("fetchDcadAppraisalNoticeS3Id: failed", {
      cadAccountId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
