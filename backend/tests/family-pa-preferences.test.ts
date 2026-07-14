import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { qExec } from "../src/db/query.js";

type CompleteFn = (
  messages: { role: string; content: string }[],
  options: { model: string; maxTokens: number }
) => Promise<{ content: string; usage: Record<string, never> }>;

const { mockComplete } = vi.hoisted(() => ({
  mockComplete: vi.fn<CompleteFn>(),
}));

vi.mock("../src/llm/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/index.js")>();
  return {
    ...actual,
    chatModel: () => "TEST_CHEAP_MODEL",
    getChatAdapter: () => ({ complete: mockComplete }),
  };
});

import { buildApp } from "../src/app.js";
import {
  classifyPreferenceText,
  createPreference,
  deletePreference,
  listPreferences,
  searchMemory,
  suggestPreferencesFromNotes,
} from "../src/modules/family/family-profiles.service.js";

const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const NOTES_PROFILE_1 = "99990000-test-0000-0000-notesprofile1";
const NOTES_PROFILE_2 = "99990000-test-0000-0000-notesprofile2";
const MEMBERSHIP_1 = "99990000-test-0000-0000-notesmember01";
const MEMBERSHIP_2 = "99990000-test-0000-0000-notesmember02";

const app = buildApp();

async function ownerToken(): Promise<string> {
  const login = await request(app).post("/auth/login").send({
    email: "owner@example.com",
    password: "ChangeMe123!",
  });
  expect(login.status).toBe(200);
  return login.body.token as string;
}

afterAll(async () => {
  await qExec(`DELETE FROM household_pa_preferences WHERE household_id = ?`, HOUSEHOLD_ID);
  await qExec(`DELETE FROM household_membership WHERE id IN (?, ?)`, MEMBERSHIP_1, MEMBERSHIP_2);
  await qExec(`DELETE FROM person_profile WHERE id IN (?, ?)`, NOTES_PROFILE_1, NOTES_PROFILE_2);
});

beforeEach(() => {
  mockComplete.mockReset();
});

describe("PA preferences CRUD", () => {
  it("creates a preference row", async () => {
    const pref = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "No Schengen transit — visa risk for H1B holders",
    });
    expect(pref.id).toBeTruthy();
    expect(pref.category).toBe("preference");
    expect(pref.source).toBe("manual");
    await deletePreference(pref.id, HOUSEHOLD_ID);
  });

  it("defaults source to 'manual' when omitted, honors explicit source", async () => {
    const manual = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "Fact A",
    });
    const feedback = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "Fact B",
      source: "feedback",
    });
    expect(manual.source).toBe("manual");
    expect(feedback.source).toBe("feedback");
    await deletePreference(manual.id, HOUSEHOLD_ID);
    await deletePreference(feedback.id, HOUSEHOLD_ID);
  });

  it("lists preferences filtered by category", async () => {
    const pref = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "Fact C",
    });
    const discovered = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Fact D",
      topicTag: "other",
    });

    const preferences = await listPreferences(HOUSEHOLD_ID, "preference");
    expect(preferences.find(p => p.id === pref.id)).toBeDefined();
    expect(preferences.find(p => p.id === discovered.id)).toBeUndefined();

    const all = await listPreferences(HOUSEHOLD_ID);
    expect(all.find(p => p.id === pref.id)).toBeDefined();
    expect(all.find(p => p.id === discovered.id)).toBeDefined();

    await deletePreference(pref.id, HOUSEHOLD_ID);
    await deletePreference(discovered.id, HOUSEHOLD_ID);
  });

  it("dedups near-exact text (case/whitespace-insensitive) by updating in place", async () => {
    const first = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "Prefers aisle seats on flights",
    });
    const second = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "  prefers   AISLE seats on flights  ",
    });

    expect(second.id).toBe(first.id);
    expect(second.factText).toBe("  prefers   AISLE seats on flights  ");

    const all = await listPreferences(HOUSEHOLD_ID, "preference");
    expect(all.filter(p => p.id === first.id)).toHaveLength(1);

    await deletePreference(first.id, HOUSEHOLD_ID);
  });

  it("does not dedup across different categories", async () => {
    const pref = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "Shared text",
    });
    const fact = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Shared text",
      topicTag: "other",
    });
    expect(fact.id).not.toBe(pref.id);

    await deletePreference(pref.id, HOUSEHOLD_ID);
    await deletePreference(fact.id, HOUSEHOLD_ID);
  });

  it("deletes a preference", async () => {
    const pref = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "Temporary fact",
    });
    const deleted = await deletePreference(pref.id, HOUSEHOLD_ID);
    expect(deleted).toBe(true);

    const all = await listPreferences(HOUSEHOLD_ID, "preference");
    expect(all.find(p => p.id === pref.id)).toBeUndefined();
  });

  it("returns false when deleting a non-existent preference", async () => {
    const result = await deletePreference(999999999, HOUSEHOLD_ID);
    expect(result).toBe(false);
  });

  it("scopes delete to the owning household", async () => {
    const pref = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "Household-scoped fact",
    });
    const deleted = await deletePreference(pref.id, "00000000-0000-0000-0000-000000000000");
    expect(deleted).toBe(false);

    await deletePreference(pref.id, HOUSEHOLD_ID);
  });
});

