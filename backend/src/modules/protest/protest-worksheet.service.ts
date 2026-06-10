import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";
import type { ArbScript } from "./arb-script.service.js";
import { log } from "../../logger.js";
import type { CadEvidenceData } from "./cad-evidence-parser.service.js";
import { searchDCADByAddress, getDCADImprovementFeatures } from "./dcad.service.js";
import { fetchDcadCanonical, fetchDcadAppeal } from "./dcad-enrichment.service.js";

export type { CadEvidenceData };

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

export type CompSource = "dcad_search" | "redfin" | "manual" | "cad_evidence";

export type UnifiedComp = {
  id: string;
  source: CompSource;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSqft: number | null;
  hasPool: boolean | null;
  cadPropertyId: string | null;
  cadAccountId: number | null;
  cadLandValueUsd: number | null;
  cadImprovementValueUsd: number | null;
  cadMarketValueUsd: number | null;
  cadAssessedValueUsd: number | null;
  cadPerSqftAssessed: number | null;
  cadDeedDate: string | null;
  cadEnrichedAt: string | null;
  soldPriceUsd: number | null;
  listPriceUsd: number | null;
  soldDate: string | null;
  pricePerSqft: number | null;
  notes: string | null;
  excluded: boolean;
  fetchedAt: string;
};

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
  cadEvidenceJson: CadEvidenceData | null;
  cadEvidenceFilename: string | null;
  appealJson: unknown[] | null;
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
  cad_evidence_json: unknown;
  cad_evidence_filename: string | null;
  appeal_json: unknown;
  summarization_cursor: number;
  conversation_summary: string | null;
  cycle_summary: string | null;
  arb_script_json: unknown;
  created_at: string | Date;
  updated_at: string | Date;
};

type CompRow = {
  id: string;
  source: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sqft: string | null;
  beds: string | null;
  baths: string | null;
  year_built: number | null;
  lot_sqft: string | null;
  has_pool: boolean | null;
  cad_property_id: string | null;
  cad_account_id: number | null;
  cad_land_value_usd: number | null;
  cad_improvement_value_usd: number | null;
  cad_market_value_usd: number | null;
  cad_assessed_value_usd: number | null;
  cad_per_sqft_assessed: string | null;
  cad_deed_date: string | null;
  cad_enriched_at: string | null;
  sold_price_usd: number | null;
  list_price_usd: number | null;
  sold_date: string | null;
  price_per_sqft: string | null;
  notes: string | null;
  excluded: boolean;
  fetched_at: string;
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

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
    cadEvidenceJson: (row.cad_evidence_json && typeof row.cad_evidence_json === "object" && !Array.isArray(row.cad_evidence_json) && Object.keys(row.cad_evidence_json as object).length > 0)
      ? (row.cad_evidence_json as CadEvidenceData)
      : null,
    cadEvidenceFilename: row.cad_evidence_filename ?? null,
    appealJson: Array.isArray(row.appeal_json) ? (row.appeal_json as unknown[]) : null,
    summarizationCursor: row.summarization_cursor ?? 0,
    conversationSummary: row.conversation_summary ?? null,
    cycleSummary: row.cycle_summary ?? null,
    arbScriptJson: (row.arb_script_json && typeof row.arb_script_json === "object" && !Array.isArray(row.arb_script_json))
      ? (row.arb_script_json as ArbScript)
      : null,
    createdAt: isoDateTime(row.created_at),
    updatedAt: isoDateTime(row.updated_at),
  };
}

