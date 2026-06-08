import { randomUUID } from "node:crypto";

import { qAll, qExec, qGet } from "../../db/query.js";
import type { ArbScript } from "./arb-script.service.js";
import { log } from "../../logger.js";
import type { CadProperty } from "./cad-adapters/cad-adapter.types.js";
import { getCadAdapter, inferCadProvider } from "./cad-adapters/registry.js";
import type { CadEvidenceData } from "./cad-evidence-parser.service.js";
import { getDCADImprovementFeatures } from "./dcad.service.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

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
  city: string | null;
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
  comps: CadProperty[],
  searchAddress?: string
): Promise<number> {
  const houseNum = searchAddress?.match(/^\d+/)?.[0];
  const subjectId = houseNum
    ? (comps.find((c) => c.address != null && c.address.startsWith(houseNum)) ?? comps[0])?.cadPropertyId
    : searchAddress != null ? comps[0]?.cadPropertyId : undefined;
  const toSave = subjectId ? comps.filter((c) => c.cadPropertyId !== subjectId) : comps;
  for (const comp of toSave) {
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
      comp.sqft != null ? Math.round(comp.sqft) : null,
      comp.beds,
      comp.baths,
      comp.yearBuilt,
      comp.assessedValue != null && comp.sqft != null && comp.sqft > 0 ? comp.assessedValue / comp.sqft : null,
      comp.raw
    );
  }
  return toSave.length;
}

/**
 * Async CAD data fetch triggered at property creation. Infers adapter from state.
 * Called fire-and-forget — errors are logged but do not block the create response.
 */
export async function triggerCadBackfill(
  propertyId: string,
  householdId: string,
  address: string,
  state?: string | null,
  valuationDetailJson?: unknown
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
    await saveCADComps(propertyId, householdId, year, comps, address);
    await saveCadSubjectIds(propertyId, provider, comps, address);
    await enrichAndUpdateCadCompsImprovement(propertyId, householdId, year, comps, address, provider);
    log.info("triggerCadBackfill: done", { propertyId, year, count: comps.length, provider });
  } else {
    log.info("triggerCadBackfill: no comps found", { propertyId, address, provider });
  }

  // Enrich Redfin sold comps with DCAD data so Market Value Evidence loads with full data on first visit
  const detail = asRecord(valuationDetailJson);
  const rawSoldComps = Array.isArray(detail?.comps) ? (detail.comps as unknown[]) : [];
  if (rawSoldComps.length > 0) {
    await getOrCreateWorksheet(propertyId, householdId, year);
    const { cache, fetched } = await enrichSoldCompsCad(rawSoldComps, year, provider);
    if (fetched > 0) {
      await saveSoldCompsCadCache(propertyId, householdId, year, cache);
      log.info("triggerCadBackfill: enriched sold comps", { propertyId, year, fetched });
    }
  }
}

/**
 * After bulk save, enrich each comp row with sqft from improvement features API.
 * Always prefers improvement-features sqft (more accurate than search-result placeholder).
 * Appends pool/spa notes to the notes column when Misc Imp entries are found.
 */
