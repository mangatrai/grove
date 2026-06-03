import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { getChatAdapter, getToolUseAdapter, getVisionAdapter, chatModel, strongModel, isLlmConfigured } from "../../llm/index.js";
import type { Tool, ChatMessage } from "../../llm/index.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { getProperty, refreshPropertyValuation } from "../household/property.service.js";
import type { CadProperty } from "./cad-adapters/cad-adapter.types.js";
import { getCadAdapter, inferCadProvider } from "./cad-adapters/registry.js";
import {
  appendConversationTurn,
  getOrCreateWorksheet,
  getWorksheet,
  listWorksheetComps,
  updateStrategy,
  updateWorksheetStatus,
  updateWorksheetMeta,
  type ConversationTurn,
  type ProtestStatus,
  type StrategyJson,
  saveCADComps,
  saveCadSubjectIds,
  saveSoldCompsCadCache,
  type SoldCompCadEntry,
  deleteCADComp,
  addCADComp,
  type ManualComp,
  setExcludedSoldComps,
  getExcludedSoldComps,
  saveCadEvidence,
  deleteCadEvidence,
  saveSoldCompNote,
  updateCompNote,
  type CadEvidenceData,
  updateSummarizationState,
  saveCycleSummary,
  saveArbScript,
} from "./protest-worksheet.service.js";
import { generateArbScript, type ArbScriptInput } from "./arb-script.service.js";
import { parseCadEvidencePdf } from "./cad-evidence-parser.service.js";
import { extractPdfText } from "../imports/profiles/pdf-text.js";
import { chunkText } from "./chunking.service.js";
import { embedText } from "./embedding.service.js";
import {
  saveDocumentChunks,
  deleteDocumentChunks,
  querySimilarChunks,
  listDocuments,
} from "./document-store.service.js";
import { checkProtestDeadlines } from "../notifications/notification.service.js";
import { generateEvidencePDF, type SoldComp } from "./protest-evidence.service.js";
import { generateEvidenceDOCX } from "./protest-evidence-docx.service.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const worksheetStatusSchema = z.enum(["not_filed", "filed", "informal", "arb", "resolved"]);
const propertyIdSchema = z.object({ propertyId: z.string().uuid() });
const worksheetQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const evidencePacketQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  format: z.enum(["pdf", "docx"]).default("pdf"),
});
const chatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  attachmentText: z.string().max(50_000).optional(),
  attachmentType: z.enum(["pdf", "url", "text"]).optional(),
  year: z.number().int().min(2000).max(2100).optional()
});
const protestOutcomeSchema = z.enum(["settled_informal", "won_arb", "lost_arb", "withdrawn"]);
const patchWorksheetBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  status: worksheetStatusSchema.optional(),
  hearingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  filingDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  cadPortalUrl: z.string().url().nullable().optional(),
  outcome: protestOutcomeSchema.nullable().optional(),
  informalOfferUsd: z.number().int().min(0).nullable().optional()
});

