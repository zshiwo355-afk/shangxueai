import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import LoginPage from "./components/LoginPage";
import HomePage from "./components/HomePage";
import AdminLayout from "./components/AdminLayout";
import PreparePage from "./components/PreparePage";
import ChatPage from "./components/ChatPage";
import ReviewPage from "./components/ReviewPage";
import ExamIntroPage from "./components/ExamIntroPage";
import ExamResultPage from "./components/ExamResultPage";
import TrainingHistoryPage from "./components/TrainingHistoryPage";
import TrainingRecordDetailPage from "./components/TrainingRecordDetailPage";
import MagicAcademyPage from "./components/MagicAcademyPage";

import { getCurrentUser, isAdmin, isAuthenticated, setUnauthorizedHandler } from "./lib/auth";

function RequireAuth({ children }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function RequireAdmin({ children }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  if (!isAdmin()) {
    return <Navigate to="/home" replace />;
  }
  return children;
}

function HomeRedirect() {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return isAdmin() ? <Navigate to="/admin" replace /> : <Navigate to="/home" replace />;
}

export default function App() {
  const navigate = useNavigate();

  // 全局 401 → 跳登录
  useEffect(() => {
    setUnauthorizedHandler(() => {
      navigate("/login", { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/" element={<HomeRedirect />} />

      <Route
        path="/home"
        element={<RequireAuth><HomePage /></RequireAuth>}
      />

      <Route
        path="/admin/*"
        element={<RequireAdmin><AdminLayout /></RequireAdmin>}
      />

      <Route
        path="/train/prepare"
        element={<RequireAuth><PreparePage /></RequireAuth>}
      />
      <Route
        path="/chat/:sid"
        element={<RequireAuth><ChatPage /></RequireAuth>}
      />
      <Route
        path="/review/:sid"
        element={<RequireAuth><ReviewPage /></RequireAuth>}
      />

      <Route
        path="/exam/:examId/intro"
        element={<RequireAuth><ExamIntroPage /></RequireAuth>}
      />
      <Route
        path="/exam/:examId/result"
        element={<RequireAuth><ExamResultPage /></RequireAuth>}
      />

      <Route
        path="/training/records"
        element={<RequireAuth><TrainingHistoryPage /></RequireAuth>}
      />
      <Route
        path="/training/records/:id"
        element={<RequireAuth><TrainingRecordDetailPage /></RequireAuth>}
      />
      <Route
        path="/magic-academy"
        element={<RequireAuth><MagicAcademyPage /></RequireAuth>}
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
