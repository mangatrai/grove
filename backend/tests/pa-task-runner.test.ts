import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { qExec, qGet } from "../src/db/query.js";
import { env } from "../src/config/env.js";

// #164 A8: CI tests cover loop mechanics with a mocked LLM adapter and mocked Tavily calls —
// live-provider quality (real flight/venue/gift research) is validated by the separate manual
// eval script (backend/scripts/pa-task-eval.ts), not here.
type LlmUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };
type CompleteFn = (
  messages: { role: string; content: string }[],
  options: { model: string; maxTokens: number }
) => Promise<{ content: string; usage: LlmUsage }>;
type TavilySearchFn = (
  query: string,
  opts?: { startDate?: string }
) => Promise<
  | { ok: true; text: string }
  | { ok: false; code: "not_configured" | "empty_query" | "http_error" | "no_results" | "network_error"; message: string }
>;
type TavilyExtractFn = (
  url: string,
  query?: string
) => Promise<
  | { ok: true; text: string }
  | { ok: false; code: "not_configured" | "empty_url" | "http_error" | "no_content" | "network_error"; message: string }
>;

const { mockComplete, mockTavilySearch, mockTavilyExtract } = vi.hoisted(() => ({
  mockComplete: vi.fn<CompleteFn>(),
  mockTavilySearch: vi.fn<TavilySearchFn>(),
  mockTavilyExtract: vi.fn<TavilyExtractFn>(),
}));

vi.mock("../src/llm/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/index.js")>();
  return {
    ...actual,
    chatModel: () => "TEST_CHEAP_MODEL",
    strongModel: () => "TEST_STRONG_MODEL",
    getChatAdapter: () => ({ complete: mockComplete }),
  };
});

vi.mock("../src/llm/tools/tavily.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/tools/tavily.js")>();
  return { ...actual, tavilySearch: mockTavilySearch, tavilyExtract: mockTavilyExtract };
});

import {
  executeSearchCalendar,
  executeSearchFinanceContext,
  runPATask,
} from "../src/modules/family/pa-task-runner.js";

function loopToolCall(tool: string, args: Record<string, unknown> = {}) {
  return { content: JSON.stringify({ action: "tool_call", tool, args, reasoning: "test" }), usage: { promptTokens: 10, completionTokens: 5 } };
}
function loopSynthesize() {
  return { content: JSON.stringify({ action: "synthesize", because: "test has enough" }), usage: { promptTokens: 8, completionTokens: 4 } };
}
function compressionResult(summary: string, findings: unknown[] = []) {
  return { content: JSON.stringify({ summary, findings }), usage: { promptTokens: 20, completionTokens: 10 } };
}
function synthesisResult(summary = "Test synthesis summary.", actions: unknown[] = []) {
  return { content: JSON.stringify({ summary, actions }), usage: { promptTokens: 30, completionTokens: 15 } };
}

async function getRun(householdId: string) {
  const row = await qGet<{
    status: string;
    iterations_used: number;
    hit_iteration_cap: boolean;
    prompt_tokens: number;
    completion_tokens: number;
    tavily_calls: number;
    findings_json: unknown;
    compressed_history_json: unknown;
  }>(
    `SELECT status, iterations_used, hit_iteration_cap, prompt_tokens, completion_tokens, tavily_calls, findings_json, compressed_history_json
     FROM pa_task_run WHERE household_id = ? ORDER BY created_at DESC LIMIT 1`,
    householdId
  );
  if (!row) return row;
  // qGet returns JSONB columns as raw JSON strings, not parsed values (same behavior FamilyEventRow.assignee_ids relies on).
  return {
    ...row,
    findings_json: typeof row.findings_json === "string" ? JSON.parse(row.findings_json) : row.findings_json,
    compressed_history_json: typeof row.compressed_history_json === "string" ? JSON.parse(row.compressed_history_json) : row.compressed_history_json,
  };
}