async function enrichAndUpdateCadCompsImprovement(
  propertyId: string,
  householdId: string,
  taxYear: number,
  comps: CadProperty[],
  searchAddress: string,
  cadProvider: string
): Promise<void> {
  const countyHint = cadProvider === "dcad" ? "Denton" : null;
  const houseNum = searchAddress?.match(/^\d+/)?.[0];
  const subjectId = houseNum
    ? (comps.find((c) => c.address != null && c.address.startsWith(houseNum)) ?? comps[0])?.cadPropertyId
    : comps[0]?.cadPropertyId;
  const toEnrich = subjectId ? comps.filter((c) => c.cadPropertyId !== subjectId) : comps;

  for (const comp of toEnrich) {
    if (comp.accountId == null) continue;
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      const features = await getDCADImprovementFeatures(comp.accountId, countyHint);
      if (!features) continue;

      const newSqft = features.sqft != null ? Math.round(features.sqft) : null;
      const poolNote =
        features.miscImprovements.length > 0
          ? features.miscImprovements
              .map((m) => {
                const parts = [m.description];
                if (m.yearBuilt) parts.push(`built ${m.yearBuilt}`);
                if (m.valueUsd != null) parts.push(`$${Math.round(m.valueUsd).toLocaleString()}`);
                return parts.join(", ");
              })
              .join("; ")
          : null;

      await qExec(
        `UPDATE protest_comp_cad
            SET sqft         = COALESCE(?, sqft),
                beds         = COALESCE(beds, ?),
                baths        = COALESCE(baths, ?),
                per_sqft_usd = CASE WHEN ? IS NOT NULL AND assessed_value_usd IS NOT NULL AND ? > 0
                                    THEN assessed_value_usd::numeric / ?
                                    ELSE per_sqft_usd END,
                notes        = CASE WHEN notes IS NULL AND ? IS NOT NULL THEN ? ELSE notes END,
                fetched_at   = NOW()
          WHERE property_id = ? AND household_id = ? AND tax_year = ? AND cad_property_id = ?`,
        newSqft,
        features.beds,
        features.baths,
        newSqft, newSqft, newSqft,
        poolNote, poolNote,
        propertyId, householdId, taxYear, comp.cadPropertyId
      );
    } catch (err) {
      log.warn("enrichAndUpdateCadCompsImprovement: failed", {
        cadPropertyId: comp.cadPropertyId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
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
    ? comps.find((c) => c.address != null && c.address.startsWith(houseNum))
    : null;
  if (!subject?.accountId) {
    log.warn("saveCadSubjectIds: no subject match in search results, skipping cad_property_id update", { propertyId, searchAddress });
    return;
  }
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

/** Identifies the best-match CAD entry for a sold comp address from a DCAD search result set. */
export function matchCadAssessedValue(cadComps: CadProperty[], searchAddress: string): SoldCompCadEntry | null {
  if (cadComps.length === 0) return null;
  const houseNum = searchAddress.trim().match(/^\d+/)?.[0];
  const match = houseNum
    ? (cadComps.find((c) => c.address != null && c.address.startsWith(houseNum)) ?? cadComps[0])
    : cadComps[0];
  if (!match) return null;
  return {
    cadPropertyId: match.cadPropertyId,
    cadAccountId: match.accountId,
    assessedValueUsd: match.assessedValue,
    beds: match.beds,
    baths: match.baths,
    sqft: match.sqft != null ? Math.round(match.sqft) : null,
  };
}

/**
 * Enriches Redfin sold comps with DCAD assessed value + improvement features.
 * Returns the updated cache. Addresses already in `existingCache` are skipped.
 * Safe to call fire-and-forget — all errors are logged, not thrown.
 */
export async function enrichSoldCompsCad(
  rawSoldComps: unknown[],
  taxYear: number,
  cadProvider: string,
  existingCache: Record<string, SoldCompCadEntry> = {}
): Promise<{ cache: Record<string, SoldCompCadEntry>; fetched: number }> {
  const adapter = getCadAdapter(cadProvider);
  if (!adapter) return { cache: existingCache, fetched: 0 };

  const countyHint = cadProvider === "dcad" ? "Denton" : null;
  const addressesToFetch = rawSoldComps
    .map((c) => {
      const r = asRecord(c);
      return typeof r?.address === "string" ? r.address : null;
    })
    .filter((a): a is string => a !== null && !(a in existingCache))
    .slice(0, 6);

  const cache = { ...existingCache };
  let fetched = 0;

  for (const addr of addressesToFetch) {
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      const results = await adapter.searchByAddress(addr, taxYear);
      const entry = matchCadAssessedValue(results, addr);
      if (entry) {
        cache[addr] = entry;
        fetched++;
        if (entry.cadAccountId != null && (entry.beds == null || entry.baths == null || entry.sqft == null)) {
          try {
            await new Promise<void>((resolve) => setTimeout(resolve, 150));
            const features = await getDCADImprovementFeatures(entry.cadAccountId, countyHint);
            if (features) {
              cache[addr] = {
                ...cache[addr],
                beds: cache[addr].beds ?? features.beds,
                baths: cache[addr].baths ?? features.baths,
                sqft: cache[addr].sqft ?? (features.sqft != null ? Math.round(features.sqft) : null),
              };
            }
          } catch (err) {
            log.warn("enrichSoldCompsCad: improvement features failed", { addr, err: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    } catch (err) {
      log.warn("enrichSoldCompsCad: CAD lookup failed", { addr, err: err instanceof Error ? err.message : String(err) });
    }
  }
  return { cache, fetched };
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
  existingCadPropertyId?: string,
  accountId?: number | null
): Promise<string> {
  const id = randomUUID();
  const cadPropertyId = existingCadPropertyId ?? `manual-${randomUUID()}`;
  const rawJson = existingCadPropertyId
    ? (accountId != null ? { accountId } : {})
    : { manual: true };
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
    `SELECT pcc.cad_property_id, pcc.address_line1, pcc.city, pcc.assessed_value_usd, pcc.market_value_usd,
            pcc.sqft, pcc.beds, pcc.baths, pcc.year_built, pcc.per_sqft_usd, pcc.notes
       FROM protest_comp_cad pcc
       JOIN property p ON p.id = pcc.property_id
      WHERE pcc.household_id = ? AND pcc.property_id = ? AND pcc.tax_year = ?
        AND (p.cad_property_id IS NULL OR pcc.cad_property_id != p.cad_property_id)
      ORDER BY pcc.fetched_at DESC`,
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
