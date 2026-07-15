import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { log } from "../../logger.js";
import { getChatAdapter, getToolUseAdapter, getVisionAdapter, chatModel, strongModel, isLlmConfigured } from "../../llm/index.js";
import type { Tool, ChatMessage } from "../../llm/index.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { getProperty, refreshPropertyValuation, updatePropertyAppraisalNotice } from "../household/property.service.js";
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
  type CompSource,
  deleteComp,
  addManualComp,
  excludeComp,
  updateCompNote,
  type CadEvidenceData,
  saveCadEvidence,
  deleteCadEvidence,
  updateSummarizationState,
  saveCycleSummary,
  saveArbScript,
  runDcadBackfill,
  applyCanonicalToComp,
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
import { fetchDcadCanonical, fetchDcadAppraisalNoticeS3Id, fetchDcadAppraisalNoticePdf, getCompImprovementFeatures } from "./dcad-enrichment.service.js";
import { tavilySearch } from "../../llm/tools/tavily.js";

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


function buildCompsContext(comps: import("./protest-worksheet.service.js").UnifiedComp[]): string {
  const equityComps = comps.filter(c => c.source === "dcad_search" || c.source === "cad_evidence");
  const soldComps = comps.filter(c => (c.source === "redfin" || c.source === "manual") && !c.excluded);

  if (equityComps.length === 0 && soldComps.length === 0) return "";

  const lines: string[] = ["\n## Comparable Properties (already loaded in database — do NOT call fetch_dcad_comps unless user explicitly asks to re-search)"];

  if (equityComps.length > 0) {
    const perSqfts = equityComps.filter(c => c.cadPerSqftAssessed != null).map(c => c.cadPerSqftAssessed!);
    const sorted = [...perSqfts].sort((a, b) => a - b);
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
    const mean = perSqfts.length > 0 ? perSqfts.reduce((s, v) => s + v, 0) / perSqfts.length : null;
    lines.push(`\n§41.43 Equity Comps — ${equityComps.length} loaded (CAD-assessed comparables):`);
    for (const c of equityComps) {
      const ps = c.cadPerSqftAssessed != null ? `$${c.cadPerSqftAssessed.toFixed(2)}/sqft` : "no $/sqft";
      const pool = c.hasPool ? " pool" : "";
      lines.push(`  ${c.addressLine1 ?? "—"} | ${c.sqft != null ? c.sqft.toLocaleString() + " sqft" : "—"} | yr ${c.yearBuilt ?? "—"}${pool} | assessed ${money(c.cadAssessedValueUsd)} | ${ps}${c.notes ? ` | NOTE: ${c.notes}` : ""}`);
    }
    if (median != null) lines.push(`Equity comp $/sqft — median: $${median.toFixed(2)} | mean: ${mean != null ? "$" + mean.toFixed(2) : "—"} | range: $${sorted[0].toFixed(2)}–$${sorted[sorted.length - 1].toFixed(2)}`);
  }

  if (soldComps.length > 0) {
    const soldPsArr = soldComps
      .filter(c => c.soldPriceUsd != null && c.sqft != null && c.sqft > 0)
      .map(c => c.soldPriceUsd! / c.sqft!);
    const soldSorted = [...soldPsArr].sort((a, b) => a - b);
    const soldMedian = soldSorted.length > 0 ? soldSorted[Math.floor(soldSorted.length / 2)] : null;
    lines.push(`\n§41.41 Sold Comps — ${soldComps.length} loaded (recent market sales):`);
    for (const c of soldComps) {
      const ps = c.soldPriceUsd != null && c.sqft != null && c.sqft > 0 ? `$${(c.soldPriceUsd / c.sqft).toFixed(2)}/sqft` : "no $/sqft";
      lines.push(`  ${c.addressLine1 ?? "—"} | sold ${c.soldDate ?? "—"} | ${money(c.soldPriceUsd)} | ${c.sqft != null ? c.sqft.toLocaleString() + " sqft" : "—"} | ${ps}${c.notes ? ` | NOTE: ${c.notes}` : ""}`);
    }
    if (soldMedian != null) lines.push(`Market sales $/sqft median: $${soldMedian.toFixed(2)}`);
  }

  return lines.join("\n");
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
  hearingDate: string | null;
  filingDeadline: string | null;
  informalOfferUsd: number | null;
  cadEvidence: CadEvidenceData | null;
  comps: import("./protest-worksheet.service.js").UnifiedComp[];
  strategyJson: import("./protest-worksheet.service.js").StrategyJson | null;
  priorYearSummary?: string | null;
}): string {
  const evidenceContext = buildCadEvidenceContext(input.cadEvidence, input.cadAssessed);
  const compsContext = buildCompsContext(input.comps);
  const priorYearBlock = input.priorYearSummary?.trim()
    ? `\n## Prior year context\n${input.priorYearSummary.trim()}`
    : "";
  const strategyBlock = input.strategyJson
    ? `\n## Previously saved strategy\nCase strength: ${input.strategyJson.caseStrength}/10 | Target: ${money(input.strategyJson.targetValueUsd)} | Primary: ${input.strategyJson.primaryStrategy}\nArguments: ${input.strategyJson.draftArguments?.join("; ")}\nRed flags: ${input.strategyJson.redFlags?.join("; ")}`
    : "";

  const deadlineBlock = [
    input.hearingDate ? `ARB Hearing: ${input.hearingDate}` : null,
    input.filingDeadline ? `Filing Deadline: ${input.filingDeadline}` : null,
    input.informalOfferUsd != null ? `Informal offer on table: ${money(input.informalOfferUsd)}` : null,
  ].filter(Boolean).join(" | ");

  const equityComps = input.comps.filter(c => c.source === "dcad_search" || c.source === "cad_evidence");
  const equityPerSqfts = equityComps.filter(c => c.cadPerSqftAssessed != null).map(c => c.cadPerSqftAssessed!);
  const equityMedian = equityPerSqfts.length > 0
    ? [...equityPerSqfts].sort((a, b) => a - b)[Math.floor(equityPerSqfts.length / 2)]
    : null;
  const subjectPerSqft = input.cadAssessed != null && input.sqft != null && input.sqft > 0
    ? input.cadAssessed / input.sqft
    : null;

  const strengthSignal = equityMedian != null && subjectPerSqft != null
    ? `Subject $/sqft: $${subjectPerSqft.toFixed(2)} vs equity comp median: $${equityMedian.toFixed(2)} → gap: ${subjectPerSqft > equityMedian ? "+" : ""}$${(subjectPerSqft - equityMedian).toFixed(2)}/sqft (${subjectPerSqft > equityMedian ? "§41.43 SUPPORTED" : "subject below median — weak §41.43"})`
    : "";

  const statusInstructions: Record<ProtestStatus, string> = {
    not_filed: `
## Your role at status: not_filed
The protest has NOT been filed yet. Start by gathering the information you need to give a strong recommendation.
On the FIRST message (or if you lack critical data), ask these preliminary questions before diving into analysis:
1. Does the user have a target assessed value in mind? Why?
2. Are there any known issues with the property (condition problems, incorrect sqft, deferred maintenance) that would support a lower value?
3. Has the user protested before, and what was the outcome?
Once you have context (or if the data above is sufficient), proactively:
- Compute the equity gap (subject $/sqft vs. comp median $/sqft) and state whether §41.43 is strong, weak, or inconclusive
- Compute the implied reduction if brought to comp median
- Recommend whether to file and on which grounds
- Flag what data is missing (no comps loaded, no CAD evidence uploaded, etc.)`,
    filed: `
## Your role at status: filed
Protest is filed. Focus on building the strongest evidence package before the informal meeting.
- Summarize the current evidence: how many comps, what grounds are supportable, case strength estimate
- Identify gaps: missing comps, thin evidence, data quality issues
- Recommend what additional data to gather (more comps, CAD evidence PDF, market sales)
- Advise on the informal meeting: what number to open with, what to accept`,
    informal: `
## Your role at status: informal
The informal meeting is approaching or has occurred${input.informalOfferUsd != null ? `. An offer of ${money(input.informalOfferUsd)} is on the table` : ""}.
- If an offer exists: evaluate it against the evidence. Should the user accept, counter, or proceed to ARB?
- Calculate what a successful ARB outcome would likely yield vs. the settlement offer
- Advise on the risk/reward of going to ARB given the evidence strength
- If the offer is close to the comp-supported value, recommend accepting — ARB is time-intensive and not guaranteed`,
    arb: `
## Your role at status: arb
The ARB hearing is ${input.hearingDate ? `scheduled for ${input.hearingDate}` : "scheduled"}.
Focus on hearing preparation:
- Draft 5–7 talking points ordered by expected impact — lead with §41.43 if equity gap is significant
- Identify the 3–4 strongest comps to present and explain why they're favorable
- Anticipate the appraiser's pushback and prepare rebuttals
- Advise on hearing mechanics: who speaks first, how to present exhibits, what to ask for on the record
- State the specific reduction target and the legal basis`,
    resolved: `
## Your role at status: resolved
The protest is resolved. Switch to documentation and lessons-learned mode.
- Summarize what worked and what didn't
- Note which comps and arguments were most effective for future reference
- Flag any issues to address before next year's protest cycle`,
  };

  return `You are a property tax protest strategist for ${input.address}, ${input.city ?? ""} ${input.state ?? ""}.

## Property facts (Tax Year ${input.year})
- CAD assessed value: ${money(input.cadAssessed)}
- Sqft: ${input.sqft ?? "—"} | Beds: ${input.beds ?? "—"} | Baths: ${input.baths ?? "—"} | Year built: ${input.yearBuilt ?? "—"}
- Purchase price: ${money(input.purchasePrice)} (${input.purchaseDate ?? "—"})
${deadlineBlock ? `- ${deadlineBlock}` : ""}
${strengthSignal ? `- ${strengthSignal}` : ""}

## Protest status: ${input.status}
${statusInstructions[input.status] ?? ""}

## Texas protest grounds
- §41.41 (Market value): Assessed value exceeds fair market value. Argue with recent arm's-length sale prices of comparable properties.
- §41.43 (Unequal appraisal): Subject assessed at higher ratio than comparable properties. Argue with CAD-assessed values of similar nearby properties — Redfin AVM and Zillow have no standing at ARB.
${evidenceContext}${compsContext}${strategyBlock}${priorYearBlock}

## Advisor rules
- Think like a property tax attorney: analytically rigorous, evidence-driven, results-oriented. Your job is to WIN.
- Commit to positions. When evidence supports a lower value, give the exact number.
- Push back when warranted. If the user's target isn't supportable, say so and state what IS supportable.
- Use DCAD's own comp data against them — inequitable assessment using their own numbers is the strongest argument.
- When DCAD comps are missing or thin, use search_web or suggest alternative comp sources before conceding.
- Never soften a well-supported argument to seem diplomatic.
- Be concise. Lead with the conclusion, follow with the evidence.
- After giving your assessment, call update_strategy to save the case strength, target value, and key arguments.`;
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

const compsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  includeExcluded: z.preprocess((v) => v === "true" || v === true, z.boolean()).optional(),
  sources: z.union([z.string(), z.array(z.string())]).optional().transform((v) => {
    if (!v) return undefined;
    return (Array.isArray(v) ? v : [v]) as CompSource[];
  }),
});

