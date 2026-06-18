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

/** Parse unix ms timestamp → "YYYY-MM-DD" UTC. */
function msToDate(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

// ── Schema-driven __atts decoder ─────────────────────────────────────────────
//
// Redfin encodes objects as { __t_idx: N, __atts: [...values] }.
// avm.__att_names is an array-of-arrays: att_names[N] lists field names in
// position order for type N. We build a reverse index (type → name → position)
// so field lookups are by name, not hardcoded position. If Redfin shifts
// positions in a future deploy, attField still finds the right slot. If they
// rename a field, checkSchemaFields emits a WARN in production immediately.

/** Map<typeIdx, Map<fieldName, position>> built from avm.__att_names */
type AttSchema = Map<number, Map<string, number>>;

function buildAttSchema(raw: unknown): AttSchema {
  const index = new Map<number, Map<string, number>>();
  if (!Array.isArray(raw)) return index;
  for (let ti = 0; ti < raw.length; ti++) {
    const fields = raw[ti];
    if (!Array.isArray(fields)) continue;
    const fm = new Map<string, number>();
    for (let pos = 0; pos < fields.length; pos++) {
      if (typeof fields[pos] === "string") fm.set(fields[pos] as string, pos);
    }
    index.set(ti, fm);
  }
  return index;
}

/**
 * Read a named field from a { __t_idx, __atts } encoded object.
 * Returns undefined when the schema type is unknown or the field is absent —
 * both are signals that the API structure changed.
 */
function attField(obj: Record<string, unknown>, field: string, schema: AttSchema): unknown {
  const ti = typeof obj.__t_idx === "number" ? obj.__t_idx : null;
  if (ti === null) return undefined;
  const pos = schema.get(ti)?.get(field);
  if (pos === undefined) return undefined;
  const atts = obj.__atts;
  if (!Array.isArray(atts) || pos >= atts.length) return undefined;
  const v = atts[pos];
  return v !== null && v !== undefined ? v : undefined;
}

/**
 * Emit a WARN if any of the required field names are absent from the schema
 * for this object's type. One log line per object type, fires in production.
 */
function checkSchemaFields(
  obj: Record<string, unknown>,
  requiredFields: string[],
  schema: AttSchema,
  label: string
): void {
  const ti = typeof obj.__t_idx === "number" ? obj.__t_idx : -1;
  if (ti < 0 || !schema.has(ti)) {
    log.warn("RealtyAPI: parseComps — schema type not registered (API changed?)", { label, typeIdx: ti });
    return;
  }
  const fieldMap = schema.get(ti)!;
  const missing = requiredFields.filter(f => !fieldMap.has(f));
  if (missing.length > 0) {
    log.warn("RealtyAPI: parseComps — schema missing expected fields (API changed?)", {
      label, typeIdx: ti, missingFields: missing,
      presentFields: [...fieldMap.keys()].filter(k => requiredFields.includes(k))
    });
  }
}

/**
 * Parse comparable sales using Redfin's self-describing __att_names schema.
 *
 * Fields are resolved by name via each object's __t_idx — position shifts in
 * future API responses are handled automatically. WARN logs fire at the top of
 * the first comp if Redfin renames or removes a field we depend on, giving
 * production-visible signal before comps start failing.
 */
function parseComps(comparables: unknown, schema: AttSchema): ValuationComp[] {
  if (!Array.isArray(comparables) || comparables.length === 0) return [];

  const result: ValuationComp[] = [];
  let innerValidated = false;

  for (const comp of comparables) {
    try {
      const outerObj = comp as Record<string, unknown>;
      if (!Array.isArray(outerObj.__atts)) {
        log.warn("RealtyAPI: parseComps — comp missing __atts", { compKeys: Object.keys(outerObj) });
        continue;
      }

      const listingObj = attField(outerObj, "listing", schema) as Record<string, unknown> | undefined;
      const extraObj   = attField(outerObj, "extra",   schema) as Record<string, unknown> | undefined;
      const propObj    = attField(outerObj, "property", schema) as Record<string, unknown> | undefined;

      if (!listingObj || !extraObj || !propObj) {
        log.warn("RealtyAPI: parseComps — outer block resolution failed", {
          hasListing: Boolean(listingObj), hasExtra: Boolean(extraObj), hasProperty: Boolean(propObj),
          outerTypeIdx: outerObj.__t_idx
        });
        continue;
      }

      // Validate inner schemas once — emits WARN in production if Redfin renames fields
      if (!innerValidated) {
        innerValidated = true;
        checkSchemaFields(outerObj,    ["listing", "extra", "property"],                                                               schema, "outerComp");
        checkSchemaFields(listingObj,  ["listingPrice", "numBedrooms", "numBathrooms", "salePrice"],                                   schema, "listing");
        checkSchemaFields(extraObj,    ["lastSaleInfo"],                                                                               schema, "extra");
        checkSchemaFields(propObj,     ["sqFtFinished", "stateOrProvinceCode", "city", "yearBuilt",
                                        "streetNumber", "streetType", "postalCode", "lotSqFt", "streetName"], schema, "property");
      }

      // Listing fields
      const listPrice = attField(listingObj, "listingPrice",  schema);
      const soldPrice = attField(listingObj, "salePrice",     schema);
      const beds      = attField(listingObj, "numBedrooms",   schema);
      const baths     = attField(listingObj, "numBathrooms",  schema);

      // Sold date via lastSaleInfo.saleListingLastSaleDate (unix ms)
      const lastSaleInfo = attField(extraObj, "lastSaleInfo", schema) as Record<string, unknown> | undefined;
      const soldDate = msToDate(lastSaleInfo ? attField(lastSaleInfo, "saleListingLastSaleDate", schema) : undefined);

      // Property / address fields
      const streetNum  = attField(propObj, "streetNumber",        schema);
      const streetName = attField(propObj, "streetName",          schema);
      const streetType = attField(propObj, "streetType",          schema);
      const city       = attField(propObj, "city",                schema);
      const state      = attField(propObj, "stateOrProvinceCode", schema);
      const zip        = attField(propObj, "postalCode",          schema);
      const yearBuilt  = attField(propObj, "yearBuilt",           schema);
      const lotSqft    = attField(propObj, "lotSqFt",             schema);
      const sqft       = attField(propObj, "sqFtFinished",        schema);

      const address = [streetNum, streetName, streetType]
        .map(v => (typeof v === "string" ? v : ""))
        .join(" ").replace(/\s+/g, " ").trim();

      if (!address || typeof city !== "string" || !city) {
        log.warn("RealtyAPI: parseComps — address/city missing after schema extraction", {
          address, city, streetNum, streetName, streetType, propTypeIdx: propObj.__t_idx
        });
        continue;
      }

      const sqftNum      = typeof sqft      === "number" ? sqft      : null;
      const soldPriceNum = typeof soldPrice === "number" ? soldPrice : null;

      result.push({
        address,
        city:         city as string,
        state:        typeof state    === "string" ? state    : "",
        zip:          typeof zip      === "string" ? zip      : "",
        sqft:         sqftNum,
        beds:         typeof beds     === "number" ? beds     : null,
        baths:        typeof baths    === "number" ? baths    : null,
        yearBuilt:    typeof yearBuilt === "number" ? yearBuilt : null,
        lotSqft:      typeof lotSqft  === "number" ? lotSqft  : null,
        listPrice:    typeof listPrice === "number" ? listPrice : null,
        soldPrice:    soldPriceNum,
        soldDate,
        pricePerSqft: soldPriceNum && sqftNum && sqftNum > 0 ? Math.round(soldPriceNum / sqftNum) : null,
      });
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

  // Build schema index from avm.__att_names — used by parseComps for name-based field lookup
  const rawAttNames = (details.avm as Record<string, unknown>)?.__att_names;
  const attSchema = buildAttSchema(rawAttNames);
  if (attSchema.size === 0) {
    log.warn("RealtyAPI: avm.__att_names missing or empty — comp parsing will produce no results", {
      hasAvm: Boolean(details.avm), attNamesType: typeof rawAttNames
    });
  }

  // Comparable sales
  const rawComps = avmRoot?.comparables;
  if (!Array.isArray(rawComps) || rawComps.length === 0) {
    log.warn("RealtyAPI: comparables missing or empty", {
      rawCompsType: typeof rawComps,
      isArray: Array.isArray(rawComps),
      avmRootKeys: avmRoot ? Object.keys(avmRoot).slice(0, 15) : null
    });
  }
  const comps = parseComps(rawComps, attSchema);
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
