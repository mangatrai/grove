import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { qExec, qGet } from "../../src/db/query.js";
import { sqlStmt } from "../pg-stmt.js";

// #167: mocked-LLM wiring tests for the classifier + POST/GET /agent/task routes. Real-provider
// classification quality is out of scope here — same convention as pa-task-runner.test.ts
// ("CI tests cover loop mechanics with mocked LLM... live-provider quality validated by a separate
// manual eval script").
type LlmUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };
type CompleteFn = (
  messages: { role: string; content: string }[],
  options: { model: string; maxTokens: number }
) => Promise<{ content: string; usage: LlmUsage }>;
type RunToolLoopFn = (...args: unknown[]) => Promise<{ finalResponse: string }>;

const { mockComplete, mockRunToolLoop, mockTavilySearch, mockTavilyExtract } = vi.hoisted(() => ({
  mockComplete: vi.fn<CompleteFn>(),
  mockRunToolLoop: vi.fn<RunToolLoopFn>(),
  mockTavilySearch: vi.fn(),
  mockTavilyExtract: vi.fn(),
}));

vi.mock("../../src/llm/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/llm/index.js")>();
  return {
    ...actual,
    chatModel: () => "TEST_CHEAP_MODEL",
    strongModel: () => "TEST_STRONG_MODEL",
    getChatAdapter: () => ({ complete: mockComplete }),
    getToolUseAdapter: () => ({ runToolLoop: mockRunToolLoop }),
  };
});

vi.mock("../../src/llm/tools/tavily.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/llm/tools/tavily.js")>();
  return { ...actual, tavilySearch: mockTavilySearch, tavilyExtract: mockTavilyExtract };
});

const { buildApp } = await import("../../src/app.js");
const { classifyCaptureNote } = await import("../../src/modules/family/family-agent.service.js");

const app = buildApp();
const KNOWN_EMAIL = "owner@example.com";
const KNOWN_PASSWORD = "ChangeMe123!";
// Marker included in every goal/reason this file writes, so cleanup can target only its own rows.
const TEST_MARKER = "[FR-167-TEST]";