protestRouter.get("/:propertyId/comps", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const query = compsQuerySchema.safeParse(req.query ?? {});
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
  const comps = await listWorksheetComps(property.id, householdId, year, {
    includeExcluded: query.data.includeExcluded,
    sources: query.data.sources,
  });
  res.status(200).json({ comps });
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
  if (!property.cadAccountId) {
    res.status(404).json({ message: "CAD account not on file — trigger a CAD comps search first" });
    return;
  }
  const provider = property.cadProvider ?? inferCadProvider(property.state);
  const adapter = provider ? getCadAdapter(provider) : null;
  if (!adapter) {
    res.status(404).json({ message: `No CAD adapter registered for provider: ${provider ?? property.state}` });
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
  if (!property.cadAccountId) {
    res.status(404).json({ message: "CAD account not on file — trigger a CAD comps search first" });
    return;
  }
  const provider = property.cadProvider ?? inferCadProvider(property.state);
  const adapter = provider ? getCadAdapter(provider) : null;
  if (!adapter) {
    res.status(404).json({ message: `No CAD adapter registered for provider: ${provider ?? property.state}` });
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
  if (!property.cadAccountId) {
    res.status(404).json({ message: "CAD account not on file — trigger a CAD comps search first" });
    return;
  }
  const provider = property.cadProvider ?? inferCadProvider(property.state);
  const adapter = provider ? getCadAdapter(provider) : null;
  if (!adapter) {
    res.status(404).json({ message: `No CAD adapter registered for provider: ${provider ?? property.state}` });
    return;
  }
  const appeals = await adapter.getAppeal(property.cadAccountId);
  res.status(200).json({ appeals });
});


protestRouter.get("/:propertyId/appraisal-notice-link", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }
  if (!property.cadAccountId) {
    res.status(404).json({ message: "DCAD account ID not on file — trigger a DCAD backfill first" });
    return;
  }
  const county = property.cadProvider === "dcad" ? "Denton" : null;
  const s3Id = await fetchDcadAppraisalNoticeS3Id(property.cadAccountId, county ?? undefined);
  if (s3Id) {
    await updatePropertyAppraisalNotice(params.data.propertyId, householdId, s3Id).catch(() => {});
  }
  res.status(200).json({
    available: s3Id != null,
    s3Id: s3Id ?? null,
    fetchedAt: s3Id ? new Date().toISOString() : null,
  });
});