describe("PA preferences topic_tag (#238)", () => {
  it("stores topicTag for discovered_fact/decision_history categories", async () => {
    const fact = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Kids attend Lincoln Elementary",
      topicTag: "school",
    });
    expect(fact.topicTag).toBe("school");
    await deletePreference(fact.id, HOUSEHOLD_ID);
  });

  it("accepts an optional topicTag on category=preference rows for browsability (#239)", async () => {
    const pref = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "Always book direct flights",
      topicTag: "travel",
    });
    expect(pref.topicTag).toBe("travel");
    await deletePreference(pref.id, HOUSEHOLD_ID);
  });

  it("leaves topicTag null for category=preference when none is passed in", async () => {
    const pref = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "Always book direct flights, no topic given",
    });
    expect(pref.topicTag).toBeNull();
    await deletePreference(pref.id, HOUSEHOLD_ID);
  });

  it("accepts the food and interests topic tags (#239)", async () => {
    const food = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Favorite cuisines are Indian, Thai, and Italian",
      topicTag: "food",
    });
    expect(food.topicTag).toBe("food");
    const interests = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Enjoys hiking and live music",
      topicTag: "interests",
    });
    expect(interests.topicTag).toBe("interests");
    await deletePreference(food.id, HOUSEHOLD_ID);
    await deletePreference(interests.id, HOUSEHOLD_ID);
  });
});

describe("searchMemory (#238)", () => {
  it("returns only discovered_fact/decision_history rows matching the topic, newest first", async () => {
    const travelFact = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Family flew United for last 3 trips",
      topicTag: "travel",
    });
    const travelDecision = await createPreference(HOUSEHOLD_ID, {
      category: "decision_history",
      factText: "Chose window seats over aisle for the 2026 trip",
      topicTag: "travel",
    });
    const healthFact = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Annual checkup is every March",
      topicTag: "health",
    });
    const travelPreference = await createPreference(HOUSEHOLD_ID, {
      category: "preference",
      factText: "No layovers over 4 hours",
    });

    const results = await searchMemory(HOUSEHOLD_ID, "travel");
    const ids = results.map(r => r.id);
    expect(ids).toContain(travelFact.id);
    expect(ids).toContain(travelDecision.id);
    expect(ids).not.toContain(healthFact.id);
    expect(ids).not.toContain(travelPreference.id);
    expect(results[0].id).toBe(travelDecision.id);

    await deletePreference(travelFact.id, HOUSEHOLD_ID);
    await deletePreference(travelDecision.id, HOUSEHOLD_ID);
    await deletePreference(healthFact.id, HOUSEHOLD_ID);
    await deletePreference(travelPreference.id, HOUSEHOLD_ID);
  });

  it("returns [] when no rows match the topic", async () => {
    const results = await searchMemory(HOUSEHOLD_ID, "gifts");
    expect(results).toEqual([]);
  });
});

