import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";
import type { ArbScript } from "./arb-script.service.js";
import { log } from "../../logger.js";
import type { CadProperty } from "./cad-adapters/cad-adapter.types.js";
import { getCadAdapter, inferCadProvider } from "./cad-adapters/registry.js";
import type { CadEvidenceData } from "./cad-evidence-parser.service.js";

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

export type SoldCompCadEntry = {
  cadPropertyId: string;
  cadAccountId: number | null;
  assessedValueUsd: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
};

export type ManualSoldComp = {
  id: string;
  address: string;
  soldPrice: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  soldDate: string | null;
  yearBuilt: number | null;
  assessedValueUsd: number | null;
  cadPropertyId: string | null;
  cadAccountId: number | null;
};

export type { CadEvidenceData };

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
  soldCompsCadJson: Record<string, SoldCompCadEntry>;
  cadEvidenceJson: CadEvidenceData | null;
  cadEvidenceFilename: string | null;
  soldCompsNotesJson: Record<string, string>;
  manualSoldComps: ManualSoldComp[];
  summarizationCursor: number;
  conversationSummary: string | null;
  cycleSummary: string | null;
  arbScriptJson: ArbScript | null;
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
  sold_comps_cad_json: unknown;
  cad_evidence_json: unknown;
  cad_evidence_filename: string | null;
  sold_comps_notes_json: unknown;
  manual_sold_comps_json: unknown;
  summarization_cursor: number;
  conversation_summary: string | null;
  cycle_summary: string | null;
  arb_script_json: unknown;
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
    soldCompsCadJson: (row.sold_comps_cad_json && typeof row.sold_comps_cad_json === "object" && !Array.isArray(row.sold_comps_cad_json))
      ? (row.sold_comps_cad_json as Record<string, SoldCompCadEntry>)
      : {},
    cadEvidenceJson: (row.cad_evidence_json && typeof row.cad_evidence_json === "object" && !Array.isArray(row.cad_evidence_json) && Object.keys(row.cad_evidence_json as object).length > 0)
      ? (row.cad_evidence_json as CadEvidenceData)
      : null,
    cadEvidenceFilename: row.cad_evidence_filename ?? null,
    soldCompsNotesJson: (row.sold_comps_notes_json && typeof row.sold_comps_notes_json === "object" && !Array.isArray(row.sold_comps_notes_json))
      ? (row.sold_comps_notes_json as Record<string, string>)
      : {},
    manualSoldComps: Array.isArray(row.manual_sold_comps_json)
      ? (row.manual_sold_comps_json as ManualSoldComp[])
      : [],
    summarizationCursor: row.summarization_cursor ?? 0,
    conversationSummary: row.conversation_summary ?? null,
    cycleSummary: row.cycle_summary ?? null,
    arbScriptJson: (row.arb_script_json && typeof row.arb_script_json === "object" && !Array.isArray(row.arb_script_json))
      ? (row.arb_script_json as ArbScript)
      : null,
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
            hearing_date, filing_deadline, cad_portal_url, conversation_json, strategy_json,
            sold_comps_cad_json, cad_evidence_json, cad_evidence_filename, sold_comps_notes_json,
            manual_sold_comps_json, summarization_cursor, conversation_summary, cycle_summary,
            arb_script_json, created_at, updated_at
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