protestRouter.get("/:propertyId/appraisal-notice-pdf", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }
  if (!property.cadAccountId) {
    res.status(404).json({ message: "DCAD account ID not on file" });
    return;
  }
  const county = property.cadProvider === "dcad" ? "Denton" : null;
  let s3Id = property.cadAppraisalNoticeS3id;
  if (!s3Id) {
    s3Id = await fetchDcadAppraisalNoticeS3Id(property.cadAccountId, county ?? undefined);
    if (s3Id) {
      await updatePropertyAppraisalNotice(params.data.propertyId, householdId, s3Id).catch(() => {});
    }
  }
  if (!s3Id) {
    res.status(404).json({ message: "Appraisal notice not available for this property" });
    return;
  }
  const pdf = await fetchDcadAppraisalNoticePdf(s3Id, county ?? undefined);
  if (!pdf.ok) {
    res.status(502).json({ message: "Failed to fetch PDF from DCAD" });
    return;
  }
  res.setHeader("Content-Type", pdf.contentType);
  res.setHeader("Content-Disposition", `inline; filename="appraisal-notice.pdf"`);
  res.end(pdf.buffer);
});

const cadSearchQuerySchema = z.object({
  address: z.string().min(1).max(200),
  year: z.coerce.number().int().min(2000).max(2100).optional()
});

type CadSearchResult = {
  cadPropertyId: string;
  accountId: number | null;
  address: string | null;
  city: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  assessedValue: number | null;
  marketValue: number | null;
  miscImprovements: { description: string; valueUsd: number | null; yearBuilt: number | null }[];
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
  const countyHint = property.cadProvider === "dcad" ? "Denton" : null;
  const results: CadSearchResult[] = await Promise.all(
    comps.map(async (c) => {
      let beds = c.beds;
      let baths = c.baths;
      let sqft = c.sqft;
      let miscImprovements: { description: string; valueUsd: number | null; yearBuilt: number | null }[] = [];
      if (c.accountId != null) {
        const features = await getCompImprovementFeatures(c.accountId, countyHint).catch(() => null);
        if (features) {
          beds = beds ?? features.beds;
          baths = baths ?? features.baths;
          // Always prefer improvement-features sqft when available — more accurate than search result placeholder
          sqft = features.sqft != null ? Math.round(features.sqft) : sqft;
          miscImprovements = features.miscImprovements;
        }
      }
      return {
        cadPropertyId: c.cadPropertyId,
        accountId: c.accountId,
        address: c.address,
        city: c.city,
        sqft,
        beds,
        baths,
        yearBuilt: c.yearBuilt,
        assessedValue: c.assessedValue,
        marketValue: c.marketValue,
        miscImprovements,
      };
    })
  );
  log.info("cad-search", { propertyId: params.data.propertyId, address: query.data.address, count: results.length });
  res.status(200).json({ results, hasAdapter: true });
});

const addCompBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  source: z.enum(["manual", "dcad_search"]).default("manual"),
  cadPropertyId: z.string().max(100).optional(),
  cadAccountId: z.number().int().positive().nullable().optional(),
  addressLine1: z.string().min(1).max(200),
  city: z.string().max(100).nullable().optional(),
  sqft: z.number().int().min(1).max(100_000).nullable().optional(),
  beds: z.number().min(0).max(50).nullable().optional(),
  baths: z.number().min(0).max(50).nullable().optional(),
  yearBuilt: z.number().int().min(1800).max(2100).nullable().optional(),
  cadAssessedValueUsd: z.number().int().min(0).nullable().optional(),
  cadMarketValueUsd: z.number().int().min(0).nullable().optional(),
  soldPriceUsd: z.number().int().min(0).nullable().optional(),
  soldDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const excludeCompBodySchema = z.object({
  excluded: z.boolean()
});

const refreshCompsBodySchema = z.object({
  year: z.number().int().min(2000).max(2100).optional()
});

