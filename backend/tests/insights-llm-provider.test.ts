import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FIX (financial health insight non-JSON prod failure): generateInsight() called
// adapter.complete() with no responseFormat/jsonSchema, so Anthropic had no structured-output
// enforcement (only the weaker "Return ONLY valid JSON" prompt instruction — see #228 /
// llm-anthropic-provider.test.ts) and would occasionally wrap JSON in prose, which
// parseInsightPayload's markdown-extraction fallback never reached because it only ran after a
// successful-but-wrong-shape parse, not after a JSON.parse failure. These tests assert the
// schema is now passed through, and that the fallback actually fires on non-JSON input.

const completeMock = vi.fn();

vi.mock("../src/llm/index.js", () => ({
  getChatAdapter: () => ({ complete: completeMock }),
  chatModel: () => "test-model",
}));

describe("generateInsight", () => {
  beforeEach(() => {
    completeMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const validPayload = {
    healthRating: "on_track",
    healthRationale: "Spending is stable relative to income.",
    localBenchmark: "In line with local peers.",
    nationalBenchmark: "Above national median savings rate.",
    whatsWorking: ["Consistent 401k contributions"],
    concerns: ["Dining spend trending up"],
    spendingAnalysis: ["Groceries flat month over month"],
    investmentGaps: ["HSA under-funded relative to limit"],
    nextSteps: ["Increase HSA contribution"],
  };

  it("passes responseFormat=json and a jsonSchema to the chat adapter for real structured-output enforcement", async () => {
    completeMock.mockResolvedValue({ content: JSON.stringify(validPayload), usage: {} });
    const { generateInsight } = await import("../src/modules/insights/llm-provider.service.js");

    await generateInsight({ some: "context" });

    expect(completeMock).toHaveBeenCalledTimes(1);
    const options = completeMock.mock.calls[0][1];
    expect(options.responseFormat).toBe("json");
    expect(options.jsonSchemaName).toBe("financial_health_insight");
    expect(options.jsonSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["healthRating", "whatsWorking", "concerns", "nextSteps"]),
      additionalProperties: false,
    });
  });

  it("parses a clean JSON response into InsightPayload", async () => {
    completeMock.mockResolvedValue({ content: JSON.stringify(validPayload), usage: {} });
    const { generateInsight } = await import("../src/modules/insights/llm-provider.service.js");

    const result = await generateInsight({});

    expect(result).toEqual(validPayload);
  });

  it("recovers when the LLM wraps valid JSON in prose (the fallback path that was previously unreachable)", async () => {
    completeMock.mockResolvedValue({
      content: `Here is the analysis:\n${JSON.stringify(validPayload)}\nLet me know if you need more detail.`,
      usage: {},
    });
    const { generateInsight } = await import("../src/modules/insights/llm-provider.service.js");

    const result = await generateInsight({});

    expect(result).toEqual(validPayload);
  });

  it("throws 'LLM returned non-JSON' when there is no JSON object in the response at all", async () => {
    completeMock.mockResolvedValue({ content: "I cannot complete this request.", usage: {} });
    const { generateInsight } = await import("../src/modules/insights/llm-provider.service.js");

    await expect(generateInsight({})).rejects.toThrow("LLM returned non-JSON");
  });

  it("throws a shape-invalid error when JSON is present but doesn't match the schema", async () => {
    completeMock.mockResolvedValue({ content: JSON.stringify({ foo: "bar" }), usage: {} });
    const { generateInsight } = await import("../src/modules/insights/llm-provider.service.js");

    await expect(generateInsight({})).rejects.toThrow("LLM JSON shape invalid");
  });
});
