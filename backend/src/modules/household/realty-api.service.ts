/**
 * RealtyAPI / Redfin property valuation service.
 *
 * First-time fetch: POST /property/address (2 credits) → stores api_property_id + api_listing_id.
 * Subsequent fetches: GET /detailsbyid (1 credit) using stored IDs.
 *
 * Key extracted fields:
 *   - AVM estimate (predictedValue)
 *   - Estimate range (agenInfo.estimatedSalePriceRange)
 *   - Last sold event (price hidden in non-disclosure states like TX)
 *   - Tax history from public records (Denton/Collin county CAD data)
 *   - Comparable sales (address, sqft, beds/baths, list price, close price, sold date)
 */

import { env } from "../../config/env.js";
import { log } from "../../logger.js";

const REDFIN_BASE = "https://redfin.realtyapi.io";

// ── Public types ─────────────────────────────────────────────────────────────

export interface ValuationComp {
  address: string;
  city: string;
  state: string;
  zip: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSqft: number | null;
  listPrice: number | null;
  soldPrice: number | null;
  soldDate: string | null;       // "YYYY-MM-DD"
  pricePerSqft: number | null;
}

export interface ValuationDetail {
  fetchedAt: string;             // "YYYY-MM-DD"
  source: "redfin";
  estimate: number;              // Redfin AVM predictedValue
  estimateRange: { low: number; high: number } | null;
  county: string | null;         // County name (e.g. "Denton", "Shelby") from Redfin amenities
  photoUrl: string | null;       // Exterior photo URL (bigphoto CDN)
  thumbnailUrl: string | null;   // Exterior thumbnail URL (midphoto CDN)
  lastSold: {
    date: string | null;         // "YYYY-MM-DD"
    price: number | null;        // null in non-disclosure states
    disclosed: boolean;
  } | null;
  taxCurrent: {
    year: number;
    assessedValue: number;       // land + improvement
    landValue: number | null;
    improvementValue: number | null;
    taxesDue: number | null;
  } | null;
  taxHistory: Array<{
    year: number;
    assessedValue: number | null;
    taxesDue: number | null;
  }>;
  comps: ValuationComp[];
  subject: {
    beds: number | null;
    baths: number | null;
    sqFt: number | null;
    lotSqFt: number | null;
    yearBuilt: number | null;
    stories: number | null;
    propertyType: string | null;  // e.g. "Single Family Residential"
    apn: string | null;           // Assessor Parcel Number — encodes county property ID for tax protest lookups
  } | null;
}