function thisYear(): number {
  return new Date().getUTCFullYear();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function buildSoldComps(
  rawComps: unknown[],
  cadCache: Record<string, SoldCompCadEntry>
): SoldComp[] {
  return rawComps.map((c) => {
    const r = asRecord(c) ?? {};
    const soldPrice = asNumber(r.soldPrice);
    const sqft = asNumber(r.sqft);
    const address = typeof r.address === "string" ? r.address : null;
    const cached = address ? (cadCache[address] ?? null) : null;
    return {
      address,
      city: typeof r.city === "string" ? r.city : null,
      state: typeof r.state === "string" ? r.state : null,
      sqft,
      beds: asNumber(r.beds),
      baths: asNumber(r.baths),
      yearBuilt: asNumber(r.yearBuilt),
      soldPrice,
      soldDate: typeof r.soldDate === "string" ? r.soldDate : null,
      pricePerSqft: soldPrice != null && sqft != null && sqft > 0
        ? Math.round(soldPrice / sqft)
        : asNumber(r.pricePerSqft),
      listPrice: asNumber(r.listPrice),
      cadAssessedValueUsd: cached?.assessedValueUsd ?? null
    };
  });
}

function matchCadAssessedValue(cadComps: CadProperty[], searchAddress: string): SoldCompCadEntry | null {
  if (cadComps.length === 0) return null;
  const houseNum = searchAddress.trim().match(/^\d+/)?.[0];
  const match = houseNum
    ? (cadComps.find((c) => c.address != null && c.address.startsWith(houseNum)) ?? cadComps[0])
    : cadComps[0];
  if (!match) return null;
  return { cadPropertyId: match.cadPropertyId, assessedValueUsd: match.assessedValue };
}

function buildCadEvidenceContext(cadEvidence: CadEvidenceData | null, cadAssessed: number | null): string {
  if (!cadEvidence) return "";

  const lines: string[] = ["\nCAD Evidence (from official DCAD Evidence Packet):"];

  if (cadEvidence.assessedValueUsd != null) {
    lines.push(`- Subject assessed: ${money(cadEvidence.assessedValueUsd)} | Improvements: ${money(cadEvidence.improvementsUsd)} | Land: ${money(cadEvidence.landValueUsd)}`);
  }
  if (cadEvidence.percentGood != null) {
    lines.push(`- Condition: ${cadEvidence.percentGood}% good | Year built: ${cadEvidence.yearBuilt ?? "—"} | Living area: ${cadEvidence.livingAreaSqft ?? "—"} sqft | Lot: ${cadEvidence.lotSqft ?? "—"} sqft`);
  }

  const salesMedian = cadEvidence.salesAnalysis.medianIndValueUsd;
  if (salesMedian != null) {
    lines.push(`- CAD Sales Analysis median (§41.41): ${money(salesMedian)}`);
  }

  const equityMedian = cadEvidence.equityAnalysis.medianIndValueUsd;
  if (equityMedian != null) {
    const delta = cadAssessed != null ? cadAssessed - equityMedian : null;
    const deltaStr = delta != null ? ` → subject is ${money(Math.abs(delta))} ${delta > 0 ? "ABOVE equity median — §41.43 unequal appraisal SUPPORTED" : "below equity median"}` : "";
    lines.push(`- CAD Equity Analysis median (§41.43): ${money(equityMedian)}${deltaStr}`);
  }

  if (cadEvidence.salesAnalysis.comps.length > 0) {
    lines.push("- CAD Sales Comps (§41.41):");
    for (const c of cadEvidence.salesAnalysis.comps) {
      lines.push(`  Comp ${c.compNum}: ${c.address} | sold ${money(c.salePriceUsd)} on ${c.saleDate ?? "—"} | DCAD market ${money(c.cadMarketValueUsd)} | ind ${money(c.cadIndValueUsd)}`);
    }
  }

  if (cadEvidence.equityAnalysis.comps.length > 0) {
    lines.push("- CAD Equity Comps (§41.43):");
    for (const c of cadEvidence.equityAnalysis.comps) {
      lines.push(`  Comp ${c.compNum}: ${c.address} | DCAD market ${money(c.cadMarketValueUsd)} | ind ${money(c.cadIndValueUsd)}`);
    }
  }

  return lines.join("\n");
}

function buildCompNotesContext(
  soldCompsNotes: Record<string, string>,
  equityComps: Array<{ addressLine1: string | null; notes: string | null }>
): string {
  const lines: string[] = [];

  const soldEntries = Object.entries(soldCompsNotes).filter(([, n]) => n.trim());
  const equityEntries = equityComps.filter(c => c.notes?.trim());

  if (soldEntries.length === 0 && equityEntries.length === 0) return "";

  lines.push("\nComp annotations (user research notes):");
  for (const [addr, note] of soldEntries) {
    lines.push(`- ${addr}: "${note}"`);
  }
  for (const c of equityEntries) {
    lines.push(`- ${c.addressLine1 ?? "unknown"}: "${c.notes}"`);
  }

  return lines.join("\n");
}

function buildSystemPrompt(input: {
  address: string;
  city: string | null;
  state: string | null;
  cadAssessed: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  status: ProtestStatus;
  year: number;
  cadEvidence: CadEvidenceData | null;
  soldCompsNotes: Record<string, string>;
  equityComps: Array<{ addressLine1: string | null; notes: string | null }>;
  priorYearSummary?: string | null;
}): string {
  const evidenceContext = buildCadEvidenceContext(input.cadEvidence, input.cadAssessed);
  const notesContext = buildCompNotesContext(input.soldCompsNotes, input.equityComps);
  const priorYearBlock = input.priorYearSummary?.trim()
    ? `\n## Prior year context\n${input.priorYearSummary.trim()}`
    : "";

  return `You are a property tax protest assistant for ${input.address}, ${input.city ?? ""} ${input.state ?? ""}.

Property facts:
- CAD assessed value (tax year ${input.year}): ${money(input.cadAssessed)}
- Sqft: ${input.sqft ?? "—"} | Beds: ${input.beds ?? "—"} | Baths: ${input.baths ?? "—"} | Year built: ${input.yearBuilt ?? "—"}
- Purchase price: ${money(input.purchasePrice)} (${input.purchaseDate ?? "—"})

Current protest status: ${input.status}
Tax year: ${input.year}

Texas property tax protest grounds:
- §41.41 (Market value): Subject property's assessed value exceeds its market value. Argue using recent arm's-length sale prices of comparable properties.
- §41.43 (Unequal appraisal): Subject property is assessed at a higher ratio than comparable properties. Argue using CAD-assessed values of similar nearby properties — not Redfin AVM or Zillow estimates, which have no standing at ARB.
${evidenceContext}${notesContext}${priorYearBlock}
You have access to tools to fetch DCAD comparable properties and update the protest worksheet. When the user asks about analysis or strategy, use both grounds and tell them which is stronger based on available data. Be concise and direct.`;
}

const CLOSED_PROTEST_OUTCOMES = new Set([
  "settled_informal",
  "won_arb",
  "lost_arb",
  "withdrawn",
]);

const LIVE_TURN_LIMIT = 30;
const SUMMARIZE_CHUNK_SIZE = 10;

async function runConversationSummarization(
  worksheetId: string,
  conversationJson: ConversationTurn[],
  summarizationCursor: number,
  existingConversationSummary: string | null
): Promise<void> {
  const turnsToSummarize = conversationJson.slice(
    summarizationCursor,
    summarizationCursor + SUMMARIZE_CHUNK_SIZE
  );
  if (turnsToSummarize.length === 0) return;

  const { content: summaryRaw } = await getChatAdapter().complete(
    [
      {
        role: "system",
        content:
          "You are summarizing a property tax protest chat. Be concise. Preserve: key facts, property values, comparable properties mentioned, strategy decisions, any agreed figures.",
      },
      {
        role: "user",
        content: `Summarize these conversation turns:\n${JSON.stringify(turnsToSummarize)}`,
      },
    ],
    { model: chatModel(), maxTokens: 800 }
  );
  const summaryText = summaryRaw.trim();
  if (!summaryText) return;

  const newSummary = (existingConversationSummary ? `${existingConversationSummary}\n\n` : "") + summaryText;
  const newCursor = summarizationCursor + SUMMARIZE_CHUNK_SIZE;
  await updateSummarizationState(worksheetId, newCursor, newSummary);
  log.info("protest chat summarized", { worksheetId, cursor: summarizationCursor, newCursor });
}

async function generateCycleSummary(
  worksheetId: string,
  conversationJson: ConversationTurn[],
  status: string
): Promise<void> {
  const { content: summaryRaw } = await getChatAdapter().complete(
    [
      {
        role: "system",
        content:
          "Summarize this property tax protest for future reference. Include: property, tax year, initial assessed value, protest grounds used (§41.41 / §41.43), key comparable properties, negotiation trajectory, and final outcome. Max 200 words.",
      },
      {
        role: "user",
        content: JSON.stringify(conversationJson),
      },
    ],
    { model: chatModel(), maxTokens: 400 }
  );
  const summaryText = summaryRaw.trim();
  if (!summaryText) return;
  await saveCycleSummary(worksheetId, summaryText);
  log.info("protest cycle summary generated", { worksheetId, status });
}

function formatCompSummary(comps: CadProperty[]): string {
  if (comps.length === 0) return "No comparable properties found.";
  const rows = comps.map((c) => {
    const perSqft = c.assessedValue != null && c.sqft != null && c.sqft > 0 ? c.assessedValue / c.sqft : null;
    return {
      address: c.address ?? "Unknown",
      assessed: c.assessedValue,
      perSqft
    };
  });
  return JSON.stringify(rows);
}

export const protestRouter = Router();
protestRouter.use(requireAuth);
protestRouter.use(requireRole(["owner", "admin"]));

protestRouter.get("/:propertyId/worksheet", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const query = worksheetQuerySchema.safeParse(req.query ?? {});
  if (!query.success) {
    res.status(400).json({ errors: query.error.issues });
    return;
  }
  const year = query.data.year ?? thisYear();
  if (year < 1000 || year > 9999) {
    res.status(400).json({ message: "Invalid year" });
    return;
  }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  const userId = req.authUser!.userId;
  const worksheet = await getOrCreateWorksheet(property.id, householdId, year);
  void checkProtestDeadlines(householdId, userId);
  res.status(200).json({ worksheet });
});

