import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { qExec, qGet } from "../src/db/query.js";

// FIX #211: mock the LLM adapter layer so Domain 1-5 functions can be unit-tested for
// (a) correctness of the merged D1+2 split and (b) which model tier each call actually uses,
// without hitting a real provider. Distinguishable sentinel model strings let assertions read
// "this call used the cheap tier" instead of comparing against real env-configured model names.
type CompleteFn = (
  messages: unknown,
  options: { model: string; maxTokens: number }
) => Promise<{ content: string; usage: Record<string, never> }>;
type TavilySearchFn = (
  query: string,
  opts?: { startDate?: string }
) => Promise<
  | { ok: true; text: string }
  | { ok: false; code: "not_configured" | "empty_query" | "http_error" | "no_results" | "network_error"; message: string }
>;
type RunToolLoopFn = (
  messages: { role: string; content: string }[],
  tools: unknown[],
  executor: (name: string, args: Record<string, unknown>) => Promise<string>,
  options: { model: string; maxTokens: number; maxIterations?: number }
) => Promise<{ finalResponse: string }>;

const { mockComplete, mockTavilySearch, mockRunToolLoop, mockIsLlmConfigured } = vi.hoisted(() => ({
  mockComplete: vi.fn<CompleteFn>(),
  mockTavilySearch: vi.fn<TavilySearchFn>(),
  mockRunToolLoop: vi.fn<RunToolLoopFn>(),
  // Defaults to true so every existing test (which never touches this gate) is unaffected;
  // only the runFamilyAgent skip-path tests override it.
  mockIsLlmConfigured: vi.fn<() => boolean>(() => true),
}));

vi.mock("../src/llm/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/index.js")>();
  return {
    ...actual,
    chatModel: () => "TEST_CHEAP_MODEL",
    strongModel: () => "TEST_STRONG_MODEL",
    getChatAdapter: () => ({ complete: mockComplete }),
    getToolUseAdapter: () => ({ runToolLoop: mockRunToolLoop }),
    isLlmConfigured: mockIsLlmConfigured,
  };
});

vi.mock("../src/llm/tools/tavily.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/tools/tavily.js")>();
  return { ...actual, tavilySearch: mockTavilySearch };
});

import {
  alertDedupKey,
  analyzeCoverageAndCoordination,
  buildAlreadySuggestedText,
  buildCalibrationBlock,
  buildCaptureContextHeader,
  buildDayGrid,
  escapeHtml,
  getConnectedParents,
  parseAlertItems,
  computeTodayIso,
  processCaptureNote,
  resolveAlert,
  runFamilyAgent,
  runProactiveResearch,
  startDateForFreshness,
  sweepDeadlines,
  synthesizeDigest,
  type AgentAlert,
  type AgentAnalysis,
  type CalendarEvent,
  type ConnectedParent,
  type FamilyContext,
  type PipelineOutputs,
} from "../src/modules/family/family-agent.service.js";
import { heuristicCalendarRole } from "../src/modules/gcal/gcal.service.js";
import type { FamilyEvent, HelpAvailabilitySlot } from "../src/modules/family/family.types.js";

function baseCtx(overrides: Partial<FamilyContext> = {}): FamilyContext {
  return {
    householdId: "hh-1",
    location: "Example City",
    today: "Monday, June 15",
    todayIso: "2026-06-15", // a Monday
    members: [],
    caregiverSlots: [],
    parentEvents: [],
    dbEvents: [],
    openAlerts: [],
    calibrationBlock: "",
    ...overrides
  };
}

function calEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    summary: "Event",
    start: null,
    end: null,
    allDay: false,
    location: null,
    calendarId: "primary",
    calendarName: "Primary",
    role: "work",
    ...overrides
  };
}

function dbEvent(overrides: Partial<FamilyEvent> = {}): FamilyEvent {
  return {
    id: "evt-1",
    householdId: "hh-1",
    recordType: "event",
    source: "manual",
    title: "Activity",
    description: null,
    startAt: null,
    endAt: null,
    dueDate: null,
    location: null,
    isRecurring: false,
    recurrenceRule: null,
    allDay: false,
    assigneeIds: [],
    gcalEventId: null,
    gcalCalendarId: null,
    isActive: true,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides
  };
}

function caregiverSlot(overrides: Partial<HelpAvailabilitySlot> = {}): HelpAvailabilitySlot {
  return {
    id: "slot-1",
    householdId: "hh-1",
    personProfileId: "person-1",
    personName: "Nanny",
    slotType: "regular",
    serviceType: "nanny",
    daysOfWeek: [],
    specificDate: null,
    startTime: null,
    endTime: null,
    label: null,
    notes: null,
    isActive: true,
    createdAt: "2026-06-01T00:00:00Z",
    ...overrides
  };
}

function alert(overrides: Partial<AgentAlert> = {}): AgentAlert {
  return {
    id: "alert-1", householdId: "hh-1", detectedAt: "2026-06-01T00:00:00Z",
    alertType: "suggestion", reason: "Example Camp — ages 6-8, register at example.com by July 15",
    affectedDate: null, copyPasteText: null, recipientHint: null,
    isResolved: false, resolvedAt: null, sourceDigestId: null,
    actionType: null, actionPayload: null,
    ...overrides
  };
}

