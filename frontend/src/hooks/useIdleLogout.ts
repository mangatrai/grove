import { useEffect, useRef } from "react";
import { setToken, useAuthToken } from "../api";

const IDLE_EVENTS: (keyof WindowEventMap)[] = ["mousemove", "keydown", "click", "touchstart"];

export function useIdleLogout(idleMs = 15 * 60 * 1000) {
  const token = useAuthToken();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;

    function reset() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void fetch("/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("hf_jwt") ?? ""}` },
        }).catch(() => {});
        setToken(null);
      }, idleMs);
    }

    reset();
    IDLE_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [token, idleMs]);
}
