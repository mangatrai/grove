import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { useAuthToken } from "../api";
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
          <main className="app-main">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
