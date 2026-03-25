import { Outlet } from "react-router-dom";

import { useAuthToken } from "../api";
import { AppHeader } from "./AppHeader";

export function ShellLayout() {
  const token = useAuthToken();

  return (
    <div className="app-frame">
      {token ? <AppHeader /> : null}
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