protestRouter.get("/:propertyId/comps", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const query = worksheetQuerySchema.safeParse(req.query ?? {});
  if (!query.success) {
    res.status(400).json({ errors: query.error.issues });
    return;
  }
  const year = query.data.year ?? thisYear();
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  const comps = await listWorksheetComps(property.id, householdId, year);
  res.status(200).json({ comps });
});

protestRouter.get("/:propertyId/sold-comps", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const query = worksheetQuerySchema.safeParse(req.query ?? {});
  if (!query.success) {
    res.status(400).json({ errors: query.error.issues });
    return;
  }
  const year = query.data.year ?? thisYear();
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  const detail = asRecord(property.valuationDetail);
  const rawComps = Array.isArray(detail?.comps) ? (detail.comps as unknown[]) : [];
  const worksheet = await getWorksheet(property.id, householdId, year);
  const cadCache = worksheet?.soldCompsCadJson ?? {};
  const comps = buildSoldComps(rawComps, cadCache);
  const excluded = await getExcludedSoldComps(property.id, householdId, year);
  res.status(200).json({ comps, excluded });
});

protestRouter.get("/:propertyId/dcad/value-history", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  if (!property.cadAccountId || !property.cadProvider) {
    res.status(404).json({ message: "CAD account not on file — trigger a CAD comps search first" });
    return;
  }
  const adapter = getCadAdapter(property.cadProvider);
  if (!adapter) {
    res.status(404).json({ message: `No CAD adapter registered for provider: ${property.cadProvider}` });
    return;
  }
  const history = await adapter.getValueHistory(property.cadAccountId);
  res.status(200).json({ history });
});

protestRouter.get("/:propertyId/dcad/taxable", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  if (!property.cadAccountId || !property.cadProvider) {
    res.status(404).json({ message: "CAD account not on file — trigger a CAD comps search first" });
    return;
  }
  const adapter = getCadAdapter(property.cadProvider);
  if (!adapter) {
    res.status(404).json({ message: `No CAD adapter registered for provider: ${property.cadProvider}` });
    return;
  }
  const taxable = await adapter.getTaxable(property.cadAccountId);
  res.status(200).json({ taxable });
});

protestRouter.get("/:propertyId/dcad/appeal", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  if (!property.cadAccountId || !property.cadProvider) {
    res.status(404).json({ message: "CAD account not on file — trigger a CAD comps search first" });
    return;
  }
  const adapter = getCadAdapter(property.cadProvider);
  if (!adapter) {
    res.status(404).json({ message: `No CAD adapter registered for provider: ${property.cadProvider}` });
    return;
  }
  const appeals = await adapter.getAppeal(property.cadAccountId);
  res.status(200).json({ appeals });
});

const cadSearchQuerySchema = z.object({
  address: z.string().min(1).max(200),
  year: z.coerce.number().int().min(2000).max(2100).optional()
});

type CadSearchResult = {
  cadPropertyId: string;
  address: string | null;
  city: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  assessedValue: number | null;
  marketValue: number | null;
};