protestRouter.delete("/:propertyId/comps/:compId", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid(), compId: z.string().uuid() }).safeParse(req.params);
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
  const success = await deleteComp(property.id, householdId, params.data.compId);
  if (!success) {
    res.status(404).json({ message: "Comp not found" });
    return;
  }
  log.info("protest comp deleted", { propertyId: property.id, compId: params.data.compId });
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

  try {
    const comp = await addManualComp(property.id, householdId, parsed.data.year, {
      addressLine1: parsed.data.addressLine1,
      city: parsed.data.city ?? null,
      sqft: parsed.data.sqft ?? null,
      beds: parsed.data.beds ?? null,
      baths: parsed.data.baths ?? null,
      yearBuilt: parsed.data.yearBuilt ?? null,
      cadAssessedValueUsd: parsed.data.cadAssessedValueUsd ?? null,
      cadMarketValueUsd: parsed.data.cadMarketValueUsd ?? null,
      cadPropertyId: parsed.data.cadPropertyId ?? null,
      cadAccountId: parsed.data.cadAccountId ?? null,
      soldPriceUsd: parsed.data.soldPriceUsd ?? null,
      soldDate: parsed.data.soldDate ?? null,
    });

    // Fire-and-forget DCAD enrichment — only for DCAD-jurisdiction properties
    if (property.cadProvider === "dcad") {
      void fetchDcadCanonical({
        address: parsed.data.addressLine1,
        taxYear: parsed.data.year,
        county: "Denton",
      }).then((canonical) => {
        if (canonical) return applyCanonicalToComp(comp.id, canonical);
      }).catch((err: unknown) => {
        log.warn("manual comp DCAD enrichment failed", {
          compId: comp.id,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }

    const comps = await listWorksheetComps(property.id, householdId, parsed.data.year);
    log.info("protest comp added", { propertyId: property.id, year: parsed.data.year, compId: comp.id, source: parsed.data.source });
    res.status(201).json({ ok: true, comp, comps });
  } catch (err) {
    log.warn("POST /comps failed", { propertyId: property.id, err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ message: "Failed to add comp" });
  }
});

protestRouter.patch("/:propertyId/comps/:compId/exclude", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid(), compId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errors: params.error.issues });
    return;
  }
  const parsed = excludeCompBodySchema.safeParse(req.body ?? {});
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
  const success = await excludeComp(property.id, householdId, params.data.compId, parsed.data.excluded);
  if (!success) {
    res.status(404).json({ message: "Comp not found" });
    return;
  }
  log.info("protest comp exclusion toggled", { propertyId: property.id, compId: params.data.compId, excluded: parsed.data.excluded });
  res.status(200).json({ ok: true });
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

  // 1. Redfin refresh (saves comps to protest_comp)
  let redfinResult: { ok: boolean; code?: string; message?: string; estimate?: number } = { ok: false };
  const rr = await refreshPropertyValuation(property.id, householdId);
  redfinResult = rr.ok
    ? { ok: true, estimate: rr.estimate }
    : { ok: false, code: rr.code, message: rr.message };

  // 2. Fire-and-forget DCAD backfill — only for DCAD-jurisdiction properties
  const address = [property.addressLine1, property.city, property.state].filter(Boolean).join(", ");
  const dcadStarted = property.cadProvider === "dcad";
  if (dcadStarted) {
    void runDcadBackfill(property.id, householdId, address, year, "Denton").catch((err: unknown) => {
      log.warn("runDcadBackfill: uncaught error", { propertyId: property.id, err: err instanceof Error ? err.message : String(err) });
    });
  }

  // 3. Return fresh comps
  const freshComps = await listWorksheetComps(property.id, householdId, year);

  log.info("refresh-comps", { propertyId: property.id, year, redfin: redfinResult.ok, dcadStarted });
  res.status(200).json({ redfin: redfinResult, dcadStarted, comps: freshComps });
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
  const cadAssessed = worksheet.cadEvidenceJson?.assessedValueUsd ?? property.cadAssessedValueUsd ?? asNumber(taxCurrent?.assessedValue);
  const address = [property.addressLine1, property.city, property.state].filter(Boolean).join(", ") || "Unknown property";
  const [priorWorksheet, existingComps] = await Promise.all([
    getWorksheet(property.id, householdId, year - 1),
    listWorksheetComps(property.id, householdId, year),
  ]);
  const priorYearSummary = priorWorksheet?.cycleSummary ?? null;

  let systemPrompt = buildSystemPrompt({
    address,
    city: property.city,
    state: property.state,
    cadAssessed,
    sqft: asNumber(subject?.sqFt) ?? worksheet.cadEvidenceJson?.livingAreaSqft ?? null,
    beds: asNumber(subject?.beds),
    baths: asNumber(subject?.baths),
    yearBuilt: asNumber(subject?.yearBuilt) ?? worksheet.cadEvidenceJson?.yearBuilt ?? null,
    purchasePrice: property.purchasePrice,
    purchaseDate: property.purchaseDate,
    status: worksheet.status,
    year,
    hearingDate: worksheet.hearingDate,
    filingDeadline: worksheet.filingDeadline,
    informalOfferUsd: worksheet.informalOfferUsd,
    cadEvidence: worksheet.cadEvidenceJson,
    comps: existingComps,
    strategyJson: worksheet.strategyJson,
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
        const query = typeof args.query === "string" ? args.query : "";
        const result = await tavilySearch(query);
        return result.ok ? result.text : result.message;
      }

      if (toolName === "fetch_dcad_comps") {
        if (property.cadProvider !== "dcad") {
          return "DCAD is not available for this property — it is outside Denton County jurisdiction.";
        }
        const queryAddress = typeof args.address === "string" && args.address.trim().length > 0
          ? args.address.trim()
          : address;
        void runDcadBackfill(property.id, householdId, queryAddress, year, "Denton");
        compsAdded = 1; // signal that backfill was started
        return `DCAD search started for ${queryAddress}. Comps will be enriched and saved to the database.`;
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
  const allComps = await listWorksheetComps(property.id, householdId, year);
  const dcadComps = allComps.filter(c => c.source === 'dcad_search' || c.source === 'cad_evidence');
  const soldComps: SoldComp[] = allComps
    .filter(c => c.source === 'redfin' || c.source === 'manual')
    .filter(c => !c.excluded)
    .map(c => ({
      address: c.addressLine1,
      city: c.city,
      state: c.state,
      sqft: c.sqft,
      beds: c.beds,
      baths: c.baths,
      yearBuilt: c.yearBuilt,
      soldPrice: c.soldPriceUsd,
      soldDate: c.soldDate,
      pricePerSqft: c.pricePerSqft,
      listPrice: c.listPriceUsd,
      cadAssessedValueUsd: c.cadAssessedValueUsd,
    }));

  const detail = asRecord(property.valuationDetail);
  const subject = asRecord(detail?.subject);
  const taxCurrent = asRecord(detail?.taxCurrent);
  const avm = (typeof detail?.estimate === "number" ? detail.estimate : null) ?? property.latestValueUsd;

  const address = [property.addressLine1, property.city, property.state].filter(Boolean).join(", ") || "Unknown Property";
  const safeAddr = address.replace(/[^a-zA-Z0-9 ,]/g, "").replace(/\s+/g, "_").slice(0, 40);

  const cadEv = worksheet.cadEvidenceJson;
  // Prefer CAD evidence PDF → DCAD-stored value → Redfin (Redfin taxCurrent can lag by a year)
  const cadAssessed = cadEv?.assessedValueUsd ?? property.cadAssessedValueUsd ?? asNumber(taxCurrent?.assessedValue);
  const equityMedianUsd = cadEv?.equityAnalysis?.medianIndValueUsd ?? null;

  // Map dcadComps to ProtestComp shape for PDF generator
  const dcadCompsForPdf = dcadComps.map(c => ({
    cadPropertyId: c.cadPropertyId ?? '',
    addressLine1: c.addressLine1,
    city: c.city,
    assessedValueUsd: c.cadAssessedValueUsd,
    marketValueUsd: c.cadMarketValueUsd,
    sqft: c.sqft,
    beds: c.beds,
    baths: c.baths,
    yearBuilt: c.yearBuilt,
    perSqftUsd: c.cadPerSqftAssessed,
    notes: c.notes,
  }));

  const packetInput = {
    address,
    city: property.city ?? null,
    state: property.state ?? null,
    taxYear: year,
    cadPropertyId: property.cadPropertyId ?? null,
    cadAssessed,
    avm,
    equityMedianUsd,
    sqft: asNumber(subject?.sqFt) ?? cadEv?.livingAreaSqft ?? null,
    beds: asNumber(subject?.beds),
    baths: asNumber(subject?.baths),
    yearBuilt: asNumber(subject?.yearBuilt) ?? cadEv?.yearBuilt ?? null,
    lotSqft: cadEv?.lotSqft ?? null,
    percentGood: cadEv?.percentGood ?? null,
    improvementsUsd: cadEv?.improvementsUsd ?? null,
    landValueUsd: cadEv?.landValueUsd ?? null,
    purchasePrice: property.purchasePrice ?? null,
    purchaseDate: property.purchaseDate ?? null,
    hearingDate: worksheet.hearingDate,
    worksheetStatus: worksheet.status,
    strategy: worksheet.strategyJson,
    dcadComps: dcadCompsForPdf,
    soldComps,
    manualSoldComps: [],
    soldCompsNotes: {} as Record<string, string>,
    cadEvidence: cadEv ?? null,
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

// ── GET /:propertyId/protest-brief ─────────────────────────────────────────────
// Deterministic backend formatter: assembles all property + protest data into a
// structured plain-text brief suitable for pasting into any AI assistant.
// Numbers come directly from the database — no LLM generation involved.
protestRouter.get("/:propertyId/protest-brief", async (req: AuthenticatedRequest, res) => {
  const params = propertyIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const query = worksheetQuerySchema.safeParse(req.query ?? {});
  if (!query.success) { res.status(400).json({ errors: query.error.issues }); return; }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }

  const year = query.data.year ?? new Date().getUTCFullYear();
  const worksheet = await getWorksheet(property.id, householdId, year);
  const allComps = await listWorksheetComps(property.id, householdId, year);
  const cadComps = allComps.filter(c => !c.excluded);

  const vd = property.valuationDetail;
  const cadEv = worksheet?.cadEvidenceJson ?? null;
  const subject = vd?.subject ?? null;

  const fmt = (n: number | null | undefined, prefix = "$") =>
    n != null ? `${prefix}${Math.round(n).toLocaleString()}` : "—";
  const fmtPct = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null && b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—";
  const pad = (s: string | null | undefined, w: number) =>
    String(s ?? "—").padEnd(w).slice(0, w);

  // Assessed value — prefer CAD evidence PDF → DCAD-stored value → Redfin (Redfin taxCurrent can lag a year)
  const proposedAssessed: number | null = cadEv?.assessedValueUsd ?? property.cadAssessedValueUsd ?? (vd?.taxCurrent?.assessedValue ?? null);
  const redfinEstimate: number | null = vd?.estimate ?? null;
  const subjectSqft: number | null = cadEv?.livingAreaSqft ?? (subject?.sqFt ?? null);
  const subjectPerSqft: number | null =
    proposedAssessed != null && subjectSqft != null && subjectSqft > 0
      ? proposedAssessed / subjectSqft
      : null;

  // YoY history: prefer live DCAD data, fall back to Redfin
  let taxHistory: Array<{ year: number; assessedValue: number | null; marketValue?: number | null }> = [];
  if (property.cadAccountId) {
    const cadProv = property.cadProvider ?? inferCadProvider(property.state);
    const cadAdapt = cadProv ? getCadAdapter(cadProv) : null;
    if (cadAdapt) {
      try {
        const hist = await cadAdapt.getValueHistory(property.cadAccountId);
        if (hist.length > 0) taxHistory = [...hist].sort((a, b) => b.year - a.year).slice(0, 5);
      } catch (_err) {}
    }
  }
  if (taxHistory.length === 0) {
    taxHistory = [...(vd?.taxHistory ?? [])].sort((a, b) => b.year - a.year).slice(0, 5);
  }

  // Equity comps $/sqft stats
  const compPerSqfts = cadComps
    .filter((c) => c.cadPerSqftAssessed != null && c.sqft != null && c.sqft > 0)
    .map((c) => c.cadPerSqftAssessed!);
  const compMedianPerSqft =
    compPerSqfts.length > 0
      ? compPerSqfts.sort((a, b) => a - b)[Math.floor(compPerSqfts.length / 2)]
      : null;
  const impliedValue =
    compMedianPerSqft != null && subjectSqft != null
      ? Math.round(compMedianPerSqft * subjectSqft)
      : null;

  // Sold comps from unified protest_comp table
  const soldCompsFromDb = allComps.filter(c => c.source === 'redfin' || c.source === 'manual').filter(c => !c.excluded);

  // Prior year cycle summary
  const priorWorksheet = await getWorksheet(property.id, householdId, year - 1);

  const lines: string[] = [];
  const h = (s: string) => { lines.push(""); lines.push(s); lines.push("=".repeat(s.length)); };
  const sub = (s: string) => { lines.push(""); lines.push(s); lines.push("-".repeat(s.length)); };

  lines.push(`TAX PROTEST BRIEF — ${property.addressLine1?.toUpperCase()}, ${property.city ?? ""} ${property.state ?? ""}`);
  lines.push(`Tax Year ${year}  |  Generated ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push("Every number in this brief is pulled directly from official records or uploaded documents.");
  lines.push("Validate each figure independently. Challenge the analysis where evidence is thin.");

  h("1. SUBJECT PROPERTY");
  lines.push(`Address      : ${property.addressLine1}, ${property.city ?? ""}, ${property.state ?? ""}`);
  lines.push(`CAD Provider : ${property.cadProvider?.toUpperCase() ?? "—"}`);
  lines.push(`CAD Account  : ${property.cadAccountId ?? "—"}`);
  lines.push(`CAD Prop ID  : ${property.cadPropertyId ?? "—"}`);
  lines.push(`Year Built   : ${cadEv?.yearBuilt ?? subject?.yearBuilt ?? "—"}`);
  lines.push(`Living Area  : ${subjectSqft != null ? subjectSqft.toLocaleString() + " sqft" : "—"}`);
  lines.push(`Lot Area     : ${cadEv?.lotSqft != null ? cadEv.lotSqft.toLocaleString() + " sqft" : subject?.lotSqFt != null ? subject.lotSqFt.toLocaleString() + " sqft" : "—"}`);
  lines.push(`Beds / Baths : ${subject?.beds ?? "—"} bd / ${subject?.baths ?? "—"} ba`);
  lines.push(`Property Type: ${subject?.propertyType ?? "Single Family Residential"}`);

  h("2. PROPOSED ASSESSMENT — TAX YEAR " + year);
  if (cadEv) {
    lines.push(`Source: CAD Evidence PDF (${worksheet?.cadEvidenceFilename ?? "uploaded"})`);
    lines.push(`  Proposed Assessed Value : ${fmt(cadEv.assessedValueUsd)}`);
    lines.push(`  Land Value              : ${fmt(cadEv.landValueUsd)}`);
    lines.push(`  Improvements            : ${fmt(cadEv.improvementsUsd)}`);
    lines.push(`  Percent Good            : ${cadEv.percentGood != null ? cadEv.percentGood + "%" : "—"}`);
    lines.push(`  Living Area (PDF)       : ${cadEv.livingAreaSqft != null ? cadEv.livingAreaSqft.toLocaleString() + " sqft" : "—"}`);
  } else if (property.cadAssessedValueUsd != null) {
    lines.push(`Source: DCAD records (stored from CAD lookup — no evidence PDF uploaded)`);
    lines.push(`  CAD Assessed Value      : ${fmt(property.cadAssessedValueUsd)}`);
    if (property.cadLandValueUsd != null) lines.push(`  CAD Land Value          : ${fmt(property.cadLandValueUsd)}`);
    if (property.cadImprovementValueUsd != null) lines.push(`  CAD Improvement Value   : ${fmt(property.cadImprovementValueUsd)}`);
  } else {
    lines.push(`Source: Redfin / Realty API (no CAD data on file)`);
    lines.push(`  Assessed Value (Redfin) : ${fmt(vd?.taxCurrent?.assessedValue)}`);
    lines.push(`  Tax Year (Redfin)       : ${vd?.taxCurrent?.year ?? "—"}`);
  }
  lines.push(`Redfin AVM Estimate     : ${fmt(redfinEstimate)}`);
  lines.push(`Assessed / Market Ratio : ${fmtPct(proposedAssessed, redfinEstimate)}`);
  if (subjectPerSqft != null) lines.push(`Subject $/sqft          : $${subjectPerSqft.toFixed(2)}/sqft`);

  if (property.cadMarketValueUsd != null || property.cadAppraisedValueUsd != null || property.cadNetAppraisedValueUsd != null || property.cadTaxLimitationValueUsd != null || property.cadLandValueUsd != null || property.cadImprovementValueUsd != null) {
    sub("CAD Valuation Breakdown (DCAD records)");
    if (property.cadMarketValueUsd != null) lines.push(`  CAD Market Value        : ${fmt(property.cadMarketValueUsd)}`);
    if (property.cadAppraisedValueUsd != null) lines.push(`  CAD Appraised Value     : ${fmt(property.cadAppraisedValueUsd)}`);
    if (property.cadNetAppraisedValueUsd != null) lines.push(`  CAD Net Appraised       : ${fmt(property.cadNetAppraisedValueUsd)}`);
    if (property.cadLandValueUsd != null) lines.push(`  CAD Land Value          : ${fmt(property.cadLandValueUsd)}`);
    if (property.cadImprovementValueUsd != null) lines.push(`  CAD Improvement Value   : ${fmt(property.cadImprovementValueUsd)}`);
    if (property.cadTaxLimitationValueUsd != null) lines.push(`  CAD Tax Limitation      : ${fmt(property.cadTaxLimitationValueUsd)}`);
    if (property.cadMarketValueUsd != null && proposedAssessed != null) {
      const overage = proposedAssessed - property.cadMarketValueUsd;
      if (overage > 0) lines.push(`  Assessed exceeds CAD Market Value by ${fmt(overage)} — potential §41.41 signal`);
    }
  }

  if (taxHistory.length > 0) {
    sub("Year-Over-Year Assessed Value History");
    lines.push("Year  | Assessed       | Change");
    lines.push("------+----------------+-------");
    taxHistory.forEach((t, i) => {
      const prev = taxHistory[i + 1];
      const chg =
        prev?.assessedValue != null && t.assessedValue != null
          ? (((t.assessedValue - prev.assessedValue) / prev.assessedValue) * 100).toFixed(1) + "%"
          : "—";
      lines.push(`${t.year}  | ${pad(fmt(t.assessedValue), 14)} | ${chg}`);
    });
  }

  h("3. PROTEST STATUS");
  lines.push(`Status          : ${worksheet?.status ?? "not_filed"}`);
  lines.push(`ARB Hearing     : ${worksheet?.hearingDate ?? "—"}`);
  lines.push(`Filing Deadline : ${worksheet?.filingDeadline ?? "—"}`);
  lines.push(`Informal Offer  : ${fmt(worksheet?.informalOfferUsd)}`);
  if (worksheet?.cadPortalUrl) lines.push(`CAD Portal      : ${worksheet.cadPortalUrl}`);
  if (worksheet?.outcome) lines.push(`Outcome         : ${worksheet.outcome}`);

  h("4. EQUITY COMPS — UNEQUAL APPRAISAL (Texas Tax Code §41.43)");
  lines.push(`Subject is assessed at ${subjectPerSqft != null ? "$" + subjectPerSqft.toFixed(2) + "/sqft" : "an unknown $/sqft"} based on ${fmt(proposedAssessed)} / ${subjectSqft != null ? subjectSqft.toLocaleString() + " sqft" : "unknown sqft"}.`);
  lines.push(`Comps below are similar properties assessed by the same CAD in the same tax year.`);
  if (cadComps.length === 0) {
    lines.push("No equity comps loaded. Run 'Refresh Comps' to populate.");
  } else {
    lines.push("");
    lines.push("#  | Address                    | Sqft   | Bd/Ba  | Yr Blt | Assessed       | Land Value | Impr. Value | $/sqft  | Notes");
    lines.push("---+----------------------------+--------+--------+--------+----------------+------------+-------------+---------+------");
    cadComps.forEach((c, i) => {
      const ps = c.cadPerSqftAssessed != null ? "$" + c.cadPerSqftAssessed.toFixed(2) : "—";
      lines.push(
        `${String(i + 1).padStart(2)} | ${pad(c.addressLine1, 26)} | ${pad(c.sqft?.toLocaleString(), 6)} | ${pad((c.beds ?? "—") + "/" + (c.baths ?? "—"), 6)} | ${pad(String(c.yearBuilt ?? "—"), 6)} | ${pad(fmt(c.cadAssessedValueUsd), 14)} | ${pad(fmt(c.cadLandValueUsd), 10)} | ${pad(fmt(c.cadImprovementValueUsd), 11)} | ${pad(ps, 7)} | ${c.notes ?? ""}`
      );
    });
    if (compMedianPerSqft != null) {
      const compMeanPerSqft = compPerSqfts.length > 0
        ? compPerSqfts.reduce((s, v) => s + v, 0) / compPerSqfts.length
        : null;
      const impliedMean = compMeanPerSqft != null && subjectSqft != null
        ? Math.round(compMeanPerSqft * subjectSqft)
        : null;
      const impliedAvm = redfinEstimate != null ? redfinEstimate : null;
      lines.push("");
      lines.push(`Comp $/sqft range  : $${Math.min(...compPerSqfts).toFixed(2)} – $${Math.max(...compPerSqfts).toFixed(2)}`);
      lines.push(`Comp $/sqft median : $${compMedianPerSqft.toFixed(2)}`);
      if (compMeanPerSqft != null) lines.push(`Comp $/sqft mean   : $${compMeanPerSqft.toFixed(2)}`);
      lines.push(`Subject $/sqft     : ${subjectPerSqft != null ? "$" + subjectPerSqft.toFixed(2) : "—"}`);
      if (subjectPerSqft != null && compMedianPerSqft != null) {
        const gap = subjectPerSqft - compMedianPerSqft;
        lines.push(`Equity gap         : ${gap > 0 ? "+" : ""}$${gap.toFixed(2)}/sqft — subject assessed ${gap > 0 ? "ABOVE" : "below"} comp median`);
      }
      lines.push("");
      lines.push("Reduction scenarios (§41.43):");
      if (impliedValue != null) lines.push(`  → Comp median $/sqft : ${fmt(proposedAssessed)} → ${fmt(impliedValue)}${proposedAssessed != null && impliedValue != null ? " (reduction: " + fmt(proposedAssessed - impliedValue) + ")" : ""}`);
      if (impliedMean != null) lines.push(`  → Comp mean $/sqft   : ${fmt(proposedAssessed)} → ${fmt(impliedMean)}${proposedAssessed != null ? " (reduction: " + fmt(proposedAssessed - impliedMean) + ")" : ""}`);
      if (impliedAvm != null && proposedAssessed != null && impliedAvm < proposedAssessed) {
        lines.push(`  → Redfin AVM (§41.41): ${fmt(proposedAssessed)} → ${fmt(impliedAvm)} (reduction: ${fmt(proposedAssessed - impliedAvm)})`);
      }
    }
  }

  h("5. RECENT MARKET SALES — MARKET VALUE EVIDENCE (§41.41)");
  if (soldCompsFromDb.length === 0 && (!cadEv || cadEv.salesAnalysis.comps.length === 0)) {
    lines.push("No sold comps loaded. Run 'Refresh Comps' or add manually.");
  } else {
    if (soldCompsFromDb.length > 0) {
      sub("Redfin / Manual Sold Comps");
      lines.push("#  | Address                    | Sold       | Sale Price     | Sqft   | $/sqft  | DCAD Assessed  | Notes");
      lines.push("---+----------------------------+------------+----------------+--------+---------+----------------+------");
      const soldPsArr: number[] = [];
      soldCompsFromDb.forEach((c, i) => {
        const ps = c.soldPriceUsd != null && c.sqft != null && c.sqft > 0
          ? (c.soldPriceUsd / c.sqft)
          : null;
        if (ps != null) soldPsArr.push(ps);
        lines.push(
          `${String(i + 1).padStart(2)} | ${pad(c.addressLine1, 26)} | ${pad(c.soldDate ?? "—", 10)} | ${pad(fmt(c.soldPriceUsd), 14)} | ${pad(c.sqft?.toLocaleString(), 6)} | ${pad(ps != null ? "$" + ps.toFixed(2) : "—", 7)} | ${pad(fmt(c.cadAssessedValueUsd), 14)} | ${c.notes ?? ""}`
        );
      });
      if (soldPsArr.length > 0) {
        const sortedPs = [...soldPsArr].sort((a, b) => a - b);
        const medianPs = sortedPs[Math.floor(sortedPs.length / 2)];
        const meanPs = soldPsArr.reduce((s, v) => s + v, 0) / soldPsArr.length;
        lines.push("");
        lines.push(`Sale $/sqft median : $${medianPs.toFixed(2)} | mean: $${meanPs.toFixed(2)} | range: $${sortedPs[0].toFixed(2)}–$${sortedPs[sortedPs.length - 1].toFixed(2)}`);
        if (subjectSqft != null) {
          lines.push(`Implied market value at median $/sqft: ${fmt(Math.round(medianPs * subjectSqft))}`);
        }
      }
    }

    if (cadEv && cadEv.salesAnalysis.comps.length > 0) {
      sub("CAD Evidence PDF — Sales Analysis Comps (§41.41)");
      lines.push(`CAD Sales Analysis median (§41.41): ${fmt(cadEv.salesAnalysis.medianIndValueUsd)}`);
      lines.push("#  | Address                    | Dist  | Sold       | Sale Price     | DCAD Market    | Ind Value");
      lines.push("---+----------------------------+-------+------------+----------------+----------------+---------");
      cadEv.salesAnalysis.comps.forEach((c, i) => {
        const dist = c.distanceMi != null ? `${c.distanceMi.toFixed(2)} mi` : "—";
        lines.push(
          `${String(i + 1).padStart(2)} | ${pad(c.address, 26)} | ${pad(dist, 5)} | ${pad(c.saleDate ?? "—", 10)} | ${pad(fmt(c.salePriceUsd), 14)} | ${pad(fmt(c.cadMarketValueUsd), 14)} | ${fmt(c.cadIndValueUsd)}`
        );
      });
    }
  }

  const strategyNotes = worksheet?.strategyJson;
  if (strategyNotes) {
    h("6. STRATEGY NOTES");
    lines.push(typeof strategyNotes === "string" ? strategyNotes : JSON.stringify(strategyNotes, null, 2));
  }

  if (priorWorksheet?.cycleSummary) {
    h(`7. PRIOR YEAR (${year - 1}) OUTCOME SUMMARY`);
    lines.push(priorWorksheet.cycleSummary);
  }

  h("INSTRUCTIONS FOR AI ASSISTANT");
  lines.push("You are a property tax protest expert with deep knowledge of the Texas Property Tax Code (Chapter 41).");
  lines.push(`Subject property: ${property.addressLine1}, ${property.city ?? ""} ${property.state ?? ""}`);
  lines.push(`Tax year: ${year} | Proposed assessed value: ${fmt(proposedAssessed)} | ARB hearing: ${worksheet?.hearingDate ?? "TBD"}`);
  lines.push(`Filing deadline: ${worksheet?.filingDeadline ?? "—"} | Protest status: ${worksheet?.status ?? "not_filed"}`);
  if (worksheet?.informalOfferUsd != null) lines.push(`Informal settlement offer: ${fmt(worksheet.informalOfferUsd)}`);
  lines.push("");
  lines.push("DATA SOURCES IN THIS BRIEF:");
  lines.push("- Section 2: Assessed value from CAD evidence PDF (most authoritative), DCAD stored records, or Redfin (may lag 1 year).");
  lines.push("- Section 2 CAD Breakdown: DCAD's own market/appraised/net/land/improvement values — use for §41.41 and §41.43 arguments.");
  lines.push("- Section 2 YoY History: Year-over-year assessed value from DCAD (or Redfin as fallback) — useful for escalating-assessment arguments.");
  lines.push("- Section 4: Equity comps — ALL active protest comps with CAD-assessed values. These are the foundation of §41.43 (unequal appraisal). Each comp shows land value and improvement value separately — use to identify if DCAD is over-valuing improvements on the subject.");
  lines.push("- Section 5 (Redfin/Manual): The same comps as Section 4, filtered to those with a sale price. Use sale prices for §41.41 (market value exceeds assessed).");
  if (cadEv && cadEv.salesAnalysis.comps.length > 0) lines.push("- Section 5 (CAD PDF): DCAD's own sales analysis comps — strongest §41.41 evidence because it's DCAD's own data.");
  if (worksheet?.strategyJson) lines.push("- Section 6: Previously saved strategy notes — case strength rating, target value, and draft arguments from prior AI analysis sessions.");
  lines.push("");
  lines.push("REQUIRED ANALYSIS:");
  lines.push("1. EVIDENCE SUMMARY");
  lines.push("   - State how many equity comps are loaded and their $/sqft range vs. subject.");
  lines.push("   - State how many sold comps are loaded and the median sale price vs. proposed assessed value.");
  lines.push("   - Flag any data gaps: missing comps, no CAD evidence PDF, stale Redfin data.");
  lines.push("");
  lines.push("2. GROUND-BY-GROUND ANALYSIS");
  lines.push("   §41.43 (Unequal Appraisal):");
  lines.push("   - Calculate the $/sqft equity gap (subject minus comp median). State whether it's significant (>5% is meaningful; >10% is strong).");
  lines.push("   - Calculate implied value if subject were assessed at comp median $/sqft.");
  lines.push("   - Compare subject land value and improvement value (Section 2 CAD Breakdown) to comp land/improvement values in Section 4. Flag if subject's improvement value is disproportionately high vs comps — this is a separate §41.43 argument.");
  lines.push("   - Rate evidence strength: Strong / Moderate / Weak / Inconclusive, with reasoning.");
  lines.push("   §41.41 (Market Value):");
  lines.push("   - Compare proposed assessed value to recent sale prices of comparable properties.");
  lines.push("   - If CAD evidence PDF is available, use DCAD's own sales analysis median as the anchor.");
  lines.push("   - Calculate implied market value from sold comp median $/sqft.");
  lines.push("   - Rate evidence strength: Strong / Moderate / Weak / Inconclusive, with reasoning.");
  lines.push("");
  lines.push("3. TARGET VALUE RECOMMENDATION");
  lines.push("   - Recommend a specific target assessed value supported by the data.");
  lines.push("   - Choose the stronger ground (§41.41 or §41.43) as the primary argument.");
  lines.push("   - If both grounds support different values, recommend the lower one.");
  lines.push("   - If the prior year outcome is available (Section 7), factor it in.");
  lines.push("   - If Section 6 has a previously saved strategy, evaluate whether it is still supported by the data.");
  lines.push("   - Use the YoY history (Section 2) to quantify the cumulative assessment increase — helpful for framing the argument.");
  lines.push("");
  lines.push("4. ARB HEARING TALKING POINTS (if hearing date is set)");
  lines.push("   - Draft 5–7 talking points ordered by expected impact.");
  lines.push("   - Lead with §41.43 if equity gap is significant — DCAD's own comps are hard to rebut.");
  lines.push("   - Identify the 3–4 strongest individual comps to present as exhibits.");
  lines.push("   - Anticipate the appraiser's pushback (condition adjustments, lot size, age) and prepare rebuttals.");
  lines.push("");
  lines.push("5. RED FLAGS AND WEAKNESSES");
  lines.push("   - Identify comps the appraiser could exclude or discount (condition outliers, different property type, stale sales).");
  lines.push("   - Flag any inconsistencies in the data (e.g., Redfin sqft differs from CAD evidence sqft).");
  lines.push("   - Note if the case would be stronger with additional evidence.");
  lines.push("");
  lines.push("RULES:");
  lines.push("- Ground EVERY recommendation in the numbers in this brief. Do not invent comparables or market data.");
  lines.push("- If a number is missing or ambiguous, say so explicitly — do not fill gaps with assumptions.");
  lines.push("- Challenge your own analysis. If the evidence is weak for a particular argument, say so.");
  lines.push("- Use DCAD's own data against them whenever possible — it's the most credible source at ARB.");
  lines.push("- Land value vs improvement value breakdown is a powerful §41.43 sub-argument: if DCAD over-valued improvements on subject relative to comps, that is independently protestable.");
  lines.push("- This brief is LLM-agnostic and works with Claude, ChatGPT, Gemini, or any other assistant.");

  const text = lines.join("\n");
  const safeAddr = (property.addressLine1 ?? "property").replace(/[^a-z0-9]/gi, "_");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeAddr}_protest_brief_${year}.txt"`);
  res.send(text);
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

// PATCH /:propertyId/comps/:compId/notes — save annotation on a comp
protestRouter.patch("/:propertyId/comps/:compId/notes", async (req: AuthenticatedRequest, res) => {
  const params = z.object({ propertyId: z.string().uuid(), compId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ errors: params.error.issues }); return; }
  const parsed = z.object({ notes: z.string() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ errors: parsed.error.issues }); return; }
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) { res.status(404).json({ message: "Property not found" }); return; }
  const success = await updateCompNote(property.id, householdId, params.data.compId, parsed.data.notes);
  if (!success) {
    res.status(404).json({ message: "Comp not found" });
    return;
  }
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
    sqft: asNumber(subject?.sqFt) ?? worksheet.cadEvidenceJson?.livingAreaSqft ?? null,
    beds: asNumber(subject?.beds),
    baths: asNumber(subject?.baths),
    yearBuilt: asNumber(subject?.yearBuilt) ?? worksheet.cadEvidenceJson?.yearBuilt ?? null,
    purchasePrice: property.purchasePrice,
    purchaseDate: property.purchaseDate,
    hearingDate: worksheet.hearingDate,
    taxYear: year,
    cadEvidence: worksheet.cadEvidenceJson,
    equityComps,
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
