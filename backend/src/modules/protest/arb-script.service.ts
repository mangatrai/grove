import { getChatAdapter, strongModel } from "../../llm/index.js";
import { log } from "../../logger.js";
import type { CadEvidenceData } from "./cad-evidence-parser.service.js";
import type { ProtestComp } from "./protest-worksheet.service.js";

export type ArbNegotiationThresholds = {
  openAskUsd: number;
  idealSettleUsd: number;
  walkAwayMinUsd: number;
  rationale: string;
};

export type ArbScriptSection = {
  step: number;
  title: string;
  speech: string;
  appraiserMayRespond: string | null;
  yourRebuttal: string | null;
};

export type ArbScript = {
  generatedAt: string;
  targetValueUsd: number;
  negotiationThresholds: ArbNegotiationThresholds;
  sections: ArbScriptSection[];
};

export type ArbScriptInput = {
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
  hearingDate: string | null;
  taxYear: number;
  cadEvidence: CadEvidenceData | null;
  equityComps: ProtestComp[];
  soldCompsNotes: Record<string, string>;
  strategyTargetValueUsd: number | null;
  strategyPrimaryStrategy: string | null;
  strategyArguments: string[];
};

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function buildDataBlock(input: ArbScriptInput): string {
  const lines: string[] = [];
  const loc = [input.city, input.state].filter(Boolean).join(" ");
  lines.push(`Property: ${input.address}${loc ? `, ${loc}` : ""}`);
  lines.push(`Tax year: ${input.taxYear}`);
  lines.push(`CAD assessed value: ${money(input.cadAssessed)}`);
  lines.push(`Sqft: ${input.sqft ?? "—"} | Beds: ${input.beds ?? "—"} | Baths: ${input.baths ?? "—"} | Year built: ${input.yearBuilt ?? "—"}`);
  if (input.purchasePrice != null) {
    lines.push(`Purchase price: ${money(input.purchasePrice)} (${input.purchaseDate ?? "—"})`);
  }
  if (input.hearingDate) lines.push(`ARB hearing date: ${input.hearingDate}`);

  if (input.strategyTargetValueUsd != null) {
    lines.push(`\nProtestor target value: ${money(input.strategyTargetValueUsd)}`);
  }
  if (input.strategyPrimaryStrategy) {
    lines.push(`Primary strategy: ${input.strategyPrimaryStrategy}`);
  }
  if (input.strategyArguments.length > 0) {
    lines.push(`Key arguments:\n${input.strategyArguments.map((a) => `  - ${a}`).join("\n")}`);
  }

  if (input.cadEvidence) {
    const ev = input.cadEvidence;
    lines.push("\n## CAD Evidence Packet (official DCAD data)");
    lines.push(`Subject: assessed ${money(ev.assessedValueUsd)} | improvements ${money(ev.improvementsUsd)} | land ${money(ev.landValueUsd)}${ev.percentGood != null ? ` | ${ev.percentGood}% good` : ""}`);

    if (ev.salesAnalysis.comps.length > 0) {
      lines.push(`\n### §41.41 CAD Sales Comps — median indicated: ${money(ev.salesAnalysis.medianIndValueUsd)}, median $/sqft: ${money(ev.salesAnalysis.medianValuePerSqft)}`);
      for (const c of ev.salesAnalysis.comps) {
        lines.push(`  Comp ${c.compNum}: ${c.address} — sale: ${money(c.salePriceUsd)} (${c.saleDate ?? "—"}), CAD ind: ${money(c.cadIndValueUsd)}, dist: ${c.distanceMi ?? "—"} mi`);
      }
    }

    if (ev.equityAnalysis.comps.length > 0) {
      lines.push(`\n### §41.43 CAD Equity Comps — median indicated: ${money(ev.equityAnalysis.medianIndValueUsd)}, median $/sqft: ${money(ev.equityAnalysis.medianValuePerSqft)}`);
      for (const c of ev.equityAnalysis.comps) {
        lines.push(`  Comp ${c.compNum}: ${c.address} — CAD market: ${money(c.cadMarketValueUsd)}, CAD ind: ${money(c.cadIndValueUsd)}, dist: ${c.distanceMi ?? "—"} mi`);
      }
    }
  }

  if (input.equityComps.length > 0) {
    lines.push("\n## Taxpayer CAD Equity Comps");
    for (const c of input.equityComps) {
      const addr = [c.addressLine1, c.city].filter(Boolean).join(", ") || "Unknown";
      const notePart = c.notes ? ` | notes: ${c.notes}` : "";
      lines.push(`  ${addr} — assessed: ${money(c.assessedValueUsd)}, market: ${money(c.marketValueUsd)}, sqft: ${c.sqft ?? "—"}, $/sqft: ${money(c.perSqftUsd)}${notePart}`);
    }
  }

  const noteEntries = Object.entries(input.soldCompsNotes).filter(([, v]) => v.trim());
  if (noteEntries.length > 0) {
    lines.push("\n## Redfin Sold Comp Research Notes");
    for (const [addr, note] of noteEntries) {
      lines.push(`  ${addr}: ${note}`);
    }
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a Texas property tax protest expert writing an oral ARB (Appraisal Review Board) presentation script.

Use all provided evidence to write a specific, fact-grounded script. Cite exact dollar amounts. Attack DCAD's own comps using the annotation notes when available.

Rules:
- §41.41: argue market value using DCAD's sales comps median vs assessed. Note any weak/distant DCAD comps.
- §41.43: argue unequal appraisal using DCAD's own equity median — NEVER Redfin AVM or Zillow.
- Negotiation: openAskUsd is ~5-10% below equity median, walkAwayMinUsd is where the assessment is still clearly inequitable.

Return JSON with EXACTLY this structure (no extra keys):
{
  "targetValueUsd": <integer>,
  "negotiationThresholds": {
    "openAskUsd": <integer>,
    "idealSettleUsd": <integer>,
    "walkAwayMinUsd": <integer>,
    "rationale": "<1-2 sentences>"
  },
  "sections": [
    { "step": 1, "title": "Opening Statement", "speech": "<2-4 sentences: introduce self, property, grounds>", "appraiserMayRespond": null, "yourRebuttal": null },
    { "step": 2, "title": "§41.41 Market Value Argument", "speech": "<specific numbers from DCAD sales comps>", "appraiserMayRespond": "<most likely appraiser objection>", "yourRebuttal": "<rebuttal with counter-points>" },
    { "step": 3, "title": "§41.43 Unequal Appraisal Argument", "speech": "<use DCAD equity median, show gap vs subject assessed>", "appraiserMayRespond": "<most likely objection>", "yourRebuttal": "<rebuttal>" },
    { "step": 4, "title": "Supporting Evidence", "speech": "<taxpayer comps and research notes>", "appraiserMayRespond": "<likely objection>", "yourRebuttal": "<rebuttal>" },
    { "step": 5, "title": "Closing Ask", "speech": "<explicit value ask to panel, 1-2 sentences>", "appraiserMayRespond": null, "yourRebuttal": null },
    { "step": 6, "title": "Panel Questions", "speech": "Listen carefully to panel questions and answer directly and calmly.", "appraiserMayRespond": "<most common panel question for this protest type>", "yourRebuttal": "<how to answer confidently>" }
  ]
}`;

export async function generateArbScript(input: ArbScriptInput): Promise<ArbScript> {
  const adapter = getChatAdapter();
  const dataBlock = buildDataBlock(input);

  const { content } = await adapter.complete(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Generate the ARB oral script for this protest:\n\n${dataBlock}` },
    ],
    { model: strongModel(), maxTokens: 2500 }
  );

  // GPT-4o sometimes wraps JSON in ```json … ``` fences despite the prompt — strip them.
  const raw = content.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim() || "{}";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    log.error("ARB script: invalid JSON from model", { preview: raw.slice(0, 300) });
    throw new Error(`ARB script generation returned invalid JSON — model response did not parse. Preview: ${raw.slice(0, 200)}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    targetValueUsd: typeof parsed.targetValueUsd === "number" ? parsed.targetValueUsd : 0,
    negotiationThresholds: (parsed.negotiationThresholds != null && typeof parsed.negotiationThresholds === "object" && !Array.isArray(parsed.negotiationThresholds))
      ? (parsed.negotiationThresholds as ArbNegotiationThresholds)
      : { openAskUsd: 0, idealSettleUsd: 0, walkAwayMinUsd: 0, rationale: "" },
    sections: Array.isArray(parsed.sections) ? (parsed.sections as ArbScriptSection[]) : [],
  };
}
