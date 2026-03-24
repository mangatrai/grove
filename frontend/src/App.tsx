import { Navigate, Route, Routes } from "react-router-dom";

import { HomePage } from "./pages/HomePage";
import { ImportWorkspacePage } from "./pages/ImportWorkspacePage";
import { LoginPage } from "./pages/LoginPage";
import { ResolutionQueuePage } from "./pages/ResolutionQueuePage";
import { TransactionsPage } from "./pages/TransactionsPage";

export function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/imports/:sessionId" element={<ImportWorkspacePage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/resolution" element={<ResolutionQueuePage />} />
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