describe("buildDayGrid (FIX #209 / #212)", () => {
  it("labels the first day with the correct weekday regardless of host TZ", () => {
    const grid = buildDayGrid(baseCtx(), 3);
    expect(grid[0]).toContain("Mon Jun 15 (2026-06-15)");
    expect(grid[1]).toContain("Tue Jun 16 (2026-06-16)");
    expect(grid[2]).toContain("Wed Jun 17 (2026-06-17)");
  });

  it("lists a timed parent event with start/end time on the correct day", () => {
    const ctx = baseCtx({
      parentEvents: [
        {
          email: "parentA@example.com",
          events: [
            calEvent({
              summary: "Client call",
              start: "2026-06-15T15:00:00-05:00",
              end: "2026-06-15T16:00:00-05:00",
              role: "work"
            })
          ]
        }
      ]
    });
    const grid = buildDayGrid(ctx, 1);
    expect(grid[0]).toContain("Parent A");
    expect(grid[0]).toContain("Client call");
  });

  it("excludes school-role events from parent commitment lines and lists them separately", () => {
    const ctx = baseCtx({
      parentEvents: [
        {
          email: "parentA@example.com",
          events: [
            calEvent({ summary: "District closed", start: "2026-06-15", allDay: true, role: "school" })
          ]
        }
      ]
    });
    const grid = buildDayGrid(ctx, 1);
    expect(grid[0]).not.toContain("Parent A:");
    expect(grid[0]).toContain("School (informational");
    expect(grid[0]).toContain("District closed");
  });

  it("treats GCal all-day end dates as exclusive", () => {
    const ctx = baseCtx({
      parentEvents: [
        {
          email: "parentA@example.com",
          events: [
            calEvent({ summary: "Field trip", start: "2026-06-15", end: "2026-06-16", allDay: true, role: "activities" })
          ]
        }
      ]
    });
    const grid = buildDayGrid(ctx, 2);
    expect(grid[0]).toContain("Field trip");
    expect(grid[1]).not.toContain("Field trip");
  });

  it("includes recurring caregiver coverage on matching weekdays only", () => {
    const ctx = baseCtx({
      caregiverSlots: [caregiverSlot({ personName: "Nanny", daysOfWeek: [1], startTime: "09:00", endTime: "17:00" })]
    });
    const grid = buildDayGrid(ctx, 2);
    expect(grid[0]).toContain("Caregiver: Nanny 09:00–17:00"); // Monday
    expect(grid[1]).not.toContain("Caregiver:"); // Tuesday
  });

  it("wires family_events (kid activities) into the grid but excludes deadlines", () => {
    const ctx = baseCtx({
      dbEvents: [
        dbEvent({ title: "Soccer practice", recordType: "event", startAt: "2026-06-15T18:00:00Z" }),
        dbEvent({ title: "Permission slip due", recordType: "deadline", dueDate: "2026-06-15" })
      ]
    });
    const grid = buildDayGrid(ctx, 1);
    expect(grid[0]).toContain("Activities: Soccer practice");
    expect(grid[0]).not.toContain("Permission slip due");
  });

  it("falls back to 'Nothing scheduled' for an empty day", () => {
    const grid = buildDayGrid(baseCtx(), 1);
    expect(grid[0]).toContain("Nothing scheduled.");
  });
});

describe("heuristicCalendarRole (FIX #212 calendar provenance)", () => {
  it("classifies school-named calendars as school", () => {
    expect(heuristicCalendarRole("Example ISD Calendar")).toBe("school");
    expect(heuristicCalendarRole("Kid's Class Schedule")).toBe("school");
  });

  it("classifies activity/sport/camp calendars as activities", () => {
    expect(heuristicCalendarRole("Soccer Activities")).toBe("activities");
    expect(heuristicCalendarRole("Summer Camp")).toBe("activities");
  });

  it("defaults to work for anything else", () => {
    expect(heuristicCalendarRole("Personal")).toBe("work");
    expect(heuristicCalendarRole("Family Shared")).toBe("work");
  });
});

describe("alertDedupKey (FIX #216 mechanical dedup backstop)", () => {
  it("produces the same key for identical alertType/affectedDate/reason-prefix", () => {
    const a = alertDedupKey("coverage_gap", "2026-07-10", "No caregiver coverage on Friday afternoon while both parents are in meetings");
    const b = alertDedupKey("coverage_gap", "2026-07-10", "No caregiver coverage on Friday afternoon while both parents are in meetings");
    expect(a).toBe(b);
  });

  it("ignores differences beyond the first 80 chars of reason", () => {
    const a = alertDedupKey("suggestion", null, "Example Summer Camp (examplecamp.com) — ages 6-8, $200/week, register at examplecamp.com/register by July 15");
    const b = alertDedupKey("suggestion", null, "Example Summer Camp (examplecamp.com) — ages 6-8, $200/week, register at examplecamp.com/register by August 1 instead");
    expect(a).toBe(b);
  });

  it("is case-insensitive and trims whitespace", () => {
    const a = alertDedupKey("deadline", "2026-08-01", "  School Enrollment Deadline  ");
    const b = alertDedupKey("deadline", "2026-08-01", "school enrollment deadline");
    expect(a).toBe(b);
  });

  it("differs when alertType or affectedDate differs", () => {
    const base = alertDedupKey("coverage_gap", "2026-07-10", "Same reason text");
    expect(alertDedupKey("deadline", "2026-07-10", "Same reason text")).not.toBe(base);
    expect(alertDedupKey("coverage_gap", "2026-07-11", "Same reason text")).not.toBe(base);
    expect(alertDedupKey("coverage_gap", null, "Same reason text")).not.toBe(base);
  });

  it("differs when reason content differs within the first 80 chars", () => {
    const a = alertDedupKey("suggestion", null, "Example Camp A — ages 6-8, register by July 15");
    const b = alertDedupKey("suggestion", null, "Example Camp B — ages 9-12, register by July 15");
    expect(a).not.toBe(b);
  });
});

