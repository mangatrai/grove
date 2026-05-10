import { randomUUID } from "node:crypto";
import { qAll, qExec, qGet } from "../../db/query.js";

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
  latestValueUsd: number | null;
  latestValueAsOf: string | null;
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
  latest_value_usd: string | null;
  latest_value_as_of: string | null;
  created_at: string;
  updated_at: string;
};

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
    latestValueUsd: lv != null && Number.isFinite(lv) ? lv : null,
    latestValueAsOf: row.latest_value_as_of ?? null,
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
            pvs.as_of_date::text       AS latest_value_as_of
       FROM property p
       LEFT JOIN LATERAL (
         SELECT market_value_usd, as_of_date
           FROM property_value_snapshot
          WHERE property_id = p.id
          ORDER BY as_of_date DESC
          LIMIT 1
       ) pvs ON true
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
  initialValueUsd?: number | null;
  initialValueAsOf?: string | null;
}): Promise<{ id: string }> {
  const id = randomUUID();
  await qExec(
    `INSERT INTO property (id, household_id, address_line1, city, state, zip, property_use, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    id,
    input.householdId,
    input.addressLine1 ?? null,
    input.city ?? null,
    input.state ?? null,
    input.zip ?? null,
    input.propertyUse ?? null
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
  }
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" }> {
  const existing = await qGet<{ id: string }>(
    `SELECT id FROM property WHERE id = ? AND household_id = ?`,
    propertyId,
    householdId
  );
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  await qExec(
    `UPDATE property
        SET address_line1 = ?, city = ?, state = ?, zip = ?, property_use = ?, updated_at = NOW()
      WHERE id = ? AND household_id = ?`,
    input.addressLine1 ?? null,
    input.city ?? null,
    input.state ?? null,
    input.zip ?? null,
    input.propertyUse ?? null,
    propertyId,
    householdId
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
