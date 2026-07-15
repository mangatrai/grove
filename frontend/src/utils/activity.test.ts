import { describe, expect, it } from "vitest";

import { evaluatePollGuard, IDLE_LOGOUT_MS, POLL_PAUSE_MS } from "./activity.js";

describe("evaluatePollGuard (FIX #221)", () => {
  it("polls when recently active and focused", () => {
    const result = evaluatePollGuard({ now: 10_000, lastActivityAt: 9_000, hasFocus: true });
    expect(result).toEqual({ logout: false, poll: true });
  });

  it("skips the poll (but does not log out) once idle past POLL_PAUSE_MS", () => {
    const now = 10_000;
    const result = evaluatePollGuard({ now, lastActivityAt: now - POLL_PAUSE_MS - 1, hasFocus: true });
    expect(result).toEqual({ logout: false, poll: false });
  });

  it("skips the poll when the tab lacks focus, even if recently active", () => {
    const result = evaluatePollGuard({ now: 10_000, lastActivityAt: 9_999, hasFocus: false });
    expect(result).toEqual({ logout: false, poll: false });
  });

  it("signals logout once idle exceeds IDLE_LOGOUT_MS, regardless of focus", () => {
    const now = 100_000;
    const result = evaluatePollGuard({ now, lastActivityAt: now - IDLE_LOGOUT_MS - 1, hasFocus: true });
    expect(result).toEqual({ logout: true, poll: false });
  });

  it("a throttled/delayed tick still yields the correct wall-clock decision (fail-closed)", () => {
    // Simulates a Safari background tab where the tick itself fired minutes late:
    // the guard must still resolve correctly from Date.now() - lastActivityAt, not from
    // "how long has it been since the timer was scheduled."
    const now = 1_000_000;
    const idleFor = IDLE_LOGOUT_MS + 5 * 60_000; // way past logout threshold
    const result = evaluatePollGuard({ now, lastActivityAt: now - idleFor, hasFocus: true });
    expect(result.logout).toBe(true);
    expect(result.poll).toBe(false);
  });

  it("honors custom thresholds when provided", () => {
    const result = evaluatePollGuard({
      now: 10_000,
      lastActivityAt: 0,
      hasFocus: true,
      idleLogoutMs: 20_000,
      pollPauseMs: 5_000,
    });
    expect(result).toEqual({ logout: false, poll: false }); // 10s idle > 5s pause, < 20s logout
  });
});
