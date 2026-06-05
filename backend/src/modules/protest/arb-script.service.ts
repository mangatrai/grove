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

  const subjectPpsf = input.cadAssessed != null && input.sqft != null && input.sqft > 0
    ? Math.round(input.cadAssessed / input.sqft)
    : null;
  lines.push(`Sqft: ${input.sqft ?? "—"} | Beds: ${input.beds ?? "—"} | Baths: ${input.baths ?? "—"} | Year built: ${input.yearBuilt ?? "—"} | Assessed $/sqft: ${subjectPpsf != null ? `$${subjectPpsf}` : "—"}`);

  if (input.purchasePrice != null) {
    lines.push(`Purchase price: ${money(input.purchasePrice)} (${input.purchaseDate ?? "—"})`);
    if (input.cadAssessed != null) {
      const delta = input.cadAssessed - input.purchasePrice;
      lines.push(`  → Assessment vs purchase price: ${delta > 0 ? "+" : ""}${money(delta)} (${delta > 0 ? "assessed ABOVE purchase price" : "assessed below purchase price"})`);
    }
  }
  if (input.hearingDate) lines.push(`ARB hearing date: ${input.hearingDate}`);

  if (input.strategyTargetValueUsd != null) {
    lines.push(`\nProtestor target value: ${money(input.strategyTargetValueUsd)}`);
    if (input.cadAssessed != null) {
      lines.push(`  → Requested reduction: ${money(input.cadAssessed - input.strategyTargetValueUsd)}`);
    }
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
    lines.push(`Subject: assessed ${money(ev.assessedValueUsd)} | improvements ${money(ev.improvementsUsd)} | land ${money(ev.landValueUsd)}${ev.percentGood != null ? ` | condition ${ev.percentGood}% good` : ""}${ev.livingAreaSqft != null ? ` | living area ${ev.livingAreaSqft} sqft` : ""}`);

    if (ev.salesAnalysis.comps.length > 0) {
      lines.push(`\n### §41.41 DCAD Sales Analysis (median indicated: ${money(ev.salesAnalysis.medianIndValueUsd)})`);
      lines.push(`Subject assessed ${money(ev.assessedValueUsd)} vs DCAD sales median ${money(ev.salesAnalysis.medianIndValueUsd)}${ev.salesAnalysis.medianIndValueUsd != null && ev.assessedValueUsd != null ? ` → gap: ${money(ev.assessedValueUsd - ev.salesAnalysis.medianIndValueUsd)} over median` : ""}`);
      for (const c of ev.salesAnalysis.comps) {
        const saleAge = c.saleDate ? (() => {
          const months = Math.floor((Date.now() - new Date(c.saleDate!).getTime()) / (1000 * 60 * 60 * 24 * 30));
          return `${months} months ago`;
        })() : "—";
        lines.push(`  Comp ${c.compNum}: ${c.address} — sale: ${money(c.salePriceUsd)} (${c.saleDate ?? "—"}, ${saleAge}), DCAD ind: ${money(c.cadIndValueUsd)}, dist: ${c.distanceMi != null ? `${c.distanceMi} mi` : "—"}${c.cadIndValueUsd != null && c.salePriceUsd != null ? `, DCAD adjustment: ${money(c.cadIndValueUsd - c.salePriceUsd)} (${c.cadIndValueUsd > c.salePriceUsd ? "upward — unexplained" : "downward"})` : ""}`);
      }
    }

    if (ev.equityAnalysis.comps.length > 0) {
      const equityMedian = ev.equityAnalysis.medianIndValueUsd;
      const equityMedianPpsf = equityMedian != null && input.sqft != null && input.sqft > 0 ? Math.round(equityMedian / input.sqft) : null;
      lines.push(`\n### §41.43 DCAD Equity Analysis (median indicated: ${money(equityMedian)}, est. $/sqft: ${equityMedianPpsf != null ? `$${equityMedianPpsf}` : "—"})`);
      if (equityMedian != null && input.cadAssessed != null) {
        lines.push(`Subject assessed ${money(input.cadAssessed)} (${subjectPpsf != null ? `$${subjectPpsf}/sqft` : "—"}) vs DCAD equity median ${money(equityMedian)} (${equityMedianPpsf != null ? `$${equityMedianPpsf}/sqft` : "—"}) → OVERASSESSED by ${money(input.cadAssessed - equityMedian)}`);
      }
      for (const c of ev.equityAnalysis.comps) {
        const compPpsf = c.cadIndValueUsd != null && input.sqft != null && input.sqft > 0 ? Math.round(c.cadIndValueUsd / input.sqft) : null;
        lines.push(`  Comp ${c.compNum}: ${c.address} — DCAD ind: ${money(c.cadIndValueUsd)} (est. ${compPpsf != null ? `$${compPpsf}/sqft` : "—"}), dist: ${c.distanceMi != null ? `${c.distanceMi} mi` : "—"}${compPpsf != null && subjectPpsf != null ? `, SUBJECT IS $${subjectPpsf - compPpsf}/sqft ABOVE THIS COMP` : ""}`);
      }
    }
  }

  if (input.equityComps.length > 0) {
    lines.push("\n## Taxpayer-Identified Equity Comps (from DCAD records)");
    for (const c of input.equityComps) {
      const addr = [c.addressLine1, c.city].filter(Boolean).join(", ") || "Unknown";
      const notePart = c.notes ? ` | notes: ${c.notes}` : "";
      const gapPart = c.perSqftUsd != null && subjectPpsf != null ? ` | subject is $${subjectPpsf - Math.round(c.perSqftUsd)}/sqft above this comp` : "";
      lines.push(`  ${addr} — assessed: ${money(c.assessedValueUsd)}, $/sqft: ${money(c.perSqftUsd)}${gapPart}${notePart}`);
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

const SYSTEM_PROMPT = `You are a Texas property tax attorney writing a verbatim oral script for an ARB (Appraisal Review Board) hearing. This script will be read aloud. It must be specific, fact-grounded, and aggressive where the evidence supports it.

RULES:
- Cite exact dollar amounts and specific comp addresses. Never say "comparable properties show lower values" — name the property and give the number.
- §41.41 (market value): Use DCAD's own sales analysis median vs the assessed value. Identify the weakest DCAD sales comp by address and explain the specific flaw (pool not adjusted for, sale too old, unexplained upward adjustment, distance too far).
- §41.43 (unequal appraisal): Use DCAD's own equity median and $/sqft figures. Show the exact dollar and $/sqft gap between the subject and the median. Name the most comparable equity property and cite why it is assessed lower.
- Negotiation thresholds: openAskUsd = aggressive opening (5-8% below equity median or aligned with the strongest taxpayer comp); idealSettleUsd = at or just above equity median; walkAwayMinUsd = the minimum reduction that still demonstrates clear inequity.
- appraiserMayRespond: Give the SPECIFIC objection an appraiser would raise against THIS argument using THIS case's data (e.g., "Your purchase price in [year] supports the current assessment"). No generic objections.
- yourRebuttal: Counter with a SPECIFIC data point from the evidence (e.g., "The market has shifted — the 2026 sales data shows..."). No generic rebuttals.
- Panel Questions (step 6): Generate 2-3 questions that a panel WOULD ACTUALLY ASK based on this specific case's facts (e.g., recent purchase, pool comp adjustments, large reduction requested). Each question needs a data-backed answer.

Return JSON with EXACTLY this structure (no extra keys, no markdown fences):
{
  "targetValueUsd": <integer>,
  "negotiationThresholds": {
    "openAskUsd": <integer>,
    "idealSettleUsd": <integer>,
    "walkAwayMinUsd": <integer>,
    "rationale": "<2 sentences explaining the range with specific dollar amounts>"
  },
  "sections": [
    { "step": 1, "title": "Opening Statement", "speech": "<3-5 sentences: introduce self, state property address, give assessed value, state grounds with the specific gap — e.g. 'assessed at $275/sqft while DCAD's own comparable properties average $269/sqft'>", "appraiserMayRespond": null, "yourRebuttal": null },
    { "step": 2, "title": "§41.41 Market Value Argument", "speech": "<cite DCAD's sales median vs assessed, name the weakest DCAD comp with its specific flaw, explain how this inflates the indicated value>", "appraiserMayRespond": "<specific objection using actual case data>", "yourRebuttal": "<specific rebuttal citing a dollar amount or comp>"},
    { "step": 3, "title": "§41.43 Unequal Appraisal Argument", "speech": "<quote DCAD's equity median and $/sqft exactly, show the gap vs subject's $/sqft, name 1-2 specific equity comps that are assessed lower with exact $/sqft>", "appraiserMayRespond": "<specific objection>", "yourRebuttal": "<specific rebuttal>"},
    { "step": 4, "title": "Taxpayer Evidence", "speech": "<cite taxpayer-identified comps with addresses, values, and why each is more representative than DCAD's selections>", "appraiserMayRespond": "<specific objection>", "yourRebuttal": "<specific rebuttal>"},
    { "step": 5, "title": "Closing Ask", "speech": "<state the specific requested value and $/sqft; link it to either the equity median or the strongest taxpayer comp; ask the panel directly>", "appraiserMayRespond": null, "yourRebuttal": null },
    { "step": 6, "title": "Panel Questions", "speech": "Listen carefully. Answer directly. Lead with the number, follow with the evidence.", "appraiserMayRespond": "<anticipated panel question #1 specific to this case>", "yourRebuttal": "<data-backed answer to question #1>"},
    { "step": 7, "title": "Panel Question 2", "speech": null, "appraiserMayRespond": "<anticipated panel question #2>", "yourRebuttal": "<data-backed answer>"}
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
    { model: strongModel(), maxTokens: 4000 }
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
