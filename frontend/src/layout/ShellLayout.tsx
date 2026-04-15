import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

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

  useEffect(() => {
    if (!token) {
      setForcePasswordChange(false);
      return;
    }
    void apiJson<{ user: { forcePasswordChange?: boolean } }>("/auth/me")
      .then((r) => setForcePasswordChange(Boolean(r.user.forcePasswordChange)))
      .catch(() => setForcePasswordChange(false));
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
          {forcePasswordChange ? (
            <div style={{
              background: "#fef3c7",
              borderBottom: "1px solid #fcd34d",
              padding: "0.6rem 1.25rem",
              fontSize: "0.88rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem"
            }}>
              <strong>Action required:</strong> Your password is temporary and must be changed before you continue.{" "}
              <Link to="/settings?tab=security" style={{ fontWeight: 600 }}>
                Change password now →
              </Link>
            </div>
          ) : null}
          <main className="app-main">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