describe("pa-task-runner (#164, #166)", () => {
  const HOUSEHOLD_ID = "99990000-test-0000-0000-pataskhh0001";
  const BUDGET_HOUSEHOLD_ID = "99990000-test-0000-0000-pataskhh0002";
  const EMPTY_HOUSEHOLD_ID = "99990000-test-0000-0000-pataskhh0003";
  const DAILY_BUDGET_HOUSEHOLD_ID = "99990000-test-0000-0000-pataskhh0004";
  const DEDUP_HOUSEHOLD_ID = "99990000-test-0000-0000-pataskhh0005";

  beforeAll(async () => {
    await qExec(`INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, HOUSEHOLD_ID, "PA task test household");
    await qExec(`INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, BUDGET_HOUSEHOLD_ID, "PA task budget test household");
    await qExec(`INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, EMPTY_HOUSEHOLD_ID, "PA task empty test household");
    await qExec(`INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, DAILY_BUDGET_HOUSEHOLD_ID, "PA task daily budget test household");
    await qExec(`INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, DEDUP_HOUSEHOLD_ID, "PA task dedup test household");
  });

  afterAll(async () => {
    await qExec(
      `DELETE FROM pa_task_run WHERE household_id IN (?, ?, ?, ?, ?)`,
      HOUSEHOLD_ID, BUDGET_HOUSEHOLD_ID, EMPTY_HOUSEHOLD_ID, DAILY_BUDGET_HOUSEHOLD_ID, DEDUP_HOUSEHOLD_ID
    );
    await qExec(
      `DELETE FROM household WHERE id IN (?, ?, ?, ?, ?)`,
      HOUSEHOLD_ID, BUDGET_HOUSEHOLD_ID, EMPTY_HOUSEHOLD_ID, DAILY_BUDGET_HOUSEHOLD_ID, DEDUP_HOUSEHOLD_ID
    );
  });

  beforeEach(() => {
    mockComplete.mockReset();
    mockTavilySearch.mockReset();
    mockTavilyExtract.mockReset();
    mockTavilySearch.mockResolvedValue({ ok: true, text: "generic search result text" });
    mockTavilyExtract.mockResolvedValue({ ok: true, text: "generic page text" });
  });

  it("stops immediately when the loop signals synthesize on the first iteration", async () => {
    mockComplete.mockResolvedValueOnce(loopSynthesize());
    mockComplete.mockResolvedValueOnce(synthesisResult("Nothing to research."));

    const result = await runPATask("trivial goal", HOUSEHOLD_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.iterationsUsed).toBe(1);
      expect(result.data.hitIterationCap).toBe(false);
      expect(result.data.summary).toBe("Nothing to research.");
    }
    expect(mockComplete).toHaveBeenCalledTimes(2); // 1 loop decision + 1 synthesis, no tool/compression calls
  });

  it("forces synthesis when the iteration cap is hit without a synthesize signal", async () => {
    for (let i = 0; i < 6; i++) {
      mockComplete.mockResolvedValueOnce(loopToolCall("search_web", { query: `query ${i}` }));
      mockComplete.mockResolvedValueOnce(compressionResult(`summary ${i}`));
    }
    mockComplete.mockResolvedValueOnce(synthesisResult("Forced synthesis after cap."));

    const result = await runPATask("goal that never signals done", HOUSEHOLD_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.iterationsUsed).toBe(6);
      expect(result.data.hitIterationCap).toBe(true);
      expect(result.data.summary).toBe("Forced synthesis after cap.");
    }
    // 6 * (loop decision + compression) + 1 synthesis
    expect(mockComplete).toHaveBeenCalledTimes(13);

    const run = await getRun(HOUSEHOLD_ID);
    expect(run?.status).toBe("succeeded");
    expect(run?.iterations_used).toBe(6);
    expect(run?.hit_iteration_cap).toBe(true);
  });

  it("never leaks raw uncompressed tool output into the next iteration's prompt", async () => {
    const rawSecretMarker = "RAW_UNCOMPRESSED_MARKER_7f3a";
    mockTavilySearch.mockResolvedValueOnce({ ok: true, text: `some result containing ${rawSecretMarker}` });
    mockComplete.mockResolvedValueOnce(loopToolCall("search_web", { query: "anything" }));
    mockComplete.mockResolvedValueOnce(compressionResult("a clean compressed summary with no secrets"));
    mockComplete.mockResolvedValueOnce(loopSynthesize());
    mockComplete.mockResolvedValueOnce(synthesisResult());

    await runPATask("goal", HOUSEHOLD_ID);

    // 3rd call is the 2nd loop decision — its prompt must only ever have seen the compressed summary.
    const secondLoopCallMessages = mockComplete.mock.calls[2][0];
    const userMessage = secondLoopCallMessages.find(m => m.role === "user");
    expect(userMessage?.content).not.toContain(rawSecretMarker);
    expect(userMessage?.content).toContain("a clean compressed summary with no secrets");

    // The synthesis call (4th) also must never see the raw tool text directly.
    const synthesisCallMessages = mockComplete.mock.calls[3][0];
    const synthesisUserMessage = synthesisCallMessages.find(m => m.role === "user");
    expect(synthesisUserMessage?.content).not.toContain(rawSecretMarker);
  });

  it("accumulates findings into the ledger and evicts the oldest 'other' entries past the cap", async () => {
    const manyFindings = Array.from({ length: 45 }, (_, i) => ({
      fact: `fact-${i}`,
      entity: null,
      sourceUrl: null,
      kind: "other",
    }));
    mockComplete.mockResolvedValueOnce(loopToolCall("search_web", { query: "anything" }));
    mockComplete.mockResolvedValueOnce(compressionResult("summary with many findings", manyFindings));
    mockComplete.mockResolvedValueOnce(loopSynthesize());
    mockComplete.mockResolvedValueOnce(synthesisResult());

    await runPATask("goal", HOUSEHOLD_ID);

    const run = await getRun(HOUSEHOLD_ID);
    const findings = run?.findings_json as Array<{ fact: string }>;
    expect(findings).toHaveLength(40);
    expect(findings.map(f => f.fact)).not.toContain("fact-0");
    expect(findings.map(f => f.fact)).not.toContain("fact-4");
    expect(findings.map(f => f.fact)).toContain("fact-5");
    expect(findings.map(f => f.fact)).toContain("fact-44");
  });

  it("accumulates LlmUsage and Tavily call counts into the pa_task_run row", async () => {
    mockComplete.mockResolvedValueOnce(loopToolCall("search_web", { query: "q1" }));
    mockComplete.mockResolvedValueOnce(compressionResult("summary 1"));
    mockComplete.mockResolvedValueOnce(loopToolCall("fetch_page", { url: "https://example.com" }));
    mockComplete.mockResolvedValueOnce(compressionResult("summary 2"));
    mockComplete.mockResolvedValueOnce(loopSynthesize());
    mockComplete.mockResolvedValueOnce(synthesisResult());

    await runPATask("goal", HOUSEHOLD_ID);

    const run = await getRun(HOUSEHOLD_ID);
    // loop(10/5) + compress(20/10) + loop(10/5) + compress(20/10) + loop(8/4) + synth(30/15)
    expect(run?.prompt_tokens).toBe(10 + 20 + 10 + 20 + 8 + 30);
    expect(run?.completion_tokens).toBe(5 + 10 + 5 + 10 + 4 + 15);
    expect(run?.tavily_calls).toBe(2);
  });

  it("fails closed on malformed compression JSON output, without crashing the run", async () => {
    mockComplete.mockResolvedValueOnce(loopToolCall("search_web", { query: "anything" }));
    mockComplete.mockResolvedValueOnce({ content: "not valid json {{{", usage: { promptTokens: 1, completionTokens: 1 } });
    mockComplete.mockResolvedValueOnce(loopSynthesize());
    mockComplete.mockResolvedValueOnce(synthesisResult());

    const result = await runPATask("goal", HOUSEHOLD_ID);

    expect(result.ok).toBe(true);
    const run = await getRun(HOUSEHOLD_ID);
    const findings = run?.findings_json as unknown[];
    expect(findings).toHaveLength(0); // malformed compression contributes no findings
    const history = run?.compressed_history_json as string[];
    expect(history[0]).toContain("could not summarize");
  });

  it("recovers a tool_call decision even when the model echoes a second, truncated JSON object after it (#228)", async () => {
    // Captured verbatim from a live gpt-4.1-mini run under json_object mode: the model emitted
    // a complete decision object, then started restating it and got cut off mid-string.
    const concatenatedJson =
      '{"action":"tool_call","tool":"search_web","args":{"query":"dinosaur building sets 10 year old under $40"},"reasoning":"start research"}\n' +
      '{"action":"tool_call","tool":"search_web","args":{"query":"dinosaur building sets 10 year old under $40"},"reasoning":"To find suitable gift options 10 year old who lik';
    mockComplete.mockResolvedValueOnce({ content: concatenatedJson, usage: { promptTokens: 10, completionTokens: 5 } });
    mockComplete.mockResolvedValueOnce(compressionResult("recovered and searched successfully"));
    mockComplete.mockResolvedValueOnce(loopSynthesize());
    mockComplete.mockResolvedValueOnce(synthesisResult());

    const result = await runPATask("find a gift", HOUSEHOLD_ID);

    expect(result.ok).toBe(true);
    // proves the tool_call was recovered and executed, not dropped to a forced-synthesize
    // fallback because the raw content failed a naive JSON.parse().
    expect(mockTavilySearch).toHaveBeenCalledTimes(1);
  });

  it("search_web calls Tavily with no startDate by default, and only sets one when recent_only is requested (#166 C3)", async () => {
    mockComplete.mockResolvedValueOnce(loopToolCall("search_web", { query: "durable content query" }));
    mockComplete.mockResolvedValueOnce(compressionResult("summary"));
    mockComplete.mockResolvedValueOnce(loopSynthesize());
    mockComplete.mockResolvedValueOnce(synthesisResult());

    await runPATask("goal", HOUSEHOLD_ID);

    expect(mockTavilySearch).toHaveBeenCalledWith("durable content query", {});

    mockComplete.mockReset();
    mockTavilySearch.mockReset();
    mockTavilySearch.mockResolvedValue({ ok: true, text: "recent result" });
    mockComplete.mockResolvedValueOnce(loopToolCall("search_web", { query: "this weekend's events", recent_only: true }));
    mockComplete.mockResolvedValueOnce(compressionResult("summary"));
    mockComplete.mockResolvedValueOnce(loopSynthesize());
    mockComplete.mockResolvedValueOnce(synthesisResult());

    await runPATask("goal 2", HOUSEHOLD_ID);

    const [, opts] = mockTavilySearch.mock.calls[0];
    expect(opts?.startDate).toBeTruthy();
  });

  it("search_calendar returns a no-data sentinel instead of throwing when the household has no events", async () => {
    const result = await executeSearchCalendar(EMPTY_HOUSEHOLD_ID, { start_date: "2026-08-01", end_date: "2026-08-31" });
    expect(result.tavilyCall).toBe(false);
    expect(result.text.toLowerCase()).toContain("no calendar events");
  });

  it("search_finance_context returns a no-data sentinel instead of throwing when the household has no transactions", async () => {
    const result = await executeSearchFinanceContext(EMPTY_HOUSEHOLD_ID, {});
    expect(result.tavilyCall).toBe(false);
    expect(result.text.toLowerCase()).toContain("no spending data");
  });

  describe("budget refusal", () => {
    beforeAll(async () => {
      await qExec(
        `INSERT INTO pa_task_run (household_id, goal, status)
         SELECT ?, 'filler run', 'succeeded' FROM generate_series(1, ?)`,
        BUDGET_HOUSEHOLD_ID, env.PA_TASK_MAX_RUNS_PER_MONTH
      );
    });

    it("refuses a new run once the household is at PA_TASK_MAX_RUNS_PER_MONTH, without calling the LLM", async () => {
      const result = await runPATask("one goal too many", BUDGET_HOUSEHOLD_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PA_BUDGET_EXCEEDED");
      expect(mockComplete).not.toHaveBeenCalled();

      const refusedRow = await qGet<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM pa_task_run WHERE household_id = ? AND status = 'refused_budget'`,
        BUDGET_HOUSEHOLD_ID
      );
      expect(Number(refusedRow?.count ?? "0")).toBeGreaterThanOrEqual(1);
    });
  });

  describe("daily budget refusal (#167 D6)", () => {
    beforeAll(async () => {
      await qExec(
        `INSERT INTO pa_task_run (household_id, goal, status)
         SELECT ?, 'filler run', 'succeeded' FROM generate_series(1, ?)`,
        DAILY_BUDGET_HOUSEHOLD_ID, env.PA_TASK_MAX_RUNS_PER_DAY
      );
    });

    it("refuses a new run once the household is at PA_TASK_MAX_RUNS_PER_DAY, without calling the LLM", async () => {
      const result = await runPATask("one goal too many today", DAILY_BUDGET_HOUSEHOLD_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("PA_BUDGET_EXCEEDED");
        expect(result.message).toContain(String(env.PA_TASK_MAX_RUNS_PER_DAY));
      }
      expect(mockComplete).not.toHaveBeenCalled();

      const refusedRow = await qGet<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM pa_task_run WHERE household_id = ? AND status = 'refused_budget'`,
        DAILY_BUDGET_HOUSEHOLD_ID
      );
      expect(Number(refusedRow?.count ?? "0")).toBeGreaterThanOrEqual(1);
    });
  });

  describe("concurrency dedup (#167 D5)", () => {
    it("refuses a new run when a normalized-equal goal is already running for the household", async () => {
      const runningRow = await qGet<{ id: string }>(
        `INSERT INTO pa_task_run (household_id, goal, status) VALUES (?, ?, 'running') RETURNING id`,
        DEDUP_HOUSEHOLD_ID, "  Find   swim CAMPS under $200  "
      );

      const result = await runPATask("find swim camps under $200", DEDUP_HOUSEHOLD_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("PA_TASK_ALREADY_RUNNING");
        if (result.code === "PA_TASK_ALREADY_RUNNING") expect(result.runId).toBe(runningRow?.id);
      }
      expect(mockComplete).not.toHaveBeenCalled();

      await qExec(`DELETE FROM pa_task_run WHERE id = ?`, runningRow?.id);
    });

    it("does not dedup against a goal from a different household", async () => {
      const runningRow = await qGet<{ id: string }>(
        `INSERT INTO pa_task_run (household_id, goal, status) VALUES (?, ?, 'running') RETURNING id`,
        DEDUP_HOUSEHOLD_ID, "cross household goal"
      );

      const result = await runPATask("cross household goal", EMPTY_HOUSEHOLD_ID);

      // Not a dedup refusal — proceeds into the loop with EMPTY_HOUSEHOLD_ID's own budget/mocks.
      if (!result.ok) expect(result.code).not.toBe("PA_TASK_ALREADY_RUNNING");

      await qExec(`DELETE FROM pa_task_run WHERE id = ?`, runningRow?.id);
      await qExec(`DELETE FROM pa_task_run WHERE household_id = ? AND goal = ?`, EMPTY_HOUSEHOLD_ID, "cross household goal");
    });
  });
});
