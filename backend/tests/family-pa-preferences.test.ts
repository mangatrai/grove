import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { qExec } from "../src/db/query.js";
import {
  createPreference,
  deletePreference,
  listPreferences,
} from "../src/modules/family/family-profiles.service.js";

const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";

afterAll(async () => {
  await qExec(`DELETE FROM household_pa_preferences WHERE household_id = ?`, HOUSEHOLD_ID);
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
