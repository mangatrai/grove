import { Navigate, Outlet } from "react-router-dom";

import { useAuthToken } from "../api";

export function RequireAuth() {
  const token = useAuthToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