protestRouter.get("/:propertyId/cad-search", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const query = cadSearchQuerySchema.safeParse(req.query ?? {});
  if (!query.success) {
    res.status(400).json({ errors: query.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  const provider = property.cadProvider ?? inferCadProvider(property.state);
  if (!provider) {
    res.status(200).json({ results: [], hasAdapter: false });
    return;
  }
  const adapter = getCadAdapter(provider);
  if (!adapter) {
    res.status(200).json({ results: [], hasAdapter: false });
    return;
  }
  const year = query.data.year ?? new Date().getUTCFullYear();
  const comps = await adapter.searchByAddress(query.data.address, year);
  const results: CadSearchResult[] = comps.map((c) => ({
    cadPropertyId: c.cadPropertyId,
    address: c.address,
    city: c.city,
    sqft: c.sqft,
    beds: c.beds,
    baths: c.baths,
    yearBuilt: c.yearBuilt,
    assessedValue: c.assessedValue,
    marketValue: c.marketValue,
  }));
  log.info("cad-search", { propertyId: params.data.propertyId, address: query.data.address, count: results.length });
  res.status(200).json({ results, hasAdapter: true });
});

const addCompBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  cadPropertyId: z.string().max(100).optional(),
  addressLine1: z.string().min(1).max(200),
  city: z.string().max(100).nullable().optional(),
  sqft: z.number().int().min(1).max(100_000).nullable().optional(),
  beds: z.number().min(0).max(50).nullable().optional(),
  baths: z.number().min(0).max(50).nullable().optional(),
  yearBuilt: z.number().int().min(1800).max(2100).nullable().optional(),
  assessedValueUsd: z.number().int().min(0).nullable().optional(),
  marketValueUsd: z.number().int().min(0).nullable().optional()
});

const soldCompExclusionBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  excluded: z.array(z.string()).max(100)
});

const refreshCompsBodySchema = z.object({
  year: z.number().int().min(2000).max(2100).optional()
});

protestRouter.delete("/:propertyId/comps/:cadPropertyId", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const query = worksheetQuerySchema.safeParse(req.query ?? {});
  if (!query.success) {
    res.status(400).json({ errors: query.error.issues });
    return;
  }
  const year = query.data.year ?? thisYear();
  const { cadPropertyId } = req.params;
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  await deleteCADComp(property.id, householdId, year, cadPropertyId);
  log.info("protest comp deleted", { propertyId: property.id, year, cadPropertyId });
  res.status(200).json({ ok: true });
});

protestRouter.post("/:propertyId/comps", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const parsed = addCompBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  const comp: ManualComp = {
    addressLine1: parsed.data.addressLine1,
    city: parsed.data.city ?? null,
    sqft: parsed.data.sqft ?? null,
    beds: parsed.data.beds ?? null,
    baths: parsed.data.baths ?? null,
    yearBuilt: parsed.data.yearBuilt ?? null,
    assessedValueUsd: parsed.data.assessedValueUsd ?? null,
    marketValueUsd: parsed.data.marketValueUsd ?? null
  };
  const cadPropertyId = await addCADComp(property.id, householdId, parsed.data.year, comp, parsed.data.cadPropertyId);
  const comps = await listWorksheetComps(property.id, householdId, parsed.data.year);
  log.info("protest comp added", { propertyId: property.id, year: parsed.data.year, cadPropertyId, source: parsed.data.cadPropertyId ? "cad-search" : "manual" });
  res.status(201).json({ ok: true, cadPropertyId, comps });
});

protestRouter.post("/:propertyId/refresh-comps", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const parsed = refreshCompsBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }
  const year = parsed.data.year ?? thisYear();

  let cadResult: { ok: boolean; count: number; message?: string } = { ok: false, count: 0 };
  const provider = property.cadProvider ?? inferCadProvider(property.state);
  const cadAdapter = provider ? getCadAdapter(provider) : null;
  if (!cadAdapter) {
    cadResult = { ok: false, count: 0, message: "No CAD adapter for this county" };
  } else {
    const address = [property.addressLine1, property.city, property.state].filter(Boolean).join(", ");
    try {
      await getOrCreateWorksheet(property.id, householdId, year);
      const cadComps = await cadAdapter.searchByAddress(address, year);
      const count = await saveCADComps(property.id, householdId, year, cadComps);
      if (cadComps.length > 0) {
        await saveCadSubjectIds(property.id, provider!, cadComps, address);
      }
      cadResult = { ok: true, count };
    } catch (err) {
      log.error("refresh-comps: CAD error", { propertyId: property.id, err: err instanceof Error ? err.message : String(err) });
      cadResult = { ok: false, count: 0, message: "CAD refresh failed" };
    }
  }

  let redfinResult: { ok: boolean; code?: string; message?: string; estimate?: number } = { ok: false };
  const rr = await refreshPropertyValuation(property.id, householdId);
  redfinResult = rr.ok
    ? { ok: true, estimate: rr.estimate }
    : { ok: false, code: rr.code, message: rr.message };

  const freshProp = await getProperty(property.id, householdId);
  const freshComps = await listWorksheetComps(property.id, householdId, year);
  const detail = asRecord(freshProp?.valuationDetail);
  const rawSoldComps = Array.isArray(detail?.comps) ? (detail.comps as unknown[]) : [];

  // Auto-fetch CAD assessed values for Redfin sold comps (§41.43 support, TX only)
  let soldCompsCadFetched = 0;
  const existingWorksheet = await getWorksheet(property.id, householdId, year);
  const cadCache: Record<string, SoldCompCadEntry> = existingWorksheet?.soldCompsCadJson ?? {};
  const isTx = (property.state ?? "").toUpperCase() === "TX";
  if (isTx && cadAdapter) {
    const addressesToFetch = rawSoldComps
      .map((c) => {
        const r = asRecord(c) ?? {};
        return typeof r.address === "string" ? r.address : null;
      })
      .filter((a): a is string => a !== null && !(a in cadCache))
      .slice(0, 6);

    for (const addr of addressesToFetch) {
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        const results = await cadAdapter.searchByAddress(addr, year);
        const entry = matchCadAssessedValue(results, addr);
        if (entry) {
          cadCache[addr] = entry;
          soldCompsCadFetched++;
        }
      } catch (err) {
        log.warn("refresh-comps: sold comp CAD lookup failed", { addr, err: err instanceof Error ? err.message : String(err) });
      }
    }

    if (soldCompsCadFetched > 0) {
      await saveSoldCompsCadCache(property.id, householdId, year, cadCache);
    }
  }

  const soldComps = buildSoldComps(rawSoldComps, cadCache);

  log.info("refresh-comps", { propertyId: property.id, year, cad: cadResult.ok, redfin: redfinResult.ok, soldCompsCadFetched });
  res.status(200).json({ cad: cadResult, redfin: redfinResult, comps: freshComps, soldComps, soldCompsCadFetched });
});

