import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";
import { searchDCADByAddress, type DCADProperty } from "./dcad.service.js";
import { log } from "../../logger.js";

export type ConversationTurn = {
  role: "user" | "assistant" | "tool";
  content: string;
  ts: string;
  attachmentType?: "pdf" | "url" | "text";
};

export type StrategyJson = {
  caseStrength: number;
  targetValueUsd: number;
  primaryStrategy: string;
  draftArguments: string[];
  redFlags: string[];
};

export type ProtestStatus = "not_filed" | "filed" | "informal" | "arb" | "resolved";

export type ProtestWorksheetRecord = {
  id: string;
  householdId: string;
  propertyId: string;
  taxYear: number;
  status: ProtestStatus;
  hearingDate: string | null;
  conversationJson: ConversationTurn[];
  strategyJson: StrategyJson | null;
  createdAt: string;
  updatedAt: string;
};

type ProtestWorksheetRow = {
  id: string;
  household_id: string;
  property_id: string;
  tax_year: number;
  status: ProtestStatus;
  hearing_date: string | Date | null;
  conversation_json: unknown;
  strategy_json: unknown;
  created_at: string | Date;
  updated_at: string | Date;
};

function isoDateOnly(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function isoDateTime(value: string | Date): string {
  if (typeof value === "string") return value;
  return value.toISOString();
}

function rowToRecord(row: ProtestWorksheetRow): ProtestWorksheetRecord {
  return {
    id: row.id,
    householdId: row.household_id,
    propertyId: row.property_id,
    taxYear: row.tax_year,
    status: row.status,
    hearingDate: isoDateOnly(row.hearing_date),
    conversationJson: Array.isArray(row.conversation_json) ? (row.conversation_json as ConversationTurn[]) : [],
    strategyJson: row.strategy_json && typeof row.strategy_json === "object" ? (row.strategy_json as StrategyJson) : null,
    createdAt: isoDateTime(row.created_at),
    updatedAt: isoDateTime(row.updated_at)
  };
}

export async function getWorksheet(
  propertyId: string,
  householdId: string,
  taxYear: number
): Promise<ProtestWorksheetRecord | null> {
  const row = await qGet<ProtestWorksheetRow>(
    `SELECT id, household_id, property_id, tax_year, status, hearing_date, conversation_json, strategy_json, created_at, updated_at
       FROM protest_worksheet
      WHERE property_id = ? AND household_id = ? AND tax_year = ?`,
    propertyId,
    householdId,
    taxYear
  );
  return row ? rowToRecord(row) : null;
}

export async function getOrCreateWorksheet(
  propertyId: string,
  householdId: string,
  taxYear: number
): Promise<ProtestWorksheetRecord> {
  const existing = await getWorksheet(propertyId, householdId, taxYear);
  if (existing) return existing;
  const id = randomUUID();
  await qExec(
    `INSERT INTO protest_worksheet (id, household_id, property_id, tax_year, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    id,
    householdId,
    propertyId,
    taxYear
  );
  const created = await getWorksheet(propertyId, householdId, taxYear);
  if (!created) {
    throw new Error("Failed to create worksheet");
  }
  return created;
}

export async function updateWorksheetStatus(
  worksheetId: string,
  householdId: string,
  status: ProtestStatus,
  hearingDate?: string | null
): Promise<void> {
  if (hearingDate === undefined) {
    await qExec(
      `UPDATE protest_worksheet
          SET status = ?, updated_at = NOW()
        WHERE id = ? AND household_id = ?`,
      status,
      worksheetId,
      householdId
    );
    return;
  }
  await qExec(
    `UPDATE protest_worksheet
        SET status = ?, hearing_date = ?, updated_at = NOW()
      WHERE id = ? AND household_id = ?`,
    status,
    hearingDate,
    worksheetId,
    householdId
  );
}

export async function appendConversationTurn(worksheetId: string, turn: ConversationTurn): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet
        SET conversation_json = conversation_json || ?,
            updated_at = NOW()
      WHERE id = ?`,
    [turn],
    worksheetId
  );
}

export async function updateStrategy(worksheetId: string, strategy: StrategyJson): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet
        SET strategy_json = ?,
            updated_at = NOW()
      WHERE id = ?`,
    strategy,
    worksheetId
  );
}

export async function saveCADComps(
  propertyId: string,
  householdId: string,
  taxYear: number,
  comps: DCADProperty[]
): Promise<number> {
  for (const comp of comps) {
    await qExec(
      `INSERT INTO protest_comp_cad
        (id, household_id, property_id, tax_year, dcad_property_id, address_line1, city, assessed_value_usd,
         market_value_usd, sqft, beds, baths, year_built, per_sqft_usd, raw_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT (property_id, tax_year, dcad_property_id)
       DO UPDATE SET
         address_line1 = EXCLUDED.address_line1,
         city = EXCLUDED.city,
         assessed_value_usd = EXCLUDED.assessed_value_usd,
         market_value_usd = EXCLUDED.market_value_usd,
         sqft = EXCLUDED.sqft,
         beds = EXCLUDED.beds,
         baths = EXCLUDED.baths,
         year_built = EXCLUDED.year_built,
         per_sqft_usd = EXCLUDED.per_sqft_usd,
         raw_json = EXCLUDED.raw_json,
         fetched_at = NOW()`,
      randomUUID(),
      householdId,
      propertyId,
      taxYear,
      comp.dcadPropertyId,
      comp.address,
      comp.city,
      comp.assessedValue,
      comp.marketValue,
      comp.sqft,
      comp.beds,
      comp.baths,
      comp.yearBuilt,
      comp.assessedValue != null && comp.sqft != null && comp.sqft > 0 ? comp.assessedValue / comp.sqft : null,
      comp.raw
    );
  }
  return comps.length;
}

/**
 * Async DCAD data fetch triggered at property creation for TX properties.
 * Called fire-and-forget — errors are logged but do not block the create response.
 */
export async function triggerDCADBackfill(
  propertyId: string,
  householdId: string,
  address: string
): Promise<void> {
  const year = new Date().getUTCFullYear();
  log.info("triggerDCADBackfill: starting", { propertyId, address, year });
  const comps = await searchDCADByAddress(address, year);
  if (comps.length > 0) {
    await getOrCreateWorksheet(propertyId, householdId, year);
    await saveCADComps(propertyId, householdId, year, comps);
    log.info("triggerDCADBackfill: done", { propertyId, year, count: comps.length });
  } else {
    log.info("triggerDCADBackfill: no comps found", { propertyId, address });
  }
}

export type ProtestComp = {
  dcadPropertyId: string;
  addressLine1: string | null;
  city: string | null;
  assessedValueUsd: number | null;
  marketValueUsd: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  perSqftUsd: number | null;
};

type CompRow = {
  dcad_property_id: string;
  address_line1: string | null;
  city: string | null;
  assessed_value_usd: number | null;
  market_value_usd: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  year_built: number | null;
  per_sqft_usd: number | null;
};

export async function listWorksheetComps(
  propertyId: string,
  householdId: string,
  taxYear: number
): Promise<ProtestComp[]> {
  const rows = await qAll<CompRow>(
    `SELECT dcad_property_id, address_line1, city, assessed_value_usd, market_value_usd,
            sqft, beds, baths, year_built, per_sqft_usd
       FROM protest_comp_cad
      WHERE household_id = ? AND property_id = ? AND tax_year = ?
      ORDER BY fetched_at DESC`,
    householdId,
    propertyId,
    taxYear
  );
  return rows.map((r) => ({
    dcadPropertyId: r.dcad_property_id,
    addressLine1: r.address_line1,
    city: r.city,
    assessedValueUsd: r.assessed_value_usd != null ? Number(r.assessed_value_usd) : null,
    marketValueUsd: r.market_value_usd != null ? Number(r.market_value_usd) : null,
    sqft: r.sqft != null ? Number(r.sqft) : null,
    beds: r.beds != null ? Number(r.beds) : null,
    baths: r.baths != null ? Number(r.baths) : null,
    yearBuilt: r.year_built,
    perSqftUsd: r.per_sqft_usd != null ? Number(r.per_sqft_usd) : null
  }));
}