export interface ValuationLookupResult {
  estimate: number;
  apiPropertyId: string;
  apiListingId: string | null;
  detail: ValuationDetail;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function apiKey(): string {
  return env.REALTY_API_KEY ?? "";
}

async function realtyGet(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(endpoint, REDFIN_BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  log.info("RealtyAPI: GET", { endpoint, paramKeys: Object.keys(params) });
  const res = await fetch(url.toString(), {
    headers: { "x-realtyapi-key": apiKey() },
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) {
    log.error("RealtyAPI: HTTP error", { endpoint, status: res.status, statusText: res.statusText });
    throw new Error(`RealtyAPI ${endpoint} HTTP ${res.status}`);
  }
  return res.json() as Promise<unknown>;
}

/** Safe positional read from an array — returns null if out of bounds or nullish. */
function atIdx<T>(arr: unknown, idx: number): T | null {
  if (!Array.isArray(arr) || idx >= arr.length) return null;
  const v = arr[idx];
  return v !== null && v !== undefined ? (v as T) : null;
}

/** Parse Redfin sash date string "APR 24, 2026" → "2026-04-24". */
function parseSashDate(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12"
  };
  const m = s.match(/^([A-Z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) return null;
  const [, mon, day, year] = m;
  const mo = months[mon!];
  if (!mo) return null;
  return `${year}-${mo}-${String(parseInt(day!, 10)).padStart(2, "0")}`;
}

/** Parse unix ms timestamp → "YYYY-MM-DD" UTC. */
function msToDate(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parse comparable sales from Redfin's positional __atts encoding.
 *
 * Confirmed positions from live /detailsbyaddress responses:
 *   __atts[4].__atts[21]  = list price
 *   __atts[4].__atts[26]  = beds
 *   __atts[4].__atts[27]  = baths
 *   __atts[4].__atts[50]  = close/sold price
 *   __atts[6].__atts[2]['1'][0].lastSaleDate = sold date string  (index 2, not 3 — confirmed from live response)
 *   __atts[7].__atts      = [state,_,city,_,yearBuilt,streetNum,streetSuffix,_,_,zip,_,_,lat,lon,
 *                             _,_,_,lotSqft,_,streetName,_,approxSqft,_,_,propId]  (sqft at 21, not 22)
 */
function parseComps(comparables: unknown): ValuationComp[] {
  if (!Array.isArray(comparables)) return [];
  const result: ValuationComp[] = [];

  for (const comp of comparables) {
    try {
      const outerAtts = (comp as Record<string, unknown>).__atts;
      if (!Array.isArray(outerAtts) || outerAtts.length < 8) continue;

      // Listing data — positional array inside __atts[4]
      const listingObj = outerAtts[4] as Record<string, unknown>;
      const listingArr = listingObj?.__atts as unknown[];
      const listPrice = typeof atIdx<number>(listingArr, 21) === "number"
        ? (atIdx<number>(listingArr, 21) as number)
        : null;
      const soldPrice = typeof atIdx<number>(listingArr, 50) === "number"
        ? (atIdx<number>(listingArr, 50) as number)
        : null;
      const beds = typeof atIdx<number>(listingArr, 26) === "number"
        ? (atIdx<number>(listingArr, 26) as number)
        : null;
      const baths = typeof atIdx<number>(listingArr, 27) === "number"
        ? (atIdx<number>(listingArr, 27) as number)
        : null;

      // Sash block — __atts[6].__atts[2]['1'][0].lastSaleDate
      const sashObj = outerAtts[6] as Record<string, unknown>;
      const sashAtts = Array.isArray(sashObj?.__atts) ? (sashObj.__atts as unknown[]) : [];
      const sashMap = sashAtts[2] as Record<string, unknown[]> | undefined;
      const sash1 = Array.isArray(sashMap?.["1"]) ? (sashMap!["1"][0] as Record<string, unknown>) : null;
      const soldDate = parseSashDate(sash1?.lastSaleDate);

      // Facts array — __atts[7].__atts (positional)
      const factsObj = outerAtts[7] as Record<string, unknown>;
      const facts = factsObj?.__atts as unknown[];
      if (!Array.isArray(facts) || facts.length < 20) continue;

      const streetNum = typeof facts[5] === "string" ? facts[5] : "";
      const streetName = typeof facts[19] === "string" ? facts[19] : "";
      const streetSuffix = typeof facts[6] === "string" ? facts[6] : "";
      const address = `${streetNum} ${streetName} ${streetSuffix}`.replace(/\s+/g, " ").trim();
      const city = typeof facts[2] === "string" ? facts[2] : "";
      const state = typeof facts[0] === "string" ? facts[0] : "";
      const zip = typeof facts[9] === "string" ? facts[9] : "";
      const yearBuilt = typeof facts[4] === "number" ? facts[4] : null;
      const lotSqft = typeof facts[17] === "number" ? facts[17] : null;
      const sqft = typeof facts[21] === "number" ? facts[21] : null;
      const pricePerSqft = soldPrice && sqft && sqft > 0 ? Math.round(soldPrice / sqft) : null;

      if (!address || !city) continue;

      result.push({ address, city, state, zip, sqft, beds, baths, yearBuilt, lotSqft, listPrice, soldPrice, soldDate, pricePerSqft });
    } catch (err) {
      log.warn("RealtyAPI: parseComps — skipping malformed comp entry", {
        err: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return result;
}

/**
 * Extract the compact ValuationDetail plus the Redfin property/listing IDs
 * from a raw /property/address or /detailsbyid response.
 */
function parseRedfinResponse(raw: unknown): ValuationLookupResult | null {
  const r = raw as Record<string, unknown>;
  const details = r?.details as Record<string, unknown> | undefined;
  if (!details) {
    log.error("RealtyAPI: parseRedfinResponse — missing 'details' key", {
      topLevelKeys: Object.keys(r ?? {}).slice(0, 10)
    });
    return null;
  }

  // IDs — from avmInfo and mainHouseInfo
  const avmRoot = (details.avm as Record<string, unknown>)?.__root as Record<string, unknown> | undefined;
  const avmInfo = avmRoot?.avmInfo as Record<string, unknown> | undefined;
  const predictedValue = avmInfo?.predictedValue;
  if (typeof predictedValue !== "number" || !Number.isFinite(predictedValue)) {
    log.error("RealtyAPI: parseRedfinResponse — predictedValue missing or invalid", {
      hasAvm: Boolean(details.avm),
      hasAvmRoot: Boolean(avmRoot),
      hasAvmInfo: Boolean(avmInfo),
      predictedValueType: typeof predictedValue
    });
    return null;
  }

  const apiPropertyId = avmInfo?.propertyId != null ? String(avmInfo.propertyId) : null;
  if (!apiPropertyId) {
    log.error("RealtyAPI: parseRedfinResponse — propertyId missing from avmInfo");
    return null;
  }

  // listing_id — mainHouseInfoPanelInfo is most reliable
  const panelInfo = details.mainHouseInfoPanelInfo as Record<string, unknown> | undefined;
  const panelMainInfo = panelInfo?.mainHouseInfo as Record<string, unknown> | undefined;
  const aboveMain = (details.aboveTheFold as Record<string, unknown>)?.mainHouseInfo as Record<string, unknown> | undefined;
  const rawListingId = panelMainInfo?.listingId ?? aboveMain?.listingId;
  const apiListingId = rawListingId != null ? String(rawListingId) : null;

  // Estimate range
  const agenInfo = details.agenInfo as Record<string, unknown> | undefined;
  const priceRange = agenInfo?.estimatedSalePriceRange as Record<string, unknown> | undefined;
  const estimateRange = (typeof priceRange?.minSalePriceRange === "number" && typeof priceRange?.maxSalePriceRange === "number")
    ? { low: priceRange.minSalePriceRange as number, high: priceRange.maxSalePriceRange as number }
    : null;

  // Last sold
  const histInfo = (details.belowTheFold as Record<string, unknown>)?.propertyHistoryInfo as Record<string, unknown> | undefined;
  const events = Array.isArray(histInfo?.events) ? (histInfo!.events as Record<string, unknown>[]) : [];
  const soldEvent = events.find((e) => e.historyEventType === 1);
  let lastSold: ValuationDetail["lastSold"] = null;
  if (soldEvent) {
    const disclosed = soldEvent.isPriceAdminOnly !== true && soldEvent.priceDisplayLevel !== 5;
    const price = disclosed && typeof soldEvent.price === "number" ? soldEvent.price : null;
    lastSold = {
      date: msToDate(soldEvent.eventDate),
      price,
      disclosed
    };
  }

  // Tax data from public records
  const pubRecords = (details.belowTheFold as Record<string, unknown>)?.publicRecordsInfo as Record<string, unknown> | undefined;
  const taxInfo = pubRecords?.taxInfo as Record<string, unknown> | undefined;
  const allTaxInfo = Array.isArray(pubRecords?.allTaxInfo) ? (pubRecords!.allTaxInfo as Record<string, unknown>[]) : [];

  let taxCurrent: ValuationDetail["taxCurrent"] = null;
  if (taxInfo && typeof taxInfo.rollYear === "number") {
    const land = typeof taxInfo.taxableLandValue === "number" ? taxInfo.taxableLandValue : null;
    const improvement = typeof taxInfo.taxableImprovementValue === "number" ? taxInfo.taxableImprovementValue : null;
    const assessed = (land ?? 0) + (improvement ?? 0);
    taxCurrent = {
      year: taxInfo.rollYear as number,
      assessedValue: assessed || (taxInfo.taxableImprovementValue as number ?? 0),
      landValue: land,
      improvementValue: improvement,
      taxesDue: typeof taxInfo.taxesDue === "number" ? taxInfo.taxesDue : null
    };
  }

  const taxHistory: ValuationDetail["taxHistory"] = allTaxInfo
    .filter((t) => typeof t.rollYear === "number")
    .map((t) => {
      const land = typeof t.taxableLandValue === "number" ? t.taxableLandValue : null;
      const imp = typeof t.taxableImprovementValue === "number" ? t.taxableImprovementValue : null;
      const assessed = land !== null || imp !== null ? (land ?? 0) + (imp ?? 0) : null;
      return {
        year: t.rollYear as number,
        assessedValue: assessed,
        taxesDue: typeof t.taxesDue === "number" ? t.taxesDue : null
      };
    })
    .sort((a, b) => b.year - a.year);

  // Comparable sales
  const rawComps = avmRoot?.comparables;
  if (!Array.isArray(rawComps) || rawComps.length === 0) {
    log.warn("RealtyAPI: comparables missing or empty", {
      rawCompsType: typeof rawComps,
      isArray: Array.isArray(rawComps),
      avmRootKeys: avmRoot ? Object.keys(avmRoot).slice(0, 15) : null
    });
  }
  const comps = parseComps(rawComps);
  if (Array.isArray(rawComps) && rawComps.length > 0 && comps.length === 0) {
    log.warn("RealtyAPI: parseComps returned 0 from non-empty array — structure mismatch", {
      rawCount: rawComps.length,
      firstEntryKeys: rawComps[0] && typeof rawComps[0] === "object" ? Object.keys(rawComps[0] as object).slice(0, 10) : null
    });
  } else {
    log.info("RealtyAPI: comparables parsed", { rawCount: Array.isArray(rawComps) ? rawComps.length : 0, parsedCount: comps.length });
  }

  // Subject property physical characteristics (from public records)
  const basicInfo = pubRecords?.basicInfo as Record<string, unknown> | undefined;
  const subject: ValuationDetail["subject"] = basicInfo ? {
    beds: typeof basicInfo.beds === "number" ? basicInfo.beds : null,
    baths: typeof basicInfo.baths === "number" ? basicInfo.baths : null,
    sqFt: typeof basicInfo.sqFtFinished === "number" ? basicInfo.sqFtFinished
      : typeof basicInfo.totalSqFt === "number" ? basicInfo.totalSqFt : null,
    lotSqFt: typeof basicInfo.lotSqFt === "number" ? basicInfo.lotSqFt : null,
    yearBuilt: typeof basicInfo.yearBuilt === "number" ? basicInfo.yearBuilt : null,
    stories: typeof basicInfo.numStories === "number" ? basicInfo.numStories : null,
    propertyType: typeof basicInfo.propertyTypeName === "string" ? basicInfo.propertyTypeName : null,
    apn: typeof basicInfo.apn === "string" ? basicInfo.apn : null
  } : null;

  // County name from main house amenities list
  const aboveTheFold = details.aboveTheFold as Record<string, unknown> | undefined;
  const mainHouseInfo = aboveTheFold?.mainHouseInfo as Record<string, unknown> | undefined;
  const amenities = Array.isArray(mainHouseInfo?.selectedAmenities)
    ? (mainHouseInfo!.selectedAmenities as Array<Record<string, unknown>>)
    : [];
  const countyEntry = amenities.find((a) => a.header === "County");
  const county = typeof countyEntry?.content === "string" ? countyEntry.content : null;

  // Exterior photo URL from tagsByPhotoId (find entry tagged "Exterior")
  const photoTags = aboveTheFold?.photoTags as Record<string, unknown> | undefined;
  const tagsByPhotoId = photoTags?.tagsByPhotoId as Record<string, Record<string, unknown>> | undefined;
  let photoUrl: string | null = null;
  let thumbnailUrl: string | null = null;
  if (tagsByPhotoId) {
    const entries = Object.values(tagsByPhotoId);
    const exteriorEntry = entries.find(
      (e) => Array.isArray(e.tags) && (e.tags as string[]).includes("Exterior")
    ) ?? entries[0];
    if (exteriorEntry) {
      photoUrl = typeof exteriorEntry.photoUrl === "string" ? exteriorEntry.photoUrl : null;
      thumbnailUrl = typeof exteriorEntry.thumbnailphotoUrl === "string" ? exteriorEntry.thumbnailphotoUrl : null;
    }
  }

  const detail: ValuationDetail = {
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: "redfin",
    estimate: predictedValue,
    estimateRange,
    county,
    photoUrl,
    thumbnailUrl,
    lastSold,
    taxCurrent,
    taxHistory,
    comps,
    subject
  };

  return { estimate: predictedValue, apiPropertyId, apiListingId, detail };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns false if REALTYAPI_KEY is not configured. */
export function isRealtyApiConfigured(): boolean {
  return Boolean(env.REALTY_API_KEY?.trim());
}

/**
 * First-time lookup by full address string (costs 2 API credits).
 * Returns estimate, Redfin property/listing IDs, and full valuation detail.
 * Address format: "7070 Coulter Lake Rd, Frisco, TX 75036"
 */
export async function lookupByAddress(address: string): Promise<ValuationLookupResult> {
  if (!isRealtyApiConfigured()) throw new Error("REALTYAPI_KEY not configured");
  log.info("RealtyAPI: address lookup", { address });
  const raw = await realtyGet("/detailsbyaddress", { property_address: address });
  const result = parseRedfinResponse(raw);
  if (!result) throw new Error("RealtyAPI: could not parse valuation from address response");
  return result;
}

/**
 * Subsequent fetch by stored Redfin IDs (costs 1 API credit).
 * listingId is optional but improves cache hit rate on Redfin's side.
 */
export async function fetchByIds(propertyId: string, listingId: string | null): Promise<ValuationLookupResult> {
  if (!isRealtyApiConfigured()) throw new Error("REALTYAPI_KEY not configured");
  log.info("RealtyAPI: detailsbyid", { propertyId, listingId });
  const params: Record<string, string> = { property_id: propertyId };
  if (listingId) params.listing_id = listingId;
  const raw = await realtyGet("/detailsbyid", params);
  const result = parseRedfinResponse(raw);
  if (!result) throw new Error("RealtyAPI: could not parse valuation from detailsbyid response");
  return result;
}
