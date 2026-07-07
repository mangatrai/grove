const ACTIVITY_KEY = "hf_last_activity_at";
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ["mousemove", "keydown", "click", "touchstart"];

/** Logout enforced once idle exceeds this — matches the previous useIdleLogout default. */
export const IDLE_LOGOUT_MS = 15 * 60 * 1000;
/** Background polling paused (not logged out) once idle exceeds this, well before IDLE_LOGOUT_MS. */
export const POLL_PAUSE_MS = 5 * 60 * 1000;

/** Wall-clock timestamp of the last user activity, mirrored to localStorage for cross-tab correctness. */
export function markActivity(now = Date.now()): void {
  localStorage.setItem(ACTIVITY_KEY, String(now));
}

/** Falls back to "now" if never set (e.g. first load) so a fresh session isn't born idle. */
export function getLastActivityAt(): number {
  const raw = localStorage.getItem(ACTIVITY_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

let listenersRegistered = false;

/**
 * Registers the activity listeners exactly once per page load. Safe to call from multiple
 * components — every caller shares the same localStorage-backed timestamp.
 */
export function ensureActivityListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;
  markActivity();
  ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, () => markActivity(), { passive: true }));
}

export interface PollGuardResult {
  /** Idle time exceeded IDLE_LOGOUT_MS — caller must log out and skip the network call. */
  logout: boolean;
  /** Whether the background poll's network call should run this tick. */
  poll: boolean;
}

/**
 * Pure decision function for a background poll tick. No DOM/timer reliance: called fresh on
 * every tick (however delayed by browser throttling), so the wall-clock comparison is always
 * correct at the moment it actually runs — a throttled tick yields a later logout, never a
 * skipped one, and never extra polling.
 */
export function evaluatePollGuard(params: {
  now: number;
  lastActivityAt: number;
  hasFocus: boolean;
  idleLogoutMs?: number;
  pollPauseMs?: number;
}): PollGuardResult {
  const idleLogoutMs = params.idleLogoutMs ?? IDLE_LOGOUT_MS;
  const pollPauseMs = params.pollPauseMs ?? POLL_PAUSE_MS;
  const idleFor = params.now - params.lastActivityAt;

  if (idleFor > idleLogoutMs) {
    return { logout: true, poll: false };
  }
  if (idleFor > pollPauseMs || !params.hasFocus) {
    return { logout: false, poll: false };
  }
  return { logout: false, poll: true };
}
