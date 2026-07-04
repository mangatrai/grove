import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppShell } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

import { apiFetch, apiJson, setToken, useAuthToken } from "../api";
import { UserContext } from "../UserContext";
import { useIdleLogout } from "../hooks/useIdleLogout";
import { AppSidebar } from "./AppSidebar";
import { AppTopBar } from "./AppTopBar";

/** Set by HomePage on login when server returns `forcePasswordChange`; cleared after `/auth/me` or sign-out. */
const LOGIN_FORCE_PASSWORD_HINT_KEY = "hf_login_force_password_change";

function readLoginForcePasswordHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(LOGIN_FORCE_PASSWORD_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function ShellLayout() {
  const token = useAuthToken();
  useIdleLogout();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("hf_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [mobileNavOpen, { open: openMobileNav, close: closeMobileNav }] = useDisclosure(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [personProfileId, setPersonProfileId] = useState<string | null | undefined>(undefined);
  const [setupRedirecting, setSetupRedirecting] = useState(false);
  // undefined = not yet loaded; null = loaded but no profile; string = loaded with profile

  useEffect(() => {
    if (!token) {
      setForcePasswordChange(false);
      setUserRole(null);
      setPersonProfileId(undefined);
      setSetupRedirecting(false);
      try {
        sessionStorage.removeItem(LOGIN_FORCE_PASSWORD_HINT_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    void apiJson<{ user: { forcePasswordChange?: boolean; role?: string; personProfileId?: string | null } }>("/auth/me")
      .then((r) => {
        try {
          sessionStorage.removeItem(LOGIN_FORCE_PASSWORD_HINT_KEY);
        } catch {
          /* ignore */
        }
        setForcePasswordChange(Boolean(r.user.forcePasswordChange));
        setUserRole(r.user.role ?? null);
        setPersonProfileId(r.user.personProfileId ?? null);
      })
      .catch(() => {
        setForcePasswordChange(false);
        setUserRole(null);
        setPersonProfileId(null);
      });
  }, [token]);

  useEffect(() => {
    try {
      localStorage.setItem("hf_sidebar_collapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    closeMobileNav();
  }, [pathname, closeMobileNav]);

  useEffect(() => {
    const handler = () => {
      // Password changed → old token is immediately invalidated server-side.
      // Sign the user out cleanly so they land on the login page rather than
      // seeing "Session expired" on the next API call.
      setToken(null);
      setForcePasswordChange(false);
    };
    window.addEventListener("app:password-changed", handler);
    return () => window.removeEventListener("app:password-changed", handler);
  }, []);

  useEffect(() => {
    if (!token || setupRedirecting) return;
    const hinted = readLoginForcePasswordHint();
    if (!forcePasswordChange && !hinted) return;
    setSetupRedirecting(true);
    void (async () => {
      try {
        const res = await apiFetch("/auth/setup-forced-change-token", { method: "POST" });
        if (!res.ok) {
          setSetupRedirecting(false);
          return;
        }
        const body = (await res.json()) as { token?: string };
        if (!body.token) {
          setSetupRedirecting(false);
          return;
        }
        setToken(null);
        // BrowserRouter (pathname routes) — hash URLs would leave pathname "/" and show HomePage.
        window.location.replace(`/reset-password?token=${encodeURIComponent(body.token)}`);
      } catch {
        setSetupRedirecting(false);
      }
    })();
  }, [forcePasswordChange, token, setupRedirecting]);

  const loginForcePasswordHint = Boolean(token && readLoginForcePasswordHint());
  const blockAuthedShellForForceChange = forcePasswordChange || loginForcePasswordHint;

  if (!token) {
    return (
      <div className="app-frame">
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    );
  }

  // Member with no linked person profile — not yet part of a household.
  // Show a locked screen; do not render the full shell.
  if (userRole === "member" && personProfileId === null) {
    return (
      <div className="app-frame app-frame--authed">
        <AppShell
          layout="alt"
          navbar={{ width: collapsed ? 56 : 240, breakpoint: "sm", collapsed: { mobile: !mobileNavOpen } }}
          header={{ height: 48 }}
          padding={0}
          transitionDuration={200}
          transitionTimingFunction="ease"
        >
          <AppSidebar
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
            mobileOpen={mobileNavOpen}
            onCloseMobile={closeMobileNav}
          />
          <AppTopBar onOpenMobileNav={openMobileNav} />
          <AppShell.Main>
            <main className="app-main" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
              <div style={{ maxWidth: 480, textAlign: "center", padding: "2rem" }}>
                <h2 style={{ marginBottom: "0.75rem" }}>Not part of a household</h2>
                <p className="muted">
                  Your account exists but is not linked to a household profile yet.
                  Contact your household admin to be added as a member.
                </p>
              </div>
            </main>
          </AppShell.Main>
        </AppShell>
      </div>
    );
  }

  // Forced-change redirect is in flight — don't flash the full shell (including before `/auth/me`).
  if (blockAuthedShellForForceChange) {
    return null;
  }

  return (
    <UserContext.Provider value={{ role: userRole, personProfileId: personProfileId ?? null }}>
      <div className="app-frame app-frame--authed">
        <AppShell
          layout="alt"
          navbar={{ width: collapsed ? 56 : 240, breakpoint: "sm", collapsed: { mobile: !mobileNavOpen } }}
          header={{ height: 48 }}
          padding={0}
          transitionDuration={200}
          transitionTimingFunction="ease"
        >
          <AppSidebar
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
            mobileOpen={mobileNavOpen}
            onCloseMobile={closeMobileNav}
          />
          <AppTopBar onOpenMobileNav={openMobileNav} />
          <AppShell.Main>
            <main className="app-main">
              <Outlet />
            </main>
          </AppShell.Main>
        </AppShell>
      </div>
    </UserContext.Provider>
  );
}
