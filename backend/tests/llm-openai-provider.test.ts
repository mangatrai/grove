import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #228: OpenAI's json_object mode only guarantees syntactically valid JSON, not a single
// top-level value or a shape — a live eval run saw gpt-4.1-mini return two JSON objects
// concatenated in one completion under json_object mode, breaking downstream JSON.parse().
// json_schema strict mode is the real enforcement mechanism; these tests assert openaiChat()
// requests it correctly when a schema is supplied, and falls back to the old behavior otherwise.

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

vi.mock("../src/config/env.js", () => ({
  env: { OPENAI_API_KEY: "test-key" },
}));

describe("openaiChat", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses json_schema strict mode when jsonSchema + jsonSchemaName are provided", async () => {
    const { openaiChat } = await import("../src/llm/providers/openai.js");
    const schema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"], additionalProperties: false };

    await openaiChat([{ role: "user", content: "hi" }], {
      model: "gpt-4.1-mini",
      responseFormat: "json",
      jsonSchema: schema,
      jsonSchemaName: "test_schema",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "test_schema", strict: true, schema },
    });
  });

  it("falls back to json_object mode when no schema is provided", async () => {
    const { openaiChat } = await import("../src/llm/providers/openai.js");

    await openaiChat([{ role: "user", content: "hi" }], {
      model: "gpt-4.1-mini",
      responseFormat: "json",
    });

    const call = createMock.mock.calls[0][0];
    expect(call.response_format).toEqual({ type: "json_object" });
  });

  it("omits response_format entirely when JSON output isn't requested", async () => {
    const { openaiChat } = await import("../src/llm/providers/openai.js");

    await openaiChat([{ role: "user", content: "hi" }], { model: "gpt-4.1-mini" });

    const call = createMock.mock.calls[0][0];
    expect(call.response_format).toBeUndefined();
  });
});