protestRouter.patch("/:propertyId/sold-comps/exclusions", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const parsed = soldCompExclusionBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  const worksheet = await getOrCreateWorksheet(property.id, householdId, parsed.data.year);
  await setExcludedSoldComps(worksheet.id, householdId, parsed.data.excluded);
  res.status(200).json({ ok: true, excluded: parsed.data.excluded });
});

protestRouter.post("/:propertyId/chat", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const parsedBody = chatBodySchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({ errors: parsedBody.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const year = parsedBody.data.year ?? thisYear();
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  const worksheet = await getOrCreateWorksheet(property.id, householdId, year);

  const detail = asRecord(property.valuationDetail);
  const subject = asRecord(detail?.subject);
  const taxCurrent = asRecord(detail?.taxCurrent);
  const cadAssessed = asNumber(taxCurrent?.assessedValue);
  const address = [property.addressLine1, property.city, property.state].filter(Boolean).join(", ") || "Unknown property";
  const equityComps = await listWorksheetComps(property.id, householdId, year);
  const priorWorksheet = await getWorksheet(property.id, householdId, year - 1);
  const priorYearSummary = priorWorksheet?.cycleSummary ?? null;

  let systemPrompt = buildSystemPrompt({
    address,
    city: property.city,
    state: property.state,
    cadAssessed,
    sqft: asNumber(subject?.sqFt),
    beds: asNumber(subject?.beds),
    baths: asNumber(subject?.baths),
    yearBuilt: asNumber(subject?.yearBuilt),
    purchasePrice: property.purchasePrice,
    purchaseDate: property.purchaseDate,
    status: worksheet.status,
    year,
    cadEvidence: worksheet.cadEvidenceJson,
    soldCompsNotes: worksheet.soldCompsNotesJson,
    equityComps,
    priorYearSummary,
  });

  const userMessage = parsedBody.data.message;
  const queryEmbedding = await embedText(userMessage);
  const ragChunks = await querySimilarChunks({
    propertyId: property.id,
    taxYear: year,
    queryEmbedding,
    topK: 5,
  });
  if (ragChunks.length > 0) {
    const ragBlock = ragChunks.map((c) => `[${c.documentKey}] ${c.chunkText}`).join("\n\n");
    systemPrompt += `\n\n## Relevant document context (retrieved by similarity)\n${ragBlock}`;
  }

  const userText = parsedBody.data.attachmentText
    ? `${parsedBody.data.message}\n\nAttachment (${parsedBody.data.attachmentType ?? "text"}):\n${parsedBody.data.attachmentText}`
    : parsedBody.data.message;

  const liveTurns = worksheet.conversationJson.slice(worksheet.summarizationCursor);
  const historyMessages: ChatMessage[] = [];
  if (worksheet.conversationSummary) {
    historyMessages.push({
      role: "system",
      content: `Earlier conversation summary:\n${worksheet.conversationSummary}`,
    });
  }
  for (const turn of liveTurns) {
    if (turn.role === "tool") {
      historyMessages.push({ role: "assistant", content: turn.content });
    } else {
      historyMessages.push({ role: turn.role as ChatMessage["role"], content: turn.content });
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: userText },
  ];

  let strategyUpdated = false;
  let compsAdded = 0;
  let soldCompsRefreshed = false;

  const chatTools: Tool[] = [
    {
      name: "fetch_dcad_comps",
      description: "Search DCAD for comparable properties by address",
      inputSchema: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"],
      },
    },
    {
      name: "refresh_redfin_comps",
      description: "Re-fetch Redfin data for the subject property to get the latest AVM estimate and comparable sold prices.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "search_web",
      description: "Search the web for comparable property sales, market trends, or appraisal data. Use targeted queries like '123 Main St Dallas TX sold price 2024' or 'Dallas TX property tax protest ARB results 2025'.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
    },
    {
      name: "update_strategy",
      description: "Save the current protest strategy summary",
      inputSchema: {
        type: "object",
        properties: {
          caseStrength: { type: "number" },
          targetValueUsd: { type: "number" },
          primaryStrategy: { type: "string" },
          draftArguments: { type: "array", items: { type: "string" } },
          redFlags: { type: "array", items: { type: "string" } },
        },
        required: ["caseStrength", "targetValueUsd", "primaryStrategy", "draftArguments", "redFlags"],
      },
    },
  ];

  const { finalResponse } = await getToolUseAdapter().runToolLoop(
    messages,
    chatTools,
    async (toolName, args) => {
      if (toolName === "refresh_redfin_comps") {
        const result = await refreshPropertyValuation(property.id, householdId);
        if (result.ok) {
          soldCompsRefreshed = true;
          return `Redfin data refreshed. Updated AVM: ${money(result.estimate)}. The sold comps list has been updated.`;
        }
        if (result.code === "RATE_LIMITED") {
          return "Redfin valuation was refreshed recently (within the last 24 hours). Current data is still fresh — no refresh needed.";
        }
        return `Redfin refresh failed: ${result.message}`;
      }

      if (toolName === "search_web") {
        if (!env.TAVILY_API_KEY) return "Web search is not configured (TAVILY_API_KEY missing).";
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return "No query provided.";
        try {
          const tavilyRes = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, search_depth: "basic", max_results: 5 }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!tavilyRes.ok) return `Tavily returned HTTP ${tavilyRes.status}.`;
          const data = await tavilyRes.json() as { results?: Array<{ title: string; url: string; content: string }> };
          const results = data.results ?? [];
          return results.length === 0
            ? "No results found."
            : results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join("\n\n");
        } catch (err) {
          return `Web search failed: ${err instanceof Error ? err.message : "unknown error"}.`;
        }
      }

      if (toolName === "fetch_dcad_comps") {
        const queryAddress = typeof args.address === "string" && args.address.trim().length > 0
          ? args.address.trim()
          : address;
        const provider = property.cadProvider ?? inferCadProvider(property.state);
        const cadAdapter = provider ? getCadAdapter(provider) : null;
        if (!cadAdapter) return "No CAD adapter configured for this property's county.";
        const comps = await cadAdapter.searchByAddress(queryAddress, year);
        compsAdded = await saveCADComps(property.id, householdId, year, comps);
        if (comps.length > 0) await saveCadSubjectIds(property.id, provider!, comps, queryAddress);
        return formatCompSummary(comps);
      }

      if (toolName === "update_strategy") {
        await updateStrategy(worksheet.id, args as unknown as StrategyJson);
        strategyUpdated = true;
        return "Strategy saved.";
      }

      return "Unsupported tool call";
    },
    { model: strongModel(), maxTokens: 2000, maxIterations: 5 }
  );

  const assistantMessage = finalResponse || "I could not generate a response right now. Please try again.";

  const userTurn: ConversationTurn = {
    role: "user",
    content: parsedBody.data.message,
    ts: new Date().toISOString(),
    attachmentType: parsedBody.data.attachmentType
  };
  const assistantTurn: ConversationTurn = {
    role: "assistant",
    content: assistantMessage,
    ts: new Date().toISOString()
  };

  await appendConversationTurn(worksheet.id, userTurn);
  await appendConversationTurn(worksheet.id, assistantTurn);

  const valuationAgeHours = property.valuationFetchedAt
    ? Math.floor((Date.now() - new Date(property.valuationFetchedAt).getTime()) / (1000 * 60 * 60))
    : null;

  res.status(200).json({
    assistantMessage,
    strategyUpdated,
    compsAdded,
    soldCompsRefreshed,
    valuationAgeHours
  });

  void (async () => {
    try {
      const fresh = await getWorksheet(property.id, householdId, year);
      if (!fresh) return;
      if (fresh.conversationJson.length - fresh.summarizationCursor <= LIVE_TURN_LIMIT) return;
      await runConversationSummarization(
        fresh.id,
        fresh.conversationJson,
        fresh.summarizationCursor,
        fresh.conversationSummary
      );
    } catch (err) {
      log.error("protest chat summarization failed", { worksheetId: worksheet.id, err });
    }
  })();
});

