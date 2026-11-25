import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './context/AuthContext';
import { Toasts } from './components/UI';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import SkinDiseaseAnalysisPage from './pages/SkinDiseaseAnalysisPage';
import EnhancePage from './pages/EnhancePage';
import TipsPage from './pages/TipsPage';
import DietPage from './pages/DietPage';
import ChatPage from './pages/ChatPage';
import RoutinePage from './pages/RoutinePage';
import RemindersPage from './pages/RemindersPage';
import HistoryPage from './pages/HistoryPage';
import ProductsPage from './pages/ProductsPage';
import NutritionPage from './pages/NutritionPage';
import ReportPage from './pages/ReportPage';

import ProfilePage from './pages/ProfilePage';

function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-powder border-t-plum" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route
          path="/app"
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="analyze" element={<SkinDiseaseAnalysisPage />} />
          <Route path="skin-condition" element={<Navigate to="/app/analyze" replace />} />
          <Route path="detect" element={<Navigate to="/app/analyze" replace />} />
          <Route path="enhance" element={<EnhancePage />} />
          <Route path="tips" element={<TipsPage />} />
          <Route path="diet" element={<DietPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="routine" element={<RoutinePage />} />
          <Route path="reminders" element={<RemindersPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="nutrition" element={<NutritionPage />} />
          <Route path="report" element={<ReportPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </>
  );
}
