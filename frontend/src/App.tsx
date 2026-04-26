import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { ShellLayout } from "./layout/ShellLayout";
import { BudgetPage } from "./pages/BudgetPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { CategoryRulesPage } from "./pages/CategoryRulesPage";
import { HomeRoute } from "./pages/HomeRoute";
import { NetWorthPage } from "./pages/NetWorthPage";
import { ImportWorkspacePage } from "./pages/ImportWorkspacePage";
import { ImportPage } from "./pages/ImportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PayslipDetailPage } from "./pages/PayslipDetailPage";
import { PayslipManualPage } from "./pages/PayslipManualPage";
import { PayslipsPage } from "./pages/PayslipsPage";
import { TransactionsPage } from "./pages/TransactionsPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<ShellLayout />}>
        <Route path="/" element={<HomeRoute />} />
        <Route element={<RequireAuth />}>
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/categories/rules" element={<CategoryRulesPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/net-worth" element={<NetWorthPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/resolution-queue" element={<Navigate to="/transactions?needsReview=true" replace />} />
          <Route path="/payslips/new" element={<PayslipManualPage />} />
          <Route path="/payslips/:payslipId" element={<PayslipDetailPage />} />
          <Route path="/payslips" element={<PayslipsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/resolution" element={<Navigate to="/transactions?needsReview=true" replace />} />
          <Route path="/import" element={<Navigate to="/imports" replace />} />
          <Route path="/imports" element={<ImportPage />} />
          <Route path="/imports/workspace" element={<ImportWorkspacePage />} />
          <Route path="/imports/:sessionId" element={<ImportWorkspacePage />} />
        </Route>
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
