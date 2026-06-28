import { env } from "../../config/env.js";
import type { Tool } from "../types.js";

type TavilyResult = { title: string; url: string; content: string };

export async function tavilySearch(query: string): Promise<string> {
  if (!env.TAVILY_API_KEY) return "Web search is not configured (TAVILY_API_KEY missing).";
  if (!query.trim()) return "No query provided.";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query: query.trim(), search_depth: "basic", max_results: 5 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return `Tavily returned HTTP ${res.status}.`;
    const data = (await res.json()) as { results?: TavilyResult[] };
    const results = data.results ?? [];
    return results.length === 0
      ? "No results found."
      : results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join("\n\n");
  } catch (err) {
    return `Web search failed: ${err instanceof Error ? err.message : "unknown error"}.`;
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