export async function updateSummarizationState(
  worksheetId: string,
  cursor: number,
  summary: string
): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet
        SET summarization_cursor = ?, conversation_summary = ?, updated_at = NOW()
      WHERE id = ?`,
    cursor,
    summary,
    worksheetId
  );
}

export async function saveCycleSummary(worksheetId: string, summary: string): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet SET cycle_summary = ?, updated_at = NOW() WHERE id = ?`,
    summary,
    worksheetId
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
  comps: CadProperty[]
): Promise<number> {
  for (const comp of comps) {
    await qExec(
      `INSERT INTO protest_comp_cad
        (id, household_id, property_id, tax_year, cad_property_id, address_line1, city, assessed_value_usd,
         market_value_usd, sqft, beds, baths, year_built, per_sqft_usd, raw_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT (property_id, tax_year, cad_property_id)
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
      comp.cadPropertyId,
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
 * Async CAD data fetch triggered at property creation. Infers adapter from state.
 * Called fire-and-forget — errors are logged but do not block the create response.
 */
export async function triggerCadBackfill(
  propertyId: string,
  householdId: string,
  address: string,
  state?: string | null
): Promise<void> {
  const provider = inferCadProvider(state);
  if (!provider) {
    log.info("triggerCadBackfill: no adapter for state", { propertyId, state });
    return;
  }
  const adapter = getCadAdapter(provider);
  if (!adapter) return;

  const year = new Date().getUTCFullYear();
  log.info("triggerCadBackfill: starting", { propertyId, address, year, provider });
  const comps = await adapter.searchByAddress(address, year);
  if (comps.length > 0) {
    await getOrCreateWorksheet(propertyId, householdId, year);
    await saveCADComps(propertyId, householdId, year, comps);
    await saveCadSubjectIds(propertyId, provider, comps, address);
    log.info("triggerCadBackfill: done", { propertyId, year, count: comps.length, provider });
  } else {
    log.info("triggerCadBackfill: no comps found", { propertyId, address, provider });
  }
}

/** Identify subject property in CAD search results and persist its IDs on the property row. */
export async function saveCadSubjectIds(
  propertyId: string,
  cadProvider: string,
  comps: CadProperty[],
  searchAddress: string
): Promise<void> {
  const houseNum = searchAddress.match(/^\d+/)?.[0];
  const subject = houseNum
    ? (comps.find((c) => c.address != null && c.address.startsWith(houseNum)) ?? comps[0])
    : comps[0];
  if (!subject?.accountId) return;
  await qExec(
    `UPDATE property SET cad_property_id = ?, cad_account_id = ?, cad_provider = ? WHERE id = ?`,
    subject.cadPropertyId,
    subject.accountId,
    cadProvider,
    propertyId
  );
  log.info("saveCadSubjectIds: stored", { propertyId, cadPropertyId: subject.cadPropertyId, cadAccountId: subject.accountId, cadProvider });
}

export async function saveSoldCompsCadCache(
  propertyId: string,
  householdId: string,
  taxYear: number,
  cache: Record<string, SoldCompCadEntry>
): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet
        SET sold_comps_cad_json = ?,
            updated_at = NOW()
      WHERE property_id = ? AND household_id = ? AND tax_year = ?`,
    cache,
    propertyId,
    householdId,
    taxYear
  );
}

export type ProtestComp = {
  cadPropertyId: string;
  addressLine1: string | null;
  city: string | null;
  assessedValueUsd: number | null;
  marketValueUsd: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  perSqftUsd: number | null;
  notes: string | null;
};

type CompRow = {
  cad_property_id: string;
  address_line1: string | null;
  city: string | null;
  assessed_value_usd: number | null;
  market_value_usd: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  year_built: number | null;
  per_sqft_usd: number | null;
  notes: string | null;
};

export async function deleteCADComp(
  propertyId: string,
  householdId: string,
  taxYear: number,
  cadPropertyId: string
): Promise<void> {
  await qExec(
    `DELETE FROM protest_comp_cad WHERE property_id = ? AND household_id = ? AND tax_year = ? AND cad_property_id = ?`,
    propertyId,
    householdId,
    taxYear,
    cadPropertyId
  );
}

export type ManualComp = {
  addressLine1: string;
  city?: string | null;
  sqft?: number | null;
  beds?: number | null;
  baths?: number | null;
  yearBuilt?: number | null;
  assessedValueUsd?: number | null;
  marketValueUsd?: number | null;
};

export async function addCADComp(
  propertyId: string,
  householdId: string,
  taxYear: number,
  comp: ManualComp,
  existingCadPropertyId?: string
): Promise<string> {
  const id = randomUUID();
  const cadPropertyId = existingCadPropertyId ?? `manual-${randomUUID()}`;
  const rawJson = existingCadPropertyId ? {} : { manual: true };
  const perSqft =
    comp.assessedValueUsd != null && comp.sqft != null && comp.sqft > 0
      ? comp.assessedValueUsd / comp.sqft
      : null;
  await qExec(
    `INSERT INTO protest_comp_cad
      (id, household_id, property_id, tax_year, cad_property_id, address_line1, city, assessed_value_usd,
       market_value_usd, sqft, beds, baths, year_built, per_sqft_usd, raw_json, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    id,
    householdId,
    propertyId,
    taxYear,
    cadPropertyId,
    comp.addressLine1,
    comp.city ?? null,
    comp.assessedValueUsd ?? null,
    comp.marketValueUsd ?? null,
    comp.sqft ?? null,
    comp.beds ?? null,
    comp.baths ?? null,
    comp.yearBuilt ?? null,
    perSqft,
    rawJson
  );
  return cadPropertyId;
}

export async function setExcludedSoldComps(
  worksheetId: string,
  householdId: string,
  excluded: string[]
): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet SET excluded_sold_comps_json = ?, updated_at = NOW() WHERE id = ? AND household_id = ?`,
    JSON.stringify(excluded),
    worksheetId,
    householdId
  );
}

export async function getExcludedSoldComps(
  propertyId: string,
  householdId: string,
  taxYear: number
): Promise<string[]> {
  const row = await qGet<{ excluded_sold_comps_json: string | null }>(
    `SELECT excluded_sold_comps_json FROM protest_worksheet WHERE property_id = ? AND household_id = ? AND tax_year = ?`,
    propertyId,
    householdId,
    taxYear
  );
  if (!row?.excluded_sold_comps_json) return [];
  try {
    const parsed = JSON.parse(row.excluded_sold_comps_json) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export async function listWorksheetComps(
  propertyId: string,
  householdId: string,
  taxYear: number
): Promise<ProtestComp[]> {
  const rows = await qAll<CompRow>(
    `SELECT cad_property_id, address_line1, city, assessed_value_usd, market_value_usd,
            sqft, beds, baths, year_built, per_sqft_usd, notes
       FROM protest_comp_cad
      WHERE household_id = ? AND property_id = ? AND tax_year = ?
      ORDER BY fetched_at DESC`,
    householdId,
    propertyId,
    taxYear
  );
  return rows.map((r) => ({
    cadPropertyId: r.cad_property_id,
    addressLine1: r.address_line1,
    city: r.city,
    assessedValueUsd: r.assessed_value_usd != null ? Number(r.assessed_value_usd) : null,
    marketValueUsd: r.market_value_usd != null ? Number(r.market_value_usd) : null,
    sqft: r.sqft != null ? Number(r.sqft) : null,
    beds: r.beds != null ? Number(r.beds) : null,
    baths: r.baths != null ? Number(r.baths) : null,
    yearBuilt: r.year_built,
    perSqftUsd: r.per_sqft_usd != null ? Number(r.per_sqft_usd) : null,
    notes: r.notes ?? null,
  }));
}

export async function saveCadEvidence(
  propertyId: string,
  householdId: string,
  taxYear: number,
  data: CadEvidenceData,
  filename: string
): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet
        SET cad_evidence_json = ?,
            cad_evidence_filename = ?,
            updated_at = NOW()
      WHERE property_id = ? AND household_id = ? AND tax_year = ?`,
    data,
    filename,
    propertyId,
    householdId,
    taxYear
  );
}

export async function deleteCadEvidence(
  propertyId: string,
  householdId: string,
  taxYear: number
): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet
        SET cad_evidence_json = '{}'::jsonb,
            cad_evidence_filename = NULL,
            updated_at = NOW()
      WHERE property_id = ? AND household_id = ? AND tax_year = ?`,
    propertyId,
    householdId,
    taxYear
  );
}

export async function saveSoldCompNote(
  propertyId: string,
  householdId: string,
  taxYear: number,
  address: string,
  notes: string
): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet
        SET sold_comps_notes_json = jsonb_set(
              COALESCE(sold_comps_notes_json, '{}'::jsonb),
              ARRAY[?::text],
              to_jsonb(?::text),
              true
            ),
            updated_at = NOW()
      WHERE property_id = ? AND household_id = ? AND tax_year = ?`,
    address,
    notes,
    propertyId,
    householdId,
    taxYear
  );
}

export async function updateCompNote(
  propertyId: string,
  householdId: string,
  taxYear: number,
  cadPropertyId: string,
  notes: string
): Promise<void> {
  await qExec(
    `UPDATE protest_comp_cad
        SET notes = ?
      WHERE property_id = ? AND household_id = ? AND tax_year = ? AND cad_property_id = ?`,
    notes || null,
    propertyId,
    householdId,
    taxYear,
    cadPropertyId
  );
}

export async function saveArbScript(
  propertyId: string,
  householdId: string,
  taxYear: number,
  script: ArbScript
): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet
        SET arb_script_json = ?,
            updated_at = NOW()
      WHERE property_id = ? AND household_id = ? AND tax_year = ?`,
    script,
    propertyId,
    householdId,
    taxYear
  );
}

