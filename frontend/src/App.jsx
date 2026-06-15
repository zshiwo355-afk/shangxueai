import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Spin } from "antd";

import LoginPage from "./components/LoginPage";
import WecomCallbackPage from "./components/WecomCallbackPage";

const HomePage = lazy(() => import("./components/HomePage"));
const AdminLayout = lazy(() => import("./components/AdminLayout"));
const UserLayout = lazy(() => import("./components/UserLayout"));
const PreparePage = lazy(() => import("./components/PreparePage"));
const ChatPage = lazy(() => import("./components/ChatPage"));
const ReviewPage = lazy(() => import("./components/ReviewPage"));
const ExamIntroPage = lazy(() => import("./components/ExamIntroPage"));
const ExamResultPage = lazy(() => import("./components/ExamResultPage"));
const TrainingHistoryPage = lazy(() => import("./components/TrainingHistoryPage"));
const TrainingRecordDetailPage = lazy(() => import("./components/TrainingRecordDetailPage"));
const MagicAcademyPage = lazy(() => import("./components/MagicAcademyPage"));
const TrainingWorkspacePage = lazy(() => import("./components/TrainingWorkspacePage"));
const MagicWorkspacePage = lazy(() => import("./components/MagicWorkspacePage"));
const ChallengeHistoryPage = lazy(() => import("./components/ChallengeHistoryPage"));
const UserTodosPage = lazy(() => import("./components/UserTodosPage"));
const UserPapersListPage = lazy(() => import("./components/user/papers/UserPapersListPage"));
const UserPaperTakePage = lazy(() => import("./components/user/papers/UserPaperTakePage"));
const UserPaperResultPage = lazy(() => import("./components/user/papers/UserPaperResultPage"));
const LivePublicPage = lazy(() => import("./components/live/LivePublicPage"));

import { isAdmin, isAuthenticated, isSuperAdmin, setUnauthorizedHandler } from "./lib/auth";

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-canvas)",
      }}
    >
      <Spin size="large" />
    </div>
  );
}

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

function RequireSuperAdmin({ children }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  if (!isSuperAdmin()) {
    return <Navigate to="/admin" replace />;
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
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/wecom/callback" element={<WecomCallbackPage />} />
        <Route path="/live/:slug" element={<LivePublicPage />} />

        <Route path="/" element={<HomeRedirect />} />

        <Route
          path="/admin/*"
          element={<RequireAdmin><AdminLayout /></RequireAdmin>}
        />

        <Route
          element={<RequireAuth><UserLayout /></RequireAuth>}
        >
          <Route path="/home" element={<HomePage />} />
          <Route path="/todo" element={<UserTodosPage />} />
          <Route path="/workspace/training" element={<TrainingWorkspacePage />} />
          <Route path="/training/challenges" element={<ChallengeHistoryPage />} />
          <Route path="/workspace/magic" element={<MagicWorkspacePage />} />
          <Route path="/train/prepare" element={<PreparePage />} />
          <Route path="/review/:sid" element={<ReviewPage />} />
          <Route path="/exam/:examId/intro" element={<ExamIntroPage />} />
          <Route path="/exam/:examId/result" element={<ExamResultPage />} />
          <Route path="/training/records" element={<TrainingHistoryPage />} />
          <Route path="/training/records/:id" element={<TrainingRecordDetailPage />} />
          <Route path="/magic-academy" element={<MagicAcademyPage />} />
          <Route path="/papers" element={<UserPapersListPage />} />
          <Route path="/papers/:assignmentId/take" element={<UserPaperTakePage />} />
          <Route path="/papers/submissions/:submissionId" element={<UserPaperResultPage />} />
        </Route>

        <Route
          path="/chat/:sid"
          element={<RequireAuth><ChatPage /></RequireAuth>}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
