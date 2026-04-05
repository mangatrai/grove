import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("suggestCategoriesWithAiBatch", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      AI_CATEGORY_ENABLED: "1",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-4o-mini",
      LOG_LEVEL: "info"
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  it("maps batch results by transactionId and validates category ids", { timeout: 30_000 }, async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    transactionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    suggestedCategoryId: "not-a-real-uuid",
                    confidence: 0.95,
                    suggestedNewCategoryName: null,
                    reason: "test"
                  },
                  {
                    transactionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    suggestedCategoryId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    confidence: 0.5,
                    reason: "low"
                  }
                ]
              })
            }
          }
        ]
      })
    })) as unknown as typeof fetch;

    const { suggestCategoriesWithAiBatch } = await import("../src/modules/category/category-ai.service.js");
    const map = await suggestCategoriesWithAiBatch("household-will-not-resolve-categories", [
      {
        transactionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        normalizedDescription: "foo",
        signedAmount: -1
      },
      {
        transactionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        normalizedDescription: "bar",
        signedAmount: 2
      }
    ]);

    expect(map.size).toBe(2);
    const a = map.get("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(a?.suggestedCategoryId).toBeNull();
    expect(a?.confidence).toBe(0.95);
    const b = map.get("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(b?.suggestedCategoryId).toBeNull();
    expect(b?.confidence).toBe(0.5);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns all null when OpenAI returns non-OK", { timeout: 30_000 }, async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited"
    })) as unknown as typeof fetch;

    const { suggestCategoriesWithAiBatch } = await import("../src/modules/category/category-ai.service.js");
    const map = await suggestCategoriesWithAiBatch("h1", [
      { transactionId: "cccccccc-cccc-cccc-cccc-cccccccccccc", normalizedDescription: "x", signedAmount: 1 }
    ]);
    expect(map.get("cccccccc-cccc-cccc-cccc-cccccccccccc")).toBeNull();
  });
});
