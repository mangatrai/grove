import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { ShellLayout } from "./layout/ShellLayout";
import { CategoriesPage } from "./pages/CategoriesPage";
import { CategoryRulesPage } from "./pages/CategoryRulesPage";
import { HomeRoute } from "./pages/HomeRoute";
import { ImportWorkspacePage } from "./pages/ImportWorkspacePage";
import { SettingsPage } from "./pages/SettingsPage";
import { PayslipDetailPage } from "./pages/PayslipDetailPage";
import { PayslipsPage } from "./pages/PayslipsPage";
import { ResolutionQueuePage } from "./pages/ResolutionQueuePage";
import { TransactionsPage } from "./pages/TransactionsPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<ShellLayout />}>
        <Route path="/" element={<HomeRoute />} />
        <Route element={<RequireAuth />}>
          <Route path="/categories/rules" element={<CategoryRulesPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/resolution-queue" element={<ResolutionQueuePage />} />
          <Route path="/payslips/:payslipId" element={<PayslipDetailPage />} />
          <Route path="/payslips" element={<PayslipsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/resolution" element={<Navigate to="/transactions?needsReview=true" replace />} />
          <Route path="/imports/:sessionId" element={<ImportWorkspacePage />} />
        </Route>
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