describe("buildAlreadySuggestedText (FIX #216 Domain 3 dedup wiring)", () => {
  it("returns a placeholder when there are no open suggestion alerts", () => {
    expect(buildAlreadySuggestedText([])).toBe("Nothing suggested yet.");
  });

  it("excludes non-suggestion alert types (coverage_gap, deadline)", () => {
    const alerts = [
      alert({ alertType: "coverage_gap", reason: "Friday afternoon uncovered" }),
      alert({ alertType: "deadline", reason: "School enrollment due" }),
    ];
    expect(buildAlreadySuggestedText(alerts)).toBe("Nothing suggested yet.");
  });

  it("includes the reason text of open suggestion alerts, one per line", () => {
    const alerts = [
      alert({ id: "a1", reason: "Example Camp A — ages 6-8, register at example.com by July 15" }),
      alert({ id: "a2", reason: "Example Museum family day — free admission Saturdays" }),
    ];
    const text = buildAlreadySuggestedText(alerts);
    expect(text).toContain("Example Camp A");
    expect(text).toContain("Example Museum family day");
    expect(text.split("\n")).toHaveLength(2);
  });

  it("does not filter on isResolved itself — that's listAlerts(householdId, false)'s job", () => {
    const alerts = [alert({ isResolved: true, reason: "Already resolved suggestion" })];
    expect(buildAlreadySuggestedText(alerts)).toContain("Already resolved suggestion");
  });
});

describe("startDateForFreshness (FIX #210 per-class Tavily windows)", () => {
  it("uses a narrow ~7-day window for the 'new' class", () => {
    const startDate = startDateForFreshness("new", "2026-07-15");
    expect(startDate).toBe("2026-07-08");
  });

  it("uses a wide ~180-day window for the 'seasonal' class", () => {
    const startDate = startDateForFreshness("seasonal", "2026-07-15");
    expect(startDate).toBe("2026-01-16");
  });

  it("produces two distinct windows for the same today", () => {
    const newStart = startDateForFreshness("new", "2026-07-15");
    const seasonalStart = startDateForFreshness("seasonal", "2026-07-15");
    expect(newStart).not.toBe(seasonalStart);
    expect(new Date(seasonalStart).getTime()).toBeLessThan(new Date(newStart).getTime());
  });
});

function validAlertItem(overrides: Record<string, unknown> = {}) {
  return {
    alertType: "coverage_gap",
    reason: "No caregiver coverage Friday afternoon",
    affectedDate: "2026-07-10",
    copyPasteText: "Can you cover Friday afternoon?",
    recipientHint: "Nanny",
    ...overrides
  };
}

describe("parseAlertItems (FIX #217 zod validation before DB insert)", () => {
  it("passes through a valid array unchanged", () => {
    const items = parseAlertItems([validAlertItem()]);
    expect(items).toHaveLength(1);
    expect(items[0].reason).toBe("No caregiver coverage Friday afternoon");
  });

  it("accepts a null affectedDate", () => {
    const items = parseAlertItems([validAlertItem({ affectedDate: null })]);
    expect(items[0].affectedDate).toBeNull();
  });

  it("accepts an optional calendarEventPayload with time", () => {
    const items = parseAlertItems([
      validAlertItem({ calendarEventPayload: { title: "Enroll", date: "2026-08-01", description: "Deadline", time: "09:00" } })
    ]);
    expect(items[0].calendarEventPayload?.time).toBe("09:00");
  });

  it("throws on an invalid alertType enum value", () => {
    expect(() => parseAlertItems([validAlertItem({ alertType: "warning" })])).toThrow();
  });

  it("throws on an invalid recipientHint enum value", () => {
    expect(() => parseAlertItems([validAlertItem({ recipientHint: "Grandma" })])).toThrow();
  });

  it("throws on a malformed affectedDate", () => {
    expect(() => parseAlertItems([validAlertItem({ affectedDate: "not-a-date" })])).toThrow();
  });

  it("throws when the whole array isn't an array", () => {
    expect(() => parseAlertItems({ not: "an array" })).toThrow();
  });
});

