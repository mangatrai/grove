import OpenAI from "openai";
import { Router } from "express";
import { z } from "zod";

import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import type { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../rbac/rbac.middleware.js";
import { getProperty, refreshPropertyValuation } from "../household/property.service.js";
import { searchDCADByAddress } from "./dcad.service.js";
import {
  appendConversationTurn,
  getOrCreateWorksheet,
  listWorksheetComps,
  updateStrategy,
  updateWorksheetStatus,
  type ConversationTurn,
  type ProtestStatus,
  type StrategyJson,
  saveCADComps
} from "./protest-worksheet.service.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const worksheetStatusSchema = z.enum(["not_filed", "filed", "informal", "arb", "resolved"]);
const propertyIdSchema = z.object({ propertyId: z.string().uuid() });
const worksheetQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const chatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  attachmentText: z.string().max(50_000).optional(),
  attachmentType: z.enum(["pdf", "url", "text"]).optional(),
  year: z.number().int().min(2000).max(2100).optional()
});
const patchWorksheetBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  status: worksheetStatusSchema.optional(),
  hearingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
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

function buildSystemPrompt(input: {
  address: string;
  city: string | null;
  state: string | null;
  cadAssessed: number | null;
  avm: number | null;
  overPct: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  status: ProtestStatus;
  year: number;
}): string {
  return `You are a property tax protest assistant for ${input.address}, ${input.city ?? ""} ${input.state ?? ""}.

Property facts:
- Assessed value (CAD): ${money(input.cadAssessed)}
- AVM (Redfin): ${money(input.avm)}
- Overassessment: ${input.overPct == null ? "—" : `${input.overPct.toFixed(1)}%`}
- Sqft: ${input.sqft ?? "—"} | Beds: ${input.beds ?? "—"} | Baths: ${input.baths ?? "—"} | Year built: ${input.yearBuilt ?? "—"}
- Purchase price: ${money(input.purchasePrice)} (${input.purchaseDate ?? "—"})

Current protest status: ${input.status}
Tax year: ${input.year}

You have access to tools to fetch CAD comparable properties and update the protest worksheet. Use them when the user asks about specific properties or requests analysis. When generating legal arguments, cite applicable Texas Tax Code sections (§41.41 for market value, §41.43 for unequal appraisal). Be concise and strategic.`;
}

