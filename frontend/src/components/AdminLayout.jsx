import {
  AppstoreOutlined,
  BellOutlined,
  BookOutlined,
  CloseOutlined,
  DashboardOutlined,
  FolderOpenOutlined,
  FormOutlined,
  GiftOutlined,
  LogoutOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SolutionOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Spin, Typography } from "antd";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { logoutApi } from "../lib/api.auth";
import { clearAuth, isSuperAdmin } from "../lib/auth";
import logoImg from "../assets/logo.png";

const UsersTab = lazy(() => import("./admin/UsersTab"));
const OptionsTab = lazy(() => import("./admin/OptionsTab"));
const ExamsTab = lazy(() => import("./admin/ExamsTab"));
const PapersAdminPage = lazy(() => import("./admin/papers/PapersAdminPage"));
const WhitelistTab = lazy(() => import("./admin/WhitelistTab"));
const MagicAcademyPage = lazy(() => import("./MagicAcademyPage"));
const MaterialLibraryPage = lazy(() => import("./admin/MaterialLibraryPage"));
const NotificationsTab = lazy(() => import("./admin/NotificationsTab"));
const PointsAdminPage = lazy(() => import("./admin/points/PointsAdminPage"));
const MentorsTab = lazy(() => import("./admin/mentors/MentorsTab"));
const DashboardPage = lazy(() => import("./admin/dashboard/DashboardPage"));

const { Header, Sider, Content } = Layout;

const MENU_GROUPS = [
  { key: "dashboard", icon: <DashboardOutlined />, label: "数据看板", path: "/admin/dashboard" },
  {
    key: "learning",
    icon: <ReadOutlined />,
    label: "学习中心",
    children: [
      { key: "magic-academy", icon: <ReadOutlined />, label: "课程管理", path: "/admin/magic-academy/courses" },
      { key: "magic-reading", icon: <BookOutlined />, label: "读书打卡", path: "/admin/magic-academy/reading" },
      { key: "exams", icon: <FormOutlined />, label: "AI 通关", path: "/admin/exams" },
      { key: "papers", icon: <SolutionOutlined />, label: "考试管理", path: "/admin/papers" },
    ],
  },
  {
    key: "operations",
    icon: <GiftOutlined />,
    label: "运营激励",
    children: [
      { key: "points", icon: <TrophyOutlined />, label: "积分管理", path: "/admin/points" },
      { key: "mentors", icon: <UserSwitchOutlined />, label: "导师管理", path: "/admin/mentors" },
      { key: "notifications", icon: <BellOutlined />, label: "推送监控", path: "/admin/notifications" },
    ],
  },
  {
    key: "user-mgmt",
    icon: <TeamOutlined />,
    label: "用户与权限",
    children: [
      { key: "users", icon: <TeamOutlined />, label: "用户管理", path: "/admin/users" },
      { key: "whitelist", icon: <SafetyCertificateOutlined />, label: "白名单管理", superOnly: true, path: "/admin/whitelist" },
    ],
  },
  {
    key: "system",
    icon: <SettingOutlined />,
    label: "系统配置",
    children: [
      { key: "options", icon: <AppstoreOutlined />, label: "配置管理", path: "/admin/options" },
      { key: "materials", icon: <FolderOpenOutlined />, label: "素材库", path: "/admin/materials" },
    ],
  },
];

const MENU_FLAT = MENU_GROUPS.flatMap((g) => (g.children ? g.children : [g]));

function findParentKey(leafKey) {
  return MENU_GROUPS.find((g) => g.children?.some((c) => c.key === leafKey))?.key;
}

function findLeaf(key) {
  return MENU_FLAT.find((m) => m.key === key);
}

function TabFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "120px 0" }}>
      <Spin size="large" />
    </div>
  );
}