export async function saveManualSoldComps(
  propertyId: string,
  householdId: string,
  taxYear: number,
  comps: ManualSoldComp[]
): Promise<void> {
  await qExec(
    `UPDATE protest_worksheet
        SET manual_sold_comps_json = ?,
            updated_at = NOW()
      WHERE property_id = ? AND household_id = ? AND tax_year = ?`,
    comps,
    propertyId,
    householdId,
    taxYear
  );
}

export async function addManualSoldComp(
  propertyId: string,
  householdId: string,
  taxYear: number,
  comp: Omit<ManualSoldComp, "id">
): Promise<ManualSoldComp> {
  const ws = await getOrCreateWorksheet(propertyId, householdId, taxYear);
  const newComp: ManualSoldComp = { id: randomUUID(), ...comp };
  const updated = [...ws.manualSoldComps, newComp];
  await saveManualSoldComps(propertyId, householdId, taxYear, updated);
  return newComp;
}

export async function removeManualSoldComp(
  propertyId: string,
  householdId: string,
  taxYear: number,
  compId: string
): Promise<void> {
  const ws = await getWorksheet(propertyId, householdId, taxYear);
  if (!ws) return;
  const updated = ws.manualSoldComps.filter((c) => c.id !== compId);
  await saveManualSoldComps(propertyId, householdId, taxYear, updated);
}
