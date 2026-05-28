import { LogoutOutlined, AppstoreOutlined, BookOutlined, FormOutlined, SolutionOutlined, TeamOutlined, ReadOutlined, SafetyCertificateOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { Button, Layout, Menu, Spin, Typography } from "antd";
import { lazy, Suspense, useMemo } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { logoutApi } from "../lib/api.auth";
import { clearAuth, getCurrentUser, isSuperAdmin } from "../lib/auth";

const UsersTab = lazy(() => import("./admin/UsersTab"));
const OptionsTab = lazy(() => import("./admin/OptionsTab"));
const ExamsTab = lazy(() => import("./admin/ExamsTab"));
const PapersAdminPage = lazy(() => import("./admin/papers/PapersAdminPage"));
const WhitelistTab = lazy(() => import("./admin/WhitelistTab"));
const MagicAcademyPage = lazy(() => import("./MagicAcademyPage"));
const MaterialLibraryPage = lazy(() => import("./admin/MaterialLibraryPage"));

const { Header, Sider, Content } = Layout;

const MENU_ITEMS = [
  { key: "users", icon: <TeamOutlined />, label: "用户管理" },
  { key: "options", icon: <AppstoreOutlined />, label: "配置管理" },
  { key: "exams", icon: <FormOutlined />, label: "AI通关" },
  { key: "papers", icon: <SolutionOutlined />, label: "考试管理" },
  { key: "magic-academy", icon: <ReadOutlined />, label: "课程管理", path: "/admin/magic-academy/courses" },
  { key: "magic-reading", icon: <BookOutlined />, label: "读书打卡管理", path: "/admin/magic-academy/reading" },
  { key: "materials", icon: <FolderOpenOutlined />, label: "素材库管理" },
  { key: "whitelist", icon: <SafetyCertificateOutlined />, label: "白名单管理", superOnly: true },
];

function TabFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "120px 0" }}>
      <Spin size="large" />
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getCurrentUser();
  const showWhitelist = isSuperAdmin();
  const menuItems = useMemo(
    () => MENU_ITEMS.filter((item) => !item.superOnly || showWhitelist),
    [showWhitelist],
  );

  const activeKey = useMemo(() => {
    if (location.pathname.startsWith("/admin/whitelist")) return "whitelist";
    if (location.pathname.startsWith("/admin/materials")) return "materials";
    if (location.pathname.startsWith("/admin/magic-academy/reading")) return "magic-reading";
    if (location.pathname.startsWith("/admin/magic-academy")) return "magic-academy";
    if (location.pathname.startsWith("/admin/papers")) return "papers";
    const m = location.pathname.match(/^\/admin\/?([\w-]+)?/);
    return m?.[1] || "users";
  }, [location.pathname]);

  const handleLogout = async () => {
    try { await logoutApi(); } catch { /* ignore */ }
    clearAuth();
    navigate("/login", { replace: true });
  };

  return (
    <Layout style={{ height: "100vh" }}>
      <Sider
        width={220}
        theme="light"
        style={{
          borderRight: "1px solid var(--line-soft)",
          height: "100vh",
          position: "sticky",
          top: 0,
          left: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "20px 16px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderBottom: "1px solid var(--line-soft)",
            flexShrink: 0,
          }}
        >
          <div
            className="prepare-emblem"
            style={{
              width: 40,
              height: 40,
              fontSize: 18,
              marginBottom: 0,
              borderRadius: 12,
              flexShrink: 0,
            }}
          >
            怀
          </div>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2 }}>
            <strong style={{ fontSize: 14, lineHeight: 1.3 }}>怀仁商学院</strong>
            <span style={{ fontSize: 12, color: "var(--text-mute)", lineHeight: 1.3 }}>
              {user?.display_name || user?.username || "管理后台"}
            </span>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          items={menuItems}
          style={{ flex: 1, overflowY: "auto", borderInlineEnd: 0 }}
          onClick={({ key }) => {
            const item = menuItems.find((menuItem) => menuItem.key === key);
            navigate(item?.path || `/admin/${key}`);
          }}
        />
      </Sider>
      <Layout style={{ height: "100vh" }}>
        <Header
          style={{
            background: "#fff",
            padding: "0 24px",
            borderBottom: "1px solid var(--line-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {menuItems.find((m) => m.key === activeKey)?.label || "管理后台"}
          </Typography.Title>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出</Button>
        </Header>
        <Content style={{ padding: 24, overflow: "auto", flex: 1 }}>
          <Suspense fallback={<TabFallback />}>
            <Routes>
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<UsersTab />} />
              <Route path="options" element={<OptionsTab />} />
              <Route path="exams" element={<ExamsTab />} />
              <Route path="papers/*" element={<PapersAdminPage />} />
              <Route path="magic-academy" element={<Navigate to="/admin/magic-academy/courses" replace />} />
              <Route path="magic-academy/courses" element={<MagicAcademyPage embedded adminSection="courses" />} />
              <Route path="magic-academy/reading" element={<MagicAcademyPage embedded adminSection="reading" />} />
              <Route path="materials" element={<MaterialLibraryPage />} />
              <Route path="whitelist" element={showWhitelist ? <WhitelistTab /> : <Navigate to="/admin/users" replace />} />
              <Route path="*" element={<Navigate to="users" replace />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}
