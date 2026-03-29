import { useAuthToken } from "../api";
import { DashboardPage } from "./DashboardPage";
import { HomePage } from "./HomePage";

/** Signed-in users land on the cash dashboard; guests see the landing page with inline sign-in (`HomePage`). */
export function HomeRoute() {
  const token = useAuthToken();
  if (!token) {
    return <HomePage />;
  }
  return <DashboardPage />;
}