protestRouter.get("/:propertyId/evidence-packet", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const query = evidencePacketQuerySchema.safeParse(req.query ?? {});
  if (!query.success) {
    res.status(400).json({ errors: query.error.issues });
    return;
  }
  const year = query.data.year ?? thisYear();
  const format = query.data.format;
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }

  const worksheet = await getOrCreateWorksheet(property.id, householdId, year);
  const dcadComps = await listWorksheetComps(property.id, householdId, year);

  const detail = asRecord(property.valuationDetail);
  const subject = asRecord(detail?.subject);
  const taxCurrent = asRecord(detail?.taxCurrent);
  const cadAssessed = asNumber(taxCurrent?.assessedValue);
  const avm = (typeof detail?.estimate === "number" ? detail.estimate : null) ?? property.latestValueUsd;

  const rawSoldComps = Array.isArray(detail?.comps) ? (detail.comps as unknown[]) : [];
  const excluded = await getExcludedSoldComps(property.id, householdId, year);
  const excludedSet = new Set(excluded);
  const soldComps: SoldComp[] = buildSoldComps(rawSoldComps, worksheet.soldCompsCadJson)
    .filter((c) => !excludedSet.has(c.address ?? ""));

  const address = [property.addressLine1, property.city, property.state].filter(Boolean).join(", ") || "Unknown Property";
  const safeAddr = address.replace(/[^a-zA-Z0-9 ,]/g, "").replace(/\s+/g, "_").slice(0, 40);

  const packetInput = {
    address,
    taxYear: year,
    cadAssessed,
    avm,
    sqft: asNumber(subject?.sqFt),
    beds: asNumber(subject?.beds),
    baths: asNumber(subject?.baths),
    yearBuilt: asNumber(subject?.yearBuilt),
    hearingDate: worksheet.hearingDate,
    worksheetStatus: worksheet.status,
    strategy: worksheet.strategyJson,
    dcadComps,
    soldComps
  };

  log.info("evidence packet generated", { propertyId: property.id, year, format, comps: dcadComps.length });

  if (format === "docx") {
    const buf = await generateEvidenceDOCX(packetInput);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${safeAddr}_ARB_${year}.docx"`);
    res.send(buf);
  } else {
    const doc = generateEvidencePDF(packetInput);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeAddr}_ARB_${year}.pdf"`);
    doc.pipe(res);
  }
});

