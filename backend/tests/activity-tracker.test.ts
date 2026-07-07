import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetActivityTrackerForTests,
  IDLE_LOGOUT_MS,
  isTokenStale,
  recordActivity
} from "../src/modules/auth/activity-tracker.js";

describe("activity-tracker (FIX #221 Layer 2 server backstop)", () => {
  beforeEach(() => {
    _resetActivityTrackerForTests();
  });

  it("is not stale before any activity is recorded — fails open once, not indefinitely", () => {
    expect(isTokenStale("user-1", 1_000_000)).toBe(false);
  });

  it("is not stale immediately after activity", () => {
    recordActivity("user-1", 1_000_000);
    expect(isTokenStale("user-1", 1_000_000 + 1_000)).toBe(false);
  });

  it("becomes stale once IDLE_LOGOUT_MS elapses", () => {
    recordActivity("user-1", 1_000_000);
    expect(isTokenStale("user-1", 1_000_000 + IDLE_LOGOUT_MS + 1)).toBe(true);
  });

  it("tracks each user independently", () => {
    recordActivity("user-1", 1_000_000);
    expect(isTokenStale("user-2", 1_000_000 + IDLE_LOGOUT_MS + 1)).toBe(false);
  });

  it("a later recordActivity call slides the window forward", () => {
    recordActivity("user-1", 1_000_000);
    recordActivity("user-1", 1_000_000 + IDLE_LOGOUT_MS); // refreshed just before it would go stale
    expect(isTokenStale("user-1", 1_000_000 + IDLE_LOGOUT_MS + 1_000)).toBe(false);
  });
});