describe("suggestPreferencesFromNotes (#238)", () => {
  beforeAll(async () => {
    await qExec(
      `INSERT INTO person_profile (id, household_id, full_name, notes)
       VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      NOTES_PROFILE_1, HOUSEHOLD_ID, "Notes Test Parent", "Prefers aisle seats; allergic to peanuts."
    );
    await qExec(
      `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT (household_id, person_profile_id) DO NOTHING`,
      MEMBERSHIP_1, HOUSEHOLD_ID, NOTES_PROFILE_1, "member", "self"
    );
    await qExec(
      `INSERT INTO person_profile (id, household_id, full_name, notes)
       VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      NOTES_PROFILE_2, HOUSEHOLD_ID, "Notes Test Child", null
    );
    await qExec(
      `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT (household_id, person_profile_id) DO NOTHING`,
      MEMBERSHIP_2, HOUSEHOLD_ID, NOTES_PROFILE_2, "member", "child"
    );
  });

  it("returns [] without calling the LLM when the household has no members with notes", async () => {
    const result = await suggestPreferencesFromNotes("00000000-0000-0000-0000-00000000e238");
    expect(result).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("filters out candidates that already match an existing row, keeps topicTag on preference candidates (#239)", async () => {
    const existing = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Allergic to peanuts",
      topicTag: "health",
    });

    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({
        candidates: [
          { personName: "Notes Test Parent", category: "discovered_fact", factText: "allergic  TO Peanuts", topicTag: "health" },
          { personName: "Notes Test Parent", category: "discovered_fact", factText: "Enjoys hiking", topicTag: "other" },
          { personName: "Notes Test Parent", category: "preference", factText: "No red-eye flights", topicTag: "travel" },
        ],
      }),
      usage: {},
    });

    const candidates = await suggestPreferencesFromNotes(HOUSEHOLD_ID);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.calls[0][1].model).toBe("TEST_CHEAP_MODEL");

    expect(candidates.find(c => c.factText.toLowerCase().includes("peanuts"))).toBeUndefined();

    const hiking = candidates.find(c => c.factText === "Enjoys hiking");
    expect(hiking).toBeDefined();
    expect(hiking!.topicTag).toBe("other");

    const redEye = candidates.find(c => c.factText === "No red-eye flights");
    expect(redEye).toBeDefined();
    expect(redEye!.category).toBe("preference");
    expect(redEye!.topicTag).toBe("travel");

    await deletePreference(existing.id, HOUSEHOLD_ID);
  });

  it("returns [] without throwing on malformed LLM JSON", async () => {
    mockComplete.mockResolvedValueOnce({ content: "not json {{{", usage: {} });
    const candidates = await suggestPreferencesFromNotes(HOUSEHOLD_ID);
    expect(candidates).toEqual([]);
  });

  it("skips only the malformed candidate instead of discarding the whole batch (#239 live-testing regression)", async () => {
    // A real Anthropic call once returned a topic word ("school") in the category field for one
    // candidate — the old whole-array z.array().safeParse() discarded every candidate in the
    // response because of that single bad item. Candidates are now validated one at a time.
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({
        candidates: [
          { personName: "Notes Test Parent", category: "school", factText: "Bad category value", topicTag: "school" },
          { personName: "Notes Test Parent", category: "discovered_fact", factText: "Enjoys hiking and live music", topicTag: "interests" },
        ],
      }),
      usage: {},
    });

    const candidates = await suggestPreferencesFromNotes(HOUSEHOLD_ID);
    expect(candidates.find((c) => c.factText === "Bad category value")).toBeUndefined();
    const good = candidates.find((c) => c.factText === "Enjoys hiking and live music");
    expect(good).toBeDefined();
    expect(good!.topicTag).toBe("interests");
  });
});

describe("classifyPreferenceText (#238)", () => {
  it("pins the travel-tag pass-through regression (#239): an explicit travel mention isn't stripped to other", async () => {
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({ category: "discovered_fact", topicTag: "travel" }),
      usage: {},
    });
    const result = await classifyPreferenceText("Likes music, movies, and travel");
    expect(result).toEqual({ category: "discovered_fact", topicTag: "travel" });
  });

  it("returns the LLM's category/topicTag classification", async () => {
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({ category: "discovered_fact", topicTag: "gifts" }),
      usage: {},
    });
    const result = await classifyPreferenceText("Kids loved the LEGO set last Christmas");
    expect(result).toEqual({ category: "discovered_fact", topicTag: "gifts" });
    expect(mockComplete.mock.calls[0][1].model).toBe("TEST_CHEAP_MODEL");
  });

  it("keeps topicTag when the LLM classifies as preference (#239: optional, not forbidden)", async () => {
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({ category: "preference", topicTag: "travel" }),
      usage: {},
    });
    const result = await classifyPreferenceText("Never book connecting flights under 60 minutes");
    expect(result).toEqual({ category: "preference", topicTag: "travel" });
  });

  it("defaults to discovered_fact/other on malformed LLM output", async () => {
    mockComplete.mockResolvedValueOnce({ content: "not json", usage: {} });
    const result = await classifyPreferenceText("Some ad-hoc note");
    expect(result).toEqual({ category: "discovered_fact", topicTag: "other" });
  });
});

