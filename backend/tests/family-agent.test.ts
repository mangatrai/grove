import { describe, expect, it } from "vitest";

import { buildDayGrid, type CalendarEvent, type FamilyContext } from "../src/modules/family/family-agent.service.js";
import { heuristicCalendarRole } from "../src/modules/gcal/gcal.service.js";
import type { FamilyEvent, HelpAvailabilitySlot } from "../src/modules/family/family.types.js";

function baseCtx(overrides: Partial<FamilyContext> = {}): FamilyContext {
  return {
    location: "Example City",
    today: "Monday, June 15",
    todayIso: "2026-06-15", // a Monday
    members: [],
    caregiverSlots: [],
    parentEvents: [],
    dbEvents: [],
    openAlerts: [],
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
