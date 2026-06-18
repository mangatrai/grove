export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Populated on assistant messages when the model requested tool calls. */
  toolCalls?: ToolCall[];
  /** Populated on tool messages — references the call this result answers. */
  toolCallId?: string;
}

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema object for the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface CompletionOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

// ── Vision ───────────────────────────────────────────────────────────────────

export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; base64Data: string };

export interface VisionMessage {
  role: "system" | "user";
  content: string | VisionContentPart[];
}

export interface VisionCompletionOptions {
  model: string;
  maxTokens?: number;
  /** Request structured JSON output. Providers use their best available mechanism. */
  responseFormat?: "text" | "json";
  /**
   * JSON Schema for strict structured output (OpenAI json_schema mode).
   * Anthropic ignores this; the system prompt instructs JSON output instead.
   */
  jsonSchema?: Record<string, unknown>;
  jsonSchemaName?: string;
}
