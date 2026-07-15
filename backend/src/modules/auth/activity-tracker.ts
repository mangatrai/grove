/**
 * Layer 2 server backstop for FIX #221 (Safari idle-logout/notification-polling failure).
 *
 * The client-side idle guard (frontend/src/utils/activity.ts) is a courtesy — it stops an
 * honest browser from polling. This tracker is the guarantee that doesn't depend on any
 * client cooperating: a background poll (`x-background-poll` header) from a session that has
 * had no non-background request in IDLE_LOGOUT_MS gets rejected, so even a zombie/leftover
 * browser window stops generating DB traffic within one idle window.
 *
 * In-memory, per-process — matches the existing single-instance assumption used by
 * payslip-async-scheduler.service.ts's hasPendingWork flag (#220). Reset on restart is
 * self-healing: the next non-background request from each user reseeds their entry.
 */

export const IDLE_LOGOUT_MS = 15 * 60 * 1000;

const lastActivityAt = new Map<string, number>();

export function recordActivity(userId: string, now = Date.now()): void {
  lastActivityAt.set(userId, now);
}

/** True only once a recorded activity timestamp exists AND is stale. No entry = not yet stale. */
export function isTokenStale(userId: string, now = Date.now()): boolean {
  const last = lastActivityAt.get(userId);
  if (last === undefined) return false;
  return now - last > IDLE_LOGOUT_MS;
}

/** Test-only: clears all tracked state between test cases. */
export function _resetActivityTrackerForTests(): void {
  lastActivityAt.clear();
}
