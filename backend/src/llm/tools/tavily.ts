import { env } from "../../config/env.js";
import type { Tool } from "../types.js";

type TavilyResult = { title: string; url: string; content: string; score?: number };

export interface TavilySearchOpts {
  startDate?: string;
}

// FIX #217: typed result instead of a plain string, so callers branch on `code` (e.g. "is Tavily
// even configured?") rather than brittle string-matching a human-readable message.
export type TavilySearchResult =
  | { ok: true; text: string }
  | { ok: false; code: "not_configured" | "empty_query" | "http_error" | "no_results" | "network_error"; message: string };

export async function tavilySearch(query: string, opts: TavilySearchOpts = {}): Promise<TavilySearchResult> {
  if (!env.TAVILY_API_KEY) return { ok: false, code: "not_configured", message: "Web search is not configured (TAVILY_API_KEY missing)." };
  if (!query.trim()) return { ok: false, code: "empty_query", message: "No query provided." };
  try {
    const body: Record<string, unknown> = {
      api_key: env.TAVILY_API_KEY,
      query: query.trim(),
      // FIX #210: advanced depth + more results + an LLM-synthesized answer line, so Domain 3/4
      // synthesis has enough material to meet its own "name + URL + price + registration steps"
      // bar instead of reporting "nothing specific enough found" most weeks.
      search_depth: "advanced",
      max_results: 5,
      include_answer: true,
    };
    if (opts.startDate) body.start_date = opts.startDate;
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, code: "http_error", message: `Tavily returned HTTP ${res.status}.` };
    const data = (await res.json()) as { results?: TavilyResult[]; answer?: string };
    const results = (data.results ?? []).filter(r => (r.score ?? 1) >= 0.5);
    if (results.length === 0) return { ok: false, code: "no_results", message: "No results found." };
    const answerLine = data.answer ? `Summary: ${data.answer}\n\n` : "";
    const text = answerLine + results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 900)}`).join("\n\n");
    return { ok: true, text };
  } catch (err) {
    return { ok: false, code: "network_error", message: `Web search failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }
}

export const SEARCH_WEB_TOOL: Tool = {
  name: "search_web",
  description: "Search the web for public information such as school registration deadlines, camp sign-up dates, local activity schedules, or other household-relevant events.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
};