function rowToComp(r: CompRow): UnifiedComp {
  return {
    id: r.id,
    source: r.source as CompSource,
    addressLine1: r.address_line1,
    city: r.city,
    state: r.state,
    zip: r.zip,
    sqft: r.sqft != null ? Number(r.sqft) : null,
    beds: r.beds != null ? Number(r.beds) : null,
    baths: r.baths != null ? Number(r.baths) : null,
    yearBuilt: r.year_built,
    lotSqft: r.lot_sqft != null ? Number(r.lot_sqft) : null,
    hasPool: r.has_pool ?? null,
    cadPropertyId: r.cad_property_id,
    cadAccountId: r.cad_account_id,
    cadLandValueUsd: r.cad_land_value_usd,
    cadImprovementValueUsd: r.cad_improvement_value_usd,
    cadMarketValueUsd: r.cad_market_value_usd,
    cadAssessedValueUsd: r.cad_assessed_value_usd,
    cadPerSqftAssessed: r.cad_per_sqft_assessed != null ? Number(r.cad_per_sqft_assessed) : null,
    cadDeedDate: r.cad_deed_date,
    cadEnrichedAt: r.cad_enriched_at,
    soldPriceUsd: r.sold_price_usd,
    listPriceUsd: r.list_price_usd,
    soldDate: r.sold_date,
    pricePerSqft: r.price_per_sqft != null ? Number(r.price_per_sqft) : null,
    notes: r.notes,
    excluded: r.excluded ?? false,
    fetchedAt: r.fetched_at,
  };
}

// ── Worksheet CRUD ────────────────────────────────────────────────────────────

