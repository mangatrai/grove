import { useEffect, useRef } from "react";
import { setToken, useAuthToken } from "../api";
import { ensureActivityListeners, getLastActivityAt, IDLE_LOGOUT_MS } from "../utils/activity";

const CHECK_INTERVAL_MS = 30_000;

/**
 * Wall-clock idle check on a repeating interval (+ focus/pageshow), not a single setTimeout.
 * Browsers that throttle background timers (Safari) just delay each check — the comparison
 * against lastActivityAt is still correct whenever it runs, so logout lands late but never
 * fails to land. See FIX #221.
 */
export function useIdleLogout(idleMs = IDLE_LOGOUT_MS) {
  const token = useAuthToken();
  const loggedOutRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    ensureActivityListeners();
    loggedOutRef.current = false;

    function check() {
      if (loggedOutRef.current) return;
      if (Date.now() - getLastActivityAt() <= idleMs) return;
      loggedOutRef.current = true;
      void fetch("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("hf_jwt") ?? ""}` },
      }).catch(() => {});
      setToken(null);
    }

    check();
    const intervalId = setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [token, idleMs]);
}
