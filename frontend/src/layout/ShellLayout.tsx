import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";

import { apiJson, useAuthToken } from "../api";
import { AppSidebar } from "./AppSidebar";
import { AppTopBar } from "./AppTopBar";

export function ShellLayout() {
  const token = useAuthToken();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("hf_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [personProfileId, setPersonProfileId] = useState<string | null | undefined>(undefined);
  // undefined = not yet loaded; null = loaded but no profile; string = loaded with profile

  useEffect(() => {
    if (!token) {
      setForcePasswordChange(false);
      setUserRole(null);
      setPersonProfileId(undefined);
      return;
    }
    void apiJson<{ user: { forcePasswordChange?: boolean; role?: string; personProfileId?: string | null } }>("/auth/me")
      .then((r) => {
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
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handler = () => setForcePasswordChange(false);
    window.addEventListener("app:password-changed", handler);
    return () => window.removeEventListener("app:password-changed", handler);
  }, []);

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
        <div className="app-shell">
          <AppSidebar
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
            mobileOpen={mobileNavOpen}
            onCloseMobile={() => setMobileNavOpen(false)}
          />
          <div className="app-shell-main">
            <AppTopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
            <main className="app-main" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
              <div style={{ maxWidth: 480, textAlign: "center", padding: "2rem" }}>
                <h2 style={{ marginBottom: "0.75rem" }}>Not part of a household</h2>
                <p className="muted">
                  Your account exists but is not linked to a household profile yet.
                  Contact your household admin to be added as a member.
                </p>
              </div>
            </main>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-frame app-frame--authed">
      <div className="app-shell">
        <AppSidebar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />
        <div className="app-shell-main">
          <AppTopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
          {forcePasswordChange && userRole === "owner" && pathname.startsWith("/settings") ? (
            <div style={{
              background: "#fef3c7",
              borderBottom: "1px solid #fcd34d",
              padding: "0.6rem 1.25rem",
              fontSize: "0.88rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem"
            }}>
              <strong>First login:</strong> Your account was created with a temporary password. Please set a permanent password below before using the app.
            </div>
          ) : null}
          {forcePasswordChange && userRole !== "owner" ? (
            <div style={{
              background: "#fef3c7",
              borderBottom: "1px solid #fcd34d",
              padding: "0.6rem 1.25rem",
              fontSize: "0.88rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem"
            }}>
              <strong>Action required:</strong> Your password is temporary — please change it.{" "}
              <Link to="/settings?tab=security" style={{ fontWeight: 600 }}>
                Change password now →
              </Link>
            </div>
          ) : null}
          <main className="app-main">
            {/* Hard gate: owner with a temporary password must change it before accessing anything else. */}
            {forcePasswordChange && userRole === "owner" && !pathname.startsWith("/settings") ? (
              <Navigate to="/settings?tab=security" replace />
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
