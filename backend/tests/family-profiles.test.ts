import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { qExec } from "../src/db/query.js";
import {
  createAvailability,
  deleteAvailability,
  listAvailability,
  listHouseholdMembers,
  updateAvailability,
  updateMemberProfile,
} from "../src/modules/family/family-profiles.service.js";

const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const TEST_PROFILE_ID = "99990000-test-0000-0000-family-profile1";
const TEST_PROFILE_ID_2 = "99990000-test-0000-0000-family-profile2";

beforeAll(async () => {
  await qExec(
    `INSERT INTO person_profile (id, household_id, full_name, interests_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    TEST_PROFILE_ID, HOUSEHOLD_ID, "Test Nanny", "[]"
  );
  await qExec(
    `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (household_id, person_profile_id) DO NOTHING`,
    "99990000-test-0000-0000-membership001", HOUSEHOLD_ID, TEST_PROFILE_ID, "member", "other"
  );
  await qExec(
    `INSERT INTO person_profile (id, household_id, full_name, interests_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    TEST_PROFILE_ID_2, HOUSEHOLD_ID, "Test Child", "[]"
  );
  await qExec(
    `INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (household_id, person_profile_id) DO NOTHING`,
    "99990000-test-0000-0000-membership002", HOUSEHOLD_ID, TEST_PROFILE_ID_2, "member", "child"
  );
});

afterAll(async () => {
  await qExec(`DELETE FROM household_help_availability WHERE household_id = ? AND person_profile_id IN (?, ?)`, HOUSEHOLD_ID, TEST_PROFILE_ID, TEST_PROFILE_ID_2);
  await qExec(`DELETE FROM household_membership WHERE id IN (?, ?)`, "99990000-test-0000-0000-membership001", "99990000-test-0000-0000-membership002");
  await qExec(`DELETE FROM person_profile WHERE id IN (?, ?)`, TEST_PROFILE_ID, TEST_PROFILE_ID_2);
});

describe("listHouseholdMembers", () => {
  it("returns test members with default empty interests", async () => {
    const members = await listHouseholdMembers(HOUSEHOLD_ID);
    const nanny = members.find(m => m.profileId === TEST_PROFILE_ID);
    expect(nanny).toBeDefined();
    expect(nanny!.fullName).toBe("Test Nanny");
    expect(nanny!.relationship).toBe("other");
    expect(nanny!.interestsJson).toEqual([]);
    expect(nanny!.notes).toBeNull();
  });

  it("returns empty for unknown household", async () => {
    const members = await listHouseholdMembers("00000000-0000-0000-0000-000000000000");
    expect(members).toHaveLength(0);
  });
});

describe("updateMemberProfile", () => {
  it("updates interests_json and notes", async () => {
    const updated = await updateMemberProfile(TEST_PROFILE_ID, HOUSEHOLD_ID, {
      interestsJson: ["cooking", "gardening"],
      notes: "Comes Monday through Friday",
    });
    expect(updated).not.toBeNull();
    expect(updated!.interestsJson).toEqual(["cooking", "gardening"]);
    expect(updated!.notes).toBe("Comes Monday through Friday");
  });

  it("clears notes when set to null", async () => {
    await updateMemberProfile(TEST_PROFILE_ID, HOUSEHOLD_ID, { notes: null });
    const updated = await updateMemberProfile(TEST_PROFILE_ID, HOUSEHOLD_ID, {});
    expect(updated!.notes).toBeNull();
  });

  it("returns null for profile not in household", async () => {
    const result = await updateMemberProfile(TEST_PROFILE_ID, "00000000-0000-0000-0000-000000000000", {
      notes: "should not save",
    });
    expect(result).toBeNull();
  });
});

describe("availability CRUD", () => {
  let slotId: string;

  it("creates a regular slot", async () => {
    const slot = await createAvailability(HOUSEHOLD_ID, {
      personProfileId: TEST_PROFILE_ID,
      slotType: "regular",
      serviceType: "nanny",
      daysOfWeek: [1],
      startTime: "08:00",
      endTime: "18:00",
      label: "Monday regular hours",
    });
    expect(slot.id).toBeTruthy();
    expect(slot.slotType).toBe("regular");
    expect(slot.serviceType).toBe("nanny");
    expect(slot.daysOfWeek).toEqual([1]);
    expect(slot.startTime).toBe("08:00");
    expect(slot.personName).toBe("Test Nanny");
    expect(slot.isActive).toBe(true);
    slotId = slot.id;
  });

  it("lists active slots only by default", async () => {
    const slots = await listAvailability(HOUSEHOLD_ID);
    const found = slots.find(s => s.id === slotId);
    expect(found).toBeDefined();
  });

  it("updates slot label and times", async () => {
    const updated = await updateAvailability(slotId, HOUSEHOLD_ID, {
      endTime: "17:00",
      label: "Monday regular hours (updated)",
    });
    expect(updated).not.toBeNull();
    expect(updated!.endTime).toBe("17:00");
    expect(updated!.label).toBe("Monday regular hours (updated)");
  });

  it("deactivates a slot via isActive=false", async () => {
    await updateAvailability(slotId, HOUSEHOLD_ID, { isActive: false });
    const activeOnly = await listAvailability(HOUSEHOLD_ID, false);
    expect(activeOnly.find(s => s.id === slotId)).toBeUndefined();
    const all = await listAvailability(HOUSEHOLD_ID, true);
    expect(all.find(s => s.id === slotId)).toBeDefined();
  });

  it("deletes a slot", async () => {
    const deleted = await deleteAvailability(slotId, HOUSEHOLD_ID);
    expect(deleted).toBe(true);
  });

  it("returns false when deleting non-existent slot", async () => {
    const result = await deleteAvailability("00000000-0000-0000-0000-000000000000", HOUSEHOLD_ID);
    expect(result).toBe(false);
  });

  it("creates a one_off slot with specific_date", async () => {
    const slot = await createAvailability(HOUSEHOLD_ID, {
      personProfileId: TEST_PROFILE_ID,
      slotType: "one_off",
      serviceType: "babysitter",
      specificDate: "2026-07-04",
      startTime: "09:00",
      endTime: "20:00",
      label: "Holiday coverage",
    });
    expect(slot.slotType).toBe("one_off");
    expect(slot.specificDate).toBe("2026-07-04");
    expect(slot.daysOfWeek).toEqual([]);
    await deleteAvailability(slot.id, HOUSEHOLD_ID);
  });
});
