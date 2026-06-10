import { randomUUID } from "node:crypto";
import { qAll, qExec, qGet } from "../../db/query.js";
import { fetchByIds, isRealtyApiConfigured, lookupByAddress, type ValuationDetail } from "./realty-api.service.js";
import { log } from "../../logger.js";
import { saveRedfinComps } from "../protest/protest-worksheet.service.js";

export type PropertyUse = "primary" | "rental" | "vacation";
export type PropertyValueSource = "manual" | "api";

export type PropertyRecord = {
  id: string;
  householdId: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  propertyUse: PropertyUse | null;
  apiProvider: string | null;
  apiPropertyId: string | null;
  apiListingId: string | null;
  valuationDetail: ValuationDetail | null;
  valuationFetchedAt: string | null;
  latestValueUsd: number | null;
  latestValueAsOf: string | null;
  photoUrl: string | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  monthlyRent: number | null;
  propertyNotes: string | null;
  linkedMortgageId: string | null;
  linkedMortgageInstitution: string | null;
  linkedMortgageMask: string | null;
  cadPropertyId: string | null;
  cadAccountId: number | null;
  cadProvider: string | null;
  cadAssessedValueUsd: number | null;
  cadLandValueUsd: number | null;
  cadImprovementValueUsd: number | null;
  cadMarketValueUsd: number | null;
  cadAppraisedValueUsd: number | null;
  cadNetAppraisedValueUsd: number | null;
  cadTaxLimitationValueUsd: number | null;
  cadAppraisalNoticeS3id: string | null;
  cadAppraisalNoticeFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PropertyValueSnapshot = {
  id: string;
  propertyId: string;
  asOfDate: string;
  marketValueUsd: number;
  source: PropertyValueSource;
  apiProvider: string | null;
  createdAt: string;
};

type PropertyRow = {
  id: string;
  household_id: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  property_use: string | null;
  api_provider: string | null;
  api_property_id: string | null;
  api_listing_id: string | null;
  valuation_detail_json: unknown | null;
  valuation_fetched_at: string | null;
  latest_value_usd: string | null;
  latest_value_as_of: string | null;
  photo_url: string | null;
  purchase_price: number | null;
  purchase_date: string | Date | null;
  monthly_rent: number | null;
  property_notes: string | null;
  linked_mortgage_id: string | null;
  linked_mortgage_institution: string | null;
  linked_mortgage_mask: string | null;
  cad_property_id: string | null;
  cad_account_id: number | null;
  cad_provider: string | null;
  cad_assessed_value_usd: number | null;
  cad_land_value_usd: number | null;
  cad_improvement_value_usd: number | null;
  cad_market_value_usd: number | null;
  cad_appraised_value_usd: number | null;
  cad_net_appraised_value_usd: number | null;
  cad_tax_limitation_value_usd: number | null;
  cad_appraisal_notice_s3id: string | null;
  cad_appraisal_notice_fetched_at: string | null;
  created_at: string;
  updated_at: string;
};

function formatPropertyDate(val: string | Date | null | undefined): string | null {
  if (val == null) return null;
  if (typeof val === "string") return val.slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

function toPropertyRecord(row: PropertyRow): PropertyRecord {
  const lv = row.latest_value_usd != null ? Number(row.latest_value_usd) : null;
  return {
    id: row.id,
    householdId: row.household_id,
    addressLine1: row.address_line1,
    city: row.city,
    state: row.state,
    zip: row.zip,
    country: row.country,
    propertyUse: (row.property_use as PropertyUse | null) ?? null,
    apiProvider: row.api_provider,
    apiPropertyId: row.api_property_id,
    apiListingId: row.api_listing_id ?? null,
    valuationDetail: (row.valuation_detail_json as ValuationDetail | null) ?? null,
    valuationFetchedAt: row.valuation_fetched_at ?? null,
    latestValueUsd: lv != null && Number.isFinite(lv) ? lv : null,
    latestValueAsOf: row.latest_value_as_of ?? null,
    photoUrl: row.photo_url ?? null,
    purchasePrice: row.purchase_price ?? null,
    purchaseDate: formatPropertyDate(row.purchase_date),
    monthlyRent: row.monthly_rent ?? null,
    propertyNotes: row.property_notes ?? null,
    linkedMortgageId: row.linked_mortgage_id ?? null,
    linkedMortgageInstitution: row.linked_mortgage_institution ?? null,
    linkedMortgageMask: row.linked_mortgage_mask ?? null,
    cadPropertyId: row.cad_property_id ?? null,
    cadAccountId: row.cad_account_id ?? null,
    cadProvider: row.cad_provider ?? null,
    cadAssessedValueUsd: row.cad_assessed_value_usd != null ? Number(row.cad_assessed_value_usd) : null,
    cadLandValueUsd: row.cad_land_value_usd != null ? Number(row.cad_land_value_usd) : null,
    cadImprovementValueUsd: row.cad_improvement_value_usd != null ? Number(row.cad_improvement_value_usd) : null,
    cadMarketValueUsd: row.cad_market_value_usd != null ? Number(row.cad_market_value_usd) : null,
    cadAppraisedValueUsd: row.cad_appraised_value_usd != null ? Number(row.cad_appraised_value_usd) : null,
    cadNetAppraisedValueUsd: row.cad_net_appraised_value_usd != null ? Number(row.cad_net_appraised_value_usd) : null,
    cadTaxLimitationValueUsd: row.cad_tax_limitation_value_usd != null ? Number(row.cad_tax_limitation_value_usd) : null,
    cadAppraisalNoticeS3id: row.cad_appraisal_notice_s3id ?? null,
    cadAppraisalNoticeFetchedAt: row.cad_appraisal_notice_fetched_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getProperty(
  propertyId: string,
  householdId: string
): Promise<PropertyRecord | null> {
  const row = await qGet<PropertyRow>(
    `SELECT p.*,
            pvs.market_value_usd::text AS latest_value_usd,
            pvs.as_of_date::text       AS latest_value_as_of,
            fa.id                      AS linked_mortgage_id,
            fa.institution             AS linked_mortgage_institution,
            fa.account_mask            AS linked_mortgage_mask
       FROM property p
       LEFT JOIN LATERAL (
         SELECT market_value_usd, as_of_date
           FROM property_value_snapshot
          WHERE property_id = p.id
          ORDER BY as_of_date DESC
          LIMIT 1
       ) pvs ON true
       LEFT JOIN financial_account fa
         ON fa.property_id = p.id
        AND fa.type = 'loan'
        AND fa.sub_type IN ('mortgage_primary', 'mortgage_investment', 'mortgage_vacation')
      WHERE p.id = ? AND p.household_id = ?`,
    propertyId,
    householdId
  );
  return row ? toPropertyRecord(row) : null;
}

export async function listPropertiesForHousehold(householdId: string): Promise<PropertyRecord[]> {
  const rows = await qAll<PropertyRow>(
    `SELECT p.*,
            pvs.market_value_usd::text AS latest_value_usd,
            pvs.as_of_date::text       AS latest_value_as_of
       FROM property p
       LEFT JOIN LATERAL (
         SELECT market_value_usd, as_of_date
           FROM property_value_snapshot
          WHERE property_id = p.id
          ORDER BY as_of_date DESC
          LIMIT 1
       ) pvs ON true
      WHERE p.household_id = ?
      ORDER BY p.created_at`,
    householdId
  );
  return rows.map(toPropertyRecord);
}

export async function createProperty(input: {
  householdId: string;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  propertyUse?: PropertyUse | null;
  purchasePrice?: number | null;
  purchaseDate?: string | null;
  initialValueUsd?: number | null;
  initialValueAsOf?: string | null;
}): Promise<{ id: string }> {
  const id = randomUUID();
  await qExec(
    `INSERT INTO property (id, household_id, address_line1, city, state, zip, property_use, purchase_price, purchase_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    id,
    input.householdId,
    input.addressLine1 ?? null,
    input.city ?? null,
    input.state ?? null,
    input.zip ?? null,
    input.propertyUse ?? null,
    input.purchasePrice ?? null,
    input.purchaseDate ?? null
  );

  if (input.initialValueUsd != null && Number.isFinite(input.initialValueUsd) && input.initialValueUsd >= 0) {
    const asOf = input.initialValueAsOf ?? new Date().toISOString().slice(0, 10);
    await qExec(
      `INSERT INTO property_value_snapshot (id, household_id, property_id, as_of_date, market_value_usd, source, created_at)
       VALUES (?, ?, ?, ?, ?, 'manual', NOW())`,
      randomUUID(),
      input.householdId,
      id,
      asOf,
      input.initialValueUsd
    );
  }

  return { id };
}

export async function updateProperty(
  propertyId: string,
  householdId: string,
  input: {
    addressLine1?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    propertyUse?: PropertyUse | null;
    purchasePrice?: number | null;
    purchaseDate?: string | null;
    monthlyRent?: number | null;
    propertyNotes?: string | null;
  }
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" }> {
  const existing = await qGet<{ id: string }>(
    `SELECT id FROM property WHERE id = ? AND household_id = ?`,
    propertyId,
    householdId
  );
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  const sets: string[] = [];
  const params: unknown[] = [];

  function addCol(column: string, val: unknown | undefined) {
    if (val === undefined) return;
    sets.push(`${column} = ?`);
    params.push(val);
  }

  addCol("address_line1", input.addressLine1);
  addCol("city", input.city);
  addCol("state", input.state);
  addCol("zip", input.zip);
  addCol("property_use", input.propertyUse);
  addCol("purchase_price", input.purchasePrice);
  addCol("purchase_date", input.purchaseDate);
  addCol("monthly_rent", input.monthlyRent);
  addCol("property_notes", input.propertyNotes);

  if (sets.length === 0) return { ok: true };

  sets.push("updated_at = NOW()");
  params.push(propertyId, householdId);

  await qExec(
    `UPDATE property SET ${sets.join(", ")} WHERE id = ? AND household_id = ?`,
    ...params
  );
  return { ok: true };
}

export async function addPropertyValueSnapshot(
  propertyId: string,
  householdId: string,
  input: {
    marketValueUsd: number;
    asOfDate: string;
    source?: PropertyValueSource;
    apiProvider?: string | null;
  }
): Promise<{ ok: true; id: string } | { ok: false; code: "NOT_FOUND" | "INVALID_VALUE" }> {
  const exists = await qGet<{ id: string }>(
    `SELECT id FROM property WHERE id = ? AND household_id = ?`,
    propertyId,
    householdId
  );
  if (!exists) return { ok: false, code: "NOT_FOUND" };
  if (!Number.isFinite(input.marketValueUsd) || input.marketValueUsd < 0) {
    return { ok: false, code: "INVALID_VALUE" };
  }

  const id = randomUUID();
  await qExec(
    `INSERT INTO property_value_snapshot (id, household_id, property_id, as_of_date, market_value_usd, source, api_provider, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (property_id, as_of_date)
     DO UPDATE SET market_value_usd = EXCLUDED.market_value_usd,
                   source = EXCLUDED.source,
                   api_provider = EXCLUDED.api_provider`,
    id,
    householdId,
    propertyId,
    input.asOfDate,
    input.marketValueUsd,
    input.source ?? "manual",
    input.apiProvider ?? null
  );
  return { ok: true, id };
}

export async function listPropertyValueSnapshots(
  propertyId: string,
  householdId: string
): Promise<PropertyValueSnapshot[]> {
  const rows = await qAll<{
    id: string;
    property_id: string;
    as_of_date: string;
    market_value_usd: string;
    source: string;
    api_provider: string | null;
    created_at: string;
  }>(
    `SELECT pvs.id, pvs.property_id, pvs.as_of_date::text, pvs.market_value_usd::text,
            pvs.source, pvs.api_provider, pvs.created_at::text
       FROM property_value_snapshot pvs
       JOIN property p ON p.id = pvs.property_id
      WHERE pvs.property_id = ? AND p.household_id = ?
      ORDER BY pvs.as_of_date ASC`,
    propertyId,
    householdId
  );
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    asOfDate: r.as_of_date,
    marketValueUsd: Number(r.market_value_usd),
    source: r.source as PropertyValueSource,
    apiProvider: r.api_provider,
    createdAt: r.created_at
  }));
}

/**
 * Refresh property valuation via RealtyAPI.
 *
 * - If the property already has api_property_id stored: uses cheap /detailsbyid (1 credit).
 * - Otherwise: uses /property/address (2 credits), stores the returned IDs for future calls.
 * - Always writes a new property_value_snapshot and updates valuation_detail_json.
 */
export async function refreshPropertyValuation(
  propertyId: string,
  householdId: string
): Promise<
  | { ok: true; estimate: number; fetchedAt: string }
  | { ok: false; code: "NOT_FOUND" | "NO_ADDRESS" | "API_NOT_CONFIGURED" | "API_ERROR" | "RATE_LIMITED"; message: string }
> {
  if (!isRealtyApiConfigured()) {
    return { ok: false, code: "API_NOT_CONFIGURED", message: "REALTYAPI_KEY not configured" };
  }

  const prop = await qGet<{
    id: string;
    address_line1: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    api_property_id: string | null;
    api_listing_id: string | null;
    valuation_fetched_at: string | null;
  }>(
    `SELECT id, address_line1, city, state, zip, api_property_id, api_listing_id, valuation_fetched_at
       FROM property WHERE id = ? AND household_id = ?`,
    propertyId,
    householdId
  );
  if (!prop) return { ok: false, code: "NOT_FOUND", message: "Property not found" };

  if (prop.valuation_fetched_at) {
    const ageMs = Date.now() - new Date(prop.valuation_fetched_at).getTime();
    if (ageMs < 7 * 24 * 60 * 60 * 1000) {
      return { ok: false, code: "RATE_LIMITED", message: "Valuation refreshed within the last 7 days — try again later." };
    }
  }

  let result;
  try {
    if (prop.api_property_id) {
      result = await fetchByIds(prop.api_property_id, prop.api_listing_id);
    } else {
      const parts = [prop.address_line1, prop.city, prop.state, prop.zip].filter(Boolean);
      if (parts.length < 3) {
        return { ok: false, code: "NO_ADDRESS", message: "Property address incomplete — add street, city, state, zip first" };
      }
      const address = parts.join(", ");
      result = await lookupByAddress(address);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("refreshPropertyValuation: API error", { propertyId, err: msg });
    return { ok: false, code: "API_ERROR", message: msg };
  }

  const today = new Date().toISOString().slice(0, 10);

  // Persist IDs for future 1-credit calls
  await qExec(
    `UPDATE property
        SET api_provider           = 'redfin',
            api_property_id        = ?,
            api_listing_id         = ?,
            valuation_detail_json  = ?,
            photo_url              = ?,
            valuation_fetched_at   = NOW(),
            updated_at             = NOW()
      WHERE id = ? AND household_id = ?`,
    result.apiPropertyId,
    result.apiListingId,
    result.detail,
    result.detail.photoUrl ?? null,
    propertyId,
    householdId
  );

  // Write snapshot (upsert on date — overwrite if same day)
  await addPropertyValueSnapshot(propertyId, householdId, {
    marketValueUsd: result.estimate,
    asOfDate: today,
    source: "api",
    apiProvider: "redfin"
  });

  log.info("refreshPropertyValuation: done", { propertyId, estimate: result.estimate, compsCount: result.detail.comps.length });

  // Save Redfin comps to protest_comp for unified protest view
  if (result.detail.comps.length > 0) {
    const taxYear = new Date().getUTCFullYear();
    void saveRedfinComps(
      propertyId,
      householdId,
      taxYear,
      result.detail.comps.map((c) => ({
        address: c.address,
        city: c.city,
        state: c.state,
        zip: c.zip,
        sqft: c.sqft,
        beds: c.beds,
        baths: c.baths,
        yearBuilt: c.yearBuilt,
        lotSqft: c.lotSqft,
        soldPrice: c.soldPrice,
        listPrice: c.listPrice,
        soldDate: c.soldDate,
        pricePerSqft: c.pricePerSqft,
        raw: c as unknown,
      }))
    ).catch((err) => {
      log.warn("refreshPropertyValuation: saveRedfinComps failed", {
        propertyId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return { ok: true, estimate: result.estimate, fetchedAt: today };
}

export type EquityHistoryPoint = {
  date: string;
  avm: number;
  mortgageBalance: number;
  equity: number;
};

export async function getEquityHistory(
  propertyId: string,
  householdId: string
): Promise<EquityHistoryPoint[]> {
  const rows = await qAll<{
    date: string;
    avm: string;
    mortgage_balance: string;
    equity: string;
  }>(
    `SELECT pvs.as_of_date::text AS date,
            pvs.market_value_usd::text AS avm,
            COALESCE(bal.amount, 0)::text AS mortgage_balance,
            (pvs.market_value_usd - COALESCE(bal.amount, 0))::text AS equity
       FROM property_value_snapshot pvs
       JOIN property p ON p.id = pvs.property_id AND p.household_id = ?
       LEFT JOIN financial_account fa
         ON fa.property_id = pvs.property_id
        AND fa.household_id = ?
        AND fa.type = 'loan'
        AND fa.sub_type IN ('mortgage_primary', 'mortgage_investment', 'mortgage_vacation')
       LEFT JOIN LATERAL (
         SELECT amount FROM account_balance_snapshot abs
          WHERE abs.financial_account_id = fa.id
            AND abs.as_of_date <= pvs.as_of_date
          ORDER BY abs.as_of_date DESC
          LIMIT 1
       ) bal ON true
      WHERE pvs.property_id = ?
      ORDER BY pvs.as_of_date ASC`,
    householdId,
    householdId,
    propertyId
  );
  return rows.map((r) => ({
    date: r.date,
    avm: Number(r.avm),
    mortgageBalance: Number(r.mortgage_balance),
    equity: Number(r.equity)
  }));
}

export async function deleteProperty(
  propertyId: string,
  householdId: string
): Promise<{ ok: true; unlinkedAccounts: number } | { ok: false; code: "NOT_FOUND" }> {
  const exists = await qGet<{ id: string }>(
    `SELECT id FROM property WHERE id = ? AND household_id = ?`,
    propertyId,
    householdId
  );
  if (!exists) return { ok: false, code: "NOT_FOUND" };

  const linked = await qGet<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM financial_account WHERE property_id = ? AND household_id = ?`,
    propertyId,
    householdId
  );
  const unlinkedAccounts = Number(linked?.cnt ?? 0);

  await qExec(
    `DELETE FROM property WHERE id = ? AND household_id = ?`,
    propertyId,
    householdId
  );

  return { ok: true, unlinkedAccounts };
}

export async function updatePropertyAppraisalNotice(
  propertyId: string,
  householdId: string,
  s3id: string
): Promise<void> {
  await qExec(
    `UPDATE property
        SET cad_appraisal_notice_s3id = ?,
            cad_appraisal_notice_fetched_at = NOW(),
            updated_at = NOW()
      WHERE id = ? AND household_id = ?`,
    s3id,
    propertyId,
    householdId
  );
}

/**
 * Preview valuation by address string without creating a property record.
 * Used by the "Retrieve value" button on the Add Property modal (pre-save).
 * Returns the estimate and Redfin IDs so the caller can pass them through on save.
 */
export async function previewValuationByAddress(address: string): Promise<
  | { ok: true; estimate: number; apiPropertyId: string; apiListingId: string | null; detail: ValuationDetail }
  | { ok: false; code: "API_NOT_CONFIGURED" | "API_ERROR"; message: string }
> {
  if (!isRealtyApiConfigured()) {
    return { ok: false, code: "API_NOT_CONFIGURED", message: "REALTYAPI_KEY not configured" };
  }
  try {
    const result = await lookupByAddress(address);
    return { ok: true, estimate: result.estimate, apiPropertyId: result.apiPropertyId, apiListingId: result.apiListingId, detail: result.detail };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("previewValuationByAddress: API error", { address, err: msg });
    return { ok: false, code: "API_ERROR", message: msg };
  }
}