const DEFAULT_TAB = { key: "dashboard", label: "数据看板", path: "/admin/dashboard", closable: false };

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const showWhitelist = isSuperAdmin();

  const menuItems = useMemo(() => {
    return MENU_GROUPS
      .map((g) => {
        if (!g.children) return { key: g.key, icon: g.icon, label: g.label };
        const children = g.children.filter((c) => !c.superOnly || showWhitelist);
        if (!children.length) return null;
        return {
          key: g.key,
          icon: g.icon,
          label: g.label,
          children: children.map((c) => ({ key: c.key, icon: c.icon, label: c.label })),
        };
      })
      .filter(Boolean);
  }, [showWhitelist]);

  const activeKey = useMemo(() => {
    if (location.pathname.startsWith("/admin/whitelist")) return "whitelist";
    if (location.pathname.startsWith("/admin/materials")) return "materials";
    if (location.pathname.startsWith("/admin/mentors")) return "mentors";
    if (location.pathname.startsWith("/admin/points")) return "points";
    if (location.pathname.startsWith("/admin/notifications")) return "notifications";
    if (location.pathname.startsWith("/admin/magic-academy/reading")) return "magic-reading";
    if (location.pathname.startsWith("/admin/magic-academy")) return "magic-academy";
    if (location.pathname.startsWith("/admin/papers")) return "papers";
    if (location.pathname.startsWith("/admin/dashboard")) return "dashboard";
    const m = location.pathname.match(/^\/admin\/?([\w-]+)?/);
    return m?.[1] || "dashboard";
  }, [location.pathname]);

  // 多开父级菜单（受控）：只 add，不自动 remove，用户手动收起即可
  const [openKeys, setOpenKeys] = useState(() => {
    const parent = findParentKey(activeKey);
    return parent ? [parent] : [];
  });
  useEffect(() => {
    const parent = findParentKey(activeKey);
    if (parent) {
      setOpenKeys((prev) => (prev.includes(parent) ? prev : [...prev, parent]));
    }
  }, [activeKey]);

  // 标签页签：dashboard 永驻，其他根据访问历史动态加入
  const [tabs, setTabs] = useState([DEFAULT_TAB]);
  const lastKeyRef = useRef(null);
  useEffect(() => {
    if (lastKeyRef.current === activeKey) return;
    lastKeyRef.current = activeKey;
    const leaf = findLeaf(activeKey);
    if (!leaf) return;
    setTabs((prev) => {
      if (prev.some((t) => t.key === activeKey)) return prev;
      return [...prev, {
        key: activeKey,
        label: leaf.label,
        path: leaf.path || `/admin/${activeKey}`,
        closable: activeKey !== "dashboard",
      }];
    });
  }, [activeKey]);

  const closeTab = (key) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.key !== key);
      if (key === activeKey && next.length) {
        const fallback = next[Math.min(idx, next.length - 1)];
        navigate(fallback.path);
      }
      return next.length ? next : [DEFAULT_TAB];
    });
  };

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
              padding: 0,
              background: "transparent",
              boxShadow: "none",
              overflow: "hidden",
            }}
          >
            <img
              src={logoImg}
              alt="怀仁商学院"
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2 }}>
            <strong style={{ fontSize: 14, lineHeight: 1.3 }}>怀仁商学院</strong>
            <span style={{ fontSize: 12, color: "var(--text-mute)", lineHeight: 1.3 }}>
              管理后台
            </span>
          </div>
        </div>
        <Menu
          mode="inline"
          multiple={false}
          selectedKeys={[activeKey]}
          openKeys={openKeys}
          onOpenChange={setOpenKeys}
          items={menuItems}
          style={{ flex: 1, overflowY: "auto", borderInlineEnd: 0 }}
          onClick={({ key }) => {
            const item = findLeaf(key);
            if (!item) return;
            navigate(item.path || `/admin/${key}`);
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
            height: 56,
          }}
        >
          <Typography.Title level={5} style={{ margin: 0, fontWeight: 500 }}>
            {findLeaf(activeKey)?.label || "管理后台"}
          </Typography.Title>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出</Button>
        </Header>

        <div
          style={{
            background: "#fafafa",
            borderBottom: "1px solid #f0f0f0",
            padding: "6px 16px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.key === activeKey;
            return (
              <div
                key={tab.key}
                onClick={() => { if (!isActive) navigate(tab.path); }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  fontSize: 13,
                  borderRadius: 4,
                  cursor: isActive ? "default" : "pointer",
                  background: isActive ? "#fff" : "transparent",
                  border: isActive ? "1px solid #e5e7eb" : "1px solid transparent",
                  color: isActive ? "#1677ff" : "#595959",
                  whiteSpace: "nowrap",
                  height: 28,
                }}
              >
                <span>{tab.label}</span>
                {tab.closable ? (
                  <CloseOutlined
                    onClick={(ev) => {
                      ev.stopPropagation();
                      closeTab(tab.key);
                    }}
                    style={{
                      fontSize: 10,
                      color: "#bfbfbf",
                      padding: 2,
                      borderRadius: 2,
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <Content style={{ padding: 24, overflow: "auto", flex: 1 }}>
          <Suspense fallback={<TabFallback />}>
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="users" element={<UsersTab />} />
              <Route path="options" element={<OptionsTab />} />
              <Route path="exams" element={<ExamsTab />} />
              <Route path="papers/*" element={<PapersAdminPage />} />
              <Route path="magic-academy" element={<Navigate to="/admin/magic-academy/courses" replace />} />
              <Route path="magic-academy/courses" element={<MagicAcademyPage embedded adminSection="courses" />} />
              <Route path="magic-academy/reading" element={<MagicAcademyPage embedded adminSection="reading" />} />
              <Route path="materials" element={<MaterialLibraryPage />} />
              <Route path="mentors" element={<MentorsTab />} />
              <Route path="points" element={<PointsAdminPage />} />
              <Route path="notifications" element={<NotificationsTab />} />
              <Route path="whitelist" element={showWhitelist ? <WhitelistTab /> : <Navigate to="/admin/users" replace />} />
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}
