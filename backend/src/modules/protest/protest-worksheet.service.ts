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
export type ProtestOutcome = "settled_informal" | "won_arb" | "lost_arb" | "withdrawn";

export type ProtestWorksheetRecord = {
  id: string;
  householdId: string;
  propertyId: string;
  taxYear: number;
  status: ProtestStatus;
  outcome: ProtestOutcome | null;
  informalOfferUsd: number | null;
  hearingDate: string | null;
  filingDeadline: string | null;
  cadPortalUrl: string | null;
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
  outcome: string | null;
  informal_offer_usd: number | null;
  hearing_date: string | Date | null;
  filing_deadline: string | Date | null;
  cad_portal_url: string | null;
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
    outcome: (row.outcome as ProtestOutcome | null) ?? null,
    informalOfferUsd: row.informal_offer_usd != null ? Number(row.informal_offer_usd) : null,
    hearingDate: isoDateOnly(row.hearing_date),
    filingDeadline: isoDateOnly(row.filing_deadline),
    cadPortalUrl: row.cad_portal_url ?? null,
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
    `SELECT id, household_id, property_id, tax_year, status, outcome, informal_offer_usd,
            hearing_date, filing_deadline, cad_portal_url, conversation_json, strategy_json, created_at, updated_at
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
  opts: { hearingDate?: string | null; outcome?: string | null; informalOfferUsd?: number | null } = {}
): Promise<void> {
  const sets: string[] = ["status = ?", "updated_at = NOW()"];
  const params: unknown[] = [status];

  if (opts.hearingDate !== undefined) {
    sets.push("hearing_date = ?");
    params.push(opts.hearingDate);
  }
  if (opts.outcome !== undefined) {
    sets.push("outcome = ?");
    params.push(opts.outcome);
  }
  if (opts.informalOfferUsd !== undefined) {
    sets.push("informal_offer_usd = ?");
    params.push(opts.informalOfferUsd);
  }

  params.push(worksheetId, householdId);
  await qExec(
    `UPDATE protest_worksheet SET ${sets.join(", ")} WHERE id = ? AND household_id = ?`,
    ...params
  );
}

export async function updateWorksheetMeta(
  worksheetId: string,
  householdId: string,
  fields: { filingDeadline?: string | null; cadPortalUrl?: string | null }
): Promise<void> {
  const { filingDeadline, cadPortalUrl } = fields;
  if (filingDeadline === undefined && cadPortalUrl === undefined) return;

  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];

  if (filingDeadline !== undefined) {
    sets.push("filing_deadline = ?");
    params.push(filingDeadline);
  }
  if (cadPortalUrl !== undefined) {
    sets.push("cad_portal_url = ?");
    params.push(cadPortalUrl);
  }

  params.push(worksheetId, householdId);
  await qExec(
    `UPDATE protest_worksheet SET ${sets.join(", ")} WHERE id = ? AND household_id = ?`,
    ...params
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
  const comps = await searchDCADByAddress(address, year, null);
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