async function loginOwner(): Promise<string> {
  const res = await request(app).post("/auth/login").send({ email: KNOWN_EMAIL, password: KNOWN_PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function ownerHouseholdId(): Promise<string> {
  const row = await sqlStmt<{ household_id: string }>(`SELECT household_id FROM app_user WHERE email = ?`).get(KNOWN_EMAIL);
  if (!row?.household_id) throw new Error("owner household not found");
  return row.household_id;
}

function classifyResult(mode: "one_shot" | "research_loop") {
  return { content: JSON.stringify({ mode }), usage: { promptTokens: 5, completionTokens: 2 } };
}

function loopSynthesizeResult() {
  return { content: JSON.stringify({ action: "synthesize", because: "no research needed" }), usage: { promptTokens: 5, completionTokens: 2 } };
}

function synthesisResult(summary = "Test synthesis summary.") {
  return { content: JSON.stringify({ summary, actions: [] }), usage: { promptTokens: 10, completionTokens: 5 } };
}

afterAll(async () => {
  const householdId = await ownerHouseholdId();
  await qExec(`DELETE FROM family_agent_alerts WHERE household_id = ? AND reason LIKE ?`, householdId, `%${TEST_MARKER}%`);
  await qExec(`DELETE FROM pa_task_run WHERE household_id = ? AND goal LIKE ?`, householdId, `%${TEST_MARKER}%`);
});

describe("classifyCaptureNote (#167)", () => {
  beforeEach(() => {
    mockComplete.mockReset();
  });

  const oneShotExamples = [
    "remind me to call the vet Friday",
    "draft a message to the nanny about Friday pickup",
    "note: Jake is allergic to peanuts",
    "add a reminder to renew the car registration next week",
    "create an event for the dentist appointment on the 20th",
  ];

  const researchExamples = [
    "find swim camps with summer openings under $200",
    "what are good birthday gift ideas for a 7 year old who likes dinosaurs",
    "compare flight options to Chicago for next weekend",
    "find indoor activities for kids this weekend near us",
    "look up highly rated pediatric dentists nearby",
  ];

  it.each(oneShotExamples)("classifies one-shot-shaped note: %s", async (note) => {
    mockComplete.mockResolvedValueOnce(classifyResult("one_shot"));
    const result = await classifyCaptureNote(note);
    expect(result.mode).toBe("one_shot");
    expect(result.note).toBe(note);
    const [messages] = mockComplete.mock.calls[0];
    const userMessage = messages.find(m => m.role === "user")!;
    expect(userMessage.content).toBe(note);
  });

  it.each(researchExamples)("classifies research-shaped note: %s", async (note) => {
    mockComplete.mockResolvedValueOnce(classifyResult("research_loop"));
    const result = await classifyCaptureNote(note);
    expect(result.mode).toBe("research_loop");
    expect(result.note).toBe(note);
  });

  it("research: prefix forces research_loop and skips the LLM call entirely (D2)", async () => {
    const result = await classifyCaptureNote("research: find swim camps under $200");
    expect(result.mode).toBe("research_loop");
    expect(result.note).toBe("find swim camps under $200");
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("mode override skips the LLM call and does not strip note text (D2)", async () => {
    const result = await classifyCaptureNote("remind me to call the vet", "research_loop");
    expect(result.mode).toBe("research_loop");
    expect(result.note).toBe("remind me to call the vet");
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("defaults to one_shot on malformed classifier output (D3 fail-closed)", async () => {
    mockComplete.mockResolvedValueOnce({ content: "not json at all", usage: {} });
    const result = await classifyCaptureNote("some ambiguous note");
    expect(result.mode).toBe("one_shot");
  });

  it("defaults to one_shot when the schema-validated field is missing (D3 fail-closed)", async () => {
    mockComplete.mockResolvedValueOnce({ content: JSON.stringify({ wrongField: "research_loop" }), usage: {} });
    const result = await classifyCaptureNote("some ambiguous note");
    expect(result.mode).toBe("one_shot");
  });
});

describe("POST /api/family/agent/task (#167)", () => {
  beforeEach(() => {
    mockComplete.mockReset();
    mockRunToolLoop.mockReset();
    mockTavilySearch.mockReset();
    mockTavilyExtract.mockReset();
  });

  it("400s on an empty note", async () => {
    const token = await loginOwner();
    const res = await request(app)
      .post("/api/family/agent/task")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "" });
    expect(res.status).toBe(400);
  });

  it("one_shot: classifies then dispatches to processCaptureNote, returns { type, result }", async () => {
    const token = await loginOwner();
    mockComplete.mockResolvedValueOnce(classifyResult("one_shot"));
    mockRunToolLoop.mockResolvedValueOnce({
      finalResponse: JSON.stringify({ responseText: `Got it. ${TEST_MARKER}`, actions: [] }),
    });

    const res = await request(app)
      .post("/api/family/agent/task")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: `remind me to call the vet ${TEST_MARKER}` });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("one_shot");
    expect(res.body.result.responseText).toContain(TEST_MARKER);
    expect(mockRunToolLoop).toHaveBeenCalledTimes(1);

    // recordOneShotCapture is fire-and-forget (not awaited by the route) so the row may
    // not be committed the instant the HTTP response returns — give it a beat.
    await new Promise((r) => setTimeout(r, 100));
    const householdId = await ownerHouseholdId();
    const run = await qGet<{ capture_mode: string; status: string }>(
      `SELECT capture_mode, status FROM pa_task_run WHERE household_id = ? AND goal LIKE ? ORDER BY created_at DESC LIMIT 1`,
      householdId, `%${TEST_MARKER}%`
    );
    expect(run?.capture_mode).toBe("one_shot");
    expect(run?.status).toBe("succeeded");
  });

  it("one_shot: still records a failed pa_task_run row when processCaptureNote throws (#230)", async () => {
    const token = await loginOwner();
    mockComplete.mockResolvedValueOnce(classifyResult("one_shot"));
    mockRunToolLoop.mockRejectedValueOnce(new Error(`boom ${TEST_MARKER}`));

    const res = await request(app)
      .post("/api/family/agent/task")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: `remind me to call the vet, failing case ${TEST_MARKER}` });

    expect(res.status).toBe(502);

    await new Promise((r) => setTimeout(r, 100));
    const householdId = await ownerHouseholdId();
    const run = await qGet<{ capture_mode: string; status: string }>(
      `SELECT capture_mode, status FROM pa_task_run WHERE household_id = ? AND goal LIKE ? ORDER BY created_at DESC LIMIT 1`,
      householdId, `%failing case ${TEST_MARKER}%`
    );
    expect(run?.capture_mode).toBe("one_shot");
    expect(run?.status).toBe("failed");
  });

  it("research_loop: classifies then dispatches to runPATask, returns runId and persists a suggestion alert", async () => {
    const token = await loginOwner();
    mockComplete.mockResolvedValueOnce(classifyResult("research_loop"));
    mockComplete.mockResolvedValueOnce(loopSynthesizeResult());
    mockComplete.mockResolvedValueOnce(synthesisResult(`Research done. ${TEST_MARKER}`));

    const res = await request(app)
      .post("/api/family/agent/task")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: `find swim camps under $200 ${TEST_MARKER}` });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("research_loop");
    expect(res.body.result.summary).toContain(TEST_MARKER);
    expect(typeof res.body.runId).toBe("string");

    const run = await qGet<{ status: string }>(`SELECT status FROM pa_task_run WHERE id = ?`, res.body.runId);
    expect(run?.status).toBe("succeeded");

    const alert = await qGet<{ alert_type: string; reason: string }>(
      `SELECT alert_type, reason FROM family_agent_alerts WHERE household_id = ? AND reason LIKE ? ORDER BY detected_at DESC LIMIT 1`,
      await ownerHouseholdId(), `%${TEST_MARKER}%`
    );
    expect(alert?.alert_type).toBe("suggestion");
  });

  it("research: prefix skips the classify call and goes straight to runPATask", async () => {
    const token = await loginOwner();
    mockComplete.mockResolvedValueOnce(loopSynthesizeResult());
    mockComplete.mockResolvedValueOnce(synthesisResult(`Prefix research. ${TEST_MARKER}`));

    const res = await request(app)
      .post("/api/family/agent/task")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: `research: find swim camps ${TEST_MARKER}` });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("research_loop");
    // Only 2 complete() calls (decide + synthesize) — no classify call.
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });

  it("409s with the existing runId when a matching research task is already running (D5)", async () => {
    const token = await loginOwner();
    const householdId = await ownerHouseholdId();
    const goal = `already running goal ${TEST_MARKER}`;
    const existing = await qGet<{ id: string }>(
      `INSERT INTO pa_task_run (household_id, goal, origin, status, loop_model, synthesis_model)
       VALUES (?, ?, 'user', 'running', 'TEST_CHEAP_MODEL', 'TEST_STRONG_MODEL') RETURNING id`,
      householdId, goal
    );

    const res = await request(app)
      .post("/api/family/agent/task")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: `research: ${goal}` });

    expect(res.status).toBe(409);
    expect(res.body.runId).toBe(existing?.id);
    expect(mockComplete).not.toHaveBeenCalled();

    await qExec(`DELETE FROM pa_task_run WHERE id = ?`, existing?.id);
  });
});

