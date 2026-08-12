import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { useCurrentUser } from "./UserContext";
import { ShellLayout } from "./layout/ShellLayout";
import { BudgetPage } from "./pages/BudgetPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { CategoryRulesPage } from "./pages/CategoryRulesPage";
import { HomeRoute } from "./pages/HomeRoute";
import { NetWorthPage } from "./pages/NetWorthPage";
import { ImportWorkspacePage } from "./pages/ImportWorkspacePage";
import { SettingsPage } from "./pages/SettingsPage";
import { PayslipDetailPage } from "./pages/PayslipDetailPage";
import { AddPayslipPage } from "./pages/AddPayslipPage";
import { PayslipsPage } from "./pages/PayslipsPage";
import { EsppPage } from "./pages/EsppPage";
import { RealEstatePage } from "./pages/RealEstatePage";
import { PropertyDetailPage } from "./pages/PropertyDetailPage";
import { TaxProtestPage } from "./pages/TaxProtestPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { FamilyEventsPage } from "./pages/FamilyEventsPage";
import { FamilyDeadlinesPage } from "./pages/FamilyDeadlinesPage";
import { FamilyAgentPage } from "./pages/FamilyAgentPage";
import { StaffPortalPage } from "./pages/StaffPortalPage";
import { StaffDirectoryPage } from "./pages/StaffDirectoryPage";
import { StaffTimesheetsPage } from "./pages/StaffTimesheetsPage";
import { StaffExpensesPage } from "./pages/StaffExpensesPage";
import { StaffPayPage } from "./pages/StaffPayPage";

function RequireOwnerOrAdmin({ children }: { children: ReactNode }) {
  const { role } = useCurrentUser();
  if (role === "member") return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Staff logins get a restricted portal-only shell — redirect away from every other authenticated route. */
function RequireNotStaffLayout() {
  const { role } = useCurrentUser();
  if (role === "staff") return <Navigate to="/staff" replace />;
  return <Outlet />;
}

function RequireStaff({ children }: { children: ReactNode }) {
  const { role } = useCurrentUser();
  if (role && role !== "staff") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<ShellLayout />}>
        <Route element={<RequireAuth />}>
          <Route path="/staff" element={<RequireStaff><StaffPortalPage /></RequireStaff>} />
        </Route>
        <Route element={<RequireNotStaffLayout />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/budget" element={<BudgetPage />} />
            <Route path="/categories/rules" element={<CategoryRulesPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/net-worth" element={<NetWorthPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/resolution-queue" element={<Navigate to="/transactions?needsReview=true" replace />} />
            <Route path="/payslips/new" element={<AddPayslipPage />} />
            <Route path="/payslips/:payslipId" element={<PayslipDetailPage />} />
            <Route path="/payslips" element={<PayslipsPage />} />
            <Route path="/espp" element={<EsppPage />} />
            <Route path="/real-estate" element={<RequireOwnerOrAdmin><RealEstatePage /></RequireOwnerOrAdmin>} />
            <Route path="/real-estate/:propertyId" element={<RequireOwnerOrAdmin><PropertyDetailPage /></RequireOwnerOrAdmin>} />
            <Route path="/tax-protest" element={<RequireOwnerOrAdmin><TaxProtestPage /></RequireOwnerOrAdmin>} />
            <Route path="/family" element={<Navigate to="/family/events" replace />} />
            <Route path="/family/activities" element={<Navigate to="/family/events" replace />} />
            <Route path="/family/events" element={<RequireOwnerOrAdmin><FamilyEventsPage /></RequireOwnerOrAdmin>} />
            <Route path="/family/deadlines" element={<RequireOwnerOrAdmin><FamilyDeadlinesPage /></RequireOwnerOrAdmin>} />
            <Route path="/family/agent" element={<RequireOwnerOrAdmin><FamilyAgentPage /></RequireOwnerOrAdmin>} />
            <Route path="/staff-admin" element={<Navigate to="/staff-admin/directory" replace />} />
            <Route path="/staff-admin/directory" element={<RequireOwnerOrAdmin><StaffDirectoryPage /></RequireOwnerOrAdmin>} />
            <Route path="/staff-admin/timesheets" element={<RequireOwnerOrAdmin><StaffTimesheetsPage /></RequireOwnerOrAdmin>} />
            <Route path="/staff-admin/expenses" element={<RequireOwnerOrAdmin><StaffExpensesPage /></RequireOwnerOrAdmin>} />
            <Route path="/staff-admin/pay" element={<RequireOwnerOrAdmin><StaffPayPage /></RequireOwnerOrAdmin>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/resolution" element={<Navigate to="/transactions?needsReview=true" replace />} />
            <Route path="/import" element={<Navigate to="/imports/workspace" replace />} />
            <Route path="/imports" element={<Navigate to="/imports/workspace" replace />} />
            <Route path="/imports/workspace" element={<ImportWorkspacePage />} />
            <Route path="/imports/:sessionId" element={<ImportWorkspacePage />} />
          </Route>
        </Route>
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
