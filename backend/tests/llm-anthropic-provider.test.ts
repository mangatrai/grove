import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #228: Anthropic has no json_object-equivalent mode — before this fix, JSON output was
// requested via a system-prompt instruction only, with no structural enforcement. Forced
// tool-use (a synthetic tool whose input_schema is the desired output shape, tool_choice
// pinned to it) is Anthropic's actual mechanism for guaranteeing schema-conformant output.
// These tests assert anthropicChat() uses it when a schema is supplied, and falls back to
// the old prompt-instruction behavior otherwise.

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

vi.mock("../src/config/env.js", () => ({
  env: { ANTHROPIC_API_KEY: "test-key" },
}));

describe("anthropicChat", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forces tool-use with the given schema when jsonSchema + jsonSchemaName are provided", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "tool_use", id: "t1", name: "test_schema", input: { foo: "bar" } }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const { anthropicChat } = await import("../src/llm/providers/anthropic.js");
    const schema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"], additionalProperties: false };

    const result = await anthropicChat([{ role: "user", content: "hi" }], {
      model: "claude-haiku-4-5",
      responseFormat: "json",
      jsonSchema: schema,
      jsonSchemaName: "test_schema",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.tools).toEqual([
      { name: "test_schema", description: expect.any(String), input_schema: schema },
    ]);
    expect(call.tool_choice).toEqual({ type: "tool", name: "test_schema" });
    // content comes back as the already-parsed tool input, re-stringified — callers keep doing
    // JSON.parse() + Zod validation unchanged, but now on genuinely schema-conformant JSON.
    expect(result.content).toBe(JSON.stringify({ foo: "bar" }));
  });

  it("returns empty content when no tool_use block comes back, rather than throwing", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "I refuse." }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const { anthropicChat } = await import("../src/llm/providers/anthropic.js");

    const result = await anthropicChat([{ role: "user", content: "hi" }], {
      model: "claude-haiku-4-5",
      responseFormat: "json",
      jsonSchema: { type: "object" },
      jsonSchemaName: "test_schema",
    });

    expect(result.content).toBe("");
  });

  it("falls back to the prompt-instruction path when no schema is provided", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: '{"ok":true}' }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const { anthropicChat } = await import("../src/llm/providers/anthropic.js");

    await anthropicChat([{ role: "system", content: "You are helpful." }, { role: "user", content: "hi" }], {
      model: "claude-haiku-4-5",
      responseFormat: "json",
    });

    const call = createMock.mock.calls[0][0];
    expect(call.tools).toBeUndefined();
    expect(call.system).toContain("Return ONLY valid JSON");
  });
});