protestRouter.patch("/:propertyId/worksheet", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const parsed = patchWorksheetBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  const worksheet = await getOrCreateWorksheet(property.id, householdId, parsed.data.year);
  await updateWorksheetStatus(
    worksheet.id,
    householdId,
    parsed.data.status ?? worksheet.status,
    {
      hearingDate: parsed.data.hearingDate,
      outcome: parsed.data.outcome,
      informalOfferUsd: parsed.data.informalOfferUsd
    }
  );
  if (parsed.data.filingDeadline !== undefined || parsed.data.cadPortalUrl !== undefined) {
    await updateWorksheetMeta(worksheet.id, householdId, {
      filingDeadline: parsed.data.filingDeadline,
      cadPortalUrl: parsed.data.cadPortalUrl
    });
  }
  const updated = await getOrCreateWorksheet(property.id, householdId, parsed.data.year);
  const newOutcome = parsed.data.outcome ?? updated.outcome;
  if (
    newOutcome != null &&
    CLOSED_PROTEST_OUTCOMES.has(newOutcome) &&
    updated.cycleSummary == null &&
    isLlmConfigured()
  ) {
    void generateCycleSummary(updated.id, updated.conversationJson, newOutcome).catch((err) => {
      log.error("protest cycle summary failed", { worksheetId: updated.id, err });
    });
  }
  log.info("protest worksheet updated", {
    worksheetId: worksheet.id,
    propertyId: property.id,
    status: parsed.data.status ?? worksheet.status
  });
  res.status(200).json({ worksheet: updated });
});

// POST /:propertyId/cad-evidence — upload + parse CAD evidence PDF
protestRouter.post(
  "/:propertyId/cad-evidence",
  upload.single("file"),
  async (req: AuthenticatedRequest, res) => {
    const params = propertyIdSchema.safeParse(req.params);
    if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
    const taxYear = parseInt(String(req.query["taxYear"]), 10) || thisYear();
    const householdId = req.authUser!.householdId;
    const property = await getProperty(params.data.propertyId, householdId);
    if (!property) { res.status(404).json({ message: "Property not found" }); return; }
    if (!req.file) { res.status(400).json({ message: "No file uploaded" }); return; }
    if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
      res.status(400).json({ message: "Only PDF files are supported" });
      return;
    }
    try {
      const data = await parseCadEvidencePdf(req.file.buffer);
      await getOrCreateWorksheet(property.id, householdId, taxYear);
      await saveCadEvidence(property.id, householdId, taxYear, data, req.file.originalname);
      void extractPdfText(req.file.buffer)
        .then((rawText) => {
          const chunks = chunkText(rawText);
          if (chunks.length === 0) return;
          return saveDocumentChunks({
            householdId,
            propertyId: property.id,
            taxYear,
            documentKey: "cad_evidence",
            chunks,
          });
        })
        .catch((err) => {
          log.error("cad-evidence document chunking failed", { propertyId: property.id, taxYear, err });
        });
      log.info("cad-evidence uploaded", { propertyId: property.id, taxYear, salesComps: data.salesAnalysis.comps.length, equityComps: data.equityAnalysis.comps.length });
      res.status(200).json({ data, filename: req.file.originalname });
    } catch (err) {
      log.error("cad-evidence parse failed", { err });
      res.status(422).json({ message: "Failed to parse PDF. Ensure this is a DCAD evidence packet." });
    }
  }
);

// DELETE /:propertyId/cad-evidence — clear parsed evidence
protestRouter.delete("/:propertyId/cad-evidence", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const taxYear = parseInt(String(req.query["taxYear"]), 10) || thisYear();
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }
  await deleteCadEvidence(property.id, householdId, taxYear);
  res.status(204).send();
});

// PATCH /:propertyId/sold-comps/notes — save annotation on a Redfin sold comp
protestRouter.patch("/:propertyId/sold-comps/notes", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const taxYear = parseInt(String(req.query["taxYear"]), 10) || thisYear();
  const parsed = z.object({ address: z.string().min(1), notes: z.string() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }
  await saveSoldCompNote(property.id, householdId, taxYear, parsed.data.address, parsed.data.notes);
  res.status(204).send();
});