export async function getWorksheet(
  propertyId: string,
  householdId: string,
  taxYear: number
): Promise<ProtestWorksheetRecord | null> {
  const row = await qGet<ProtestWorksheetRow>(
    `SELECT id, household_id, property_id, tax_year, status, outcome, informal_offer_usd,
            hearing_date, filing_deadline, cad_portal_url, conversation_json, strategy_json,
            cad_evidence_json, cad_evidence_filename, appeal_json,
            summarization_cursor, conversation_summary, cycle_summary,
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
  if (!created) throw new Error("Failed to create worksheet");
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

  if (opts.hearingDate !== undefined) { sets.push("hearing_date = ?"); params.push(opts.hearingDate); }
  if (opts.outcome !== undefined) { sets.push("outcome = ?"); params.push(opts.outcome); }
  if (opts.informalOfferUsd !== undefined) { sets.push("informal_offer_usd = ?"); params.push(opts.informalOfferUsd); }

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

  if (filingDeadline !== undefined) { sets.push("filing_deadline = ?"); params.push(filingDeadline); }
  if (cadPortalUrl !== undefined) { sets.push("cad_portal_url = ?"); params.push(cadPortalUrl); }

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
    `UPDATE protest_worksheet SET strategy_json = ?, updated_at = NOW() WHERE id = ?`,
    strategy,
    worksheetId
  );
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
  // Insert comp arrays into protest_comp so they appear in the unified view
  await saveCadEvidenceComps(propertyId, householdId, taxYear, data);
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

// ── Unified comp table (protest_comp) ─────────────────────────────────────────

const COMP_SELECT = `
  SELECT id, source, address_line1, city, state, zip,
         sqft, beds, baths, year_built, lot_sqft, has_pool,
         cad_property_id, cad_account_id,
         cad_land_value_usd, cad_improvement_value_usd, cad_market_value_usd,
         cad_assessed_value_usd, cad_per_sqft_assessed, cad_deed_date, cad_enriched_at,
         sold_price_usd, list_price_usd, sold_date, price_per_sqft,
         notes, excluded, fetched_at
  FROM protest_comp`;

export async function listWorksheetComps(
  propertyId: string,
  householdId: string,
  taxYear: number,
  opts: { includeExcluded?: boolean; sources?: CompSource[] } = {}
): Promise<UnifiedComp[]> {
  const clauses: string[] = [
    "property_id = ?",
    "household_id = ?",
    "tax_year = ?",
  ];
  const params: unknown[] = [propertyId, householdId, taxYear];

  if (!opts.includeExcluded) {
    clauses.push("excluded = FALSE");
  }
  if (opts.sources && opts.sources.length > 0) {
    clauses.push(`source IN (${opts.sources.map(() => "?").join(",")})`);
    params.push(...opts.sources);
  }

  const rows = await qAll<CompRow>(
    `${COMP_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY source, fetched_at DESC`,
    ...params
  );
  return rows.map(rowToComp);
}

export async function addManualComp(
  propertyId: string,
  householdId: string,
  taxYear: number,
  comp: {
    addressLine1: string;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    sqft?: number | null;
    beds?: number | null;
    baths?: number | null;
    yearBuilt?: number | null;
    soldPriceUsd?: number | null;
    soldDate?: string | null;
    cadAssessedValueUsd?: number | null;
    cadMarketValueUsd?: number | null;
    cadPropertyId?: string | null;
    cadAccountId?: number | null;
    notes?: string | null;
  }
): Promise<UnifiedComp> {
  await getOrCreateWorksheet(propertyId, householdId, taxYear);
  const id = randomUUID();
  const sqft = comp.sqft ?? null;
  const assessed = comp.cadAssessedValueUsd ?? null;
  const perSqft = assessed != null && sqft != null && sqft > 0 ? assessed / sqft : null;
  const soldPrice = comp.soldPriceUsd ?? null;
  const pricePerSqft = soldPrice != null && sqft != null && sqft > 0 ? soldPrice / sqft : null;

  await qExec(
    `INSERT INTO protest_comp
      (id, household_id, property_id, tax_year, source,
       address_line1, city, state, zip,
       sqft, beds, baths, year_built,
       cad_property_id, cad_account_id,
       cad_assessed_value_usd, cad_market_value_usd, cad_per_sqft_assessed,
       sold_price_usd, sold_date, price_per_sqft,
       notes, fetched_at)
     VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    id, householdId, propertyId, taxYear,
    comp.addressLine1, comp.city ?? null, comp.state ?? null, comp.zip ?? null,
    sqft, comp.beds ?? null, comp.baths ?? null, comp.yearBuilt ?? null,
    comp.cadPropertyId ?? null, comp.cadAccountId ?? null,
    assessed, comp.cadMarketValueUsd ?? null, perSqft,
    soldPrice, comp.soldDate ?? null, pricePerSqft,
    comp.notes ?? null
  );

  const row = await qGet<CompRow>(`${COMP_SELECT} WHERE id = ?`, id);
  if (!row) throw new Error("Failed to read inserted comp");
  return rowToComp(row);
}

export async function updateCompNote(
  propertyId: string,
  householdId: string,
  compId: string,
  notes: string
): Promise<boolean> {
  const existing = await qGet<{ id: string }>(
    `SELECT id FROM protest_comp WHERE id = ? AND property_id = ? AND household_id = ?`,
    compId, propertyId, householdId
  );
  if (!existing) return false;
  await qExec(
    `UPDATE protest_comp SET notes = ? WHERE id = ?`,
    notes || null,
    compId
  );
  return true;
}

export async function excludeComp(
  propertyId: string,
  householdId: string,
  compId: string,
  excluded: boolean
): Promise<boolean> {
  const existing = await qGet<{ id: string }>(
    `SELECT id FROM protest_comp WHERE id = ? AND property_id = ? AND household_id = ?`,
    compId, propertyId, householdId
  );
  if (!existing) return false;
  await qExec(`UPDATE protest_comp SET excluded = ? WHERE id = ?`, excluded, compId);
  return true;
}

export async function deleteComp(
  propertyId: string,
  householdId: string,
  compId: string
): Promise<boolean> {
  const existing = await qGet<{ id: string }>(
    `SELECT id FROM protest_comp WHERE id = ? AND property_id = ? AND household_id = ?`,
    compId, propertyId, householdId
  );
  if (!existing) return false;
  await qExec(`DELETE FROM protest_comp WHERE id = ?`, compId);
  return true;
}

/** Insert comps from a parsed CAD evidence PDF into protest_comp. */
export async function saveCadEvidenceComps(
  propertyId: string,
  householdId: string,
  taxYear: number,
  data: CadEvidenceData
): Promise<void> {
  // Sales comps (§41.41 — have sale price data)
  for (const c of data.salesAnalysis.comps) {
    await qExec(
      `INSERT INTO protest_comp
        (id, household_id, property_id, tax_year, source,
         address_line1, cad_property_id,
         cad_market_value_usd, cad_assessed_value_usd,
         sold_price_usd, sold_date,
         fetched_at)
       VALUES (?, ?, ?, ?, 'cad_evidence', ?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT (property_id, tax_year, cad_property_id) WHERE cad_property_id IS NOT NULL
       DO UPDATE SET
         sold_price_usd = COALESCE(EXCLUDED.sold_price_usd, protest_comp.sold_price_usd),
         sold_date = COALESCE(EXCLUDED.sold_date, protest_comp.sold_date),
         cad_market_value_usd = COALESCE(EXCLUDED.cad_market_value_usd, protest_comp.cad_market_value_usd),
         cad_assessed_value_usd = COALESCE(EXCLUDED.cad_assessed_value_usd, protest_comp.cad_assessed_value_usd),
         fetched_at = NOW()`,
      randomUUID(), householdId, propertyId, taxYear,
      c.address ?? null,
      c.propId ?? null,
      c.cadMarketValueUsd,
      c.cadIndValueUsd,
      c.salePriceUsd,
      c.saleDate ?? null
    ).catch((err) => {
      log.warn("saveCadEvidenceComps: sales comp insert failed", {
        address: c.address,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Equity comps (§41.43 — no sale price)
  for (const c of data.equityAnalysis.comps) {
    await qExec(
      `INSERT INTO protest_comp
        (id, household_id, property_id, tax_year, source,
         address_line1, cad_property_id,
         cad_market_value_usd, cad_assessed_value_usd,
         fetched_at)
       VALUES (?, ?, ?, ?, 'cad_evidence', ?, ?, ?, ?, NOW())
       ON CONFLICT (property_id, tax_year, cad_property_id) WHERE cad_property_id IS NOT NULL
       DO UPDATE SET
         cad_market_value_usd = COALESCE(EXCLUDED.cad_market_value_usd, protest_comp.cad_market_value_usd),
         cad_assessed_value_usd = COALESCE(EXCLUDED.cad_assessed_value_usd, protest_comp.cad_assessed_value_usd),
         fetched_at = NOW()`,
      randomUUID(), householdId, propertyId, taxYear,
      c.address ?? null,
      c.propId ?? null,
      c.cadMarketValueUsd,
      c.cadIndValueUsd
    ).catch((err) => {
      log.warn("saveCadEvidenceComps: equity comp insert failed", {
        address: c.address,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/** Save Redfin comps to protest_comp at fetch time. Called from property.service.ts. */
export async function saveRedfinComps(
  propertyId: string,
  householdId: string,
  taxYear: number,
  comps: Array<{
    address: string;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    sqft?: number | null;
    beds?: number | null;
    baths?: number | null;
    yearBuilt?: number | null;
    lotSqft?: number | null;
    soldPrice?: number | null;
    listPrice?: number | null;
    soldDate?: string | null;
    pricePerSqft?: number | null;
    raw: unknown;
  }>
): Promise<void> {
  for (const c of comps) {
    await qExec(
      `INSERT INTO protest_comp
        (id, household_id, property_id, tax_year, source,
         address_line1, city, state, zip,
         sqft, beds, baths, year_built, lot_sqft,
         sold_price_usd, list_price_usd, sold_date, price_per_sqft,
         raw_realty_json, fetched_at)
       VALUES (?, ?, ?, ?, 'redfin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT (property_id, tax_year, source, address_line1) WHERE cad_property_id IS NULL
       DO UPDATE SET
         sqft = COALESCE(EXCLUDED.sqft, protest_comp.sqft),
         sold_price_usd = EXCLUDED.sold_price_usd,
         list_price_usd = EXCLUDED.list_price_usd,
         sold_date = COALESCE(EXCLUDED.sold_date, protest_comp.sold_date),
         price_per_sqft = COALESCE(EXCLUDED.price_per_sqft, protest_comp.price_per_sqft),
         raw_realty_json = EXCLUDED.raw_realty_json,
         fetched_at = NOW()`,
      randomUUID(), householdId, propertyId, taxYear,
      c.address, c.city ?? null, c.state ?? null, c.zip ?? null,
      c.sqft ?? null, c.beds ?? null, c.baths ?? null, c.yearBuilt ?? null, c.lotSqft ?? null,
      c.soldPrice ?? null, c.listPrice ?? null, c.soldDate ?? null, c.pricePerSqft ?? null,
      c.raw
    ).catch((err) => {
      log.warn("saveRedfinComps: insert failed", {
        address: c.address,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

// ── DCAD backfill (5-step enrichment pipeline) ────────────────────────────────

/**
 * Full DCAD enrichment pipeline for one property.
 * Fire-and-forget safe — all errors are logged, not thrown.
 *
 * Step A: Subject property full enrichment (value history + taxable)
 * Step B: Save DCAD search comps to protest_comp
 * Step C: Improvement enrichment for DCAD comps (beds/baths/sqft/pool)
 * Step D: Enrich Redfin + CAD evidence comps with DCAD data; merge when cad_property_id matches
 * Step E: Sync appeal status to worksheet
 */
export async function runDcadBackfill(
  propertyId: string,
  householdId: string,
  address: string,
  taxYear: number,
  county?: string | null
): Promise<void> {
  const countyName = county ?? null;

  log.info("runDcadBackfill: starting", { propertyId, address, taxYear, county: countyName });

  // ── Step A: Subject property enrichment ─────────────────────────────────────
  const subject = await fetchDcadCanonical({
    address,
    taxYear,
    includeValueHistory: true,
    includeTaxable: true,
    county: countyName ?? undefined,
  });

  if (!subject) {
    log.info("runDcadBackfill: no DCAD match for subject", { propertyId, address });
    return;
  }

  await qExec(
    `UPDATE property SET
       cad_provider               = 'dcad',
       cad_property_id            = ?,
       cad_account_id             = ?,
       cad_assessed_value_usd     = ?,
       cad_land_value_usd         = ?,
       cad_improvement_value_usd  = ?,
       cad_market_value_usd       = ?,
       cad_appraised_value_usd    = ?,
       cad_su_exclusion_value_usd = ?,
       cad_tax_limitation_value_usd = ?,
       cad_net_appraised_value_usd = ?,
       cad_value_history_json     = ?,
       cad_taxable_json           = ?,
       cad_sqft                   = ?,
       cad_beds                   = ?,
       cad_baths                  = ?,
       cad_has_pool               = ?,
       cad_enriched_at            = NOW()
     WHERE id = ? AND household_id = ?`,
    subject.cadPropertyId,
    subject.cadAccountId,
    subject.appraisedValueUsd,
    subject.landValueUsd,
    subject.improvementValueUsd,
    subject.marketValueUsd,
    subject.appraisedValueUsd,
    subject.suExclusionValueUsd,
    subject.taxLimitationValueUsd,
    subject.netAppraisedValueUsd,
    subject.valueHistoryJson ?? null,
    subject.taxableJson ?? null,
    subject.sqft != null ? Math.round(subject.sqft) : null,
    subject.beds,
    subject.baths,
    subject.hasPool,
    propertyId,
    householdId
  );
  log.info("runDcadBackfill: Step A complete", {
    propertyId,
    cadPropertyId: subject.cadPropertyId,
    appraisedValue: subject.appraisedValueUsd,
  });

  // ── Step B: Save DCAD search comps ──────────────────────────────────────────
  const allResults = await searchDCADByAddress(address, taxYear, countyName);
  const subjectPid = subject.cadPropertyId;
  let stepBCount = 0;

  for (const comp of allResults) {
    if (comp.dcadPropertyId === subjectPid || comp.pAccountId == null) continue;
    const raw = comp.raw;
    const sqft = comp.sqft != null ? Math.round(comp.sqft) : null;
    const assessed = comp.assessedValue;
    const perSqft = assessed != null && sqft != null && sqft > 0 ? assessed / sqft : null;

    await qExec(
      `INSERT INTO protest_comp
        (id, household_id, property_id, tax_year, source,
         address_line1, city,
         cad_property_id, cad_account_id,
         cad_land_value_usd, cad_improvement_value_usd,
         cad_market_value_usd, cad_assessed_value_usd, cad_per_sqft_assessed,
         sqft, beds, baths, year_built,
         raw_dcad_json, fetched_at)
       VALUES (?, ?, ?, ?, 'dcad_search', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT (property_id, tax_year, cad_property_id) WHERE cad_property_id IS NOT NULL
       DO UPDATE SET
         cad_market_value_usd  = EXCLUDED.cad_market_value_usd,
         cad_assessed_value_usd = EXCLUDED.cad_assessed_value_usd,
         cad_per_sqft_assessed = EXCLUDED.cad_per_sqft_assessed,
         raw_dcad_json         = EXCLUDED.raw_dcad_json,
         fetched_at            = NOW()`,
      randomUUID(), householdId, propertyId, taxYear,
      comp.address, comp.city,
      comp.dcadPropertyId, comp.pAccountId,
      comp.landValue, asNumber(raw.improvementValue),
      comp.marketValue, assessed, perSqft,
      sqft, comp.beds, comp.baths, comp.yearBuilt,
      raw
    ).catch((err) => {
      log.warn("runDcadBackfill Step B: insert failed", {
        cadPropertyId: comp.dcadPropertyId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    stepBCount++;
  }
  log.info("runDcadBackfill: Step B complete", { propertyId, count: stepBCount });

  // ── Step C: Improvement enrichment for DCAD comps ───────────────────────────
  const needsImprovement = await qAll<{ id: string; cad_account_id: number; cad_property_id: string }>(
    `SELECT id, cad_account_id, cad_property_id
       FROM protest_comp
      WHERE property_id = ? AND household_id = ? AND tax_year = ?
        AND source = 'dcad_search'
        AND cad_account_id IS NOT NULL
        AND (sqft IS NULL OR beds IS NULL OR baths IS NULL)`,
    propertyId, householdId, taxYear
  );

  for (const comp of needsImprovement) {
    try {
      await sleep(150);
      const features = await getDCADImprovementFeatures(comp.cad_account_id, countyName);
      if (!features) continue;
      const newSqft = features.sqft != null ? Math.round(features.sqft) : null;
      const hasPool = features.miscImprovements.some((m) => /pool|spa/i.test(m.description));
      await qExec(
        `UPDATE protest_comp SET
           sqft      = COALESCE(?, sqft),
           beds      = COALESCE(?, beds),
           baths     = COALESCE(?, baths),
           has_pool  = ?,
           cad_per_sqft_assessed = CASE
             WHEN ? IS NOT NULL AND cad_assessed_value_usd IS NOT NULL AND ? > 0
             THEN cad_assessed_value_usd::numeric / ?
             ELSE cad_per_sqft_assessed END
         WHERE id = ?`,
        newSqft, features.beds, features.baths, hasPool,
        newSqft, newSqft, newSqft,
        comp.id
      );
    } catch (err) {
      log.warn("runDcadBackfill Step C: improvement failed", {
        cadPropertyId: comp.cad_property_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  log.info("runDcadBackfill: Step C complete", { propertyId, enriched: needsImprovement.length });

  // ── Step D: Enrich Redfin + CAD evidence comps ──────────────────────────────
  const unenriched = await qAll<{
    id: string;
    address_line1: string | null;
    cad_property_id: string | null;
    sold_price_usd: number | null;
    sold_date: string | null;
    price_per_sqft: string | null;
    raw_realty_json: unknown;
  }>(
    `SELECT id, address_line1, cad_property_id, sold_price_usd, sold_date, price_per_sqft, raw_realty_json
       FROM protest_comp
      WHERE property_id = ? AND household_id = ? AND tax_year = ?
        AND source IN ('redfin', 'cad_evidence')
        AND cad_enriched_at IS NULL
      LIMIT 10`,
    propertyId, householdId, taxYear
  );

  for (const comp of unenriched) {
    if (!comp.address_line1 && !comp.cad_property_id) {
      await qExec(`UPDATE protest_comp SET cad_enriched_at = NOW() WHERE id = ?`, comp.id);
      continue;
    }
    try {
      await sleep(200);
      const canonical = await fetchDcadCanonical({
        address: comp.cad_property_id ? undefined : comp.address_line1 ?? undefined,
        cadPropertyId: comp.cad_property_id ?? undefined,
        taxYear,
        county: countyName ?? undefined,
      });

      if (!canonical) {
        await qExec(`UPDATE protest_comp SET cad_enriched_at = NOW() WHERE id = ?`, comp.id);
        continue;
      }

      // Check for an existing DCAD search row with the same cad_property_id
      const existingDcad = await qGet<{ id: string }>(
        `SELECT id FROM protest_comp
          WHERE property_id = ? AND tax_year = ? AND cad_property_id = ?
            AND source = 'dcad_search' AND id != ?`,
        propertyId, taxYear, canonical.cadPropertyId, comp.id
      );

      if (existingDcad) {
        // Merge: copy sold data into the DCAD row, delete this Redfin/cad_evidence row.
        // Fall back to cad_deed_date already on the DCAD row if neither row has a sold date.
        await qExec(
          `UPDATE protest_comp SET
             sold_price_usd   = COALESCE(sold_price_usd, ?),
             sold_date        = COALESCE(sold_date, ?, cad_deed_date),
             price_per_sqft   = COALESCE(price_per_sqft, ?),
             raw_realty_json  = COALESCE(raw_realty_json, ?),
             cad_enriched_at  = NOW()
           WHERE id = ?`,
          comp.sold_price_usd, comp.sold_date,
          comp.price_per_sqft != null ? Number(comp.price_per_sqft) : null,
          comp.raw_realty_json,
          existingDcad.id
        );
        await qExec(`DELETE FROM protest_comp WHERE id = ?`, comp.id);
      } else {
        const sqft = canonical.sqft != null ? Math.round(canonical.sqft) : null;
        const perSqft = canonical.appraisedValueUsd != null && sqft != null && sqft > 0
          ? canonical.appraisedValueUsd / sqft : null;
        await qExec(
          `UPDATE protest_comp SET
             cad_property_id        = ?,
             cad_account_id         = ?,
             cad_land_value_usd     = ?,
             cad_improvement_value_usd = ?,
             cad_market_value_usd   = ?,
             cad_assessed_value_usd = ?,
             cad_per_sqft_assessed  = ?,
             cad_deed_date          = ?,
             sold_date              = COALESCE(sold_date, ?),
             sqft    = COALESCE(sqft, ?),
             beds    = COALESCE(beds, ?),
             baths   = COALESCE(baths, ?),
             has_pool = COALESCE(has_pool, ?),
             cad_enriched_at = NOW(),
             raw_dcad_json = ?
           WHERE id = ?`,
          canonical.cadPropertyId,
          canonical.cadAccountId,
          canonical.landValueUsd,
          canonical.improvementValueUsd,
          canonical.marketValueUsd,
          canonical.appraisedValueUsd,
          perSqft,
          canonical.deedDate,
          canonical.deedDate,
          sqft, canonical.beds, canonical.baths, canonical.hasPool,
          canonical.rawSearchJson,
          comp.id
        );
      }
    } catch (err) {
      log.warn("runDcadBackfill Step D: enrichment failed", {
        compId: comp.id,
        err: err instanceof Error ? err.message : String(err),
      });
      await qExec(`UPDATE protest_comp SET cad_enriched_at = NOW() WHERE id = ?`, comp.id).catch(() => null);
    }
  }
  log.info("runDcadBackfill: Step D complete", { propertyId, count: unenriched.length });

  // ── Step E: Appeal status sync ───────────────────────────────────────────────
  await syncAppealStatus(propertyId, householdId, taxYear, subject.cadAccountId, countyName);

  log.info("runDcadBackfill: complete", { propertyId, address, taxYear });
}

/**
 * Sync DCAD appeal status into protest_worksheet.appeal_json and hearing_date.
 * Safe to call fire-and-forget.
 */
export async function syncAppealStatus(
  propertyId: string,
  householdId: string,
  taxYear: number,
  cadAccountId: number,
  county?: string | null
): Promise<void> {
  try {
    const appeals = await fetchDcadAppeal(cadAccountId, county ?? undefined);
    if (appeals.length === 0) return;

    const ws = await getWorksheet(propertyId, householdId, taxYear);
    if (!ws) return;

    const sets: string[] = ["appeal_json = ?", "updated_at = NOW()"];
    const params: unknown[] = [appeals];

    // Use the first appeal entry with a hearing date to update hearing_date
    const withHearing = appeals.find((a) => a.hearingDate);
    if (withHearing?.hearingDate && !ws.hearingDate) {
      sets.push("hearing_date = ?");
      params.push(withHearing.hearingDate.slice(0, 10));
    }

    params.push(ws.id);
    await qExec(
      `UPDATE protest_worksheet SET ${sets.join(", ")} WHERE id = ?`,
      ...params
    );
    log.info("syncAppealStatus: synced", { propertyId, taxYear, appealCount: appeals.length });
  } catch (err) {
    log.warn("syncAppealStatus: failed", {
      propertyId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