describe("escapeHtml (FIX #217 digest HTML injection guard)", () => {
  it("escapes angle brackets and ampersands", () => {
    expect(escapeHtml("<script>alert(1)</script> & more")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Example Camp registration opens July 15")).toBe("Example Camp registration opens July 15");
  });
});

describe("getConnectedParents ordering (FIX #217 deterministic Parent A/B)", () => {
  const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
  const OWNER_USER_ID = "20000000-0000-0000-0000-000000000001";
  const COPARENT_USER_ID = "99990000-test-0000-0000-coparent00001";
  const OWNER_INTEGRATION_ID = "99990000-test-0000-0000-oauthint00001";
  const COPARENT_INTEGRATION_ID = "99990000-test-0000-0000-oauthint00002";

  beforeAll(async () => {
    await qExec(
      `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope, force_password_change)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      COPARENT_USER_ID, HOUSEHOLD_ID, "coparent-fix217@example.com", "member", "test-hash", "all", false
    );
    // Insert the later-connected row first, to prove result ordering comes from `connected_at`
    // and not from insertion/row order.
    await qExec(
      `INSERT INTO oauth_integrations (id, provider, household_id, user_id, refresh_token, needs_reauth, connected_at)
       VALUES (?, 'google_calendar', ?, ?, 'fake-refresh-token', FALSE, '2026-02-01T00:00:00Z')
       ON CONFLICT (id) DO NOTHING`,
      COPARENT_INTEGRATION_ID, HOUSEHOLD_ID, COPARENT_USER_ID
    );
    await qExec(
      `INSERT INTO oauth_integrations (id, provider, household_id, user_id, refresh_token, needs_reauth, connected_at)
       VALUES (?, 'google_calendar', ?, ?, 'fake-refresh-token', FALSE, '2026-01-01T00:00:00Z')
       ON CONFLICT (id) DO NOTHING`,
      OWNER_INTEGRATION_ID, HOUSEHOLD_ID, OWNER_USER_ID
    );
  });

  afterAll(async () => {
    await qExec(`DELETE FROM oauth_integrations WHERE id IN (?, ?)`, OWNER_INTEGRATION_ID, COPARENT_INTEGRATION_ID);
    await qExec(`DELETE FROM app_user WHERE id = ?`, COPARENT_USER_ID);
  });

  it("returns the first-connected account first, stable across repeated calls", async () => {
    for (let i = 0; i < 3; i++) {
      const parents = await getConnectedParents(HOUSEHOLD_ID);
      expect(parents).toHaveLength(2);
      expect(parents[0].userId).toBe(OWNER_USER_ID);
      expect(parents[1].userId).toBe(COPARENT_USER_ID);
    }
  });
});

describe("FIX #211 — merged Domain 1+2 correctness and model tiering", () => {
  beforeEach(() => {
    mockComplete.mockReset();
    mockTavilySearch.mockReset();
  });

  const childCtx = () => baseCtx({
    members: [
      { profileId: "m1", fullName: "Kid One", relationship: "child", age: 7, linkedUserId: null, interestsJson: [], notes: null },
    ],
  });

  it("analyzeCoverageAndCoordination: single strong-model call, splits gaps/coordinationNeeds", async () => {
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({
        gaps: [{ alertType: "coverage_gap", reason: "r1", affectedDate: "2026-06-16", copyPasteText: "cp1", recipientHint: "Nanny" }],
        coordinationNeeds: [{ alertType: "conflict", reason: "r2", affectedDate: "2026-06-17", copyPasteText: "cp2", recipientHint: "Spouse" }],
      }),
      usage: {},
    });

    const result = await analyzeCoverageAndCoordination(childCtx(), "manual");

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.calls[0][1].model).toBe("TEST_STRONG_MODEL");
    expect(result.coverageGaps.hasOutput).toBe(true);
    expect(result.coverageGaps.gaps).toHaveLength(1);
    expect(result.nannyCoord.hasOutput).toBe(true);
    expect(result.nannyCoord.items).toHaveLength(1);
  });

  it("analyzeCoverageAndCoordination: prompt includes today and member name (D1 context wiring)", async () => {
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({ gaps: [], coordinationNeeds: [] }),
      usage: {},
    });

    const ctx = baseCtx({
      today: "Monday, June 15, 2026",
      todayIso: "2026-06-15",
      members: [
        { profileId: "m1", fullName: "Kid One", relationship: "child", age: 7, linkedUserId: null, interestsJson: [], notes: null },
      ],
    });

    await analyzeCoverageAndCoordination(ctx, "manual");

    const [messages] = mockComplete.mock.calls[0];
    const userMessage = (messages as { role: string; content: string }[]).find(m => m.role === "user");
    // D1's prompt does not include ctx.location (unlike D3/D4/quick-capture) — only today + member profile.
    expect(userMessage?.content).toContain("Today: Monday, June 15, 2026");
    expect(userMessage?.content).toContain("Kid One");
  });

  it("analyzeCoverageAndCoordination: skips the LLM call entirely with no children and no caregiver", async () => {
    const result = await analyzeCoverageAndCoordination(baseCtx(), "manual");

    expect(mockComplete).not.toHaveBeenCalled();
    expect(result.coverageGaps.hasOutput).toBe(false);
    expect(result.nannyCoord.hasOutput).toBe(false);
  });

  it("runProactiveResearch: query-gen and LLM-only fallback both use the cheap model when Tavily is not configured", async () => {
    mockTavilySearch.mockResolvedValue({ ok: false, code: "not_configured", message: "not configured" });
    mockComplete
      .mockResolvedValueOnce({ content: JSON.stringify({ queries: [{ query: "q1", intent: "i1", freshness: "new" }] }), usage: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ items: [] }), usage: {} });

    await runProactiveResearch(childCtx(), "manual");

    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(mockComplete.mock.calls[0][1].model).toBe("TEST_CHEAP_MODEL");
    expect(mockComplete.mock.calls[1][1].model).toBe("TEST_CHEAP_MODEL");
  });

  it("runProactiveResearch: query-gen cheap, synthesis strong when Tavily returns live results", async () => {
    mockTavilySearch.mockResolvedValue({ ok: true, text: "some search text" });
    mockComplete
      .mockResolvedValueOnce({ content: JSON.stringify({ queries: [{ query: "q1", intent: "i1", freshness: "new" }] }), usage: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ items: [], discarded: [] }), usage: {} });

    await runProactiveResearch(childCtx(), "manual");

    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(mockComplete.mock.calls[0][1].model).toBe("TEST_CHEAP_MODEL");
    expect(mockComplete.mock.calls[1][1].model).toBe("TEST_STRONG_MODEL");
  });

  it("sweepDeadlines: query-gen cheap, triage strong on a non-daily_delta run", async () => {
    mockTavilySearch.mockResolvedValue({ ok: false, code: "not_configured", message: "x" });
    mockComplete
      .mockResolvedValueOnce({ content: JSON.stringify({ queries: ["q1"] }), usage: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ alerts: [] }), usage: {} });

    await sweepDeadlines(childCtx(), "manual");

    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(mockComplete.mock.calls[0][1].model).toBe("TEST_CHEAP_MODEL");
    expect(mockComplete.mock.calls[1][1].model).toBe("TEST_STRONG_MODEL");
  });

  it("sweepDeadlines: skips query-gen on daily_delta runs, triage still strong", async () => {
    mockComplete.mockResolvedValueOnce({ content: JSON.stringify({ alerts: [] }), usage: {} });

    await sweepDeadlines(childCtx(), "daily_delta");

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.calls[0][1].model).toBe("TEST_STRONG_MODEL");
  });

  it("synthesizeDigest: digest composition uses the cheap model", async () => {
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({
        summaryText: "summary",
        parentADigest: { subject: "s", body: "b" },
        parentBDigest: { subject: "s2", body: "b2" },
      }),
      usage: {},
    });

    const emptyDomain: PipelineOutputs = {
      coverageGaps: { hasOutput: false, gaps: [] },
      nannyCoord: { hasOutput: false, items: [] },
      research: { hasOutput: false, items: [] },
      deadlines: { hasOutput: false, alerts: [] },
    };
    const parents: ConnectedParent[] = [
      { userId: "u1", email: "a@example.com", selectedCalendarIds: null, lastSyncedAt: null },
    ];

    const result: AgentAnalysis = await synthesizeDigest(childCtx(), emptyDomain, "manual", parents, "no finance context");

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.calls[0][1].model).toBe("TEST_CHEAP_MODEL");
    expect(result.hasOutput).toBe(true);
  });
});

// #214: parseJsonResponse() (L537) strips code fences before JSON.parse and is used at every LLM
// call site. Driven indirectly through sweepDeadlines's triage call (single mockComplete call on
// a daily_delta run) since parseJsonResponse itself is not exported.
describe("parseJsonResponse robustness (via sweepDeadlines triage, #214)", () => {
  beforeEach(() => {
    mockComplete.mockReset();
    mockTavilySearch.mockReset();
  });

  const childCtx = () => baseCtx({
    members: [
      { profileId: "m1", fullName: "Kid One", relationship: "child", age: 7, linkedUserId: null, interestsJson: [], notes: null },
    ],
  });

  it("parses a plain (unfenced) JSON response", async () => {
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({ alerts: [{ alertType: "deadline_approaching", reason: "r", affectedDate: "2026-06-16", copyPasteText: "cp", recipientHint: "Self" }] }),
      usage: {},
    });

    const result = await sweepDeadlines(childCtx(), "daily_delta");

    expect(result.hasOutput).toBe(true);
    expect(result.alerts).toHaveLength(1);
  });

  it("parses a ```json fenced response", async () => {
    mockComplete.mockResolvedValueOnce({
      content: "```json\n" + JSON.stringify({ alerts: [] }) + "\n```",
      usage: {},
    });

    const result = await sweepDeadlines(childCtx(), "daily_delta");

    expect(result.hasOutput).toBe(false);
    expect(result.alerts).toEqual([]);
  });

  it("degrades gracefully (no throw) on prose-wrapped, non-JSON content", async () => {
    mockComplete.mockResolvedValueOnce({
      content: "Here's the result:\n```json\n{ \"alerts\": [] }\n```\nLet me know if you need anything else.",
      usage: {},
    });

    // The leading/trailing prose means JSON.parse still fails after fence-stripping — this must
    // not throw out of sweepDeadlines, it must degrade to an empty result.
    const result = await sweepDeadlines(childCtx(), "daily_delta");

    expect(result.hasOutput).toBe(false);
    expect(result.alerts).toEqual([]);
  });

  it("degrades gracefully (no throw) on malformed JSON", async () => {
    mockComplete.mockResolvedValueOnce({
      content: "{ this is not valid json",
      usage: {},
    });

    const result = await sweepDeadlines(childCtx(), "daily_delta");

    expect(result.hasOutput).toBe(false);
    expect(result.alerts).toEqual([]);
  });
});

// #214: todayIso was previously computed inline at two call sites via
// now.toLocaleDateString("en-CA", { timeZone }) with no injected clock — the same bug class
// (UTC date drift) a prior review already caught once. Extracted to computeTodayIso() so it can
// be unit-tested directly against a fixed Date instant that straddles the UTC day boundary.
describe("computeTodayIso timezone correctness (#214)", () => {
  it("resolves to the household-local calendar day, not the UTC day, near midnight UTC", () => {
    // 23:30 UTC on June 15 is 18:30 on June 15 in America/Chicago (UTC-5 in June/DST) — same day
    // in both zones, but chosen close enough to the UTC boundary to catch a naive UTC-only bug.
    const instant = new Date("2026-06-15T23:30:00Z");

    expect(computeTodayIso(instant, "America/Chicago")).toBe("2026-06-15");
  });

  it("resolves the day BEFORE the UTC date in a zone behind UTC, just after UTC midnight", () => {
    // 00:30 UTC on June 16 is still 19:30 on June 15 in America/Chicago. A naive
    // `new Date().toISOString().slice(0,10)` (UTC-only) would wrongly report June 16.
    const instant = new Date("2026-06-16T00:30:00Z");

    expect(computeTodayIso(instant, "America/Chicago")).toBe("2026-06-15");
    expect(computeTodayIso(instant, "UTC")).toBe("2026-06-16");
  });

  it("resolves the day AFTER the UTC date in a zone ahead of UTC", () => {
    // 22:30 UTC is already 07:30 the next calendar day in Asia/Kolkata (UTC+5:30).
    const instant = new Date("2026-06-15T22:30:00Z");

    expect(computeTodayIso(instant, "Asia/Kolkata")).toBe("2026-06-16");
  });
});

// #214: runFamilyAgent()'s two early-exit skip paths — pure DB/config branching, no Google
// Calendar API surface, so no googleapis mock is needed. The full mocked-Calendar happy-path
// orchestration test is intentionally NOT covered here — see plan/CHANGE_HISTORY for #214.
describe("runFamilyAgent skip paths (#214)", () => {
  const SKIP_LLM_HOUSEHOLD_ID = "99990000-test-0000-0000-skipllmhh001";
  const SKIP_NOPARENT_HOUSEHOLD_ID = "99990000-test-0000-0000-skipnopar01";

  beforeAll(async () => {
    // writeDigestLog's household_id has a NOT NULL FK to household(id) ON DELETE CASCADE — both
    // skip paths still write a log row before returning, so a real household row is required
    // even though neither test exercises any calendar/LLM data for it.
    await qExec(`INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, SKIP_LLM_HOUSEHOLD_ID, "FIX-214 skip-llm test household");
    await qExec(`INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, SKIP_NOPARENT_HOUSEHOLD_ID, "FIX-214 skip-no-parent test household");
  });

  afterAll(async () => {
    await qExec(`DELETE FROM household WHERE id IN (?, ?)`, SKIP_LLM_HOUSEHOLD_ID, SKIP_NOPARENT_HOUSEHOLD_ID);
  });

  beforeEach(() => {
    mockComplete.mockReset();
    mockIsLlmConfigured.mockReturnValue(true);
  });

  it("skips with status 'skipped' when the LLM is not configured", async () => {
    mockIsLlmConfigured.mockReturnValue(false);

    const result = await runFamilyAgent(SKIP_LLM_HOUSEHOLD_ID, "manual");

    expect(result.status).toBe("skipped");
    expect(result.message).toBe("LLM not configured");
    expect(result.alertsCreated).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("skips with status 'skipped' when the household has no connected parent calendars", async () => {
    // getConnectedParents() reads oauth_integrations for this household id — a freshly-created
    // household with no rows there naturally hits the "no connected parents" gate.
    const result = await runFamilyAgent(SKIP_NOPARENT_HOUSEHOLD_ID, "manual");

    expect(result.status).toBe("skipped");
    expect(result.message).toBe("No connected calendars");
    expect(result.alertsCreated).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("FIX #213 — quick-capture context injection", () => {
  const WITH_CONTEXT_HOUSEHOLD_ID = "99990000-test-0000-0000-capturehh0001";
  const EMPTY_HOUSEHOLD_ID = "99990000-test-0000-0000-capturehh0002";
  const CHILD_PROFILE_ID = "99990000-test-0000-0000-captureprof01";
  const NANNY_PROFILE_ID = "99990000-test-0000-0000-captureprof02";
  const MEMBERSHIP_ID = "99990000-test-0000-0000-capturemem001";
  const AVAILABILITY_ID = "99990000-test-0000-0000-captureavl001";

  beforeAll(async () => {
    await qExec(
      `INSERT INTO household (id, name, city, state) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      WITH_CONTEXT_HOUSEHOLD_ID, "FIX-213 Test Household", "Example City", "TX"
    );
    await qExec(
      `INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
      EMPTY_HOUSEHOLD_ID, "FIX-213 Empty Test Household"
    );
    await qExec(
      `INSERT INTO person_profile (id, household_id, full_name, age) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      CHILD_PROFILE_ID, WITH_CONTEXT_HOUSEHOLD_ID, "Test Kid", 7
    );
    await qExec(
      `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship) VALUES (?, ?, ?, 'member', 'child') ON CONFLICT (id) DO NOTHING`,
      MEMBERSHIP_ID, WITH_CONTEXT_HOUSEHOLD_ID, CHILD_PROFILE_ID
    );
    await qExec(
      `INSERT INTO person_profile (id, household_id, full_name) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      NANNY_PROFILE_ID, WITH_CONTEXT_HOUSEHOLD_ID, "Test Nanny"
    );
    await qExec(
      `INSERT INTO household_help_availability
         (id, household_id, person_profile_id, slot_type, service_type, days_of_week, start_time, end_time, is_active)
       VALUES (?, ?, ?, 'regular', 'nanny', '1,3,5', '08:00', '16:00', TRUE)
       ON CONFLICT (id) DO NOTHING`,
      AVAILABILITY_ID, WITH_CONTEXT_HOUSEHOLD_ID, NANNY_PROFILE_ID
    );
  });

  afterAll(async () => {
    await qExec(`DELETE FROM household_help_availability WHERE id = ?`, AVAILABILITY_ID);
    await qExec(`DELETE FROM household_membership WHERE id = ?`, MEMBERSHIP_ID);
    await qExec(`DELETE FROM person_profile WHERE id IN (?, ?)`, CHILD_PROFILE_ID, NANNY_PROFILE_ID);
    await qExec(`DELETE FROM household WHERE id IN (?, ?)`, WITH_CONTEXT_HOUSEHOLD_ID, EMPTY_HOUSEHOLD_ID);
  });

  beforeEach(() => {
    mockRunToolLoop.mockReset();
  });

  it("buildCaptureContextHeader: includes today, location, members, and caregivers when configured", async () => {
    const header = await buildCaptureContextHeader(WITH_CONTEXT_HOUSEHOLD_ID);

    expect(header).toMatch(/^Today: \w+, \w+ \d{1,2}, \d{4} \(\d{4}-\d{2}-\d{2}\)\.$/m);
    expect(header).toContain("Location: Example City, TX.");
    expect(header).toContain("Test Kid (child, age 7)");
    expect(header).toContain("Test Nanny [nanny]");
    expect(header).toContain("every Mon/Wed/Fri");
    expect(header).toContain("08:00–16:00");
  });

  it("buildCaptureContextHeader: omits location/household/caregiver sections cleanly when nothing is configured", async () => {
    const header = await buildCaptureContextHeader(EMPTY_HOUSEHOLD_ID);

    expect(header).toMatch(/^Today: /);
    expect(header).not.toContain("Location:");
    expect(header).not.toContain("Household:");
    expect(header).not.toContain("Caregivers:");
  });

  it("processCaptureNote: the resolved concrete today's date reaches the LLM prompt content", async () => {
    mockRunToolLoop.mockResolvedValueOnce({
      finalResponse: JSON.stringify({ acknowledgement: "Got it", actions: [] }),
    });

    await processCaptureNote("remind me tomorrow at 8am to pack swim gear", WITH_CONTEXT_HOUSEHOLD_ID);

    expect(mockRunToolLoop).toHaveBeenCalledTimes(1);
    const [messages, , , options] = mockRunToolLoop.mock.calls[0];
    const userMessage = messages.find(m => m.role === "user")!;
    expect(userMessage.content).toMatch(/Today: \w+, \w+ \d{1,2}, \d{4} \(\d{4}-\d{2}-\d{2}\)\./);
    expect(userMessage.content).toContain("Test Kid (child, age 7)");
    expect(userMessage.content).toContain("Test Nanny [nanny]");
    expect(userMessage.content).toContain("remind me tomorrow at 8am to pack swim gear");
    expect(options.model).toBe("TEST_STRONG_MODEL");
  });
});

describe("FIX #208 — alert feedback loop (disposition capture + calibration)", () => {
  const CAL_HOUSEHOLD_ID = "99990000-test-0000-0000-calhousehold1";
  const CAL_USER_ID = "99990000-test-0000-0000-caluser000001";

  beforeAll(async () => {
    await qExec(
      `INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
      CAL_HOUSEHOLD_ID, "FIX-208 Test Household"
    );
    await qExec(
      `INSERT INTO app_user (id, household_id, email, role, password_hash, visibility_scope)
       VALUES (?, ?, ?, 'owner', 'x', 'own') ON CONFLICT (id) DO NOTHING`,
      CAL_USER_ID, CAL_HOUSEHOLD_ID, "fix208@example.com"
    );
  });

  afterAll(async () => {
    await qExec(`DELETE FROM family_agent_alerts WHERE household_id = ?`, CAL_HOUSEHOLD_ID);
    await qExec(`DELETE FROM app_user WHERE id = ?`, CAL_USER_ID);
    await qExec(`DELETE FROM household WHERE id = ?`, CAL_HOUSEHOLD_ID);
  });

  beforeEach(() => {
    mockComplete.mockReset();
    mockTavilySearch.mockReset();
  });

  it("resolveAlert: persists the disposition and resolved_by_user_id", async () => {
    const alertId = "99990000-test-0000-0000-calalert00001";
    await qExec(
      `INSERT INTO family_agent_alerts (id, household_id, alert_type, reason) VALUES (?, ?, 'suggestion', '[RESTAURANT] Example Bistro')`,
      alertId, CAL_HOUSEHOLD_ID
    );

    const ok = await resolveAlert(alertId, CAL_HOUSEHOLD_ID, CAL_USER_ID, "not_relevant");

    expect(ok).toBe(true);
    const row = await qGet<{ resolution_kind: string | null; resolved_by_user_id: string | null; is_resolved: boolean }>(
      `SELECT resolution_kind, resolved_by_user_id, is_resolved FROM family_agent_alerts WHERE id = ?`,
      alertId
    );
    expect(row?.resolution_kind).toBe("not_relevant");
    expect(row?.resolved_by_user_id).toBe(CAL_USER_ID);
    expect(row?.is_resolved).toBe(true);
  });

  it("resolveAlert: defaults to a neutral (null) disposition when none is given", async () => {
    const alertId = "99990000-test-0000-0000-calalert00002";
    await qExec(
      `INSERT INTO family_agent_alerts (id, household_id, alert_type, reason) VALUES (?, ?, 'deadline_approaching', 'some deadline')`,
      alertId, CAL_HOUSEHOLD_ID
    );

    await resolveAlert(alertId, CAL_HOUSEHOLD_ID, CAL_USER_ID);

    const row = await qGet<{ resolution_kind: string | null }>(
      `SELECT resolution_kind FROM family_agent_alerts WHERE id = ?`,
      alertId
    );
    expect(row?.resolution_kind).toBeNull();
  });

  it("buildCalibrationBlock: aggregates by bracket-tag category for suggestions, instructs avoidance at the 3x not_relevant threshold", async () => {
    const insertResolved = async (id: string, alertType: string, reason: string, kind: string) => {
      await qExec(
        `INSERT INTO family_agent_alerts (id, household_id, alert_type, reason, is_resolved, resolved_at, resolution_kind)
         VALUES (?, ?, ?, ?, TRUE, NOW(), ?)`,
        id, CAL_HOUSEHOLD_ID, alertType, reason, kind
      );
    };
    await insertResolved("99990000-test-0000-0000-calblock00001", "suggestion", "[RESTAURANT] Place A", "not_relevant");
    await insertResolved("99990000-test-0000-0000-calblock00002", "suggestion", "[RESTAURANT] Place B", "not_relevant");
    await insertResolved("99990000-test-0000-0000-calblock00003", "suggestion", "[RESTAURANT] Place C", "not_relevant");
    await insertResolved("99990000-test-0000-0000-calblock00004", "deadline_approaching", "school form due", "useful");
    await insertResolved("99990000-test-0000-0000-calblock00005", "deadline_approaching", "permission slip due", "useful");

    const block = await buildCalibrationBlock(CAL_HOUSEHOLD_ID);

    expect(block).toContain("restaurant");
    expect(block).toContain("Do NOT generate suggestions in these categories: restaurant");
    expect(block).toContain("deadline_approaching");
    expect(block).toMatch(/Keep prioritizing.*deadline_approaching \(2x useful\)/);
  });

  it("buildCalibrationBlock: returns empty string for a household with no dispositions", async () => {
    const block = await buildCalibrationBlock("99990000-test-0000-0000-nohistoryhh1");
    expect(block).toBe("");
  });

  it("runProactiveResearch: calibration block reaches the query-gen prompt", async () => {
    mockComplete
      .mockResolvedValueOnce({ content: JSON.stringify({ queries: [{ query: "q1", intent: "i1", freshness: "new" }] }), usage: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ items: [] }), usage: {} });
    mockTavilySearch.mockResolvedValue({ ok: false, code: "not_configured", message: "not configured" });

    const ctx = baseCtx({ calibrationBlock: "Do NOT generate suggestions in these categories: restaurant." });

    await runProactiveResearch(ctx, "manual");

    const [messages] = mockComplete.mock.calls[0];
    const userMessage = (messages as { role: string; content: string }[]).find(m => m.role === "user")!;
    expect(userMessage.content).toContain("Do NOT generate suggestions in these categories: restaurant.");
  });

  it("synthesizeDigest: calibration block reaches the digest composition prompt", async () => {
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({
        summaryText: "summary",
        parentADigest: { subject: "s", body: "b" },
        parentBDigest: { subject: "s2", body: "b2" },
      }),
      usage: {},
    });

    const emptyDomain: PipelineOutputs = {
      coverageGaps: { hasOutput: false, gaps: [] },
      nannyCoord: { hasOutput: false, items: [] },
      research: { hasOutput: false, items: [] },
      deadlines: { hasOutput: false, alerts: [] },
    };
    const parents: ConnectedParent[] = [
      { userId: "u1", email: "a@example.com", selectedCalendarIds: null, lastSyncedAt: null },
    ];
    const ctx = baseCtx({ calibrationBlock: "Deprioritize/avoid: restaurant (3x not relevant)." });

    await synthesizeDigest(ctx, emptyDomain, "manual", parents, "no finance context");

    const [messages] = mockComplete.mock.calls[0];
    const userMessage = (messages as { role: string; content: string }[]).find(m => m.role === "user")!;
    expect(userMessage.content).toContain("Deprioritize/avoid: restaurant (3x not relevant).");
  });
});
