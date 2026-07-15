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
    // FIX: Tavily occasionally returns results missing title/url/content — without this check
    // those render as the literal string "undefined" or throw on `.slice()`, which breaks the
    // downstream compression step's JSON parsing (loop decision fails validation, forces an
    // early synthesize with an empty findings ledger).
    const results = (data.results ?? []).filter(r => (r.score ?? 1) >= 0.5 && r.title?.trim() && r.url?.trim() && r.content?.trim());
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

export type TavilyExtractResult =
  | { ok: true; text: string }
  | { ok: false; code: "not_configured" | "empty_url" | "http_error" | "no_content" | "network_error"; message: string };

// #166 C2: search_web truncates each result to 900 chars — enough to find a candidate, not
// enough to pull its pricing table or contact block. fetch_page wraps Tavily's extract endpoint
// to pull the concrete facts once the loop has picked a promising URL.
const EXTRACT_CHAR_CAP = 6_000;

export async function tavilyExtract(url: string, query?: string): Promise<TavilyExtractResult> {
  if (!env.TAVILY_API_KEY) return { ok: false, code: "not_configured", message: "Web fetch is not configured (TAVILY_API_KEY missing)." };
  if (!url.trim()) return { ok: false, code: "empty_url", message: "No URL provided." };
  try {
    const body: Record<string, unknown> = {
      api_key: env.TAVILY_API_KEY,
      urls: [url.trim()],
      extract_depth: "advanced",
    };
    if (query?.trim()) body.query = query.trim();
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, code: "http_error", message: `Tavily returned HTTP ${res.status}.` };
    const data = (await res.json()) as { results?: Array<{ url: string; raw_content?: string }> };
    const raw = data.results?.[0]?.raw_content?.trim();
    if (!raw) return { ok: false, code: "no_content", message: "No extractable content at that URL." };
    return { ok: true, text: raw.slice(0, EXTRACT_CHAR_CAP) };
  } catch (err) {
    return { ok: false, code: "network_error", message: `Page fetch failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }
}

export const FETCH_PAGE_TOOL: Tool = {
  name: "fetch_page",
  description: "Fetch and extract the full text content of a specific web page (e.g. a venue's pricing page, a product listing). Use after search_web has identified a promising URL, to pull concrete pricing, contact, or booking details that search snippets truncate.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The exact page URL to fetch" },
      query: { type: "string", description: "Optional: what to look for on the page, used to rank extracted content" },
    },
    required: ["url"],
  },
};
