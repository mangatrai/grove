import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../src/config/env.js";
import { tavilySearch } from "../src/llm/tools/tavily.js";

// FIX #226b: Tavily occasionally returns results missing title/url/content. Before the fix,
// those rendered as the literal string "undefined" (template interpolation) or threw on
// `.slice()` (missing content), which broke the PA task loop's downstream JSON compression step.
describe("tavilySearch", () => {
  const originalKey = env.TAVILY_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    env.TAVILY_API_KEY = "test-key";
  });

  afterEach(() => {
    env.TAVILY_API_KEY = originalKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetchOnce(results: Array<Partial<{ title: string; url: string; content: string; score: number }>>) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results }),
    }) as unknown as typeof fetch;
  }

  it("drops results missing title, url, or content", async () => {
    mockFetchOnce([
      { title: "Good result", url: "https://example.com/a", content: "Some real content." },
      { url: "https://example.com/b", content: "Missing title." },
      { title: "Missing URL", content: "No url here." },
      { title: "Missing content", url: "https://example.com/c" },
    ]);

    const result = await tavilySearch("dinosaur gifts");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Good result");
      expect(result.text).not.toContain("undefined");
      expect(result.text.match(/\[\d+\]/g)).toHaveLength(1);
    }
  });

  it("returns no_results when every result is malformed", async () => {
    mockFetchOnce([{ title: "", url: "https://example.com/a", content: "x" }, { title: "ok", url: "", content: "x" }]);

    const result = await tavilySearch("dinosaur gifts");

    expect(result).toEqual({ ok: false, code: "no_results", message: "No results found." });
  });
});