function formatCompSummary(comps: Awaited<ReturnType<typeof searchDCADByAddress>>): string {
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
  const worksheet = await getOrCreateWorksheet(property.id, householdId, year);
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
  const householdId = req.authUser!.householdId;
  const property = await getProperty(params.data.propertyId, householdId);
  if (!property) {
    res.status(404).json({ message: "Property not found" });
    return;
  }
  const detail = asRecord(property.valuationDetail);
  const rawComps = Array.isArray(detail?.comps) ? (detail.comps as unknown[]) : [];
  const comps = rawComps.map((c) => {
    const r = asRecord(c) ?? {};
    const soldPrice = asNumber(r.soldPrice);
    const sqft = asNumber(r.sqft);
    return {
      address: typeof r.address === "string" ? r.address : null,
      city: typeof r.city === "string" ? r.city : null,
      state: typeof r.state === "string" ? r.state : null,
      sqft,
      beds: asNumber(r.beds),
      baths: asNumber(r.baths),
      yearBuilt: asNumber(r.yearBuilt),
      soldPrice,
      soldDate: typeof r.soldDate === "string" ? r.soldDate : null,
      pricePerSqft:
        soldPrice != null && sqft != null && sqft > 0
          ? Math.round(soldPrice / sqft)
          : asNumber(r.pricePerSqft),
      listPrice: asNumber(r.listPrice)
    };
  });
  res.status(200).json({ comps });
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
  if (!env.OPENAI_API_KEY) {
    res.status(503).json({ message: "OPENAI_API_KEY not configured", code: "OPENAI_NOT_CONFIGURED" });
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
  const avm = (typeof detail?.estimate === "number" ? detail.estimate : null) ?? property.latestValueUsd;
  const overPct = cadAssessed != null && avm != null && avm > 0 ? ((cadAssessed / avm) - 1) * 100 : null;
  const address = [property.addressLine1, property.city, property.state].filter(Boolean).join(", ") || "Unknown property";
  const systemPrompt = buildSystemPrompt({
    address,
    city: property.city,
    state: property.state,
    cadAssessed,
    avm,
    overPct,
    sqft: asNumber(subject?.sqFt),
    beds: asNumber(subject?.beds),
    baths: asNumber(subject?.baths),
    yearBuilt: asNumber(subject?.yearBuilt),
    purchasePrice: property.purchasePrice,
    purchaseDate: property.purchaseDate,
    status: worksheet.status,
    year
  });

  const userText = parsedBody.data.attachmentText
    ? `${parsedBody.data.message}\n\nAttachment (${parsedBody.data.attachmentType ?? "text"}):\n${parsedBody.data.attachmentText}`
    : parsedBody.data.message;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...worksheet.conversationJson.map((turn): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
      if (turn.role === "tool") {
        return { role: "assistant", content: turn.content };
      }
      return { role: turn.role, content: turn.content };
    }),
    { role: "user", content: userText }
  ];

  let strategyUpdated = false;
  let compsAdded = 0;
  let soldCompsRefreshed = false;
  let assistantMessage = "";

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const completion = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      tools: [
        {
          type: "function",
          function: {
            name: "fetch_dcad_comps",
            description: "Search DCAD for comparable properties by address",
            parameters: {
              type: "object",
              properties: { address: { type: "string" } },
              required: ["address"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "refresh_redfin_comps",
            description: "Re-fetch Redfin data for the subject property to get the latest AVM estimate and comparable sold prices.",
            parameters: { type: "object", properties: {} }
          }
        },
        {
          type: "function",
          function: {
            name: "search_web",
            description: "Search the web for comparable property sales, market trends, or appraisal data. Use targeted queries like '123 Main St Dallas TX sold price 2024' or 'Dallas TX property tax protest ARB results 2025'.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query" }
              },
              required: ["query"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "update_strategy",
            description: "Save the current protest strategy summary",
            parameters: {
              type: "object",
              properties: {
                caseStrength: { type: "number" },
                targetValueUsd: { type: "number" },
                primaryStrategy: { type: "string" },
                draftArguments: { type: "array", items: { type: "string" } },
                redFlags: { type: "array", items: { type: "string" } }
              },
              required: ["caseStrength", "targetValueUsd", "primaryStrategy", "draftArguments", "redFlags"]
            }
          }
        }
      ],
      tool_choice: "auto",
      max_tokens: 2000
    });

    const choice = completion.choices[0];
    const responseMessage = choice?.message;
    if (!responseMessage) {
      break;
    }

    const toolCalls = responseMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      assistantMessage = responseMessage.content ?? "";
      break;
    }

    messages.push({
      role: "assistant",
      content: responseMessage.content ?? "",
      tool_calls: toolCalls
    });

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      let toolResult = "Unsupported tool call";
      if (call.function.name === "refresh_redfin_comps") {
        const result = await refreshPropertyValuation(property.id, householdId);
        if (result.ok) {
          soldCompsRefreshed = true;
          toolResult = `Redfin data refreshed. Updated AVM: ${money(result.estimate)}. The sold comps list has been updated.`;
        } else {
          toolResult = `Redfin refresh failed: ${result.message}`;
        }
      } else if (call.function.name === "search_web") {
        if (!env.TAVILY_API_KEY) {
          toolResult = "Web search is not configured (TAVILY_API_KEY missing).";
        } else {
          const args = (() => {
            try { return JSON.parse(call.function.arguments) as { query?: unknown }; } catch { return {}; }
          })();
          const query = typeof args.query === "string" ? args.query.trim() : "";
          if (!query) {
            toolResult = "No query provided.";
          } else {
            try {
              const tavilyRes = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  api_key: env.TAVILY_API_KEY,
                  query,
                  search_depth: "basic",
                  max_results: 5
                }),
                signal: AbortSignal.timeout(10_000)
              });
              if (!tavilyRes.ok) {
                toolResult = `Tavily returned HTTP ${tavilyRes.status}.`;
              } else {
                const data = await tavilyRes.json() as { results?: Array<{ title: string; url: string; content: string }> };
                const results = data.results ?? [];
                toolResult = results.length === 0
                  ? "No results found."
                  : results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join("\n\n");
              }
            } catch (err) {
              toolResult = `Web search failed: ${err instanceof Error ? err.message : "unknown error"}.`;
            }
          }
        }
      } else if (call.function.name === "fetch_dcad_comps") {
        const args = (() => {
          try {
            return JSON.parse(call.function.arguments) as { address?: unknown };
          } catch {
            return {};
          }
        })();
        const queryAddress = typeof args.address === "string" && args.address.trim().length > 0
          ? args.address.trim()
          : address;
        const comps = await searchDCADByAddress(queryAddress, year);
        compsAdded = await saveCADComps(property.id, householdId, year, comps);
        toolResult = formatCompSummary(comps);
      } else if (call.function.name === "update_strategy") {
        const parsed = (() => {
          try {
            return JSON.parse(call.function.arguments) as StrategyJson;
          } catch {
            return null;
          }
        })();
        if (parsed) {
          await updateStrategy(worksheet.id, parsed);
          strategyUpdated = true;
          toolResult = "Strategy saved.";
        } else {
          toolResult = "Invalid strategy payload.";
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult
      });
    }
  }

  if (!assistantMessage) {
    assistantMessage = "I could not generate a response right now. Please try again.";
  }

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

  res.status(200).json({
    assistantMessage,
    strategyUpdated,
    compsAdded,
    soldCompsRefreshed
  });
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
    parsed.data.hearingDate
  );
  const updated = await getOrCreateWorksheet(property.id, householdId, parsed.data.year);
  log.info("protest worksheet updated", {
    worksheetId: worksheet.id,
    propertyId: property.id,
    status: parsed.data.status ?? worksheet.status
  });
  res.status(200).json({ worksheet: updated });
});