// POST /:propertyId/documents — upload arbitrary PDF or image for RAG
protestRouter.post(
  "/:propertyId/documents",
  upload.single("file"),
  async (req: AuthenticatedRequest, res) => {
    const params = propertyIdSchema.safeParse(req.params);
    if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
    const taxYear = parseInt(String(req.query["taxYear"]), 10) || thisYear();
    const householdId = req.authUser!.householdId;
    const property = await getProperty(params.data.propertyId, householdId);
    if (!property) { res.status(404).json({ message: "Property not found" }); return; }
    if (!req.file) { res.status(400).json({ message: "No file uploaded" }); return; }
    if (!isLlmConfigured()) {
      res.status(503).json({ message: "LLM provider not configured", code: "LLM_NOT_CONFIGURED" });
      return;
    }

    const mime = req.file.mimetype;
    let chunks: string[] = [];
    let documentKey: string;

    try {
      if (mime === "application/pdf") {
        const rawText = await extractPdfText(req.file.buffer);
        chunks = chunkText(rawText);
        documentKey = `file:${req.file.originalname}`;
      } else if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
        const { content: description } = await getVisionAdapter().complete(
          [{
            role: "user",
            content: [
              { type: "image", mimeType: mime, base64Data: req.file.buffer.toString("base64") },
              {
                type: "text",
                text: "Describe this property image in detail. Note visible features, condition, any visible structural issues, lot characteristics, improvements, and anything relevant to a property tax protest.",
              },
            ],
          }],
          { model: strongModel(), maxTokens: 1000 }
        );
        if (description.trim().length > 20) {
          chunks = [description.trim()];
        }
        documentKey = `image:${req.file.originalname}`;
      } else {
        res.status(400).json({ message: "Unsupported file type. Use PDF, JPEG, PNG, or WebP." });
        return;
      }

      if (chunks.length === 0) {
        res.status(422).json({ message: "No extractable text from file" });
        return;
      }

      await saveDocumentChunks({
        householdId,
        propertyId: property.id,
        taxYear,
        documentKey,
        chunks,
      });
      res.status(200).json({ ok: true, documentKey, chunkCount: chunks.length });
    } catch (err) {
      log.error("protest document upload failed", { propertyId: property.id, taxYear, err });
      res.status(500).json({ message: "Failed to process uploaded file" });
    }
  }
);

// GET /:propertyId/documents — list indexed protest documents
protestRouter.get("/:propertyId/documents", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const taxYear = parseInt(String(req.query["taxYear"]), 10) || thisYear();
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }
  const documents = await listDocuments(property.id, taxYear);
  res.status(200).json({ ok: true, documents });
});

// DELETE /:propertyId/documents/:documentKey — remove indexed document chunks
protestRouter.delete("/:propertyId/documents/:documentKey", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const documentKey = decodeURIComponent(String(req.params.documentKey ?? ""));
  if (!documentKey) { res.status(400).json({ message: "documentKey required" }); return; }
  const taxYear = parseInt(String(req.query["taxYear"]), 10) || thisYear();
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }
  await deleteDocumentChunks(property.id, taxYear, documentKey);
  res.status(204).send();
});

// PATCH /:propertyId/comps/:cadPropertyId/notes — save annotation on an equity comp
protestRouter.patch("/:propertyId/comps/:cadPropertyId/notes", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid(), cadPropertyId: z.string().min(1) }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const taxYear = parseInt(String(req.query["taxYear"]), 10) || thisYear();
  const parsed = z.object({ notes: z.string() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }
  await updateCompNote(property.id, householdId, taxYear, params.data.cadPropertyId, parsed.data.notes);
  res.status(204).send();
});

protestRouter.post("/:propertyId/generate-arb-script", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  if (!isLlmConfigured()) {
    res.status(503).json({ message: "LLM provider not configured", code: "LLM_NOT_CONFIGURED" });
    return;
  }
  const householdId = req.authUser!.householdId;
  const year = parseInt(String(req.query["year"] ?? ""), 10) || thisYear();
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }

  const worksheet = await getWorksheet(property.id, householdId, year);
  if (!worksheet) { res.status(404).json({ message: "Worksheet not found" }); return; }
  if (worksheet.status !== "arb") {
    res.status(400).json({ message: "ARB script can only be generated when protest status is 'arb'", code: "STATUS_NOT_ARB" });
    return;
  }

  const equityComps = await listWorksheetComps(property.id, householdId, year);

  const detail = asRecord(property.valuationDetail);
  const subject = asRecord(detail?.subject);
  const taxCurrent = asRecord(detail?.taxCurrent);
  const cadAssessed = worksheet.cadEvidenceJson?.assessedValueUsd ?? asNumber(taxCurrent?.assessedValue);

  const input: ArbScriptInput = {
    address: property.addressLine1 ?? "",
    city: property.city,
    state: property.state,
    cadAssessed,
    sqft: asNumber(subject?.sqFt),
    beds: asNumber(subject?.beds),
    baths: asNumber(subject?.baths),
    yearBuilt: asNumber(subject?.yearBuilt),
    purchasePrice: property.purchasePrice,
    purchaseDate: property.purchaseDate,
    hearingDate: worksheet.hearingDate,
    taxYear: year,
    cadEvidence: worksheet.cadEvidenceJson,
    equityComps,
    soldCompsNotes: worksheet.soldCompsNotesJson,
    strategyTargetValueUsd: worksheet.strategyJson?.targetValueUsd ?? null,
    strategyPrimaryStrategy: worksheet.strategyJson?.primaryStrategy ?? null,
    strategyArguments: worksheet.strategyJson?.draftArguments ?? [],
  };

  log.info("generate-arb-script: starting", { propertyId: property.id, year });
  const script = await generateArbScript(input);
  await saveArbScript(property.id, householdId, year, script);
  log.info("generate-arb-script: done", { propertyId: property.id, year });
  res.json({ script });
});