describe("GET /api/family/agent/task/:runId (#167 D4)", () => {
  it("returns the run status for a completed task in the caller's household", async () => {
    const token = await loginOwner();
    const householdId = await ownerHouseholdId();
    const row = await qGet<{ id: string }>(
      `INSERT INTO pa_task_run (household_id, goal, origin, status, loop_model, synthesis_model, result_summary, iterations_used, hit_iteration_cap, finished_at)
       VALUES (?, ?, 'user', 'succeeded', 'TEST_CHEAP_MODEL', 'TEST_STRONG_MODEL', ?, 2, false, NOW()) RETURNING id`,
      householdId, `poll test goal ${TEST_MARKER}`, `poll test summary ${TEST_MARKER}`
    );

    const res = await request(app)
      .get(`/api/family/agent/task/${row?.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("succeeded");
    expect(res.body.summary).toContain(TEST_MARKER);
    expect(res.body.iterationsUsed).toBe(2);

    await qExec(`DELETE FROM pa_task_run WHERE id = ?`, row?.id);
  });

  it("404s for an unknown runId", async () => {
    const token = await loginOwner();
    const res = await request(app)
      .get(`/api/family/agent/task/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/family/agent/task/history (#230)", () => {
  const OTHER_HOUSEHOLD_ID = "99990000-test-0000-0000-fr230other01";

  afterAll(async () => {
    await qExec(`DELETE FROM pa_task_run WHERE household_id = ?`, OTHER_HOUSEHOLD_ID);
    await qExec(`DELETE FROM household WHERE id = ?`, OTHER_HOUSEHOLD_ID);
  });

  it("returns entries for the caller's household, newest first", async () => {
    const token = await loginOwner();
    const householdId = await ownerHouseholdId();
    const row = await qGet<{ id: string }>(
      `INSERT INTO pa_task_run (household_id, goal, origin, status, capture_mode, result_summary, finished_at)
       VALUES (?, ?, 'user', 'succeeded', 'one_shot', ?, NOW()) RETURNING id`,
      householdId, `history route goal ${TEST_MARKER}`, `history route summary ${TEST_MARKER}`
    );

    const res = await request(app)
      .get("/api/family/agent/task/history")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    const entry = res.body.entries.find((e: { id: string }) => e.id === row?.id);
    expect(entry).toBeTruthy();
    expect(entry.captureMode).toBe("one_shot");
    expect(entry.status).toBe("succeeded");
    expect(entry.resultSummary).toContain(TEST_MARKER);

    await qExec(`DELETE FROM pa_task_run WHERE id = ?`, row?.id);
  });

  it("does not return another household's runs", async () => {
    await qExec(`INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, OTHER_HOUSEHOLD_ID, "FR-230 other household");
    await qExec(
      `INSERT INTO pa_task_run (household_id, goal, origin, status, capture_mode, finished_at)
       VALUES (?, ?, 'user', 'succeeded', 'one_shot', NOW())`,
      OTHER_HOUSEHOLD_ID, `other household goal ${TEST_MARKER}`
    );

    const token = await loginOwner();
    const res = await request(app)
      .get("/api/family/agent/task/history")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const goals = (res.body.entries as { goal: string }[]).map((e) => e.goal);
    expect(goals).not.toContain(`other household goal ${TEST_MARKER}`);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/family/agent/task/history");
    expect(res.status).toBe(401);
  });
});