describe("POST /api/family/pa-preferences — topicTag validation (#238)", () => {
  it("rejects discovered_fact without a topicTag", async () => {
    const token = await ownerToken();
    const res = await request(app)
      .post("/api/family/pa-preferences")
      .set("authorization", `Bearer ${token}`)
      .send({ category: "discovered_fact", factText: "Missing topic tag" });
    expect(res.status).toBe(400);
  });

  it("accepts category=preference with an optional topicTag set (#239)", async () => {
    const token = await ownerToken();
    const res = await request(app)
      .post("/api/family/pa-preferences")
      .set("authorization", `Bearer ${token}`)
      .send({ category: "preference", factText: "May have a topic tag now", topicTag: "travel" });
    expect(res.status).toBe(201);
    expect(res.body.preference.topicTag).toBe("travel");
    await deletePreference(res.body.preference.id, HOUSEHOLD_ID);
  });

  it("accepts discovered_fact with a valid topicTag", async () => {
    const token = await ownerToken();
    const res = await request(app)
      .post("/api/family/pa-preferences")
      .set("authorization", `Bearer ${token}`)
      .send({ category: "discovered_fact", factText: "Route-level fact", topicTag: "household" });
    expect(res.status).toBe(201);
    expect(res.body.preference.topicTag).toBe("household");
    await deletePreference(res.body.preference.id, HOUSEHOLD_ID);
  });
});

describe("POST /api/family/pa-preferences/classify (#238)", () => {
  it("returns a classification for the given factText", async () => {
    const token = await ownerToken();
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({ category: "decision_history", topicTag: "finance" }),
      usage: {},
    });
    const res = await request(app)
      .post("/api/family/pa-preferences/classify")
      .set("authorization", `Bearer ${token}`)
      .send({ factText: "Chose the 15-year mortgage over the 30-year" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ category: "decision_history", topicTag: "finance" });
  });

  it("rejects empty factText", async () => {
    const token = await ownerToken();
    const res = await request(app)
      .post("/api/family/pa-preferences/classify")
      .set("authorization", `Bearer ${token}`)
      .send({ factText: "" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/family/pa-preferences/suggest (#238)", () => {
  it("returns unpersisted candidates from household notes", async () => {
    const token = await ownerToken();
    mockComplete.mockResolvedValueOnce({
      content: JSON.stringify({
        candidates: [
          { personName: "Notes Test Parent", category: "discovered_fact", factText: "Route-level suggestion", topicTag: "other" },
        ],
      }),
      usage: {},
    });
    const res = await request(app)
      .post("/api/family/pa-preferences/suggest")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([
      { personName: "Notes Test Parent", category: "discovered_fact", factText: "Route-level suggestion", topicTag: "other" },
    ]);

    const stillUnpersisted = await listPreferences(HOUSEHOLD_ID, "discovered_fact");
    expect(stillUnpersisted.find(p => p.factText === "Route-level suggestion")).toBeUndefined();
  });
});

describe("PATCH /api/family/pa-preferences/:id (#239)", () => {
  it("updates an existing row's category/factText/topicTag", async () => {
    const token = await ownerToken();
    const created = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Original wording",
      topicTag: "other",
    });

    const res = await request(app)
      .patch(`/api/family/pa-preferences/${created.id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ category: "discovered_fact", factText: "Corrected wording", topicTag: "food" });
    expect(res.status).toBe(200);
    expect(res.body.preference).toMatchObject({
      id: created.id,
      category: "discovered_fact",
      factText: "Corrected wording",
      topicTag: "food",
    });

    await deletePreference(created.id, HOUSEHOLD_ID);
  });

  it("returns 404 for an id that doesn't exist in this household", async () => {
    const token = await ownerToken();
    const res = await request(app)
      .patch("/api/family/pa-preferences/999999999")
      .set("authorization", `Bearer ${token}`)
      .send({ category: "discovered_fact", factText: "Doesn't matter", topicTag: "food" });
    expect(res.status).toBe(404);
  });

  it("400s on the same validation rules as create (topicTag required for discovered_fact)", async () => {
    const token = await ownerToken();
    const created = await createPreference(HOUSEHOLD_ID, {
      category: "discovered_fact",
      factText: "Row to patch invalidly",
      topicTag: "other",
    });

    const res = await request(app)
      .patch(`/api/family/pa-preferences/${created.id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ category: "discovered_fact", factText: "Missing topic tag now" });
    expect(res.status).toBe(400);

    await deletePreference(created.id, HOUSEHOLD_ID);
  });

  it("400s on a non-integer id", async () => {
    const token = await ownerToken();
    const res = await request(app)
      .patch("/api/family/pa-preferences/not-a-number")
      .set("authorization", `Bearer ${token}`)
      .send({ category: "discovered_fact", factText: "Irrelevant", topicTag: "food" });
    expect(res.status).toBe(400);
  });
});
