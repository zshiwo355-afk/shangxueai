import { lazy, Suspense, useEffect, useState } from "react";
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
const LotteryPublicPage = lazy(() => import("./components/lottery/public/LotteryPublicPage"));
const LotterySharePreviewPage = lazy(() => import("./components/lottery/LotterySharePreviewPage"));
const LotteryLinkWorkspacePage = lazy(() => import("./components/lottery/LotteryLinkWorkspacePage"));
const MallPage = lazy(() => import("./components/mall/MallPage"));
const PublicAssessmentPage = lazy(() => import("./components/assessment/PublicAssessmentPage"));
const PublicAssessmentResultPage = lazy(() => import("./components/assessment/PublicAssessmentResultPage"));

import { fetchMe } from "./lib/api.auth";
import {
  clearAuth,
  getToken,
  isAdmin,
  isAuthenticated,
  isSuperAdmin,
  setCookieSessionActive,
  setCurrentUser,
  setUnauthorizedHandler,
} from "./lib/auth";

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
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
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

function LoginRoute() {
  if (!isAuthenticated()) return <LoginPage />;
  return isAdmin() ? <Navigate to="/admin" replace /> : <Navigate to="/home" replace />;
}

function isPublicRoute(pathname) {
  return pathname.startsWith("/live/")
    || pathname === "/lottery-share"
    || pathname.startsWith("/lottery-share/")
    || pathname.startsWith("/lottery/")
    || pathname.startsWith("/share/lottery/")
    || pathname.startsWith("/assessment/")
    || pathname.startsWith("/assessment-result/");
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const skipSessionRestore = location.pathname === "/auth/wecom/callback" || isPublicRoute(location.pathname);
  const [authReady, setAuthReady] = useState(
    () => skipSessionRestore || !!getToken(),
  );

  // 全局 401 → 跳登录
  useEffect(() => {
    setUnauthorizedHandler(() => {
      navigate("/login", { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  // Enterprise WeChat may clear or isolate localStorage between workbench
  // launches. Restore the 30-day HttpOnly cookie session before route guards
  // decide whether the user must return to the login page.
  useEffect(() => {
    if (skipSessionRestore || isAuthenticated()) {
      setAuthReady(true);
      return undefined;
    }

    let cancelled = false;
    setAuthReady(false);
    fetchMe({ skipAuthRedirect: true })
      .then((user) => {
        if (cancelled) return;
        setCurrentUser(user);
        setCookieSessionActive(true);
      })
      .catch(() => {
        if (!cancelled) clearAuth();
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [location.pathname, skipSessionRestore]);

  if (!authReady) return <RouteFallback />;

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/auth/wecom/callback" element={<WecomCallbackPage />} />
        <Route path="/live/:slug" element={<LivePublicPage />} />
        <Route path="/lottery/:code" element={<LotteryPublicPage />} />
        <Route path="/share/lottery/:code" element={<LotteryPublicPage />} />
        <Route path="/lottery-share" element={<LotterySharePreviewPage />} />
        <Route path="/lottery-share/:code" element={<LotterySharePreviewPage />} />
        <Route path="/assessment/:publicCode" element={<PublicAssessmentPage />} />
        <Route path="/assessment-result/:shareCode" element={<PublicAssessmentResultPage />} />

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
          <Route path="/lottery-workspace" element={<LotteryLinkWorkspacePage />} />
          <Route path="/mall" element={<MallPage />} />
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
